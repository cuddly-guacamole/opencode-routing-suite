import { describe, it } from "node:test"
import assert from "node:assert/strict"
import {
  classifyTask, isChatTask, isComplexTask, isDeepSeekV4, isDeepSeekV4Flash, isDeepSeekV4Pro,
  parseMode, bandOf, bandFor, clamp01,
  STAGES, GLOBAL_SAFE, MAX_STAGE, STAGE_GUIDES,
  unlockedFor, stageText, advanceStage, completionSignals, firstUserTask, beginPhase, RL_PERSONA,
  PROGRESSIVE_DECL, PROACTIVITY_GUIDE, DESC, TOOL_SUMMARIES,
  verifyDeliveryPieces, validateDeliveryEvidence, EVIDENCE_KINDS,
} from "../plugins/lib/router-core.mjs"

/**
 * routing-suite v0.5.0 核心层直测（import 产品代码，不再内联副本）。
 * 运行：npm test  （node --test）
 * 运行时行为（hook 接线）另见 test/progressive-runtime.test.mjs。
 */

describe("classifyTask 三带", () => {
  it("react 任务", () => assert.equal(classifyTask("帮我写一个 python 脚本"), "react"))
  it("spec 任务", () => assert.equal(classifyTask("修复这个崩溃 bug"), "spec"))
  it("平局 → weak", () => assert.equal(classifyTask("随便看看"), "weak"))
})

describe("isChatTask 寒暄让位", () => {
  it("寒暄", () => assert.equal(isChatTask("你好"), true))
  it("空串", () => assert.equal(isChatTask("  "), true))
  it("任务句", () => assert.equal(isChatTask("帮我修一下这个"), false))
})

describe("模型门控（非 V4 零干预）", () => {
  it("V4 flash", () => assert.equal(isDeepSeekV4Flash("deepseek-v4-flash"), true))
  it("V4 pro", () => assert.equal(isDeepSeekV4Pro("deepseek-v4-pro"), true))
  it("V4 泛", () => assert.equal(isDeepSeekV4("deepseek-v4-xxx"), true))
  it("非 V4", () => { assert.equal(isDeepSeekV4("gpt-4o"), false); assert.equal(isDeepSeekV4(undefined), false) })
})

describe("parseMode / band", () => {
  it("band 名", () => { assert.equal(parseMode("react"), 1); assert.equal(parseMode("spec"), 0); assert.equal(parseMode("weak"), "weak") })
  it("数字", () => { assert.equal(parseMode("80"), 0.8); assert.equal(parseMode("0.3"), 0.3) })
  it("auto", () => assert.equal(parseMode("auto"), "auto"))
  it("无效", () => assert.equal(parseMode("xyz"), null))
  it("bandOf 量化", () => { assert.equal(bandOf(0.1), "spec"); assert.equal(bandOf(0.3), "transition"); assert.equal(bandOf(0.8), "react"); assert.equal(bandFor(0.3), "mixed") })
})

describe("渐进披露四阶段", () => {
  it("阶段数", () => { assert.equal(STAGES.length, 4); assert.equal(MAX_STAGE, 3) })
  it("阶段 0 工具为读/搜面", () => assert.deepEqual(STAGES[0].tools, ["read", "glob", "grep", "websearch", "webfetch", "question"]))
  it("规划阶段映射（todowrite + task 隔离面）", () => assert.deepEqual(STAGES[1].tools, ["todowrite", "task"]))
  it("开发阶段映射（str_replace_editor→apply_patch）", () => assert.deepEqual(STAGES[2].tools, ["write", "edit", "apply_patch"]))
  it("GLOBAL_SAFE 覆盖全部阶段工具", () => {
    for (const s of STAGES) for (const t of s.tools) assert.ok(GLOBAL_SAFE.includes(t), `${t} 应在 GLOBAL_SAFE`)
  })
  it("unlockedFor = 本阶段工具 ∪ GLOBAL_SAFE（阶段表全覆盖 → 与 GLOBAL_SAFE 等长）", () => {
    for (let i = 0; i <= MAX_STAGE; i++) {
      assert.equal(unlockedFor(i).length, GLOBAL_SAFE.length)
      for (const t of STAGES[i].tools) assert.ok(unlockedFor(i).includes(t))
    }
  })
  it("stageText we-form + 本阶段工具 + 完成信号口径", () => {
    const t = stageText(0)
    assert.ok(t.includes("Current phase: Understanding"))
    assert.ok(t.includes("read"))
    assert.ok(t.includes("phase completion signal"))
    assert.ok(stageText(2).includes("write"))
  })
  it("stageText 越界钳制", () => { assert.ok(stageText(9).includes("Verification")); assert.ok(stageText(-1).includes("Understanding")) })
  it("stageText 任务回显（上游 v1.19.1 Task: 行）", () => {
    assert.ok(stageText(0, "帮我修复登录崩溃").includes("Task: 帮我修复登录崩溃"))
    assert.ok(!stageText(0, "").includes("Task:"))
    assert.ok(!stageText(0, "   ").includes("Task:"))
  })
})

