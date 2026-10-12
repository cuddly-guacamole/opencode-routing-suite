import { z } from "zod"
import { join } from "node:path"
import { homedir } from "node:os"
import { mkdirSync, writeFileSync, renameSync, readFileSync, statSync } from "node:fs"
import * as core from "./router-core.mjs"
import type {
  ContextPatch,
  ContextRequestEvent,
  Engine,
  EngineHost,
  PromptEvent,
  PromptPatch,
  SessionObservedEvent,
  ToolCompletedEvent,
  ToolSpec,
} from "./host/contract"

/**
 * engine.ts — 宿主中立的渐进披露引擎（由 progressive.ts 洗出，计划 §4.1）。
 *
 * 这里持有全部**业务**：会话状态、完成信号驱动晋级、阶段状态落盘、8 个工具体。
 * 硬约束（计划 §4.1「不许出现」）：本文件**不得**出现任何宿主 API 调用——
 * 所有宿主差异都走 `EngineHost` 端口（枚举工具名、数消息数）与中立事件。
 *
 * 与旧 progressive.ts 的关键差异（计划 §4.2.1）：
 *   `collectToolCalls` / `advanceFromMessages` **已删除**。晋级触发器从「消息 part 面」
 *   搬到**逐调用工具完成事件**（`onToolCompleted`），于是 F7 那个 part 形状差异
 *   （V1 `type:"tool"`+`tool`+`callID` vs V2 `type:"tool-call"`+`name`+`id`）
 *   被**消掉**而不是被翻译掉——引擎从此不看 part。
 *
 * 行为链（相对 v0.5.0 = **等价 + 三项已登记差异**；差异登记处见
 * `scripts/upstream/derived-map.md` §9.2 与 README「已知边界」）：
 *   1. onPrompt：记录 model/V4 门控 + 会话任务回显；AUTO=1 时首条分类选 agent 入口。
 *   2. onToolCompleted：完成信号驱动晋级（阶段 0 见 question/todowrite，阶段 1 见
 *      todowrite，阶段 2 见 delivery_check；工具名/文本不跳级）。按 callID 记账，幂等。
 *   3. onContextRequest：system[0] = RL 句；phase_begin 确认后附加 目录声明 +
 *      Proactivity 主动性自检 + we-form 阶段文本（含 Task: 回显）；
 *      `OPENCODE_ROUTER_GATE=1` 时同时给出 `visibleTools = unlockedFor(stage)`。
 *   4. phase_begin / phase_advance：确认/显式闯关，阶段状态 + lastAdvance 落盘
 *      （~/.opencode/router-standard/stages.json，原子写 + 损坏容错）。
 *   5. tools_catalog / tools_help：二级披露注册表。
 *   6. delivery_check：文件三验证 + 证据清单门禁（含 numeric 数值证据 + 非阻塞 hint）。
 */

const MAX_FAULTS = 3

export const HARD_DISABLED = process.env.OPENCODE_ROUTER_ENABLED === "0"
export const AUTO = process.env.OPENCODE_ROUTER_AUTO === "1"

/**
 * 阶段化门控开关（计划 §2：默认关、环境变量 opt-in）。
 *
 * **动态读**而不是模块级常量：判据必须能在同一个进程里同时验证「开」与「关」
 * 两种取值，常量会把门控变成不可失败/不可证伪的装饰。
 */
export const gateEnabled = () => process.env.OPENCODE_ROUTER_GATE === "1"

type SessionState = {
  modelId?: string
  isV4?: boolean
  agent?: string
  confirmed?: boolean
  stage?: number
  override?: number | string
  lockAgent?: string
  handled?: boolean
  lastAdvance?: LastAdvance
  seenCalls?: string[]
  /** 本轮（两次 prompt 之间）是否已晋级过；保证一轮最多 +1（R7 缺陷①）。 */
  advancedThisRound?: boolean
}

/** 晋级记录（上游 v1.18.4 lastAdvance 闭环）：回答"我为什么在第 N 阶段"。 */
type LastAdvance = { at: number; reason: string | null }

