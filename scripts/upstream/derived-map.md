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

## 5. 增量漂移记录（v0.4.0+，基线 7d0d1d3）

| 条目 | 上游 v1.15.0 | 本仓库处理 |
|---|---|---|
| delivery_check 交付门 | 验证阶段出口契约：file 存在/非空/UTF-8 + headless smoke → PASS 才可宣告交付 | 移植（无浏览器 smoke：opencode 无 dev_page_check，仅文件三验证）；见 plugins/lib/router-core.mjs verifyDeliveryPieces |
| 开发阶段文本 | re-read 契约 / write·edit 结果不整段打印 / 跨语言转义提醒 | 移植（run_code→bash·shell 措辞漂移） |
| 阶段预解锁/jump | two-tier pre-unlock + jump 语义（restrict 硬门控下） | 不移植（L0 无门控，pre-unlocked 无意义） |
| dev_page_check | 浏览器页面核查（headless smoke） | 不移植（opencode 无对应工具） |
| gitbash-executor | Git Bash 一等公民 win32 shell 服务（DSH preset 层） | 不移植（opencode bash 工具即 Git Bash） |
| run_code / presentation both | PTC code runtime 机制 | 不移植（DSH 专属） |
| pressure-sensor 插件 | v1.15.0 移除（泄压文本 PRESSURE_GUIDE 保留） | 本仓库本就只有文本（无传感器）→ 与上游最终形态一致，无需改 |
