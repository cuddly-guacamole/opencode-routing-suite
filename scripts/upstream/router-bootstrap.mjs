/**
 * router-bootstrap (standard v1.6.0): progressive tool disclosure — game-style timeline.
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
import { join, dirname } from 'node:path'
import { homedir, tmpdir } from 'node:os'
import { pathToFileURL } from 'node:url'
import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync } from 'node:fs'
import vm from 'node:vm'

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
  'We hold a full tool registry (48+ items), revealed in phases. tools_catalog lists every tool (name + summary + [phase mark] + param names); tools_help <name> returns any tool\'s complete spec. We query on demand and call precisely. '
  + 'Inside run_code the meta tools are bound at phase_begin: tools_catalog/tools_help (secondary disclosure), phase_advance/dev_router_status/dev_router_mode (level-up & self-check), dev_reload_preset_live (live reload), dev_page_check (headless screenshot + DOM smoke). '
  + 'Long-running goals carry goal tools: get_goal / create_goal / update_goal (read before updating, mark complete only when actually achieved). '
  + 'Tool signatures are NOT uniform: before the first use of any tool this session, read its parameter names via tools_catalog or tools_help (or the SDK type inside run_code) — never guess. Runtime caps (read lines, search count, output bytes) are enforced at call time — check tools_help before big calls. '
  + 'Tools are directly callable (both mode: native + run_code): call write/edit/read/pwsh directly, or batch steps inside run_code as tools[\'name\'](args). Zero-arg tools still take {}: tools[\'dev_router_status\']({}). '
  + 'write/edit bindings return the FULL before/after text — take only path/operation, never print a whole write/edit result (context explosion); inspect the changed lines with grep/read instead. Page verification is built in: dev_page_check(url) → headless Chrome, fresh profile, screenshot + DOM snippet.'
const PRESSURE_GUIDE =
  '\n\nPressure valve (MAXential): for deep reasoning we do not loop "but wait" — we pour it into the valve: think a step, revise an earlier step, branch + merge an alternative, and complete when truly settled. Depth is our call: a small result gets a small thought, a consequential fork gets full reasoning. Triggers: two or more dependent steps, asked the same thing twice, or caught restating a decision / reaching for "actually / but wait".'
const START_GUIDE =
  '\n\nBootstrap (once per session): this is a progressive tool-unlock session — tools open in phases like a leveling game. Call phase_begin to confirm start (unlock phase-0 tools + Code Mode).'
  + 'Unlock order: understanding (read/glob/grep/web_search/ask_user_question) → planning (todo_write) → development (write/edit/str_replace_editor) → verification (pwsh/read_image/jobs). '
  + 'This guide appears only once; after this, no phase messages are injected. '
  + 'Current phase + unlocked tools are always visible in the system prompt (router-stage section) and via dev_router_status. '
  + 'Meta tools are available immediately inside run_code: tools_catalog (index), tools_help (full schema), phase_advance (level up), dev_router_status/dev_router_mode (self-check & override), dev_page_check (page verification). '
  + 'Tools are directly callable from now on (both mode) — or batch multiple steps inside a run_code program as tools[\'name\']({...}). A direct call always works; run_code is optional for efficiency. '
  + 'You route yourself: to advance, use a next-tier tool (it is pre-unlocked), call phase_advance, or state that the current phase is done.'

const STAGES = [
  { name: '了解/对齐', tools: ['read', 'glob', 'grep', 'web_search', 'ask_user_question', 'engram_recall', 'engram_verify', 'engram_respond'] },
  { name: '拟合方案', tools: ['todo_write', 'exit_plan_mode', 'engram_search', 'engram_open'] },
  { name: '开发', tools: ['write', 'edit', 'str_replace_editor', 'engram_store', 'engram_link'] },
  { name: '验证', tools: ['pwsh', 'bash', 'read_image', 'job_list', 'job_output', 'job_kill'] },
]
// 平台事实（v1.12）：win32 已由 gitbash-shell 组提供真 Git Bash（isolate realm 私有 shell seam，
// 机制参照 liceses/dsh-gitbash-preset, MIT）——bash 重回验证档（原 v1.5 的平台剔除已回退）。

const GLOBAL_SAFE = [
  'read', 'write', 'edit', 'glob', 'grep', 'web_search', 'ask_user_question',
  'todo_write', 'exit_plan_mode', 'pwsh', 'bash', 'read_image',
  'job_list', 'job_output', 'job_kill', 'str_replace_editor',
  'tools_catalog', 'tools_help', 'dev_router_status', 'dev_router_mode', 'phase_begin', 'phase_advance',
  'engram_recall', 'engram_store', 'engram_propose', 'engram_confirm', 'engram_reject',
  'engram_open', 'engram_search', 'engram_link', 'engram_update', 'engram_remove',
  'engram_promote', 'engram_status', 'engram_verify', 'engram_respond',
  'dev_reload_preset_live', 'dev_page_check', 'delivery_check',
  'get_goal', 'create_goal', 'update_goal',
]

const META_TOOLS = ['phase_advance', 'dev_router_status', 'dev_router_mode', 'tools_catalog', 'tools_help']
const META_LIVE = [...META_TOOLS, 'dev_reload_preset_live', 'dev_page_check', 'phase_begin', 'delivery_check']
const META_GOAL = ['get_goal', 'create_goal', 'update_goal']
const META_ALL = [...META_LIVE, ...META_GOAL]

/** 闯关提示（常驻于 stageText——每阶段的"要解锁 X，先做 Y"引导；免打断、经压缩不丢）。
 *  实测吸收（v1.4）：参数不猜/重读再改/Windows shell/沙箱提升/多图对比。
 *  v1.5：caps 提示 / write-edit 只用 path / shell 真实语义 / dev_page_check。
 *  v1.6：预放两档 + 直达语义（写 HTML 直给任务零路由成本）；跨语言转义提醒。 */
const STAGE_GUIDES = [
  'Phase: understanding. Unlocked: read/glob/grep/web_search/ask_user_question + memory (engram_recall/verify/respond) + pre-unlocked write/edit (two tiers ahead — calling one jumps straight there). Ground first: recall, verify claims, then read/ask. Design or build intent already unlocks development tools — no routing ceremony needed. Runtime caps (read lines, output bytes) are enforced at call time — check tools_help before big calls. Complete when: the task requirements and available evidence are stated clearly. Then work (write is already unlocked).',
  'Phase: planning. Unlocked: todo_write/exit_plan_mode + memory review (engram_search/open) + pre-unlocked write/edit/pwsh. Lock the plan, then work — calling a pre-unlocked tool jumps to its phase; phase_advance advances one stage (never skips). Complete when: the plan is recorded and decisions are locked. Then develop.',
  'Phase: development. Unlocked: write/edit/str_replace_editor + memory write (engram_store/link) + pre-unlocked verification tools. Re-read before re-edit: a file changed since your last read must be read again first (editor enforces a fresh read). write/edit results carry the FULL before/after text — take only path/operation and inspect changed lines with grep/read; never print a whole write/edit result. Cross-language escaping: run_code programs are JS — PowerShell "${env:V}" is template-interpolated by JS; build such strings with single quotes or concatenation first. Complete when: the artifact exists and passes its own self-check (loads, no console errors, key values sane). Then phase_advance to verification.',
  'Phase: verification → delivery gate. Unlocked: pwsh/bash/read_image/jobs + dev_page_check + delivery_check (meta). Shell: Windows: bash = Git Bash (MSYS, GNU) — first-class shell (pwsh remains for PowerShell-native needs); POSIX: bash. Git Bash needs full access to start (MSYS cannot run under a restricted token) — if it fails at workspace-write, do the documented one-shot escalation, never bypass the sandbox. Page verification: dev_page_check(url) — screenshot + DOM smoke + console/pageerror (title/selector/scale options); dev_page_check({js: "..."}) runs a local JS engine (syntax check + pure-logic unit tests, no browser, no node dependency). Compare screenshots via read_image one at a time, or stitch a contact sheet with pwsh first. **Complete only when: delivery_check(file[, url]) returns PASS** — artifact exists / non-empty / UTF-8, headless smoke OK (title + no console errors), and the rendered result reviewed via read_image. Until delivery_check passes, do NOT report the task as delivered — any FAIL: fix and re-run. If the sandbox denies an in-place verify, escalate the exact command once, never work around it.',
]

/** 阶段文本（we-form——you-form 是 let me 吸引子）。
 *  v1.6：预放两档（stage 0 就用得到 write/edit）——消除"先玩一遍路由才能干活"的摩擦。 */
function stageSummary(stage) {
  const unlockedEnd = Math.min(stage + 3, STAGES.length)
  const unlocked = STAGES.slice(0, unlockedEnd).flatMap((s) => s.tools).concat(META_ALL)
  const nextTier = stage + 1 < STAGES.length ? STAGES[stage + 1].tools : []
  const nextAfter = stage + 2 < STAGES.length ? STAGES[stage + 2].tools : []
  return { name: STAGES[stage].name, stage, unlocked, nextTier, nextAfter }
}
function stageText(stage) {
  const s = stageSummary(stage)
  const delivery = stage >= STAGES.length - 1 ? '\nDelivery: restrict released — full catalog open (all registered tools).' : ''
  return 'Current phase: ' + s.name + ' (' + s.stage + '/3). Callable now: ' + s.unlocked.join(', ')
    + (delivery || '\nNot yet callable (until delivery): every other registered tool stays locked — and until the delivery phase passes delivery_check, do NOT declare the task delivered. Delivery is the gate, not a progress label.')
    + '\nStage guide: ' + (STAGE_GUIDES[stage] || '')
    + '\nPhase is self-routed state: calling a pre-unlocked tool jumps the phase to that tool\'s stage; phase_advance (meta) advances one stage; or state that our phase is done.'
}

