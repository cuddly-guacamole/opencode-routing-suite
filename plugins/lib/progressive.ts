import { type Plugin } from "@opencode-ai/plugin"
import { tool } from "@opencode-ai/plugin"
import { z } from "zod"
import { join } from "node:path"
import { homedir } from "node:os"
import { mkdirSync, writeFileSync, renameSync, readFileSync, statSync } from "node:fs"
import * as core from "./router-core.mjs"

/**
 * progressive v0.5.0 — 渐进披露游戏化时间线（align dsh-router-standard @b39112d / standard v1.27.0，
 * v1.18.0→v1.28.0 逐条裁决见 scripts/upstream/derived-map.md §7，落地与漂移见 §8）。
 *
 * 行为链：
 *   1. chat.message：记录 model/V4 门控 + 会话任务回显（首条真实用户文本，供 stageText 的 Task: 行）；
 *      AUTO=1 时首条分类选 agent 入口（react→standard / spec→spec；不换装 persona）。
 *   2. messages.transform：学习会话 agent（UserMessage.info.agent）；并用 assistant 消息里的
 *      tool part 做**完成信号驱动晋级**（上游 v1.19.0：阶段 0 见 question/todowrite，阶段 1 见
 *      todowrite，阶段 2 见 delivery_check；工具名/文本不跳级）。按 callID 记账，幂等。
 *   3. system.transform（standard + V4）：system[0] = RL 句；phase_begin 确认后
 *      附加 目录声明 + Proactivity 主动性自检 + we-form 阶段文本（含 Task: 回显）。
 *   4. phase_begin / phase_advance：确认/显式闯关，阶段状态 + lastAdvance 落盘
 *      （~/.opencode/router-standard/stages.json，原子写 + 损坏容错；
 *      已确认且恢复进度>0 的会话只修复不重置——上游 v1.17.1 跨代兼容）。
 *   5. tools_catalog / tools_help：二级披露注册表（tool.ids 枚举 + 静态摘要）。
 *   6. delivery_check：文件三验证 + 证据清单门禁（上游 v1.14/v1.16/v1.24 语义，
 *      无浏览器 smoke 的 opencode 版；numeric 数值证据 + 非阻塞 hint）。
 *
 * 平台口径（文本对齐 + 语义等价）：v0.5.x 无**阶段化**门控——工具全量可见，阶段为
 * 推荐路线（静态 permission deny 的真隐藏在 opencode 存在但只在加载期生效，见
 * scripts/upstream/derived-map.md §7.0 术语）。注入文本不含本平台不存在的指名。
 */

const MAX_FAULTS = 3

const HARD_DISABLED = process.env.OPENCODE_ROUTER_ENABLED === "0"
const AUTO = process.env.OPENCODE_ROUTER_AUTO === "1"
const CRASH_TEST = process.env.OPENCODE_ROUTER_CRASH_TEST === "1"

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
// opencode 没有上游的 agent/pre-step，工具调用只能从消息面读到：
//   · messages.transform 暴露完整消息数组，assistant 消息的 parts 里带 type==="tool" 的 ToolPart（tool 字段 = 工具名）；
//   · chat.message 的 output.message 是 UserMessage（类型即保证不带 tool part），调用仅作防御性兜底。
// 幂等：按 callID 记账，同一调用只参与一次晋级判定（等价上游按 stageAtTime 过滤事件）。

const MAX_SEEN_CALLS = 200

function collectToolCalls(parts: any): Array<{ callID: string; name: string }> {
  const out: Array<{ callID: string; name: string }> = []
  if (!Array.isArray(parts)) return out
  for (const p of parts) {
    if (p?.type !== "tool") continue
    const name = typeof p.tool === "string" ? p.tool : ""
    if (!name) continue
    out.push({ callID: typeof p.callID === "string" ? p.callID : name + ":" + out.length, name })
  }
  return out
}

/** 用"本阶段以来尚未记账的工具调用"驱动一次晋级；返回是否发生了晋级。 */
function autoAdvanceFromCalls(sid: string, calls: Array<{ callID: string; name: string }>): boolean {
  if (calls.length === 0) return false
  const st = stateOf(sid)
  if (st.confirmed !== true) return false
  const seen = new Set(st.seenCalls ?? [])
  const fresh = calls.filter((c) => !seen.has(c.callID))
  const remember = (list: Array<{ callID: string }>) => {
    const next = [...seen, ...list.map((c) => c.callID)]
    st.seenCalls = next.slice(-MAX_SEEN_CALLS)
  }
  if (fresh.length === 0) return false
  const stage = st.stage ?? 0
  const next = core.advanceStage(stage, fresh.map((c) => c.name))
  if (next <= stage) {
    remember(fresh)
    states.set(sid, st)
    return false
  }
  const reason = "auto:" + fresh.map((c) => c.name).join(",")
  st.stage = next
  st.lastAdvance = { at: Date.now(), reason }
  remember(fresh)
  states.set(sid, st)
  saveStage(sid, st.confirmed === true, next, st.lastAdvance)
  console.log(`[routing-suite] phase auto-advance ${stage}→${next} (${reason})`)
  return true
}

function advanceFromMessages(sid: string, messages: any): boolean {
  const calls: Array<{ callID: string; name: string }> = []
  for (const m of Array.isArray(messages) ? messages : []) calls.push(...collectToolCalls(m?.parts))
  return autoAdvanceFromCalls(sid, calls)
}

