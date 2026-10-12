import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { z } from "zod"

/**
 * 宿主一致性测试（计划 §4.3 第二层「宿主一致性」+ 第三层「注入文本卫生」）。
 *
 * 同一个断言面在**两个宿主**上各跑一遍：
 *   · V1 —— 真实 hook 形状（`chat.message` / `tool.execute.after` /
 *     `experimental.chat.system.transform`），驱动 `makeV1Plugin`；
 *   · V2 —— **结构上像 V2 的假 ctx**（`session.hook` / `tool.hook` / `tool.transform`），
 *     驱动 `makeV2Setup`。假 ctx 的字段名与类型逐条抄自已装的 2.0.26 `.d.ts`。
 *
 * 状态文件必须在 import 之前改向：engine.ts 模块顶层就 loadStages()。
 */
const DIR = mkdtempSync(join(tmpdir(), "router-seam-"))
const STAGE_FILE = join(DIR, "stages.json")
process.env.OPENCODE_ROUTER_STAGE_FILE = STAGE_FILE
process.env.OPENCODE_ROUTER_AUTO = "0"
delete process.env.OPENCODE_ROUTER_CRASH_TEST
delete process.env.OPENCODE_ROUTER_GATE
delete process.env.OPENCODE_ROUTER_CLASSIC

const { createEngine } = await import("../plugins/lib/engine.ts")
const { makeV1Plugin } = await import("../plugins/lib/host/v1.ts")
const { makeV2Setup } = await import("../plugins/lib/host/v2.ts")
const core = await import("../plugins/lib/router-core.mjs")

const TASK = "帮我写一个能跑的脚本"
const diskState = () => JSON.parse(readFileSync(STAGE_FILE, "utf8")).sessions
const stageOf = (sid) => diskState()[sid]?.stage

// ── V1 宿主：真实 hook 形状 ──────────────────────────────────────────────

const v1Client = {
  session: { messages: async () => ({ data: [] }) },
  tool: { ids: async () => ({ data: Object.keys(core.TOOL_SUMMARIES) }) },
}

async function v1Hooks() {
  return makeV1Plugin(createEngine)({ client: v1Client })
}

/** 走 V1 的真实 hook 完成「开始会话 + 一次工具调用完成」。 */
async function v1Begin(hooks, sid) {
  await hooks["chat.message"]({ sessionID: sid, model: { modelID: "deepseek-v4-pro" } },
    { message: {}, parts: [{ type: "text", text: TASK }] })
  await hooks["experimental.chat.messages.transform"]({}, {
    messages: [{ info: { role: "user", sessionID: sid, agent: "standard", model: { modelID: "deepseek-v4-pro" } }, parts: [{ type: "text", text: TASK }] }],
  })
  await hooks.tool.phase_begin.execute({}, { sessionID: sid })
}

/** V1 的工具调用完成信号：真实 `tool.execute.after` 入参（`tool` / `sessionID` / `callID`）。 */
async function v1Call(hooks, sid, toolName, callID) {
  await hooks["tool.execute.after"]({ tool: toolName, sessionID: sid, callID, args: {} },
    { title: toolName, output: "ok", metadata: {} })
}

async function v1System(hooks, sid) {
  const out = { system: ["BASE SYSTEM PROMPT"] }
  await hooks["experimental.chat.system.transform"]({ sessionID: sid, model: { modelID: "deepseek-v4-pro" } }, out)
  return out.system[0]
}

// ── V2 宿主：结构上像 V2 的假 ctx ────────────────────────────────────────

/**
 * 假 ctx 只实现本插件真的会碰的三个面（`promise/session.d.ts` / `promise/tool.d.ts`）：
 *   `session.hook("prompt" | "context")`、`session.switchAgent`、`session.context`
 *   `tool.hook("execute.after")`、`tool.transform`、`tool.list`
 * 并把注册的回调**捕获下来**，供测试以真实事件形状驱动。
 */
function fakeV2Ctx() {
  const hooks = {}
  const tools = new Map()
  const switched = []
  const ctx = {
    session: {
      async hook(name, cb) { hooks[name] = cb; return { dispose: async () => {} } },
      async context() { return [] },
      async switchAgent(input) { switched.push(input) },
    },
    tool: {
      async hook(name, cb) { hooks["tool:" + name] = cb; return { dispose: async () => {} } },
      async transform(cb) {
        cb({
          list: () => [...tools.values()],
          add: (t) => tools.set(t.name, t),
          get: (id) => tools.get(id),
          remove: (id) => tools.delete(id),
          namespace: () => {},
          update: () => {},
        })
        return { dispose: async () => {} }
      },
      async list() { return [...tools.values()] },
    },
  }
  return { ctx, hooks, tools, switched }
}

async function v2Boot() {
  const fake = fakeV2Ctx()
  await makeV2Setup(createEngine)(fake.ctx)
  return fake
}

/** V2 的工具调用完成信号：真实 `execute.after` 入参（`tool` / `sessionID` / `id` / `status`）。 */
function v2Call(hooks, sid, toolName, callID) {
  hooks["tool:execute.after"]({ tool: toolName, sessionID: sid, agent: "standard", messageID: "m1", id: callID, input: {}, status: "completed", result: {} })
}

function v2ContextEvent(sid, tools) {
  return {
    sessionID: sid,
    agent: "standard",
    model: { id: "deepseek-v4-pro", providerID: "deepseek" },
    system: [{ type: "text", text: "BASE SYSTEM PROMPT" }],
    tools: tools ?? {},
  }
}

// ── 第二层：宿主一致性（同一断言面，两个宿主各跑一遍） ────────────────

