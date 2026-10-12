import { z } from "zod"
import type { CreateEngine, ToolSpec } from "./contract"
import type { EngineRuntime } from "../engine"

/**
 * host/v2.ts — V2（`@opencode/plugin@2.0.26+`）hook 拓扑 ↔ 中立事件（计划 §4.1/§4.2.3）。
 *
 * 本文件只做**翻译**：把 V2 的 hook 形状翻成中立事件、把引擎的工具规格翻成 V2 `Tool.Info`。
 * 硬约束（计划 §4.1「不许出现」）：阶段/晋级逻辑一律不得出现在这里——它住在 engine.ts。
 *
 * 接线（逐条对应计划 §4.2.3）：
 *   `ctx.session.hook("prompt")`          → onPrompt（`lockAgent` 走 `ctx.session.switchAgent`）
 *   `ctx.tool.hook("execute.after")`      → onToolCompleted（**触发器就在这里，不碰消息面**）
 *   `ctx.session.hook("context")`         → onContextRequest（`event.system[0] = {type:"text",text}`；
 *                                            `patch.visibleTools` 非 null 时按名单重建 `event.tools`）
 *   只注册 `context`，**天然不碰 title/compaction/generate**（V1 那个字符串嗅探在此无对应物）。
 *
 * ⚠️ 不 import `@opencode/plugin`：本包是 V1 依赖方，装上 V2 SDK 会强制 V1 用户也拉 2.0.26。
 * 故这里用**结构化最小类型**描述 V2 的 ctx（字段名与类型逐条对齐 `.d.ts`，出处见下）。
 *
 * 类型出处（对着已发布的 `@opencode/plugin@2.0.26` 逐条核；装该包后路径为
 * `node_modules/@opencode/plugin/dist/<下略>`，`@opencode/ai` 同理）：
 *   · `SessionContext.tools`            `promise/session.d.ts:29-35`
 *   · `SessionHooks.prompt/context`     `promise/session.d.ts:129-134`
 *   · `ToolHooks["execute.after"]`      `promise/tool.d.ts:38-51`（`tool` / `id` / `sessionID`）
 *   · `ToolEditor.add`                  `promise/tool.d.ts:16-28`
 *   · `SystemPart.make(text)` = `{type:"text",text}`  `@opencode/ai/dist/schema/messages.js:13`
 */

/** V2 `SessionContext` 的最小结构（`promise/session.d.ts:29-35`）。 */
type V2ContextEvent = {
  readonly sessionID: string
  readonly agent?: string
  readonly model?: { readonly id?: string }
  system: Array<{ type: "text"; text: string; [k: string]: unknown }>
  tools: Record<string, { description: string; input: unknown }>
}

/** V2 `ToolHooks["execute.after"]` 的最小结构（`promise/tool.d.ts:38-51`）。 */
type V2ExecuteAfterEvent = {
  readonly tool: string
  readonly sessionID: string
  readonly id: string
}

/** V2 `SessionHooks.prompt` 的最小结构（`promise/session.d.ts:13-19`）。 */
type V2PromptEvent = {
  readonly sessionID: string
  prompt?: { text?: string }
}

/** V2 插件 ctx 的最小结构（`promise/plugin.d.ts` 的 `Context`，只取本次用到的域）。 */
export type V2Ctx = {
  session: {
    hook(name: "prompt", cb: (e: V2PromptEvent) => Promise<void> | void): Promise<unknown>
    hook(name: "context", cb: (e: V2ContextEvent) => Promise<void> | void): Promise<unknown>
    context(input: { sessionID: string }): Promise<readonly unknown[]>
    switchAgent(input: { sessionID: string; agent: string }): Promise<void>
  }
  tool: {
    hook(name: "execute.after", cb: (e: V2ExecuteAfterEvent) => Promise<void> | void): Promise<unknown>
    transform(cb: (editor: V2ToolEditor) => void): Promise<unknown>
    list(): Promise<readonly unknown[]>
  }
}

type V2ToolEditor = {
  list(): readonly unknown[]
  add(tool: {
    name: string
    description: string
    input: unknown
    execute(input: any, context: { sessionID: string }): Promise<{ content: string }>
  }): void
}

