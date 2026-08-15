import { tool, type Plugin } from "@opencode-ai/plugin"
import { z } from "zod"
import { execSync } from "node:child_process"
import { readFile } from "node:fs/promises"
import { join } from "node:path"

/**
 * routing-suite —— dsh-routing-suite 的 opencode 实现（V1 API，pin 1.18.18）。
 *
 * 核心价值：首条消息前锁定推理模式（spec/react/weak），用 persona + 首轮
 * 工具 schema 锚定轨迹，随后恢复全能力。agent 文件自带 persona + 工具面，
 * 本插件只负责"选 agent"（薄路由），不 touch system。
 *
 * 三带（router-standard 实测）：spec [0,0.15] 稳定 / transition 带回避 /
 * react [0.5,1] 稳定；mixed 永不输出。分类器移植 router-core classifyTask：
 * react 关键词胜 → react；spec 关键词胜 → spec；平局 → weak（模型内部自路由）。
 *
 * 手动锁 vs 自动：
 *   - 手动锁（dev_router_mode spec|react|weak）：持续生效，每条消息按锁模式
 *     处理，用于可分性实验稳定对比三带；用户 Tab 切换到其他 agent 即清锁。
 *   - 自动（OPENCODE_ROUTER_AUTO=1）：仅首条消息（count=0）分类锚定 agent，
 *     第二条起恢复 build（消息级 agent 改写只对本回合生效，实证 2026-08-15）。
 *
 * 防御层：
 *   - 全 hook try/catch，fail-open（异常捕获记录，不破坏主链路）
 *   - 连续 3 次异常自我禁用（清空状态）并 console.error 可见
 *   - OPENCODE_ROUTER_ENABLED=0 总开关
 *   - 状态 Map<sessionID> 隔离，不跨会话
 *   - 版本金丝雀：探测 npm 全局 opencode-ai 版本，失配/探测失败默认禁用
 *   - OPENCODE_ROUTER_CRASH_TEST=1 崩溃注入（人为异常验证熔断，GUI 不崩）
 *
 * 配置（环境变量）：
 *   OPENCODE_ROUTER_ENABLED    —— 0 完全禁用（无需删文件）
 *   OPENCODE_ROUTER_AUTO       —— 1 启用首条消息自动路由（默认关闭，opt-in）
 *   OPENCODE_ROUTER_RESTORE_AGENT —— 自动路由后的恢复 agent，默认 build
 *   OPENCODE_ROUTER_ALLOW_VERSION —— 金丝雀强制放行的版本号（如升级后确认兼容）
 *   OPENCODE_ROUTER_CRASH_TEST —— 1 崩溃注入测试
 */

const PIN_VERSION = "1.18.18"
const DEFAULT_RESTORE_AGENT = "build"
const MAX_FAULTS = 3
const MODE_AGENTS = ["spec", "react", "weak"] as const
type Mode = (typeof MODE_AGENTS)[number]
type Lock = { mode: Mode; manual: boolean }

const HARD_DISABLED = process.env.OPENCODE_ROUTER_ENABLED === "0"
const AUTO = process.env.OPENCODE_ROUTER_AUTO === "1"
const CRASH_TEST = process.env.OPENCODE_ROUTER_CRASH_TEST === "1"
const RESTORE_AGENT = process.env.OPENCODE_ROUTER_RESTORE_AGENT?.trim() || DEFAULT_RESTORE_AGENT

// 会话级模式锁（Map 隔离，重启即清空）
const locks = new Map<string, Lock>()

let faultCount = 0
let selfDisabled = false

// 版本金丝雀状态
let versionDetected: string | null = null
let versionOk = false

async function detectVersion(): Promise<string | null> {
  try {
    const root = execSync("npm root -g", { encoding: "utf8", timeout: 5000 }).trim()
    if (!root) return null
    const pkg = JSON.parse(await readFile(join(root, "opencode-ai", "package.json"), "utf8"))
    return typeof pkg.version === "string" ? pkg.version : null
  } catch {
    return null
  }
}

function trip(where: string, err: unknown) {
  faultCount += 1
  console.error(`[routing-suite] ${where}:`, err)
  if (faultCount >= MAX_FAULTS) {
    selfDisabled = true
    locks.clear()
    console.error(
      `[routing-suite] 连续 ${MAX_FAULTS} 次异常，已自我禁用（恢复：删插件文件、检查 opencode 版本或重启）`,
    )
  }
}

// —— 分类器（移植 router-standard router-core.mjs classifyTask，三带量化） ——

const REACT_RE = /(开发|创建|写一个|生成|从零|做一个|游戏|网页|网站|构建|新项目|搭建|实现|做出|上线|落地|脚本|工具|应用|build|create|develop|generate|implement|make a|new project)/gi
const SPEC_RE = /(修复|修一下|调试|重构|维护|排查|报错|出错|崩溃|优化|审查|review|fix|debug|refactor|maintain|repair|broken|break|为什么|异常|故障|迁移|升级|兼容)/gi

function classifyTask(text: string): Mode | "weak" {
  const react = (text.match(REACT_RE) || []).length
  const spec = (text.match(SPEC_RE) || []).length
  if (react > spec) return "react"
  if (spec > react) return "spec"
  return "weak"
}

function extractUserText(output: any): string {
  const parts = output?.parts ?? output?.message?.parts
  if (Array.isArray(parts)) {
    return parts
      .map((p: any) => (p?.type === "text" && typeof p.text === "string" ? p.text : ""))
      .join("\n")
  }
  const text = output?.message?.info?.text
  return typeof text === "string" ? text : ""
}

