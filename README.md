# opencode-routing-suite

[中文说明](./README.zh-CN.md)

Task-aware reasoning-mode routing for [opencode](https://opencode.ai): two
primary agents — **spec** (plan-first) for maintenance/fix tasks and
**standard** (RL narrow surface) for RL-interface-restored sessions — plus a
thin plugin that injects a three-band persona (**react** / **spec** / **weak**)
on the first message, depending on task classification. The reasoning mode is
anchored **before the first model reply** via persona + first-turn tool schema,
then full capability is restored from the second message on.

This is a community project. It is not an official opencode plugin and is not
affiliated with or endorsed by Anomaly or DeepSeek.

## Why

Model behavior along the react↔spec axis collapses into three stable regions,
not a continuum (measured on DeepSeek V4 Pro, 21-point probe, n=2): spec
`[0, 0.15]`, an unstable transition band `[0.2, 0.45]` to avoid, and react
`[0.5, 1.0]`. "Continuous" mode tuning is an illusion at the model layer —
quantizing to three bands is the honest interface.

Routing the **first message** matters because the trajectory of a session is
set early: the first-turn system prompt and tool schema anchor how the model
approaches the task. A fix task benefits from a read-first planner; a build
task from a hands-on doer; an RL-trained session benefits from the restored
training interface. After the anchor, the session returns to the full tool set
so nothing is permanently given up.

## How it works

### Static primary agents

| Agent | Persona | Tool surface | Use for |
|---|---|---|---|
| `spec` | spec sentence (idempotent fallback; plugin persona wins) | read allowed; edit/write/glob ask; bash inherits global (read-only allowed, writes ask) | architecture, reviews, complex planning |
| `standard` | RL sentence + trimmed safety rules (injected by plugin as full system replacement) | read/bash/edit/write only, everything else explicitly denied (incl. glob, `dev_router_status`/`dev_router_mode`) | RL-interface-restored narrow sessions |

### First-message persona injection

On the first message of a session (no manual agent choice), the plugin either
classifies the task or applies a manual lock, then anchors `spec` (or
`standard` for RL locks) and injects:

| Band | Trigger | Injection |
|---|---|---|
| `react` | react keywords win (build/fix tasks: "write", "implement"…) | full system kept + react persona appended |
| `spec` | spec keywords win (planning/review tasks: "refactor", "design"…) | spec persona appended (idempotent — skipped if `spec.md` already provides it) |
| `weak` | tie / no keywords | full system kept + weak persona appended |
| `none` | chat / greeting / empty message (`CHAT_RE`) | **not routed** — greeting lets the session be, no injection |
| `standard` | manual lock (`dev_router_mode standard`) | **system fully replaced** with the RL sentence + trimmed safety rules |

The plugin (`plugins/routing-suite.ts`) is deliberately thin:

- **`dev_router_status`** — shows plugin state, version canary, auto-routing,
  per-session band/persona/pending, mode lock, circuit breaker. Read-only.
- **`dev_router_mode <spec|react|weak|standard|auto>`** — manually lock/unlock
  the current session. `spec`/`react`/`weak` = persona append; `standard` =
  RL system replacement. A manual lock persists until you Tab away to another
  agent or set it back to `auto`.
- **Automatic routing** (opt-in, `OPENCODE_ROUTER_AUTO=1`) — on the **first
  message** of a session, a keyword-counting classifier (ported from
  mode-boost) picks the band: react keywords win → `react`, spec keywords win
  → `spec`, tie/no match → `weak`. The session is anchored to `spec` with the
  matching persona injected. Chat/greeting first messages are **left alone**
  (band `none`, no routing). From the second message on, the session runs with
  the restore agent (default `build`), i.e. full capability.
- If the user has manually picked an agent (anything other than `build`),
  the router does not intervene — manual choice always wins.

## Install

1. Copy the agent files (the `.disabled` files in this repo are legacy, do not
   copy them):

   ```sh
   cp agents/spec.md agents/standard.md ~/.config/opencode/agents/
   ```

2. Copy the plugin:

   ```sh
   cp plugins/routing-suite.ts ~/.config/opencode/plugins/
   ```

3. Restart opencode, then press **Tab** to cycle the primary agents —
   `spec` and `standard` should appear.

4. Optional: register the debug tools in `opencode.jsonc` (both default to
   "ask" otherwise):

   ```jsonc
   "permission": {
     "dev_router_status": "allow",
     "dev_router_mode": "ask"
   }
   ```

No `minimal` / anchored-standard setup is needed anymore — the `standard`
agent plus the plugin's RL system replacement covers that path.

## Usage

- **Manual**: Tab to `spec`/`standard` and work as usual.
- **Per-session lock**: tell the agent `dev_router_mode standard` (or call the
  tool) to force a mode — `spec`/`react`/`weak` append the persona,
  `standard` replaces the system with the RL sentence + safety rules.
- **Automatic**: start opencode with `OPENCODE_ROUTER_AUTO=1`. New sessions
  route their first message automatically. Check the startup log line
  `[routing-suite] session ... 首条消息分类=...` (or `分类器低置信`) to see
  the decision; every decision is also logged to the console.

### Environment variables

| Variable | Default | Effect |
|---|---|---|
| `OPENCODE_ROUTER_AUTO` | off | `1` enables first-message auto routing |
| `OPENCODE_ROUTER_ENABLED` | on | `0` fully disables the plugin (no file deletion needed) |
| `OPENCODE_ROUTER_RESTORE_AGENT` | `build` | agent restored after the anchored first message |
| `OPENCODE_ROUTER_ALLOW_VERSION` | — | force-allow a canary version (e.g. after verifying a newer opencode) |
| `OPENCODE_ROUTER_CRASH_TEST` | off | `1` injects a hook exception to verify fail-open + circuit breaker |

Greeting/chat first messages are never routed (band `none`) — the router
yields to normal conversation.

## Compatibility

- Developed and tested against opencode **1.18.18** (V1 plugin API).
- Ported from [yjh051108/dsh-routing-suite](https://github.com/yjh051108/dsh-routing-suite)
  (MIT). This release aligns with upstream **v0.2.0** semantics: the preset
  splits into two routing modes — **standard** (RL interface restoration:
  first request carries only the RL training sentence plus the shell/editor
  surface, think-act loops) and **spec** (deep-think-first, classified persona
  with full sections). This port mirrors that split with the `spec` and
  `standard` primary agents; the react/spec/weak personas remain three-band
  quantizations injected by the plugin.
- **Upstream snapshots**: `scripts/upstream/` keeps byte-exact snapshots of
  the upstream files (`router-core.mjs`, `mode-boost-core.js`,
  `router-bootstrap.mjs` plus this README) as the single read-only source of
  truth for every injected string. To track a newer upstream release: pull the
  submodules, `cp` the files byte-for-byte, re-verify sha256, update the
  snapshot table, commit. See `scripts/upstream/README.md`.
- **Version canary**: on startup the plugin reads the globally installed
  `opencode-ai` package version. Mismatch (or failed detection) → the plugin
  disables itself with a console warning; set `OPENCODE_ROUTER_ALLOW_VERSION`
  to override after manually verifying compatibility.
- **opencode 2.0**: the V1 plugin API is not supported in V2 — the plugin is
  expected to be ported to `Plugin.define` / `session.hook("context")` /
  `tool.transform` when V2 lands. See the design notes in the source header.

## Safety

- Every hook is wrapped in try/catch: on fault the plugin logs and leaves the
  message untouched (**fail-open** — the pipeline keeps working).
- After 3 consecutive faults the plugin disables itself and clears all state
  (recover: restart, fix, or delete the file).
- State is a per-session `Map` — sessions never share mode locks.
- The plugin makes **no network requests** and adds **no telemetry**.

## Verify

Run the type check:

```sh
npm install && npm run check
```

Manual checklist (after install + restart):

- [ ] Tab cycles to `spec` / `standard`; `spec` prompts before write/edit,
      `standard` exposes only read/bash/edit/write.
- [ ] `dev_router_status` reports sane values.
- [ ] With `OPENCODE_ROUTER_AUTO=1`: a build task ("write a python script …")
      gets the react persona; a fix task ("refactor this module …") the spec
      persona; an ambiguous task the weak persona; a greeting ("你好") is
      **not** routed (no band/injection log lines).
- [ ] `dev_router_mode standard` locks the session: next message runs with the
      RL system replacement (RL sentence + trimmed safety rules), the message
      after returns to full `build` capability.
- [ ] Second message of an auto-routed session runs under the restore agent
      (full tools back).
- [ ] Crash injection: `OPENCODE_ROUTER_CRASH_TEST=1`, send a message — opencode
      keeps running, the fault is logged, after 3 faults the plugin disables.
- [ ] Delete all files (2 agents + 2 plugin files incl. legacy `.disabled`) →
      behavior identical to a clean install.

## Credits

Ported from [yjh051108/dsh-routing-suite](https://github.com/yjh051108/dsh-routing-suite)
(MIT). Acknowledgments (per upstream):

- [xiaobright/modeltest](https://github.com/xiaobright/modeltest) — Project2 /
  V4.1b evaluation methodology
- [xiaobright/dsh-anchored-standard](https://github.com/xiaobright/dsh-anchored-standard)
  — two-phase anchoring mechanism

## License

MIT. The classifier and personas are derived from the yjh051108/dsh-routing-suite
`router-standard` preset; the original copyright and MIT notice are retained
in [`NOTICE`](./NOTICE).
