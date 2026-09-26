# Porting details — opencode-routing-suite vs dsh-router-standard

> **基线锚点（v0.5.0 实现，2026-08-26）**：§7 裁决书的 **I1–I8 已落地**（用户就 I1 的行为分岔拍板：
> **接上自动推进**）。落地位置与漂移逐项见 `scripts/upstream/derived-map.md` **§8**。要点：
> - **晋级语义换成上游 v1.19.0 的完成信号表**（阶段 0 见 `question`/`todowrite`、阶段 1 见 `todowrite`、
>   阶段 2 见 `delivery_check`）；旧的"工具名/文本即跳级"（`bash→3`、`task→1`、`write/edit→2`、文本正则）
>   **已删除**。运行时接线落在**已有** hook 上：主路径 `experimental.chat.messages.transform`
>   （唯一能看到 assistant `ToolPart` 的面），`chat.message` 留一次防御性调用；幂等靠按 `callID` 记账。
> - 新增：`Task:` 任务回显（纯函数 `firstUserTask`，160 字截断）、`→ Done?` 完成判据、`Next goal:` 技能卡、
>   `lastAdvance:{at,reason}` 落盘与展示、"引导而非打回"的 `tools_help` 措辞。
> - `delivery_check` 证据类型新增 **`kind='numeric'`**（用上游正则 `/^-?[\d.eE+-]+$/`，
>   **不用上游那个错示例 `minr=2.07`**），并加**非阻塞** numeric hint；`describe_image 只展示、
>   不构成 reviewed 的视觉检查`写进了注入文本与工具描述。
> - 平台口径用词更正：v0.5.x **无*阶段化*门控**（会话进行中无法开合可见工具集）；静态 `permission: deny`
>   的真隐藏在 opencode 存在但只在加载期生效（裁决见 §7.0 术语与 U8）。
> - **注入文本卫生成为可机械校验的不变量**：`test/router-core.test.mjs` 对 5 个注入面逐 token 断言
>   §7.2 剔除清单里的 23 个指名一个都不出现（`derived-map.md` §8 记了为此做的一处一词漂移）。
>
> **基线锚点（T7 增量裁决，2026-08-26）**：快照来源推进至上游组件仓库 dsh-router-standard
> **`b39112d`**（standard v1.27.0，2026-08-26 重快照；区间 00c81b1→b39112d 三提交，仅 b39112d 动代码）。
> 该区间 **`router-core.mjs` 逐字节未变**（sha256 `544c12c6…`）⇒ core 无需重快照；
> `router-bootstrap.mjs` 96690→84429 B，按 `scripts/upstream/README.md` 步骤 2-4 用
> `git show … > /tmp/… && cp` **逐字节**覆盖（`cmp -s` 通过）。
> `v1.18.0→v1.27.0` 的**逐条裁决（16 个 CHANGELOG 小节 + v1.28 代码内容）、剔除清单、
> 版本归属裁决、实现清单、未验证清单**见 `scripts/upstream/derived-map.md` **§7**。
> ⚠️ **两个基线勿混**：**快照来源 = b39112d**（本目录文件的字节出处）；
> **实现面 = v1.18.0→v1.28.0 的可移植子集**（v0.5.0 起落地，见 §8）。
> 要点：v1.19.0 完成信号驱动晋级、v1.19.1 Task 回显/→ Done?/Next goal、v1.22 防局部最优、
> **v1.24 `kind='numeric'` 证据（上游无 `EVIDENCE_KINDS` 常量，硬编码 `ALLOWED`——落点是两处口径）**、
> v1.28 非阻塞 numeric 提示；v1.26/v1.27 为"原则可移植、指名不可移植"（`engram_store`/`workflow`/
> `ralph`/`fork` 剔除，`task` 可留）。
>
> **基线锚点（v0.4.1 更新，2026-08-24）**：对齐冻结点推进至上游组件仓库
> dsh-router-standard **`00c81b1`**（standard v1.17.1）。区间 7d0d1d3→00c81b1
> （v1.14.0→v1.17.1 六提交）的逐项移植/不移植裁决见 `scripts/upstream/derived-map.md` §6；
> 要点：泄压退役 → Proactivity 主动性自检（v1.17.0 用户终审）、单一事实源阶段文本、
> delivery 证据门禁 + external 一等公民、phase_begin 跨代修复（v1.17.1）。
>
> **基线锚点（v0.4.0 更新，2026-08-22）**：上游组件仓库 dsh-router-standard
> **`742b180`**（standard v0.7.4 clean rewrite，game-style timeline）为对齐冻结点。
> v0.4.0 语义转向：**三带分类 persona 换装已废弃**，改为渐进披露游戏化时间线
> （phase_begin 确认 → 四阶段闯关 → tools_catalog/tools_help 二级披露）。
> 平台差异记录如下；**不随上游每个 commit 同步**——上游方向多变（存在 revert
> 历史），有新 tag/release 时以"基线二次确认闸门"流程再核对。
>
> 漂移记录：`scripts/upstream/derived-map.md`（Cordis→opencode 工具映射）。
> 移植口径：文本对齐 + 语义等价（DSH 专属机制不可移植项见 RATIONALE §4）。

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
