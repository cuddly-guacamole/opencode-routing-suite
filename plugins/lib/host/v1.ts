import { type Plugin } from "@opencode-ai/plugin"
import { tool } from "@opencode-ai/plugin"
import * as core from "../router-core.mjs"
import type { CreateEngine, EngineHost, ToolSpec } from "./contract"
import type { EngineRuntime } from "../engine"

/**
 * host/v1.ts — V1（`@opencode-ai/plugin` ≤1.19.0）hook 拓扑 ↔ 中立事件（计划 §4.1/§4.2.2）。
 *
 * 本文件只做**翻译**：把 V1 的 hook 形状翻成中立事件、把引擎的工具规格翻成 V1 `tool()`。
 * 硬约束（计划 §4.1「不许出现」）：阶段/晋级逻辑一律不得出现在这里——它住在 engine.ts。
 *
 * 为什么引擎是**注入**的而不是 import 的：见 contract.ts 的 `CreateEngine` 注记
 * （Node ESM 要显式扩展名 / tsc 禁 `.ts` 扩展名 / tsconfig.json 不在授权内）。
 *
 * 接线（逐条对应计划 §4.2.2）：
 *   `chat.message`                          → onPrompt（setAgent / extractUserText / messageCount 在本文件）
 *   `experimental.chat.messages.transform`  → onSessionObserved（学习会话 agent/model）
 *   `tool.execute.after`                    → onToolCompleted（F9/F10：内置与插件自有工具均触发）
 *   `experimental.chat.system.transform`    → onContextRequest（output.system[0] = patch.system；
 *                                              **标题生成串嗅探留在此文件**）
 *   `tool({})`                              → 桥接 ToolSpec
 */

const CRASH_TEST = process.env.OPENCODE_ROUTER_CRASH_TEST === "1"

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

/** V1 端口：`client.tool.ids()` 枚举工具名；`client.session.messages()` 数消息。 */
function v1Host(client: any): EngineHost {
  return {
    async listToolNames(): Promise<string[]> {
      try {
        const ids = await client.tool.ids({ query: {} })
        const data = ids?.data
        if (Array.isArray(data)) return data
      } catch {
        /* 枚举失败 → 回退静态清单 */
      }
      return Object.keys(core.TOOL_SUMMARIES)
    },
    async messageCount(sessionID: string): Promise<number | null> {
      try {
        const result = await client.session.messages({
          path: { id: sessionID },
          query: { limit: 10 },
        })
        return result.data?.length ?? 0
      } catch {
        return null
      }
    },
  }
}

function bridgeTool(spec: ToolSpec) {
  return tool({
    description: spec.description,
    args: spec.args as any,
    async execute(args: any, context: any) {
      return spec.execute(args, { sessionID: context?.sessionID })
    },
  })
}

/** 构造 V1 的 progressive 插件（相对 v0.5.0 的 `progressiveImpl` = **等价 + 三项已登记差异**；
 *  差异登记处：`scripts/upstream/derived-map.md` §9.2 与 README「已知边界」）。 */
export function makeV1Plugin(createEngine: CreateEngine): Plugin {
  return async ({ client }: any) => {
    const engine: EngineRuntime = createEngine(v1Host(client)) as EngineRuntime
    if (engine.hardDisabled) {
      console.warn("[routing-suite] OPENCODE_ROUTER_ENABLED=0，插件已禁用")
      return {}
    }

    const toolBag: Record<string, any> = {}
    for (const spec of engine.tools) toolBag[spec.name] = bridgeTool(spec)

    return {
      // ── chat.message：记录 model/V4 门控 + 会话任务回显；AUTO 首条选 agent 入口 ──
      "chat.message": async (input: any, output: any) => {
        if (engine.isSelfDisabled()) return
        try {
          if (CRASH_TEST) throw new Error("crash injection (OPENCODE_ROUTER_CRASH_TEST=1)")
          const patch = await engine.onPrompt({
            sessionID: input.sessionID,
            modelId: input.model?.modelID ?? input.model?.id,
            text: extractUserText(output),
          })
          if (patch.lockAgent) setAgent(output, patch.lockAgent)
        } catch (err) {
          engine.trip("chat.message", err)
        }
      },

      // ── messages.transform：学习会话 agent（standard 才进入渐进披露） ──
      "experimental.chat.messages.transform": async (_input: any, output: any) => {
        if (engine.isSelfDisabled()) return
        try {
          if (CRASH_TEST) throw new Error("crash injection (messages.transform)")
          const msgs = output?.messages
          if (!msgs || msgs.length === 0) return
          const lastUser = [...msgs].reverse().find((m: any) => m?.info?.role === "user")
          if (!lastUser) return
          const sid = lastUser.info?.sessionID
          if (!sid) return
          engine.onSessionObserved({
            sessionID: sid,
            agent: lastUser.info?.agent,
            modelId: lastUser.info?.model?.modelID,
          })
        } catch (err) {
          engine.trip("messages.transform", err)
        }
      },

      // ── tool.execute.after：完成信号驱动晋级（触发器已从消息面搬到这里） ──
      "tool.execute.after": async (input: any, _output: any) => {
        if (engine.isSelfDisabled()) return
        try {
          if (CRASH_TEST) throw new Error("crash injection (tool.execute.after)")
          if (!input?.sessionID || typeof input.tool !== "string") return
          engine.onToolCompleted({
            sessionID: input.sessionID,
            toolName: input.tool,
            callID: typeof input.callID === "string" ? input.callID : input.tool,
          })
        } catch (err) {
          engine.trip("tool.execute.after", err)
        }
      },

      // ── system.transform：standard + V4 → RL 句（+ 声明/主动性自检/阶段文本） ──
      "experimental.chat.system.transform": async (input: any, output: any) => {
        if (engine.isSelfDisabled()) return
        try {
          if (CRASH_TEST) throw new Error("crash injection (system.transform)")
          const sys = output.system?.[0]
          if (!sys) return
          if (sys.startsWith("You are a title generator")) return // 标题生成请求不干预
          const sessionID = input?.sessionID
          if (!sessionID) return
          const patch = engine.onContextRequest({ sessionID })
          if (!patch || patch.system === undefined) return
          output.system[0] = patch.system
        } catch (err) {
          engine.trip("system.transform", err)
        }
      },

      // ── 自定义工具 ──
      tool: toolBag,
    }
  }
}