describe("宿主一致性：system 注入面（V1 真实 hook / V2 假 ctx）", () => {
  it("V1：未确认只给 RL 句；确认后带声明 + Task 回显 + 阶段行", async () => {
    const hooks = await v1Hooks()
    const sid = "ses_seam_v1_sys"
    await hooks["chat.message"]({ sessionID: sid, model: { modelID: "deepseek-v4-pro" } },
      { message: {}, parts: [{ type: "text", text: TASK }] })
    await hooks["experimental.chat.messages.transform"]({}, {
      messages: [{ info: { role: "user", sessionID: sid, agent: "standard", model: { modelID: "deepseek-v4-pro" } }, parts: [{ type: "text", text: TASK }] }],
    })
    assert.equal(await v1System(hooks, sid), core.RL_PERSONA)
    await hooks.tool.phase_begin.execute({}, { sessionID: sid })
    const text = await v1System(hooks, sid)
    assert.ok(text.includes(core.PROGRESSIVE_DECL))
    assert.ok(text.includes("Task: " + TASK))
    assert.ok(text.includes("Current phase: Understanding"))
  })

  it("V2：未确认只给 RL 句；确认后带声明 + Task 回显 + 阶段行", async () => {
    const { hooks, tools } = await v2Boot()
    const sid = "ses_seam_v2_sys"
    hooks["prompt"]({ sessionID: sid, messageID: "m1", prompt: { text: TASK }, delivery: {} })
    const before = v2ContextEvent(sid)
    hooks["context"](before)
    assert.equal(before.system[0].text, core.RL_PERSONA)
    assert.equal(before.system[0].type, "text")
    await tools.get("phase_begin").execute({}, { sessionID: sid })
    const after = v2ContextEvent(sid)
    hooks["context"](after)
    assert.ok(after.system[0].text.includes(core.PROGRESSIVE_DECL))
    assert.ok(after.system[0].text.includes("Task: " + TASK))
    assert.ok(after.system[0].text.includes("Current phase: Understanding"))
  })

  it("V1 的标题生成串嗅探在 V1 侧仍然生效（该面不干预）", async () => {
    const hooks = await v1Hooks()
    const sid = "ses_seam_v1_title"
    await v1Begin(hooks, sid)
    const out = { system: ["You are a title generator"] }
    await hooks["experimental.chat.system.transform"]({ sessionID: sid, model: { modelID: "deepseek-v4-pro" } }, out)
    assert.equal(out.system[0], "You are a title generator")
  })
})

describe("宿主一致性：消息面晋级（同一断言面，两个宿主各跑一遍）", () => {
  it("V1：read 完成不晋级，question 完成晋级到 1", async () => {
    const hooks = await v1Hooks()
    const sid = "ses_seam_v1_adv"
    await v1Begin(hooks, sid)
    await v1Call(hooks, sid, "read", "v1-c-read")
    assert.equal(stageOf(sid), 0)
    await v1Call(hooks, sid, "question", "v1-c-q")
    assert.equal(stageOf(sid), 1)
    assert.equal(diskState()[sid].lastAdvance.reason, "auto:question")
  })

  it("V2：read 完成不晋级，question 完成晋级到 1", async () => {
    const { hooks, tools } = await v2Boot()
    const sid = "ses_seam_v2_adv"
    hooks["prompt"]({ sessionID: sid, messageID: "m1", prompt: { text: TASK }, delivery: {} })
    await tools.get("phase_begin").execute({}, { sessionID: sid })
    v2Call(hooks, sid, "read", "v2-c-read")
    assert.equal(stageOf(sid), 0)
    v2Call(hooks, sid, "question", "v2-c-q")
    assert.equal(stageOf(sid), 1)
    assert.equal(diskState()[sid].lastAdvance.reason, "auto:question")
  })

  it("V2 的幂等与逐级推进与 V1 一致（同 callID 不重复、一次只走一级）", async () => {
    const { hooks, tools } = await v2Boot()
    const sid = "ses_seam_v2_idem"
    hooks["prompt"]({ sessionID: sid, messageID: "m1", prompt: { text: TASK }, delivery: {} })
    await tools.get("phase_begin").execute({}, { sessionID: sid })
    v2Call(hooks, sid, "question", "v2-i-1")
    v2Call(hooks, sid, "question", "v2-i-1")
    assert.equal(stageOf(sid), 1, "同 callID 重复不得再晋级")
    hooks["context"](v2ContextEvent(sid)) // R8：轮边界 = 一次模型请求（V2 的 context 钩子）
    v2Call(hooks, sid, "todowrite", "v2-i-2")
    assert.equal(stageOf(sid), 2)
  })
})

// ── F7 静默失败判据（计划 §4 判据 3，可失败） ───────────────────────────

describe("F7 静默失败判据：V2 侧工具调用驱动晋级", () => {
  it("结构上像 V2 的假 ctx 驱动下，阶段确实推进（触发器在 execute.after）", async () => {
    const { hooks, tools } = await v2Boot()
    const sid = "ses_seam_v2_f7"
    // V2 的 prompt 面：只有 text，没有 parts（F7 的 hook 面 Message 是 role+content）
    hooks["prompt"]({ sessionID: sid, messageID: "m1", prompt: { text: TASK }, delivery: {} })
    await tools.get("phase_begin").execute({}, { sessionID: sid })
    assert.equal(stageOf(sid), 0)

    // 结构断言：触发器必须挂在逐调用工具事件上。若有人把它退回消息面，这里就是 undefined。
    assert.equal(typeof hooks["tool:execute.after"], "function",
      "V2 适配器必须注册 execute.after —— 触发器退回消息面时本判据失败")

    v2Call(hooks, sid, "question", "v2-f7-1")
    assert.equal(stageOf(sid), 1, "V2 侧工具调用必须能驱动晋级（照抄 V1 的 part 判据会恒返回空）")
    assert.equal(diskState()[sid].lastAdvance.reason, "auto:question")
  })

  it("晋级触发不依赖消息 part：给 onPrompt 塞 V1 形状的 tool part 也不得推进", async () => {
    // 这条是**判据自身的可失败性**：若有人把 collectToolCalls（认 p.type==="tool"/p.tool/callID）
    // 重新接回消息面，本断言立刻失败——而那正是 V2 上恒返回空数组的静默路径。
    const sid = "ses_seam_v2_noparts"
    const engine = createEngine({
      listToolNames: async () => [],
      messageCount: async () => 0,
    })
    engine.onSessionObserved({ sessionID: sid, agent: "standard", modelId: "deepseek-v4-pro" })
    await engine.onPrompt({ sessionID: sid, text: TASK })
    await engine.tools.find((t) => t.name === "phase_begin").execute({}, { sessionID: sid })
    // V1 形状的 part：照抄旧判据就能命中的输入
    await engine.onPrompt({
      sessionID: sid,
      text: TASK,
      parts: [{ type: "tool", tool: "question", callID: "old-shape-1" }],
    })
    assert.equal(stageOf(sid), 0, "消息面 part 不得驱动晋级（触发器已搬到逐调用完成事件）")
    engine.onToolCompleted({ sessionID: sid, toolName: "question", callID: "new-shape-1" })
    assert.equal(stageOf(sid), 1, "逐调用完成事件必须能驱动晋级")
  })

  it("V2 工具经 transform 注册后可直接 execute（V2 侧工具面接线可用）", async () => {
    const { tools } = await v2Boot()
    const sid = "ses_seam_v2_tool"
    const names = [...tools.keys()]
    assert.ok(names.includes("phase_begin"), "V2 必须注册 phase_begin")
    assert.ok(names.includes("delivery_check"), "V2 必须注册 delivery_check")
    const spec = tools.get("phase_begin")
    assert.equal(spec.input.type, "object", "V2 的工具入参必须是 JSON Schema（z.toJSONSchema 输出）")
    const r = await spec.execute({}, { sessionID: sid })
    assert.ok(r.content.includes("Session started"), "V2 工具返回值必须包在 {content} 里")
  })
})

