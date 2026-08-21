# scripts/upstream — 上游基线快照

本目录是 dsh-router-standard 上游关键文件的**逐字节快照**，作为本仓库插件注入文本的唯一只读事实源。

> **v0.4.0 快照口径更新（对齐冻结点 742b180）**：上游 standard v0.7.4 已由"分类换装"转为
> "渐进披露 game-style timeline"，且大量机制绑定 DSH 平台（tools.restrict/presentAs/engram/
> pressure-sensor 推理流）在 opencode 不可移植。本仓库对齐冻结于 742b180：
> - `router-core.mjs` 仍为**逐字节快照**（纯函数可同步）；
> - `router-bootstrap.mjs` 降级为**参考地位**（平台代码必然重写，同 mode-boost-core 先例）；
> - 派生常量与工具映射见 `derived-map.md`（允许本地改写，须登记漂移）。
> 移植口径：**文本对齐 + 语义等价**（不承诺平台不存在的机制）。
## 快照规则（契约 3.4）

- **只读**：任何人不得编辑本目录任何文件。
- **唯一事实源**：插件 routing-suite.ts 的注入文本（persona 相关 + 分类器 + 引导）一律以本快照为准；从快照提取并落为插件常量，禁止从其他地方引用或凭记忆改写。
- **更新走流程**：需要新版本时按下方「如何更新」执行，不得就地修改。

## 快照清单

| 文件 | 来源仓库 | commit | tag / 描述 | sha256 |
|---|---|---|---|---|
| `router-core.mjs` | dsh-router-standard | `742b180` (742b18058087fc3fbe4855abfb1d2f11f46d5d16) | standard v0.7.4 clean rewrite（对齐冻结点，2026-08-22 fetch） | `544c12c64cb39f4bf8e40b355c35fbcd5ab5d1cc7b7c41d7f5445cebdae3d61c` |
| `router-bootstrap.mjs` | dsh-router-standard | `742b180` | 同上（**参考地位**：DSH 平台代码，opencode 侧重写见 plugins/progressive.ts） | `80e6bff8f7986937b2cfefde4f8218e215620c37a14178d2fc4453b047c75270` |


### 来源说明

- **基线决策**：组件仓库 `dsh-router-standard` origin/main 最新 = `9727510`（2026-08-18），用户拍板"较新者"（2026-08-18 调查确认）。
- 套件 `dsh-routing-suite` @ d924ed0 仍锁定 preset 指针 `eff787e`（v0.2.0），本快照取组件仓库 main（非套件指针）。
- 本地源路径：`D:\work_2\dsh-router-standard\preset\router-standard\{router-core.mjs, router-bootstrap.mjs}`
- sha256 取自**上游 git 提取原文**（`git show 9727510:preset/router-standard/... | sha256sum`），非本地 checkout 值。

## 用途

- `router-core.mjs`：路由核心逻辑（三带分类/parseMode/personaFor/bandOf/guideFor）
- `router-bootstrap.mjs`：路由插件逻辑（近场引导/dev_* 工具/session 状态管理）
- `mode-boost-core.js`：mode-boost 分类器核心（**历史参考**：我们插件的 classifyTask 源自此文件的扩展版正则，已本地 diverge）

## 如何更新

1. 上游组件仓库发布新版本后，确认 tag 稳定（稳定性闸门：查近期 revert 模式）
2. 从上游 git 提取原文：`git show <commit>:preset/router-standard/router-core.mjs > /tmp/router-core-<commit>.mjs`（router-bootstrap 同理）
3. 计算 sha256：`sha256sum /tmp/router-core-<commit>.mjs`
4. 用 `cp` **原样拷贝**覆盖本目录对应文件（逐字节，禁用编辑器/格式化工具，防 CRLF 转换）
5. 验证：`cmp -s /tmp/router-core-<commit>.mjs scripts/upstream/router-core.mjs`
6. 更新本 README 来源表（新 commit/tag/sha256）+ 旧版移入对照表
7. commit（若 sha256 不匹配则中止，查 .gitattributes `-text` 设置）

## 快照信息

- 快照日期：2026-08-18
- 执行人：AIOS（主会话，阶段 1 并行执行）
- 验证方式：`sha256sum` 逐字节比对 + `cmp -s`，两组全部一致