function setAgent(output: any, name: string) {
  const msg = output?.message as { info?: { agent?: string }; agent?: string } | undefined
  if (msg?.info) msg.info.agent = name
  else if (msg?.agent) msg.agent = name
}

async function messageCount(client: any, sessionID: string): Promise<number | null> {
  try {
    const result = await client.session.messages({
      path: { id: sessionID },
      query: { limit: 10 },
    })
    return result.data?.length ?? 0
  } catch {
    return null
  }
}

export const RoutingSuitePlugin: Plugin = async ({ client }) => {
  if (HARD_DISABLED) {
    console.warn("[routing-suite] OPENCODE_ROUTER_ENABLED=0，插件已禁用")
    return {}
  }

  versionDetected = await detectVersion()
  const forced = process.env.OPENCODE_ROUTER_ALLOW_VERSION?.trim()
  versionOk =
    versionDetected === PIN_VERSION ||
    (forced !== undefined && (forced === "any" || forced === versionDetected))
  if (!versionOk) {
    console.warn(
      `[routing-suite] opencode 版本 ${versionDetected ?? "检测失败"} ≠ pin ${PIN_VERSION}，` +
        `已禁用（金丝雀）。确认兼容后可设 OPENCODE_ROUTER_ALLOW_VERSION=${versionDetected ?? "any"} 强制启用`,
    )
    return {}
  }

  return {
    "chat.message": async (input, output) => {
      if (selfDisabled) return
      try {
        if (CRASH_TEST) throw new Error("crash injection (OPENCODE_ROUTER_CRASH_TEST=1)")

        const sessionID = input.sessionID
        const lock = locks.get(sessionID)
        const agent = ((output?.message as { info?: { agent?: string } } | undefined)?.info?.agent ??
          (output?.message as { agent?: string } | undefined)?.agent) as string | undefined
        const count = await messageCount(client, sessionID)
        if (count === null) return // 查询失败 → 不干预（宁可错过路由，不破坏消息）

        // 手动锁：持续生效；用户 Tab 切到其他 agent → 清锁（尊重用户）
        if (lock?.manual) {
          if (count > 0 && agent && agent !== lock.mode) {
            locks.delete(sessionID)
            console.debug(`[routing-suite] session ${sessionID} 用户切换 agent=${agent}，清除模式锁`)
            return
          }
          setAgent(output, lock.mode)
          return
        }

        // 自动路由（opt-in）：仅首条消息；用户已手动选择 agent 则不干预
        if (!AUTO) return
        if (count !== 0) return
        if (agent && agent !== "build") return

        const cls = classifyTask(extractUserText(output))
        if (cls === "weak") {
          // 低置信（平局）：V1 无用户询问通道，交给 weak 内部自路由（router-core 语义）
          console.warn(
            `[routing-suite] session ${sessionID} 分类器低置信（weak），按内部路由处理；` +
              `可用 dev_router_mode 手动锁定，或 Tab 切换 agent`,
          )
          setAgent(output, "weak")
          return
        }
        console.log(`[routing-suite] session ${sessionID} 首条消息分类=${cls}，锚定 agent，后续恢复 ${RESTORE_AGENT}`)
        setAgent(output, cls)
      } catch (err) {
        trip("chat.message", err)
      }
    },

    tool: {
      dev_router_status: tool({
        description:
          "显示 dsh-routing-suite 路由状态：插件启用状态、opencode 版本金丝雀、自动路由开关、本会话模式锁、熔断状态。只读，无副作用。",
        args: {},
        async execute(_args, ctx) {
          const lock = locks.get(ctx.sessionID)
          return {
            title: "routing-suite 状态",
            output: [
              `插件: ${selfDisabled ? "已自我禁用（熔断 " + faultCount + "/" + MAX_FAULTS + "）" : "启用"}`,
              `版本金丝雀: ${versionOk ? `pin ${PIN_VERSION} ✓` : `检测 ${versionDetected ?? "失败"}，插件已禁用（金丝雀）`}`,
              `自动路由: ${AUTO ? "ON (OPENCODE_ROUTER_AUTO=1)" : "off（默认 opt-in，未开启）"}`,
              `分类器: ${AUTO ? "启用（关键词计数三带）" : "off（自动路由关闭）"}`,
              `本会话 agent: ${ctx.agent}`,
              `本会话模式锁: ${lock ? `${lock.mode}${lock.manual ? "（手动，持续生效）" : ""}` : "auto（未锁）"}`,
              `熔断: ${faultCount}/3${selfDisabled ? " — 已禁用" : ""}`,
            ].join("\n"),
          }
        },
      }),

      dev_router_mode: tool({
        description:
          "手动锁/解锁本会话推理模式。spec=计划型（read-first 工具面，写需确认）；react=执行型（doer，全工具）；weak=弱模式（窄面四工具）；auto=解锁恢复自动路由。手动锁持续生效，Tab 切换其他 agent 即自动解锁。",
        args: { mode: z.enum(["spec", "react", "weak", "auto"]) },
        async execute(args, ctx) {
          if (args.mode === "auto") {
            locks.delete(ctx.sessionID)
            return `已解锁本会话（当前 agent: ${ctx.agent}）。自动路由 ${AUTO ? "开启中" : "未开启（OPENCODE_ROUTER_AUTO 未设）"}。`
          }
          locks.set(ctx.sessionID, { mode: args.mode, manual: true })
          return `已锁定 ${args.mode} 模式（手动）。下一条消息将按 ${args.mode} agent 处理（首轮窄面锚定轨迹）；Tab 切换到其他 agent 或再次调用本工具选 auto 即解锁。`
        },
      }),
    },
  }
}
