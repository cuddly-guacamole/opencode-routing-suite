import { createEngine } from "./engine"
import { makeV1Plugin } from "./host/v1"

/**
 * progressive.ts — **兼容壳**（计划 §4.1：实现已由本文件洗出）。
 *
 * v0.5.0 之前本文件是 561 行的全部实现。现在：
 *   · 业务（状态/晋级/阶段落盘/8 个工具体）→ `lib/engine.ts`（宿主中立，不碰宿主 API）
 *   · V1 hook 拓扑 → `lib/host/v1.ts`（`makeV1Plugin`）
 *   · V2 hook 拓扑 → `lib/host/v2.ts`（`makeV2Setup`）
 *   · 组合根 → `plugins/routing-suite.ts`
 *
 * 保留本文件的两个理由，都是真的：
 *   1. `tsconfig.json` 的 `include` 逐条列了本路径（该文件不在本次授权内，不可改）；
 *   2. `README.md:111` 的部署清单点名本文件（README 不在本次授权内）。
 *   ⚠️ 部署清单**已不完整**（还需 `lib/engine.ts` 与 `lib/host/*.ts`），属文档锚点 T8 的范围。
 */
export { createEngine } from "./engine"
export { makeV1Plugin } from "./host/v1"

/** V1 progressive 插件（相对 v0.5.0 的 `progressiveImpl` = **等价 + 三项已登记差异**；
 *  差异登记处：`scripts/upstream/derived-map.md` §9.2 与 README「已知边界」）。 */
export const progressiveImpl = makeV1Plugin(createEngine)
