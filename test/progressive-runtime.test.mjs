import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

/**
 * 运行时行为测试（I1/I5/I7/I8 的真实链路，不只是纯函数单测）。
 * 驱动的是真实插件实现 `progressiveImpl`（Node 22 直接 import .ts，类型擦除），
 * 走的是真实 hook 与真实工具 execute，不需要 opencode host。
 *
 * 状态文件必须在 import 之前改向：progressive.ts 模块顶层就 loadStages()。
 */
const DIR = mkdtempSync(join(tmpdir(), "router-rt-"))
const STAGE_FILE = join(DIR, "stages.json")
process.env.OPENCODE_ROUTER_STAGE_FILE = STAGE_FILE
process.env.OPENCODE_ROUTER_AUTO = "0"
delete process.env.OPENCODE_ROUTER_CRASH_TEST

const { progressiveImpl } = await import("../plugins/lib/progressive.ts")
const core = await import("../plugins/lib/router-core.mjs")

const SID = "ses_rt_main"
const SID2 = "ses_rt_manual"

const client = {
  session: { messages: async () => ({ data: [] }) },
  tool: { ids: async () => ({ data: Object.keys(core.TOOL_SUMMARIES) }) },
}

const hooks = await progressiveImpl({ client })

const userMsg = (text) => ({
  info: { role: "user", sessionID: SID, agent: "standard", model: { modelID: "deepseek-v4-pro" } },
  parts: [{ type: "text", text }],
})
const asstMsg = (...parts) => ({ info: { role: "assistant", sessionID: SID }, parts })
const toolPart = (callID, tool) => ({
  type: "tool",
  callID,
  tool,
  state: { status: "completed", input: {}, output: "ok", title: tool, metadata: {}, time: { start: 1, end: 2 } },
})
const sysOut = () => ({ system: ["BASE SYSTEM PROMPT"] })
const sysText = async () => {
  const out = sysOut()
  await hooks["experimental.chat.system.transform"]({ sessionID: SID, model: { modelID: "deepseek-v4-pro" } }, out)
  return out.system[0]
}
const pushMessages = async (messages) => {
  await hooks["experimental.chat.messages.transform"]({}, { messages })
}
const diskState = () => JSON.parse(readFileSync(STAGE_FILE, "utf8")).sessions
const stageOf = (sid = SID) => diskState()[sid]?.stage

const TASK = "帮我写一个能跑的脚本"

