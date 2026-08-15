# opencode-routing-suite

[中文说明](./README.zh-CN.md)

Task-aware reasoning-mode routing for [opencode](https://opencode.ai): three
primary agents — **spec** (plan-first) for maintenance/fix tasks, **react**
(doer) for greenfield/build tasks, **weak** (narrow, RL-native) as the
ambiguous-task fallback — plus a thin plugin that picks the agent for you.
The reasoning mode is locked in **before the first model reply** using the
agent's persona and first-turn tool schema, then full capability is restored.

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
task from a hands-on doer. After the anchor, the session returns to the full
tool set so nothing is permanently given up.

## How it works

| Agent | Persona | Tool surface | Use for |
|---|---|---|---|
| `spec` | RL-aligned sentence (from router-standard) | read allowed; edit/write/glob ask; bash read-only allowed | architecture, reviews, complex planning |
| `react` | hands-on doer ("produce, verify, fix", no ceremony) | full tools (inherits global permissions) | implementation, bug fixes, refactoring |
| `weak` | official minimal one-liner | read/bash/edit/write only, everything else denied | correctness-first simple tasks, minimal alignment |

The plugin (`plugins/routing-suite.ts`) is deliberately thin:

- **`dev_router_status`** — shows plugin state, version canary, auto-routing,
  session mode lock, circuit breaker.
- **`dev_router_mode <spec|react|weak|auto>`** — manually lock/unlock the
  mode for the current session. A manual lock persists until you Tab away to
  another agent or set it back to `auto`.
- **Automatic routing** (opt-in, `OPENCODE_ROUTER_AUTO=1`) — on the **first
  message** of a session, a keyword-counting classifier (ported from
  router-standard) picks the agent: react keywords win → `react`, spec
  keywords win → `spec`, tie/no match → `weak` (the model routes itself).
  From the second message on, the session runs with the restore agent
  (default `build`), i.e. full capability.
- If the user has manually picked an agent (anything other than `build`),
  the router does not intervene — manual choice always wins.

Sessions where the user selected `minimal` (anchored-standard) are never
touched: the router only acts on first messages with no manual agent choice.

## Install

1. Copy the agent files:

   ```sh
   cp agents/*.md ~/.config/opencode/agents/
   ```

2. Copy the plugin:

   ```sh
   cp plugins/routing-suite.ts ~/.config/opencode/plugins/
   ```

3. Restart opencode, then press **Tab** to cycle the primary agents —
   `spec`, `react` and `weak` should appear.

4. Optional: register the debug tools in `opencode.jsonc` (both default to
   "ask" otherwise):

   ```jsonc
   "permission": {
     "dev_router_status": "allow",
     "dev_router_mode": "ask"
   }
   ```

## Usage

- **Manual**: Tab to `spec`/`react`/`weak` and work as usual.
- **Per-session lock**: tell the agent `dev_router_mode react` (or call the
  tool) to force a mode — useful for stable A/B comparisons.
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

## Compatibility

- Developed and tested against opencode **1.18.18** (V1 plugin API).
- Ported from [yjh051108/dsh-routing-suite](https://github.com/yjh051108/dsh-routing-suite)
  (MIT). The port is based on the v0.1.x `router-core.mjs`. Upstream v0.2.0
  split the preset into two routing modes — **standard** (RL interface
  restoration: first request carries only the RL training sentence plus the
  shell/editor surface, think-act loops) and **spec** (deep-think-first,
  classified persona with full sections). The classifier, the spec/react
  personas and the three-band quantization are unchanged across versions, so
  this port tracks the spec-mode semantics; the standard (RL-interface) mode
  corresponds to the existing opencode `minimal`/anchored-standard setup.
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

- [ ] Tab cycles to `spec` / `react` / `weak`; `spec` prompts before
      write/edit, `weak` exposes only read/bash/edit/write.
- [ ] `dev_router_status` reports sane values.
- [ ] With `OPENCODE_ROUTER_AUTO=1`: a build task ("write a python script …")
      is answered by `react`; a fix task ("refactor this module …") by `spec`;
      an ambiguous task falls back to `weak` (console shows the low-confidence
      warning).
- [ ] Second message of an auto-routed session runs under the restore agent
      (full tools back).
- [ ] Crash injection: `OPENCODE_ROUTER_CRASH_TEST=1`, send a message — opencode
      keeps running, the fault is logged, after 3 faults the plugin disables.
- [ ] Delete all files → behavior identical to a clean install.

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
