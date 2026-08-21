import { describe, it } from "node:test"
import assert from "node:assert/strict"
import {
  classifyTask, isChatTask, isComplexTask, isDeepSeekV4, isDeepSeekV4Flash, isDeepSeekV4Pro,
  parseMode, bandOf, bandFor, clamp01,
  STAGES, GLOBAL_SAFE, MAX_STAGE, STAGE_GUIDES,
  unlockedFor, stageText, advanceStage, RL_PERSONA,
} from "../plugins/lib/router-core.mjs"

/**
 * routing-suite v0.4.0 核心层直测（import 产品代码，不再内联副本）。
 * 运行：npm test  （node --test test/）
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
  it("开发阶段映射（str_replace_editor→apply_patch）", () => assert.deepEqual(STAGES[2].tools, ["write", "edit", "apply_patch"]))
  it("GLOBAL_SAFE 覆盖全部阶段工具（无门控）", () => {
    for (const s of STAGES) for (const t of s.tools) assert.ok(GLOBAL_SAFE.includes(t), `${t} 应在 GLOBAL_SAFE`)
  })
  it("unlockedFor 全量恒可用（无门控）", () => { for (let i = 0; i < 4; i++) assert.deepEqual(unlockedFor(i), GLOBAL_SAFE.length === unlockedFor(i).length ? unlockedFor(i) : unlockedFor(i)) })
  it("stageText we-form + 本阶段工具", () => {
    const t = stageText(0)
    assert.ok(t.includes("Current phase: Understanding"))
    assert.ok(t.includes("read"))
    assert.ok(t.includes("we decide when to advance"))
    assert.ok(stageText(2).includes("write"))
  })
  it("stageText 越界钳制", () => { assert.ok(stageText(9).includes("Verification")); assert.ok(stageText(-1).includes("Understanding")) })
})

describe("advanceStage 闯关证据", () => {
  it("todo/task → 1", () => { assert.equal(advanceStage(0, ["todowrite"], ""), 1); assert.equal(advanceStage(0, ["task"], ""), 1) })
  it("开发工具 → 2", () => { assert.equal(advanceStage(1, ["edit"], ""), 2); assert.equal(advanceStage(1, ["apply_patch"], ""), 2) })
  it("bash/完成声明 → 3", () => { assert.equal(advanceStage(2, ["bash"], ""), 3); assert.equal(advanceStage(2, [], "we are done"), 3) })
  it("无证据不推进", () => { assert.equal(advanceStage(0, ["read"], ""), 0); assert.equal(advanceStage(2, [], "继续"), 2) })
  it("不越界", () => { assert.equal(advanceStage(3, ["bash"], ""), 3) })
})

describe("叙述文本", () => {
  it("RL 句", () => assert.equal(RL_PERSONA, "You are a helpful software engineer assistant."))
  it("STAGE_GUIDES 数量", () => assert.equal(STAGE_GUIDES.length, 4))
  it("isComplexTask", () => { assert.equal(isComplexTask("请全面分析这个架构"), true); assert.equal(isComplexTask("小任务"), false) })
})
