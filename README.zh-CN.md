# opencode-routing-suite v0.3.1

[English](./README.md)

让 [opencode](https://opencode.ai) 按任务类型自动切换工作方式——实测三带行为学
（spec 计划型 / react 执行型 / weak 自路由），DeepSeek V4 模型专属优化；非
DeepSeek V4 模型零干预。社区项目，与 Anomaly / DeepSeek 官方无关。

## 两种工作方式

| 工作方式 | 首轮注入 | 思考形态 | 适用 |
|---|---|---|---|
| **spec**（读先行·计划型） | "You are a helpful software engineer assistant." | 深度思考优先，超长推理链 | 架构、评审、规划、修复——读随便、写要问 |
| **standard**（RL 窄面·执行型） | 训练句整体替换，工具面仅 bash+edit | 想一段做一段（think-act 循环） | 快速迭代：短循环改动文件 |

运行原理：首条消息被分类（三带），插件在首个模型请求前注入匹配 persona + 首轮
核心工具集，随后恢复完整能力。详细设计依据见 [docs/RATIONALE.md](./docs/RATIONALE.md)。

## 快速开始

```sh
cp agents/spec.md agents/standard.md ~/.config/opencode/agents/
cp plugins/routing-suite.ts ~/.config/opencode/plugins/
```

重启 opencode，按 **Tab** 切到 `spec` 或 `standard` agent，调用 `dev_router_status`
验证生效。

可选：在 `opencode.jsonc` 注册调试工具：

```jsonc
"permission": {
  "dev_router_status": "allow",
  "dev_router_mode": "ask"
}
```

## 使用

- **自动路由**（opt-in）：`OPENCODE_ROUTER_AUTO=1` 启动，首条消息分类选 band；
  寒暄/问候不路由；第二条起恢复 build 全能力。
- **手动锁**：`dev_router_mode spec|react|weak|standard|auto` 强制某模式，
  persona 每轮注入；Tab 切其他 agent 即解锁。
- **数字接口**：`dev_router_mode 42` → react、`0.3` → mixed、`weak` → weak。
- **近场引导**：`OPENCODE_ROUTER_GUIDE=1` 启用，弱带会话每条用户消息后按任务
  复杂度注入深/浅引导。

### 工具

- **`dev_router_status`** — 插件状态、版本、band、agent、模型、模式锁、熔断。只读。
- **`dev_router_mode <mode>`** — 手动锁定/解锁推理模式。
- **`dev_mode_subagent <mode> <task>`** — 独立会话模式隔离，`opencode run` 子进程。

### 环境变量

| 变量 | 默认 | 作用 |
|---|---|---|
| `OPENCODE_ROUTER_AUTO` | 关 | `1` 启用首条消息自动路由 |
| `OPENCODE_ROUTER_ENABLED` | 开 | `0` 完全禁用插件 |
| `OPENCODE_ROUTER_ALLOW_VERSION` | — | 金丝雀强制放行 |
| `OPENCODE_ROUTER_CRASH_TEST` | 关 | `1` 崩溃注入测试 |
| `OPENCODE_ROUTER_WEAK_ANCHOR` | 关 | `1` 恢复旧 WEAK_FLASH 锚行 |
| `OPENCODE_ROUTER_GUIDE` | 关 | `1` 启用近场引导 |

## 兼容性与风险

- **opencode 1.18.18**（V1 插件 API）。版本不匹配时插件自动禁用（金丝雀），
  可用 `OPENCODE_ROUTER_ALLOW_VERSION` 强制放行。
- **模型门控**：仅 DeepSeek V4（`deepseek` + `v4`）模型获得测试过的 persona 分支
  （Pro→WEAK_PRO / Flash→WEAK_FLASH）；其余模型使用通用 persona，不注入专属锚。
  装了这个插件**不会**改变非 DeepSeek V4 模型的行为。
- **卸载/回滚**：删除这两个文件即完全还原，不留状态：

  ```sh
  rm ~/.config/opencode/agents/spec.md ~/.config/opencode/agents/standard.md
  rm ~/.config/opencode/plugins/routing-suite.ts
  ```

- **与 opencode 自带 agent 的区别**：自带 `build`/`plan` 是静态权限预设；本项目
  会按任务类型**自动切换** persona 与首轮工具面，且只影响会话首轮路由与注入。

## 为什么这样设计

要点（详细见 [docs/PORTING.md](./docs/PORTING.md) 与 [docs/RATIONALE.md](./docs/RATIONALE.md)）：

- 模型沿 react↔spec 轴行为坍缩为三个稳定区，不是连续谱——三带量化是诚实接口。
- persona 是主导触发器，模型在首请求路径提交——所以必须在首个请求前路由。
- 模型不能自路由——模式选择必须来自外部，本插件即外部路由器。
- 弱带最优 persona **因模型而异**（Pro 无锚 / Flash 带锚），插件自动选择。
- 首条消息路由后恢复完整能力，什么都不永久放弃。

## 移植内容

对齐上游 [yjh051108/dsh-routing-suite](https://github.com/yjh051108/dsh-routing-suite)
**`9727510`**（2026-08-18）。行为链：分类 → `personaFor(mode, modelId)` → 首轮
核心工具面 → 首个 tool/call 后恢复全目录 → 近场引导（弱带）。

平台差异（Cordis → opencode hooks、工具映射、权限系统）、结构差异、未移植的
DSH 专用组件：见 [docs/PORTING.md](./docs/PORTING.md)。

## 验证

```sh
npm run check && node --test
```

手动清单（安装并重启后）：

- [ ] Tab 切到 `spec`（写/编辑前确认）与 `standard`（仅 bash+edit）。
- [ ] `dev_router_status` 输出正常（band、agent、model）。
- [ ] `OPENCODE_ROUTER_AUTO=1`："写一个 python 脚本" → react；"重构这个模块" → spec；"你好" → 不路由。
- [ ] `dev_router_mode 42` → react；`0.3` → mixed；`weak` → weak；`standard` → RL 窄面。
- [ ] 崩溃注入：`OPENCODE_ROUTER_CRASH_TEST=1`，3 次后自禁用。
- [ ] `OPENCODE_ROUTER_WEAK_ANCHOR=1` → WEAK_FLASH 含 "Think deeply first"。
- [ ] `OPENCODE_ROUTER_GUIDE=1` + weak 带任务 → 控制台可见引导注入日志。
- [ ] 删除文件 → 行为与未安装一致。

## 从 v0.2.0 迁移

| 变更 | 影响 | 操作 |
|---|---|---|
| `standard` agent 可用 | `agents/standard.md` 已添加 | 复制到 `~/.config/opencode/agents/` |
| `dev_router_mode standard` 可用 | RL 窄面模式 | 用 `dev_router_mode standard` 激活 |
| persona 改为每轮注入 | 每次 LLM 请求的 system 都含 persona | 无需操作（幂等、缓存中性） |
| `OPENCODE_ROUTER_RESTORE_AGENT` 移除 | 不再需要 | 从环境变量删除（如有设置） |

## 安全

- 所有 hook try/catch：**fail-open**（故障记录，消息不动）。
- 连续 3 次故障后自我禁用，清空状态。
- 按会话隔离的 `Map`——不共享模式锁。
- 不发网络请求，无遥测。

## 实证与归属

- **实测数据**：三带（21 点探针 n=2）、WEAK_PRO/FLASH 分支（P11/P24/P23）、
  近场引导（P30）。编号原文见上游仓库 `docs/paper.md` / `docs/experiments.md`。
  人话版：每次切换都选对配置（"100% 路由"）；Flash 单任务完成率 100%（P23）。
- **移植自** [yjh051108/dsh-routing-suite](https://github.com/yjh051108/dsh-routing-suite)（MIT）。
- 评测方法：[xiaobright/modeltest](https://github.com/xiaobright/modeltest)（Project2 / V4.1b）。
- 锚定机制：[xiaobright/dsh-anchored-standard](https://github.com/xiaobright/dsh-anchored-standard)（MIT）。

## License

MIT。分类器与 persona 派生自 yjh051108/dsh-routing-suite 的 `router-standard`
preset；原始版权与 MIT 声明见 [`NOTICE`](./NOTICE)。