// ── AUTO fail-closed（R2 裁定）：V2 的 prompt 面不携带 model 时不得锁 agent ──

/**
 * 判据背景：`README.md:17` 承诺「非 DeepSeek V4 模型**零干预**」。
 * V2 的 `prompt` 事件**不携带 model**（`promise/session.d.ts:13-19` 只有
 * sessionID/messageID/prompt/metadata/delivery），故 `onPrompt` 里 `st.isV4` 是 `undefined`
 * 而非 `false`。修复前 `if (st.isV4 === false) return {}` **不拦** ⇒ AUTO 分支照跑 ⇒
 * 可对非 V4 模型锁 agent。修复后 AUTO 只在 `st.isV4 === true` 时进入（fail-closed）。
 *
 * 为什么用**子进程**：`AUTO` 是 `engine.ts` 的模块级常量（import 时读 env），
 * 本文件在 import 前已把它设为 `0`。要在 AUTO=1 下驱动真实 V2 适配器，只能在
 * 一个 `OPENCODE_ROUTER_AUTO=1` 的子进程里加载，这样测的是**真实接线**而不是替身。
 */
const REPO = fileURLToPath(new URL("..", import.meta.url))

describe("AUTO fail-closed：V2 的 prompt 面不携带 model 时不得锁 agent（README.md:17）", () => {
  const driver = `
    const { createEngine } = await import(${JSON.stringify(new URL("../plugins/lib/engine.ts", import.meta.url).href)})
    const { makeV2Setup } = await import(${JSON.stringify(new URL("../plugins/lib/host/v2.ts", import.meta.url).href)})
    const switched = []
    const hooks = {}
    const ctx = {
      session: {
        async hook(n, cb) { hooks[n] = cb; return { dispose: async () => {} } },
        async context() { return [] },
        async switchAgent(input) { switched.push(input) },
      },
      tool: {
        async hook(n, cb) { hooks["tool:" + n] = cb; return { dispose: async () => {} } },
        async transform(cb) {
          cb({ list: () => [], add: () => {}, get: () => {}, remove: () => {}, namespace: () => {}, update: () => {} })
          return { dispose: async () => {} }
        },
        async list() { return [] },
      },
    }
    await makeV2Setup(createEngine)(ctx)
    // ① 真实 V2 prompt 事件形状：**没有 model 字段**
    await hooks["prompt"]({ sessionID: "ses_auto_v2", messageID: "m1", prompt: { text: "帮我写一个能跑的脚本" }, delivery: {} })
    // ② 正对照：同一引擎，**明确已知是 V4** 时 AUTO 必须仍然能锁（否则本判据只是"什么都不做"）
    const eng2 = createEngine({ listToolNames: async () => [], messageCount: async () => 0 })
    const posPatch = await eng2.onPrompt({ sessionID: "ses_auto_pos", modelId: "deepseek-v4-pro", text: "帮我写一个能跑的脚本" })
    // ③ 正对照 2：**明确非 V4** 时必须不锁
    const eng3 = createEngine({ listToolNames: async () => [], messageCount: async () => 0 })
    const negPatch = await eng3.onPrompt({ sessionID: "ses_auto_neg", modelId: "gpt-4o", text: "帮我写一个能跑的脚本" })
    console.log("RESULT_JSON " + JSON.stringify({
      auto: process.env.OPENCODE_ROUTER_AUTO,
      switched: switched.length,
      positiveLock: posPatch.lockAgent ?? null,
      negativeLock: negPatch.lockAgent ?? null,
    }))
  `

  it("AUTO=1 + 模型未知（V2 prompt 面）⇒ 不锁 agent；已知 V4 仍锁；已知非 V4 不锁", () => {
    const out = execFileSync(process.execPath, ["--input-type=module", "-e", driver], {
      cwd: REPO,
      env: { ...process.env, OPENCODE_ROUTER_AUTO: "1" },
      encoding: "utf8",
    })
    const line = out.split("\n").find((l) => l.startsWith("RESULT_JSON "))
    assert.ok(line, "子进程必须打印 RESULT_JSON（否则读数是空的）")
    const r = JSON.parse(line.slice("RESULT_JSON ".length))

    // 前置断言：证明这一跑真的是 AUTO=1，否则整条判据是空跑
    assert.equal(r.auto, "1", "前置：子进程里 AUTO 必须真的是 1")
    // 主判据：模型未知 ⇒ fail-closed，不锁
    assert.equal(r.switched, 0, "V2 上模型未知时 AUTO 不得锁 agent（fail-closed，README.md:17）")
    // 正对照：证明 AUTO 通路本身没被焊死（判据不是"永远不做事"）
    assert.equal(r.positiveLock, "standard", "明确已知 V4 时 AUTO 必须仍能锁 agent（正对照）")
    assert.equal(r.negativeLock, null, "明确非 V4 时不得锁 agent（README.md:17 零干预）")
  })
})

// ── 注入文本 gate-aware 判据（R5，可失败） ──────────────────────────────

/**
 * R5 缺陷：门控让工具表**真的**收窄了（R4），但注入文本是**静态常量**，仍在说
 * 「not a hard gate」「工具恒全量」——门控开时这三句为假，模型同时收到「工具全量」与
 * 「write 不在表里」两条矛盾信息。修法：门控开时换成 gate-aware 措辞（`PROGRESSIVE_DECL_GATED`
 * / `GATE_ON_NOTICE` / `DESC_GATED`），并**告知**写入面在阶段 2 解锁。
 *
 * 两态都判：门控关 ⇒ 不得出现门控措辞（否则反向说谎）；门控开 ⇒ 假断言必须消失且必须告知解锁时机。
 */
