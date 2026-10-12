import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

/**
 * 引擎语义测试（计划 §4.3 第一层「引擎语义」）。
 *
 * 驱动面从「真实 V1 hook」换成**中立事件**（计划 §4.2.1/§4.3）：
 *   onPrompt / onSessionObserved / onToolCompleted / onContextRequest。
 * 晋级触发器已从「消息 part 面」搬到**逐调用工具完成事件**，故断言几乎原样、
 * 驱动方式换掉。宿主接线本身由 `test/host-seam.test.mjs` 的两宿主用例覆盖。
 *
 * 状态文件必须在 import 之前改向：engine.ts 模块顶层就 loadStages()。
 */
const DIR = mkdtempSync(join(tmpdir(), "router-eng-"))
const STAGE_FILE = join(DIR, "stages.json")
process.env.OPENCODE_ROUTER_STAGE_FILE = STAGE_FILE
process.env.OPENCODE_ROUTER_AUTO = "0"
delete process.env.OPENCODE_ROUTER_CRASH_TEST
delete process.env.OPENCODE_ROUTER_GATE

const { createEngine } = await import("../plugins/lib/engine.ts")
const core = await import("../plugins/lib/router-core.mjs")

const SID = "ses_eng_main"
const SID2 = "ses_eng_manual"
const TASK = "帮我写一个能跑的脚本"

const host = {
  listToolNames: async () => Object.keys(core.TOOL_SUMMARIES),
  messageCount: async () => 0,
}
const engine = createEngine(host)
const toolOf = (name) => engine.tools.find((t) => t.name === name)

const diskState = () => JSON.parse(readFileSync(STAGE_FILE, "utf8")).sessions
const stageOf = (sid = SID) => diskState()[sid]?.stage
const seen = (sid, agent = "standard", modelId = "deepseek-v4-pro") =>
  engine.onSessionObserved({ sessionID: sid, agent, modelId })
const sysText = (sid = SID) => engine.onContextRequest({ sessionID: sid })?.system
const done = (sid, name, callID) => engine.onToolCompleted({ sessionID: sid, toolName: name, callID })
/**
 * 打开**新一轮**的晋级额度（R8：每轮最多 +1，轮边界 = **一次模型请求**）。
 * 与旧实现的对应关系：旧的 `pushMessages`（= 一次模型请求）天然构成一批，一批只判一次；
 * R1 把驱动换成逐调用后丢掉了这个边界，R7 先用 prompt 边界补回（**过粗**），
 * R8 按裁定改回**每请求**边界——与 HEAD 的测试粒度一致。
 */
const nextRound = (sid) => engine.onContextRequest({ sessionID: sid })

