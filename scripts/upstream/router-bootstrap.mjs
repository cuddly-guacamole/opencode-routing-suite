/**
 * router-bootstrap (standard v0.7.4): progressive tool disclosure — game-style timeline.
 *
 * 时序（用户定稿）：
 *   T0 首轮 = 纯 RL 句（46 字符）+ phase_begin（唯一确认工具，native；稳定 we）
 *   T1 模型调 phase_begin（确认开启）→ Bootstrap 消息（声明+泄压+阶段0指引）
 *      + 解锁阶段 0 + 切换 PTC（presentAs code）
 *   T2 闯关：模型完成阶段 → phase_advance → 解锁下一档 + 阶段提示（一次）
 *
 * 要点：
 *   - 首轮无 restrict（phase_begin 可见）；确认后才 restrict/注入/切 PTC
 *   - tools.restrict 是交集——释放旧 disposer 再设新（restrictLift per-session）
 *   - stage 状态持久化（stages.json：ensureStage/saveStageState）
 *   - we-form 阶段声明（you-form 是 let me 吸引子——用户命名 react=稳定we/spec=letMe）
 */

import {
  applyPersona, bandFor, bandOf, coreFor, parseMode, personaFor, sessionMode, testinessFor, clamp01,
  classifyTask, extractText, isComplexTask,
} from './router-core.mjs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'

export const name = 'router-bootstrap'
export const inject = ['systemPrompt', 'tools', 'llm']

function toJsonSchema(spec) {
  const properties = {}
  const required = []
  for (const [key, meta] of Object.entries(spec || {})) {
    const prop = { type: meta.type }
    if (Array.isArray(meta.enum)) prop.enum = meta.enum
    if (meta.description) prop.description = meta.description
    properties[key] = prop
    if (meta.required) required.push(key)
  }
  return { type: 'object', properties, required, additionalProperties: false }
}

const RL_PERSONA = 'You are a helpful software engineer assistant.'
const PROGRESSIVE_DECL =
  'We hold a full tool registry (48+ items), revealed in phases. tools_catalog lists every tool (name + summary); tools_help <name> returns any tool\'s complete spec. We query on demand and call precisely.'
const PRESSURE_GUIDE =
  '\n\nPressure valve (MAXential): for deep reasoning we do not loop "but wait" — we pour it into the valve: think a step, revise an earlier step, branch + merge an alternative, and complete when truly settled. Depth is our call: a small result gets a small thought, a consequential fork gets full reasoning. Triggers: two or more dependent steps, asked the same thing twice, or caught restating a decision / reaching for "actually / but wait".'
const START_GUIDE =
  '\n\nBootstrap (once per session): this is a progressive tool-unlock session — tools open in phases like a leveling game. Call phase_begin to confirm start (unlock phase-0 tools + Code Mode).'

const STAGES = [
  { name: '了解/对齐', tools: ['read', 'glob', 'grep', 'web_search', 'ask_user_question', 'engram_recall', 'engram_verify', 'engram_respond'] },
  { name: '拟合方案', tools: ['todo_write', 'exit_plan_mode', 'engram_search', 'engram_open'] },
  { name: '开发', tools: ['write', 'edit', 'str_replace_editor', 'engram_store', 'engram_link'] },
  { name: '验证', tools: ['pwsh', 'bash', 'read_image', 'job_list', 'job_output', 'job_kill'] },
]

const GLOBAL_SAFE = [
  'read', 'write', 'edit', 'glob', 'grep', 'web_search', 'ask_user_question',
  'todo_write', 'exit_plan_mode', 'pwsh', 'bash', 'read_image',
  'job_list', 'job_output', 'job_kill', 'str_replace_editor',
  'tools_catalog', 'tools_help', 'dev_router_status', 'dev_router_mode', 'phase_begin', 'phase_advance',
  'engram_recall', 'engram_store', 'engram_propose', 'engram_confirm', 'engram_reject',
  'engram_open', 'engram_search', 'engram_link', 'engram_update', 'engram_remove',
  'engram_promote', 'engram_status', 'engram_verify', 'engram_respond',
]

/** 闯关提示（阶段切换时注入一次——新工具 + 下一关条件）。 */
const STAGE_GUIDES = [
  'Phase: understanding. Unlocked: read/glob/grep/web_search/ask_user_question + memory (engram_recall/verify/respond). Complete understanding, then call phase_advance to enter planning.',
  'Phase: planning. Unlocked: todo_write/exit_plan_mode + memory review (engram_search/open). Lock the plan, then call phase_advance to enter development.',
  'Phase: development. Unlocked: write/edit/str_replace_editor + memory write (engram_store/link). Produce, then call phase_advance to enter verification.',
  'Phase: verification. Unlocked: pwsh/bash/read_image/jobs. Verify and deliver — the full catalog opens.',
]

