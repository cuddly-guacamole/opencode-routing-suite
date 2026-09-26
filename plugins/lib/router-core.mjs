/**
 * router-core (v0.5.0): 渐进披露路由核心 - 纯函数，零依赖，可单测。
 * 来源：dsh-router-standard 快照 @b39112d（standard v1.27.0）派生，
 * v1.18.0→v1.28.0 的逐条裁决与落点见 scripts/upstream/derived-map.md §7 / §8。
 * 语义：三带分类 persona 换装已废弃；分类器仅用于 AUTO 选 agent + dev 展示。
 */

export const MODE_SPEC = 0
export const MODE_MIXED = 0.3
export const MODE_REACT = 1
export const MODE_WEAK = 'weak'

export const RL_PERSONA = 'You are a helpful software engineer assistant.'
export const SPEC_PERSONA = 'You are a helpful software engineer assistant.'

export const REACT_PERSONA =
  'You are a hands-on software engineer who delivers working output fast.\n'
  + 'Work directly: write or edit code, then verify it by reading and running. '
  + 'Keep the loop tight — produce, verify, fix — and do not build test '
  + 'harnesses, scaffolding, or ceremony the user did not ask for. '
  + 'Finish with a usable deliverable and a short summary.'

export const WEAK_PRO =
  'You are a helpful software engineer assistant.\n'
  + 'Before acting, decide the task type (build or fix) and adopt the matching '
  + 'style: build → hands-on production; fix → inspect-and-plan.'

export const WEAK_FLASH =
  'You are a helpful assistant.\n'
  + 'Before acting, decide the task type (build or fix) and adopt the matching '
  + 'style: build → hands-on production; fix → inspect-and-plan.\n'
  + 'Before acting, briefly review what you have already done in this session and continue from where you left off; do not repeat completed steps. '
  + 'Think deeply first, then produce.'

export function isDeepSeekV4(modelId) {
  return typeof modelId === 'string' && /deepseek/i.test(modelId) && /v4/i.test(modelId)
}
export function isDeepSeekV4Flash(modelId) {
  return isDeepSeekV4(modelId) && /flash/i.test(modelId)
}
export function isDeepSeekV4Pro(modelId) {
  return isDeepSeekV4(modelId) && /pro/i.test(modelId)
}

const CHAT_RE = /^(你好|您好|hello|hi|hey|嗨|哈喽|在吗|谢谢|感谢|thanks|thank you|早上好|下午好|晚上好|嗯|好|ok|okay|yes|no|嗯嗯|好的)[!。.!？?~～]*$/i
export const REACT_RE =
  /(开发|创建|写一个|写|生成|从零|做一个|做个|游戏|网页|网站|构建|新项目|搭建|实现|做出|上线|落地|脚本|工具|应用|build|create|develop|generate|implement|write a|write an|build a|make a|new project)/gi
export const SPEC_RE =
  /(修复|修一下|调试|重构|维护|排查|报错|出错|崩溃|优化|审查|review|fix|debug|refactor|maintain|repair|broken|break|为什么|异常|故障|迁移|升级|兼容)/gi
const COMPLEX_RE = /(重构|架构|全面|详细|设计|系统|优化|分析|survey|overview|architecture|refactor|comprehensive|detailed|design|system|optimize|analyze)/i

function countHits(regex, text) {
  return [...text.matchAll(regex)].length
}

export function classifyTask(text) {
  const react = countHits(REACT_RE, text)
  const spec = countHits(SPEC_RE, text)
  if (react > spec) return 'react'
  if (spec > react) return 'spec'
  return 'weak'
}

export function isChatTask(text) {
  if (typeof text !== 'string') return true
  const t = text.trim()
  if (t.length === 0) return true
  if (CHAT_RE.test(t)) return true
  if (t.length > 24) return false
  return !t.match(REACT_RE) && !t.match(SPEC_RE)
}

export function isComplexTask(text) {
  return typeof text === 'string' && (text.length > 120 || COMPLEX_RE.test(text))
}

