/**
 * router-core (v0.4.0): 渐进披露路由核心 - 纯函数，零依赖，可单测。
 * 来源：dsh-router-standard @742b180 (v0.7.4) 算子层派生，见 scripts/upstream/derived-map.md。
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

export const STAGES = [
  { name: 'Understanding / Alignment', tools: ['read', 'glob', 'grep', 'websearch', 'webfetch', 'question'] },
  { name: 'Planning', tools: ['todowrite'] },
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

/** 闯关提示（阶段切换时注入一次）。 */
export const STAGE_GUIDES = [
  'Phase: understanding. Phase tools: read/glob/grep/websearch/webfetch/question. Ground first: recall, verify claims, then read/ask. Runtime caps are enforced at call time — check tools_help before big calls. Complete when: the task requirements and available evidence are stated clearly.',
  'Phase: planning. Phase tools: todowrite (plan mode via Tab/Shift+Tab is native). Lock the plan and decisions, then work.',
  'Phase: development. Phase tools: write/edit/apply_patch. Re-read before re-edit: a file changed since your last read must be read again first. write/edit results carry the FULL before/after text — take only path/operation and inspect changed lines with grep/read; never print a whole write/edit result. Cross-language escaping: shell/JS strings may interpolate ${...} — build such strings with single quotes or concatenation first. Complete when: the artifact exists and passes its own self-check (loads, no console errors, key values sane).',
  'Phase: verification → delivery gate. Phase tools: bash. **Complete only when: delivery_check(file) returns PASS** — artifact exists / non-empty / UTF-8. Until delivery_check passes, do NOT report the task as delivered — any FAIL: fix and re-run.',
]

/** 阶段解锁列表（前 stage+1 阶段 ∪ GLOBAL_SAFE）。 */
export function unlockedFor(stage) {
  const s = Math.max(0, Math.min(Number(stage) || 0, MAX_STAGE))
  const phase = STAGES.slice(0, s + 1).flatMap((x) => x.tools)
  return [...new Set([...phase, ...GLOBAL_SAFE])]
}

/** we-form 阶段文本（you-form 是 let me 吸引子——上游实测结论）。
 *  当前版本无硬门控：展示本阶段新增工具（GLOBAL_SAFE 已覆盖全量，不重复全列表）。 */
export function stageText(stage) {
  const s = Math.max(0, Math.min(Number(stage) || 0, MAX_STAGE))
  const tools = STAGES[s].tools.join(', ')
  return 'Current phase: ' + STAGES[s].name + ' (' + s + '/3). Phase tools: ' + tools
    + '.\nPhase is self-routed state: we decide when to advance — use a next-tier tool or state that our phase is done.'
}

/** 阶段推进（上游 advanceStage 的 opencode 映射版；工具证据 + 文本信号）。 */
export function advanceStage(stage, toolNames, text) {
  const names = Array.isArray(toolNames) ? toolNames : []
  const words = typeof text === 'string' ? text : ''
  let s = Math.max(0, Math.min(Number(stage) || 0, MAX_STAGE))
  if (s === 0 && (names.includes('todowrite') || names.includes('task') || /start development|enter development|begin implementation|write the code/i.test(words))) s = 1
  if (s === 1 && names.some((n) => ['write', 'edit', 'apply_patch'].includes(n))) s = 2
  if (s === 2 && (names.includes('bash') || /verif|finished|done/i.test(words))) s = 3
  return s
}

/** Bootstrap 声明（上游 PROGRESSIVE_DECL 原义）。 */
export const PROGRESSIVE_DECL =
  'We hold a full tool registry, revealed in phases. tools_catalog lists every tool (name + summary); tools_help <name> returns a tool\'s description. We query on demand and call precisely.'

/** MAXential 泄压引导（上游 PRESSURE_GUIDE 原义）。 */
export const PRESSURE_GUIDE =
  '\n\nPressure valve (MAXential): for deep reasoning we do not loop "but wait" — we pour it into the valve: think a step, revise an earlier step, branch + merge an alternative, and complete when truly settled. Depth is our call: a small result gets a small thought, a consequential fork gets full reasoning. Triggers: two or more dependent steps, asked the same thing twice, or caught restating a decision / reaching for "actually / but wait".'

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
  task: 'delegate a subagent task',
  skill: 'load a skill',
  describe_image: 'describe an image',
  tools_catalog: 'list all tools (one-line summaries)',
  tools_help: 'describe one tool in detail',
  phase_begin: 'confirm session start (unlock phase 0)',
  phase_advance: 'advance to the next phase',
  dev_router_status: 'show routing state',
  dev_router_mode: 'show/override reasoning mode',
  delivery_check: 'delivery gate: artifact exists / non-empty / UTF-8 (PASS before declaring done)',
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
