import { tool, type Plugin } from "@opencode-ai/plugin"
import { z } from "zod"
import { execSync } from "node:child_process"
import { readFile } from "node:fs/promises"
import { join } from "node:path"

/**
 * routing-suite —— dsh-routing-suite 的 opencode 实现（V1 API，pin 1.18.18）。
 *
 * 双层架构（v0.2.0 重构，D2 计划书 §4）：
 *   1. chat.message 分流：首条消息（count==0）→ CHAT_RE 寒暄检测（命中→
 *      band=none 不干预）→ classifyTask 三带 → 锚定 agent=spec + 写 pending；
 *      手动锁每轮改 agent + 写 pending；用户 Tab 切非锁 agent → 清锁。
 *   2. transform 注入（experimental.chat.system.transform）：读 pending →
 *      band=standard 替换 system[0] 为 RL 句+精简安全指令；band=spec/react/weak
 *      尾部追加 persona（spec 幂等：system 已含 SPEC_PERSONA 则跳过）；title
 *      生成跳过（不消费 pending）；无 pending 不动 system（恢复 build 后自然完整）。
 *
 * 三带（router-standard 实测）：spec [0,0.15] 稳定 / transition 带回避 /
 * react [0.5,1] 稳定；mixed 永不输出。分类器移植 mode-boost classifyTask
 * （扩展版正则，含寒暄检测 isChatTask）：react 关键词胜 → react；spec 胜 →
 * spec；平局 → weak（模型内部自路由）。
 *
 * 手动锁 vs 自动：
 *   - 手动锁（dev_router_mode spec|react|weak|standard）：持续生效，每条消息
 *     按锁模式处理（persona 锁→agent=spec；RL 锁→agent=standard）；用户 Tab
 *     切换到非锁对应 agent 即清锁。
 *   - 自动（OPENCODE_ROUTER_AUTO=1）：仅首条消息（count=0）分类锚定 agent=spec，
 *     第二条起恢复 build（消息级 agent 改写只对本回合生效，实证 2026-08-15）。
 *
 * 防御层：
 *   - 全 hook try/catch，fail-open（异常捕获记录，不破坏主链路）
 *   - 连续 3 次异常自我禁用（清空状态）并 console.error 可见
 *   - OPENCODE_ROUTER_ENABLED=0 总开关
 *   - 状态 Map<sessionID> 隔离，不跨会话
 *   - 版本金丝雀：探测 npm 全局 opencode-ai 版本，失配/探测失败默认禁用
 *   - OPENCODE_ROUTER_CRASH_TEST=1 崩溃注入（chat.message 与 transform 双点，
 *     人为异常验证熔断，GUI 不崩）
 *
 * 配置（环境变量）：
 *   OPENCODE_ROUTER_ENABLED    —— 0 完全禁用（无需删文件）
 *   OPENCODE_ROUTER_AUTO       —— 1 启用首条消息自动路由（默认关闭，opt-in）
 *   OPENCODE_ROUTER_RESTORE_AGENT —— 历史兼容保留：agent 改写仅本回合生效，
 *     恢复 build 自动发生，本变量已无实际作用（预研实测，不删）
 *   OPENCODE_ROUTER_ALLOW_VERSION —— 金丝雀强制放行的版本号（如升级后确认兼容）
 *   OPENCODE_ROUTER_CRASH_TEST —— 1 崩溃注入测试
 */

const PIN_VERSION = "1.18.18"
const DEFAULT_RESTORE_AGENT = "build"
const MAX_FAULTS = 3

const HARD_DISABLED = process.env.OPENCODE_ROUTER_ENABLED === "0"
const AUTO = process.env.OPENCODE_ROUTER_AUTO === "1"
const CRASH_TEST = process.env.OPENCODE_ROUTER_CRASH_TEST === "1"
// 历史兼容：agent 改写仅本回合生效，恢复 build 自动发生，本变量已无实际作用（§3.6）
const RESTORE_AGENT = process.env.OPENCODE_ROUTER_RESTORE_AGENT?.trim() || DEFAULT_RESTORE_AGENT

// —— 注入文本常量（D2 计划书 §2，T0 核对 14/14 与上游逐字一致，禁止"顺手优化"） ——