export function clamp01(v) {
  return Math.min(1, Math.max(0, Number(v) || 0))
}

export function bandOf(mode) {
  if (mode === 'weak') return 'weak'
  const m = clamp01(mode)
  if (m < 0.2) return 'spec'
  if (m < 0.5) return 'transition'
  return 'react'
}

export function bandFor(mode) {
  const b = bandOf(mode)
  return b === 'transition' ? 'mixed' : b
}

export function parseMode(token) {
  if (token === undefined || token === null) return null
  const t = String(token).trim().toLowerCase()
  if (t === 'auto') return 'auto'
  if (t === 'weak' || t === 'router') return 'weak'
  if (t === 'spec' || t === 'spec-lean') return 0
  if (t === 'balanced' || t === 'mixed') return 0.3
  if (t === 'react' || t === 'react-lean') return 1
  const n = Number(t)
  if (!Number.isFinite(n)) return null
  if (t.includes('.')) return clamp01(n)
  return clamp01(n / 100)
}

// ── 渐进披露：四阶段（opencode 工具名，映射见 scripts/upstream/derived-map.md） ──

export const MAX_STAGE = 3

/** 版本标识（dev_router_status 展示；与 package.json 同步更新）。
 *  两个基线分开记（见 scripts/upstream/derived-map.md §4）：快照来源 = b39112d；
 *  v1.18.0→v1.28.0 的可移植子集已在 v0.5.0 落地，不可移植面按 §7.2 剔除清单逐个删。 */
export const PLUGIN_VERSION = 'v0.5.0'
export const UPSTREAM_BASELINE = '@b39112d snapshot (v1.27.0); v1.18→v1.28 语义已按 §7 裁决移植/剔除'

export const STAGES = [
  { name: 'Understanding / Alignment', tools: ['read', 'glob', 'grep', 'websearch', 'webfetch', 'question'] },
  { name: 'Planning', tools: ['todowrite', 'task'] },
  { name: 'Development', tools: ['write', 'edit', 'apply_patch'] },
  { name: 'Verification', tools: ['bash'] },
]

/** 生命周期恒可用（当前版本全量 = 全部工具；门控时用来收窄）。 */
export const GLOBAL_SAFE = [
  'read', 'write', 'edit', 'glob', 'grep', 'bash', 'webfetch', 'websearch',
  'question', 'todowrite', 'task', 'apply_patch', 'skill', 'describe_image',
  'tools_catalog', 'tools_help', 'phase_begin', 'phase_advance',
  'dev_router_status', 'dev_router_mode', 'delivery_check',
]