/** V2 端口：`ctx.tool.list()` 枚举工具名；`ctx.session.context()` 数消息（计划 §4.2.5）。 */
function v2Host(ctx: V2Ctx) {
  return {
    async listToolNames(): Promise<string[]> {
      try {
        const list = await ctx.tool.list()
        return (list as Array<{ name?: string; id?: string }>)
          .map((t) => (typeof t?.name === "string" ? t.name : ""))
          .filter((n) => n !== "")
      } catch {
        return []
      }
    },
    async messageCount(sessionID: string): Promise<number | null> {
      try {
        const msgs = await ctx.session.context({ sessionID })
        return msgs?.length ?? 0
      } catch {
        return null
      }
    },
  }
}

function toV2Tool(spec: ToolSpec) {
  // 计划 §4.2.4：V2 用 `z.toJSONSchema()` 把 zod 定义转成 JSON Schema；返回值包 `{content}`。
  return {
    name: spec.name,
    description: spec.description,
    input: z.toJSONSchema(z.object(spec.args as any)),
    async execute(input: any, context: { sessionID: string }) {
      return { content: await spec.execute(input, { sessionID: context?.sessionID }) }
    },
  }
}

/**
 * 构造 V2 插件。返回的是 `Plugin.define({id, setup})` 的 `setup` 体
 * ——由入口 `plugins/routing-suite.ts` 组装成混合形状（计划 §4.2.7）。
 */
export function makeV2Setup(createEngine: CreateEngine): (ctx: V2Ctx) => Promise<void> {
  return async (ctx: V2Ctx) => {
    // 计划 §4.2.8：classic 不进缝（冻结语义优先）⇒ 该变量在 V2 上失效。
    // 处置：**打日志并大声回退到 progressive**，不得静默忽略。
    if (process.env.OPENCODE_ROUTER_CLASSIC === "1") {
      console.warn(
        "[routing-suite] OPENCODE_ROUTER_CLASSIC=1 在 V2 上不受支持：classic v0.3.1 是 V1 冻结回退，"
        + "不进入 V2 适配缝。已回退到 progressive（阶段化渐进披露）。冻结回退仅 V1 可用。",
      )
    }
    const engine: EngineRuntime = createEngine(v2Host(ctx)) as EngineRuntime
    if (engine.hardDisabled) {
      console.warn("[routing-suite] OPENCODE_ROUTER_ENABLED=0，插件已禁用")
      return
    }

    await ctx.tool.transform((editor) => {
      for (const spec of engine.tools) editor.add(toV2Tool(spec))
    })

    await ctx.tool.hook("execute.after", (event) => {
      if (engine.isSelfDisabled()) return
      try {
        if (!event?.sessionID || typeof event.tool !== "string") return
        engine.onToolCompleted({
          sessionID: event.sessionID,
          toolName: event.tool,
          callID: typeof event.id === "string" ? event.id : event.tool,
        })
      } catch (err) {
        engine.trip("tool.execute.after", err)
      }
    })

    await ctx.session.hook("prompt", async (event) => {
      if (engine.isSelfDisabled()) return
      try {
        const patch = await engine.onPrompt({
          sessionID: event.sessionID,
          text: typeof event?.prompt?.text === "string" ? event.prompt.text : "",
        })
        if (patch.lockAgent) {
          await ctx.session.switchAgent({ sessionID: event.sessionID, agent: patch.lockAgent })
        }
      } catch (err) {
        engine.trip("session.prompt", err)
      }
    })

    await ctx.session.hook("context", (event) => {
      if (engine.isSelfDisabled()) return
      try {
        const patch = engine.onContextRequest({
          sessionID: event.sessionID,
          agent: event.agent,
          modelId: event.model?.id,
        })
        if (!patch) return
        if (patch.system !== undefined && event.system.length > 0) {
          // `SystemPart.make(text)` 的实现就是 `{type:"text",text}`（见文件头出处），
          // 故不必为这一行引入 `@opencode/ai`。
          event.system[0] = { type: "text", text: patch.system }
        }
        if (patch.visibleTools) {
          // 计划 §4.2.3：按名单重建 `event.tools`。F11 实证改 `event.tools` 会进请求，
          // 且 `model-request.ts` 只保留「身份或键能对上」的条目 ⇒ 删除未解锁的键即可。
          const allowed = new Set(patch.visibleTools)
          for (const name of Object.keys(event.tools)) {
            if (!allowed.has(name)) delete event.tools[name]
          }
        }
      } catch (err) {
        engine.trip("session.context", err)
      }
    })
  }
}
