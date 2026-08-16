# opencode-routing-suite

[English](./README.md)

面向 [opencode](https://opencode.ai) 的任务感知推理模式路由套件：两个 primary
agent —— **spec**（计划型，面向修复/维护任务）与 **standard**（RL 窄面，
面向 RL 接口还原会话）—— 加一个薄插件：按任务分类在**首条消息**注入三带
persona（**react** / **spec** / **weak**）。推理模式在首条回复前锚定
（persona + 首轮工具 schema），第二条消息起恢复全能力。

社区项目，与 Anomaly / DeepSeek 官方无关。

## 为什么

模型在 react↔spec 轴上的行为坍缩为三个稳定区而非连续谱（DeepSeek V4 Pro
实测，21 点探针，n=2）：spec `[0, 0.15]`、不稳定过渡带 `[0.2, 0.45]`（回避）、
react `[0.5, 1.0]`。模型层的"连续调参"是幻觉——量化为三带才是诚实接口。

**首条消息**的路由之所以关键，是因为会话轨迹在早期就定型：首轮 system prompt
与工具 schema 决定模型以什么方式对待任务。修复任务受益于 read-first 的规划者；
构建任务受益于 hands-on 的执行者；RL 训练的会话受益于还原训练接口。锚定之后
会话恢复完整工具面，什么都不永久放弃。

## 工作原理

### 静态 primary agent

| Agent | Persona | 工具面 | 适用 |
|---|---|---|---|
| `spec` | spec 句兜底（幂等；插件注入优先） | read 放行；edit/write/glob ask；bash 继承全局（只读放行/写操作确认） | 架构设计、方案评审、复杂规划 |
| `standard` | RL 句 + 精简安全指令（插件整体替换 system） | 仅 read/bash/edit/write，其余全部显式 deny（含 glob、`dev_router_status`/`dev_router_mode`） | RL 接口还原的窄面会话 |

### 首条消息 persona 注入

新会话首条消息（无手动 agent 选择）时，插件要么分类任务、要么按手动锁处理，
然后锚定 `spec`（RL 锁锚 `standard`）并注入：

| Band | 触发 | 注入方式 |
|---|---|---|
| `react` | react 关键词胜（"写"/"实现"等构建任务） | 完整 system 保留 + react persona 尾附 |
| `spec` | spec 关键词胜（"重构"/"设计"等规划任务） | spec persona 尾附（幂等——spec.md 已含则跳过） |
| `weak` | 平局 / 无关键词 | 完整 system 保留 + weak persona 尾附 |
| `none` | 寒暄/空消息/短句无关键词（`CHAT_RE`） | **不路由**——寒暄让位，不注入 |
| `standard` | 手动锁（`dev_router_mode standard`） | **整体替换** system 为 RL 句 + 精简安全指令 |

插件（`plugins/routing-suite.ts`）刻意保持薄：

- **`dev_router_status`** —— 插件状态、版本金丝雀、自动路由、会话 band/persona/pending、
  模式锁、熔断。只读。
- **`dev_router_mode <spec|react|weak|standard|auto>`** —— 手动锁定/解锁本会话模式。
  `spec`/`react`/`weak` = persona 尾附；`standard` = RL system 替换。手动锁持续生效，
  直到 Tab 切到其他 agent 或改回 `auto`。
- **自动路由**（opt-in，`OPENCODE_ROUTER_AUTO=1`）—— 会话**首条消息**时，
  关键词计数分类器（移植自 mode-boost）选 band：react 关键词胜 → `react`；
  spec 关键词胜 → `spec`；平局/无命中 → `weak`。会话锚定到 `spec` 并注入对应
  persona。寒暄/问候类首条消息**不路由**（band `none`）。第二条消息起恢复
  restore agent（默认 `build`），即全能力。
- 用户已手动选择 agent（非 `build`）的会话不干预——手动选择永远优先。

## 安装

1. 复制 agent 文件（本仓库 `.disabled` 文件为遗留物，不要复制）：

   ```sh
   cp agents/spec.md agents/standard.md ~/.config/opencode/agents/
   ```

2. 复制插件：

   ```sh
   cp plugins/routing-suite.ts ~/.config/opencode/plugins/
   ```

3. 重启 opencode，按 **Tab** 循环 primary agent —— 应出现 `spec`、`standard`。

4. 可选：在 `opencode.jsonc` 注册调试工具（否则两者默认按 "ask" 处理）：

   ```jsonc
   "permission": {
     "dev_router_status": "allow",
     "dev_router_mode": "ask"
   }
   ```

不再需要 `minimal` / anchored-standard 方案——`standard` agent + 插件的 RL
system 替换已覆盖该路径。

## 使用

- **手动**：Tab 切到 `spec`/`standard` 正常使用。
- **会话锁**：让 agent 调用 `dev_router_mode standard`（或直接调用该工具）强制
  某模式——`spec`/`react`/`weak` 尾附 persona，`standard` 以 RL 句+安全指令
  整体替换 system。
- **自动**：以 `OPENCODE_ROUTER_AUTO=1` 启动 opencode。新会话首条消息自动
  路由。启动日志可见 `[routing-suite] session ... 分类=...`（或"分类器低置信"）
  的决策记录，每次决策也会打到 console。

### 环境变量

| 变量 | 默认 | 作用 |
|---|---|---|
| `OPENCODE_ROUTER_AUTO` | 关 | `1` 启用首条消息自动路由 |
| `OPENCODE_ROUTER_ENABLED` | 开 | `0` 完全禁用插件（无需删文件） |
| `OPENCODE_ROUTER_RESTORE_AGENT` | `build` | 锚定首条后的恢复 agent |
| `OPENCODE_ROUTER_ALLOW_VERSION` | — | 金丝雀强制放行某版本（验证兼容后使用） |
| `OPENCODE_ROUTER_CRASH_TEST` | 关 | `1` 注入 hook 异常，验证 fail-open + 熔断 |

寒暄/问候类首条消息永不路由（band `none`）——路由器让位给正常对话。

## 兼容性

- 针对 opencode **1.18.18**（V1 插件 API）开发与测试。
- 移植自 [yjh051108/dsh-routing-suite](https://github.com/yjh051108/dsh-routing-suite)
  （MIT）。本版对齐上游 **v0.2.0** 语义：preset 拆为两种路由模式 ——
  **standard**（RL 接口还原：首请求只带 RL 训练句 + shell/editor 工具面，
  think-act 循环）与 **spec**（deep-think-first：分类 persona + 完整 sections）。
  本移植以 `spec`/`standard` 双 primary agent 复刻该拆分；react/spec/weak
  三带 persona 由插件注入，仍是三带量化。
- **上游快照与跟进**：`scripts/upstream/` 保存上游关键文件的**逐字节快照**
  （`router-core.mjs`、`mode-boost-core.js`、`router-bootstrap.mjs` 及本说明），
  是插件全部注入文本的唯一只读事实源。跟进新版本四步循环：拉取子模块更新 →
  `cp` 原样覆盖（逐字节，防 CRLF 转换）→ 重跑 sha256 比对 → 更新快照表并
  commit。详见 `scripts/upstream/README.md`。
- **版本金丝雀**：启动时读取全局安装的 `opencode-ai` 包版本；失配或探测失败
  → 插件自我禁用并输出 console 警告；人工确认兼容后可设
  `OPENCODE_ROUTER_ALLOW_VERSION` 强制启用。
- **opencode 2.0**：V1 插件 API 在 V2 不兼容——V2 落地时需移植为
  `Plugin.define` / `session.hook("context")` / `tool.transform`。
  详见源码头部设计注记。

## 安全

- 所有 hook 全 try/catch：故障时记录日志并保持消息原样（**fail-open**，
  管线照常工作）。
- 连续 3 次故障后插件自我禁用并清空全部状态（恢复：重启、修复或删文件）。
- 状态为按会话隔离的 `Map`——会话之间不共享模式锁。
- 插件**不发任何网络请求**、**无遥测**。

## 验证

类型检查：

```sh
npm install && npm run check
```

手动清单（安装并重启后）：

- [ ] Tab 可循环到 `spec` / `standard`；`spec` 写/编辑前弹确认；
      `standard` 只暴露 read/bash/edit/write。
- [ ] `dev_router_status` 输出正常。
- [ ] `OPENCODE_ROUTER_AUTO=1` 时：构建任务（"写一个 python 脚本…"）注入
      react persona；修复任务（"重构一下这个模块…"）注入 spec persona；
      模糊任务注入 weak persona；寒暄（"你好"）**不路由**（无 band/注入日志）。
- [ ] `dev_router_mode standard` 锁会话：下一条消息以 RL system 替换运行
      （RL 句 + 精简安全指令），再下一条恢复 `build` 全能力。
- [ ] 自动路由会话的第二条消息运行在恢复 agent 下（全工具回归）。
- [ ] 崩溃注入：`OPENCODE_ROUTER_CRASH_TEST=1` 发一条消息——opencode 不崩、
      故障被记录、3 次后插件禁用。
- [ ] 删除全部文件（2 agents + 2 插件文件含遗留 `.disabled`）→ 行为与
      未安装时完全一致。

## 致谢

移植自 [yjh051108/dsh-routing-suite](https://github.com/yjh051108/dsh-routing-suite)
（MIT）。按上游致谢：

- [xiaobright/modeltest](https://github.com/xiaobright/modeltest) —— Project2 /
  V4.1b 评测
- [xiaobright/dsh-anchored-standard](https://github.com/xiaobright/dsh-anchored-standard)
  —— 锚定机制

## License

MIT。分类器与 persona 派生自 yjh051108/dsh-routing-suite 的
`router-standard` preset；原始版权与 MIT 声明见 [`NOTICE`](./NOTICE)。
