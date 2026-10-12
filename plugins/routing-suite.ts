import { type Plugin } from "@opencode-ai/plugin"
import { createEngine } from "./lib/engine"
import { makeV2Setup } from "./lib/host/v2"

/**
 * routing-suite v0.6.0 入口 —— **双线共存**的混合形状（计划 §4.2.7，F8 已实测两侧都通过）。
 *
 * 一个 `default` 同时满足两个宿主：
 *   · V2（`@opencode/plugin@2.0.26+`，命令 `opencode2`）只认 `default` 且要求
 *     `id` + (`setup` | `effect`) —— `upstream/dev:packages/core/src/plugin/module.ts:78-91`
 *     的 `Module` schema 是严格 `Schema.Struct`，`{id, setup}` 通过、
 *     `{...define({id,setup}), server(){}}` **也通过**（本机 Effect 实跑，见证据文件）。
 *   · V1（`@opencode-ai/plugin` ≤1.19.0）的 `readV1Plugin(mode="detect")` 见 `server` 键
 *     即取 server 分支 —— `origin/dev:packages/opencode/src/plugin/shared.ts:272`。
 *
 * ⚠️ **V1 专有模块必须惰性加载**（R6 修）：`classic.ts` 与 `host/v1.ts` 都从
 * `@opencode-ai/plugin` **取值**导入 `tool`。V2 的加载器要**先解析整个静态模块图**、
 * 再读 `default.id` ⇒ 若在顶层静态 import 它们，**没装 V1 SDK 的 V2 用户会整条加载失败**
 * （实测：`Cannot find module '@opencode-ai/plugin' from …lib/classic.ts`，对应真运行时
 * `plugin list` 显示 `No plugins found` + server log 一条 WARN）。
 * 故这两个模块只在 `server()` 被**真正调用**时 `await import()`。
 * 于是 V2 的静态模块图 = `engine` + `host/v2` + `router-core` + `zod`，**不含 V1 SDK**。
 *
 * ⚠️ `define` 未 import：`@opencode/plugin` 的 `define` 是**恒等函数**
 * （`dist/promise/plugin.js`：`export function define(plugin) { return plugin }`），
 * `{...define({id,setup}), server}` 与下面的字面量**逐字节等价**。本包是 V1 依赖方，
 * 引入 V2 SDK 会强制 V1 用户也拉 2.0.26，故不引入。
 *
 * ⚠️ **只导出 `default`**：V2 只认 `default`；V1 的 `getLegacyPlugins` 遍历 `Object.values`
 * 也认（但它只在 `readV1Plugin` 的 detect 分支返回空时才跑）。多导出一个同值命名导出
 * 会让 V1 侧出现两个注册源，故不留。
 *
 * 组合根职责：本文件是**唯一**知道「两个宿主 + 一个引擎」的地方，引擎由这里注入给两个适配器
 * （原因见 `plugins/lib/host/contract.ts` 的 `CreateEngine` 注记）。
 */

const PLUGIN_ID = "opencode-routing-suite"

/**
 * V1 侧：`OPENCODE_ROUTER_CLASSIC=1` → classic v0.3.1（三带分类 persona 路由，冻结回退）。
 *
 * `server` 本就是 `async` ⇒ 惰性 `import()` **不改变 V1 侧的对外形状**：
 * `readV1Plugin` 只要求 `typeof value.server === "function"`，`async` 函数满足；
 * `getLegacyPlugins` 也只看 `typeof === "function"`。两条都已实测（见证据 §4.2）。
 */
const server: Plugin = async (input, options) => {
  if (process.env.OPENCODE_ROUTER_CLASSIC === "1") {
    const { classicImpl } = await import("./lib/classic")
    return classicImpl(input, options)
  }
  const { makeV1Plugin } = await import("./lib/host/v1")
  return makeV1Plugin(createEngine)(input, options)
}

/** V2 侧：classic 不进缝（计划 §4.2.8）——`makeV2Setup` 见该变量会打日志并回退 progressive。 */
const setup = makeV2Setup(createEngine)

export default { id: PLUGIN_ID, setup, server }