/** PTC 阶段化 SDK：按当前阶段生成精简 SDK 文本（替换 tools:sdk 段—— 39K 全量 SDK 是注意力税；阶段精简版只给当前阶段调用签名 + 全量声明）。 */
function buildStagedSdk(sections, stage) {
  const sdk = sections.find((s) => s?.name === 'tools:sdk')
  if (!sdk) return null
  const stageTools = STAGES.slice(0, Math.min(stage + 3, STAGES.length)).flatMap((s) => s.tools).concat(META_ALL)
  // 真实 SDK 由 registry 生成：sdkSchemas(view) 已按 restrict + own-layer 阶段化，
  // 保留其完整类型声明；只加一行阶段头，避免 bullet 清单丢掉 schema（补全 run_code 工具 schema）。
  if (typeof sdk.text === 'string') {
    const header = '## 阶段化工具（当前可见）：' + stageTools.join(', ') + '\n\n'
    return { ...sdk, text: header + sdk.text }
  }
  return sdk
}

/** 读取工具调用参数（tool/call 的 arguments 是 JSON 字符串；tool/code-dispatch 是对象）。 */
function toolArgs(data) {
  const a = data?.arguments
  if (typeof a === 'string') { try { return JSON.parse(a) } catch { return null } }
  return a ?? null
}

/** 阶段带宽控：tool:* 引导段按当前可见面裁剪（100-199 段的工具使用说明是静态注册，
 *  不受 restrict 过滤——与 39K SDK 同款的注意力税；这里只把"不可调用工具"的说明裁掉）。
 *  安全规则：后缀必须是全量注册中的真实工具名，且不在当前可见面 → 才裁掉；否则保留。 */
export function filterToolGuidance(sections, stage, fullNames) {
  if (stage >= STAGES.length - 1) return sections
  const visible = new Set(stageSummary(stage).unlocked)
  return (sections || []).filter((s) => {
    const name = typeof s?.name === 'string' ? s.name : ''
    if (!name.startsWith('tool:')) return true
    const toolName = name.slice(5)
    if (!fullNames.has(toolName)) return true
    return visible.has(toolName)
  })
}

/** 全量工具名（不受 restrict 过滤）：view(scope).knownNames = restrict 前的继承面 + own layer。 */
function knownToolNames(toolsSvc, scope) {
  try {
    const names = new Set()
    const view = typeof toolsSvc?.view === 'function' ? toolsSvc.view(scope) : undefined
    for (const nm of view?.knownNames ?? []) names.add(nm)
    if (typeof toolsSvc?.schemas === 'function') {
      for (const s of toolsSvc.schemas(scope)) { const nm = s.name || s.function?.name; if (nm) names.add(nm) }
    }
    return names
  } catch { return new Set() }
}

/** 全量索引（二级披露）：knownNames + 层链原始定义——不随 restrict 阶段过滤（catalog 列全部工具）。 */
function registryFullIndex(toolsSvc, scope) {
  try {
    const ls = toolsSvc?.layers
    const view = typeof toolsSvc?.view === 'function' ? toolsSvc.view(scope) : undefined
    const names = new Set(view?.knownNames ?? [])
    if (typeof toolsSvc?.schemas === 'function') {
      for (const s of toolsSvc.schemas(scope)) { const nm = s.name || s.function?.name; if (nm) names.add(nm) }
    }
    const chain = (typeof ls?.chainLayers === 'function' ? ls.chainLayers(scope) : []) || []
    const own = typeof ls?.peek === 'function' ? ls.peek(scope) : undefined
    const layersList = []
    if (ls?.global) layersList.push(ls.global)
    layersList.push(...chain)
    if (own) layersList.push(own)
    const findDef = (name) => {
      for (const layer of layersList) {
        const lt = layer?.tools
        let def = typeof lt?.get === 'function' ? lt.get(name) : undefined
        if (!def && lt && typeof lt.entries === 'function') {
          for (const [nn, dd] of lt.entries()) if (nn === name) { def = dd; break }
        }
        if (def) return def
      }
      return undefined
    }
    return [...names].sort().map((name) => {
      const def = findDef(name)
      return { name, description: def?.description || '', parameters: def?.parameters || {} }
    })
  } catch { return [] }
}

/** 二级披露可见性标记（v1.9 根修——"标注可调但 run_code 未绑定"六轮实弹反馈）：
 *  静态阶段映射会与运行时 view(scope).visible（SDK 真绑定）错位；标记必须回答
 *  "这个工具现在真的绑在 run_code 的 tools 上吗"——以运行时可见面为准。 */
export function markerFor(name, stage) {
  if (stage >= STAGES.length - 1) return '全量'
  if (META_ALL.includes(name)) return 'meta'
  const idx = STAGES.findIndex((s) => s.tools.includes(name))
  if (idx < 0) return '交付后'
  if (idx <= stage + 2) return '可调' // v1.6 预放两档 = 已可调："预解锁" 与 "可调" 无行为差 → 单语义
  return '交付后'
}

/** 运行时真绑定标记（v1.9）：registry.view(scope).visible 是 SDK 生成的唯一事实源——
 *  visible.has(name) = run_code 的 tools[name] 一定存在；否则一律"交付后"，绝不谎报。 */
export function runtimeMark(toolsSvc, scope, name) {
  try {
    if (typeof toolsSvc?.view !== 'function') return markerFor(name, 0)
    const visible = toolsSvc.view(scope).visible
    if (typeof visible?.has !== 'function') return markerFor(name, 0)
    if (META_ALL.includes(name)) return visible.has(name) ? 'meta' : '交付后'
    return visible.has(name) ? '可调' : '交付后'
  } catch { return markerFor(name, 0) }
}

/** 运行时真实可调列表（v1.11——status 的 callable 与 SDK 绑定同源）。
 *  只返回"确实绑定在 run_code tools 上"的阶段工具与 meta 工具；其余一律视为交付后。 */
export function runtimeCallable(toolsSvc, scope) {
  try {
    if (typeof toolsSvc?.view !== 'function') return []
    const visible = toolsSvc.view(scope).visible
    const keys = typeof visible?.keys === 'function' ? visible.keys() : []
    const out = []
    for (const name of keys) {
      if (name === 'run_code') continue
      if (STAGES.some((s) => s.tools.includes(name)) || META_ALL.includes(name)) out.push(name)
    }
    return [...out].sort()
  } catch { return [] }
}

/** 参数名速览（一行）：catalog 行内嵌——消灭"猜参数名"摩擦（glob 的 pattern / read 的 file_path / todo_write 的 content 各不相同）。 */
export function paramHint(parameters) {
  try {
    if (typeof parameters === 'function') return 'schema in tools_help'
    const p = parameters && typeof parameters === 'object' && !Array.isArray(parameters) ? parameters : {}
    const props = p.properties || {}
    const keys = Object.keys(props)
    if (keys.length === 0) return 'no params'
    // 带类型（glob 的 pattern: string / read 的 limit: number）——参数名+类型的速览已能消灭大部分试错
    return 'params: ' + keys.map((k) => {
      const meta = props[k] || {}
      const t = meta.type || 'any'
      const extra = meta.description && /defaults? to/i.test(meta.description) ? '≤' + (meta.description.match(/defaults? to (\d+)/i)?.[1] || 'cap') : ''
      return k + ': ' + t + extra
    }).join(', ')
  } catch { return '' }
}

/** str_replace_editor 只有 view 是读操作；create/str_replace/insert 才是开发写入。 */
function isMutatingDev(name, args) {
  if (name === 'str_replace_editor') {
    const command = String(args?.command ?? '').toLowerCase()
    return command === 'create' || command === 'str_replace' || command === 'insert'
  }
  return name === 'write' || name === 'edit'
}

/** 定位 headless 浏览器（实测修复：缺 --user-data-dir 是 600s 挂起根因——profiler 互斥锁）。 */
export function pageRunnerPath() {
  const env = process.env.DSH_PAGE_RUNNER
  if (env && existsSync(env)) return env
  const pf = process.env['ProgramFiles'] || 'C:\\Program Files'
  const pf86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)'
  for (const p of [
    join(pf, 'Google\\Chrome\\Application\\chrome.exe'),
    join(pf, 'Microsoft\\Edge\\Application\\msedge.exe'),
    join(pf86, 'Google\\Chrome\\Application\\chrome.exe'),
    join(pf86, 'Microsoft\\Edge\\Application\\msedge.exe'),
  ]) if (existsSync(p)) return p
  return ''
}

/** DOM 工具（v1.7 增强：dump-dom 文本上的轻量提取——剥离 style/script、title、id/class/tag 文本）。
 *  无完整 HTML parser；#id/.class/tag 提取足够可靠。 */
export function stripDomNoise(html) {
  let s = String(html || '')
  s = s.replace(/<style[\s\S]*?<\/style>/gi, '\n')
  s = s.replace(/<script[\s\S]*?<\/script>/gi, '\n')
  return s
}
export function extractTitle(html) {
  const m = String(html || '').match(/<title[^>]*>([\s\S]*?)<\/title>/i)
  return m ? m[1].trim() : ''
}
export function extractSelectorText(html, selector) {
  const s = String(selector || '').trim()
  if (!s) return ''
  const src = String(html || '')
  const esc = (v) => v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const innerOf = (startIdx, openLen, tagName) => {
    const rest = src.slice(startIdx + openLen)
    const closer = rest.match(new RegExp('</' + tagName + '\\s*>', 'i'))
    const end = closer ? closer.index + closer[0].length : rest.length
    return (rest.slice(0, end).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()).slice(0, 4000)
  }
  if (s.startsWith('#')) {
    const re = new RegExp('<[a-z0-9]+[^>]*\\bid\\s*=\\s*["\']?' + esc(s.slice(1)) + '["\'\\s>]', 'i')
    const m = src.match(re)
    if (!m) return ''
    return innerOf(m.index, m[0].length, m[0].match(/<([a-z0-9]+)/i)?.[1] || 'div')
  }
  if (s.startsWith('.')) {
    const re = new RegExp('<[a-z0-9]+[^>]*\\bclass\\s*=\\s*["\'][^"\']*\\b' + esc(s.slice(1)) + '\\b[^"\']*["\']', 'i')
    const m = src.match(re)
    if (!m) return ''
    return innerOf(m.index, m[0].length, m[0].match(/<([a-z0-9]+)/i)?.[1] || 'div')
  }
  const tag = s.replace(/[^a-z0-9]/gi, '').toLowerCase()
  if (!tag) return ''
  const m = src.match(new RegExp('<' + esc(tag) + '[\\s>]', 'i'))
  if (!m) return ''
  return innerOf(m.index, m[0].length, tag)
}