const states = new Map<string, SessionState>()
const firstUserText = new Map<string, string>()

let faultCount = 0
let selfDisabled = false
function trip(where: string, err: unknown) {
  faultCount += 1
  console.error(`[routing-suite] ${where}:`, err)
  if (faultCount >= MAX_FAULTS) {
    selfDisabled = true
    states.clear()
    console.error(
      `[routing-suite] 连续 ${MAX_FAULTS} 次异常，已自我禁用（恢复：检查 opencode 版本或重启）`,
    )
  }
}

// ── 阶段状态持久化（原子写 + 损坏容错 + per-session；写失败不触发熔断） ──

const stageFile = () =>
  process.env.OPENCODE_ROUTER_STAGE_FILE ||
  join(homedir(), ".opencode", "router-standard", "stages.json")

type DiskStage = { stage: number; confirmed: boolean; lastAdvance?: LastAdvance }

function loadStages(): Record<string, DiskStage> {
  let raw: string
  try {
    raw = readFileSync(stageFile(), "utf8")
  } catch {
    /* 不存在/不可读 → 全默认（ENOENT 是常态，不告警） */
    return {}
  }
  try {
    const parsed = JSON.parse(raw)
    if (parsed && typeof parsed === "object" && parsed.sessions && typeof parsed.sessions === "object") {
      const out: Record<string, DiskStage> = {}
      for (const [sid, st] of Object.entries(parsed.sessions)) {
        const stage = Number((st as any)?.stage)
        if (Number.isInteger(stage) && stage >= 0 && stage <= core.MAX_STAGE) {
          const la = (st as any)?.lastAdvance
          const lastAdvance =
            la && Number.isFinite(la.at)
              ? { at: Number(la.at), reason: typeof la.reason === "string" ? la.reason : null }
              : undefined
          out[sid] = { stage, confirmed: (st as any)?.confirmed === true, ...(lastAdvance ? { lastAdvance } : {}) }
        }
      }
      return out
    }
  } catch (err) {
    // 对齐上游 v1.x 口径：损坏不再静默——静默吞掉会掩盖状态分裂
    console.error("[routing-suite] stage 状态文件损坏，按空状态重建:", err)
  }
  return {}
}

const diskStages = loadStages()

/** 合成会话状态：内存优先，磁盘回退（跨进程恢复 confirmed/stage/lastAdvance）。 */
function stateOf(sid: string): SessionState {
  const st: SessionState = states.get(sid) ?? {}
  const disk = diskStages[sid]
  if (disk) {
    if (st.confirmed === undefined) st.confirmed = disk.confirmed
    if (st.stage === undefined) st.stage = disk.stage
    if (st.lastAdvance === undefined && disk.lastAdvance) st.lastAdvance = disk.lastAdvance
  }
  states.set(sid, st)
  return st
}

function saveStage(sid: string, confirmed: boolean, stage: number, lastAdvance?: LastAdvance) {
  const prev = lastAdvance ?? diskStages[sid]?.lastAdvance ?? states.get(sid)?.lastAdvance
  diskStages[sid] = { stage, confirmed, ...(prev ? { lastAdvance: prev } : {}) }
  try {
    const file = stageFile()
    mkdirSync(join(file, ".."), { recursive: true })
    const tmp = file + ".tmp"
    writeFileSync(
      tmp,
      JSON.stringify({ version: 2, savedAt: new Date().toISOString(), sessions: diskStages }, null, 2),
      "utf8",
    )
    renameSync(tmp, file)
  } catch (err) {
    console.error(`[routing-suite] stage persist failed（进度不落盘，不影响注入）:`, err)
  }
}

// ── 完成信号驱动晋级（上游 v1.19.0 autoAdvance 的运行时接线） ──
// 触发器是**逐调用的工具完成事件**（计划 §4.2.1）：一次调用一条事件，携带 {toolName, callID}。
// 幂等：按 callID 记账，同一调用只参与一次晋级判定。

const MAX_SEEN_CALLS = 200