describe("注入文本 gate-aware：门控开关两态下 system 都不得说谎", () => {
  const FORBIDDEN_CLAIMS = [
    "not a hard gate",   // PROGRESSIVE_DECL 原文第 4 句（门控开时为假）
    "恒全量",             // DESC.toolsCatalog 原文（门控开时为假）
    "全量仍可用",          // phase_begin 描述原文（门控开时为假）
  ]
  const GATE_WORDING = /Phase gating is ON|门控已开启|阶段化门控/

  async function sysUnderGate(gateOn) {
    if (gateOn) process.env.OPENCODE_ROUTER_GATE = "1"
    else delete process.env.OPENCODE_ROUTER_GATE
    try {
      const sid = "ses_gate_text_" + (gateOn ? "on" : "off")
      const engine = createEngine({ listToolNames: async () => [], messageCount: async () => 0 })
      engine.onSessionObserved({ sessionID: sid, agent: "standard", modelId: "deepseek-v4-pro" })
      await engine.onPrompt({ sessionID: sid, text: TASK })
      await engine.tools.find((t) => t.name === "phase_begin").execute({}, { sessionID: sid })
      const sys = engine.onContextRequest({ sessionID: sid }).system
      const descs = engine.tools.map((t) => t.name + ": " + t.description).join("\n")
      return { sys, descs, engine }
    } finally {
      delete process.env.OPENCODE_ROUTER_GATE
    }
  }

  it("门控开：system 不含「not a hard gate / 恒全量 / 全量仍可用」，且告知写入面在阶段 2 解锁", async () => {
    const { sys } = await sysUnderGate(true)
    for (const claim of FORBIDDEN_CLAIMS) {
      assert.ok(!sys.includes(claim), `门控开时 system 不得含已为假的断言「${claim}」`)
    }
    assert.ok(sys.includes(core.GATE_ON_NOTICE), "门控开时必须用 gate-aware 声明")
    assert.ok(/write\/edit\/apply_patch/.test(sys), "必须点名被门控的写入面")
    assert.ok(/phase 2/.test(sys), "必须告知解锁时机（阶段 2），否则模型只会反复重试")
    assert.ok(/not a fault/.test(sys), "必须说明「工具不在表里」不是故障")
  })

  it("门控开：工具描述面同样不含已为假的断言", async () => {
    const { descs } = await sysUnderGate(true)
    for (const claim of FORBIDDEN_CLAIMS) {
      assert.ok(!descs.includes(claim), `门控开时工具描述不得含「${claim}」`)
    }
    assert.ok(descs.includes("tools_catalog:"), "该面必须真的含工具描述（否则断言是空跑）")
    assert.ok(/阶段 2 解锁|phase 2/.test(descs), "工具描述必须告知写入面解锁时机")
  })

  it("门控关：system 与工具描述都不得出现门控措辞（保持 v0.5.0 原语义）", async () => {
    const { sys, descs } = await sysUnderGate(false)
    assert.ok(!GATE_WORDING.test(sys), "门控关时 system 不得出现门控措辞（否则是反向说谎）")
    assert.ok(!GATE_WORDING.test(descs), "门控关时工具描述不得出现门控措辞")
    assert.ok(sys.includes(core.PROGRESSIVE_DECL), "门控关时必须用原文（逐字节等价 v0.5.0）")
    assert.ok(descs.includes("恒全量"), "门控关时原措辞应保留（该模式下它为真）")
  })

  it("两态文本确实不同（证明分支真的在起作用，不是同一份文本两边都过）", async () => {
    const on = await sysUnderGate(true)
    const off = await sysUnderGate(false)
    assert.notEqual(on.sys, off.sys, "门控开/关的 system 必须不同")
    assert.ok(on.sys.includes(core.PROGRESSIVE_DECL_GATED) && off.sys.includes(core.PROGRESSIVE_DECL))
  })
})

// ── 门控判据（计划 §4 判据 4，可失败） ─────────────────────────────────

describe("阶段化门控：OPENCODE_ROUTER_GATE 的开关语义", () => {
  it("未设该变量 → visibleTools 为 null（不收窄）", async () => {
    delete process.env.OPENCODE_ROUTER_GATE
    const sid = "ses_gate_off"
    const engine = createEngine({ listToolNames: async () => [], messageCount: async () => 0 })
    engine.onSessionObserved({ sessionID: sid, agent: "standard", modelId: "deepseek-v4-pro" })
    await engine.tools.find((t) => t.name === "phase_begin").execute({}, { sessionID: sid })
    const patch = engine.onContextRequest({ sessionID: sid })
    assert.equal(patch.visibleTools, null, "默认（门控关）必须是不收窄")
  })

  it("OPENCODE_ROUTER_GATE=1 → visibleTools = core.unlockedFor(stage)", async () => {
    process.env.OPENCODE_ROUTER_GATE = "1"
    try {
      const sid = "ses_gate_on"
      const engine = createEngine({ listToolNames: async () => [], messageCount: async () => 0 })
      engine.onSessionObserved({ sessionID: sid, agent: "standard", modelId: "deepseek-v4-pro" })
      await engine.tools.find((t) => t.name === "phase_begin").execute({}, { sessionID: sid })
      assert.deepEqual(engine.onContextRequest({ sessionID: sid }).visibleTools, core.unlockedFor(0))
      engine.onToolCompleted({ sessionID: sid, toolName: "question", callID: "g1" })
      assert.deepEqual(engine.onContextRequest({ sessionID: sid }).visibleTools, core.unlockedFor(1))
      // R8：每**请求**最多 +1 ⇒ 跨到下一阶段需要**下一次请求**（onContextRequest 即该边界）
      engine.onToolCompleted({ sessionID: sid, toolName: "todowrite", callID: "g2" })
      assert.deepEqual(engine.onContextRequest({ sessionID: sid }).visibleTools, core.unlockedFor(2))
    } finally {
      delete process.env.OPENCODE_ROUTER_GATE
    }
  })

  it("V2 侧：门控开 + 阶段 0 ⇒ 真实写工具必须从 event.tools 消失，读/`bash` 必须保留", async () => {
    process.env.OPENCODE_ROUTER_GATE = "1"
    try {
      const { hooks, tools } = await v2Boot()
      const sid = "ses_gate_v2"
      hooks["prompt"]({ sessionID: sid, messageID: "m1", prompt: { text: TASK }, delivery: {} })
      await tools.get("phase_begin").execute({}, { sessionID: sid })
      // ⚠️ 用**真实工具名**。旧版用合成名 "definitely-not-unlocked" 断言它消失——
      // 它本来就不在任何名单里，断言**恒真**，真实工具（write/bash）一个都没被验证过。
      const event = v2ContextEvent(sid, {
        read: { description: "r", input: {} },
        bash: { description: "b", input: {} },
        write: { description: "w", input: {} },
        edit: { description: "e", input: {} },
        apply_patch: { description: "a", input: {} },
      })
      hooks["context"](event)
      for (const t of ["write", "edit", "apply_patch"]) {
        assert.ok(!(t in event.tools), `阶段 0 门控开时 ${t} 必须从 event.tools 消失（门控不得空转）`)
      }
      for (const t of ["read", "bash"]) {
        assert.ok(t in event.tools, `${t} 必须保留（GLOBAL_SAFE；bash 因 STAGE_GUIDES[0] 的 early sanity check）`)
      }
    } finally {
      delete process.env.OPENCODE_ROUTER_GATE
    }
  })

  it("V2 侧：门控开 + 晋级到阶段 2 ⇒ 写工具重新出现在 event.tools（解锁）", async () => {
    process.env.OPENCODE_ROUTER_GATE = "1"
    try {
      const { hooks, tools } = await v2Boot()
      const sid = "ses_gate_v2_s2"
      hooks["prompt"]({ sessionID: sid, messageID: "m1", prompt: { text: TASK }, delivery: {} })
      await tools.get("phase_begin").execute({}, { sessionID: sid })
      // 阶段 0 → 1 → 2：question 是阶段 0 完成信号，todowrite 是阶段 1 完成信号
      // R7：每轮最多 +1 ⇒ 两次晋级之间必须有新一轮（prompt 边界）
      v2Call(hooks, sid, "question", "g-s2-1")
      hooks["context"](v2ContextEvent(sid)) // R8：轮边界 = 一次模型请求
      v2Call(hooks, sid, "todowrite", "g-s2-2")
      assert.equal(stageOf(sid), 2, "前置：必须已到阶段 2")
      const event = v2ContextEvent(sid, {
        read: { description: "r", input: {} },
        write: { description: "w", input: {} },
        edit: { description: "e", input: {} },
        apply_patch: { description: "a", input: {} },
      })
      hooks["context"](event)
      for (const t of ["write", "edit", "apply_patch"]) {
        assert.ok(t in event.tools, `阶段 2 已解锁，${t} 必须保留在 event.tools`)
      }
    } finally {
      delete process.env.OPENCODE_ROUTER_GATE
    }
  })

  it("V2 侧：门控关时 event.tools 原样不动（默认不收窄）", async () => {
    delete process.env.OPENCODE_ROUTER_GATE
    const { hooks, tools } = await v2Boot()
    const sid = "ses_gate_v2_off"
    hooks["prompt"]({ sessionID: sid, messageID: "m1", prompt: { text: TASK }, delivery: {} })
    await tools.get("phase_begin").execute({}, { sessionID: sid })
    const event = v2ContextEvent(sid, {
      read: { description: "r", input: {} },
      "some-other-tool": { description: "x", input: {} },
    })
    hooks["context"](event)
    assert.deepEqual(Object.keys(event.tools).sort(), ["read", "some-other-tool"])
  })
})

