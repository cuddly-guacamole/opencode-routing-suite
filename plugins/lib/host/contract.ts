/**
 * host/contract.ts — 宿主中立事件层（计划 §4.1）。
 *
 * 缝画在**语义事件层**（seer 裁决 + 协调者采纳，计划 §8）：本文件只说四件事
 * 「用户发了一条 prompt」「宿主观察到会话的 agent/model」「一个工具调用完成了」
 * 「马上要发一次模型请求」，以及引擎能对宿主提出的要求（锁 agent、给工具面）。
 *
 * 硬约束（计划 §4.1「不许出现」）：本文件**不得**出现任何 `core.*` 业务调用。
 * 这里是两个宿主共享的词汇表，业务逻辑一律住在 lib/engine.ts。
 */

/** 宿主 → 引擎：用户提交了一条 prompt。 */
export type PromptEvent = {
  sessionID: string
  /** 模型 id（V1 `input.model.modelID`；V2 的 prompt 面不携带，见 SessionObservedEvent）。 */
  modelId?: string
  /** 该 prompt 的纯文本（宿主负责从自己的消息形状里取出来）。 */
  text: string
}

/** 引擎 → 宿主：请把本会话切到某个 agent。 */
export type PromptPatch = {
  lockAgent?: string
}

/** 宿主 → 引擎：一个工具调用**完成**了（不是「出现在历史里」——计划 §4.2.1）。 */
export type ToolCompletedEvent = {
  sessionID: string
  toolName: string
  callID: string
}

/** 宿主 → 引擎：即将发出一次模型请求，可以改 system 与可见工具面。 */
export type ContextRequestEvent = {
  sessionID: string
  agent?: string
  modelId?: string
}

/**
 * 宿主 → 引擎：宿主在自己的消息面上观察到了会话的 agent / model。
 *
 * ⚠️ **这是对计划 §4.1「三个中立事件」的一处偏离，记在证据里**：V1 的 agent 只在
 * `experimental.chat.messages.transform` 的 `lastUser.info.agent` 上可读（V2 则由
 * `context` 事件直接给 `agent`），而 `dev_router_status` 会展示这一行。把它塞进
 * `onPrompt` 或 `onContextRequest` 都会让 V1 的 agent 学到时机被推迟到下一次请求之后，
 * 是一个真实的行为回退。故显式加第四事件，而不是把它藏进另外三个里。
 */
export type SessionObservedEvent = {
  sessionID: string
  agent?: string
  modelId?: string
}

/**
 * 引擎 → 宿主：这次请求的补丁。
 *
 * ⚠️ 形状**一次定死，不许事后加字段**（计划 §4.1，seer 唯一的「现在不定就晚了」项）。
 * `visibleTools === null` 表示**不收窄**（默认；门控是 opt-in，见计划 §2）。
 */
export type ContextPatch = {
  system?: string
  visibleTools?: string[] | null
}

/**
 * 宿主端口：一个宿主（V1 / V2）需要为引擎提供的能力。
 * 刻意做得小——宿主差异只允许出现在这里，不允许渗进 engine.ts。
 */
export type EngineHost = {
  /** 枚举当前注册的工具名（V1 `client.tool.ids()`；V2 `ctx.tool.list()`）。 */
  listToolNames(): Promise<string[]>
  /** 本会话已有消息数；`null` = 宿主无法回答（V1 client 调用失败）。 */
  messageCount(sessionID: string): Promise<number | null>
}

/**
 * 一个可注册到宿主的工具：中立形状，两侧各自翻译（计划 §4.2.4）。
 * `args` 是 zod 原始 shape——V1 交给 `tool()` 原样用，V2 用 `z.toJSONSchema()` 转。
 */
export type ToolSpec = {
  name: string
  description: string
  args: Record<string, any>
  execute(args: any, ctx: { sessionID: string }): Promise<string>
}

/**
 * 引擎面：中立事件 + 工具集合。两个宿主适配器都只依赖这个接口，
 * 于是「V1 等价 + 三项已登记差异」与「V2 接线可用」是同一份逻辑的两个门面
 * （差异登记处：`scripts/upstream/derived-map.md` §9.2）。
 */
export type Engine = {
  onPrompt(e: PromptEvent): Promise<PromptPatch>
  onSessionObserved(e: SessionObservedEvent): void
  onToolCompleted(e: ToolCompletedEvent): void
  onContextRequest(e: ContextRequestEvent): ContextPatch | null
  tools: ToolSpec[]
}

/**
 * 宿主适配器工厂需要注入的引擎构造器。
 *
 * 为什么是注入而不是 `import`：本仓库的 `.ts` 模块之间用**无扩展名**相对导入
 * （Bun/opencode 解析得了，tsc 也解析得了），而 Node 的 ESM 解析器**只认显式扩展名**，
 * `tsc` 在 `allowImportingTsExtensions` 关闭时又**禁止** `.ts` 扩展名，且 `tsconfig.json`
 * 不在本次授权内（不可写）。于是 host 适配器不直接 import 引擎，由入口
 * `plugins/routing-suite.ts` 作为组合根注入——这样 host/*.ts 与 engine.ts 都能被
 * `node --test` 直接加载（测试用显式 `.ts` 说明符，.mjs 测试文件不经 tsc）。
 */
export type CreateEngine = (host: EngineHost) => Engine
