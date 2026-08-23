# opencode-routing-suite v0.4.0

DeepSeek V4 路由套件的 opencode 实现——**渐进披露游戏化时间线**：首轮 system 还原为
RL 训练句，`phase_begin` 确认后进入四阶段闯关（了解/对齐 → 拟合方案 → 开发 → 验证），
`tools_catalog`/`tools_help` 按需二级披露；另有无干预的 spec（deep-think）agent。

上游：dsh-router-standard **@742b180**（standard v0.7.4 game-style timeline）。移植口径
**文本对齐 + 语义等价**——DSH 平台专属机制（tools.restrict 真隐藏 / PTC / engram /
pressure-sensor 推理流）在 opencode 无等价物，当前版本阶段为推荐路径而非硬门控（实验裁决见 docs/RATIONALE.md §4）。

> **对齐冻结点**：本仓库冻结对齐 742b180，不随上游每 commit 追赶（上游方向多变）。
> 非 DeepSeek V4 模型**零干预**。

## 两种工作方式

| agent | 首轮 system | 思考形态 | 适用 |
|---|---|---|---|
| **standard**（渐进披露·执行型） | RL 训练句整体替换 | 想一段做一段；阶段自路由闯关 | 快速迭代：短循环改动文件 |
| **spec**（读先行·计划型） | opencode 原生组装（零干预） | 深度思考优先，不设上限 | 架构、评审、规划、修复 |

## 阶段玩法（standard）

1. **首轮**：system 整体替换为 RL 句（46 字符），工具全量可见（无硬门控）。
2. 调 **`phase_begin`** 确认开始 → 注入机制声明 + MAXential 泄压 + 阶段 0 指引。
3. 按阶段推进（**`phase_advance`** 闯关，或按工具证据自动提示）：
   - `0 了解/对齐`：read / glob / grep / websearch / webfetch / question
   - `1 拟合方案`：todowrite（plan 模式用 opencode 原生 Shift+Tab）
   - `2 开发`：write / edit / apply_patch
   - `3 验证`：bash + **`delivery_check` 交付门**（文件存在/非空/UTF-8 → PASS 才可宣告交付，FAIL 必须修复重跑）
4. **`tools_catalog`**（名+摘要）/ **`tools_help`**（详情+阶段归属）：注意力经济——
   工具 schema 是注意力税（上游实测：59K system 下 Flash 首轮 0 行动），按需查比全铺好。
5. 阶段状态持久化 `~/.opencode/router-standard/stages.json`（原子写，跨进程恢复）。

we-form 阶段文本（you-form 是 let me 吸引子——上游实测结论）；MAXential 泄压引导
（深度自主，不设思考帽）。

## 快速开始

```sh
# 1. agents（primary agent）
cp agents/standard.md agents/spec.md ~/.config/opencode/agents/

# 2. 插件（入口 + lib/ 全部文件都要）
mkdir -p ~/.config/opencode/plugins/
cp plugins/routing-suite.ts ~/.config/opencode/plugins/
cp -r plugins/lib ~/.config/opencode/plugins/lib
```

重启 opencode，**Tab** 切到 `standard` 或 `spec` agent，调 `dev_router_status` 验证
（显示 v0.4.0 / 阶段 / 持久化）。

## 使用

- **standard 会话**：默认渐进披露。首轮见 RL 句；`phase_begin` 开启；`phase_advance`
  闯关；`dev_router_status` 随时看阶段。
- **自动路由（opt-in）**：`OPENCODE_ROUTER_AUTO=1` 启动后，首条消息按构建/修复类型
  自动选 agent（react→standard / spec→spec）。不设置则手动 Tab 选择。
- **非 DeepSeek V4**：全部零干预（不注入、不替换、不改写）。
- **状态文件**：`OPENCODE_ROUTER_STAGE_FILE` 可覆盖
  `~/.opencode/router-standard/stages.json`。

## 配置（环境变量）

| 变量 | 默认 | 说明 |
|---|---|---|
| `OPENCODE_ROUTER_ENABLED` | 开 | `0` 完全禁用插件 |
| `OPENCODE_ROUTER_CLASSIC` | 关 | `1` 回退 v0.3.1 三带分类 persona 路由（冻结版） |
| `OPENCODE_ROUTER_AUTO` | 关 | `1` 首条消息自动选 agent 入口 |
| `OPENCODE_ROUTER_CRASH_TEST` | 关 | `1` 崩溃注入测试 |
| `OPENCODE_ROUTER_STAGE_FILE` | `~/.opencode/router-standard/stages.json` | 阶段状态文件路径 |


## 回退（v0.3.1 classic）

`OPENCODE_ROUTER_CLASSIC=1` 回到冻结的 v0.3.1：三带分类 persona 注入 + RL 窄面
standard band + 近场引导（`OPENCODE_ROUTER_GUIDE=1`）。冻结版不随上游演进。

## 与上游的关系

- 基线：dsh-router-standard `@742b180`（standard v0.7.4，2026-08-22 fetch，对齐冻结点）。
- 快照：`scripts/upstream/`（router-core 逐字节 + bootstrap 参考 + 派生映射与漂移记录）。
- 移植口径：文本对齐 + 语义等价；DSH 机制（restrict/PTC/engram/pressure-sensor 推理流）
  在 opencode 不可移植（permission.ask 钩子主线未接线、无 reasoning 流——见实验报告 §X1）。
- 本版本交付**叙述层渐进披露**；硬门控（静态 deny 真隐藏）由实验裁决后
  决定（`tool.ids` 枚举 ✅ / deny=请求级移除 ✅ / config.update 中断消息 ⚠️）。

## 文件布局

```
agents/standard.md       渐进披露 primary agent
agents/spec.md           无干预 deep-think primary agent
plugins/routing-suite.ts 入口（CLASSIC 选路）
plugins/lib/progressive.ts 渐进披露实现
plugins/lib/classic.ts     v0.3.1 冻结回退实现
plugins/lib/router-core.mjs 核心层（纯函数，直测）
scripts/upstream/        上游快照 + 漂移记录
```

## 测试

```sh
npm test      # node --test（核心层直测：分类/阶段/闯关/映射，30 例）
npm run check # tsc --noEmit（类型检查）
```

## 已知边界

- `opencode run` 每次新进程会话（`-c` 不能跨进程续同一会话）；真实 TUI 会话正常。
- 阶段状态跨进程恢复走磁盘（stateOf 回退）。
- system 整体替换会顶掉 opencode 基础指令与 AGENTS.md（标准模式语义：还原训练接口；
  工具 schema 由 API 层提供，模型仍见全工具）。