// ── §4.2.8：V2 上的 OPENCODE_ROUTER_CLASSIC=1 必须大声回退 ───────────────

describe("V2 上的 OPENCODE_ROUTER_CLASSIC=1：不得静默忽略", () => {
  it("打日志并回退到 progressive（classic 不进缝）", async () => {
    process.env.OPENCODE_ROUTER_CLASSIC = "1"
    const warnings = []
    const orig = console.warn
    console.warn = (...a) => warnings.push(a.join(" "))
    try {
      const { tools } = await v2Boot()
      const joined = warnings.join("\n")
      assert.ok(joined.includes("OPENCODE_ROUTER_CLASSIC"), "必须点名该变量")
      assert.ok(joined.includes("不受支持"), "必须说清它不受支持")
      assert.ok(joined.includes("progressive"), "必须说清回退到了 progressive")
      assert.ok(tools.has("phase_begin"), "回退目标是 progressive（阶段化工具体仍在）")
    } finally {
      console.warn = orig
      delete process.env.OPENCODE_ROUTER_CLASSIC
    }
  })
})

// ── 第三层：注入文本卫生，参数化到两宿主 ────────────────────────────────

/**
 * 派生自 derived-map §7.2 剔除清单：这些 token 在 opencode 侧没有对应工具/服务。
 * ⚠️ 清单实为 **24** 条（不是 23）：`engram/run_code/dev_page_check/presentAs/restrict` +
 * `workflow/ralph/fork/subagent` + `get_goal/create_goal/update_goal` +
 * `pwsh/read_image/str_replace_editor/web_search` + `ask_user_question/todo_write/exit_plan_mode` +
 * `job_list/job_output/job_kill/dev_reload_preset_live/dev_reset_experience`。
 * 下面显式断言条数，防止清单被悄悄改短。
 */
const FORBIDDEN = [
  "engram", "run_code", "dev_page_check", "presentAs", "restrict",
  "workflow", "ralph", "fork", "subagent",
  "get_goal", "create_goal", "update_goal",
  "pwsh", "read_image", "str_replace_editor", "web_search",
  "ask_user_question", "todo_write", "exit_plan_mode",
  "job_list", "job_output", "job_kill", "dev_reload_preset_live", "dev_reset_experience",
]

/** 收集工具定义里可达的全部字符串。
 *  ⚠️ 必须走对象本身而不是 `JSON.stringify`：zod 的 `.describe()` 在 4.1.8 上装的是**非枚举**
 *  属性 `description`，`JSON.stringify` 与只读 `Object.keys` 都会漏掉它（T13 实测）。
 *  ⚠️ 深度上限必须够大（这里 40）：嵌套参数（`evidence.items[].result`）在 zod 内部树里
 *  比顶层参数深得多，上限 10 会漏掉它（同一实测）。 */
function collectStrings(o, out = [], seen = new Set(), depth = 0) {
  if (o == null || depth > 40) return out
  const t = typeof o
  if (t === "string") { out.push(o); return out }
  if (t !== "object" || seen.has(o)) return out
  seen.add(o)
  for (const k of Object.getOwnPropertyNames(o)) {
    let v
    try { v = o[k] } catch { continue }
    collectStrings(v, out, seen, depth + 1)
  }
  return out
}

/** V1 宿主面：zod 原始定义（含非枚举 description）。 */
function v1HygieneBlob() {
  const engine = createEngine({ listToolNames: async () => [], messageCount: async () => 0 })
  return collectStrings(engine.tools).join(" | ").toLowerCase()
}

/** V2 宿主面：`z.toJSONSchema()` 的输出（计划 §4.2.4 的转换结果）。 */
function v2HygieneBlob() {
  const engine = createEngine({ listToolNames: async () => [], messageCount: async () => 0 })
  const schemas = engine.tools.map((t) => ({
    name: t.name,
    description: t.description,
    input: z.toJSONSchema(z.object(t.args)),
  }))
  return JSON.stringify(schemas).toLowerCase()
}