/** Chrome --enable-logging=stderr 的 console/pageerror 行提取（v1.7：三/四/五轮的"拿不到 console"）。 */
export function extractConsoleLines(stderrText) {
  const t = String(stderrText || '')
  const out = []
  const seen = new Set()
  const push = (line) => {
    const l = line.trim().slice(0, 320)
    if (!l || seen.has(l)) return
    seen.add(l); out.push(l)
  }
  for (const m of t.matchAll(/(?:INFO|ERROR|WARNING|WARN):CONSOLE\((\d+)\):?\s*([^\r\n]*)/gi)) push('console[' + m[1] + ']: ' + m[2])
  for (const m of t.matchAll(/(Uncaught[^\r\n]{0,240})/gi)) push(m[1])
  for (const m of t.matchAll(/((?:TypeError|ReferenceError|SyntaxError|RangeError)[^\r\n]{0,180})/gi)) push(m[1])
  return out.slice(0, 60).join('\n')
}

/** 本地 JS 引擎（v1.7：DSH 进程即 node——vm 隔离执行，语法检查 + 纯逻辑运行；
 *  回应"环境没有 node --check / 无法快速单测"。无 require/process/fs：纯逻辑沙箱。 */
export function runSandboxJs(code) {
  const src = String(code || '').trim()
  if (!src) return { ok: true, output: '', error: '' }
  const logs = []
  const sandbox = {
    console: {
      log: (...a) => logs.push(a.map((x) => (typeof x === 'string' ? x : safeStringify(x))).join(' ')),
      error: (...a) => logs.push('ERR ' + a.map((x) => (typeof x === 'string' ? x : safeStringify(x))).join(' ')),
      warn: (...a) => logs.push('WARN ' + a.map((x) => (typeof x === 'string' ? x : safeStringify(x))).join(' ')),
    },
    JSON, Math, Date, Number, String, Boolean, Array, Object, RegExp, Map, Set,
    parseInt, parseFloat, isNaN, isFinite, NaN, Infinity,
  }
  try {
    // 顶层 return 在 vm.Script 不合法——包装成 IIFE，用户源码里 return 即返回值
    const wrapped = '"use strict";\n(function(){\n' + src + '\n})()'
    const script = new vm.Script(wrapped, { filename: 'sandbox.js' })
    const value = script.runInNewContext(sandbox, { timeout: 5000 })
    const output = logs.join('\n')
    let tail = ''
    if (value !== undefined) tail = (output ? '\n' : '') + '=> ' + safeStringify(value)
    return { ok: true, output: (output + tail).slice(0, 4000), error: '' }
  } catch (e) {
    return { ok: false, output: logs.join('\n'), error: (e && e.message) || String(e) }
  }
}
function safeStringify(v) {
  try { return JSON.stringify(v) ?? String(v) } catch { return String(v) }
}

/** URL 归一化（v1.6：裸路径/中文路径自动转 file:// URL——用户实弹：中文工作区路径必须手工
 *  百分号编码，内置工具应替模型做）。支持 http(s)://、file://、绝对盘符路径、相对路径。 */
export function normalizePageUrl(raw) {
  const u = String(raw || '').trim()
  if (/^https?:\/\//i.test(u)) return u
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(u)) return u // 其他 scheme 原样 → pageCheckRun 校验会拒绝
  if (/^file:/i.test(u)) {
    try { return new URL(u).href } catch { return u }
  }
  const abs = /^[a-zA-Z]:[\\/]/.test(u) || u.startsWith('/')
  try { return pathToFileURL(abs ? u : join(process.cwd(), u)).href } catch { return u }
}

/** 统一失败结果（v1.6.1 修复：此前失败分支返回 {ok:false,error} 缺 schema 的字段且 error
 *  不在 additionalProperties:false 的 schema 内 → 输出校验 invalid output，工具整体不可用）。
 *  v1.7：补齐 title/consoleTail/selectorText/jsOutput/jsError（全分支同形）。 */
export function pageFail(message) {
  return { ok: false, exitCode: -1, timedOut: false, settleError: message, shot: '', domText: '', stderrTail: '', title: '', consoleTail: '', selectorText: '', jsOutput: '', jsError: '' }
}

/** 页面验证执行体（headless Chrome + 新鲜 profile + screenshot + DOM smoke；硬超时杀树）。
 *  ctx 只需 subprocess 服务（ctx.get('subprocess')）。返回 lossless-JSON 概览，所有分支形状统一。
 *  v1.9.1：CPU/进程安全三防（用户实弹"后台挂超多 chrome、CPU 爆掉"）——
 *   ① 单飞锁：同时只允许一个页面检查（并发只返回 busy，不再堆进程）；
 *   ② 结束/超时后强制 taskkill /F /T 树杀（subprocess 默认温和 kill 杀不死无窗口的 headless chrome，
 *      孤儿 renderer/GPU 进程会累积满载 CPU）；
 *   ③ 自动重试改为 opt-in（retry: true）——默认不重试，避免 3D 页 SwiftShader 双倍满载。 */
const PAGE_BUSY_KEY = Symbol.for('router-standard.pageCheckBusy')

export async function pageCheckRun(ctx, args) {
  if (args?.js !== undefined && args?.js !== null && String(args.js).trim() !== '') {
    const r = runSandboxJs(String(args.js))
    return {
      ok: r.ok, exitCode: r.ok ? 0 : -1, timedOut: false, settleError: '',
      shot: '', domText: '', stderrTail: '', title: '', consoleTail: '', selectorText: '',
      jsOutput: r.output, jsError: r.error,
    }
  }
  // 单飞锁：本进程同时只跑一个页面检查（跨 preset 代共享，防多会话/并发堆积）
  const busySlot = globalThis[PAGE_BUSY_KEY] ?? (globalThis[PAGE_BUSY_KEY] = { v: false })
  if (busySlot.v) return pageFail('another page-check is already running (single-flight); retry after it settles')
  busySlot.v = true
  try {
    const first = await pageCheckRunOnce(ctx, args)
    if (first.ok) return first
    // 仅"可重试型"失败才重试（显式 retry:true）：硬错误带 settleError 且未超时 → 不重试
    if (args?.retry !== true || (first.settleError && !first.timedOut)) return first
    const boost = {
      ...args,
      virtualTimeMs: Math.min(60000, Math.floor(Number(args?.virtualTimeMs || 8000) * 2)),
      timeoutMs: Math.min(240000, Math.round(Number(args?.timeoutMs || 20000) * 1.5)),
    }
    return await pageCheckRunOnce(ctx, boost)
  } finally {
    busySlot.v = false
  }
}

/** 强制 tree-kill 兜底（v1.9.1）：taskkill /F /T 按主 pid 杀整棵 chrome 树——subprocess 的
 *  温和 kill（无 /F）对无窗口的 headless chrome 无效，这是"孤儿进程累积"的根因。fire-and-forget。 */
function forceTreeKill(ctx, pid) {
  if (!Number.isInteger(pid) || pid <= 0) return
  try {
    const sub = ctx?.get?.('subprocess')
    if (!sub || typeof sub.spawn !== 'function') return
    sub.spawn({
      argv: ['taskkill', '/F', '/T', '/PID', String(pid)],
      cwd: process.cwd(),
      stdio: { stdin: 'ignore', stdout: 'ignore', stderr: 'ignore' },
      graceMs: 1000,
    })
  } catch { /* 兜底失败不阻塞 */ }
}

