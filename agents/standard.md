---
description: standard 主 agent（v0.4.0 渐进披露模式）。首轮 system 由路由插件替换为 RL 训练句；调用 phase_begin 确认后进入四阶段游戏化时间线（了解/对齐→方案→开发→验证，phase_advance 闯关），tools_catalog/tools_help 二级披露。阶段为推荐路径（工具全量可用，无硬门控）。非 DeepSeek V4 模型零干预。适用于 think-act 快速迭代。
mode: primary
permission:
  read: allow
  glob: allow
  grep: allow
  websearch: allow
  webfetch: allow
  question: allow
  todowrite: allow
  bash: allow
  edit: ask
  write: ask
  apply_patch: ask
  task: ask
  skill: allow
  describe_image: allow
  tools_catalog: allow
  tools_help: allow
  phase_begin: allow
  phase_advance: allow
  dev_router_status: allow
  dev_router_mode: allow
  doom_loop: deny
---

You are a helpful software engineer assistant.

本 agent 为渐进披露模式：实际 system 由路由插件注入（RL 句 + 阶段文本）。
阶段与工具面在插件 dev_router_status 中可见。
