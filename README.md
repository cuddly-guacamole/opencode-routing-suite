# opencode-routing-suite v0.3.0

[中文说明](./README.zh-CN.md)

Task-aware reasoning-mode routing for [opencode](https://opencode.ai): a single
primary agent (**spec**, read-first) plus a thin plugin that injects a
three-band persona (**react** / **spec** / **weak**) per-request with
**per-model selection** (Pro → WEAK_PRO, Flash → WEAK_FLASH). Anchored
**before the first model reply** via persona + first-turn tool schema; persona
persists idempotently for the whole session; full capability from the second
message on.

This is a community project. It is not an official opencode plugin and is not
affiliated with or endorsed by Anomaly or DeepSeek.

**v0.3.0 breaking changes**: `standard` agent (RL narrow surface) and system
replacement are **removed** (upstream 9727510 abandoned RL-interface). See
[Compatibility](#compatibility) for migration.

## Why

Model behavior along the react↔spec axis collapses into three stable regions,
not a continuum (measured on DeepSeek V4 Pro, 21-point probe, n=2): spec
`[0, 0.15]`, an unstable transition band `[0.2, 0.45]` to avoid, and react
`[0.5, 1.0]`. "Continuous" mode tuning is an illusion at the model layer —
quantizing to three bands is the honest interface.

The optimal weak persona is **model-specific** (P11, P24): Pro performs best
with WEAK_PRO (spec sentence + classify instruction, no anchors); Flash
performs best with WEAK_FLASH (+ recall/anti-runaway anchors, 100% single-task
completion on P23). The plugin selects automatically based on the session model.

## How it works

### Static primary agent

| Agent | Persona | Tool surface | Use for |
|---|---|---|---|
| `spec` | spec sentence (idempotent fallback; plugin persona wins) | read allowed; edit/write/glob ask; bash inherits global | architecture, reviews, planning, execution — all tasks |

### Per-request persona injection (v0.3.0, idempotent)

On every model request, the plugin checks if the system already contains the
target persona. If not, it appends the matching persona text (idempotent —
never duplicates):

| Band | Trigger | Injection |
|---|---|---|
| `react` | react keywords win (build tasks: "write", "implement"…) | full system kept + react persona appended |
| `spec` | spec keywords win (fix tasks: "refactor", "debug"…) | spec persona appended (idempotent — skipped if `spec.md` already provides it) |
| `weak` | tie / no keywords | full system kept + weak persona appended (**model-dependent**: Pro → WEAK_PRO, Flash → WEAK_FLASH) |
| `none` | chat / greeting / empty message (`CHAT_RE`) | **not routed** — greeting lets the session be, no injection |

### Tools

- **`dev_router_status`** — shows plugin state, version, auto-routing, band,
  agent, mode lock, circuit breaker. Read-only.
- **`dev_router_mode <mode>`** — manually lock/unlock. Accepts band names
  (`spec`/`react`/`weak`/`auto`), numeric 0-100, 0.0-1.0, or `mixed`. Manual
  lock persists until Tab-away or `auto`.

### Automatic routing (opt-in)

Start opencode with `OPENCODE_ROUTER_AUTO=1`. On the **first message** of a
session, a keyword-counting classifier (ported from mode-boost) picks the band.
Chat/greeting messages are **left alone** (band `none`). From the second
message on, the session runs with full `build` capability.

If the user has manually picked an agent (anything other than `build`), the
router does not intervene.

## Install

1. Copy the agent file:

   ```sh
   cp agents/spec.md ~/.config/opencode/agents/
   ```

2. Copy the plugin:

   ```sh
   cp plugins/routing-suite.ts ~/.config/opencode/plugins/
   ```

3. Restart opencode, then press **Tab** to cycle to the `spec` agent.

4. Optional: register the debug tools in `opencode.jsonc`:

   ```jsonc
   "permission": {
     "dev_router_status": "allow",
     "dev_router_mode": "ask"
   }
   ```

## Usage

- **Manual**: Tab to `spec` and work as usual.
- **Per-session lock**: `dev_router_mode weak` (or call the tool) to force a
  mode — persona is injected on every request. Tab to another agent or call
  `dev_router_mode auto` to unlock.
- **Automatic**: `OPENCODE_ROUTER_AUTO=1` at startup.

### Environment variables

| Variable | Default | Effect |
|---|---|---|
| `OPENCODE_ROUTER_AUTO` | off | `1` enables first-message auto routing |
| `OPENCODE_ROUTER_ENABLED` | on | `0` fully disables the plugin |
| `OPENCODE_ROUTER_ALLOW_VERSION` | — | force-allow a canary version |
| `OPENCODE_ROUTER_CRASH_TEST` | off | `1` injects a hook exception to verify fail-open |
| `OPENCODE_ROUTER_WEAK_ANCHOR` | off | `1` restores old WEAK_FLASH with deep-first anchor (P23 fallback) |
| `OPENCODE_ROUTER_GUIDE` | off | `1` enables near-field guidance |

## Compatibility

- Developed against opencode **1.18.18** (V1 plugin API).
- Ported from [yjh051108/dsh-routing-suite](https://github.com/yjh051108/dsh-routing-suite)
  (MIT). **v0.3.0 aligns with upstream dsh-router-standard `9727510`** (2026-08-18):
  single unified behavior chain — classify → `personaFor(mode, modelId)` →
  first-turn core tools → full catalog after first tool call → near-field
  guidance (weak band). Upstream abandoned the `standard` (RL interface
  restoration) direction in this commit. The upstream suite contains two other
  submodules not ported: **dsh-super-injector** (DSH-specific Cordis runtime
  injection manager, incompatible with opencode's plugin model) and
  **dsh-mode-boost** (removed from upstream; its classifier is now built into
  router-core.mjs).
- **opencode 2.0**: V1 plugin API is not supported in V2. Core logic is
  decoupled from V1 hooks (pure functions in the plugin header). V2 migration
  will be a thin adapter rewrite (chat.message → session.hook("context"),
  system.transform → event.system, tool → tool.transform).

### v0.2.0 → v0.3.0 migration

| Change | Impact | Action |
|---|---|---|
| `standard` agent removed | `agents/standard.md` no longer used | Delete from `~/.config/opencode/agents/` |
| RL system replacement removed | `dev_router_mode standard` no longer works | Use `weak` for internal routing mode |
| Persona now injected every request | System prompt has persona on every LLM call | No action (cache-neutral, idempotent) |
| `OPENCODE_ROUTER_RESTORE_AGENT` removed | No longer needed (build restored automatically) | Remove from env if set |

## Safety

- Every hook wrapped in try/catch: **fail-open** (fault logged, message untouched).
- After 3 consecutive faults: self-disables, clears all state.
- Per-session `Map` isolation — sessions never share locks.
- No network requests, no telemetry.

## Verify

```sh
npm install && npm run check
```

Manual checklist:

- [ ] Tab cycles to `spec`; `spec` prompts before write/edit.
- [ ] `dev_router_status` reports sane values (v0.3.0, band, agent).
- [ ] With `OPENCODE_ROUTER_AUTO=1`: "write a python script" → react persona;
      "refactor this module" → spec persona; "你好" → not routed.
- [ ] `dev_router_mode 42` → band react; `0.3` → mixed; `weak` → weak.
- [ ] Crash injection: `OPENCODE_ROUTER_CRASH_TEST=1`, 3 faults → self-disable.
- [ ] `OPENCODE_ROUTER_WEAK_ANCHOR=1` → WEAK_FLASH contains "Think deeply first".
- [ ] Delete files → clean-install behavior.

## Credits

Ported from [yjh051108/dsh-routing-suite](https://github.com/yjh051108/dsh-routing-suite)
(MIT). Acknowledgments:

- [xiaobright/modeltest](https://github.com/xiaobright/modeltest) — Project2 /
  V4.1b evaluation methodology
- [xiaobright/dsh-anchored-standard](https://github.com/xiaobright/dsh-anchored-standard)
  — two-phase anchoring mechanism

## License

MIT. The classifier and personas are derived from the yjh051108/dsh-routing-suite
`router-standard` preset; the original copyright and MIT notice are retained
in [`NOTICE`](./NOTICE).
