# opencode-routing-suite v0.5.0

DeepSeek V4 路由套件的 opencode 实现——**渐进披露游戏化时间线**：首轮 system 还原为
RL 训练句，`phase_begin` 确认后进入四阶段闯关（了解/对齐 → 拟合方案 → 开发 → 验证），
晋级由**完成信号**驱动（阶段 0 见 question/todowrite、阶段 1 见 todowrite、阶段 2 见 delivery_check）；
`tools_catalog`/`tools_help` 按需二级披露；另有无干预的 spec（deep-think）agent。

上游：dsh-router-standard 快照 **@b39112d**（standard v1.27.0）；已移植 **v1.18.0→v1.28.0 的可移植子集**
（逐条裁决见 `scripts/upstream/derived-map.md` §7，落地与漂移见 §8）。移植口径
**文本对齐 + 语义等价**——DSH 平台专属机制（阶段化门控 / PTC / engram 记忆 / 编排件 / goal tools）
在 opencode 无对应面，当前版本阶段为推荐路线而非硬门控（实验裁决见 docs/RATIONALE.md §4）。

> **对齐冻结点**：本仓库**实现**对齐 v1.18.0→v1.28.0 的可移植子集（v0.5.0 起）；不随上游每 commit 追赶。
> **两个基线分开记**：快照来源 = `b39112d`（`scripts/upstream/` 的字节出处）；实现面 = §7 裁决出的可移植子集。
> **注入文本卫生**：所有注入面都不得出现本平台不存在的工具名——`test/router-core.test.mjs` 对
> §7.2 剔除清单里的 23 个指名做逐 token 断言（判据自带"可失败"自证）。
> 非 DeepSeek V4 模型**零干预**。

## 两种工作方式

| agent | 首轮 system | 思考形态 | 适用 |
|---|---|---|---|
| **standard**（渐进披露·执行型） | RL 训练句整体替换 | 想一段做一段；阶段自路由闯关 | 快速迭代：短循环改动文件 |
| **spec**（读先行·计划型） | opencode 原生组装（零干预） | 深度思考优先，不设上限 | 架构、评审、规划、修复 |

## 阶段玩法（standard）

1. **首轮**：system 整体替换为 RL 句（46 字符），工具全量可见（无阶段化门控）。
2. 调 **`phase_begin`** 确认开始 → 注入机制声明 + **Proactivity 主动性自检** + 阶段 0 指引 + `Task:` 回显
   （恢复进度 > 0 的会话只保留进度、不重注入阶段 0 引导——上游 v1.17.1 同根因修复）。
3. 按阶段推进（**默认自动**：完成信号驱动；`phase_advance` 是显式出口）：
   - `0 了解/对齐`：read / glob / grep / websearch / webfetch / question —— **No alignment, no advancement**：
     歧义要先问、复杂要先列计划；只读文件不算完成
   - `1 拟合方案`：todowrite + task（隔离独立子问题；plan 模式用 opencode 原生 Shift+Tab）
   - `2 开发`：write / edit / apply_patch（防局部最优：保住整体可用，顽固细节先完成其余再回头）
   - `3 验证`：bash + **`delivery_check(file, evidence)` 交付门**——文件存在/非空/UTF-8
     **+ 证据清单**（text/test 断言、run 真实输出、**numeric 数值不变量**、page/image 视觉类 reviewed:true）→
     全部 PASS 才可宣告交付，FAIL 必须修复重跑、不允许绕过（上游 v1.14/v1.16/v1.24 门禁语义）
4. **`tools_catalog`**（名+摘要）/ **`tools_help`**（详情+阶段归属）：注意力经济——
   工具 schema 是注意力税（上游实测：59K system 下 Flash 首轮 0 行动），按需查比全铺好。
5. 阶段状态持久化 `~/.opencode/router-standard/stages.json`（原子写 + 跨进程恢复 + `lastAdvance` 可查
   ——`dev_router_status` 能回答"我为什么在第 N 阶段"）。

we-form 阶段文本（you-form 是 let me 吸引子——上游实测结论）；Proactivity 主动性自检
（每轮扫描可推进项：可逆直接做并报告，只有用户偏好/不可逆/外部权限才问——上游 v1.17.0 终审，
泄压阀退役）。

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
（显示 v0.5.0 / 上游基线 / 阶段 / lastAdvance / 持久化）。

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

- 基线：**快照来源** = dsh-router-standard `@b39112d`（standard v1.27.0）；**实现面** = v1.18.0→v1.28.0 的
  可移植子集（v0.5.0 起落地）。
  区间 7d0d1d3→00c81b1 六提交（v1.14.0→v1.17.1）要点：WebGL 修复族与 dev_page_check 机制
  （不移植）、『交付后』→『未解锁』单真相标记、PROGRESSIVE_DECL 扩写、泄压→Proactivity 终审、
  phase_begin 跨代修复、delivery 证据门禁 + external 一等公民——逐项处置见
  `scripts/upstream/derived-map.md` §6。
  区间 00c81b1→b39112d（v1.18.0→v1.27.0，三提交）**已裁决并已实现**——裁决见 §7（7.2 剔除清单、
  7.3 版本归属、7.4 实现清单、7.5 未验证清单），落地与漂移见 **§8**。
- 快照：`scripts/upstream/`（router-core 逐字节 [00c81b1→b39112d 区间零变化] + bootstrap 参考 **@b39112d** + 派生映射与漂移记录）。
- 移植口径：文本对齐 + 语义等价；DSH 机制（阶段化门控/PTC/engram/编排件/goal tools）
  在 opencode 不可移植（permission.ask 钩子主线未接线、无 reasoning 流——见实验报告 §X1）。
- 静态 deny 真隐藏在 opencode **存在**（`tool.ids` 枚举 ✅ / deny=请求级移除 ✅ / config.update 中断消息 ⚠️），
  但只在**加载期**生效——本版本不做"按阶段开合可见面"（裁决见 derived-map §7.0 术语与 U8）。

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
npm test      # node --test（核心层直测 71 例 + 运行时链路 17 例 = 88 例）
npm run check # tsc --noEmit（类型检查）
```

运行时链路测试（`test/progressive-runtime.test.mjs`）直接 import 真实插件实现，驱动真实 hook 与真实
工具 `execute`：完成信号驱动晋级（含幂等与旧语义已删的反例）、`lastAdvance` 落盘与展示、
`phase_advance` 技能卡、`delivery_check` 的 numeric 门禁与非阻塞 hint——**不只测纯函数**。

## 已知边界

- `opencode run` 每次新进程会话（`-c` 不能跨进程续同一会话）；真实 TUI 会话正常。
- 阶段状态跨进程恢复走磁盘（stateOf 回退）。
- system 整体替换会顶掉 opencode 基础指令与 AGENTS.md（标准模式语义：还原训练接口；
  工具 schema 由 API 层提供，模型仍见全工具）。
