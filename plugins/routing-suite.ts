import { type Plugin } from "@opencode-ai/plugin"
import { classicImpl } from "./lib/classic"
import { progressiveImpl } from "./lib/progressive"

/**
 * routing-suite v0.5.0 入口（薄转发）。
 *
 * 选路：
 *   OPENCODE_ROUTER_CLASSIC=1 → classic v0.3.1（三带分类 persona 路由，冻结回退）
 *   默认                     → progressive v0.5.0（渐进披露）
 *
 * 部署：本入口 + classic.ts + progressive.ts + router-core.mjs 需一起复制
 * 到 ~/.config/opencode/plugins/（见 README 安装一节）。
 */
export const RoutingSuitePlugin: Plugin =
  process.env.OPENCODE_ROUTER_CLASSIC === "1" ? classicImpl : progressiveImpl