describe("注入文本卫生：参数化到两宿主（V1 zod 描述 / V2 toJSONSchema 输出）", () => {
  it("清单条数锚定（防止被悄悄改短）", () => {
    assert.equal(FORBIDDEN.length, 24)
  })

  it("V1 zod 面：全部描述 + 参数描述（含嵌套与非枚举 description）逐 token 干净", () => {
    const blob = v1HygieneBlob()
    assert.ok(blob.includes("交付物文件路径"), "该面必须含顶层参数描述——否则断言是空跑")
    assert.ok(blob.includes("真实输出摘要"), "该面必须含嵌套参数描述（evidence.items[].result）——否则深度不够")
    for (const f of FORBIDDEN) assert.ok(!blob.includes(f.toLowerCase()), `V1 工具描述含禁用 token: ${f}`)
  })

  it("V2 toJSONSchema 面：转换后的 JSON Schema 逐 token 干净", () => {
    const blob = v2HygieneBlob()
    assert.ok(blob.includes("交付物文件路径"), "V2 转换面必须保留顶层参数描述——否则断言是空跑")
    assert.ok(blob.includes("真实输出摘要"), "V2 转换面必须保留嵌套参数描述——否则转换丢了描述")
    for (const f of FORBIDDEN) assert.ok(!blob.includes(f.toLowerCase()), `V2 JSON Schema 含禁用 token: ${f}`)
  })

  it("两宿主面覆盖同一份工具定义（不是两条空跑）", () => {
    const v1 = v1HygieneBlob()
    const v2 = v2HygieneBlob()
    for (const name of ["phase_begin", "phase_advance", "delivery_check", "tools_catalog", "tools_help", "dev_router_status", "dev_router_mode"]) {
      assert.ok(v1.includes(name), `V1 面缺工具 ${name}`)
      assert.ok(v2.includes(name), `V2 面缺工具 ${name}`)
    }
  })

  it("判据可失败：禁用 token 注入**真实宿主面**（内存内）后，同一条断言必须 FAIL", () => {
    // ⚠️ 旧版是 `low = "Phase tools: " + FORBIDDEN[0]` 再断言 `low.includes(FORBIDDEN[0])`
    // ——恒真、零信息量（审计点名 T1）。改为咬真实宿主面（V1 zod 面 / V2 JSON Schema 面）。
    const scan = (text) => {
      const low = text.toLowerCase()
      for (const f of FORBIDDEN) {
        if (low.includes(f.toLowerCase())) throw new Error("含禁用 token: " + f)
      }
      return true
    }
    // ① 两个真实宿主面都必须过，且非空（防空跑）
    for (const [name, blob] of [["v1", v1HygieneBlob()], ["v2", v2HygieneBlob()]]) {
      assert.ok(blob.length > 0, `${name} 面非空`)
      assert.ok(scan(blob), `${name} 真实宿主面必须通过`)
    }
    // ② 同一份真实宿主面 + 一个禁用 token ⇒ 同一谓词必须 FAIL
    const v1Real = v1HygieneBlob()
    for (const f of FORBIDDEN) {
      assert.throws(() => scan(v1Real + " " + f), /含禁用 token/, `注入 ${f} 后必须被判据抓到`)
    }
  })

  it("真实注入面（system 文本）逐 token 干净（两宿主同一份引擎文本）", async () => {
    const sid = "ses_seam_hyg"
    const engine = createEngine({ listToolNames: async () => [], messageCount: async () => 0 })
    engine.onSessionObserved({ sessionID: sid, agent: "standard", modelId: "deepseek-v4-pro" })
    await engine.onPrompt({ sessionID: sid, text: TASK })
    await engine.tools.find((t) => t.name === "phase_begin").execute({}, { sessionID: sid })
    const blob = engine.onContextRequest({ sessionID: sid }).system.toLowerCase()
    assert.ok(blob.includes("task: "), "该断言应在已注入任务回显的状态下跑")
    for (const f of FORBIDDEN) assert.ok(!blob.includes(f.toLowerCase()), `system 注入面含禁用 token: ${f}`)
  })
})

/**
 * 工具**返回值**面（不是描述面）：`tools_catalog` / `tools_help` / 技能卡的内容会经
 * 工具返回值进入模型上下文，是独立于「注册描述」的第二条注入路径。
 * v0.5.0 的旧套件扫过这一面（`subagent` 当年就是从 `TOOL_SUMMARIES.task` 这里漏出去的），
 * 故按计划 §4.3「参数化到两宿主」补成两例，不因搬家而丢覆盖。
 */
describe("注入文本卫生：工具返回值面（两宿主各扫一遍）", () => {
  it("V1：真实 hook 下三个工具的返回值逐 token 干净", async () => {
    const hooks = await v1Hooks()
    const sid = "ses_seam_hyg_v1"
    await v1Begin(hooks, sid)
    const parts = [
      await hooks.tool.tools_catalog.execute({}, { sessionID: sid }),
      await hooks.tool.tools_help.execute({ name: "task" }, { sessionID: sid }),
      await hooks.tool.phase_advance.execute({}, { sessionID: sid }),
    ]
    const blob = parts.join("\n").toLowerCase()
    assert.ok(blob.includes("delegate work to a separate context"), "该面必须真的含 task 的摘要（否则断言是空跑）")
    for (const f of FORBIDDEN) assert.ok(!blob.includes(f.toLowerCase()), `V1 工具返回值注入面含禁用 token: ${f}`)
  })

  it("V2：经 transform 注册的真实工具 execute 返回值逐 token 干净", async () => {
    const { hooks, tools } = await v2Boot()
    const sid = "ses_seam_hyg_v2"
    hooks["prompt"]({ sessionID: sid, messageID: "m1", prompt: { text: TASK }, delivery: {} })
    await tools.get("phase_begin").execute({}, { sessionID: sid })
    const parts = [
      (await tools.get("tools_catalog").execute({}, { sessionID: sid })).content,
      (await tools.get("tools_help").execute({ name: "task" }, { sessionID: sid })).content,
      (await tools.get("phase_advance").execute({}, { sessionID: sid })).content,
    ]
    const blob = parts.join("\n").toLowerCase()
    assert.ok(blob.includes("delegate work to a separate context"), "该面必须真的含 task 的摘要（否则断言是空跑）")
    for (const f of FORBIDDEN) assert.ok(!blob.includes(f.toLowerCase()), `V2 工具返回值注入面含禁用 token: ${f}`)
  })
})

// ── R6：V2 用户没装 V1 SDK 时，入口仍必须可加载（部署级判据） ──────────────

/**
 * 缺陷：入口曾**静态** import `./lib/classic` 与 `./lib/host/v1`，两者都从
 * `@opencode-ai/plugin` **取值**导入 `tool`。V2 加载器先解析整个静态模块图再读 `default.id`
 * ⇒ 没装 V1 SDK 的 V2 用户整条加载失败（真运行时 `plugin list` → `No plugins found`）。
 *
 * 判据用**真隔离目录**：只放 `plugins/` 副本 + `node_modules/zod`，**不放** `@opencode-ai/`，
 * 再用 `bun` 加载入口（Node 因无扩展名相对导入加载不了入口，这是已实测的既有限制）。
 * 这是本机能做到的最强形式——它测的是**真实模块解析**，不是静态图推断。
 */