/** 单次执行体（无重试语义；参数与 pageCheckRun 相同）。 */
async function pageCheckRunOnce(ctx, args) {
  const chrome = pageRunnerPath()
  if (!chrome) return pageFail('no headless browser found (Chrome/Edge); set DSH_PAGE_RUNNER')
  const url = normalizePageUrl(args?.url)
  if (!/^(https?|file):/i.test(url)) return pageFail('url must be http(s):// / file:// / a path (auto-encoded)')
  // 180s 上限：3DGS/WebGL 页在 SwiftShader 下渲染一帧可达 1 分钟级（用户实弹：gargantua 的
  // ?shot= 模式自驱动帧循环，重页面需足够预算；超时是硬杀树，不会像裸 Chrome 那样 600s 挂死）
  const timeoutMs = Math.min(180000, Math.max(1000, Math.floor(Number(args?.timeoutMs || 20000))))
  const width = Math.min(4096, Math.max(320, Math.floor(Number(args?.width || 1280))))
  const height = Math.min(4096, Math.max(240, Math.floor(Number(args?.height || 800))))
  const domChars = Math.min(30000, Math.max(500, Math.floor(Number(args?.domChars || 8000))))
  const scale = Math.min(4, Math.max(1, Math.floor(Number(args?.scale || 1))))
  const cssSel = String(args?.selector || '').trim()
  const shotRoot = join(process.cwd(), '.dsh-shots')
  const shot = join(shotRoot, 'page-' + Date.now() + '.png')
  const profile = join(tmpdir(), 'dsh-page-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8))
  try { mkdirSync(profile, { recursive: true }) } catch { return pageFail('cannot create temp browser profile') }
  try { mkdirSync(shotRoot, { recursive: true }) } catch { /* chrome 会在写截图时给出可见错误 */ }
  const sub = ctx?.get?.('subprocess')
  if (!sub || typeof sub.spawn !== 'function') return pageFail('no subprocess service in scope')
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), timeoutMs)
  let outcome; let stdoutReader; let stderrReader; let settleError = ''; let childPid = -1
  try {
    const handle = sub.spawn({
      argv: [
        chrome,
        '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
        '--disable-dev-shm-usage', '--user-data-dir=' + profile,
        '--enable-logging=stderr',
        '--enable-unsafe-swiftshader', '--disable-application-cache',
        '--screenshot=' + shot,
        '--window-size=' + width + ',' + height,
        '--force-device-scale-factor=' + String(scale),
        '--virtual-time-budget=' + String(Math.min(30000, Math.max(500, Math.floor(Number(args?.virtualTimeMs || 8000))))),
        '--dump-dom',
        url,
      ],
      cwd: process.cwd(),
      stdio: {
        stdin: 'ignore',
        stdout: { maxBytes: 12 * 1024 * 1024, spill: { maxBytes: 16 * 1024 * 1024 } },
        stderr: { maxBytes: 1024 * 1024, spill: { maxBytes: 2 * 1024 * 1024 } },
      },
      graceMs: 2000,
      signal: ac.signal,
    })
    childPid = handle?.pid
    outcome = await handle.done
    const collected = handle.collected
    stdoutReader = collected?.stdout
    stderrReader = collected?.stderr
  } catch (e) {
    settleError = (e && e.message) || String(e)
  } finally {
    clearTimeout(timer)
    // v1.9.1 强制树杀兜底：subprocess 温和 kill 杀不死无窗口 chrome——无论成败都按主 pid /F /T 清理
    forceTreeKill(ctx, childPid)
  }
  const timedOut = ac.signal.aborted
  const readTail = (reader, max) => {
    try {
      const r = reader?.readFrom?.(0)
      const t = (r && (r.text || '')) || ''
      return t.length > max ? t.slice(0, max) : t
    } catch { return '' }
  }
  const rawDom = readTail(stdoutReader, 8 * 1024 * 1024)
  const domText = stripDomNoise(rawDom).slice(0, domChars)
  const errTail = readTail(stderrReader, 600).replace(/[\r\n]+/g, ' | ').trim()
  const consoleTail = extractConsoleLines(errTail === '' ? '' : readTail(stderrReader, 1024 * 1024))
  const selectorText = extractSelectorText(rawDom, cssSel)
  const exitCode = Number(outcome?.exitCode ?? outcome?.code ?? -1)
  const ok = !settleError && !timedOut && exitCode === 0 && domText.length > 0
  return {
    ok, exitCode: Number.isFinite(exitCode) ? exitCode : -1, timedOut, settleError: settleError || '',
    shot, domText, stderrTail: errTail,
    title: extractTitle(rawDom),
    consoleTail,
    selectorText,
    jsOutput: '', jsError: '',
  }
}

/** 交付 gate（v1.11——用户实弹：缺"交付 gate 工具"，模型把"功能做完"当"完成交付"）：
 *  校验交付物：存在/非空/UTF-8 编码 + 可选 headless smoke（加载/标题/console），
 *  输出 PASS/FAIL + 证据清单；均 PASS 才允许宣告完成。CHECK 永远不强制解锁任何权限，
 *  它是阶段出口契约的落地工具。 */
export async function deliveryCheck(ctx, args) {
  const file = String(args?.file || '').trim()
  const checks = []
  if (!file) return { ok: false, checks: [{ name: 'file-path', pass: false, detail: 'missing file parameter' }] }
  try {
    const st = statSync(file)
    checks.push({ name: 'file-exists', pass: true, detail: `${file} (${st.size} bytes, mtime ${st.mtime.toISOString()})` })
    checks.push(st.size > 0
      ? { name: 'file-nonempty', pass: true, detail: `${st.size} bytes` }
      : { name: 'file-nonempty', pass: false, detail: 'file is 0 bytes' })
  } catch (e) {
    return { ok: false, checks: [...checks, { name: 'file-exists', pass: false, detail: String((e && e.message) || e) }] }
  }
  try {
    const head = readFileSync(file).subarray(0, 65536)
    new TextDecoder('utf-8', { fatal: true }).decode(head)
    checks.push({ name: 'encoding-utf8', pass: true, detail: 'UTF-8 decode OK (head 64KB)' })
  } catch (e) {
    checks.push({ name: 'encoding-utf8', pass: false, detail: String((e && e.message) || e) })
  }
  if (args?.url) {
    const smoke = await pageCheckRun(ctx, { ...args, url: args.url })
    checks.push({
      name: 'headless-smoke',
      pass: smoke.ok,
      detail: `title=${smoke.title || '(empty)'} dom=${smoke.domText.length} console=${smoke.consoleTail ? 'errors present' : 'clean'}${smoke.timedOut ? ' TIMED_OUT' : ''}`,
    })
  }
  return { ok: checks.every((c) => c.pass), checks }
}

function deliveryCheckRender(_args, v) {
  let text = 'delivery-check: ' + (v.ok ? 'PASS ✅' : 'FAIL ❌') + '\n'
  for (const c of v.checks || []) text += `- [${c.pass ? 'PASS' : 'FAIL'}] ${c.name}: ${c.detail}\n`
  text += v.ok
    ? 'All checks passed — delivery gate satisfied; you may report completion to the user.'
    : 'Delivery gate NOT satisfied — do NOT report completion; fix the failing checks and re-run delivery_check.'
  return [{ type: 'text', text }]
}

function pageCheckRender(_args, v) {
  const head = Number.isFinite(v.exitCode) ? v.exitCode : -1
  let text = 'page-check: ' + (v.ok ? 'OK' : 'FAIL')
    + ' (exit=' + head + (v.timedOut ? ', TIMED OUT' : '') + (v.settleError ? ', ' + v.settleError : '') + ')\n'
  if (v.title) text += 'title: ' + v.title + '\n'
  if (v.selectorText) text += 'selector: ' + v.selectorText + '\n'
  if (v.consoleTail) text += '---- console/pageerror ----\n' + v.consoleTail + '\n'
  text += 'screenshot: ' + (v.shot || '') + '\n'
  if (v.stderrTail) text += 'stderr: ' + v.stderrTail + '\n'
  if (v.jsError) text += 'js-error: ' + v.jsError + '\n'
  if (v.jsOutput) text += '---- js output ----\n' + v.jsOutput + '\n'
  text += '---- dom (' + String(v.domText || '').length + ' chars) ----\n' + (v.domText || '')
  return [{ type: 'text', text }]
}

/** 自主推进（v1.6 直达语义——"用哪档工具就跳到哪档"，消除"先玩一遍路由才能干活"的摩擦）：
 *  ① 调用预放档工具 → 直接跳到该工具所在阶段（阶段 0 调 write → 2；调 pwsh → 3）；
 *  ② 文本保底：明确开发意图（写/创建/生成/build/create/implement…）→ 至少 2；
 *  ③ str_replace_editor 仅 create/str_replace/insert 算开发（view 是只读，不推进）；
 *  ④ "/计划|方案|plan/" 宽匹配仍禁用（文件名/话题会误触发——STANDARD-PLAN.md 教训）。 */
export function autoAdvance(stage, toolCalls, text) {
  if (stage >= STAGES.length - 1) return stage
  const tools = Array.isArray(toolCalls) ? toolCalls : []
  const names = new Set(tools.map((t) => (typeof t === 'string' ? t : t?.name)).filter(Boolean))
  const mutatingDev = tools.some((t) => isMutatingDev(typeof t === 'string' ? t : t?.name, t?.args))
  let target = stage
  for (const nm of names) {
    const idx = STAGES.findIndex((s) => s.tools.includes(nm))
    if (idx <= target) continue
    // str_replace_editor：只有 mutating 命令算开发档
    if (nm === 'str_replace_editor' && !mutatingDev) continue
    target = idx
  }
  if (names.has('todo_write')) target = Math.max(target, 1)
  if (/开始开发|进入开发|着手实现|开始实现|write the code|写一个|写一份|创建|生成|实现|构建|build|create|generate|implement|make a|new project/i.test(text)) target = Math.max(target, 2)
  return Math.min(target, STAGES.length - 1)
}