// ── 插件主体 ──

export const progressiveImpl: Plugin = async ({ client }) => {
  if (HARD_DISABLED) {
    console.warn("[routing-suite] OPENCODE_ROUTER_ENABLED=0，插件已禁用")
    return {}
  }

  return {
    // ── chat.message：记录 model/V4 门控 + 会话任务回显；AUTO 首条选 agent 入口 ──
    "chat.message": async (input, output) => {
      if (selfDisabled) return
      try {
        if (CRASH_TEST) throw new Error("crash injection (OPENCODE_ROUTER_CRASH_TEST=1)")

        const sessionID = input.sessionID
        const modelId = (input as any).model?.modelID ?? (input as any).model?.id
        const st: SessionState = states.get(sessionID) ?? {}
        if (typeof modelId === "string") {
          st.modelId = modelId
          st.isV4 = core.isDeepSeekV4(modelId)
        }
        states.set(sessionID, st)
        if (st.isV4 === false) return

        const text = extractUserText(output)
        if (text.trim() && !firstUserText.has(sessionID)) firstUserText.set(sessionID, text.trim())

        // 防御性兜底：用户消息面通常没有 tool part（类型即 UserMessage），有则参与一次晋级判定
        autoAdvanceFromCalls(sessionID, collectToolCalls((output as any)?.parts))

        if (!AUTO || st.handled) return
        const count = await messageCount(client, sessionID)
        if (count === null || count !== 0) return

        if (core.isChatTask(text)) {
          st.handled = true
          return
        }
        const cls = core.classifyTask(text)
        st.lockAgent = cls === "react" ? "standard" : "spec"
        st.handled = true
        setAgent(output, st.lockAgent)
        console.log(`[routing-suite] AUTO first-message classify=${cls} → agent=${st.lockAgent}`)
      } catch (err) {
        trip("chat.message", err)
      }
    },

    // ── messages.transform：学习会话 agent（standard 才进入渐进披露） ──
    "experimental.chat.messages.transform": async (_input, output) => {
      if (selfDisabled) return
      try {
        if (CRASH_TEST) throw new Error("crash injection (messages.transform)")

        const msgs = (output as any)?.messages
        if (!msgs || msgs.length === 0) return
        const lastUser = [...msgs].reverse().find((m: any) => m?.info?.role === "user")
        if (!lastUser) return
        const sid = lastUser.info?.sessionID
        const agent = lastUser.info?.agent
        if (!sid || typeof agent !== "string") return

        const st: SessionState = states.get(sid) ?? {}
        st.agent = agent
        const m = lastUser.info?.model?.modelID
        if (typeof m === "string") {
          st.modelId = m
          st.isV4 = core.isDeepSeekV4(m)
        }
        states.set(sid, st)

        // 完成信号驱动晋级（上游 v1.19.0）：本面是唯一能看到 assistant tool part 的地方
        advanceFromMessages(sid, msgs)
      } catch (err) {
        trip("messages.transform", err)
      }
    },

    // ── system.transform：standard + V4 → RL 句（+ 声明/主动性自检/阶段文本） ──
    "experimental.chat.system.transform": async (input, output) => {
      if (selfDisabled) return
      try {
        if (CRASH_TEST) throw new Error("crash injection (system.transform)")

        const sys = output.system?.[0]
        if (!sys) return
        if (sys.startsWith("You are a title generator")) return // 标题生成请求不干预

        const sessionID = (input as any).sessionID
        if (!sessionID) return
        const st = stateOf(sessionID)
        if (!st?.isV4 || st.agent !== "standard") return

        let text = core.RL_PERSONA
        if (st.confirmed) {
          const stage = st.stage ?? 0
          text +=
            "\n\n" + core.PROGRESSIVE_DECL +
            "\n\n" + core.PROACTIVITY_GUIDE +
            "\n\n" + core.stageText(stage, firstUserText.get(sessionID) ?? "")
        }
        output.system[0] = text
      } catch (err) {
        trip("system.transform", err)
      }
    },

    // ── 自定义工具 ──
    tool: {
      phase_begin: tool({
        description:
          "确认开启渐进披露会话：注入机制声明（目录/主动性自检/阶段指引）。阶段为推荐路径，工具全量仍可用。调用即开始。",
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
      }),

      phase_advance: tool({
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
      }),

      delivery_check: tool({
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
      }),

      tools_catalog: tool({
        description: core.DESC.toolsCatalog,
        args: { query: z.string().optional().describe("关键词过滤（可选）") },
        async execute(args, _ctx) {
          const q = String(args.query ?? "").toLowerCase()
          const names = await listToolNames(client)
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
      }),

      tools_help: tool({
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
      }),

      dev_router_status: tool({
        description: core.DESC.routerStatus,
        args: {},
        async execute(_args, ctx) {
          const s = stateOf(ctx.sessionID)
          const disk = diskStages[ctx.sessionID]
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
        },
      }),

      dev_router_mode: tool({
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
      }),
    },
  }
}

async function listToolNames(client: any): Promise<string[]> {
  try {
    const ids = await client.tool.ids({ query: {} })
    const data = ids?.data
    if (Array.isArray(data)) return data
  } catch {
    /* 枚举失败 → 回退静态清单 */
  }
  return Object.keys(core.TOOL_SUMMARIES)
}