/** 阶段文本（we-form——you-form 是 let me 吸引子）。 */
function stageText(stage) {
  const unlocked = STAGES.slice(0, Math.min(stage + 2, STAGES.length)).flatMap((s) => s.tools)
  return 'Current phase: ' + STAGES[stage].name + ' (' + stage + '/3). Unlocked tools: ' + unlocked.join(', ')
    + ' (next tier pre-unlocked).\nPhase is self-routed state: we decide when to advance — use a next-tier tool or state that our phase is done.'
}

/* 阶段状态持久化 */
const stageFile = () => process.env.DSH_ROUTER_STAGE_FILE || join(homedir(), '.dsh', 'router-standard', 'stages.json')
let stageCache = null
function ensureStage() {
  const file = stageFile()
  if (stageCache === null || stageCache.file !== file) {
    stageCache = { file, state: loadStageState() }
  }
  return stageCache.state
}
function loadStageState() {
  try {
    const parsed = JSON.parse(readFileSync(stageFile(), 'utf8'))
    if (parsed && typeof parsed === 'object' && parsed.sessions && typeof parsed.sessions === 'object') {
      const out = {}
      for (const [sid, st] of Object.entries(parsed.sessions)) {
        const stage = Number(st?.stage)
        if (Number.isInteger(stage) && stage >= 0 && stage <= 3) out[sid] = { stage, guided: st?.guided === true }
      }
      return out
    }
  } catch { /* 不存在/损坏 */ }
  return {}
}
function saveStageState() {
  try {
    mkdirSync(join(stageFile(), '..'), { recursive: true })
    writeFileSync(stageFile(), JSON.stringify({ version: 2, savedAt: new Date().toISOString(), sessions: ensureStage() }, null, 2), 'utf8')
  } catch { /* 持久化失败不阻塞 */ }
}

/** restrict 交集修复：per-session disposer（释放旧再设新）。 */
const restrictLift = new Map()
function applyStageRestrict(agent, stage) {
  try {
    const sid = agent?.session?.id
    const prev = sid ? restrictLift.get(sid) : undefined
    if (prev) { try { prev() } catch { /* ignore */ } }
    const toolsSvc = agent.ctx.get('tools')
    if (toolsSvc && typeof toolsSvc.restrict === 'function') {
      const allowed = new Set(STAGES.slice(0, Math.min(stage + 2, STAGES.length)).flatMap((s) => s.tools))
      const disposer = toolsSvc.restrict({ allow: [...allowed].filter((t) => GLOBAL_SAFE.includes(t)) })
      if (sid && disposer) restrictLift.set(sid, disposer)
    }
  } catch { /* scope-local names in allow: skip restrict, keep full catalog */ }
}