describe("I1 引擎：完成信号驱动晋级（中立事件 + 真实工具 execute）", () => {
  it("1) 未确认时 system 只有 RL 句", async () => {
    seen(SID)
    await engine.onPrompt({ sessionID: SID, modelId: "deepseek-v4-pro", text: TASK })
    assert.equal(sysText(), core.RL_PERSONA)
  })

  it("2) phase_begin 确认后注入声明 + 主动性 + 阶段文本（含 Task: 回显）", async () => {
    const r = await toolOf("phase_begin").execute({}, { sessionID: SID })
    assert.ok(r.includes("Session started"))
    assert.ok(r.includes(core.PROGRESSIVE_DECL))
    assert.ok(r.includes("Task: " + TASK))
    const text = sysText()
    assert.ok(text.startsWith(core.RL_PERSONA))
    assert.ok(text.includes(core.PROGRESSIVE_DECL))
    assert.ok(text.includes("Task: " + TASK), "system 注入面必须有任务回显")
    assert.ok(text.includes("Current phase: Understanding"))
  })

  it("3) 读工具调完不晋级（No alignment, no advancement）", () => {
    done(SID, "read", "c-read")
    assert.equal(stageOf(), 0)
  })

  it("4) question 是阶段 0 的完成信号 → 自动晋级到 1，并落盘 lastAdvance", () => {
    done(SID, "question", "c-q")
    assert.equal(stageOf(), 1)
    assert.equal(diskState()[SID].lastAdvance.reason, "auto:question")
    assert.ok(Number.isFinite(diskState()[SID].lastAdvance.at))
  })

  it("5) 幂等：同一 callID 重复到达不再晋级（按 callID 记账）", async () => {
    // 自带前置（不依赖本文件前面的用例把 stage 推到 1）：否则单跑本用例会假红/假绿
    const sid = "ses_eng_idem"
    seen(sid)
    await toolOf("phase_begin").execute({}, { sessionID: sid })
    done(sid, "question", "c-idem")
    assert.equal(stageOf(sid), 1, "前置：一次 question 完成应晋级到 1")
    done(sid, "question", "c-idem")
    done(sid, "question", "c-idem")
    assert.equal(stageOf(sid), 1, "同 callID 重复到达不得再晋级")
  })

  it("6) 阶段 1 只有 todowrite 晋级", async () => {
    done(SID, "edit", "c-edit0")
    assert.equal(stageOf(), 1, "开发工具不得在阶段 1 晋级（旧语义已删）")
    await nextRound(SID) // 新一轮才重新开放晋级额度（R7：每轮最多 +1）
    done(SID, "todowrite", "c-todo")
    assert.equal(stageOf(), 2)
    assert.equal(diskState()[SID].lastAdvance.reason, "auto:todowrite")
  })

  it("7) 阶段 2 只有 delivery_check 晋级（bash 不再跳级）", async () => {
    done(SID, "bash", "c-bash")
    assert.equal(stageOf(), 2, "bash 不得晋级（旧语义已删）")
    await nextRound(SID)
    done(SID, "delivery_check", "c-deliv")
    assert.equal(stageOf(), 3)
    assert.equal(diskState()[SID].lastAdvance.reason, "auto:delivery_check")
  })

  it("8) 晋级后 system 注入面切到交付门文本，并保持 Task 回显", () => {
    const text = sysText()
    assert.ok(text.includes("Current phase: Verification"))
    assert.ok(text.includes("Delivery evidence gate"))
    assert.ok(text.includes("Task: " + TASK))
  })

  it("9) dev_router_status 展示 lastAdvance（可回答「我为什么在第 N 阶段」）", async () => {
    const s = await toolOf("dev_router_status").execute({}, { sessionID: SID })
    assert.ok(s.includes("会话 stage: 3/3 Verification"))
    assert.ok(/lastAdvance: \d{4}-\d{2}-\d{2}T/.test(s), "lastAdvance 必须是 ISO 时刻")
    assert.ok(s.includes("(auto:delivery_check)"))
  })
})

describe("I7/I8 引擎：显式闯关卡 + lastAdvance 闭环", () => {
  it("phase_advance 返回 New this stage / Next goal，并记录 reason；无 Pre-unlocked（死代码不移植）", async () => {
    await toolOf("phase_begin").execute({}, { sessionID: SID2 })
    const r = await toolOf("phase_advance").execute({ reason: "vet-plan" }, { sessionID: SID2 })
    assert.ok(r.includes("advanced to phase 1: Planning"))
    assert.ok(r.includes("Next goal: Planning"))
    assert.ok(!r.includes("Pre-unlocked"), "上游 Pre-unlocked 行是死代码，不得移植")
    assert.equal(diskState()[SID2].stage, 1)
    assert.deepEqual(diskState()[SID2].lastAdvance.reason, "vet-plan")
    const s = await toolOf("dev_router_status").execute({}, { sessionID: SID2 })
    assert.ok(s.includes("(vet-plan)"))
  })

  it("技能卡逐工具带摘要（上游 :812-815 card()：`<名> — <首句截 46 字>`，` | ` 分隔）", async () => {
    const sid = "ses_eng_card"
    await toolOf("phase_begin").execute({}, { sessionID: sid })
    const r = await toolOf("phase_advance").execute({}, { sessionID: sid })
    const line = r.split("\n").find((l) => l.startsWith("New this stage:"))
    assert.equal(line, "New this stage: todowrite — write/update the todo list | task — delegate work to a separate context")
  })

  it("摘要超 46 字按上游 slice(0, 46) 截断（边界例）", async () => {
    const sid = "ses_eng_card46"
    const saved = core.TOOL_SUMMARIES.todowrite
    core.TOOL_SUMMARIES.todowrite = "z".repeat(60)
    try {
      await toolOf("phase_begin").execute({}, { sessionID: sid })
      const r = await toolOf("phase_advance").execute({}, { sessionID: sid })
      const first = r.split("\n").find((l) => l.startsWith("New this stage:")).split(" | ")[0]
      assert.equal(first, "New this stage: todowrite — " + "z".repeat(46))
    } finally {
      core.TOOL_SUMMARIES.todowrite = saved
    }
  })

  it("摘要只取首句（上游 split(/\\n|\\. /)[0]）", async () => {
    const sid = "ses_eng_card_sentence"
    const saved = core.TOOL_SUMMARIES.todowrite
    core.TOOL_SUMMARIES.todowrite = "first sentence. second sentence that is long"
    try {
      await toolOf("phase_begin").execute({}, { sessionID: sid })
      const r = await toolOf("phase_advance").execute({}, { sessionID: sid })
      const first = r.split("\n").find((l) => l.startsWith("New this stage:")).split(" | ")[0]
      assert.equal(first, "New this stage: todowrite — first sentence")
    } finally {
      core.TOOL_SUMMARIES.todowrite = saved
    }
  })

  it("摘要缺失时只给工具名，不产生 ` — ` 空摘要（上游 found ? … : '' 分支）", async () => {
    const sid = "ses_eng_card_missing"
    const saved = core.TOOL_SUMMARIES.todowrite
    delete core.TOOL_SUMMARIES.todowrite
    try {
      await toolOf("phase_begin").execute({}, { sessionID: sid })
      const r = await toolOf("phase_advance").execute({}, { sessionID: sid })
      const first = r.split("\n").find((l) => l.startsWith("New this stage:")).split(" | ")[0]
      assert.equal(first, "New this stage: todowrite")
    } finally {
      core.TOOL_SUMMARIES.todowrite = saved
    }
  })

  it("未确认会话调 phase_advance 被拒（先 phase_begin）", async () => {
    const r = await toolOf("phase_advance").execute({}, { sessionID: "ses_eng_unknown" })
    assert.equal(r, "Session not started: call phase_begin first.")
  })
})