/* 阶段状态持久化 */
const stageFile = () => process.env.DSH_ROUTER_STAGE_FILE || join(process.env.DSH_HOME || homedir(), 'router-standard', 'stages.json')
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
/** 跨 generation 共享：新代才能提起旧代设下的 restrict（避免交集叠加）。 */
const sharedLift = globalThis[Symbol.for('router-standard.restrictLift')] ?? (globalThis[Symbol.for('router-standard.restrictLift')] = new Map())
/** 跨代共享 override：main 注册与 own-layer shim 必须读写同一张表，否则 status 看不到 mode 覆盖。 */
const overrideMap = () => globalThis[Symbol.for('router-standard.overrides')] ??= new Map()
function applyStageRestrict(agent, stage) {
  try {
    const sid = agent?.session?.id
    const prev = sid ? sharedLift.get(sid) : undefined
    if (prev) { try { prev() } catch { /* ignore */ }; if (sid) sharedLift.delete(sid) }
    // 交付阶段：restrict 释放，全量目录开放（STANDARD-PLAN：阶段3 → 全量开放）
    if (stage >= STAGES.length - 1) return
    const toolsSvc = agent.ctx.get('tools')
    if (toolsSvc && typeof toolsSvc.restrict === 'function') {
      const allowed = new Set(STAGES.slice(0, Math.min(stage + 3, STAGES.length)).flatMap((s) => s.tools).concat(META_ALL))
      // v1.5：先按 GLOBAL_SAFE 过滤，再按 restrictableNames 过滤——平台性缺失（如 win32 无 bash）
      // 命名的工具会导致 restrict() 抛 unknown，从而放弃整个阶段门控；双过滤保证门控始终成立。
      let known = null
      try { if (typeof toolsSvc.view === 'function') known = new Set(toolsSvc.view(agent).restrictableNames) } catch { /* fall through */ }
      const allow = [...allowed].filter((t) => GLOBAL_SAFE.includes(t) && (known === null || known.has(t)))
      if (allow.length === 0) return
      const disposer = toolsSvc.restrict({ allow })
      if (sid && disposer) sharedLift.set(sid, disposer)
    }
  } catch (e) { console.error('[router-bootstrap] applyStageRestrict failed:', e); /* scope-local names in allow: skip restrict, keep full catalog */ }
}

