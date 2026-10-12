# Porting details — opencode-routing-suite vs dsh-router-standard

> **基线锚点（v0.6.0 实现 — 宿主缝重构 + 双线共存 + 阶段化门控，2026-10-12）**：上游 opencode 已分叉为 **V1**
> （`@opencode-ai/plugin`，npm 最新 1.19.0，命令 `opencode`）与 **V2**（`@opencode/plugin@2.0.26`，
> 命令 `opencode2`），用户拍板**双线共存**。要点（逐项落点见 `derived-map.md` **§9**）：
> - **版本**：`package.json` `0.5.0` → **`0.6.0`**；`PLUGIN_VERSION` → **`v0.6.0`**；各文件头部与
>   `README.md` 同步。⚠️ 门控是**本轮**接上的，故两处曾把功劳记给 v0.5.0 的注释**已更正为 v0.6.0**
>   （依据：`HEAD` 的 `GLOBAL_SAFE` 是 21 项全量版、`HEAD:progressive.ts` 里 `visibleTools|GATE` 零命中）。
> - **一个 `default` 同时满足两宿主**（`export default { id, setup, server }`）。混合形状已在
>   本机真 V2 运行时实测通过（`opencode2 plugin list` 认成 `local`，连跑 3 次）。
>   **V1 下限 ≥ 1.18.29**（对象入口自该版本起受支持）——⚠️ **此条是「仅指南」，不是实测读数**：
>   本机无 1.18.29 tag 可独立验证，最近的 V1 树是 1.18.30。
> - **架构**：业务洗出到宿主中立的 `plugins/lib/engine.ts`，两个适配器
>   `plugins/lib/host/{v1,v2}.ts` + 契约 `host/contract.ts`，`plugins/routing-suite.ts` 为组合根；
>   `plugins/lib/progressive.ts` 降级为 22 行兼容壳（仅再导出）。
> - **阶段化门控（U8 已整体重裁）**：旧写法"v0.5.x **无*阶段化*门控**"**只在 V1 上成立**。
>   正确口径 = **「V1 上无阶段化门控；V2 上有，默认关，且只锁写入面」**：V2 的 `SessionContext.tools`
>   可变（`packages/core/src/session/model-request.ts:264-274` 按名单重建请求里的工具集合），
>   `OPENCODE_ROUTER_GATE=1` opt-in 后阶段 0/1 无 `write`/`edit`/`apply_patch`，阶段 2 起解锁（`bash` 恒可用）。
>   ⚠️ 旧 `unlockedFor` 因 `GLOBAL_SAFE` 含全部 12 个阶段工具而**恒等于全量**（门控曾空转），
>   这正是 U8 需"整体重裁"而非"照抄"的实质证据（裁决与四行重裁见 `derived-map.md` §7.5）。
> - **晋级触发器搬到逐调用工具事件**（V1 `tool.execute.after` / V2 `ctx.tool.hook("execute.after")`）：
>   V2 hook 面的 `Message` 是 `{role, content}`、**没有 `parts` 字段**，旧的消息面写法在 V2 上会
>   **静默失效**（恒空数组、零报错）。
> - **V2 上 `OPENCODE_ROUTER_CLASSIC=1` 失效**（classic 冻结版不进缝）：实现**打日志并回退 progressive**，
>   不静默忽略。**冻结回退仅 V1**。
> - **读数（2026-10-12）**：`npm test` **117 例**（基线 96；三个测试文件 = 核心层 72 + 运行时链路 21 +
>   宿主缝 24）、`npm run check` exit 0；禁用 token 清单实为 **24** 条（此前多处写 23，
>   程序计数确认两个测试文件各 24 且集合相同）。⚠️ 例数是**活读数**，引用须以当场 `npm test` 输出为准。

> **基线锚点（v0.5.0 实现，2026-08-26）**：§7 裁决书的 **I1–I8 已落地**（用户就 I1 的行为分岔拍板：
> **接上自动推进**）。落地位置与漂移逐项见 `scripts/upstream/derived-map.md` **§8**。要点：
> - **晋级语义换成上游 v1.19.0 的完成信号表**（阶段 0 见 `question`/`todowrite`、阶段 1 见 `todowrite`、
>   阶段 2 见 `delivery_check`）；旧的"工具名/文本即跳级"（`bash→3`、`task→1`、`write/edit→2`、文本正则）
>   **已删除**。运行时接线落在**已有** hook 上：主路径 `experimental.chat.messages.transform`
>   （唯一能看到 assistant `ToolPart` 的面），`chat.message` 留一次防御性调用；幂等靠按 `callID` 记账。
>   ⚠️ **该接线已于 2026-10-12 搬到逐调用工具事件**（见上面的新锚点）：V2 的 `Message` 无 `parts`，
>   消息面写法在 V2 上静默失效。
> - 新增：`Task:` 任务回显（纯函数 `firstUserTask`，160 字截断）、`→ Done?` 完成判据、`Next goal:` 技能卡、
>   `lastAdvance:{at,reason}` 落盘与展示、"引导而非打回"的 `tools_help` 措辞。
> - `delivery_check` 证据类型新增 **`kind='numeric'`**（用上游正则 `/^-?[\d.eE+-]+$/`，
>   **不用上游那个错示例 `minr=2.07`**），并加**非阻塞** numeric hint；`describe_image 只展示、
>   不构成 reviewed 的视觉检查`写进了注入文本与工具描述。
> - **注入文本卫生成为可机械校验的不变量**：`test/router-core.test.mjs` 与 `test/host-seam.test.mjs`
>   （后者参数化到 V1 zod 面 + V2 `toJSONSchema` 面）对 §7.2 剔除清单里的 **24** 个指名逐 token
>   断言一个都不出现，并显式锚定条数（`derived-map.md` §8 记了为此做的一处一词漂移）。
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