/** 闯关提示（阶段切换时注入一次；每条尾部带 → Done? 完成判据，上游 v1.19.1）。 */
export const STAGE_GUIDES = [
  'Phase: understanding. Phase tools: read/glob/grep/websearch/webfetch/question. Ground first: read and verify claims, then read/ask for the rest. Runtime caps are enforced at call time — check tools_help before big calls. Think broadly before settling: break the request into its dimensions (what the user wants, how it should behave, what "good" looks like) and surface the genuinely ambiguous ones; decide each by impact — state the obvious assumption in one sentence, but ask ONE focused question when two interpretations would materially change the artifact. Verification tools (bash) come later in the route — they are not "after delivery"; an early sanity check is fine when it settles a claim. **No alignment, no advancement: an ambiguous request needs a question answered, and a complex one needs a plan recorded — reading files alone does not complete this phase.** → Done? Understood (assumption stated / question answered / plan recorded) → planning.',
  'Phase: planning. Phase tools: todowrite/task (plan mode via Tab/Shift+Tab is native). Lock the plan and decisions, then work. Design the approach, cover edge cases, define what "done" means and how it will be checked — not just a list of steps. **Attention reclamation: assetize the context — keep the goal, the current decision and the live evidence in the attention window; write settled exploration and details out to a notes file in the workspace instead of holding them all in mind; let stale, superseded or resolved threads truly drop. Holding "everything might be useful" is attention leakage, not diligence.** **Isolation & parallel: when two independent concerns are polluting one thread, or a sub-problem is eating the mainline budget, delegate it to `task` (a separate context) instead of keeping it in the same stream — the mainline stays on the critical path.** → Done? Plan is decision-complete and locked (todowrite) → development.',
  'Phase: development. Phase tools: write/edit/apply_patch. Re-read before re-edit: a file changed since your last read must be read again first. write/edit results carry the FULL before/after text — take only path/operation and inspect changed lines with grep/read; never print a whole write/edit result. Cross-language escaping: shell/JS strings may interpolate ${...} — build such strings with single quotes or concatenation first. **Avoid local-optima: keep the WHOLE artifact working while you iterate. If you re-fight the same detail for several rounds with no convergence, step back — (1) is it blocking the deliverable or is it polish? (2) preserve one working version and iterate on the detail in parallel instead of stalling everything; (3) if it keeps resisting, finish the rest and re-attack it fresh.** Complete when: the artifact exists and passes its own self-check (loads, no console errors, key values sane). → Done? Self-check passes → delivery_check → verification.',
  'Phase: verification → delivery gate. Phase tools: bash. **Evidence gate: delivery_check(file, evidence) requires an evidence manifest** — text/code deliverables: read/grep assertions or test output (kind=text/test); command-run results: real stdout summary (kind=run); numeric invariants the model computes itself: a numeric result, e.g. counts or conserved quantities (kind=numeric, result=<number>); page/image deliverables: a screenshot you have actually looked at (kind=page/image/external, reviewed:true). **On verification failure, audit the hypothesis first: before touching the implementation, name in one line (a) which assumption you are now re-checking and (b) what NEW evidence you just gained — then check gates and evidence. If the artifact is actually correct, say so and move on; do not manufacture a bug to justify rework.** Verify with your OWN tools: run a headless browser or other checker via bash and look at its output yourself. ⚠️ describe_image only displays an image for the user — it is NOT by itself a reviewed visual check, so never pass reviewed:true on its say-so. Delivery PASS requires evidence on top of file/existence/UTF-8 checks; missing evidence, missing targets, unreviewed visuals, or empty run results → FAIL. ⚠️ **Complete only when: delivery_check returns PASS** — until then, do NOT report the task as delivered; any FAIL: fix and re-run.',
]

/** 阶段解锁列表（前 stage+1 阶段 ∪ GLOBAL_SAFE）。 */
export function unlockedFor(stage) {
  const s = Math.max(0, Math.min(Number(stage) || 0, MAX_STAGE))
  const phase = STAGES.slice(0, s + 1).flatMap((x) => x.tools)
  return [...new Set([...phase, ...GLOBAL_SAFE])]
}

/** 任务回显（上游 v1.19.1 `firstUserTask`）：取首条真实用户消息，>160 字截断加 …。
 *  数据面是 opencode 的真实用户文本（`progressive.ts` 的 firstUserText），不是 DSH 的 session.events。 */
export function firstUserTask(text) {
  const t = typeof text === 'string' ? text.trim() : ''
  if (!t) return ''
  return t.length > 160 ? t.slice(0, 160) + '…' : t
}

/** we-form 阶段文本（you-form 是 let me 吸引子——上游实测结论）。
 *  当前版本无阶段化门控（见 derived-map §7.0 术语）：展示本阶段工具，
 *  措辞用"推荐路线"而非 Unlocked/Locked，避免与全量可调用的事实矛盾。
 *  taskText = 会话任务回显（上游 v1.19.1 的 `Task:` 行）。 */
export function stageText(stage, taskText = '') {
  const s = Math.max(0, Math.min(Number(stage) || 0, MAX_STAGE))
  const tools = STAGES[s].tools.join(', ')
  const task = firstUserTask(taskText)
  const taskLine = task ? '\nTask: ' + task : ''
  const tail = s >= MAX_STAGE
    ? '.\nDelivery evidence gate: pair delivery_check(file, evidence) with an evidence manifest — until it returns PASS, we do NOT declare the task delivered.'
    : '.\nPhase is self-routed state: advancing requires the phase completion signal (' + completionSignals(s).join('/') + ') or phase_advance; tool usage alone never skips a phase.'
  return 'Current phase: ' + STAGES[s].name + ' (' + s + '/3). Phase tools: ' + tools + tail + taskLine
}