/** 用"一次刚完成的工具调用"驱动一次晋级；返回是否发生了晋级。
 *
 *  ⚠️ **每轮上限 +1**（R7 修，缺陷①）：同一**轮**内到达多个完成信号时只晋级**一级**，
 *  与旧实现（把一轮的 fresh 调用作**一次**判定）一致。没有这个上限，逐调用判定会让
 *  `[question, todowrite]` 一轮跨两级、且**对顺序敏感**（实测：一种顺序到 stage 2、
 *  另一种到 stage 1）——那是默认路径（门控关）的真回归。
 *
 *  「轮」的边界 = **一次模型请求**，复位在 `onContextRequest`（R8 从 `onPrompt` 搬来）。
 *  为什么不用 messageID 划轮：**V1 的 `tool.execute.after` 没有 messageID**
 *  （`origin/dev:packages/plugin/src/index.ts:274-281` 只有 `{tool, sessionID, callID, args}`），
 *  V2 才有（`upstream/dev:packages/plugin/src/promise/tool.ts:45-58`）。用 messageID 会让
 *  晋级语义**按宿主分叉**，破坏这条缝的根本性质；而两个宿主**都有 prompt 事件**
 *  （V1 `chat.message` / V2 `ctx.session.prompt`），故轮边界是宿主中立的。 */
function autoAdvanceFromCall(sid: string, call: { callID: string; name: string }): boolean {
  const st = stateOf(sid)
  if (st.confirmed !== true) return false
  const seen = new Set(st.seenCalls ?? [])
  if (seen.has(call.callID)) return false
  const remember = () => {
    st.seenCalls = [...seen, call.callID].slice(-MAX_SEEN_CALLS)
    states.set(sid, st)
  }
  // 本轮已经晋级过 → 只记账，不再推进（保证一轮最多 +1，与顺序无关）
  if (st.advancedThisRound === true) {
    remember()
    return false
  }
  const stage = st.stage ?? 0
  const next = core.advanceStage(stage, [call.name])
  if (next <= stage) {
    remember()
    return false
  }
  const reason = "auto:" + call.name
  st.stage = next
  st.lastAdvance = { at: Date.now(), reason }
  st.advancedThisRound = true
  remember()
  saveStage(sid, st.confirmed === true, next, st.lastAdvance)
  console.log(`[routing-suite] phase auto-advance ${stage}→${next} (${reason})`)
  return true
}

// ── 引擎主体 ──

export type EngineRuntime = Engine & {
  readonly auto: boolean
  readonly hardDisabled: boolean
  trip(where: string, err: unknown): void
  isSelfDisabled(): boolean
  faultCount(): number
  statusText(sessionID: string): string
}

