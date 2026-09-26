# scripts/upstream — 上游基线快照

本目录是 dsh-router-standard 上游关键文件的**逐字节快照**，作为本仓库插件注入文本的唯一只读事实源。

> **v0.4.x 快照口径（2026-08-26 更新：快照来源推进至 b39112d；实现冻结点仍为 00c81b1）**：
> 上游 standard 已演进至 v1.27.0（注意力工程五大支柱；v1.21/v1.23 连续两次删除自研
> `dev_page_check`），且大量机制绑定 DSH 平台（tools.restrict/presentAs/run_code/
> dev_page_check/goal tools/engram_*/subagent-workflow）在 opencode 不可移植。
> 本目录区分**两个不同的"基线"**，勿混：
> - **快照来源 commit = `b39112d`**（本目录文件的字节出处）。`router-core.mjs` 在
>   00c81b1→b39112d 之间**逐字节未变**（sha256 复验相同，见清单），故文件未动、
>   只更新来源表；`router-bootstrap.mjs` 为**参考地位**（平台代码必然重写，同
>   mode-boost-core 先例），本次随上游 v1.18.0→v1.27.0 重新快照（按下方「如何更新」步骤 2-4）。
> - **实现冻结点 = `00c81b1`**（本仓库插件当前实现所对齐的语义）。v1.18.0→v1.27.0 的
>   逐条裁决已写入 `derived-map.md` **§7**，但**本轮只裁决、不实现**——该区间的可移植项
>   的代码落点见 §7.4 实现清单，属下一轮（v0.5.0）。
> - 派生常量与工具映射见 `derived-map.md`（允许本地改写，须登记漂移）。
> 移植口径：**文本对齐 + 语义等价**（不承诺平台不存在的机制）。
## 快照规则（契约 3.4）

- **只读**：任何人不得编辑本目录任何文件。
- **唯一事实源**：插件 routing-suite.ts 的注入文本（persona 相关 + 分类器 + 引导）一律以本快照为准；从快照提取并落为插件常量，禁止从其他地方引用或凭记忆改写。
- **更新走流程**：需要新版本时按下方「如何更新」执行，不得就地修改。

## 快照清单

| 文件 | 来源仓库 | commit | tag / 描述 | sha256 |
|---|---|---|---|---|
| `router-core.mjs` | dsh-router-standard | `b39112d` | standard v1.27.0 基线（core 与 00c81b1 逐字节相同，2026-08-26 从 git 对象复验，文件未动——仅来源 commit 前移） | `544c12c64cb39f4bf8e40b355c35fbcd5ab5d1cc7b7c41d7f5445cebdae3d61c` |
| `router-bootstrap.mjs` | dsh-router-standard | `b39112d` (b39112dc…) | standard v1.27.0（参考地位：DSH 平台代码，opencode 侧重写见 plugins/lib/progressive.ts） | `152b9773473ca420d0500e8e0f06534cc315a0f699ec839d11b4d38e043733ed` |

> 上游版本号**不是 git tag**，只能靠 `CHANGELOG.md` 文本归属；`ROUTER_VERSION` 常量（b39112d:57 = `'v1.20.0'`）**滞后于 CHANGELOG 顶（v1.27.0）**，归属矛盾与判定见 `derived-map.md` §7.3。
> b39112d 上 `router-bootstrap.mjs` 与 `router-bootstrap-v34.mjs` **逐字节相同**（`agent.cordis.yml` 挂载的是 `-v34` 变体）；00c81b1 上二者仅差一行 import（`router-core.mjs` vs `router-core-v34.mjs`，见对照表）。

### 对照表（旧版）

| 文件 | commit | 描述 | sha256 |
|---|---|---|---|
| `router-bootstrap.mjs` | `00c81b1` | standard v1.17.1（参考地位；2026-08-24 快照，2026-08-26 被 b39112d 行取代） | `13225055d946a64182359ddb67d44dad6d59b52bdee9de5e71696809836275a8` |
| `router-bootstrap.mjs` | `7d0d1d3` | v1.15.0 分叉主线（2026-08-23 快照） | `52c228da49ae0b120e81ecb3bcc0a02f13fa8cdd123905b0af6977bbd4242353` |


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

- 首次快照：2026-08-18（@9727510）；v0.4.0 期：2026-08-23（@7d0d1d3）；v0.4.1 期：2026-08-24（@00c81b1）
- 本次：2026-08-26（@b39112d / standard v1.27.0——bootstrap 字节级重快照；core 复验逐字节相同未动）
- 执行人：AIOS（T7 增量裁决任务，subagent lane）
- 验证方式：`sha256sum` 逐字节比对 + `cmp -s`，两组全部一致；bootstrap 走 `git show … > /tmp/…` → `cp` 原样覆盖（禁用编辑器/格式化工具，防 CRLF；该 blob 末行 `}` **无换行符**，编辑器写入会引入尾换行而破坏逐字节性）

