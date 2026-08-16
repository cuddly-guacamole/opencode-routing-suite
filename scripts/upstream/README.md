# scripts/upstream — 上游基线快照

本目录是 dsh-routing-suite 上游关键文件的**逐字节快照**，作为本仓库插件注入文本的唯一只读事实源。

## 快照规则（契约 3.4）

- **只读**：任何人不得编辑本目录任何文件。
- **唯一事实源**：插件 routing-suite.ts 的注入文本（RL 句 + 精简安全指令 + persona 相关）一律以本快照为准；D2 从快照提取并落为插件常量，禁止从其他地方引用或凭记忆改写。
- **更新走流程**：需要新版本时按下方「如何更新」执行，不得就地修改。

## 快照清单

| 文件 | 来源子模块 | 来源仓库 URL | 子模块 commit | tag | sha256 |
|---|---|---|---|---|---|
| `router-core.mjs` | preset → dsh-router-standard | https://github.com/yjh051108/dsh-router-standard.git | `eff787e9` (eff787e95132d6c7104214542104a84d656b497e) | v0.2.0 | `90764715c80d670dd872c1b033d29c556206136be72eb9bdc67f9b9b75eda60e` |
| `mode-boost-core.js` | mode-boost → dsh-mode-boost | https://github.com/yjh051108/dsh-mode-boost.git | `a9a666a6` (a9a666a6ec83ae72c6f683300384554e41131880) | v0.1.0 | `98ce96d19e73cf94c74eb3a449eca2d95a186a8fad3379e1624615c6485c0221` |
| `router-bootstrap.mjs` | preset → dsh-router-standard | https://github.com/yjh051108/dsh-router-standard.git | `eff787e9` (eff787e95132d6c7104214542104a84d656b497e) | v0.2.0 | `82e8b106d4abe2df407506c9356d1dcdb3c0095afd9e86ac82aecb0f1a7f49f1` |

### 来源说明

- **上游外层仓库**：`D:\work\dsh-routing-suite`，HEAD = `a09eb0ade28e6ec3b8e5eb22985a14f6bfa1fbe5`（2026-08-16 实测复核，与计划书一致，无漂移）
- 本地源路径：
  - `D:\work\dsh-routing-suite\preset\preset\router-standard\router-core.mjs`
  - `D:\work\dsh-routing-suite\mode-boost\lib\core.js`（快照内改名为 `mode-boost-core.js`，避免与 router-core 命名冲突）
  - `D:\work\dsh-routing-suite\preset\preset\router-standard\router-bootstrap.mjs`

## 用途

- `router-core.mjs`：路由核心逻辑（router-standard 核心）
- `router-bootstrap.mjs`：路由引导加载逻辑（router-standard 引导）
- `mode-boost-core.js`：mode-boost 核心逻辑

三份共同构成插件注入文本的唯一只读事实源。

## 如何更新

1. 上游发布新版本后，在 `D:\work\dsh-routing-suite` 拉取子模块更新（`git -C D:\work\dsh-routing-suite\preset pull` / `git -C D:\work\dsh-routing-suite\mode-boost pull`）
2. 用 `cp` **原样拷贝**（逐字节，禁用编辑器/格式化工具，防 CRLF 转换）覆盖本目录对应文件
3. 重跑 sha256 比对，确认与源一致
4. 更新本 README 的来源表（新 commit/tag/sha256）
5. commit

## 快照信息

- 快照日期：2026-08-16
- 执行人：AIOS 子代理 route-snap-1（交付工程师，方向 D3）
- 验证方式：`sha256sum` 逐字节比对，三组全部一致