describe("R6 部署判据：V1 SDK 缺失时入口仍可加载（真隔离目录 + bun）", () => {
  const REPO6 = fileURLToPath(new URL("..", import.meta.url))
  const ISO = join(tmpdir(), "router-r6-iso-" + process.pid)

  /**
   * 解析可 spawn 的 bun 可执行文件。
   * ⚠️ 不能直接用 `"bun"`：Windows 上 PATH 里的是 `bun.cmd` / 一个 POSIX sh 包装脚本，
   * `execFileSync` 对它们分别报 ENOENT / EINVAL（实测）。故按顺序探真身：
   *   ① `BUN_BIN` 环境变量（CI 可注入）② npm 全局安装的 `node_modules/bun/bin/bun.exe`
   *   ③ 退回裸 `"bun"`（POSIX 上通常可用）。
   */
  function resolveBun() {
    const candidates = [
      process.env.BUN_BIN,
      join(process.env.APPDATA ?? "", "npm", "node_modules", "bun", "bin", "bun.exe"),
      join(process.env.HOME ?? "", ".bun", "bin", "bun"),
      "bun",
    ].filter(Boolean)
    for (const c of candidates) {
      try {
        const v = execFileSync(c, ["--version"], { encoding: "utf8" }).trim()
        if (/^\d+\.\d+/.test(v)) return { bin: c, version: v }
      } catch { /* 试下一个 */ }
    }
    return null
  }
  const BUN = resolveBun()

  function buildIsolation() {
    rmSync(ISO, { recursive: true, force: true })
    mkdirSync(join(ISO, "node_modules"), { recursive: true })
    cpSync(join(REPO6, "plugins"), join(ISO, "plugins"), { recursive: true })
    // zod 是入口静态图的**真依赖**，必须给；@opencode-ai/ 刻意不给
    cpSync(join(REPO6, "node_modules", "zod"), join(ISO, "node_modules", "zod"), { recursive: true })
  }

  it("bun 可执行文件可解析（否则整组判据无法成立）", () => {
    assert.ok(BUN, "必须能解析到可 spawn 的 bun（设 BUN_BIN 或安装 bun）")
    assert.ok(/^\d+\.\d+/.test(BUN.version), "bun --version 必须回版本号")
  })

  it("隔离目录里确实没有 @opencode-ai（否则判据是空跑）", () => {
    buildIsolation()
    assert.ok(existsSync(join(ISO, "node_modules", "zod")), "隔离环境必须有 zod")
    assert.ok(!existsSync(join(ISO, "node_modules", "@opencode-ai")), "隔离环境必须没有 V1 SDK")
  })

  it("无 V1 SDK 时入口可加载：default.id 正确且 setup/server 都是函数", () => {
    buildIsolation()
    const probe = join(ISO, "probe.mjs")
    writeFileSync(probe, `
      const mod = await import("./plugins/routing-suite.ts")
      const d = mod.default ?? mod
      console.log("PROBE " + JSON.stringify({ id: d?.id ?? null, setup: typeof d?.setup, server: typeof d?.server, keys: Object.keys(d ?? {}) }))
    `, "utf8")
    const out = execFileSync(BUN.bin, ["run", probe], { cwd: ISO, encoding: "utf8" })
    const line = out.split("\n").find((l) => l.startsWith("PROBE "))
    assert.ok(line, "隔离环境里必须打印 PROBE（否则读数是空的）")
    const r = JSON.parse(line.slice("PROBE ".length))
    assert.equal(r.id, "opencode-routing-suite", "无 V1 SDK 时也必须读到正确的 default.id")
    assert.equal(r.setup, "function", "V2 侧 setup 必须是函数")
    assert.equal(r.server, "function", "V1 侧 server 仍必须是函数（readV1Plugin 要求）")
  })

  it("入口的静态导入图不含 V1 SDK 的值导入（结构判据，与上一条互为印证）", () => {
    const src = readFileSync(join(REPO6, "plugins", "routing-suite.ts"), "utf8")
    const staticLines = src.split("\n").filter((l) => /^\s*import\s/.test(l))
    assert.ok(staticLines.some((l) => l.includes("type Plugin")), "类型导入应保留（编译期擦除）")
    assert.ok(!staticLines.some((l) => /import\s*\{[^}]*\btool\b/.test(l)), "静态图不得取值导入 tool")
    assert.ok(!staticLines.some((l) => l.includes("./lib/classic")), "classic 不得在静态图里")
    assert.ok(!staticLines.some((l) => l.includes("./lib/host/v1")), "host/v1 不得在静态图里")
    assert.ok(/await import\("\.\/lib\/classic"\)/.test(src), "classic 必须是惰性 import")
    assert.ok(/await import\("\.\/lib\/host\/v1"\)/.test(src), "host/v1 必须是惰性 import")
  })

  it("V1 不回归：server() 仍返回含 chat.message / tool.execute.after 的 hooks", () => {
    // ⚠️ V1 侧**本来就需要** V1 SDK ⇒ 这条在**仓库根**跑（那里有 @opencode-ai/plugin），
    // 不在隔离目录跑。隔离目录那条只证明「V2 不需要 V1 SDK」，两条各管一件事。
    buildIsolation()
    const probe = join(ISO, "probe-v1.mjs")
    writeFileSync(probe, `
      const mod = await import(${JSON.stringify(join(REPO6, "plugins", "routing-suite.ts").replace(/\\/g, "/"))})
      const client = { session: { messages: async () => ({ data: [] }) }, tool: { ids: async () => ({ data: ["read"] }) } }
      const hooks = await mod.default.server({ client, directory: ".", worktree: ".", project: {}, serverUrl: new URL("http://x"), experimental_workspace: { register() {} }, $: () => {} })
      console.log("PROBE " + JSON.stringify({ keys: Object.keys(hooks).sort(), tools: Object.keys(hooks.tool ?? {}).sort() }))
    `, "utf8")
    const out = execFileSync(BUN.bin, ["run", probe], { cwd: REPO6, encoding: "utf8" })
    const line = out.split("\n").find((l) => l.startsWith("PROBE "))
    assert.ok(line, "必须打印 PROBE")
    const r = JSON.parse(line.slice("PROBE ".length))
    assert.ok(r.keys.includes("chat.message"), "V1 hooks 必须含 chat.message")
    assert.ok(r.keys.includes("tool.execute.after"), "V1 hooks 必须含 tool.execute.after")
    assert.equal(r.tools.length, 7, "V1 侧必须注册 7 个工具")
  })
})

// ── 公开仓库卫生：不得出现本机工作区痕迹 ────────────────────────────────