export function createEngine(host: EngineHost): EngineRuntime {
  /**
   * 门控状态在**引擎构造时**取样一次，用于工具描述（描述是注册期常量，不像 system 文本
   * 每次请求都能重算）。运行中改 env 不会改已注册的描述——与 opencode 的实际加载方式一致
   * （env 在插件加载前设定）。system 文本另有 `gateEnabled()` 的**每次调用**读取。
   */
  const gated = gateEnabled()

  async function onPrompt(e: PromptEvent): Promise<PromptPatch> {
    const sessionID = e.sessionID
    const st: SessionState = states.get(sessionID) ?? {}
    // ⚠️ 轮边界**不在这里**复位（R8）：「一轮」= 一次**模型请求**，复位在 onContextRequest。
    // 早期版本把复位放在此处（= 每 user turn），实测比旧行为粗，已按裁定搬走。
    if (typeof e.modelId === "string") {
      st.modelId = e.modelId
      st.isV4 = core.isDeepSeekV4(e.modelId)
    }
    states.set(sessionID, st)
    if (st.isV4 === false) return {}

    const text = e.text
    if (text.trim() && !firstUserText.has(sessionID)) firstUserText.set(sessionID, text.trim())

    // ⚠️ AUTO **fail-closed**：只在**明确已知是 V4** 时才允许干预。
    //
    // 为什么不是上面的 `st.isV4 === false` 早退就够：V2 的 `prompt` 事件**不携带 model**
    // （`promise/session.d.ts:13-19` 只有 sessionID/messageID/prompt/metadata/delivery），
    // 故 V2 在此处 `st.isV4` 是 `undefined` 而不是 `false` ⇒ 那个早退**不拦** ⇒ 会对
    // 非 V4 模型锁 agent。这违反 README.md:17「非 DeepSeek V4 模型**零干预**」的承诺。
    // 未知一律不干预（R2 裁定：opt-in 便利让位于零干预承诺）。
    //
    // 注意此处**不动** `st.isV4 === false` 那个早退：它同时管着 `firstUserText` 的写入，
    // 而 V2 的 `Task:` 回显正依赖「模型未知时仍记录首条用户文本」。注入面另有
    // `onContextRequest` 的 `!st.isV4` fail-closed 守卫，两者独立。
    if (!AUTO || st.handled || st.isV4 !== true) return {}
    const count = await host.messageCount(sessionID)
    if (count === null || count !== 0) return {}

    if (core.isChatTask(text)) {
      st.handled = true
      return {}
    }
    const cls = core.classifyTask(text)
    st.lockAgent = cls === "react" ? "standard" : "spec"
    st.handled = true
    console.log(`[routing-suite] AUTO first-message classify=${cls} → agent=${st.lockAgent}`)
    return { lockAgent: st.lockAgent }
  }

  function onSessionObserved(e: SessionObservedEvent): void {
    const st: SessionState = states.get(e.sessionID) ?? {}
    if (typeof e.agent === "string") st.agent = e.agent
    if (typeof e.modelId === "string") {
      st.modelId = e.modelId
      st.isV4 = core.isDeepSeekV4(e.modelId)
    }
    states.set(e.sessionID, st)
  }

  function onToolCompleted(e: ToolCompletedEvent): void {
    autoAdvanceFromCall(e.sessionID, { callID: e.callID, name: e.toolName })
  }

  function onContextRequest(e: ContextRequestEvent): ContextPatch | null {
    const st = stateOf(e.sessionID)
    /**
     * **轮边界复位**（R8：从 `onPrompt` 搬到这里）——「一轮」= **一次模型请求**。
     *
     * 为什么在**守卫之前**：旧实现没有显式上限——「一批」是**每请求天然形成**的，
     * 对**所有会话**成立，与 agent/model 无关。若放在下面的 `!st.isV4 || agent !== "standard"`
     * 守卫**之后**，非 standard / 非 V4 会话晋级一次后将**永不复位**，
     * 那是对旧语义的又一处偏离。故复位必须对每个 context 请求无条件生效。
     *
     * 为什么边界是 context 而不是 prompt：旧批次来自 `experimental.chat.messages.transform`
     * = **一次模型请求**（不是 user turn）。一个 user turn 在 agentic 循环里通常含多次请求，
     * 用 prompt 边界会比旧行为**粗**（R7 实测：同 turn 内下一个请求不再放开额度）。
     * 两宿主都有每请求钩子（V1 `experimental.chat.system.transform` /
     * V2 `ctx.session.hook("context")`）⇒ 该边界**宿主中立**。
     *
     * ⚠️ V1 的**标题生成**路径也会触发 `system.transform`，但它**不带 sessionID**
     * （`agent.ts:381` 的 `PROMPT_GENERATE` 只传 `{model}`）；本函数要求 `sessionID`，
     * 缺省时 `stateOf(undefined)` 落到另一个键，**不会复位真实会话**（已实测，见证据 §4.4）。
     */
    st.advancedThisRound = false
    if (typeof e.agent === "string") st.agent = e.agent
    if (typeof e.modelId === "string") {
      st.modelId = e.modelId
      st.isV4 = core.isDeepSeekV4(e.modelId)
    }
    states.set(e.sessionID, st)
    if (!st.isV4 || st.agent !== "standard") return null

    let text = core.RL_PERSONA
    if (st.confirmed) {
      const stage = st.stage ?? 0
      text +=
        "\n\n" + (gateEnabled() ? core.PROGRESSIVE_DECL_GATED : core.PROGRESSIVE_DECL) +
        "\n\n" + core.PROACTIVITY_GUIDE +
        "\n\n" + core.stageText(stage, firstUserText.get(e.sessionID) ?? "")
    }
    const stage = st.stage ?? 0
    return {
      system: text,
      // 门控默认关（计划 §2）：未设 OPENCODE_ROUTER_GATE=1 → null = 不收窄
      visibleTools: gateEnabled() ? core.unlockedFor(stage) : null,
    }
  }

  const tools: ToolSpec[] = [
    {
      name: "phase_begin",
      description: gated
        ? "确认开启渐进披露会话：注入机制声明（目录/主动性自检/阶段指引）。⚠️ 阶段化门控已开启：工具表按阶段收窄，写入面（write/edit/apply_patch）在阶段 2 解锁，在那之前不出现。调用即开始。"
        : "确认开启渐进披露会话：注入机制声明（目录/主动性自检/阶段指引）。阶段为推荐路径，工具全量仍可用。调用即开始。",
      args: {},
      async execute(_args, ctx) {
        const sid = ctx.sessionID
        const st = stateOf(sid)
        const task = firstUserText.get(sid) ?? ""
        const decision = core.beginPhase(st)
        if (decision.action === "repair") {
          // 上游 v1.17.1 跨代兼容：已确认且恢复进度 > 0 → 保留进度，不重注入阶段 0 引导
          st.confirmed = true
          states.set(sid, st)
          saveStage(sid, true, decision.stage, st.lastAdvance)
          return [
            "Session already started (restored state): phase " + decision.stage + " (" + core.STAGES[decision.stage].name + "); stage preserved, no duplicate bootstrap.",
            core.stageText(decision.stage, task),
            core.STAGE_GUIDES[decision.stage],
          ].join("\n\n")
        }
        if (decision.action === "duplicate") {
          return "Session already started: phase 0 (" + core.STAGES[0].name + "); no duplicate bootstrap."
        }
        st.confirmed = true
        st.stage = 0
        states.set(sid, st)
        saveStage(sid, true, 0, st.lastAdvance)
        return [
          "Session started: progressive tool disclosure.",
          core.PROGRESSIVE_DECL,
          core.PROACTIVITY_GUIDE,
          core.stageText(0, task),
          core.STAGE_GUIDES[0],
          "Advancing is completion-signal driven: phase 0 completes on an answered question or a recorded plan (todowrite) — reading files alone does not advance. phase_advance is the explicit exit.",
        ].join("\n\n")
      },
    },

    {
      name: "phase_advance",
      description: core.DESC.phaseAdvance,
      args: { reason: z.string().optional().describe("推进理由（可选，记录用）") },
      async execute(args, ctx) {
        const sid = ctx.sessionID
        const st = stateOf(sid)
        if (!st.confirmed) return "Session not started: call phase_begin first."
        const stage = st.stage ?? 0
        if (stage >= core.MAX_STAGE) {
          return "Already at the last stage (" + core.STAGES[stage].name + "); full catalog is open."
        }
        const next = stage + 1
        const reason = typeof args?.reason === "string" && args.reason.trim() ? args.reason.trim() : null
        st.stage = next
        st.lastAdvance = { at: Date.now(), reason }
        states.set(sid, st)
        saveStage(sid, true, next, st.lastAdvance)
        // 技能卡逐工具摘要（上游 :812-815 `card()` 的 opencode 形态：描述取静态摘要，
        // 只留首句、截 46 字；查不到摘要就只给工具名）
        const card = (name: string) => {
          const desc = (core.TOOL_SUMMARIES as Record<string, string>)[name]
          return name + (desc ? " — " + desc.split(/\n|\. /)[0].slice(0, 46) : "")
        }
        return (
          "advanced to phase " + next + ": " + core.STAGES[next].name + "\n" +
          "New this stage: " + core.STAGES[next].tools.map(card).join(" | ") + "\n" +
          "Next goal: " + core.STAGES[next].name + " — complete it via its completion signal (" +
          core.completionSignals(next).join("/") + ") or phase_advance.\n\n" +
          core.stageText(next, firstUserText.get(sid) ?? "") + "\n\n" + core.STAGE_GUIDES[next]
        )
      },
    },

    {
      name: "delivery_check",
      description: core.DESC.deliveryCheck,
      args: {
        file: z.string().describe("交付物文件路径（绝对路径或工作区相对路径）"),
        page: z.boolean().optional().describe("页面/UI 类交付物传 true：要求至少一项 reviewed:true 的视觉证据"),
        evidence: z.object({
          items: z.array(z.object({
            label: z.string().describe("证据名"),
            kind: z.enum(core.EVIDENCE_KINDS as [string, ...string[]]).describe("证据类型"),
            target: z.string().optional().describe("file/page/image/test/external 类：产物路径"),
            result: z.string().optional().describe("run/text/numeric 类：真实输出摘要（numeric 必须是数值，如 12 或 0.0）"),
            reviewed: z.boolean().optional().describe("page/image 视觉类必须 true（已亲自看图；describe_image 只展示，不算复核）"),
          })).min(1),
        }).describe("证据清单。text/code 用 kind=text/test+result；命令用 kind=run+result；数值不变量用 kind=numeric+result=<number>；页面/图片用 kind=page/image/external+target 且 reviewed:true"),
      },
      async execute(args, _ctx) {
        const file = String(args.file ?? "").trim()
        if (!file) return "delivery-check: FAIL — file path required"
        let info = { exists: false, size: 0, utf8: false }
        try {
          const buf = readFileSync(file)
          info = { exists: true, size: buf.length, utf8: true }
          try {
            new TextDecoder("utf-8", { fatal: true }).decode(buf)
          } catch {
            info.utf8 = false
          }
        } catch {
          info = { exists: false, size: 0, utf8: false }
        }
        const r = core.verifyDeliveryPieces(file, info)
        // 证据门禁（上游 v1.14/v1.16）：无证据不再可绕过——文件三验证全绿也不判 PASS
        const ev = core.validateDeliveryEvidence(args.evidence?.items ?? [], {
          fileExists: (p: string) => {
            try {
              const s = statSync(p)
              return s.isFile() && s.size > 0
            } catch {
              return false
            }
          },
          requireReviewedVisual: args.page === true,
        })
        const ok = r.ok && ev.pass
        const lines = ["delivery-check: " + (ok ? "PASS" : "FAIL"), "file: " + file]
        for (const c of r.checks) {
          lines.push("- " + c.name + ": " + (c.pass ? "PASS" : "FAIL") + " (" + c.detail + ")")
        }
        const itemCount = Array.isArray(args.evidence?.items) ? args.evidence.items.length : 0
        lines.push(
          "- delivery-evidence: "
          + (ev.pass ? "PASS (" + itemCount + " item(s))" : "FAIL (" + ev.failures.join("; ") + ")"),
        )
        if (!ok) lines.push("Do NOT report completion — fix the failing checks and re-run delivery_check.")
        for (const h of ev.hints) lines.push("hint (non-blocking): " + h)
        return lines.join("\n")
      },
    },

    {
      name: "tools_catalog",
      description: gated ? core.DESC_GATED.toolsCatalog : core.DESC.toolsCatalog,
      args: { query: z.string().optional().describe("关键词过滤（可选）") },
      async execute(args, _ctx) {
        const q = String(args.query ?? "").toLowerCase()
        const names = await host.listToolNames()
        const rows = names.filter((n) => {
          if (n === "invalid") return false
          const summary = (core.TOOL_SUMMARIES as Record<string, string>)[n] ?? ""
          return !q || (n + " " + summary).toLowerCase().includes(q)
        })
        if (rows.length === 0) return "(no matching tools)"
        return rows
          .map((n) => "- " + n + " — " + ((core.TOOL_SUMMARIES as Record<string, string>)[n] ?? "custom/mcp tool"))
          .join("\n")
      },
    },

    {
      name: "tools_help",
      description: core.DESC.toolsHelp,
      args: { name: z.string().describe("工具名（tools_catalog 查到）") },
      async execute(args, _ctx) {
        const name = String(args.name ?? "").trim()
        const summary = (core.TOOL_SUMMARIES as Record<string, string>)[name]
        const stageIdx = core.STAGES.findIndex((s) => s.tools.includes(name))
        const lines = ["tool: " + name]
        lines.push("summary: " + (summary ?? "custom/mcp tool"))
        if (stageIdx >= 0) lines.push("phase: " + core.STAGES[stageIdx].name + " (" + stageIdx + "/3)")
        else if (core.GLOBAL_SAFE.includes(name)) lines.push("phase: always available")
        else {
          // 引导而非打回（上游 v1.19.1）：找不到就指路，而不是让它去找绕过
          lines.push("phase: 不在本插件的阶段表里")
          lines.push("若你认为它应属于某个阶段，请指出工具分配问题（阶段表 STAGES），而不是寻求绕过。")
        }
        return lines.join("\n")
      },
    },

    {
      name: "dev_router_status",
      description: core.DESC.routerStatus,
      args: {},
      async execute(_args, ctx) {
        return statusText(ctx.sessionID)
      },
    },

    {
      name: "dev_router_mode",
      description:
        "查看/记录推理模式 override（v0.5.0 只读语义：注入由阶段驱动，mode 仅记录展示）。spec/react/weak/mixed/auto 或 0-100/0.0-1.0。",
      args: { mode: z.string().optional().describe("目标模式或 auto 清除") },
      async execute(args, ctx) {
        const st: SessionState = states.get(ctx.sessionID) ?? {}
        states.set(ctx.sessionID, st)
        if (!args.mode) {
          return "current band: " + (st.override !== undefined ? core.bandFor(st.override as never) : "auto（渐进披露）")
        }
        const parsed = core.parseMode(args.mode)
        if (parsed === null) return `invalid mode "${args.mode}"`
        if (parsed === "auto") {
          delete st.override
          return "override cleared"
        }
        st.override = parsed
        return "override set: " + core.bandFor(parsed) + "（仅展示记录——v0.5.0 注入由阶段驱动）"
      },
    },
  ]

  function statusText(sessionID: string): string {
    const s = states.get(sessionID)
    const disk = diskStages[sessionID]
    return [
      `插件: ${selfDisabled ? "已禁用（熔断 " + faultCount + "/" + MAX_FAULTS + "）" : "启用"}`,
      `版本: ${core.PLUGIN_VERSION}（progressive；上游基线 ${core.UPSTREAM_BASELINE}；OPENCODE_ROUTER_CLASSIC=1 回退 classic）`,
      `自动路由: ${AUTO ? "ON" : "off"}`,
      `会话 agent: ${s?.agent ?? "未知"}（渐进披露仅 standard agent）`,
      `会话 model: ${s?.modelId ?? "未知"} | DeepSeek V4: ${s?.isV4 ? "yes" : "no"}`,
      `会话 stage: ${s?.confirmed ? `${s.stage ?? 0}/3 ${core.STAGES[s.stage ?? 0]?.name}` : "未确认（phase_begin 开启）"}`,
      `持久化: ${disk?.stage !== undefined ? `stage ${disk.stage}${disk.confirmed ? " confirmed" : ""}` : "无"}`,
      `lastAdvance: ${s?.lastAdvance && Number.isFinite(s.lastAdvance.at) ? new Date(s.lastAdvance.at).toISOString() + (s.lastAdvance.reason ? ` (${s.lastAdvance.reason})` : "") : "无"}`,
      `override: ${s?.override !== undefined ? String(s.override) : "无（auto）"}`,
      `熔断: ${faultCount}/${MAX_FAULTS}`,
    ].join("\n")
  }

  return {
    auto: AUTO,
    hardDisabled: HARD_DISABLED,
    onPrompt,
    onSessionObserved,
    onToolCompleted,
    onContextRequest,
    tools,
    trip,
    isSelfDisabled: () => selfDisabled,
    faultCount: () => faultCount,
    statusText,
  }
}

/** 静态工具清单回退（宿主枚举失败时 tools_catalog 用它）。 */
export function fallbackToolNames(): string[] {
  return Object.keys(core.TOOL_SUMMARIES)
}
