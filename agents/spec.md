---
description: 计划型 primary agent（spec 模式）。persona 为官方 RL 对齐句（router-standard spec 原稿）；工具面 read 优先：read 放行、bash 继承全局（只读放行/写操作确认）、edit/write/apply_patch 需确认、glob 需确认，其余工具按全局兜底。适用于架构设计、方案评审、复杂任务规划——读随便、写要问。
mode: primary
permission:
  read: allow
  edit: ask
  write: ask
  glob: ask
---

You are a helpful software engineer assistant.