/** 完成信号表（上游 v1.19.0 `autoAdvance`，:513-525 的 opencode 映射）。
 *  晋级只由"本阶段任务完成"驱动：0→1 已对齐（question 答复 / todowrite 计划）；
 *  1→2 计划已锁定（todowrite）；2→3 产物自检（delivery_check）。
 *  工具名/文本一律不再跳级（上游 v1.19.0 删除的旧语义）。 */
export function completionSignals(stage) {
  const s = Math.max(0, Math.min(Number(stage) || 0, MAX_STAGE))
  if (s === 0) return ['question', 'todowrite']
  if (s === 1) return ['todowrite']
  if (s === 2) return ['delivery_check']
  return []
}

/** 阶段推进（完成信号驱动；工具名/文本跳级已删除）。 */
export function advanceStage(stage, toolCalls) {
  let s = Math.max(0, Math.min(Number(stage) || 0, MAX_STAGE))
  if (s >= MAX_STAGE) return s
  const names = new Set(
    (Array.isArray(toolCalls) ? toolCalls : [])
      .map((t) => (typeof t === 'string' ? t : t?.name))
      .filter((n) => typeof n === 'string' && n !== ''),
  )
  if (completionSignals(s).some((n) => names.has(n))) s += 1
  return s
}

/** phase_begin 决策纯函数（上游 v1.17.1 跨代兼容修复的移植：
 *  会话已确认且 stage>0 时视为已开启——只修复标记、不重置阶段、不重注入 bootstrap。
 *  此前无条件置 confirmed+stage=0 → 恢复进度 3/3 的会话再调 phase_begin 会被打回阶段 0
 *  并收到阶段 0 引导（与上游 user #1/#2「3/3 yet phase-0 injected」同根因）。 */
export function beginPhase(state) {
  const confirmed = state?.confirmed === true
  const stage = Math.max(0, Math.min(Number(state?.stage ?? 0) || 0, MAX_STAGE))
  if (!confirmed) return { action: 'start', stage: 0 }
  if (stage > 0) return { action: 'repair', stage }
  return { action: 'duplicate', stage: 0 }
}

/** Bootstrap 声明（上游 @00c81b1 结构；DSH 专属引用已按映射表剔除，
 *  无门控措辞对齐平台事实：所有工具真实在 wire 上，不谎称"注入期隐藏"）。 */
export const PROGRESSIVE_DECL =
  'We hold a full tool registry (see tools_catalog for the live count), revealed in phases. tools_catalog lists every tool (name + summary); tools_help <name> returns a tool\'s description. We query on demand and call precisely. '
  + 'Meta tools are always available: tools_catalog/tools_help (secondary disclosure), phase_begin/phase_advance (start & level-up), dev_router_status/dev_router_mode (self-check & override), delivery_check (delivery gate). '
  + 'Tool signatures are NOT uniform: before the first use of any tool this session, read its description via tools_catalog or tools_help — never guess. Runtime caps are enforced at call time — check tools_help before big calls. '
  + 'Tools are directly callable; the phase order is a recommended route, not a hard gate. '
  + 'write/edit results carry the FULL before/after text — take only path/operation, never print a whole write/edit result (context explosion); inspect the changed lines with grep/read instead.'
  + ' Proactivity protocol: act on reversible next steps; ask only for user-owned choices; report actions with evidence.'

/** 主动性自检引导（上游 v1.17.0 用户终审：泄压阀退役，注意力优化即泄压；
 *  上游常量名仍为 PRESSURE_GUIDE，本仓库改用真名并登记漂移。
 *  措辞漂移（v0.5.0 登记）：上游 "a consequential fork" → "a consequential decision"，
 *  使"注入文本不含本平台不存在的工具名"成为可机械校验的不变量（fork 是 DSH 编排工具名）。 */
