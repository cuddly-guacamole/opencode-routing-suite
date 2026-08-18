# opencode-routing-suite v0.3.0

[English](./README.md)

面向 [opencode](https://opencode.ai) 的任务感知推理模式路由：单一 primary
agent（**spec**，read-first）加薄路由插件。三带 persona（react/spec/weak）按
**模型**自动选择（Pro→WEAK_PRO / Flash→WEAK_FLASH），每轮幂等注入，近场引导
（weak 带深度自适应）。基于上游 dsh-router-standard @9727510 移植。

社区项目，与 Anomaly / DeepSeek 官方无关。

**v0.3.0 破坏性变更**：standard agent（RL 窄面）和 RL system 替换已移除——
上游 9727510 放弃了 RL 接口还原方向。详细迁移步骤见[兼容性](#兼容性)。

## 为什么

模型在 react↔spec 轴上的行为坍缩为三个稳定区而非连续谱（DeepSeek V4 Pro
实测，21 点探针，n=2）：spec `[0, 0.15]`、不稳定过渡带 `[0.2, 0.45]`（回避）、
react `[0.5, 1.0]`。模型层的"连续调参"是幻觉——量化为三带才是诚实接口。

弱带的最优 persona **因模型而异**（P11、P24 实测）：Pro 用 WEAK_PRO（spec 句 +
classify 指令，无锚）效果最优；Flash 用 WEAK_FLASH（+recall/anti-runaway 锚，
单任务完成率 100%）。插件按会话模型自动选择。

首条消息的路由之所以关键，是因为会话轨迹在早期就定型：首轮 system prompt 与
工具 schema 锚定模型以什么方式对待任务。锚定之后恢复完整工具面，什么都不永久放弃。

## 工作原理

### 唯一 primary agent

| Agent | Persona | 工具面 | 适用 |
|---|---|---|---|
| `spec` | spec 句兜底（幂等；插件注入优先） | read 放行；edit/write/glob ask；bash 继承全局 | 所有任务 |

### 每轮 persona 注入（v0.3.0，幂等）

每次模型请求时，插件检查 system 是否已含目标 persona。若无，尾部追加（幂等——
永不重复）：

| Band | 触发 | 注入方式 |
|---|---|---|
| `react` | react 关键词胜（构建任务："写"/"implement"…） | 完整 system 保留 + react persona 尾附 |
| `spec` | spec 关键词胜（修复任务："refactor"/"debug"…） | spec persona 尾附（幂等——spec.md 已含则跳过） |
| `weak` | 平局/无关键词 | 完整 system 保留 + **按模型选** persona 尾附 |
| `none` | 寒暄/空消息/短句无关键词 | **不路由**——寒暄让位 |

### 近场引导（weak 带，深度自适应）

弱带会话中，每条用户消息后自动注入一条引导（仅弱带，强带不受影响）：

| 条件 | 引导文本 |
|---|---|
| 简单任务（短消息、无架构关键词） | GUIDE_WEAK：快速收敛引导 |
| 复杂任务（>120 字或含"架构/重构/设计"等） | GUIDE_DEEP：深度探索引导（架构、边界、集成点，信息驱动停止信号） |

近场引导默认关闭，设 `OPENCODE_ROUTER_GUIDE=1` 启用。

### 工具

- **`dev_router_status`** —— 插件状态、版本、自动路由、band、agent、模式锁、熔断。只读。
- **`dev_router_mode <mode>`** —— 手动锁定/解锁。接受 band 名（`spec`/`react`/`weak`/`auto`）、
  数字 0-100、0.0-1.0、`mixed`。
- **`dev_mode_subagent`** —— 在独立会话中执行任务（模式隔离），通过 `opencode run`
  子进程实现。

### 自动路由（opt-in）

以 `OPENCODE_ROUTER_AUTO=1` 启动 opencode。新会话首条消息由关键词计数分类器
选 band。寒暄/问候类首条消息不路由。第二条消息起恢复 build 全能力。

## 安装

1. 复制 agent 文件：

   ```sh
   cp agents/spec.md ~/.config/opencode/agents/
   ```

2. 复制插件：

   ```sh
   cp plugins/routing-suite.ts ~/.config/opencode/plugins/
   ```

3. 重启 opencode，按 **Tab** 切到 `spec` agent。

4. 可选：在 `opencode.jsonc` 注册调试工具：

   ```jsonc
   "permission": {
     "dev_router_status": "allow",
     "dev_router_mode": "ask"
   }
   ```

## 使用

- **手动**：Tab 到 `spec` 正常使用。
- **会话锁**：`dev_router_mode weak`（或调用该工具）强制某模式——persona
  每轮注入。Tab 切到其他 agent 或 `dev_router_mode auto` 解锁。
- **自动**：`OPENCODE_ROUTER_AUTO=1` 启动。新会话首条自动路由。

### 环境变量

| 变量 | 默认 | 作用 |
|---|---|---|
| `OPENCODE_ROUTER_AUTO` | 关 | `1` 启用首条消息自动路由 |
| `OPENCODE_ROUTER_ENABLED` | 开 | `0` 完全禁用插件 |
| `OPENCODE_ROUTER_ALLOW_VERSION` | — | 金丝雀强制放行 |
| `OPENCODE_ROUTER_CRASH_TEST` | 关 | `1` 崩溃注入测试 |
| `OPENCODE_ROUTER_WEAK_ANCHOR` | 关 | `1` 恢复旧 WEAK_FLASH 锚行（P23 回退开关） |
| `OPENCODE_ROUTER_GUIDE` | 关 | `1` 启用近场引导 |

## 兼容性

- 针对 opencode **1.18.18**（V1 插件 API）开发与测试。
- 移植自 [yjh051108/dsh-routing-suite](https://github.com/yjh051108/dsh-routing-suite)
  （MIT）。**v0.3.0 对齐上游 dsh-router-standard `9727510`**（2026-08-18）：
  统一行为链——分类 → personaFor(mode, modelId) → 首轮核心工具面 → 首个 tool/call
  后恢复全目录 → 近场引导（弱带）。上游在此提交放弃了 RL 接口方向。
  上游套件另含两个子模块未移植：**dsh-super-injector**（DSH 平台专用的
  Cordis 运行时注入管理器，与 opencode 插件模型不兼容）和 **dsh-mode-boost**
  （已从上游移除；其分类器功能已内置到 router-core.mjs 中）。
- **opencode 2.0**：V1 插件 API 在 V2 不兼容。核心逻辑已与 V1 hook 解耦（纯函数），
  V2 迁移仅需重写薄适配层（chat.message→session.hook("context")、
  system.transform→event.system、tool→tool.transform）。

### v0.2.0 → v0.3.0 迁移

| 变更 | 影响 | 操作 |
|---|---|---|
| standard agent 移除 | `agents/standard.md` 不再使用 | 从 `~/.config/opencode/agents/` 删除 |
| RL system 替换移除 | `dev_router_mode standard` 不再工作 | 用 `weak` 替代 |
| persona 改为每轮注入 | 每次 LLM 请求的 system 都含 persona | 无需操作（幂等、缓存中性） |
| `OPENCODE_ROUTER_RESTORE_AGENT` 移除 | 不再需要 | 从环境变量删除（如有设置） |

## 安全

- 所有 hook try/catch：**fail-open**（故障记录，消息不动）。
- 连续 3 次故障后自我禁用，清空状态。
- 按会话隔离的 `Map`——不共享模式锁。
- 不发网络请求，无遥测。

## 验证

```sh
npm install && npm run check && node --test
```

手动清单（安装并重启后）：

- [ ] Tab 可切到 `spec`；写/编辑前弹确认。
- [ ] `dev_router_status` 输出正常（v0.3.0、band、agent）。
- [ ] `OPENCODE_ROUTER_AUTO=1`："写一个 python 脚本" → react persona；
      "重构这个模块" → spec persona；"你好" → 不路由。
- [ ] `dev_router_mode 42` → band react；`0.3` → mixed；`weak` → weak。
- [ ] 崩溃注入：`OPENCODE_ROUTER_CRASH_TEST=1`，3 次后自禁用。
- [ ] `OPENCODE_ROUTER_WEAK_ANCHOR=1` → WEAK_FLASH 含 "Think deeply first"。
- [ ] `OPENCODE_ROUTER_GUIDE=1` + weak 带任务 → 控制台可见引导注入日志。
- [ ] 删除文件 → 行为与未安装一致。

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
