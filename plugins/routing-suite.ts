import { tool, type Plugin } from "@opencode-ai/plugin"
import { z } from "zod"
import { execSync } from "node:child_process"
import { readFile } from "node:fs/promises"
import { join } from "node:path"

/**
 * routing-suite v0.3.0 — dsh-router-standard @9727510 的 opencode 实现。
 *
 * 基线：组件仓库 dsh-router-standard origin/main = 9727510（2026-08-18，
 * "v0.1.1 restore"：放弃 RL 接口还原，统一行为链）。
 *
 * 行为链（9727510 语义）：
 *   1. chat.message：首条分类（三带 + weak，寒暄让位）→ 锚定 agent=spec；
 *      手动锁每轮改 agent；Tab 切非锁 agent 清锁。
 *   2. system.transform（每轮幂等）：读 state.band → personaFor(band, model) →
 *      幂等尾附（已含 persona 则跳过）；spec 幂等兜底（spec.md 已含则跳过）。
 *   3. 近场引导（messages.transform，每轮弱带尾插 user 引导，OPENCODE_ROUTER_GUIDE=1）。
 *   4. dev_mode_subagent（opencode run 子进程，独立会话执行）。
 *
 * v0.3.0 相对 v0.2.0 的变化：
 *   - 删除：standard/RL 线（SAFETY_RULES/RL_SAFETY/standard band）。
 *   - 新增：personaFor 模型分支（Pro→WEAK_PRO / Flash→WEAK_FLASH）。
 *   - 新增：parseMode 数字接口（0-100/0.0-1.0/band 名/mixed）。
 *   - 新增：OPENCODE_ROUTER_WEAK_ANCHOR 回退开关（恢复旧 WEAK_FLASH 锚）。
 *   - 变更：每轮幂等注入（去掉 pending 机制，检查 system 是否已含 persona）。
 *   - 变更：WEAK_FLASH 按 9727510 更新（去 "Think deeply first, then produce."）。
 *
 * 配置（环境变量）：
 *   OPENCODE_ROUTER_ENABLED       —— 0 完全禁用
 *   OPENCODE_ROUTER_AUTO          —— 1 启用首条消息自动路由（默认 off）
 *   OPENCODE_ROUTER_ALLOW_VERSION —— 金丝雀强制放行
 *   OPENCODE_ROUTER_CRASH_TEST    —— 1 崩溃注入测试
 *   OPENCODE_ROUTER_WEAK_ANCHOR   —— 1 恢复旧 WEAK_FLASH 锚行（P23 回退开关）
 *   OPENCODE_ROUTER_GUIDE         —— 1 启用近场引导（默认 off）
 */

// ═══════════════════════════════════════════════════════════════════════
// 核心层（与平台无关，纯函数，可单测）
// V2 兼容性：核心层零 opencode import，V2 迁移仅需重写下方适配层 hook
// ═══════════════════════════════════════════════════════════════════════

// ── 注入文本常量（禁止凭记忆改写，以上游 dsh-router-standard @9727510 为准） ──

const SPEC_PERSONA = "You are a helpful software engineer assistant."

const REACT_PERSONA =
  "You are a hands-on software engineer who delivers working output fast.\n" +
  "Work directly: write or edit code, then verify it by reading and running. " +
  "Keep the loop tight — produce, verify, fix — and do not build test " +
  "harnesses, scaffolding, or ceremony the user did not ask for. " +
  "Finish with a usable deliverable and a short summary."

/** WEAK_PRO：Pro 模型最优弱 persona（w6c，无锚，P24 100% 路由） */
const WEAK_PRO =
  "You are a helpful software engineer assistant.\n" +
  "Before acting, decide the task type (build or fix) and adopt the matching " +
  "style: build → hands-on production; fix → inspect-and-plan."

/** WEAK_FLASH：Flash 模型最优弱 persona（w7，+recall/anti-runaway 锚，P23 100% 单任务完成） */
const WEAK_FLASH =
  "You are a helpful assistant.\n" +
  "Before acting, decide the task type (build or fix) and adopt the matching " +
  "style: build → hands-on production; fix → inspect-and-plan.\n" +
  "Before acting, briefly review what you have already done in this session and continue from where you left off; do not repeat completed steps. Do not run environment checks (echo, whoami, uname, node --version, date) or exhaustive grep/glob scans."

/** 回退开关：旧 WEAK_FLASH 含 deep-first 锚（v0.2.0 行为） */
const WEAK_FLASH_ANCHORED = WEAK_FLASH + "\nThink deeply first, then produce."

// ── 分类器（mode-boost 扩展版正则） ──

const CHAT_RE =
  /^(你好|您好|hello|hi|hey|嗨|哈喽|在吗|谢谢|感谢|thanks|thank you|早上好|下午好|晚上好|嗯|好|ok|okay|yes|no|嗯嗯|好的)[!。.!？?~～]*$/i
