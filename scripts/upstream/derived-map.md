# 派生常量 + 漂移记录（契约 3.4 补充）

快照是"上游原文"；本文件记录从快照**派生**进本仓库的常量及其**漂移**。
派生常量以本文件为基准（可以本地改写，但必须在此登记原因）；快照原文不得改动。

## 1. 工具映射表（Cordis → opencode）

上游 STAGES/GLOBAL_SAFE 用 DSH（Cordis）工具名；plugin 注入文本与阶段文本使用 opencode 工具名。

| Cordis（上游） | opencode（本仓库） | 漂移原因 |
|---|---|---|
| read / glob / grep / web_search | read / glob / grep / websearch | opencode 命名 |
| ask_user_question | question | opencode 命名（ask 权限语义不同，勿混） |
| todo_write / exit_plan_mode | todowrite / （plan mode = Shift+Tab，无工具） | opencode 无 exit_plan_mode；plan 靠 UI |
| write / edit / str_replace_editor | write / edit / apply_patch | str_replace_editor → apply_patch |
| pwsh / bash | bash | 单一 shell（win 环境仍 bash 工具） |
| read_image / job_* | describe_image（仅展示）/ 无 | opencode 无 job 生命周期工具 |
| engram_* | 无 | DSH 专属记忆服务，不可移植（当前版本不注入 engram 文本） |
| dev_router_status / dev_router_mode | 同名 | 保留 |

## 2. 阶段工具表（STAGES，opencode 版，见 plugins/router-core.mjs 常量）

- 阶段0 Understanding: read glob grep websearch webfetch question
- 阶段1 Planning: todowrite（+ plan mode 提示）
- 阶段2 Development: write edit apply_patch
- 阶段3 Verification: bash
- GLOBAL_SAFE（生命周期常驻，当前版本全量 = 全工具；门控时收窄）：16 内置工具 + catalog/help/phase_begin/phase_advance/dev_*

## 3. 叙述文本漂移

- STAGE_GUIDES / PROGRESSIVE_DECL / PRESSURE_GUIDE / START_GUIDE：上游英文原义，工具名按映射表替换；中文翻译仅放 docs，不注入（未实测中英等价）。
- we-form 阶段文本（you-form 是 let me 吸引子——上游实测结论，保留）

## 4. 版本对齐冻结点

- 上游基线：dsh-router-standard origin/main @ 742b180（standard v0.7.4 clean rewrite，2026-08-22 fetch）
- 漂移规则：上游 core 纯函数可继续逐字节同步；bootstrap = 平台代码必然重写，仅作参考
- 防无限追赶：本仓库对齐冻结于 742b180；上游再演进需按 scripts/upstream/README.md「如何更新」流程重新评审