describe("I1 运行时：完成信号驱动晋级（真实 hook + 真实工具）", () => {
  it("1) 未确认时 system 只有 RL 句", async () => {
    await hooks["chat.message"]({ sessionID: SID, model: { modelID: "deepseek-v4-pro" } }, { message: {}, parts: [{ type: "text", text: TASK }] })
    await pushMessages([userMsg(TASK)])
    assert.equal(await sysText(), core.RL_PERSONA)
  })

  it("2) phase_begin 确认后注入声明 + 主动性 + 阶段文本（含 Task: 回显）", async () => {
    const r = await hooks.tool.phase_begin.execute({}, { sessionID: SID })
    assert.ok(r.includes("Session started"))
    assert.ok(r.includes(core.PROGRESSIVE_DECL))
    assert.ok(r.includes("Task: " + TASK))
    const text = await sysText()
    assert.ok(text.startsWith(core.RL_PERSONA))
    assert.ok(text.includes(core.PROGRESSIVE_DECL))
    assert.ok(text.includes("Task: " + TASK), "system 注入面必须有任务回显")
    assert.ok(text.includes("Current phase: Understanding"))
  })

  it("3) 读工具调完不晋级（No alignment, no advancement）", async () => {
    await pushMessages([userMsg(TASK), asstMsg(toolPart("c-read", "read"))])
    assert.equal(stageOf(), 0)
  })

  it("4) question 是阶段 0 的完成信号 → 自动晋级到 1，并落盘 lastAdvance", async () => {
    await pushMessages([userMsg(TASK), asstMsg(toolPart("c-read", "read"), toolPart("c-q", "question"))])
    assert.equal(stageOf(), 1)
    assert.equal(diskState()[SID].lastAdvance.reason, "auto:question")
    assert.ok(Number.isFinite(diskState()[SID].lastAdvance.at))
  })

  it("5) 幂等：同一批调用重复出现不再晋级（按 callID 记账）", async () => {
    await pushMessages([userMsg(TASK), asstMsg(toolPart("c-read", "read"), toolPart("c-q", "question"))])
    await pushMessages([userMsg(TASK), asstMsg(toolPart("c-read", "read"), toolPart("c-q", "question"))])
    assert.equal(stageOf(), 1)
  })

  it("6) 阶段 1 只有 todowrite 晋级", async () => {
    await pushMessages([userMsg(TASK), asstMsg(toolPart("c-read", "read"), toolPart("c-q", "question"))])
    await pushMessages([userMsg(TASK), asstMsg(toolPart("c-edit0", "edit"))])
    assert.equal(stageOf(), 1, "开发工具不得在阶段 1 晋级（旧语义已删）")
    await pushMessages([userMsg(TASK), asstMsg(toolPart("c-todo", "todowrite"))])
    assert.equal(stageOf(), 2)
    assert.equal(diskState()[SID].lastAdvance.reason, "auto:todowrite")
  })

  it("7) 阶段 2 只有 delivery_check 晋级（bash 不再跳级）", async () => {
    await pushMessages([userMsg(TASK), asstMsg(toolPart("c-bash", "bash"))])
    assert.equal(stageOf(), 2, "bash 不得晋级（旧语义已删）")
    await pushMessages([userMsg(TASK), asstMsg(toolPart("c-deliv", "delivery_check"))])
    assert.equal(stageOf(), 3)
    assert.equal(diskState()[SID].lastAdvance.reason, "auto:delivery_check")
  })

  it("8) 晋级后 system 注入面切到交付门文本，并保持 Task 回显", async () => {
    const text = await sysText()
    assert.ok(text.includes("Current phase: Verification"))
    assert.ok(text.includes("Delivery evidence gate"))
    assert.ok(text.includes("Task: " + TASK))
  })

  it("9) dev_router_status 展示 lastAdvance（可回答「我为什么在第 N 阶段」）", async () => {
    const s = await hooks.tool.dev_router_status.execute({}, { sessionID: SID })
    assert.ok(s.includes("会话 stage: 3/3 Verification"))
    assert.ok(/lastAdvance: \d{4}-\d{2}-\d{2}T/.test(s), "lastAdvance 必须是 ISO 时刻")
    assert.ok(s.includes("(auto:delivery_check)"))
  })
})