describe("advanceStage 完成信号驱动晋级（上游 v1.19.0）", () => {
  it("阶段 0：question / todowrite 是对齐完成信号", () => {
    assert.equal(advanceStage(0, ["question"]), 1)
    assert.equal(advanceStage(0, ["todowrite"]), 1)
  })
  it("阶段 0：读工具与开发工具都不推进（No alignment, no advancement）", () => {
    assert.equal(advanceStage(0, ["read", "glob", "grep"]), 0)
    assert.equal(advanceStage(0, ["write", "edit"]), 0)
    assert.equal(advanceStage(0, ["task"]), 0)
  })
  it("阶段 1：只有 todowrite（计划已锁定）推进", () => {
    assert.equal(advanceStage(1, ["todowrite"]), 2)
    assert.equal(advanceStage(1, ["edit"]), 1)
    assert.equal(advanceStage(1, ["bash"]), 1)
  })
  it("阶段 2：只有 delivery_check（产物自检）推进", () => {
    assert.equal(advanceStage(2, ["delivery_check"]), 3)
    assert.equal(advanceStage(2, ["bash"]), 2)
    assert.equal(advanceStage(2, ["write", "edit", "bash"]), 2)
  })
  it("工具对象形态（{name}）与字符串形态等价", () => {
    assert.equal(advanceStage(0, [{ name: "question" }]), 1)
    assert.equal(advanceStage(2, [{ name: "delivery_check" }]), 3)
  })
  it("一次只走一级；末阶段与越界不推进", () => {
    assert.equal(advanceStage(3, ["delivery_check"]), 3)
    assert.equal(advanceStage(9, ["question"]), 3)
    assert.equal(advanceStage(-1, ["question"]), 1)
  })
  it("非工具输入不抛错", () => {
    assert.equal(advanceStage(0, null), 0)
    assert.equal(advanceStage(0, [null, undefined, "", 7]), 0)
  })
  it("completionSignals 表与上游 :513-525 对齐（无 exit_plan_mode）", () => {
    assert.deepEqual(completionSignals(0), ["question", "todowrite"])
    assert.deepEqual(completionSignals(1), ["todowrite"])
    assert.deepEqual(completionSignals(2), ["delivery_check"])
    assert.deepEqual(completionSignals(3), [])
  })
})

describe("firstUserTask 任务回显（上游 v1.19.1，160 字截断）", () => {
  it("短文本原样", () => assert.equal(firstUserTask("  修复登录  "), "修复登录"))
  it("超长截断加省略号", () => {
    const r = firstUserTask("x".repeat(200))
    assert.equal(r.length, 161)
    assert.ok(r.endsWith("…"))
  })
  it("空/非字符串 → 空串", () => {
    assert.equal(firstUserTask("   "), "")
    assert.equal(firstUserTask(undefined), "")
    assert.equal(firstUserTask(null), "")
    assert.equal(firstUserTask(42), "")
  })
})

describe("交付门 verifyDeliveryPieces", () => {
  it("三验证全过 → PASS", () => assert.deepEqual(
    verifyDeliveryPieces("a.txt", { exists: true, size: 5, utf8: true }),
    { ok: true, checks: [
      { name: "exists", pass: true, detail: "present" },
      { name: "non-empty", pass: true, detail: "5 bytes" },
      { name: "utf8", pass: true, detail: "valid UTF-8" },
    ] }))
  it("文件缺失 → FAIL", () => {
    const r = verifyDeliveryPieces("x.txt", { exists: false, size: 0, utf8: false })
    assert.equal(r.ok, false)
    assert.equal(r.checks[0].pass, false)
    assert.ok(r.checks[0].detail.includes("missing"))
  })
  it("空文件 → non-empty FAIL", () => {
    const r = verifyDeliveryPieces("a.txt", { exists: true, size: 0, utf8: true })
    assert.equal(r.ok, false)
    assert.equal(r.checks[1].pass, false)
  })
  it("非 UTF-8 → utf8 FAIL", () => {
    const r = verifyDeliveryPieces("a.txt", { exists: true, size: 3, utf8: false })
    assert.equal(r.ok, false)
    assert.equal(r.checks[2].pass, false)
  })
})