export function apply(ctx, config) {
  try { mkdirSync(join(process.env.DSH_HOME || homedir(), 'router-standard'), { recursive: true }); writeFileSync(join(process.env.DSH_HOME || homedir(), 'router-standard', 'last-mount.txt'), 'new-gen v0.8 ' + new Date().toISOString(), 'utf8') } catch { /* marker */ }
  // 运行环境修整：① node 进 PATH（harness 的 node 在自定义运行时目录，不在系统 PATH——v1.5 实测
  // "node not recognized" 的根因）；② Git bin 前置（让 git 在任何 shell 都可用；bash 工具在 win32
  // 已禁用——host 的 shell seam 在 win32 只提供 pwsh，此前 bash 行在 win32 实为 pwsh 语义）。
  try {
    const sep = process.platform === 'win32' ? ';' : ':'
    const fore = (process.env.PATH || '').split(sep).filter(Boolean)
    const nodeDir = dirname(process.execPath || '')
    if (nodeDir && existsSync(join(nodeDir, process.platform === 'win32' ? 'node.exe' : 'node')) && !fore.includes(nodeDir)) fore.unshift(nodeDir)
    for (const gitDir of ['C:\\Program Files\\Git\\bin', 'C:\\Program Files\\Git\\usr\\bin', 'C:\\Program Files (x86)\\Git\\bin']) {
      if (existsSync(join(gitDir, 'bash.exe')) && !fore.includes(gitDir)) fore.unshift(gitDir)
    }
    process.env.PATH = fore.join(sep)
    // shell 解析诊断（v1.4.1→v1.5）：bash/node 实际解析到哪——事实文件，不再靠猜。
    try {
      const cands = fore.filter((e) => existsSync(join(e, process.platform === 'win32' ? 'bash.exe' : 'bash')))
      writeFileSync(join(process.env.DSH_HOME || homedir(), 'router-standard', 'bash-diag.json'),
        JSON.stringify({ at: new Date().toISOString(), win32: process.platform === 'win32', nodeDir, gitCandidates: cands, nodeOnPath: fore.some((e) => existsSync(join(e, 'node.exe'))) }, null, 2), 'utf8')
    } catch { /* 诊断失败不阻塞 */ }
  } catch { /* PATH 修整失败不阻塞 */ }
  const agents = new Map()
  const firstUserText = new Map()
  const sessionModels = new Map()
  const shimmedSessions = new Set()

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

    // promoted：官方 sections 回流（persona 保持 RL 句）+ 引导带宽控 + 阶段声明 + 常驻段
    const stage = ensureStage()[session.id]?.stage ?? 0
    const toolsSvc = agent?.ctx?.get?.('tools')
    const fullNames = knownToolNames(toolsSvc, agent)
    const sections = filterToolGuidance((assembled.sections || []).map((s) =>
      /persona/i.test(s.name) ? { ...s, text: RL_PERSONA } : s
    ), stage, fullNames)
    sections.push({ name: 'router-stage', order: 1, text: stageText(stage) })
    // 声明与泄压常驻（人设常驻：不经压缩丢失；bootstrap 消息可能被 compaction 剪掉）
    sections.push({ name: 'router-decl', order: 2, text: PROGRESSIVE_DECL })
    sections.push({ name: 'router-pressure', order: 3, text: PRESSURE_GUIDE.replace(/^\n+/, '') })
    if (!shimmedSessions.has(session.id)) {
      try { installMetaShim(agent, { installStage: true, stage }); shimmedSessions.add(session.id) } catch { /* ignore */ }
    }
    const available = new Set(assembled.tools.map((tool) => tool.name))
    if (available.has('run_code')) {
      const staged = buildStagedSdk(sections, stage)
      if (staged) {
        return { ...assembled, sections: sections.map((s) => (s.name === 'tools:sdk' ? staged : s)), contexts: [] }
      }
    }
    return { ...assembled, sections, contexts: [] }
  })

  // ── 自主路由（pre-step）：调用下一档工具 → 自动推进阶段 ──────────────────
  ctx.on('agent/pre-step', async ({ agent, messages }, next) => {
    const decision = await next()
    if (agent === undefined || agent.session === undefined) return decision
    const userMsg = (messages || []).find((m) => m.role === 'user' && m.source?.kind === 'user')
    const text = userMsg ? extractText(userMsg) : ''
    const sid = agent.session.id
    const st = (ensureStage()[sid] ??= { stage: 0, guided: false })
    const stageAt = st.stageAtTime ?? 0
    const toolCalls = (agent.session.events || []).filter((e) => (e.time === undefined || e.time >= stageAt) && (e.type === 'tool/call' || e.type === 'tool/code-dispatch')).map((e) => ({ name: e.data?.name || e.data?.toolName || '', args: toolArgs(e.data) }))
    const nextStage = autoAdvance(st.stage, toolCalls, text)
    if (nextStage > st.stage) {
      st.stage = nextStage
      st.stageAtTime = Date.now()
      saveStageState()
      applyStageRestrict(agent, nextStage)
      try { installMetaShim(agent, { installStage: true }) } catch { /* ignore */ }
      // 阶段变化由 system prompt stageText 与 dev_router_status 呈现（不插用户消息打断）
    }
    return decision
  })

  // ── 工具注册 ─────────────────────────────────────────────────────────────
  const registerTool = (tool) => {
    ctx.effect(() => ctx.tools.register({
      ...tool,
      parameters: toJsonSchema(tool.parameters),
    }))
  }

  function toolIndex() {
    const session = currentSession()
    const stage = session === undefined ? 0 : (ensureStage()[session.id]?.stage ?? 0)
    const scope = currentAgent()
    return registryFullIndex(ctx.tools, scope).map((t) => ({
      name: t.name, desc: t.description, mark: runtimeMark(ctx.tools, scope, t.name), parameters: t.parameters,
    })).filter((t) => t.name)
  }

  registerTool({
    name: 'phase_begin',
    description: '确认开启本次会话：开始渐进式工具解锁（注入机制声明 + 解锁阶段 0 工具 + 切换 Code Mode）。调用即开始。Code Mode 契约：run_code 程序必须以 lossless JSON 结束——async 时 await 每个工具调用（Promise 直接 return 会 invalid-output）；edit 报 invalid-output 失败时先 grep 确认文件——编辑可能实际已生效（假失败），勿盲目重试。',
    parameters: {},
    output: { schema: { type: 'string' }, render: (_a, v) => [{ type: 'text', text: String(v) }] },
    async execute() {
      const session = currentSession()
      if (session === undefined) return 'no agent session'
      const sid = session.id
      const state = ensureStage()
      const existing = state[sid] ?? { stage: 0, guided: false }
      state[sid] = existing
      if (existing.guided === true) {
        return 'session already started: phase ' + existing.stage + ' (' + STAGES[existing.stage].name + '); no duplicate bootstrap'
      }
      existing.guided = true
      saveStageState()
      applyStageRestrict(currentAgent(), 0)
      try { installMetaShim(currentAgent(), { installStage: false, stage: 0 }) } catch { /* ignore */ }
      try {
        const toolsSvc = currentAgent()?.ctx?.get('tools')
        if (toolsSvc && typeof toolsSvc.presentAs === 'function') toolsSvc.presentAs('both') // v1.13 机制根治：native 直调 + run_code 并存——write/edit 直接可调，不再 unknown tool
      } catch { /* already declared */ }
      const guide = START_GUIDE + '\n\n' + PROGRESSIVE_DECL + '\n\n' + PRESSURE_GUIDE + '\n\n' + stageText(0)
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
    description: '闯关推进：声明当前阶段已完成，进入下一阶段（解锁新工具 + 阶段提示）。逐级推进（一次一级，不跳级）；预放工具调用会直达其档，不需要 phase_advance。仅在明确完成本阶段工作时调用。进入验证/交付阶段后：先 delivery_check(file[, url])，PASS 才可宣告完成。',
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
      state[sid].stageAtTime = Date.now()
      saveStageState()
      applyStageRestrict(currentAgent(), next)
      try { installMetaShim(currentAgent(), { installStage: true }) } catch { /* ignore */ }
      // 阶段变化由 system prompt stageText 与 dev_router_status 呈现（不插用户消息打断）
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
      return rows.map((t) => '- ' + t.name + ' [' + t.mark + '] — ' + (t.desc.split(/\n|\. /)[0].slice(0, 90)) + ' (' + paramHint(t.parameters) + ')').join('\n')
    },
  })

  registerTool({
    name: 'tools_help',
    description: '渐进式披露二级：单个工具的完整 schema（参数/必需/描述）。精准调用前先查。',
    parameters: { name: { type: 'string', required: true, description: '工具名（tools_catalog 里查到的）' } },
    output: { schema: { type: 'string' }, render: (_a, v) => [{ type: 'text', text: String(v) }] },
    async execute(args) {
      const name = String(args.name || '').trim()
      const found = toolIndex().find((x) => x.name === name)
      if (!found) return '未知工具: ' + name + '（先用 tools_catalog 查）'
      const params = found.parameters && typeof found.parameters === 'object' && !Array.isArray(found.parameters) ? found.parameters : {}
      const props = params.properties || {}
      const required = params.required || []
      const lines = ['工具: ' + name + ' [' + found.mark + ']', '描述: ' + found.desc]
      for (const [k, v] of Object.entries(props)) {
        const meta = v || {}
        lines.push('  ' + k + ': ' + (meta.type || 'any') + (required.includes(k) ? '（必需）' : '') + ' — ' + (meta.description || ''))
      }
      return lines.join('\n')
    },
  })

  registerTool({
    name: 'dev_router_status',
    description: 'Show the current routing state (phase, band, persona, unlocked tools, override). No arguments — call as tools["dev_router_status"]({}).',
    parameters: {},
    output: { schema: { type: 'string' }, render: (_a, v) => [{ type: 'text', text: String(v) }] },
    async execute() {
      const session = currentSession()
      if (session === undefined) return 'no agent session'
      const sid = session.id
      const agent = currentAgent()
      const stage = ensureStage()[sid]?.stage ?? 0
      const sum = stageSummary(stage)
      const mode = overrideMap().get(sid) ?? sessionMode(session)
      return [
        'router=standard (progressive, v1.7.0)',
        'phase=' + sum.name + ' (' + sum.stage + '/3)',
        'callable=[' + runtimeCallable(agent?.ctx?.get?.('tools'), agent).join(', ') + ']', // v1.11 运行时事实（与 SDK 绑定同源）
        'presentation=' + readPresentation(agent),
        'mode=' + fmtMode(mode) + ' (band=' + bandFor(mode) + ')',
        'persona=' + RL_PERSONA,
        'override=' + (overrideMap().has(sid) ? String(overrideMap().get(sid)) : 'auto'),
        'preset=' + (ctx.get('agentPresets')?.composedPreset?.(agent?.ctx) ?? 'unknown'),
        'goalTools=get_goal/create_goal/update_goal',
        ...(stage >= STAGES.length - 1 ? ['fullCatalog=restrict released (all tools open)'] : []),
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
      if (parsed === 'auto') { overrideMap().delete(session.id); return 'auto: override cleared' }
      overrideMap().set(session.id, parsed)
      return 'mode set to ' + parsed + ' (band=' + bandFor(parsed) + ')'
    },
  })

  registerTool({
    name: 'dev_page_check',
    description: '页面/JS 验证三合一：① url 模式 = headless Chrome 截图 + DOM smoke（console/pageerror 提取；title/selector/scale；WebGL 页已开软件渲染 --enable-unsafe-swiftshader——3D 页不再假超时；失败自动重试一次（双倍虚拟时间+全新 profile）——结果可复现）；② js 模式 = 本地 vm 执行任意 JS（语法 + 纯逻辑单测）。url 支持 http(s)://、file://、裸路径（中文自动编码）。产物 .dsh-shots/page-*.png。',
    parameters: {
      url: { type: 'string', description: '页面地址（js 模式时省略）' },
      js: { type: 'string', description: 'JS 源码：语法检查 + 纯逻辑执行（不启动浏览器）' },
      timeoutMs: { type: 'number', description: '硬超时毫秒（默认 20000，上限 180000）' },
      width: { type: 'number', description: '视口宽（默认 1280）' },
      height: { type: 'number', description: '视口高（默认 800）' },
      scale: { type: 'number', description: '截图放大倍数 1-4（默认 1；细节核对用 2-3）' },
      virtualTimeMs: { type: 'number', description: '虚拟时间预算（默认 8000；动画页可加大）' },
      domChars: { type: 'number', description: 'DOM 片段截取字符数（默认 8000，剥离 style/script 后；上限 30000）' },
      selector: { type: 'string', description: '#id / .class / tagname：提取该元素文本（用于绕过截断读取数值）' },
      retry: { type: 'boolean', description: '首次失败（超时/空 DOM）时重试一次（双倍虚拟时间+1.5×超时）。默认 false——避免 3D 页软渲染双重满载 CPU' },
    },
    output: { schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        ok: { type: 'boolean' },
        exitCode: { type: 'number' },
        timedOut: { type: 'boolean' },
        settleError: { type: 'string' },
        shot: { type: 'string' },
        domText: { type: 'string' },
        stderrTail: { type: 'string' },
        title: { type: 'string' },
        consoleTail: { type: 'string' },
        selectorText: { type: 'string' },
        jsOutput: { type: 'string' },
        jsError: { type: 'string' },
      },
      required: ['ok', 'exitCode', 'timedOut', 'settleError', 'shot', 'domText', 'stderrTail', 'title', 'consoleTail', 'selectorText', 'jsOutput', 'jsError'],
    }, render: pageCheckRender },
    async execute(args) {
      return await pageCheckRun(ctx, args)
    },
  })

  registerTool({
    name: 'delivery_check',
    description: '交付 gate（阶段出口契约）：校验交付物文件存在/非空/UTF-8 编码，可选 headless smoke（传 url：加载/标题/console）；输出 PASS/FAIL + 证据清单。⚠️ 全部 PASS 才允许向用户宣告完成交付——任一 FAIL 必须修复后重跑，不允许绕过。',
    parameters: {
      file: { type: 'string', required: true, description: '交付物文件路径（绝对路径或工作区相对路径）' },
      url: { type: 'string', description: '可选：交付物为页面时的地址（http(s):// / file:// / 裸路径，自动编码）' },
      timeoutMs: { type: 'number', description: 'smoke 硬超时毫秒（默认 20000）' },
      virtualTimeMs: { type: 'number', description: 'smoke 虚拟时间预算（默认 8000）' },
      retry: { type: 'boolean', description: 'smoke 失败时重试一次（默认 false）' },
    },
    output: { schema: { type: 'object', additionalProperties: false, properties: {
      ok: { type: 'boolean' },
      checks: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { name: { type: 'string' }, pass: { type: 'boolean' }, detail: { type: 'string' } }, required: ['name', 'pass', 'detail'] } },
    }, required: ['ok', 'checks'] }, render: deliveryCheckRender },
    async execute(args) {
      return await deliveryCheck(ctx, args)
    },
  })


  /** forwarding shim：注册到 target 的**自身 scope**（own layer 不受旧 restrict 相交过滤），
   *  让当前热重载会话立即通过 run_code 看到 meta 工具。 */
  function installMetaShim(agent, opts) {
    const installStage = opts?.installStage !== false
    const curStage = opts?.stage ?? (agent?.session?.id ? ensureStage()[agent.session.id]?.stage ?? 0 : 0)
    const toolsSvc = agent?.ctx?.get?.('tools')
    if (!toolsSvc || typeof toolsSvc.register !== 'function' || typeof toolsSvc.schemas !== 'function') return 0
    const sid = agent.session?.id || ''
    const make = (def) => {
      try {
        try { toolsSvc?.layers?.scoped?.get?.(agent)?.tools?.data?.delete?.(def.name) } catch { /* own-layer 可能在别处 */ }
        toolsSvc.register({
          name: def.name,
          description: def.description,
          parameters: toJsonSchema(def.parameters),
          // v1.6 修复（三轮实弹 P0）：shim 此前把所有 meta 工具的输出硬编码为 string——
          // dev_page_check 返回对象 → "invalid output: value must be a string"，工具整体不可用。
          // 有 def.output 的（对象 schema + 专属 render）透传；无的保持字符串兼容。
          output: def.output ? { schema: def.output.schema, render: def.output.render } : { schema: { type: 'string' }, render: (_a, v) => [{ type: 'text', text: String(v) }] },
          execute: def.execute,
        })
        return 1
      } catch { return 0 }
    }
    // 全量索引（共享实现）：二级披露按需查，不随 restrict 阶段过滤（计划书：catalog 列全部工具）。
    const allSchemas = () => registryFullIndex(toolsSvc, agent)
    const stageOf = () => ensureStage()[sid]?.stage ?? 0
    let n = 0

    n += make({
      name: 'tools_catalog',
      description: '渐进式披露一级：全部工具（名称 + 一行摘要 + 阶段标记）。query 关键词过滤（own-layer shim）。',
      parameters: { query: { type: 'string' }, domain: { type: 'string' } },
      execute: async (args) => {
        const q = String(args?.query || '').toLowerCase()
        const d = String(args?.domain || '').toLowerCase()
        const dom = (n, desc) => {
          const t = n + ' ' + desc
          if (/(read|write|edit|glob|grep|str_replace_editor|fs|file|path)/i.test(t)) return 'file'
          if (/(bash|pwsh|shell|run_code|exec|command|spawn)/i.test(t)) return 'exec'
          if (/(web|search|fetch|http|network|browse)/i.test(t)) return 'network'
          if (/(subagent|agent|delegate|workflow|ralph|fork)/i.test(t)) return 'delegate'
          if (/(engram|memory|recall|store|search)/i.test(t)) return 'memory'
          return 'other'
        }
        const rows = allSchemas().map((s) => ({
          name: s.name || s.function?.name,
          desc: (s.description || s.function?.description || ''),
          mark: runtimeMark(toolsSvc, agent, s.name || s.function?.name || ''),
          parameters: s.parameters || s.function?.parameters || {},
        })).filter((t) => t.name).sort((a, b) => a.name.localeCompare(b.name))
        return rows.filter((t) => (!q || (t.name + ' ' + t.desc).toLowerCase().includes(q)) && (!d || dom(t.name, t.desc) === d)).map((t) => '- ' + t.name + ' [' + t.mark + '] — ' + t.desc.split(/\n|\. /)[0].slice(0, 90) + ' (' + paramHint(t.parameters) + ')').join('\n') || '（无匹配工具）'
      },
    })

    n += make({
      name: 'tools_help',
      description: '渐进式披露二级：单个工具的完整 schema（own-layer shim）。',
      parameters: { name: { type: 'string', required: true, description: '工具名' } },
      execute: async (args) => {
        const wanted = String(args?.name || '').trim()
        const s = allSchemas().find((x) => (x.name || x.function?.name) === wanted)
        if (!s) return '未知工具: ' + wanted + '（先用 tools_catalog 查）'
        const params = s.parameters || s.function?.parameters || {}
        const props = params.properties || {}
        const required = params.required || []
        const lines = ['工具: ' + wanted + ' [' + runtimeMark(toolsSvc, agent, wanted) + ']', '描述: ' + (s.description || s.function?.description || '')]
        for (const [k, v] of Object.entries(props)) lines.push('  ' + k + ': ' + (v.type || 'any') + (required.includes(k) ? '（必需）' : '') + ' — ' + (v.description || ''))
        return lines.join('\n')
      },
    })

    n += make({
      name: 'dev_router_status',
      description: 'Show the current routing state (phase, next tier, persona, unlocked tools, preset). No arguments — call as tools["dev_router_status"]({}). (own-layer shim)',
      parameters: {},
      execute: async () => {
        const sum = stageSummary(stageOf())
        const mode = overrideMap().get(sid) ?? sessionMode(agent?.session)
        const cur = stageOf()
        return 'router=standard (own-layer shim, v1.11.0)\nphase=' + sum.name + ' (' + sum.stage + '/3)\ncallable(runtime)=' + runtimeCallable(agent.ctx?.get?.('tools'), agent).join(', ') + '\npresentation=' + readPresentation(agent) + '\nmode=' + fmtMode(mode) + ' (band=' + bandFor(mode) + ')\npersona=' + RL_PERSONA + '\noverride=' + (overrideMap().has(sid) ? String(overrideMap().get(sid)) : 'auto') + '\npreset=' + (ctx.get('agentPresets')?.composedPreset?.(agent.ctx) ?? 'unknown') + '\ngoalTools=get_goal/create_goal/update_goal' + (cur >= STAGES.length - 1 ? '\nfullCatalog=restrict released (all tools open)' : '')
      },
    })

    n += make({
      name: 'dev_router_mode',
      description: 'Temporarily override the reasoning mode (spec/weak/mixed/react, 0-100, 0.0-1.0, or auto to clear). (own-layer shim)',
      parameters: { mode: { type: 'string', required: true } },
      execute: async (args) => {
        const parsed = parseMode(String(args?.mode || '').trim())
        if (parsed === null) return 'invalid mode "' + args.mode + '"'
        const map = overrideMap()
        if (parsed === 'auto') { map.delete(sid); return 'auto: override cleared' }
        map.set(sid, parsed)
        return 'mode set to ' + parsed + ' (band=' + bandFor(parsed) + ')'
      },
    })

    n += make({
      name: 'phase_advance',
      description: '闯关推进：逐级前进一次（own-layer shim；预放工具调用直达其档，无需手动推进）。进入交付阶段后先 delivery_check。',
      parameters: { reason: { type: 'string', description: '推进理由（可选）' } },
      execute: async () => {
        const st = (ensureStage()[sid] ??= { stage: 0, guided: false })
        if (st.stage >= STAGES.length - 1) return 'already at the last stage (' + STAGES[st.stage].name + '); full catalog is open'
        st.stage += 1
        st.stageAtTime = Date.now()
        saveStageState()
        applyStageRestrict(agent, st.stage)
        try { installMetaShim(agent, { installStage: true }) } catch { /* ignore */ }
        return 'advanced to phase ' + st.stage + ': ' + STAGES[st.stage].name + ' (tools: ' + STAGES.slice(0, st.stage + 1).flatMap((s) => s.tools).join(', ') + ')'
      },
    })

    n += make({
      name: 'dev_page_check',
      description: '页面/JS 验证（own-layer shim）：url 模式 = 截图 + DOM smoke + console/pageerror + title + selector + scale（WebGL 软件渲染已开，失败自动重试一次）；js 模式 = 本地 vm 语法检查/纯逻辑执行。',
      parameters: {
        url: { type: 'string', description: 'http(s):// / file:// / 裸路径（自动编码）' },
        js: { type: 'string', description: 'JS 源码（js 模式，不启动浏览器）' },
        timeoutMs: { type: 'number' }, width: { type: 'number' }, height: { type: 'number' },
        scale: { type: 'number' }, virtualTimeMs: { type: 'number' }, domChars: { type: 'number' },
        selector: { type: 'string', description: '#id / .class / tagname 提取文本' },
        retry: { type: 'boolean', description: '失败重试一次（默认 false）' },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            ok: { type: 'boolean' }, exitCode: { type: 'number' }, timedOut: { type: 'boolean' },
            settleError: { type: 'string' }, shot: { type: 'string' }, domText: { type: 'string' }, stderrTail: { type: 'string' },
            title: { type: 'string' }, consoleTail: { type: 'string' }, selectorText: { type: 'string' },
            jsOutput: { type: 'string' }, jsError: { type: 'string' },
          },
          required: ['ok', 'exitCode', 'timedOut', 'settleError', 'shot', 'domText', 'stderrTail', 'title', 'consoleTail', 'selectorText', 'jsOutput', 'jsError'],
        },
        render: pageCheckRender,
      },
      execute: async (args) => await pageCheckRun(ctx, args),
    })

    n += make({
      name: 'delivery_check',
      description: '交付 gate（own-layer shim）：文件存在/非空/UTF-8 + 可选 headless smoke；全部 PASS 才可宣告完成。',
      parameters: {
        file: { type: 'string', required: true, description: '交付物文件路径' },
        url: { type: 'string', description: '可选页面地址（自动编码）' },
        timeoutMs: { type: 'number' }, virtualTimeMs: { type: 'number' }, retry: { type: 'boolean' },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            ok: { type: 'boolean' },
            checks: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { name: { type: 'string' }, pass: { type: 'boolean' }, detail: { type: 'string' } }, required: ['name', 'pass', 'detail'] } },
          },
          required: ['ok', 'checks'],
        },
        render: deliveryCheckRender,
      },
      execute: async (args) => await deliveryCheck(ctx, args),
    })

    n += make({
      name: 'dev_reload_preset_live',
      description: '预设热重载（当前会话即时生效；own-layer shim 版）。',
      parameters: { targetSessionId: { type: 'string', description: '目标会话 id（缺省 = 当前会话）' } },
      execute: async (shimArgs) => {
        const ap2 = ctx.get('agentPresets')
        const target2 = shimArgs?.targetSessionId ? (ctx.get('agents')?.get?.(String(shimArgs.targetSessionId)) ?? agent) : agent
        if (!ap2 || !target2) return 'ERROR: agentPresets/target 不可用'
        const targetSid2 = shimArgs?.targetSessionId || target2.session?.id || sid
        const before2 = ap2.composedPreset(target2.ctx) ?? 'unknown'
        if (before2 === 'unknown') return 'ERROR: 未加入预设'
        const ymlFile2 = join(process.env.DSH_HOME || homedir(), '.agent-presets', before2, 'agent.cordis.yml')
        let yml2 = ''
        try { yml2 = readFileSync(ymlFile2, 'utf8') } catch (e) { return 'ERROR: 读取失败 ' + String(e) }
        const refRe2 = /(name: \.\/[A-Za-z0-9._-]+\.mjs)(\?v=\d+)?/g
        const b2 = []
        yml2 = yml2.replace(refRe2, (whole, base, query) => {
          const cur = query ? Number(query.slice(3)) : 0
          b2.push(base.split('/').pop() + '->?v=' + (cur + 1))
          return base + '?v=' + (cur + 1)
        })
        if (!b2.length) return 'ERROR: 无相对 .mjs 引用'
        writeFileSync(ymlFile2, yml2, 'utf8')
        const stage2 = ensureStage()[targetSid2]?.stage ?? 0
        await ap2.recompose(target2.ctx, before2)
        applyStageRestrict(target2, stage2)
        const shimN = installMetaShim(target2)
        return 'OK: shim live reloaded\n- bump: ' + b2.join(', ') + '\n- before=' + before2 + ' after=' + (ap2.composedPreset(target2.ctx) ?? before2) + '\n- shim=' + shimN
      },
    })


    const goalsValue = (goal) => goal === void 0 ? { goal: null } : { goal: { id: goal.id, revision: goal.revision, objective: goal.objective, phase: goal.phase, roundsStarted: goal.roundsStarted, maxGoalRounds: goal.maxGoalRounds, ...goal.blockedReason === void 0 ? {} : { blockedReason: { code: goal.blockedReason.code, message: goal.blockedReason.message } } }, activation: goal.activation }
    const goalExec = (exec) => {
      const theAgent = (exec && exec.agent) || agent
      if (!theAgent) throw new Error('goal tools require a calling agent')
      const agentsSvc = ctx.get('agents')
      if (!agentsSvc || agentsSvc.get(theAgent.id) !== theAgent || theAgent.status !== 'running' || (agentsSvc.currentInitiator && agentsSvc.currentInitiator() !== theAgent)) throw new Error('goal tools require the exact live calling agent inside its active driver')
      const evs = theAgent.session.events || []
      for (let i = evs.length - 1; i >= 0; i--) {
        if (evs[i]?.type === 'turn/end') throw new Error('goal tools require an open model turn')
        if (evs[i]?.type === 'turn/start') return { agent: theAgent, events: evs.slice(i + 1) }
      }
      throw new Error('goal tools require an open model turn')
    }
    const goalCompleteAuthority = (execution) => {
      if (execution.events.some((e) => e.type === 'user/message' && e.data?.source?.kind === 'user')) return { kind: 'direct-human' }
      const goalsSvc = ctx.get('goals')
      const goal = goalsSvc?.get?.(execution.agent)
      if (goal !== void 0 && execution.events.some((e) => e.type === 'user/message' && e.data?.source?.kind === 'goal' && e.data.source.goalId === goal.id && e.data.source.revision === goal.revision && e.data.source.round === goal.roundsStarted)) return { kind: 'goal-round', goal }
      throw new Error('complete and blocked require a direct human turn or the current goal round')
    }
    n += make({
      name: 'get_goal',
      description: 'Read the current same-session goal, including its exact id/revision, objective, phase, rounds, and activation. (own-layer shim)',
      parameters: {},
      execute: async (_args, exec) => JSON.stringify(goalsValue(ctx.get('goals')?.get?.(goalExec(exec).agent))),
    })
    n += make({
      name: 'create_goal',
      description: 'Create one persisted same-session completion goal for a long-running objective. (own-layer shim)',
      parameters: { objective: { type: 'string', required: true }, max_goal_rounds: { type: 'number' } },
      execute: async (args, exec) => {
        const execution = goalExec(exec)
        if (!execution.events.some((e) => e.type === 'user/message' && e.data?.source?.kind === 'user')) throw new Error('create requires a direct human turn')
        const goal = ctx.get('goals').create(execution.agent, { objective: String(args.objective), ...args.max_goal_rounds === void 0 ? {} : { maxGoalRounds: args.max_goal_rounds } })
        return JSON.stringify(goalsValue(goal))
      },
    })
    n += make({
      name: 'update_goal',
      description: 'Update the exact current goal revision. complete/blocked allowed in the current goal round. (own-layer shim)',
      parameters: { goal_id: { type: 'string', required: true }, revision: { type: 'number', required: true }, action: { type: 'string', required: true }, objective: { type: 'string' }, max_goal_rounds: { type: 'number' }, blocked_reason: { type: 'string' } },
      execute: async (args, exec) => {
        const execution = goalExec(exec)
        const goalsSvc = ctx.get('goals')
        const ref = { id: args.goal_id, revision: args.revision }
        if (args.action === 'complete' || args.action === 'blocked') {
          const authority = goalCompleteAuthority(execution)
          if (args.action === 'blocked' && authority.kind === 'goal-round' && authority.goal.roundsStarted < 3) throw new Error('blocked requires at least 3 consecutive goal rounds')
          const goal = args.action === 'complete' ? goalsSvc.complete(execution.agent, ref) : goalsSvc.block(execution.agent, ref, { code: 'model-reported', message: String(args.blocked_reason || '') })
          if (authority.kind === 'goal-round' && exec && typeof exec.deferContext === 'function') {
            exec.deferContext({ role: 'user', source: { kind: 'plugin', plugin: 'tool-goal', form: 'notice' }, content: [{ type: 'text', text: args.action === 'complete' ? '<goal_complete>' : '<goal_blocked>' }] })
          }
          return JSON.stringify(goalsValue(goal))
        }
        throw new Error('shim update_goal supports complete/blocked only here: edit/pause/resume require direct human + full adapter')
      },
    })

    n += make({
      name: 'dev_reset_experience',
      description: '回到初档（阶段 0）并清空阶段工具（meta/goal 保留），用于在本会话内从头体验渐进披露；用 todo_write 可触发自动推进。',
      parameters: {},
      execute: async () => {
        const st = (ensureStage()[sid] ??= { stage: 0, guided: false })
        st.stage = 0
        st.stageAtTime = Date.now()
        saveStageState()
        applyStageRestrict(agent, 0)
        const ownT = toolsSvc?.layers?.scoped?.get?.(agent)?.tools
        for (const nm of STAGE_HOST) { try { ownT?.data?.delete?.(nm) } catch { /* ignore */ } }
        installMetaShim(agent, { installStage: false, stage: 0 })
        return 'reset to phase 0: ' + STAGES[0].name + '（stage tools cleared; meta/goal retained）——现在用 todo_write 触发自动推进'
      },
    })

        // 从 scope 链收集真实 stage 工具（mount layer 的 write/edit/pwsh 等），按当前阶段解锁到 target 自身 scope
    const STAGE_HOST = ['write', 'edit', 'str_replace_editor', 'engram_store', 'engram_link', 'pwsh', 'bash', 'read_image', 'job_list', 'job_output', 'job_kill']
    const STAGE_2_TOOLS = ['write', 'edit', 'str_replace_editor', 'engram_store', 'engram_link']
    const STAGE_3_TOOLS = ['pwsh', 'bash', 'read_image', 'job_list', 'job_output', 'job_kill']
    const wanted = installStage ? [...(curStage >= 2 ? STAGE_2_TOOLS : []), ...(curStage >= 3 ? STAGE_3_TOOLS : [])] : []
    const layerSvc = toolsSvc?.layers
    const chainFn = layerSvc && typeof layerSvc.chainLayers === 'function' ? layerSvc.chainLayers.bind(layerSvc) : void 0
    const scopeCandidates = []
    try { if (agent !== void 0) scopeCandidates.push(agent) } catch { /* ignore */ }
    try { if (agent?.ctx !== void 0) scopeCandidates.push(agent.ctx) } catch { /* ignore */ }
    const seen = new Set()
    for (const name of wanted) {
      if (seen.has(name)) continue
      for (const scope of scopeCandidates) {
        let chain = []
        try { if (typeof chainFn === 'function') chain = chainFn(scope) || [] } catch { continue }
        for (const layer of chain) {
          const lt = layer?.tools
          let def = void 0
          try { def = lt?.get?.(name) } catch { /* ignore */ }
          if (!def && lt && typeof lt.entries === 'function') {
            try { for (const [nn, dd] of lt.entries()) if (nn === name) { def = dd; break } } catch { /* ignore */ }
          }
          if (def) {
            try {
              try { toolsSvc?.layers?.scoped?.get?.(agent)?.tools?.data?.delete?.(name) } catch { /* ignore */ }
              toolsSvc.register(def); n += 1; seen.add(name)
            } catch { /* duplicate/无效 */ }
          }
        }
      }
    }
    return n
  }

  registerTool({
    name: 'dev_reload_preset_live',
    description: '预设热重载（当前会话即时生效）：bump agent.cordis.yml 相对 .mjs 的 ?v=N → AgentPresets.recompose 把本 agent 重链到新 generation。仅在同预设自身向前兼容升级时使用（否则已记录工具调用可能在新代不可见）。',
    parameters: { targetSessionId: { type: 'string', description: '目标会话 id（缺省 = 当前会话）' } },
    output: { schema: { type: 'string' }, render: (_a, v) => [{ type: 'text', text: String(v) }] },
    async execute(args) {
      const ap = ctx.get('agentPresets')
      const agentsSvc = ctx.get('agents')
      let agent = currentAgent()
      let label = 'current'
      if (args && args.targetSessionId) {
        const found = agentsSvc?.get(String(args.targetSessionId))
        agent = found ?? null
        label = String(args.targetSessionId)
      }
      if (!ap || !agent) return 'ERROR: agentPresets/agent 不可用 (target=' + label + ')'
      const before = ap.composedPreset(agent.ctx) ?? 'unknown'
      if (before === 'unknown') return 'ERROR: 当前 agent 未加入预设'
      const home = process.env.DSH_HOME || homedir()
      const presetDir = join(home, '.agent-presets', before)
      const ymlFile = join(presetDir, 'agent.cordis.yml')
      let yml = ''
      try { yml = readFileSync(ymlFile, 'utf8') } catch (e) { return 'ERROR: 读取失败 ' + ymlFile + ' ' + String(e) }
      const refRe = /(name: \.\/[A-Za-z0-9._-]+\.mjs)(\?v=\d+)?/g
      let bumped = []
      let matched = false
      yml = yml.replace(refRe, (whole, base, query) => {
        matched = true
        const cur = query ? Number(query.slice(3)) : 0
        bumped.push(base.split('/').pop() + ' -> ?v=' + (cur + 1))
        return base + '?v=' + (cur + 1)
      })
      if (!matched) return 'ERROR: 无相对 .mjs 引用'
      writeFileSync(ymlFile, yml, 'utf8')
      const targetSid = (args && args.targetSessionId) || currentSession()?.id || agent.session?.id || ''
      const stage = ensureStage()[targetSid]?.stage ?? 0
      const preset = await ap.recompose(agent.ctx, before)
      applyStageRestrict(agent, stage)
      const after = ap.composedPreset(agent.ctx) ?? preset?.id ?? 'unknown'
      const shimN = installMetaShim(agent)
      return 'OK: live reloaded\n- bump: ' + bumped.join(', ') + '\n- before: ' + before + '\n- after: ' + after + '\n- shim: ' + shimN + '\n本工具调用仍跑在旧代；下一轮请求即挂载新一代。'
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

/** 实体呈现模式（v1.7：状态自检显示 presentation=code|native——描述不再断言，让模型对账实际）。 */
export function readPresentation(agent) {
  try {
    const ts = agent?.ctx?.get?.('tools')
    if (ts && typeof ts.modeFor === 'function') return String(ts.modeFor(agent))
    return 'unknown'
  } catch { return 'unknown' }
}

function fmtMode(mode) {
  if (mode === 'weak') return 'weak'
  return bandFor(mode)
}