describe("I7/I8 运行时：显式闯关卡 + lastAdvance 闭环", () => {
  it("phase_advance 返回 New this stage / Next goal，并记录 reason；无 Pre-unlocked（死代码不移植）", async () => {
    await hooks.tool.phase_begin.execute({}, { sessionID: SID2 })
    const r = await hooks.tool.phase_advance.execute({ reason: "vet-plan" }, { sessionID: SID2 })
    assert.ok(r.includes("advanced to phase 1: Planning"))
    assert.ok(r.includes("Next goal: Planning"))
    assert.ok(!r.includes("Pre-unlocked"), "上游 Pre-unlocked 行是死代码，不得移植")
    assert.equal(diskState()[SID2].stage, 1)
    assert.deepEqual(diskState()[SID2].lastAdvance.reason, "vet-plan")
    const s = await hooks.tool.dev_router_status.execute({}, { sessionID: SID2 })
    assert.ok(s.includes("(vet-plan)"))
  })

  it("技能卡逐工具带摘要（上游 :812-815 card()：`<名> — <首句截 46 字>`，` | ` 分隔）", async () => {
    const sid = "ses_rt_card"
    await hooks.tool.phase_begin.execute({}, { sessionID: sid })
    const r = await hooks.tool.phase_advance.execute({}, { sessionID: sid })
    const line = r.split("\n").find((l) => l.startsWith("New this stage:"))
    assert.equal(line, "New this stage: todowrite — write/update the todo list | task — delegate work to a separate context")
  })

  it("摘要超 46 字按上游 slice(0, 46) 截断（边界例）", async () => {
    const sid = "ses_rt_card46"
    const saved = core.TOOL_SUMMARIES.todowrite
    core.TOOL_SUMMARIES.todowrite = "z".repeat(60)
    try {
      await hooks.tool.phase_begin.execute({}, { sessionID: sid })
      const r = await hooks.tool.phase_advance.execute({}, { sessionID: sid })
      const first = r.split("\n").find((l) => l.startsWith("New this stage:")).split(" | ")[0]
      assert.equal(first, "New this stage: todowrite — " + "z".repeat(46))
    } finally {
      core.TOOL_SUMMARIES.todowrite = saved
    }
  })

  it("摘要只取首句（上游 split(/\\n|\\. /)[0]）", async () => {
    const sid = "ses_rt_card_sentence"
    const saved = core.TOOL_SUMMARIES.todowrite
    core.TOOL_SUMMARIES.todowrite = "first sentence. second sentence that is long"
    try {
      await hooks.tool.phase_begin.execute({}, { sessionID: sid })
      const r = await hooks.tool.phase_advance.execute({}, { sessionID: sid })
      const first = r.split("\n").find((l) => l.startsWith("New this stage:")).split(" | ")[0]
      assert.equal(first, "New this stage: todowrite — first sentence")
    } finally {
      core.TOOL_SUMMARIES.todowrite = saved
    }
  })

  it("摘要缺失时只给工具名，不产生 ` — ` 空摘要（上游 found ? … : '' 分支）", async () => {
    const sid = "ses_rt_card_missing"
    const saved = core.TOOL_SUMMARIES.todowrite
    delete core.TOOL_SUMMARIES.todowrite
    try {
      await hooks.tool.phase_begin.execute({}, { sessionID: sid })
      const r = await hooks.tool.phase_advance.execute({}, { sessionID: sid })
      const first = r.split("\n").find((l) => l.startsWith("New this stage:")).split(" | ")[0]
      assert.equal(first, "New this stage: todowrite")
    } finally {
      core.TOOL_SUMMARIES.todowrite = saved
    }
  })

  it("未确认会话调 phase_advance 被拒（先 phase_begin）", async () => {
    const r = await hooks.tool.phase_advance.execute({}, { sessionID: "ses_rt_unknown" })
    assert.equal(r, "Session not started: call phase_begin first.")
  })
})

describe("I1 runtime 边界：工具名不进入完成信号表", () => {
  it("task 在阶段 0 不晋级（上游 completion-signal 表里没有它）", async () => {
    const sid = "ses_rt_task"
    await hooks["experimental.chat.messages.transform"]({}, {
      messages: [{ info: { role: "user", sessionID: sid, agent: "standard", model: { modelID: "deepseek-v4-pro" } }, parts: [{ type: "text", text: "x" }] }],
    })
    await hooks.tool.phase_begin.execute({}, { sessionID: sid })
    await pushMessagesFor(sid, [toolPart("t1", "task"), toolPart("t2", "read")])
    assert.equal(diskState()[sid].stage, 0)
  })
})

async function pushMessagesFor(sid, parts) {
  await hooks["experimental.chat.messages.transform"]({}, {
    messages: [
      { info: { role: "user", sessionID: sid, agent: "standard", model: { modelID: "deepseek-v4-pro" } }, parts: [{ type: "text", text: "x" }] },
      { info: { role: "assistant", sessionID: sid }, parts },
    ],
  })
}