describe("I1 引擎边界：工具名不进入完成信号表", () => {
  it("task 在阶段 0 不晋级（上游 completion-signal 表里没有它）", async () => {
    const sid = "ses_eng_task"
    seen(sid)
    await toolOf("phase_begin").execute({}, { sessionID: sid })
    done(sid, "task", "t1")
    done(sid, "read", "t2")
    assert.equal(diskState()[sid].stage, 0)
  })
})

describe("I5 引擎：delivery_check numeric 证据 + 非阻塞 hint", () => {
  const target = join(DIR, "artifact.txt")
  writeFileSync(target, "hello\n", "utf8")

  it("numeric 数值证据 → PASS（无 hint）", async () => {
    const r = await toolOf("delivery_check").execute({
      file: target,
      evidence: { items: [{ label: "inv", kind: "numeric", result: "12" }] },
    }, { sessionID: SID })
    assert.ok(r.includes("delivery-check: PASS"), r)
    assert.ok(!r.includes("hint (non-blocking)"))
  })

  it("缺 numeric → PASS 且打印非阻塞 hint（上游 v1.28）", async () => {
    const r = await toolOf("delivery_check").execute({
      file: target,
      evidence: { items: [{ label: "assert", kind: "text", result: "grep hit: hello" }] },
    }, { sessionID: SID })
    assert.ok(r.includes("delivery-check: PASS"), r)
    assert.ok(r.includes("hint (non-blocking)"))
    assert.ok(r.includes("kind=numeric"))
  })

  it("上游示例 minr=2.07 → FAIL（不移植那个错例子）", async () => {
    const r = await toolOf("delivery_check").execute({
      file: target,
      evidence: { items: [{ label: "inv", kind: "numeric", result: "minr=2.07" }] },
    }, { sessionID: SID })
    assert.ok(r.includes("delivery-check: FAIL"), r)
    assert.ok(r.includes("numeric result"))
  })
})

describe("I2/I6 引擎 tools_help：引导而非打回", () => {
  it("未知工具指路到阶段分配问题，而不是让它找绕过", async () => {
    const r = await toolOf("tools_help").execute({ name: "totally_unknown_tool" }, { sessionID: SID })
    assert.ok(r.includes("不在本插件的阶段表里"))
    assert.ok(r.includes("而不是寻求绕过"))
  })
  it("已知工具仍给阶段归属", async () => {
    const r = await toolOf("tools_help").execute({ name: "todowrite" }, { sessionID: SID })
    assert.ok(r.includes("phase: Planning (1/3)"))
  })
})

