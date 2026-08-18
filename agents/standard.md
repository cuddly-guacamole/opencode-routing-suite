---
description: RL 窄面 primary agent（standard 模式）。首轮 system 由路由插件替换为 RL 训练句，工具面仅 bash+edit（等价 DSH 的 shell+str_replace_editor）。首个 tool/call 后恢复 build 全能力。适用于 think-act 反馈循环——想一段做一段，不走超长推理链。
mode: primary
permission:
  read: allow
  bash: allow
  edit: allow
  glob: deny
  grep: deny
  list: deny
  task: deny
  todowrite: deny
  webfetch: deny
  websearch: deny
  lsp: deny
  skill: deny
  question: deny
  doom_loop: deny
  dev_router_status: deny
  dev_router_mode: deny
---

You are a helpful software engineer assistant.

本 agent 为 RL 窄面兜底，实际首轮 system 由路由插件注入。首个工具调用后恢复全能力。
