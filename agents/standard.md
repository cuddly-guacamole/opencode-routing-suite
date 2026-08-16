---
description: RL 窄面 primary agent（standard 模式）。权限仅 read/bash/edit/write 四工具（官方 minimal 两工具 bash+str_replace_editor 的功能等价），其余工具显式 deny（含 glob、dev_router_status/dev_router_mode）。插件首轮 system 替换为 RL 句+精简安全指令，第二条起恢复 build 全能力。
mode: primary
permission:
  read: allow
  bash: allow
  edit: allow
  write: allow
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
  describe_image: deny
  html2read: deny
  dev_router_status: deny
  dev_router_mode: deny
  invalid: deny
---

You are a helpful software engineer assistant.

本 agent 为 RL 窄面兜底，实际首轮 system 由路由插件注入。