describe("beginPhase phase_begin 决策（上游 v1.17.1 回归）", () => {
  it("未确认 → start（stage 归 0）", () => assert.deepEqual(beginPhase({}), { action: "start", stage: 0 }))
  it("已确认 stage=0 → duplicate（不重复 bootstrap）", () => assert.deepEqual(
    beginPhase({ confirmed: true, stage: 0 }),
    { action: "duplicate", stage: 0 }))
  it("恢复进度 stage>0 → repair 且保留阶段（3/3 不再被打回 phase-0）", () => assert.deepEqual(
    beginPhase({ confirmed: true, stage: 3 }),
    { action: "repair", stage: 3 }))
  it("越界钳制", () => assert.deepEqual(beginPhase({ confirmed: true, stage: 9 }), { action: "repair", stage: 3 }))
})

describe("validateDeliveryEvidence 证据门禁（上游 v1.14/v1.16）", () => {
  const yes = () => true
  it("空清单 → FAIL + 指引", () => {
    const r = validateDeliveryEvidence([], {})
    assert.equal(r.pass, false)
    assert.ok(r.failures[0].includes("missing evidence"))
  })
  it("合法 file 证据 + 存在回调 → PASS", () =>
    assert.equal(validateDeliveryEvidence([{ label: "f", kind: "file", target: "a.txt" }], { fileExists: yes }).pass, true))
  it("非法 kind → FAIL", () => {
    const r = validateDeliveryEvidence([{ label: "x", kind: "screenshot" }], {})
    assert.equal(r.pass, false)
    assert.ok(r.failures[0].startsWith("bad kind"))
  })
  it("run/text 缺 result → FAIL；带 result → PASS", () => {
    assert.equal(validateDeliveryEvidence([{ label: "r", kind: "run" }], {}).pass, false)
    assert.equal(validateDeliveryEvidence([{ label: "r", kind: "run", result: "3/3 tests ok" }], {}).pass, true)
    assert.equal(validateDeliveryEvidence([{ label: "t", kind: "text", result: "grep hit: foo" }], {}).pass, true)
  })
  it("page/image 必须 reviewed:true", () => {
    assert.equal(validateDeliveryEvidence([{ label: "shot", kind: "image", target: "a.png" }], { fileExists: yes }).pass, false)
    assert.equal(validateDeliveryEvidence([{ label: "shot", kind: "image", target: "a.png", reviewed: true }], { fileExists: yes }).pass, true)
  })
  it("external：target/result 任一即可；两者皆无 → FAIL", () => {
    assert.equal(validateDeliveryEvidence([{ label: "pw", kind: "external" }], {}).pass, false)
    assert.equal(validateDeliveryEvidence([{ label: "pw", kind: "external", result: "2 views captured" }], {}).pass, true)
    assert.equal(validateDeliveryEvidence([{ label: "pw", kind: "external", target: "shot.png", reviewed: true }], { fileExists: yes }).pass, true)
  })
  it("target 存在性回调命中缺失 → FAIL", () => {
    const r = validateDeliveryEvidence([{ label: "f", kind: "file", target: "nope.txt" }], { fileExists: () => false })
    assert.equal(r.pass, false)
    assert.ok(r.failures[0].includes("target missing"))
  })
  it("page 类交付物要求 ≥1 项 reviewed 视觉证据", () => {
    const textOnly = [{ label: "assert", kind: "text", result: "title ok" }]
    assert.equal(validateDeliveryEvidence(textOnly, { requireReviewedVisual: true }).pass, false)
    const withVisual = [...textOnly, { label: "v", kind: "external", target: "shot.png", reviewed: true }]
    assert.equal(validateDeliveryEvidence(withVisual, { fileExists: yes, requireReviewedVisual: true }).pass, true)
  })
  it("kind 全集含 external 一等公民", () => assert.ok(EVIDENCE_KINDS.includes("external")))
  it("numeric：数值 result → PASS；非数值 / 缺失 → FAIL（上游 v1.24）", () => {
    assert.ok(EVIDENCE_KINDS.includes("numeric"))
    assert.equal(validateDeliveryEvidence([{ label: "inv", kind: "numeric", result: "2.07" }], {}).pass, true)
    assert.equal(validateDeliveryEvidence([{ label: "inv", kind: "numeric", result: "-3" }], {}).pass, true)
    assert.equal(validateDeliveryEvidence([{ label: "inv", kind: "numeric", result: "1e-3" }], {}).pass, true)
    assert.equal(validateDeliveryEvidence([{ label: "inv", kind: "numeric", result: "not-a-number" }], {}).pass, false)
    assert.equal(validateDeliveryEvidence([{ label: "inv", kind: "numeric" }], {}).pass, false)
  })
  it("numeric 用上游正则、不用上游示例（minr=2.07 实测 FAIL，CHANGELOG 自称 PASS 是错的）", () => {
    const r = validateDeliveryEvidence([{ label: "minr", kind: "numeric", result: "minr=2.07" }], {})
    assert.equal(r.pass, false)
    assert.ok(r.failures[0].includes("numeric result"))
  })
  it("缺 numeric 时给非阻塞 hint，且不影响 pass（上游 v1.28 numeric-assertion）", () => {
    const r = validateDeliveryEvidence([{ label: "assert", kind: "text", result: "grep hit" }], {})
    assert.equal(r.pass, true)
    assert.equal(r.hints.length, 1)
    assert.ok(r.hints[0].includes("kind=numeric"))
    const withNumeric = validateDeliveryEvidence([{ label: "n", kind: "numeric", result: "12" }], {})
    assert.equal(withNumeric.hints.length, 0)
  })
  it("空清单同时给 failures 与空 hints", () => {
    const r = validateDeliveryEvidence([], {})
    assert.deepEqual(r.hints, [])
  })
})

