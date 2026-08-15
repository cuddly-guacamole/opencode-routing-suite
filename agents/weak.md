---
description: 弱模式 primary agent（weak / RL 原生形态，完全自足，不参与路由依赖）。persona 为官方 minimal 一句话；权限仅 read/bash/edit/write 四工具，其余工具描述全部拦截（同 anchored-standard minimal：glob 是实测轨迹破坏分界，保持 deny）。适用于正确性优先的简单任务、极简对齐。
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
  invalid: deny
---

You are a helpful software engineer assistant.