/**
 * 本仓库是**公开仓库**（发布到远端），而证据目录在仓库**外**
 * （`git ls-files | grep` 该前缀 = 0）⇒ 证据档永不发布。故公开文档里出现本机路径
 * （维护者盘符 + 本机目录名、管理员目录名、证据目录前缀）对任何读者都是死链，
 * 还暴露维护者本机目录结构。这类错误靠人盯不复现，故加机械守卫。
 *
 * ⚠️ **本文件自身不得含被判模式的字面量**（否则提交后本文件会被自己判红——
 * 实测：本文件起初是**未跟踪**状态，`git ls-files` 跳过它，判据才"绿"；
 * 一旦 `git add`，它就会命中自己）。故下面所有模式与自证样例都用
 * **片段拼接**构造，源码里不存在任何完整的目标字面量。
 *
 * ⚠️ **盘符模式必须锚定**：要求「单个盘符字母 + 反斜杠 + 已知目录名」。
 * 宽松的「盘符 + 任意斜杠」会把 `http://` 也匹配上——实测假阳性两处：
 * `NOTICE` 的上游仓库 URL、`router-bootstrap.mjs` 的 `http(s)://` 说明串。
 * 本判据只认**反斜杠**形态，故 `http(s)://` 天然不匹配。
 *
 * ⚠️ **驱动方式**：`git ls-files` 逐文件读，**不用** `grep -r … --include=…` 递归写法
 * （实测该写法在本环境给出过假的"零命中"：同一模式单文件能命中、递归却报空）。
 * 逐文件 `readFileSync` + 正则 `test` 不经过 shell，故无转义陷阱
 * （shell 里带双反斜杠的 ERE 经此环境会退化成匹配单反斜杠，实测 MISS）。
 */
describe("公开仓库卫生：跟踪文件内不得出现本机工作区痕迹", () => {
  const REPO7 = fileURLToPath(new URL("..", import.meta.url))

  /** 反斜杠字符（用码点构造，避免源码里出现转义歧义）。 */
  const BS = String.fromCharCode(92)
  /** 证据目录前缀 / 本机盘符目录名等，全部片段拼接——见上方注记。 */
  const DSH_PREFIX = "." + "dsh" + "/"
  const PROBE_DIR = "work" + "_2" + "/"
  const RECON_DIR = "tmp-oc2" + "-recon" + "/"
  const ADMIN_DIR = "/Admin" + "istrator" + "/"
  const DRIVE_DIRS = "(work|Users|Program)"

  /** 本机痕迹模式集（锚定，见上方注记）。 */
  const LOCAL_TRACE_PATTERNS = [
    { name: "证据目录前缀", re: new RegExp("\\." + "dsh" + "/") },
    { name: "盘符+反斜杠+目录名", re: new RegExp("[A-Za-z]:" + BS + BS + DRIVE_DIRS, "i") },
    { name: "盘符+斜杠+目录名", re: new RegExp("[A-Za-z]:" + "/" + DRIVE_DIRS, "i") },
    { name: "本机工作区目录", re: new RegExp("work" + "_2" + "/") },
    { name: "本机侦察目录", re: new RegExp("tmp-oc2" + "-recon" + "/") },
    { name: "管理员目录", re: new RegExp("/Admin" + "istrator" + "/") },
  ]

  /**
   * 已知**合法**豁免项（命中不判缺陷）。每条给理由，勿删：
   *   · `scripts/upstream/router-bootstrap.mjs` —— **上游快照原文**，含
   *     `C:` + 反斜杠 + `Program Files` + 反斜杠 + `Git` + 反斜杠 + `bin` 等
   *     **通用** Windows 候选路径（非本机特有信息），且该文件有 **CI 字节级守护**
   *     （`provenance.json` 的 `enforced`），改它即破坏快照契约。
   *   · `NOTICE` 里的上游仓库 URL —— 由「盘符模式锚定」天然排除，无需豁免。
   */
  const EXEMPT = new Set(["scripts/upstream/router-bootstrap.mjs"])

  /** 扫全部**被跟踪**文件，返回命中行。 */
  function scanTrackedFiles() {
    const files = execFileSync("git", ["ls-files"], { cwd: REPO7, encoding: "utf8" })
      .split(/\r?\n/)
      .filter((f) => f && !f.includes("node_modules"))

    const hits = []
    for (const f of files) {
      if (EXEMPT.has(f)) continue
      let text
      try { text = readFileSync(join(REPO7, f), "utf8") } catch { continue }
      text.split(/\r?\n/).forEach((l, i) => {
        for (const p of LOCAL_TRACE_PATTERNS) {
          if (p.re.test(l)) {
            hits.push(`${f}:${i + 1} [${p.name}] ${l.trim().slice(0, 110)}`)
            break
          }
        }
      })
    }
    return { files, hits }
  }

  it("被跟踪文件零命中本机痕迹（含判据自证：合成的痕迹必须被报出，上游 URL 不得误报）", () => {
    // ── 第一步：判据自证（先跑，故红灯先暴露"判据坏了"而不是"仓库脏了"） ──
    const mustHit = [
      "D:" + BS + "work" + "_2" + BS + "some-checkout",
      "path C:" + BS + "Users" + BS + "x",
      "path C:" + "/Users" + "/x",
      "see `" + DSH_PREFIX + "evidence/foo.md`",
      RECON_DIR + "probe",
      ADMIN_DIR + "x",
    ]
    for (const s of mustHit) {
      assert.ok(
        LOCAL_TRACE_PATTERNS.some((p) => p.re.test(s)),
        `该串必须被判为痕迹: ${s}`,
      )
    }
    // 反例：合法内容不得误报（否则判据永远假阳性）
    const mustNotHit = [
      "https:" + "/" + "/github.com/yjh051108/dsh-routing-suite",
      "http(s):" + "/" + "/ / file:" + "/" + "/ 裸路径",
      "`preset/router-standard/{router-core.mjs, router-bootstrap.mjs}`",
    ]
    for (const s of mustNotHit) {
      assert.ok(
        !LOCAL_TRACE_PATTERNS.some((p) => p.re.test(s)),
        `合法串不得被判为痕迹（假阳性）: ${s}`,
      )
    }
    assert.ok(EXEMPT.has("scripts/upstream/router-bootstrap.mjs"), "上游快照豁免必须仍在册")

    // ── 第二步：判据真的能覆盖本文件（自证"提交后不会自判红"） ──
    const selfText = readFileSync(fileURLToPath(import.meta.url), "utf8")
    assert.deepEqual(
      selfText.split(/\r?\n/).filter((l) => LOCAL_TRACE_PATTERNS.some((p) => p.re.test(l))),
      [],
      "本文件自身不得含被判字面量——否则它一旦被 git add 就会判自己红",
    )

    // ── 第三步：真扫全部被跟踪文件 ──
    const { files, hits } = scanTrackedFiles()
    assert.ok(files.length > 10, `必须真的扫到文件（实扫 ${files.length} 个）——否则断言是空跑`)
    assert.deepEqual(hits, [], "公开仓库内不得出现本机工作区痕迹")
  })
})