export function apply(ctx, config) {
  const agents = new Map()
  const firstUserText = new Map()
  const sessionModels = new Map()
  const overrides = new Map()

  ctx.on('agent/inbox/claimed', ({ agent, message }) => {
    if (message?.source?.kind !== 'user') return
    const text = extractText(message)
    if (!text.trim()) return
    const session = agent?.session
    if (session !== undefined && !firstUserText.has(session.id)) firstUserText.set(session.id, text.trim())
  })

  ctx.on('system-prompt/assemble', async (_assembly, context, next) => {
    const assembled = await next()
    const agent = context.agent
    if (agent === undefined) return assembled
    if (agent.session?.header?.parentSession !== undefined) return assembled
    const session = agent.session
    agents.set(session.id, agent)

    const selectedModel = assembled.variables?.model
      ? { provider: assembled.variables?.provider, model: assembled.variables.model }
      : undefined
    if (selectedModel?.model) sessionModels.set(session.id, selectedModel)

    const promoted = session.events.some((event) => event.type === 'tool/call')
    const planSection = (assembled.sections || []).find((s) => /plan/i.test(s.name))
    const baseSections = planSection
      ? [planSection, { name: 'router-persona', text: RL_PERSONA, order: 0 }]
      : [{ name: 'router-persona', text: RL_PERSONA, order: 0 }]

    if (!promoted) {
      // 首轮：无 restrict + 工具面只留 phase_begin（纯 RL 条件 = 稳定 we）
      return { ...assembled, sections: baseSections, contexts: [], tools: assembled.tools.filter((tool) => tool.name === 'phase_begin') }
    }

    // promoted：官方 sections 回流（persona 保持 RL 句）+ 阶段声明 + 全目录
    const sections = (assembled.sections || []).map((s) =>
      /persona/i.test(s.name) ? { ...s, text: RL_PERSONA } : s
    )
    sections.push({ name: 'router-stage', order: 1, text: stageText(ensureStage()[session.id]?.stage ?? 0) })
    return { ...assembled, sections, contexts: [] }
  })

  // ── 工具注册 ─────────────────────────────────────────────────────────────
  const registerTool = (tool) => {
    ctx.effect(() => ctx.tools.register({
      ...tool,
      parameters: toJsonSchema(tool.parameters),
    }))
  }

  function toolIndex() {
    const seen = new Set()
    const out = []
    for (const s of ctx.tools.schemas()) {
      const name = s.name || s.function?.name
      if (!name || seen.has(name)) continue
      seen.add(name)
      out.push({ name, desc: (s.description || s.function?.description || '').trim() })
    }
    return out.sort((a, b) => a.name.localeCompare(b.name))
  }

  registerTool({
    name: 'phase_begin',
    description: '确认开启本次会话：开始渐进式工具解锁（注入机制声明 + 解锁阶段 0 工具 + 切换 Code Mode）。调用即开始。',
    parameters: {},
    output: { schema: { type: 'string' }, render: (_a, v) => [{ type: 'text', text: String(v) }] },
    async execute() {
      const session = currentSession()
      if (session === undefined) return 'no agent session'
      const sid = session.id
      const state = ensureStage()
      state[sid] = state[sid] ?? { stage: 0, guided: false }
      state[sid].guided = true
      saveStageState()
      applyStageRestrict(currentAgent(), 0)
      try {
        const toolsSvc = currentAgent()?.ctx?.get('tools')
        if (toolsSvc && typeof toolsSvc.presentAs === 'function') toolsSvc.presentAs('code')
      } catch { /* already declared */ }
      const guide = START_GUIDE + '\n\n' + PROGRESSIVE_DECL + '\n\n' + PRESSURE_GUIDE + '\n\n' + stageText(0) + '\n' + STAGE_GUIDES[0]
      try {
        currentAgent()?.inbox.append('next-step', {
          id: 'bootstrap-' + Date.now(),
          role: 'user',
          source: { kind: 'plugin', plugin: 'router-bootstrap' },
          content: [{ type: 'text', text: guide }],
        })
      } catch { /* skip */ }
      return 'session started: phase 0 (了解/对齐) unlocked — read/glob/grep/web_search/ask_user_question + engram memory; next tier pre-unlocked. Bootstrap injected.'
    },
  })

  registerTool({
    name: 'phase_advance',
    description: '闯关推进：声明当前阶段已完成，进入下一阶段（解锁新工具 + 阶段切换提示）。仅在明确完成本阶段工作时调用。',
    parameters: { reason: { type: 'string', description: '推进理由（可选，记录用）' } },
    output: { schema: { type: 'string' }, render: (_a, v) => [{ type: 'text', text: String(v) }] },
    async execute(args) {
      const session = currentSession()
      if (session === undefined) return 'no agent session'
      const sid = session.id
      const stage = ensureStage()[sid]?.stage ?? 0
      if (stage >= STAGES.length - 1) {
        return 'already at the last stage (' + STAGES[stage].name + '); full catalog is open'
      }
      const next = stage + 1
      const state = ensureStage()
      state[sid] = state[sid] ?? { stage: 0, guided: false }
      state[sid].stage = next
      saveStageState()
      applyStageRestrict(currentAgent(), next)
      try {
        currentAgent()?.inbox.append('next-step', {
          id: 'phase-' + next + '-' + Date.now(),
          role: 'user',
          source: { kind: 'plugin', plugin: 'router-bootstrap' },
          content: [{ type: 'text', text: '\nPhase advanced: ' + STAGES[next].name + ' (' + next + '/3).' + STAGE_GUIDES[next] }],
        })
      } catch { /* skip */ }
      return 'advanced to phase ' + next + ': ' + STAGES[next].name + ' (tools unlocked: ' + STAGES.slice(0, next + 1).flatMap((s) => s.tools).join(', ') + ')'
    },
  })

  registerTool({
    name: 'tools_catalog',
    description: '渐进式披露一级：全部工具（名称 + 一行摘要）。query 关键词过滤；domain 域浏览。',
    parameters: { query: { type: 'string' }, domain: { type: 'string' } },
    output: { schema: { type: 'string' }, render: (_a, v) => [{ type: 'text', text: String(v) }] },
    async execute(args) {
      const all = toolIndex()
      const q = String(args.query || '').toLowerCase()
      const d = String(args.domain || '').toLowerCase()
      const dom = (n, desc) => {
        const t = n + ' ' + desc
        if (/(read|write|edit|glob|grep|str_replace_editor|fs|file|path)/i.test(t)) return 'file'
        if (/(bash|pwsh|shell|run_code|exec|command|spawn)/i.test(t)) return 'exec'
        if (/(web|search|fetch|http|network|browse)/i.test(t)) return 'network'
        if (/(subagent|agent|delegate|workflow|ralph|fork)/i.test(t)) return 'delegate'
        if (/(engram|memory|recall|store|search)/i.test(t)) return 'memory'
        return 'other'
      }
      const rows = all.filter((t) => {
        if (q && !(t.name + ' ' + t.desc).toLowerCase().includes(q)) return false
        if (d && dom(t.name, t.desc) !== d) return false
        return true
      })
      if (rows.length === 0) return '（无匹配工具）'
      return rows.map((t) => '- ' + t.name + ' — ' + (t.desc.split(/\n|\. /)[0].slice(0, 90))).join('\n')
    },
  })

  registerTool({
    name: 'tools_help',
    description: '渐进式披露二级：单个工具的完整 schema（参数/必需/描述）。精准调用前先查。',
    parameters: { name: { type: 'string', required: true, description: '工具名（tools_catalog 里查到的）' } },
    output: { schema: { type: 'string' }, render: (_a, v) => [{ type: 'text', text: String(v) }] },
    async execute(args) {
      const name = String(args.name || '').trim()
      const all = toolIndex()
      if (!all.find((x) => x.name === name)) return '未知工具: ' + name + '（先用 tools_catalog 查）'
      for (const s of ctx.tools.schemas()) {
        const n = s.name || s.function?.name
        if (n !== name) continue
        const params = s.parameters || s.function?.parameters || {}
        const props = params.properties || {}
        const required = params.required || []
        const lines = ['工具: ' + name, '描述: ' + (s.description || s.function?.description || '')]
        for (const [k, v] of Object.entries(props)) {
          const meta = v || {}
          lines.push('  ' + k + ': ' + (meta.type || 'any') + (required.includes(k) ? '（必需）' : '') + ' — ' + (meta.description || ''))
        }
        return lines.join('\n')
      }
      return '未知工具: ' + name
    },
  })

  registerTool({
    name: 'dev_router_status',
    description: 'Show the current routing state (phase, band, persona, unlocked tools, override).',
    parameters: {},
    output: { schema: { type: 'string' }, render: (_a, v) => [{ type: 'text', text: String(v) }] },
    async execute() {
      const session = currentSession()
      if (session === undefined) return 'no agent session'
      const sid = session.id
      const stage = ensureStage()[sid]?.stage ?? 0
      const mode = overrides.get(sid) ?? sessionMode(session)
      return [
        'router=standard (progressive, v0.7.4)',
        'phase=' + STAGES[stage].name + ' (' + stage + '/3)',
        'unlocked=[' + STAGES.slice(0, stage + 1).flatMap((s) => s.tools).join(', ') + ']',
        'mode=' + fmtMode(mode) + ' (band=' + bandFor(mode) + ')',
        'persona=' + RL_PERSONA,
      ].join('\n')
    },
  })

  registerTool({
    name: 'dev_router_mode',
    description: 'Temporarily override the reasoning mode (spec/weak/mixed/react, 0-100, 0.0-1.0, or auto to clear).',
    parameters: { mode: { type: 'string', required: true } },
    output: { schema: { type: 'string' }, render: (_a, v) => [{ type: 'text', text: String(v) }] },
    async execute(args) {
      const parsed = parseMode(String(args.mode || '').trim())
      if (parsed === null) return 'invalid mode "' + args.mode + '"'
      const session = currentSession()
      if (session === undefined) return 'no agent session'
      if (parsed === 'auto') { overrides.delete(session.id); return 'auto: override cleared' }
      overrides.set(session.id, parsed)
      return 'mode set to ' + parsed + ' (band=' + bandFor(parsed) + ')'
    },
  })

  function currentSession() {
    const agent = ctx.get('agent')
    if (agent !== undefined && agent.session !== undefined) return agent.session
    const last = [...agents.values()].at(-1)
    return last?.session
  }
  function currentAgent() {
    const session = currentSession()
    return session === undefined ? undefined : [...agents.values()].find((a) => a.session === session)
  }
}

function fmtMode(mode) {
  if (mode === 'weak') return 'weak'
  const m = clamp01(mode)
  return m < 0.2 ? 'react' : m < 0.5 ? 'mixed' : 'spec'
}
