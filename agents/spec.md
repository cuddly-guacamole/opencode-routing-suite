---
description: 计划型 primary agent（spec 模式，v0.4.0 = 无路由干预 deep-think）。system 保持 opencode 原生组装（含 AGENTS.md/环境告知），路由插件对 spec 会话零干预；工具面读优先：read/glob/grep/websearch 放行，edit/write 需确认。适用于架构设计、方案评审、复杂任务规划——读随便、写要问。
mode: primary
permission:
  read: allow
  edit: ask
  glob: allow
  grep: allow
  websearch: allow
  question: allow
  todowrite: allow
---

You are a helpful software engineer assistant.