export const PROACTIVITY_GUIDE =
  'Proactivity (replaces the pressure valve): every turn, before awaiting the user, scan for the next actionable item — unfinished work, unverified claims, reversible improvements, unfixed warnings. Choose one and act; report what you did and why. Ask only when the choice belongs to the user (preference, budget, irreversible/destructive, external approval). Two or more dependent steps: think step by step, but do not stop to ask permission for reversible work. Depth is our call: a small result gets a small thought, a consequential decision gets full reasoning.'

/** 工具描述单源（上游 v1.13 审计模式）：工具注册与文档读同一份，杜绝双份漂移。 */
export const DESC = {
  toolsCatalog: '渐进披露一级：全部工具（名称 + 一行摘要）。query 关键词过滤。工具恒全量可调（阶段是推荐路线，不是硬门控）。',
  toolsHelp: '渐进披露二级：单个工具的描述与阶段归属。精准调用前先查。',
  phaseAdvance:
    '闯关推进：显式声明当前阶段完成并进入下一阶段（返回本阶段新增工具卡 + Next goal）。逐级推进（一次一级，不跳级）。⚠️ 默认晋级路径是完成信号驱动，由插件自动完成：阶段 0 见 question/todowrite、阶段 1 见 todowrite、阶段 2 见 delivery_check——工具名与文本不会跳级。本工具用于「信号已到但阶段未动」或想显式推进时调用。',
  routerStatus: '渐进披露状态：插件版本/会话 agent/model/阶段/持久化/lastAdvance/override/熔断。只读。',
  deliveryCheck:
    '交付 gate（阶段出口契约）：校验交付物文件存在/非空/UTF-8 + 证据清单 evidence（items[{label, kind ∈ file|page|image|run|test|text|external|numeric, target?, result?, reviewed?}]；page/image 视觉类必须 reviewed:true，run/text 必须带 result，numeric 必须带数值 result（如 12 或 0.0），external 需 target 或 result 任一）。⚠️ describe_image 只是把图片展示出来，本身不构成 reviewed 的视觉检查——不要凭它填 reviewed:true。全部 PASS 才允许向用户宣告完成交付——任一 FAIL 必须修复后重跑，不允许绕过。',
}

/** 菜单入口工具摘要（tools_catalog 用的静态摘要；MCP/动态工具显示 ID）。 */
export const TOOL_SUMMARIES = {
  read: 'read a file',
  write: 'write a file',
  edit: 'edit a file',
  apply_patch: 'apply a patch stream',
  glob: 'list files by pattern',
  grep: 'search file contents',
  bash: 'run a shell command',
  webfetch: 'fetch a URL',
  websearch: 'search the web',
  question: 'ask the user',
  todowrite: 'write/update the todo list',
  task: 'delegate work to a separate context',
  skill: 'load a skill',
  describe_image: 'describe an image',
  tools_catalog: 'list all tools (one-line summaries)',
  tools_help: 'describe one tool in detail',
  phase_begin: 'confirm session start (unlock phase 0)',
  phase_advance: 'advance to the next phase',
  dev_router_status: 'show routing state',
  dev_router_mode: 'show/override reasoning mode',
  delivery_check: 'delivery gate: file checks + evidence manifest (PASS before declaring done)',
}

/** 交付门（上游 delivery_check 的文件三验证契约；无浏览器 smoke 的 opencode 版）。
 *  info 由调用方从 fs 读得：{ exists, size, utf8 }。纯函数可单测。 */