**宿主双线**：上游 opencode 已分叉——**V1**（`@opencode-ai/plugin`，npm 最新 1.19.0，命令 `opencode`）
与 **V2**（`@opencode/plugin@2.0.26`，命令 `opencode2`）。本插件用**一个 `default`** 同时满足两宿主
（`export default { id, setup, server }`），V2 只认 `default` 且要求 `id`+(`setup`|`effect`)
（`packages/core/src/plugin/module.ts:78-91`），V1 的 `readV1Plugin(mode="detect")` 见 `server` 键
即取 server 分支（`packages/opencode/src/plugin/shared.ts:272-285`）。混合形状**已在本机真 V2 运行时实测**
（`opencode2 plugin list` 认成 `local`，连跑 3 次）。**V1 下限 ≥ 1.18.29**（对象入口自该版本起受支持）
——⚠️ **此条是「仅指南」，不是实测读数**：本机无 1.18.29 tag 可独立验证，最近的 V1 树是 1.18.30。

| 方面 | 上游（DSH） | 本项目（opencode） |
|---|---|---|
| 插件运行时 | Cordis（`apply(ctx)`、`ctx.on`、`ctx.effect`） | **V1**：`chat.message`、`experimental.chat.system.transform`、`experimental.chat.messages.transform`、`tool.execute.after`（`plugins/lib/host/v1.ts`）／**V2**：`ctx.session.hook("prompt"/"context")`、`ctx.tool.hook("execute.after")`、`ctx.tool.transform`（`plugins/lib/host/v2.ts`） |
| 宿主中立层 | ——（单一运行时，无此需求） | `plugins/lib/host/contract.ts`（语义事件缝）+ `plugins/lib/engine.ts`（宿主中立业务）+ `plugins/routing-suite.ts`（组合根） |
| Agent 定义 | `agent.cordis.yml`（Cordis service） | Markdown 文件（`agents/*.md`，YAML frontmatter + prompt body） |
| 工具注册 | `ctx.tools.register()`（Cordis） | V1 `tool({})`；V2 `ctx.tool.transform` + `z.toJSONSchema()` |
| LLM 调用 | `ctx.llm.stream()` | `opencode run` CLI 子进程（`dev_mode_subagent`） |
| 会话访问 | `agent.session`、`session.events`、`agent.inbox` | V1 `client.session.messages()`；V2 `ctx.session.context()` |
| 权限系统 | Cordis service grants | opencode `permission:` frontmatter（`allow`/`ask`/`deny`） |
| 阶段化门控 | `tools.restrict` 交集门控（`applyStageRestrict`） | **仅 V2**：`ctx.session.hook("context")` 里按 `core.unlockedFor(stage)` 重建 `event.tools`；默认关，开启后只锁写入面。**V1 无等价面** |

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
| 文件数 | 每个 preset ~10 个文件（v1-v8 bootstrap 变体、router-core、agent.cordis.yml） | 入口 1 + 引擎 1 + 宿主适配器 3（`lib/host/{contract,v1,v2}.ts`）+ 兼容壳 1 + 核心层 1 + 2 个 agent 文件 |
| Bootstrap 版本 | 多个（v1、v5、v6、v7、v8）用于实验 | 单一统一插件 |
| `routerMode` 配置 | spec preset 使用 `router-bootstrap-v1.mjs` + `routerMode: spec` | 不需要（用独立 agent 文件） |
| `legacyCore`（weak band 工具面分支） | spec preset 中存在 | 未移植（opencode 用静态 agent permissions） |
| 近场引导 | `inbox.append()`（Cordis inbox） | `messages.transform` user 角色尾插 |
| 会话模式持久化 | `sessionMode()` 读 `session.events` | `states Map<sessionID>` + `firstUserText` 防御性捕获 |
| 晋级触发器 | `session.events` 里的工具事件 | **逐调用工具完成事件**：V1 `tool.execute.after` / V2 `ctx.tool.hook("execute.after")`。**不再走消息面**——V2 hook 面的 `Message` 是 `{role, content}`、**没有 `parts` 字段**，旧的消息面写法在 V2 上会**静默失效**（恒空数组、零报错） |
| 熔断器 | 无 | 连续 3 次异常 → 自我禁用 |

## 4. 未移植（DSH 专用）

| 组件 | 原因 |
|---|---|
| `dsh-super-injector` | DSH Cordis 运行时注入管理器；与 opencode 插件模型不兼容 |
| `dsh-mode-boost` | 已从上游移除；分类器功能已内置到 router-core.mjs |
| `dsh-routing-suite` preset 子模块 | DSH preset 打包方式；opencode 用 agent 文件 + 插件分开管理 |
| `tools.restrict` 交集门控族 | 上游的门控面（`windowFor`/`preUnlockedFor`/`applyStageRestrict`）。**opencode 侧只在 V2 上有等价面**（见 §1 末行），且我们只取"锁写入面"这一子集；`windowFor`/`preUnlockedFor` 预解锁窗口不移植（上游实测恒空，自身死代码） |
| classic v0.3.1 冻结回退 | **仅 V1**。V2 适配缝不收 classic（冻结语义优先）；`OPENCODE_ROUTER_CLASSIC=1` 在 V2 上**打日志并回退 progressive**，不静默忽略 |

## 5. 上游其余子模块

| 子模块 | 状态 |
|---|---|
| `dsh-super-injector` | 不移植（DSH 专用，见上） |
| `dsh-mode-boost` | 已从上游移除；分类器功能已并入 router-core.mjs |

---

*本文件为决策记录（ADR 性质），只记录"移植时的平台差异"，不追踪上游每次提交。*
