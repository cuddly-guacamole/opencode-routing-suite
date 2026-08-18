# Porting details — opencode-routing-suite vs dsh-router-standard

> **基线锚点**：本项目的移植基线是上游
> [yjh051108/dsh-routing-suite](https://github.com/yjh051108/dsh-routing-suite)
> **`9727510`**（2026-08-18，`dsh-router-standard` 的 preset 子模块）。
> 本文件记录移植时的平台差异；**不随上游每一个 commit 同步**——上游方向
> 多变（存在 revert 历史），有新 tag/release 时以"基线二次确认闸门"流程再核对。

上游在此提交保留两个 preset：

- **router-standard**（基线路由）：分类 → `personaFor(mode, modelId)` → 首轮核心工具面 → 首个 tool/call 后恢复全目录 → 近场引导（弱带）。
- **router-spec**（在 standard 上增加）：`firstUserText` 竞态修复 + `legacyCore`（weak band 工具面分支）。

---

## 1. 平台适配

| 方面 | 上游（DSH） | 本项目（opencode） |
|---|---|---|
| 插件运行时 | Cordis（`apply(ctx)`、`ctx.on`、`ctx.effect`） | opencode V1 hooks（`chat.message`、`system.transform`、`messages.transform`） |
| Agent 定义 | `agent.cordis.yml`（Cordis service） | Markdown 文件（`agents/*.md`，YAML frontmatter + prompt body） |
| 工具注册 | `ctx.tools.register()`（Cordis） | `tool({})`（opencode plugin API） |
| LLM 调用 | `ctx.llm.stream()` | `opencode run` CLI 子进程（`dev_mode_subagent`） |
| 会话访问 | `agent.session`、`session.events`、`agent.inbox` | `client.session.messages()` API |
| 权限系统 | Cordis service grants | opencode `permission:` frontmatter（`allow`/`ask`/`deny`） |

## 2. 工具面对照

| 上游工具 | opencode 对应 | Permission key |
|---|---|---|
| `bash` / `pwsh` | `bash` | `bash` |
| `str_replace_editor` | `edit` + `write` + `apply_patch` | `edit`（三者统一控制） |
| `read` | `read` | `read` |
| `glob` | `glob` | `glob` |
| `grep` | `grep` | `grep` |
| `dev_router_status` | `dev_router_status`（自定义工具） | 自定义 |
| `dev_router_mode` | `dev_router_mode`（自定义工具） | 自定义 |

注意：opencode 的 `edit` 权限同时控制 `write`、`edit`、`apply_patch`——
不能单独 deny `write` 而 allow `edit`。

## 3. 结构差异

| 方面 | 上游 | 本项目 |
|---|---|---|
| 文件数 | 每个 preset ~10 个文件（v1-v8 bootstrap 变体、router-core、agent.cordis.yml） | 1 个插件文件 + 2 个 agent 文件 |
| Bootstrap 版本 | 多个（v1、v5、v6、v7、v8）用于实验 | 单一统一插件 |
| `routerMode` 配置 | spec preset 使用 `router-bootstrap-v1.mjs` + `routerMode: spec` | 不需要（用独立 agent 文件） |
| `legacyCore`（weak band 工具面分支） | spec preset 中存在 | 未移植（opencode 用静态 agent permissions） |
| 近场引导 | `inbox.append()`（Cordis inbox） | `messages.transform` user 角色尾插 |
| 会话模式持久化 | `sessionMode()` 读 `session.events` | `states Map<sessionID>` + `firstUserText` 防御性捕获 |
| 版本金丝雀 | 无 | 检测 opencode 版本，失配则禁用 |
| 熔断器 | 无 | 连续 3 次异常 → 自我禁用 |

## 4. 未移植（DSH 专用）

| 组件 | 原因 |
|---|---|
| `dsh-super-injector` | DSH Cordis 运行时注入管理器；与 opencode 插件模型不兼容 |
| `dsh-mode-boost` | 已从上游移除；分类器功能已内置到 router-core.mjs |
| `dsh-routing-suite` preset 子模块 | DSH preset 打包方式；opencode 用 agent 文件 + 插件分开管理 |

## 5. 上游其余子模块

| 子模块 | 状态 |
|---|---|
| `dsh-super-injector` | 不移植（DSH 专用，见上） |
| `dsh-mode-boost` | 已从上游移除；分类器功能已并入 router-core.mjs |

---

*本文件为决策记录（ADR 性质），只记录"移植时的平台差异"，不追踪上游每次提交。*