export function verifyDeliveryPieces(file, info) {
  const checks = []
  checks.push({
    name: 'exists',
    pass: info.exists === true,
    detail: info.exists === true ? 'present' : 'missing: ' + String(file),
  })
  checks.push({
    name: 'non-empty',
    pass: info.exists === true && Number(info.size) > 0,
    detail: Number(info.size) > 0 ? String(info.size) + ' bytes' : 'empty file',
  })
  checks.push({
    name: 'utf8',
    pass: info.utf8 === true,
    detail: info.utf8 === true ? 'valid UTF-8' : 'invalid UTF-8 encoding',
  })
  return { ok: checks.every((c) => c.pass), checks }
}

/** 证据门禁（上游 v1.14 规范化 + v1.16 external 一等公民 + v1.24 numeric 的纯函数层）。
 *  items: [{ label, kind, target?, result?, reviewed? }]；opts:
 *    fileExists?: (path) => boolean —— target 存在性回调（生产传 fs 包装，测试注入）
 *    requireReviewedVisual?: boolean —— 页面类交付物要求 ≥1 项 reviewed 视觉证据（对应上游 args.url 分支）
 *  返回 { pass, failures, hints }：hints 恒不影响 pass（上游 v1.28 的 numeric-assertion 是非阻塞提示）。 */
export const EVIDENCE_KINDS = ['file', 'page', 'image', 'run', 'test', 'text', 'external', 'numeric']
/** 数值字面量判据（上游 :467 的同一正则；上游示例 minr=2.07 会被它判 FAIL——用正则，不用那个例子）。 */
export const NUMERIC_RESULT_RE = /^-?[\d.eE+-]+$/
export function validateDeliveryEvidence(items, opts = {}) {
  const list = Array.isArray(items) ? items : []
  if (list.length === 0) {
    return {
      pass: false,
      failures: ['missing evidence items — provide at least one {label, kind, target?, result?, reviewed?} (kind ∈ ' + EVIDENCE_KINDS.join('/') + ')'],
      hints: [],
    }
  }
  const failures = []
  const hints = []
  let reviewedVisual = false
  let numericSeen = false
  for (const it of list) {
    const label = String(it?.label || '').trim()
    const kind = String(it?.kind || '').trim()
    if (!label) { failures.push('empty label'); continue }
    if (!EVIDENCE_KINDS.includes(kind)) { failures.push('bad kind: ' + kind); continue }
    if (kind === 'run' || kind === 'text') {
      if (!String(it?.result || '').trim()) failures.push(kind + ' evidence without result')
      continue
    }
    if (kind === 'numeric') {
      numericSeen = true
      const res = String(it?.result ?? '').trim()
      if (!res || !NUMERIC_RESULT_RE.test(res)) {
        failures.push('numeric evidence needs a numeric result (e.g. 12, 0.0, 2.07)')
      }
      continue
    }
    if (kind === 'external') {
      const hasTarget = String(it?.target || '').trim() !== ''
      const hasResult = String(it?.result || '').trim() !== ''
      if (!hasTarget && !hasResult) {
        failures.push('external evidence needs target (file) or result (output summary)')
        continue
      }
      if (hasTarget && typeof opts.fileExists === 'function' && !opts.fileExists(String(it.target).trim())) {
        failures.push('external target missing: ' + it.target)
      }
      if (it?.reviewed === true) reviewedVisual = true
      continue
    }
    const t = String(it?.target || '').trim()
    if (!t) { failures.push(kind + ' evidence without target'); continue }
    if (typeof opts.fileExists === 'function' && !opts.fileExists(t)) failures.push('target missing: ' + t)
    if (kind === 'page' || kind === 'image') {
      if (it?.reviewed === true) reviewedVisual = true
      else failures.push('visual not reviewed: ' + label)
    }
  }
  if (failures.length === 0 && opts.requireReviewedVisual === true && !reviewedVisual) {
    failures.push('page deliverable needs at least one reviewed visual evidence (page/image/external)')
  }
  if (!numericSeen) {
    hints.push('no numeric evidence: if this deliverable has a measurable invariant (count, radius, conserved quantity, compile-ok), add kind=numeric with result=<number> to turn "I think it works" into "I verified it" (non-blocking)')
  }
  return { pass: failures.length === 0, failures, hints }
}