describe("R7/R8 缺陷①：同一**请求**内多个完成信号只晋级一级，且与顺序无关", () => {
  const stageOfSid = async (sid) => {
    const s = await toolOf("dev_router_status").execute({}, { sessionID: sid })
    return Number(s.match(/stage: (\d)\/3/)?.[1] ?? NaN)
  }
  /** 跑「一请求」：建会话 → 按 order 逐个投递完成信号 → 读阶段（中途**不开新请求**）。 */
  async function oneRound(sid, order) {
    seen(sid)
    await nextRound(sid)                                     // 轮边界（= 一次模型请求）
    await toolOf("phase_begin").execute({}, { sessionID: sid })
    order.forEach((n, i) => done(sid, n, sid + "-r1-" + i))
    return stageOfSid(sid)
  }

  it("[question,todowrite] 一请求只到 1（不得跨两级）", async () => {
    assert.equal(await oneRound("ses_r7_a", ["question", "todowrite"]), 1)
  })

  it("[todowrite,question] 一请求也只到 1（顺序无关）", async () => {
    assert.equal(await oneRound("ses_r7_b", ["todowrite", "question"]), 1)
  })

  it("一请求三个信号（含非致因的 read）仍只到 1", async () => {
    assert.equal(await oneRound("ses_r7_c", ["question", "todowrite", "read"]), 1)
  })

  it("【R8 判别点】同一 user turn 内、**下一个请求**即可再进一级（per-request ≠ per-prompt）", async () => {
    const sid = "ses_r7_d"
    assert.equal(await oneRound(sid, ["question", "todowrite"]), 1)
    // 关键：**不发新 prompt**，只开一次新请求 —— per-prompt 实现下这里会停在 1
    await nextRound(sid)
    done(sid, "todowrite", sid + "-r2-0")
    assert.equal(await stageOfSid(sid), 2, "下一个请求必须重新开放额度（对齐旧实现的每请求粒度）")
  })

  it("轮边界由请求打开：同一请求内第 2 个信号被抑制，不是因为 callID 记账", async () => {
    const sid = "ses_r7_e"
    seen(sid)
    await nextRound(sid)
    await toolOf("phase_begin").execute({}, { sessionID: sid })
    done(sid, "question", "e-1")
    assert.equal(await stageOfSid(sid), 1)
    // 换一个**全新 callID** 的第二个致因信号：仍必须被「本轮已晋级」挡住
    done(sid, "todowrite", "e-2-brand-new")
    assert.equal(await stageOfSid(sid), 1, "新 callID 也不得在同一请求内再推进")
  })

  it("非 standard / 非 V4 会话的 context 请求也会复位（证明复位在守卫**之前**）", async () => {
    for (const [sid, agent, model] of [["ses_r8_spec", "spec", "deepseek-v4-pro"], ["ses_r8_nonv4", "standard", "gpt-4o"]]) {
      seen(sid, agent, model)
      await nextRound(sid)
      await toolOf("phase_begin").execute({}, { sessionID: sid })
      done(sid, "question", sid + "-1")
      assert.equal(await stageOfSid(sid), 1, `${sid} 前置：应先到 1`)
      await nextRound(sid) // 该会话不满足 isV4 && standard，但复位必须仍生效
      done(sid, "todowrite", sid + "-2")
      assert.equal(await stageOfSid(sid), 2, `${sid}（agent=${agent}, model=${model}）的请求也必须复位额度`)
    }
  })
})

describe("R9 已登记差异③：被上限挡下的信号会被记账（钉住现状，防止静默变化）", () => {
  const stageOfSid = async (sid) => {
    const s = await toolOf("dev_router_status").execute({}, { sessionID: sid })
    return Number(s.match(/stage: (\d)\/3/)?.[1] ?? NaN)
  }
  const call = (sid, name, id) => engine.onToolCompleted({ sessionID: sid, toolName: name, callID: id })

  it("同一请求内被挡下的信号进 seenCalls：重投同一 callID 无效（信号被静默丢弃）", async () => {
    const sid = "ses_r9_burn"
    seen(sid)
    await nextRound(sid)
    await toolOf("phase_begin").execute({}, { sessionID: sid })
    call(sid, "question", "q1")
    assert.equal(await stageOfSid(sid), 1, "前置：question 应晋级到 1")
    call(sid, "todowrite", "t1")           // 被上限挡下
    assert.equal(await stageOfSid(sid), 1, "被挡：同请求内不得再晋级")
    await nextRound(sid)                    // R11：新请求 ⇒ 额度复位，只剩「已记账」能挡住重投
    call(sid, "todowrite", "t1")           // 重投同一 callID
    assert.equal(await stageOfSid(sid), 1, "该信号实例已被记账（burned），重投无效 —— 差异③现状")
  })

  it("但会话**可被后续新信号恢复**（不是「永久停滞」）", async () => {
    const sid = "ses_r9_recover"
    seen(sid)
    await nextRound(sid)
    await toolOf("phase_begin").execute({}, { sessionID: sid })
    call(sid, "question", "q1")
    call(sid, "todowrite", "t1")           // 被挡 + 记账
    assert.equal(await stageOfSid(sid), 1)
    await nextRound(sid)                    // 下一次请求 = 新额度
    call(sid, "todowrite", "t2")            // 新 callID
    assert.equal(await stageOfSid(sid), 2, "后续新信号必须能推进（故措辞不写「永久」）")
  })
})