describe("叙述文本", () => {
  it("RL 句", () => assert.equal(RL_PERSONA, "You are a helpful software engineer assistant."))
  it("STAGE_GUIDES 数量", () => assert.equal(STAGE_GUIDES.length, 4))
  it("验证阶段含交付门+证据契约+numeric", () => {
    assert.ok(STAGE_GUIDES[3].includes("delivery_check"))
    assert.ok(STAGE_GUIDES[3].includes("evidence"))
    assert.ok(STAGE_GUIDES[3].includes("numeric"))
  })
  it("阶段 0 含对齐硬句，前三个阶段带 → Done? 完成判据（上游 v1.19.0/v1.19.1）", () => {
    assert.ok(STAGE_GUIDES[0].includes("No alignment, no advancement"))
    for (const i of [0, 1, 2]) assert.ok(STAGE_GUIDES[i].includes("→ Done?"), `STAGE_GUIDES[${i}] 应带 → Done?`)
  })
  it("规划阶段含注意力回收与隔离并行，只点名本平台存在的 task（上游 v1.26/v1.27）", () => {
    assert.ok(STAGE_GUIDES[1].includes("Attention reclamation"))
    assert.ok(STAGE_GUIDES[1].includes("attention leakage"))
    assert.ok(STAGE_GUIDES[1].includes("Isolation & parallel"))
    assert.ok(STAGE_GUIDES[1].includes("`task`"))
  })
  it("开发阶段含防局部最优三段式，且保留既有契约（上游 v1.22 按序拼接不覆盖）", () => {
    assert.ok(STAGE_GUIDES[2].includes("Avoid local-optima"))
    assert.ok(STAGE_GUIDES[2].includes("re-fight"))
    assert.ok(STAGE_GUIDES[2].includes("Re-read before re-edit"))
    assert.ok(STAGE_GUIDES[2].includes("Cross-language escaping"))
  })
  it("验证阶段含假设审计两问 + 用自己的工具验证 + describe_image 边界（上游 v1.25/v1.28/v1.23）", () => {
    assert.ok(STAGE_GUIDES[3].includes("audit the hypothesis first"))
    assert.ok(STAGE_GUIDES[3].includes("which assumption you are now re-checking"))
    assert.ok(STAGE_GUIDES[3].includes("what NEW evidence you just gained"))
    assert.ok(STAGE_GUIDES[3].includes("Verify with your OWN tools"))
    assert.ok(STAGE_GUIDES[3].includes("describe_image only displays"))
  })
  it("PROGRESSIVE_DECL：meta 全列 + proactivity 协议入声明", () => {
    assert.ok(PROGRESSIVE_DECL.includes("delivery_check"))
    assert.ok(PROGRESSIVE_DECL.includes("Proactivity protocol"))
    assert.ok(!PROGRESSIVE_DECL.includes("48+")) // 去硬编码（上游 v1.15 建议 #5）
  })
  it("PROACTIVITY_GUIDE：泄压退役终审文本", () => {
    assert.ok(PROACTIVITY_GUIDE.includes("replaces the pressure valve"))
    assert.ok(PROACTIVITY_GUIDE.includes("scan for the next actionable item"))
    assert.ok(PROGRESSIVE_DECL.includes("act on reversible next steps"))
  })
  it("DESC 单源五件套非空", () => {
    for (const k of ["toolsCatalog", "toolsHelp", "phaseAdvance", "routerStatus", "deliveryCheck"]) {
      assert.ok(String(DESC[k]).length > 10, `DESC.${k} 非空`)
    }
  })
  it("DESC 说明完成信号驱动与 numeric/describe_image 边界", () => {
    assert.ok(DESC.phaseAdvance.includes("完成信号驱动"))
    assert.ok(DESC.deliveryCheck.includes("numeric"))
    assert.ok(DESC.deliveryCheck.includes("describe_image"))
  })
  it("stageText：交付阶段带证据门提示，其余阶段保持 we-form 自路由", () => {
    assert.ok(stageText(0).includes("phase completion signal"))
    assert.ok(stageText(3).includes("Delivery evidence gate"))
    assert.ok(stageText(3).includes("do NOT declare the task delivered"))
  })
  it("isComplexTask", () => { assert.equal(isComplexTask("请全面分析这个架构"), true); assert.equal(isComplexTask("小任务"), false) })
})