describe("I5 运行时：delivery_check numeric 证据 + 非阻塞 hint", () => {
  const target = join(DIR, "artifact.txt")
  writeFileSync(target, "hello\n", "utf8")

  it("numeric 数值证据 → PASS（无 hint）", async () => {
    const r = await hooks.tool.delivery_check.execute({
      file: target,
      evidence: { items: [{ label: "inv", kind: "numeric", result: "12" }] },
    }, { sessionID: SID })
    assert.ok(r.includes("delivery-check: PASS"), r)
    assert.ok(!r.includes("hint (non-blocking)"))
  })

  it("缺 numeric → PASS 且打印非阻塞 hint（上游 v1.28）", async () => {
    const r = await hooks.tool.delivery_check.execute({
      file: target,
      evidence: { items: [{ label: "assert", kind: "text", result: "grep hit: hello" }] },
    }, { sessionID: SID })
    assert.ok(r.includes("delivery-check: PASS"), r)
    assert.ok(r.includes("hint (non-blocking)"))
    assert.ok(r.includes("kind=numeric"))
  })

  it("上游示例 minr=2.07 → FAIL（不移植那个错例子）", async () => {
    const r = await hooks.tool.delivery_check.execute({
      file: target,
      evidence: { items: [{ label: "inv", kind: "numeric", result: "minr=2.07" }] },
    }, { sessionID: SID })
    assert.ok(r.includes("delivery-check: FAIL"), r)
    assert.ok(r.includes("numeric result"))
  })
})

describe("I2/I6 tools_help 运行时：引导而非打回", () => {
  it("未知工具指路到阶段分配问题，而不是让它找绕过", async () => {
    const r = await hooks.tool.tools_help.execute({ name: "totally_unknown_tool" }, { sessionID: SID })
    assert.ok(r.includes("不在本插件的阶段表里"))
    assert.ok(r.includes("而不是寻求绕过"))
  })
  it("已知工具仍给阶段归属", async () => {
    const r = await hooks.tool.tools_help.execute({ name: "todowrite" }, { sessionID: SID })
    assert.ok(r.includes("phase: Planning (1/3)"))
  })
})

describe("注入文本卫生（运行时面）：真实注册面也不含平台不存在的指名", () => {
  // 与 router-core.test.mjs 的纯文本面断言互补：这里扫的是**真实注册出去的工具描述 + 真实 system 注入串 +
  // 真实工具返回值里会进注入面的那几处（tools_catalog / tools_help / phase_advance 技能卡）**
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
   *  属性 `description`，`JSON.stringify` 与只读 `Object.keys` 都会漏掉它（T13 实测：
   *  往参数描述里塞 `subagent` 时，两个套件曾全绿）。
   *  ⚠️ 深度上限必须够大（这里 40）：嵌套参数（`evidence.items[].result`）在 zod 内部树里比
   *  顶层参数深得多，上限 10 会漏掉它（同一实测）。 */
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
  it("hooks.tool 的全部描述 + 参数描述（含嵌套与非枚举 description）逐 token 干净", () => {
    const blob = collectStrings(hooks.tool).join(" | ").toLowerCase()
    assert.ok(blob.includes("交付物文件路径"), "该面必须含顶层参数描述——否则断言是空跑")
    assert.ok(blob.includes("真实输出摘要"), "该面必须含嵌套参数描述（evidence.items[].result）——否则深度不够")
    for (const f of FORBIDDEN) assert.ok(!blob.includes(f.toLowerCase()), `工具描述含禁用 token: ${f}`)
  })
  it("真实 system 注入面（RL 句 + 声明 + 主动性 + 阶段文本 + Task 回显）逐 token 干净", async () => {
    const blob = (await sysText()).toLowerCase()
    assert.ok(blob.includes("task: "), "该断言应在已注入任务回显的状态下跑")
    for (const f of FORBIDDEN) assert.ok(!blob.includes(f.toLowerCase()), `system 注入面含禁用 token: ${f}`)
  })
  it("真实工具返回值里会进注入面的三处（tools_catalog / tools_help / 技能卡）逐 token 干净", async () => {
    const sid = "ses_rt_hygiene"
    await hooks.tool.phase_begin.execute({}, { sessionID: sid })
    const parts = [
      await hooks.tool.tools_catalog.execute({}, { sessionID: sid }),
      await hooks.tool.tools_help.execute({ name: "task" }, { sessionID: sid }),
      await hooks.tool.phase_advance.execute({}, { sessionID: sid }),
    ]
    const blob = parts.join("\n").toLowerCase()
    assert.ok(blob.includes("delegate work to a separate context"), "该面必须真的含 task 的摘要（否则断言是空跑）")
    for (const f of FORBIDDEN) assert.ok(!blob.includes(f.toLowerCase()), `工具返回值注入面含禁用 token: ${f}`)
  })
})