const SPEC_PERSONA = "You are a helpful software engineer assistant."

const REACT_PERSONA =
  "You are a hands-on software engineer who delivers working output fast.\n" +
  "Work directly: write or edit code, then verify it by reading and running. " +
  "Keep the loop tight — produce, verify, fix — and do not build test " +
  "harnesses, scaffolding, or ceremony the user did not ask for. " +
  "Finish with a usable deliverable and a short summary."

const WEAK_FLASH =
  "You are a helpful assistant.\n" +
  "Before acting, decide the task type (build or fix) and adopt the matching " +
  "style: build → hands-on production; fix → inspect-and-plan.\n" +
  "Before acting, briefly review what you have already done in this session and continue from where you left off; do not repeat completed steps. Do not run environment checks (echo, whoami, uname, node --version, date) or exhaustive grep/glob scans.\n" +
  "Think deeply first, then produce."

// 精简安全指令（D2 拟定，非上游原文；RL 全剥后注入的安全底线，联调可微调需同步 requirements）
const SAFETY_RULES =
  "Safety: before destructive operations (delete, recursive delete, format), " +
  "verify reversibility and the exact path — prefer reversible actions; never touch drive roots, " +
  "system directories, or the home root without explicit confirmation. " +
  "If a command is blocked by permissions, ask the user to run it manually; do not silently skip or bypass. " +
  "Never expose or commit secrets or keys."

const RL_SAFETY = SPEC_PERSONA + "\n" + SAFETY_RULES

// —— 分类器（mode-boost 扩展版，§2.5/2.6/2.7） ——

const CHAT_RE =
  /^(你好|您好|hello|hi|hey|嗨|哈喽|在吗|谢谢|感谢|thanks|thank you|早上好|下午好|晚上好|嗯|好|ok|okay|yes|no|嗯嗯|好的)[!。.!？?~～]*$/i
const REACT_RE =
  /(开发|创建|写一个|写|生成|从零|做|做一个|做个|游戏|网页|网站|构建|新项目|搭建|实现|做出|上线|落地|脚本|工具|应用|build|create|develop|generate|implement|write a|write an|build a|make a|new project)/gi
const SPEC_RE =
  /(修复|修一下|调试|重构|维护|排查|报错|出错|崩溃|优化|审查|review|fix|debug|refactor|maintain|repair|broken|break|为什么|异常|故障|迁移|升级|兼容)/gi

/** 寒暄/空消息/短句无关键词 → true（会话让位，不路由） */
function isChatTask(text: unknown): boolean {
  if (typeof text !== "string") return true
  const t = text.trim()
  if (t.length === 0) return true
  if (CHAT_RE.test(t)) return true
  if (t.length > 24) return false
  return !t.match(REACT_RE) && !t.match(SPEC_RE) // 短消息无任务关键词 → 寒暄
}

// —— 会话状态模型（契约 3.2/3.3，唯一事实源） ——

type Band = "spec" | "react" | "weak" | "standard" | "none"
type TaskBand = Extract<Band, "spec" | "react" | "weak">

type SessionState = {
  band?: Band // routing.band：首条分类结果（手动锁=锁模式）
  handled?: boolean // routing.handled：首条已处理标志
  persona?: string // routing.persona：锁定 persona 全文
  pending?: boolean // routing.pending：待注入标记（chat.message 写 / transform 读+清）
  manual?: boolean // 手动锁标志
  lockMode?: Band // 手动锁模式（spec/react/weak/standard）
}

const states = new Map<string, SessionState>() // 进程内，会话隔离，重启清空

/** persona 锁统一锚 spec；RL 锁锚 standard */
const lockAgent = (m: Band): string => (m === "standard" ? "standard" : "spec")

// —— 熔断与金丝雀 ——

let faultCount = 0
let selfDisabled = false

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
    states.clear()
    console.error(
      `[routing-suite] 连续 ${MAX_FAULTS} 次异常，已自我禁用（恢复：删插件文件、检查 opencode 版本或重启）`,
    )
  }
}

/** 三带量化分类：react>spec→react；spec>react→spec；平局→weak */
function classifyTask(text: string): TaskBand {
  const react = (text.match(REACT_RE) || []).length
  const spec = (text.match(SPEC_RE) || []).length
  if (react > spec) return "react"
  if (spec > react) return "spec"
  return "weak"
}

