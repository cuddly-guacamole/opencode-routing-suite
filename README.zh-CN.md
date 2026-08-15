# opencode-routing-suite

[English](./README.md)

面向 [opencode](https://opencode.ai) 的任务感知推理模式路由套件：三个 primary
agent —— **spec**（计划型，面向修复/维护任务）、**react**（执行型，面向新构建任务）、
**weak**（弱模式/RL 原生形态，模糊任务回退）—— 加一个薄插件自动帮你选 agent。
推理模式在**首条回复前**锁定（persona + 首轮工具 schema 锚定轨迹），随后恢复全能力。

社区项目，与 Anomaly / DeepSeek 官方无关。

## 为什么

模型在 react↔spec 轴上的行为坍缩为三个稳定区而非连续谱（DeepSeek V4 Pro
实测，21 点探针，n=2）：spec `[0, 0.15]`、不稳定过渡带 `[0.2, 0.45]`（回避）、
react `[0.5, 1.0]`。模型层的"连续调参"是幻觉——量化为三带才是诚实接口。

**首条消息**的路由之所以关键，是因为会话轨迹在早期就定型：首轮 system prompt
与工具 schema 决定模型以什么方式对待任务。修复任务受益于 read-first 的规划者；
构建任务受益于 hands-on 的执行者。锚定之后会话恢复完整工具面，什么都不永久放弃。

## 工作原理

| Agent | Persona | 工具面 | 适用 |
|---|---|---|---|
| `spec` | RL 对齐句（router-standard 原稿） | read 放行；edit/write/glob ask；bash 只读放行 | 架构设计、方案评审、复杂规划 |
| `react` | hands-on doer（produce-verify-fix，无仪式） | 全工具（继承全局权限） | 编码实现、修 bug、重构落地 |
| `weak` | 官方 minimal 一句话 | 仅 read/bash/edit/write，其余全部 deny | 正确性优先的简单任务、极简对齐 |

插件（`plugins/routing-suite.ts`）刻意保持薄：

- **`dev_router_status`** —— 显示插件状态、版本金丝雀、自动路由、会话模式锁、熔断。
- **`dev_router_mode <spec|react|weak|auto>`** —— 手动锁定/解锁本会话模式。
  手动锁持续生效，直到 Tab 切到其他 agent 或改回 `auto`。
- **自动路由**（opt-in，`OPENCODE_ROUTER_AUTO=1`）—— 会话**首条消息**时，
  关键词计数分类器（移植自 router-standard）选 agent：react 关键词胜 → `react`；
  spec 关键词胜 → `spec`；平局/无命中 → `weak`（模型内部自路由）。
  第二条消息起恢复 restore agent（默认 `build`），即全能力。
- 用户已手动选择 agent（非 `build`）的会话不干预——手动选择永远优先。

用户选择 `minimal`（anchored-standard）的会话完全不碰：路由器只作用于
"无手动选择的新会话首条消息"。

## 安装

1. 复制 agent 文件：

   ```sh
   cp agents/*.md ~/.config/opencode/agents/
   ```

2. 复制插件：

   ```sh
   cp plugins/routing-suite.ts ~/.config/opencode/plugins/
   ```

3. 重启 opencode，按 **Tab** 循环 primary agent —— 应出现 `spec`、`react`、`weak`。

4. 可选：在 `opencode.jsonc` 注册调试工具（否则两者默认按 "ask" 处理）：

   ```jsonc
   "permission": {
     "dev_router_status": "allow",
     "dev_router_mode": "ask"
   }
   ```

## 使用

- **手动**：Tab 切到 `spec`/`react`/`weak` 正常使用。
- **会话锁**：让 agent 调用 `dev_router_mode react`（或直接调用该工具）强制
  某模式——适合稳定的 A/B 对比。
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

## 兼容性

- 针对 opencode **1.18.18**（V1 插件 API）开发与测试。
- 移植自 [yjh051108/dsh-routing-suite](https://github.com/yjh051108/dsh-routing-suite)
  （MIT）。移植基准为 v0.1.x 的 `router-core.mjs`。上游 v0.2.0 把 preset 拆为
  两种路由模式 —— **standard**（RL 接口还原：首请求只带 RL 训练句 +
  shell/editor 工具面，think-act 循环）与 **spec**（deep-think-first：
  分类 persona + 完整 sections）。分类器、spec/react persona 与三带量化
  跨版本未变，本移植对应 spec-mode 语义；standard（RL 接口）模式对应
  opencode 既有的 `minimal`/anchored-standard 方案。
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

- [ ] Tab 可循环到 `spec` / `react` / `weak`；`spec` 写/编辑前弹确认；
      `weak` 只暴露 read/bash/edit/write。
- [ ] `dev_router_status` 输出正常。
- [ ] `OPENCODE_ROUTER_AUTO=1` 时：构建任务（"写一个 python 脚本…"）由
      `react` 应答；修复任务（"重构一下这个模块…"）由 `spec` 应答；
      模糊任务回退 `weak`（console 可见低置信警告）。
- [ ] 自动路由会话的第二条消息运行在恢复 agent 下（全工具回归）。
- [ ] 崩溃注入：`OPENCODE_ROUTER_CRASH_TEST=1` 发一条消息——opencode 不崩、
      故障被记录、3 次后插件禁用。
- [ ] 删除全部文件 → 行为与未安装时完全一致。

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