const REACT_RE =
  /(开发|创建|写一个|写|生成|从零|做|做一个|做个|游戏|网页|网站|构建|新项目|搭建|实现|做出|上线|落地|脚本|工具|应用|build|create|develop|generate|implement|write a|write an|build a|make a|new project)/gi
const SPEC_RE =
  /(修复|修一下|调试|重构|维护|排查|报错|出错|崩溃|优化|审查|review|fix|debug|refactor|maintain|repair|broken|break|为什么|异常|故障|迁移|升级|兼容)/gi
const COMPLEX_RE =
  /(重构|架构|全面|详细|设计|系统|优化|分析|survey|overview|architecture|refactor|comprehensive|detailed|design|system|optimize|analyze)/i

function countHits(regex: RegExp, text: string): number {
  return [...text.matchAll(regex)].length
}

/** 三带量化分类：react>spec→react；spec>react→spec；平局→weak */
function classifyTask(text: string): TaskBand {
  const react = countHits(REACT_RE, text)
  const spec = countHits(SPEC_RE, text)
  if (react > spec) return "react"
  if (spec > react) return "spec"
  return "weak"
}

/** 寒暄/空消息/短句无关键词 → true（会话让位，不路由） */
function isChatTask(text: unknown): boolean {
  if (typeof text !== "string") return true
  const t = text.trim()
  if (t.length === 0) return true
  if (CHAT_RE.test(t)) return true
  if (t.length > 24) return false
  return !t.match(REACT_RE) && !t.match(SPEC_RE)
}

/** 判断模型是否 Flash 系列（大小写不敏感） */
function isFlashModel(modelId: unknown): boolean {
  return typeof modelId === "string" && /flash/i.test(modelId)
}

/** 深度自适应：长消息或含架构关键词 → 复杂任务 */
function isComplexTask(text: unknown): boolean {
  return typeof text === "string" && (text.length > 120 || COMPLEX_RE.test(text))
}

// ── persona 按模型选择（9727510 核心机制） ──

const WEAK_ANCHOR = process.env.OPENCODE_ROUTER_WEAK_ANCHOR === "1"

function personaFor(band: string, modelId: unknown): string {
  switch (band) {
    case "spec": return SPEC_PERSONA
    case "react": return REACT_PERSONA
    case "weak":
      if (isFlashModel(modelId)) {
        return WEAK_ANCHOR ? WEAK_FLASH_ANCHORED : WEAK_FLASH
      }
      return WEAK_PRO
    default: return SPEC_PERSONA
  }
}

// ── 数字模式解析（parseMode，量化三带） ──

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v))
}

function parseMode(token: string | null | undefined): number | string | null {
  if (token === undefined || token === null) return null
  const t = token.trim().toLowerCase()
  if (t === "auto") return "auto"
  if (t === "weak" || t === "router") return "weak"
  if (t === "spec" || t === "spec-lean") return 0
  if (t === "balanced" || t === "mixed") return 0.3
  if (t === "react" || t === "react-lean") return 1
  const n = Number(t)
  if (!Number.isFinite(n)) return null
  if (t.includes(".")) return clamp01(n)
  return clamp01(n / 100)
}

function bandOf(mode: number | string): string {
  if (mode === "weak") return "weak"
  const m = typeof mode === "number" ? clamp01(mode) : 0.5
  if (m < 0.2) return "spec"
  if (m < 0.5) return "mixed"
  return "react"
}

function bandFor(mode: number | string): string {
  const b = bandOf(mode)
  return b === "mixed" ? "mixed" : b
}

function fmtMode(mode: number | string): string {
  return typeof mode === "string" ? mode : mode.toFixed(2)
}

// ── 近场引导文本（9727510，OPENCODE_ROUTER_GUIDE=1 启用） ──

const GUIDE_WEAK =
  "\nRouter: classify this task (build or fix) now, then adopt the matching style — build: direct production; fix: inspect-first. Think deeply first, then commit and act."

const GUIDE_DEEP =
  "\nRouter: classify this task (build or fix) now, then adopt the matching style — build: direct production; fix: inspect-first. Think deeply about the architecture, edge cases, and integration points. Do not spend reasoning on the environment or tooling. Produce when your information is complete. End each reasoning block with a decision or an information need."

// ═══════════════════════════════════════════════════════════════════════
// V1 适配层（hook 注册，opencode 1.18.18）
// V2 迁移映射：chat.message→session.hook("context") / system.transform→event.system /
// messages.transform→event.messages / tool→tool.transform
// ═══════════════════════════════════════════════════════════════════════

const PIN_VERSION = "1.18.18"
const MAX_FAULTS = 3

