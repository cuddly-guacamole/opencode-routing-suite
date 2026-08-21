import { type Plugin } from "@opencode-ai/plugin"
import { tool } from "@opencode-ai/plugin"
import { z } from "zod"
import { join } from "node:path"
import { homedir } from "node:os"
import { mkdirSync, writeFileSync, renameSync, readFileSync } from "node:fs"
import * as core from "./router-core.mjs"

/**
 * progressive v0.4.0 — 渐进披露游戏化时间线（align dsh-router-standard @742b180）。
 *
 * 行为链：
 *   1. chat.message：记录 model/V4 门控；AUTO=1 时首条分类选 agent 入口
 *      （react→standard / spec→spec；不换装 persona）。
 *   2. messages.transform：学习会话 agent（UserMessage.info.agent），
 *      standard 会话进入渐进披露。
 *   3. system.transform（standard + V4）：system[0] = RL 句；phase_begin 确认后
 *      附加 目录声明 + MAXential 泄压 + we-form 阶段文本。
 *   4. phase_begin / phase_advance：确认/闯关，阶段状态持久化
 *      （~/.opencode/router-standard/stages.json，原子写 + 损坏容错）。
 *   5. tools_catalog / tools_help：二级披露注册表（tool.ids 枚举 + 静态摘要）。
 *
 * 平台口径（文本对齐 + 语义等价）：v0.4.0 无硬门控——工具全量可见，阶段为
 * 推荐路径（上游 tools.restrict/presentAs 在 opencode 无等价物，见
 * scripts/upstream/derived-map.md 与 .opencode/experiment-report.md）。
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
}

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

function loadStages(): Record<string, { stage: number; confirmed: boolean }> {
  try {
    const parsed = JSON.parse(readFileSync(stageFile(), "utf8"))
    if (parsed && typeof parsed === "object" && parsed.sessions && typeof parsed.sessions === "object") {
      const out: Record<string, { stage: number; confirmed: boolean }> = {}
      for (const [sid, st] of Object.entries(parsed.sessions)) {
        const stage = Number((st as any)?.stage)
        if (Number.isInteger(stage) && stage >= 0 && stage <= core.MAX_STAGE) {
          out[sid] = { stage, confirmed: (st as any)?.confirmed === true }
        }
      }
      return out
    }
  } catch {
    /* 不存在/损坏 → 全默认 */
  }
  return {}
}

const diskStages = loadStages()

/** 合成会话状态：内存优先，磁盘回退（跨进程恢复 confirmed/stage）。 */
function stateOf(sid: string): SessionState {
  const st: SessionState = states.get(sid) ?? {}
  const disk = diskStages[sid]
  if (disk) {
    if (st.confirmed === undefined) st.confirmed = disk.confirmed
    if (st.stage === undefined) st.stage = disk.stage
  }
  states.set(sid, st)
  return st
}

function saveStage(sid: string, confirmed: boolean, stage: number) {
  diskStages[sid] = { stage, confirmed }
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

// ── 插件主体 ──

export const progressiveImpl: Plugin = async ({ client }) => {
  if (HARD_DISABLED) {
    console.warn("[routing-suite] OPENCODE_ROUTER_ENABLED=0，插件已禁用")
    return {}
  }

  return {
    // ── chat.message：记录 model/V4 门控；AUTO 首条选 agent 入口 ──
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
      } catch (err) {
        trip("messages.transform", err)
      }
    },

    // ── system.transform：standard + V4 → RL 句（+ 声明/泄压/阶段文本） ──
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
            "\n\n" + core.PRESSURE_GUIDE.trim() +
            "\n\n" + core.stageText(stage)
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
          "确认开启渐进披露会话：注入机制声明（目录/泄压/阶段指引）。阶段为推荐路径，工具全量仍可用（无硬门控）。调用即开始。",
        args: {},
        async execute(_args, ctx) {
          const sid = ctx.sessionID
          const st = stateOf(sid)
          st.confirmed = true
          st.stage = 0
          states.set(sid, st)
          saveStage(sid, true, 0)
          return [
            "Session started: progressive tool disclosure.",
            core.PROGRESSIVE_DECL,
            core.PRESSURE_GUIDE.trim(),
            core.stageText(0),
            core.STAGE_GUIDES[0],
            "Next: call phase_advance when the current phase is done.",
          ].join("\n\n")
        },
      }),

      phase_advance: tool({
        description:
          "闯关推进：声明当前阶段完成，进入下一阶段（阶段文本 + 下一阶段指引）。仅在自己明确完成本阶段工作时调用。",
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
          st.stage = next
          states.set(sid, st)
          saveStage(sid, true, next)
          return (
            "Phase advanced: " + core.STAGES[next].name + " (" + next + "/3).\n\n" +
            core.STAGE_GUIDES[next] + "\n\n" + core.stageText(next)
          )
        },
      }),

      tools_catalog: tool({
        description: "渐进披露一级：全部工具（名称 + 一行摘要）。query 关键词过滤。",
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
        description: "渐进披露二级：单个工具的描述与阶段归属。",
        args: { name: z.string().describe("工具名（tools_catalog 查到）") },
        async execute(args, _ctx) {
          const name = String(args.name ?? "").trim()
          const summary = (core.TOOL_SUMMARIES as Record<string, string>)[name]
          const stageIdx = core.STAGES.findIndex((s) => s.tools.includes(name))
          const lines = ["tool: " + name]
          lines.push("summary: " + (summary ?? "custom/mcp tool"))
          if (stageIdx >= 0) lines.push("phase: " + core.STAGES[stageIdx].name + " (" + stageIdx + "/3)")
          else if (core.GLOBAL_SAFE.includes(name)) lines.push("phase: always available")
          return lines.join("\n")
        },
      }),

      dev_router_status: tool({
        description:
          "v0.4.0 渐进披露状态：插件/版本/会话 agent/model/阶段/持久化/override/熔断。只读。",
        args: {},
        async execute(_args, ctx) {
          const s = stateOf(ctx.sessionID)
          const disk = diskStages[ctx.sessionID]
          return [
            `插件: ${selfDisabled ? "已禁用（熔断 " + faultCount + "/" + MAX_FAULTS + "）" : "启用"}`,
            `版本: v0.4.0（progressive；OPENCODE_ROUTER_CLASSIC=1 回退 v0.3.1）`,
            `自动路由: ${AUTO ? "ON" : "off"}`,
            `会话 agent: ${s?.agent ?? "未知"}（渐进披露仅 standard agent）`,
            `会话 model: ${s?.modelId ?? "未知"} | DeepSeek V4: ${s?.isV4 ? "yes" : "no"}`,
            `会话 stage: ${s?.confirmed ? `${s.stage ?? 0}/3 ${core.STAGES[s.stage ?? 0]?.name}` : "未确认（phase_begin 开启）"}`,
            `持久化: ${disk?.stage !== undefined ? `stage ${disk.stage}${disk.confirmed ? " confirmed" : ""}` : "无"}`,
            `override: ${s?.override !== undefined ? String(s.override) : "无（auto）"}`,
            `熔断: ${faultCount}/${MAX_FAULTS}`,
          ].join("\n")
        },
      }),

      dev_router_mode: tool({
        description:
          "查看/记录推理模式 override（v0.4.0 只读语义：注入由阶段驱动，mode 仅记录展示）。spec/react/weak/mixed/auto 或 0-100/0.0-1.0。",
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
          return "override set: " + core.bandFor(parsed) + "（仅展示记录——v0.4.0 注入由阶段驱动）"
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
