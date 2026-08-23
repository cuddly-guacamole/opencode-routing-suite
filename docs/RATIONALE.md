# RATIONALE — 为什么这样设计（v0.4.0）

> 本文件解释"为什么渐进披露"与"为什么外部阶段路由"（设计依据）。
> 数据来自上游 dsh-router-standard（v0.7.4 @742b180）的实测与 2026-08-22
> opencode 1.18.18 本机实验裁决（X1-X5，结论见 §4）。

## 1. 工具 schema 是注意力税

上游实测（DeepSeek V4 Flash，官方 API）：**59K system 下首轮 0 行动**——
推理全耗在"选工具/看工具"的元思考上（"which tool should I..."挤占技术思考）。
全量工具目录 ≈ 48 项 + PTC SDK 39K。结论：**开局全铺工具 = 注意力税**，
模型首轮注意力应花在任务上，不是目录上。

opencode 侧工具面更小（16 内置 + MCP），schema 税依旧存在但量级小得多——
这就是"税在不在"的实证答案：**有，但远小于 DSH**。渐进披露的价值 = 只付
需要的注意力（索引轻 `tools_catalog`、详情重 `tools_help`，类 man page）。

## 2. 模型不能自路由——阶段必须外部推进

上游 P3/P5/P8 实测：模型内部自路由窗口极小（只有 weak persona + few-shot
指令可 lean 不翻转）；behavior 沿 persona 轴坍缩为稳定区（spec/react），
相位跃迁意味着**首个请求即提交路径**。渐进披露同理：**阶段推进不能靠模型
自觉**——所以 `phase_begin`（确认）与 `phase_advance`（闯关）是显式工具，
模型调用即外部信号。阶段状态持久化，resume 不丢（跨进程 disk 恢复）。

## 3. 还原，不是控制（上游哲学）

- 废弃：关键词计数分类换装、we 团队协议压制、思考预算帽/节拍器。
- 保留：RL 训练句首轮（接口还原）、MAXential 泄压引导（深度自主，仅给
  "选择"不给"命令"）、we-form 阶段文本（you-form 是 let me 吸引子）。
- **交付门（同步上游 v1.11.0）**：验证阶段以 `delivery_check` 为出口契约——
  文件三验证（存在/非空/UTF-8）全 PASS 才允许宣告交付，FAIL 修复重跑；
  交付是 gate 不是进度标签（opencode 版无浏览器 smoke）。
- 当前版本阶段 = 推荐路径不是禁令（工具全量可见）——与上游 restrict 的"轻呈现"
  语义对齐，而非更严的控制。

## 4. opencode 平台约束（实验裁决，2026-08-22）

| 实验 | 结论 | 对设计的影响 |
|---|---|---|
| X5 deny 语义 | deny = 请求级**移除**工具（模型看不到） | 硬门控"真隐藏"可行；但破坏工具面可被 bash 等价替代 |
| X2 config.update | 可用/内存生效/**不写盘**；消息流程中调用会**中断当前消息** | 门控切换仅限空闲窗口 + 降级路径预设 |
| X1 permission.ask | 插件钩子**零触发**（主线未接线 #7006/#9229/#22311/PR#22619 实证复现） | 该门控路线关闭；权限走 HTTP API |
| X3 工具枚举 | `tool.ids()` 完整可靠；`tool.list()` 空 query 不稳定 | catalog 用 ids；help 用静态摘要 |
| X4 注入通道 | messages.transform 每请求触发（input 空，消息带 sessionID）；先于 system.transform | agent 判定经 messages 缓存；Bootstrap 由工具返回承载 |

结论：**当前版本用叙述层 + 工具集实现渐进披露，硬门控留给后续版本**（由实验裁决后的
静态 deny 路径）——不为机制不可达的承诺买单。

## 5. 为什么保留 spec agent

spec = **零干预 deep-think**：首轮超长推理链是自己（101K 推理 0 行动）的
特征，不是缺陷。standard 负责执行型迭代，spec 负责计划型任务，用户 Tab 选择。
自动路由（AUTO=1）仅做"agent 入口"选择，不做 persona 换装。

## 6. 非 DeepSeek V4 零干预

路由机制全部基于 V4 Flash/Pro 实测行为（相位坍缩、阈值型跳变）。非 V4 模型
未被校准——注入 RL 句/阶段文本的行为未定义，默认**零干预**（不替换、不注入、
不闯关）。这与 v0.3.1 的"DeepSeek V4 专属门控"一脉相承。

## 7. 熔断 / 回退（工程护栏）

- 熔断：连续 3 次 hook 异常自禁用（不干扰用户会话）。
- 回退：`OPENCODE_ROUTER_CLASSIC=1` 冻结 v0.3.1 实现（入口薄转发，独立文件）。
  阶段状态写失败不触发熔断（进度丢失可接受，不牺牲稳定性）。
- 快照契约：scripts/upstream 只读 + 派生映射漂移记录（tool 名 Cordis→opencode）。

## 8. 已知取舍

- system 整体替换顶掉 opencode 基础指令与 AGENTS.md——标准模式语义即"还原
  训练接口"，工具 schema 由 API 层提供，模型仍见全工具；spec 模式不受影响。
- 状态文件与 opencode 官方 ~/.opencode 目录同居：可用
  `OPENCODE_ROUTER_STAGE_FILE` 改址，未来可迁 .local/share/opencode。
- opencode run 每次新进程会话（-c 不跨进程续会话）——TUI 真实会话无此限制。