const HARD_DISABLED = process.env.OPENCODE_ROUTER_ENABLED === "0"
const AUTO = process.env.OPENCODE_ROUTER_AUTO === "1"
const CRASH_TEST = process.env.OPENCODE_ROUTER_CRASH_TEST === "1"
const GUIDE_ENABLED = process.env.OPENCODE_ROUTER_GUIDE === "1"

type Band = "spec" | "react" | "weak" | "none"
type TaskBand = "spec" | "react" | "weak"

type SessionState = {
  band?: Band
  handled?: boolean
  manual?: boolean
  lockMode?: Band
  lastGuidedMsgID?: string // 近场引导去重：追踪已注入的用户消息 ID
}

const states = new Map<string, SessionState>()

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
    // ── chat.message：分类 + 锚定 + 手动锁 ──
    "chat.message": async (input, output) => {
      if (selfDisabled) return
      try {
        if (CRASH_TEST) throw new Error("crash injection (OPENCODE_ROUTER_CRASH_TEST=1)")

        const sessionID = input.sessionID
        const state = states.get(sessionID)
        const agent = ((output?.message as { info?: { agent?: string } } | undefined)?.info?.agent ??
          (output?.message as { agent?: string } | undefined)?.agent) as string | undefined
        const count = await messageCount(client, sessionID)
        if (count === null) return

        // A. 手动锁：每轮改 agent；Tab 切非锁 agent → 清锁
        if (state?.manual) {
          if (count > 0 && agent && agent !== "build" && agent !== "spec") {
            states.delete(sessionID)
            console.debug(`[routing-suite] session ${sessionID} 用户切换 agent=${agent}，清除模式锁`)
            return
          }
          setAgent(output, "spec")
          states.set(sessionID, { ...state, band: state.lockMode })
          console.debug(`[routing-suite] session ${sessionID} 手动锁 ${state.lockMode} 生效`)
          return
        }

        // B. 自动路由（opt-in）仅首条
        if (!AUTO) return
        if (count !== 0) return
        if (agent && agent !== "build") return

        const text = extractUserText(output)

        if (isChatTask(text)) {
          states.set(sessionID, { band: "none", handled: true })
          console.log(`[routing-suite] session ${sessionID} 寒暄命中，band=none`)
          return
        }

        const cls = classifyTask(text)
        states.set(sessionID, { band: cls, handled: true })
        setAgent(output, "spec")
        console.log(`[routing-suite] session ${sessionID} 首条分类=${cls}，锚定 agent=spec`)
      } catch (err) {
        trip("chat.message", err)
      }
    },

    // ── system.transform：每轮幂等注入 persona ──
    "experimental.chat.system.transform": async (input, output) => {
      if (selfDisabled) return
      try {
        if (CRASH_TEST) throw new Error("crash injection (transform)")

        const sessionID = input.sessionID
        if (!sessionID) return
        const sys = output.system?.[0]
        if (!sys) return

        if (sys.startsWith("You are a title generator")) return

        const state = states.get(sessionID)
        const band = state?.band
        if (!band || band === "none") return

        const modelId = (input as any).model?.id ?? (input as any).model
        const persona = personaFor(band, modelId)

        // 幂等：已含 persona 则跳过
        if (sys.includes(persona)) {
          console.debug(`[routing-suite] session ${sessionID} transform 跳过（已含 persona）`)
          return
        }

        output.system[0] = sys + "\n\n" + persona
        console.log(`[routing-suite] session ${sessionID} transform 注入 band=${band}`)
      } catch (err) {
        trip("experimental.chat.system.transform", err)
      }
    },

    // ── messages.transform：近场引导（weak 带，深度自适应） ──
    // 每请求触发，output.messages 有完整 info（含 sessionID）。
    // 追踪 lastGuidedMsgID 防重复：工具循环中同一用户消息触发多次 transform，
    // 只在首次注入 guide；guide 不持久化到会话历史（仅当次请求可见）。
    "experimental.chat.messages.transform": async (_input, output) => {
      if (selfDisabled) return
      if (!GUIDE_ENABLED) return // OPENCODE_ROUTER_GUIDE=1 才启用近场引导
      try {
        if (CRASH_TEST) throw new Error("crash injection (messages.transform)")

        // 找最后一条真实用户消息（非 guide 消息）
        const msgs = output?.messages
        if (!msgs || msgs.length === 0) return
        const lastUserMsg = [...msgs].reverse().find(
          (m: any) => m?.info?.role === "user" && !m?.info?.id?.startsWith("guide-"),
        )
        if (!lastUserMsg) return

        const sessionID = lastUserMsg.info?.sessionID
        if (!sessionID) return
        const state = states.get(sessionID)
        if (!state?.band || state.band === "none") return
        if (state.band !== "weak") return // 近场引导仅 weak 带

        const msgID = lastUserMsg.info.id
        if (state.lastGuidedMsgID === msgID) return // 去重：已注入

        // 提取用户文本
        const userText = (lastUserMsg.parts ?? [])
          .map((p: any) => (p?.type === "text" ? p.text : ""))
          .join("\n")
        if (!userText.trim()) return

        const guide = isComplexTask(userText) ? GUIDE_DEEP : GUIDE_WEAK

        // 尾插 user 角色引导消息
        msgs.push({
          info: {
            role: "user",
            id: `guide-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            sessionID,
            time: { created: Date.now() },
          } as any,
          parts: [{ type: "text", text: guide }] as any,
        })

        state.lastGuidedMsgID = msgID
        console.debug(`[routing-suite] session ${sessionID} 近场引导注入（${isComplexTask(userText) ? "DEEP" : "WEAK"}）`)
      } catch (err) {
        trip("experimental.chat.messages.transform", err)
      }
    },

    // ── 自定义工具 ──
    tool: {
      dev_router_status: tool({
        description:
          "显示 routing-suite v0.3.0 路由状态：插件启用、版本金丝雀、自动路由、本会话 band/model、模式锁、熔断。只读。",
        args: {},
        async execute(_args, ctx) {
          const s = states.get(ctx.sessionID)
          return {
            title: "routing-suite v0.3.0 状态",
            output: [
              `插件: ${selfDisabled ? "已禁用（熔断 " + faultCount + "/" + MAX_FAULTS + "）" : "启用"}`,
              `版本: v0.3.0（基线9727510）`,
              `金丝雀: ${versionOk ? `pin ${PIN_VERSION} ✓` : `检测 ${versionDetected ?? "失败"}，禁用`}`,
              `自动路由: ${AUTO ? "ON" : "off"}`,
              `本会话 band: ${s?.band ?? "未分类"}`,
              `本会话 agent: ${ctx.agent}`,
              `模式锁: ${s?.manual ? `${s.lockMode}（手动）` : "auto"}`,
              `WEAK_ANCHOR: ${WEAK_ANCHOR ? "ON（旧锚恢复）" : "off"}`,
              `GUIDE: ${GUIDE_ENABLED ? "ON" : "off（OPENCODE_ROUTER_GUIDE=1 启用）"}`,
              `熔断: ${faultCount}/${MAX_FAULTS}`,
            ].join("\n"),
          }
        },
      }),

      dev_router_mode: tool({
        description:
          "手动锁/解锁推理模式。spec=计划型；react=执行型；weak=弱模式（按模型选WEAK_PRO/WEAK_FLASH）；auto=解锁。接受 band 名、0-100、0.0-1.0、mixed。",
        args: { mode: z.string().describe("spec/react/weak/auto 或 0-100 或 0.0-1.0 或 mixed") },
        async execute(args, ctx) {
          const parsed = parseMode(args.mode)
          if (parsed === null) return `无效模式 "${args.mode}"：使用 spec/react/weak/auto、0-100、0.0-1.0、mixed`
          if (parsed === "auto") {
            states.delete(ctx.sessionID)
            return `已解锁（agent: ${ctx.agent}）。自动路由 ${AUTO ? "开启" : "未开启"}。`
          }
          const band: Band = typeof parsed === "string" ? parsed as Band : bandOf(parsed) as Band
          states.set(ctx.sessionID, { band, manual: true, lockMode: band })
          return `已锁定 ${band} 模式。Tab 切其他 agent 或再次调用选 auto 即解锁。`
        },
      }),

      // ── dev_mode_subagent：opencode run 子进程，模式隔离上下文 ──
      // opencode run 加载插件、无递归、agent 覆盖可行。
      // 注意：子进程独立会话，插件会自动分类任务并注入匹配 persona。
      dev_mode_subagent: tool({
        description:
          "在独立会话中执行任务（模式隔离）。子进程加载插件后自动分类任务并注入匹配 persona。返回执行结果文本。",
        args: {
          mode: z.string().describe("目标模式 spec/react/weak（仅记录，实际由子进程分类器决定）"),
          task: z.string().describe("交给子代理的任务"),
          maxTokens: z.number().optional().describe("输出上限（默认 1024，暂未限制）"),
        },
        async execute(args) {
          const parsed = parseMode(args.mode)
          if (parsed === null || parsed === "auto") return `无效模式 "${args.mode}"`
          const band = typeof parsed === "string" ? parsed : bandFor(parsed)

          try {
            const result = execSync(
              `opencode run --agent spec ${JSON.stringify(String(args.task))}`,
              { encoding: "utf8", timeout: 60000, stdio: ["pipe", "pipe", "pipe"] },
            )
            const head = result.slice(0, 3000)
            return `[mode-subagent ${band} | ${result.length} chars]\n${head}${result.length > 3000 ? "\n…(truncated)" : ""}`
          } catch (err: any) {
            return `subagent error: ${err?.message ?? String(err)}`
          }
        },
      }),
    },
  }
}