const PERSONA_BY_BAND: Record<TaskBand, string> = {
  spec: SPEC_PERSONA,
  react: REACT_PERSONA,
  weak: WEAK_FLASH,
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
        const state = states.get(sessionID)
        const agent = ((output?.message as { info?: { agent?: string } } | undefined)?.info?.agent ??
          (output?.message as { agent?: string } | undefined)?.agent) as string | undefined
        const count = await messageCount(client, sessionID)
        if (count === null) return // 查询失败 → 不干预（宁可错过路由，不破坏消息）

        // A. 手动锁：每轮改 agent + 写 pending；用户 Tab 切非锁对应 agent → 清锁（尊重用户）
        // 注意：build 回落不触发清锁（CLI 多轮中消息级 agent 改写只对本回合生效，agent 每轮
        // 回落 build——计划书伪码的补充：build 视为系统回落而非用户切换，TUI 中 Tab 到其他
        // 非锁 agent（非 build）仍清锁）
        if (state?.manual) {
          if (count > 0 && agent && agent !== "build" && agent !== lockAgent(state.lockMode ?? "spec")) {
            states.delete(sessionID)
            console.debug(
              `[routing-suite] session ${sessionID} 用户切换 agent=${agent}，清除模式锁`,
            )
            return
          }
          setAgent(output, lockAgent(state.lockMode ?? "spec"))
          // band 跟随锁模式：transform 按 band 注入（T6 验收：锁后 status 显示 band=锁模式）
          states.set(sessionID, { ...state, band: state.lockMode, pending: true })
          console.debug(
            `[routing-suite] session ${sessionID} 手动锁 ${state.lockMode} 生效，agent=${lockAgent(state.lockMode ?? "spec")}，写 pending`,
          )
          return
        }

        // B. 自动路由（opt-in，AUTO=1）仅首条；非首条 → return（无 pending 时 transform 不动 system）
        if (!AUTO) return
        if (count !== 0) return
        if (agent && agent !== "build") return // 用户已手动选 agent 不干预

        const text = extractUserText(output)

        // B1. 寒暄让位（契约 3.2 band=none）
        if (isChatTask(text)) {
          states.set(sessionID, { band: "none", handled: true }) // 不写 pending、不改 agent
          console.log(`[routing-suite] session ${sessionID} 寒暄命中，band=none，不路由`)
          return
        }

        // B2. 三带分类 → 锚定 spec + 写 pending（自动路由=仅首条写 pending）
        const cls = classifyTask(text)
        states.set(sessionID, {
          band: cls,
          persona: PERSONA_BY_BAND[cls],
          handled: true,
          pending: true,
        })
        setAgent(output, "spec")
        console.log(
          `[routing-suite] session ${sessionID} 首条消息分类=${cls}，锚定 agent=spec，待注入 persona`,
        )
      } catch (err) {
        trip("chat.message", err)
      }
    },

    "experimental.chat.system.transform": async (input, output) => {
      if (selfDisabled) return
      try {
        if (CRASH_TEST) throw new Error("crash injection (transform, OPENCODE_ROUTER_CRASH_TEST=1)")

        const sessionID = input.sessionID
        if (!sessionID) return
        const sys = output.system?.[0]
        if (!sys) return

        // title 生成跳过（同 sessionID 触发，内容判断）——不读不消费 pending（宁延迟不丢失）
        if (sys.startsWith("You are a title generator")) {
          console.debug(`[routing-suite] session ${sessionID} transform 跳过（title 生成，不消费 pending）`)
          return
        }

        const state = states.get(sessionID)
        if (!state?.pending || !state.band) {
          console.debug(`[routing-suite] session ${sessionID} transform 跳过（无 pending，system 自然完整）`)
          return
        }

        const band = state.band
        if (band === "standard") {
          output.system[0] = RL_SAFETY // 整体替换：RL 句 + 精简安全指令
          console.log(`[routing-suite] session ${sessionID} transform 注入 band=standard（RL 句+安全指令）`)
        } else if (band === "spec" && !sys.includes(SPEC_PERSONA)) {
          output.system[0] = sys + "\n\n" + SPEC_PERSONA // 幂等兜底（spec.md 已含则跳过）
          console.log(`[routing-suite] session ${sessionID} transform 注入 band=spec（幂等兜底）`)
        } else if (band === "react") {
          output.system[0] = sys + "\n\n" + REACT_PERSONA // 完整 system 保留 + persona 尾附
          console.log(`[routing-suite] session ${sessionID} transform 注入 band=react`)
        } else if (band === "weak") {
          output.system[0] = sys + "\n\n" + WEAK_FLASH
          console.log(`[routing-suite] session ${sessionID} transform 注入 band=weak`)
        } else if (band === "spec") {
          // 幂等：system 已含 SPEC_PERSONA（spec.md 兜底提供），跳过追加（§3.2）
          console.debug(
            `[routing-suite] session ${sessionID} transform 跳过（spec 已含 SPEC_PERSONA，幂等）`,
          )
        } else {
          console.debug(`[routing-suite] session ${sessionID} transform 跳过（band=none）`)
        }
        state.pending = false // 消费标记；缓存中性（不改 message/不写 cache）
      } catch (err) {
        trip("experimental.chat.system.transform", err)
      }
    },

    tool: {
      dev_router_status: tool({
        description:
          "显示 dsh-routing-suite 路由状态：插件启用状态、opencode 版本金丝雀、自动路由开关、本会话 band/persona/pending、模式锁、熔断状态。只读，无副作用。",
        args: {},
        async execute(_args, ctx) {
          const s = states.get(ctx.sessionID)
          const personaLabel =
            s?.band === "standard" ? "RL+SAFETY" : s?.band === "none" ? "none" : s?.band ? s.band.toUpperCase() : "none"
          return {
            title: "routing-suite 状态",
            output: [
              `插件: ${selfDisabled ? "已自我禁用（熔断 " + faultCount + "/" + MAX_FAULTS + "）" : "启用"}`,
              `版本金丝雀: ${versionOk ? `pin ${PIN_VERSION} ✓` : `检测 ${versionDetected ?? "失败"}，插件已禁用（金丝雀）`}`,
              `自动路由: ${AUTO ? "ON (OPENCODE_ROUTER_AUTO=1)" : "off（默认 opt-in，未开启）"}`,
              `分类器: ${AUTO ? "启用（关键词计数三带）" : "off（自动路由关闭）"}`,
              `本会话 band: ${s?.band ?? "未分类"}`,
              `本会话 persona: ${personaLabel}`,
              `注入 pending: ${s?.pending ?? false}`,
              `本会话 agent: ${ctx.agent}`,
              `本会话模式锁: ${s?.manual ? `${s.lockMode}（手动，持续生效）` : "auto（未锁）"}`,
              `熔断: ${faultCount}/3${selfDisabled ? " — 已禁用" : ""}`,
            ].join("\n"),
          }
        },
      }),

      dev_router_mode: tool({
        description:
          "手动锁/解锁本会话推理模式。spec=计划型（read-first 工具面，写需确认）；react=执行型（doer，全工具）；weak=弱模式（窄面四工具）；standard=RL 模式（system 替换为 RL 句+精简安全指令）；auto=解锁恢复自动路由。手动锁持续生效，Tab 切换其他 agent 即自动解锁。",
        args: { mode: z.enum(["spec", "react", "weak", "standard", "auto"]) },
        async execute(args, ctx) {
          if (args.mode === "auto") {
            states.delete(ctx.sessionID)
            return `已解锁本会话（当前 agent: ${ctx.agent}）。自动路由 ${AUTO ? "开启中" : "未开启（OPENCODE_ROUTER_AUTO 未设）"}。`
          }
          states.set(ctx.sessionID, { band: args.mode, manual: true, lockMode: args.mode })
          const effect =
            args.mode === "standard"
              ? "system 替换为 RL 句+精简安全指令"
              : `${args.mode} persona 尾附`
          return `已锁定 ${args.mode} 模式（手动）。下一条消息起按 ${args.mode} 处理（${effect}）；Tab 切换到其他 agent 或再次调用本工具选 auto 即解锁。`
        },
      }),
    },
  }
}