describe("注入文本卫生（本平台不存在的指名一律不得出现）", () => {
  // 派生自 derived-map §7.2 剔除清单：这些 token 在 opencode 侧没有对应工具/服务。
  // `subagent` 于 T13 轮加入：它此前只出现在 TOOL_SUMMARIES.task 的文案里（那句会经
  // tools_catalog/tools_help/phase_advance 技能卡进入注入面），按 §7.2 #10 的"改名"处置换成普通措辞。
  const FORBIDDEN = [
    "engram", "run_code", "dev_page_check", "presentAs", "restrict",
    "workflow", "ralph", "fork", "subagent",
    "get_goal", "create_goal", "update_goal",
    "pwsh", "read_image", "str_replace_editor", "web_search",
    "ask_user_question", "todo_write", "exit_plan_mode",
    "job_list", "job_output", "job_kill", "dev_reload_preset_live", "dev_reset_experience",
  ]
  const surfaces = () => ({
    PROGRESSIVE_DECL,
    PROACTIVITY_GUIDE,
    DESC: Object.values(DESC).join(" "),
    STAGE_GUIDES: STAGE_GUIDES.join(" "),
    stageText: [0, 1, 2, 3].map((s) => stageText(s, "sample task")).join(" "),
    // 工具摘要也进注入面（tools_catalog / tools_help / phase_advance 的 New this stage 技能卡）
    TOOL_SUMMARIES: Object.values(TOOL_SUMMARIES).join(" "),
  })
  it("所有注入面都不含平台不存在的指名 token", () => {
    for (const [name, text] of Object.entries(surfaces())) {
      const low = text.toLowerCase()
      for (const f of FORBIDDEN) {
        assert.ok(!low.includes(f.toLowerCase()), `${name} 含禁用 token: ${f}`)
      }
    }
  })
  it("判据可失败（自证不是恒真断言）", () => {
    const low = ("Phase tools: " + FORBIDDEN[0]).toLowerCase()
    assert.ok(low.includes(FORBIDDEN[0].toLowerCase()))
    assert.ok(!PROGRESSIVE_DECL.toLowerCase().includes(FORBIDDEN[0].toLowerCase()))
  })
  it("判据真的覆盖到 subagent 曾出现的那一面（TOOL_SUMMARIES 在扫描面内）", () => {
    assert.ok(Object.keys(surfaces()).includes("TOOL_SUMMARIES"))
    assert.ok(FORBIDDEN.includes("subagent"))
  })
})
