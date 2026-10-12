# 派生常量 + 漂移记录（契约 3.4 补充）

快照是"上游原文"；本文件记录从快照**派生**进本仓库的常量及其**漂移**。
派生常量以本文件为基准（可以本地改写，但必须在此登记原因）；快照原文不得改动。

## 1. 工具映射表（Cordis → opencode）

上游 STAGES/GLOBAL_SAFE 用 DSH（Cordis）工具名；plugin 注入文本与阶段文本使用 opencode 工具名。

| Cordis（上游） | opencode（本仓库） | 漂移原因 |
|---|---|---|
| read / glob / grep / web_search | read / glob / grep / websearch | opencode 命名 |
| ask_user_question | question | opencode 命名（ask 权限语义不同，勿混）。⚠️ **`question` 只在宿主交互态可见**：非交互 `opencode run` 下**必然**被会话级 ruleset 覆盖为 deny，从而从请求的 tools 数组里被移除（机制、锚点与实测见 **§8 的"`question` 可见性"行**）。⇒ **"工具名是 `question`"普遍成立；"它当前可被调用"只成立在交互态** |
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

- STAGE_GUIDES / PROGRESSIVE_DECL / PROACTIVITY_GUIDE（上游常量名仍为 PRESSURE_GUIDE）/ START_GUIDE：上游英文原义，工具名按映射表替换；中文翻译仅放 docs，不注入（未实测中英等价）。
- we-form 阶段文本（you-form 是 let me 吸引子——上游实测结论，保留）

## 4. 版本对齐冻结点

**两个"基线"必须分开记，勿混**（2026-08-26 起）：

- **快照来源 commit = `b39112d`**（standard v1.27.0，2026-08-26 重快照）：本目录两份 .mjs 的字节出处。
  区间 00c81b1→b39112d 中 `router-core.mjs` **逐字节未变**（sha256 `544c12c6…`，9900 B）→ 文件未动、只前移来源 commit；
  `router-bootstrap.mjs` 96690→84429 B（行级 +282/−559），按 README 步骤 2-4 重快照（`git show` → `cp` → `cmp -s`）。
- **实现面 = v1.18.0→v1.28.0 的**可移植子集**（v0.5.0 起落地）**：§7.1 逐条裁决、§7.4 施工单、§8 落地与漂移。
  v0.5.0 之前该行写"实现冻结点 = `00c81b1`"——那个表述**从 v0.5.0 起不再准确**（I1–I8 已实现），故改为按"可移植子集"记；
  仍**未**移植的是 §7.1 里判"不可移植/部分可移植的机制面"与 §7.2 剔除清单里的指名。
- 漂移规则：上游 core 纯函数可继续逐字节同步（本次区间 core 零变化）；bootstrap = 平台代码必然重写，仅作参考。
- 防无限追赶：上游再演进需按 scripts/upstream/README.md「如何更新」流程重新评审。
- `plugins/lib/router-core.mjs` 的 `UPSTREAM_BASELINE` 与 `package.json` 的 description 均已同步该双基线口径
  （快照来源 + 已移植的语义范围），不再单写 `@00c81b1`。

## 5. 增量漂移记录（v0.4.0+，基线 7d0d1d3）

| 条目 | 上游 v1.15.0 | 本仓库处理 |
|---|---|---|
| delivery_check 交付门 | 验证阶段出口契约：file 存在/非空/UTF-8 + headless smoke → PASS 才可宣告交付 | 移植（无浏览器 smoke：opencode 无 dev_page_check，仅文件三验证）；见 plugins/lib/router-core.mjs verifyDeliveryPieces |
| 开发阶段文本 | re-read 契约 / write·edit 结果不整段打印 / 跨语言转义提醒 | 移植（run_code→bash·shell 措辞漂移） |
| 阶段预解锁/jump | two-tier pre-unlock + jump 语义（restrict 硬门控下） | 不移植（**V1 上无阶段化门控**，pre-unlocked 无意义；V2 上虽有门控但只锁写入面、不取预解锁窗口，见 7.0 术语与 §7.5 U8） |
| dev_page_check | 浏览器页面核查（headless smoke） | 不移植（opencode 无对应工具） |
| gitbash-executor | Git Bash 一等公民 win32 shell 服务（DSH preset 层） | 不移植（opencode bash 工具即 Git Bash） |
| run_code / presentation both | PTC code runtime 机制 | 不移植（DSH 专属） |
| pressure-sensor 插件 | v1.15.0 移除（泄压文本 PRESSURE_GUIDE 保留） | 本仓库本就只有文本（无传感器）→ 与上游最终形态一致，无需改 |

## 6. 增量漂移记录（v0.4.1，基线 00c81b1 = standard v1.17.1；区间 v1.14.0→v1.17.1 六提交）

| 条目 | 上游（版本出处） | 本仓库处理 |
|---|---|---|
| 泄压 → 主动性自检终审 | PRESSURE_GUIDE 内容整体替换为 Proactivity 自检；v1.17.0 用户终审：传感器退役、注意力优化即泄压、段名 router-pressure→router-proactivity | 移植文本原义；常量更名 **PROACTIVITY_GUIDE**（上游名与内容已脱节，本地用真名——登记漂移）；注入面 system.transform + phase_begin 双同步 |
| PROGRESSIVE_DECL 扩写 | meta 工具全列（含 delivery_check）/ 去 "48+" 硬编码 / native 直调措辞 / proactivity 协议入声明（v1.13→v1.17） | 结构逐句移植；剔除 DSH 专属引用（run_code/SDK/goal tools/dev_page_check/dev_reload_preset_live）；"只注入当前阶段工具"改为诚实措辞——**门控默认关**（V2 上 opt-in 才收窄、且只锁写入面；V1 上无此能力）⇒ 默认态下所有工具真实在 wire 上，不谎称注入期隐藏 |
| 单一事实源阶段文本 | stageText 接收 runtimeCallable 真值 + muted 参数，锁定句只有一条路径；『交付后』标记→『未解锁』（v1.14/v1.15/v1.17.1） | 未移植锁定句/目录阶段标记：门控**默认关**（V1 上更是无此能力）时标"未解锁"即谎报运行时事实（违背标记=运行时真相原则）；stageText 保持 we-form + 推荐路线措辞，交付阶段追加证据门提示行 |
| delivery evidence 门禁 | requireSmoke 默认不可绕过（v1.14）+ evidence 清单 schema（kind ∈ file/page/image/run/test/text）+ external 一等公民、page 类 ≥1 reviewed 视觉证据（v1.16） | 移植为纯函数 **validateDeliveryEvidence**（kinds 含 external；run/text 必带 result；视觉类必须 reviewed:true；page 类可要求 ≥1 reviewed 视觉）；headless-smoke 项不适用（无浏览器工具），其"防绕过"精神由 evidence 必填承担；delivery_check 新增 evidence 必填参数 |
| phase_begin 跨代兼容修复 | guided 缺失但 stage>0 的旧会话视为已开启——只补标记不重注入 bootstrap（v1.17.1；user #1/#2「3/3 yet phase-0 injected」根因回归测试） | 移植为纯函数 **beginPhase**：confirmed 且恢复 stage>0 → repair（保留进度返回当前阶段状态）；stage=0 已确认 → duplicate 不重复引导；配同根因回归测试 |
| memoryMuted | 会话用户消息命中"不用记忆/no memory"→ 调用面+注入面双双剔除 engram 引导（v1.15 #4） | 不移植：本仓库从不注入 engram 记忆文本，无可静音面（映射表 engram_* 行已载） |
| 描述/版本单源 | DESC 常量 + ROUTER_VERSION（v1.13 审计模式；main 注册与 shim 读同一份） | 单源思想移植为 **DESC** 五件套（toolsCatalog/toolsHelp/phaseAdvance/routerStatus/deliveryCheck）；PLUGIN_VERSION + UPSTREAM_BASELINE 进 dev_router_status；无 shim 层故无需双源合一 |
| dev_page_check 机制族 | WebGL flag 修正/lite 单帧/retry 默认开+降分辨率/单飞锁诊断+10min 回收/截图落会话 cwd/相对路径 base=workspace/失败诊断文案（v1.14–v1.16） | 不移植（工具本体未移植）；external-validator 兜底思路体现在证据门禁 kind=external |
| presentAs('native') wire 收紧 | 注入面+调用面同时阶段化，SDK 段归零——39K 注意力税消失（v1.15 定案） | N/A：opencode 无 presentAs/PTC 层；注意力经济由 RL 句首屏 + 二级目录按需查询实现 |
| 状态持久化可靠性 | 根统一 DSH_HOME||homedir()/.dsh + load 非 ENOENT/save 失败日志化（不再静默） | 根路径本就统一 ~/.opencode/router-standard/；日志化移植（损坏文件告警并重建，不再静默吞） |
| stage0 验证档注解 | bash/pwsh/read_image 标注 [未解锁]→[可调]→[全量]，非"交付后"；开发阶段 read_image 预解锁视觉检查引导 | 标记语义不移植（同上单真相条目）；本质保留为 stage0 guide 注释："verification tools come later in the route, not after delivery" |

> **读 §6 前请注意**（2026-08-26 补充，据 §7.3-6）：本表各行的"版本出处"（v1.14.0/v1.15.0/v1.16/v1.17.0/v1.17.1 …）是**上游自报标签**，
> 而 `@00c81b1:CHANGELOG.md` 当时只有 4 节（v1.10.0/v1.9.0/v1.8.0/0.3.0，无 v1.17.1 节）、`ROUTER_VERSION` 为 `'v1.15.0'`。
> 本表各行**均以 00c81b1 的代码为准**（例如 v1.17.1 跨代修复在 `@00c81b1:960-965`），故结论仍成立；但**不得**把上面的版本号当成"上游当时的版本戳"引用。

## 7. 增量裁决（v1.18.0→v1.27.0；快照区间 00c81b1→b39112d）

### 7.0 区间事实与锚点口径（先读这一节，否则表里的锚点读不懂）

- **区间 = `00c81b1..b39112d`，恰 3 个提交**（`git log --oneline 00c81b1..b39112d`）：
  `da5d35b`（纯文档：`docs/STANDARD-PLAN.md` 84/50）、`0cd9a46`（纯文档：`docs/STANDARD-PLAN.md` 1/1）、
  `b39112d`（代码 + 文档）。**只有 b39112d 动代码。**
- **代码面 diff（b39112d 一个提交内）**：`preset/router-standard/router-bootstrap.mjs` 96690→**84429** B（`git diff --stat` 841 行级，`+282/−559`）；
  `router-bootstrap-v34.mjs` 同步改到与前者**逐字节相同**（sha256 `152b9773…`）；`router-core.mjs` **逐字节未变**（sha256 `544c12c6…`，9900 B）。
  另：`agent.cordis.yml`（挂载改成 `router-bootstrap-v34.mjs?v=88`）、`preset.yml`（描述重写）、新增 `router-bootstrap-v34.selftest.mjs`、
  测试改 import 到 `-v34`、`docs/archive/` 归档 6 个历史 bootstrap（R100 纯改名）、新增 `probe/README.md`+`probe/cot-lexicon.md`+`AGENTS.md`+`scripts/sync-preset.cjs`。
- **锚点形式**：`bootstrap.mjs@b39112d:NNNN` 的行号 = 本目录 **`scripts/upstream/router-bootstrap.mjs` 的同号行**
  （2026-08-26 已按 README 步骤 2-4 逐字节重快照到 b39112d，`cmp -s` 通过）。上游版本号**不是 git tag**，只能靠 `CHANGELOG.md` 文本归属。
- **口径**：**以代码为准**。CHANGELOG 只用于理解意图与版本归属，**不得作为"实现如此"的依据**。
  凡只有 CHANGELOG 支撑、代码里找不到对应物的，一律标【未验证】并写清缺什么。
- **实测装置**（本轮真跑，命令与输出见证据文件）：把 b39112d 的两个 blob 从 git 对象取到隔离目录，
  `import()` 上游模块**直接执行**其纯函数（`windowFor`/`preUnlockedFor`/`stageInfo`/`catalogMarkExtra`/`helpUnlockLine`/
  `markerFor`/`autoAdvance`/`firstUserTask`/`deliveryCheck`）。下文凡标「实测」的读数都出自这一装置，不是阅读推断。
- **判定口径**（沿用本仓库既有先例，不新创）：**可移植** = 纯函数／纯文本且 opencode 有等价运行面；
  **部分可移植** = 原则或措辞可移植、机制不可移植（写明留哪些、弃哪些）；**不可移植** = 依赖 DSH/Cordis 平台面；
  **纯文档** = 只改上游自己的 docs，对我方无动作。
- **术语·"门控"必须说准（T8 复核修正；T8 后按 U8 重裁再修正，2026-10-12）**：本表与 §5/§6 里的"无门控"一律指
  **"V1 上无*阶段化*门控"**——即 V1 宿主无法在会话进行中按阶段开合"请求里暴露给模型的工具集合"。这句话**不等于**
  "opencode 没有真隐藏"：
  ⚠️ **本段曾把它当成 opencode 的**整体**平台事实——该写法已作废**：它**只在 V1 上成立**。
  **V2 有这条能力**（`SessionContext.tools` 可变，见 §7.5 的 U8 行重裁），故本文件所有"无*阶段化*门控"（V1 口径）
  的存量表述**一律读作"V1 上无阶段化门控"**（含 §7.1 各行的"我方无阶段化门控面"）；引用时须写成「**V1 上无阶段化门控；V2 上有，默认关，且只锁写入面**」。
  以下三条是这句话的支撑面：
  - **静态真隐藏是存在且已被本项目自己实验实证的**：agent 文件写 `permission: <tool>: deny` 后模型全程不尝试该工具、
    `tool.execute.before` 零记录——本仓库 `README.md` 自己记着这条裁决（`tool.ids` 枚举 ✅ / deny=请求级移除 ✅ /
    config.update 中断消息 ⚠️）；该 TODO 至今**未接线到 stage**。⚠️ **本行按作者自查更正**（原文误作"`agents/*.md` 目前只有 `allow`，无 `deny`"）：
    权限块里 **`allow`/`ask`/`deny` 三种都在用**——`agents/standard.md:4-25` 是 16×`allow` + 5×`ask`（`edit`/`write`/`apply_patch`/`task` 为 ask）+ **1×`deny`（`doom_loop`，`:25`）**；
    `agents/spec.md:4-11` 是 6×`allow` + 1×`ask`。**准确的说法是**：静态 deny 的**用法已经存在**，但**没有任何一条 deny 是按 stage 映射的**（`doom_loop` 是循环保护，与阶段无关）⇒ stage→静态 deny 的接线仍未做。
  - **V1 上会话中动态改可见面确实没有替代面**（T8 复核判定 + 就地核对本仓库依赖 `@opencode-ai/plugin@1.18.21` 的
    `node_modules/@opencode-ai/plugin/dist/index.d.ts`）：`Hooks` 接口共 **15 个钩子**（`chat.message`/`chat.params`/`chat.headers`/`permission.ask`/
    `command.execute.before`/`tool.execute.before`/`shell.env`/`tool.execute.after`/`experimental.chat.messages.transform`/`experimental.chat.system.transform`/
    `experimental.provider.small_model`/`experimental.session.compacting`/`experimental.compaction.autocontinue`/`experimental.text.complete`/`tool.definition`），
    **没有任何一个能增删请求里的工具集合**：`tool.definition` 的 output 就是 `{description: string; parameters: any}`（只能改字、不能隐藏）、
    `permission.ask` 的 output 是 `{status: "ask" | "deny" | "allow"}`、两个 transform 只改文本、加载期配置只在启动时生效。
    **⇒ 该段结论对 V1 仍然成立**（V1 无等价面），对 V2 已被 U8 重裁推翻。
  - **V2 有这条能力（U8 推翻条件命中，2026-10-12）**：V2 的 `SessionContext.tools` 是可变字段
    （`@opencode/plugin` 的 `promise/session.d.ts:29-35`：`tools: Record<string, {description, input}>`），
    hook 改完后由 `packages/core/src/session/model-request.ts:264-274` **按名单重建请求里的工具集合**
    （`given.get(d) ?? byName.get(name)`，对不上身份也对不上键的条目被丢弃），
    `hooks.trigger("session","context", {…draft, agent, tools})`（`:420-425`）把 `tools` 交给 hook。
    ⇒ 删掉 `event.tools` 里未解锁的键 = 请求面收窄。**该面已在真 V2 运行时实测**（见 §7.5 U8 行）。
- **旗标约定（T8 复核修正）**：【未验证·端点不存在】= 该内容在两**端点**（`00c81b1` / `b39112d`）的代码里都找不到对应物，
  只有 CHANGELOG 文本支撑；【未验证·端点不可观测】= 内容可能是真的（同区间先加后删的中间态），但两端点都取不到形态。
  **带旗标的条目不得作为实现依据。**

### 7.1 逐版本裁决表

| 版本 | 上游做了什么（含锚点） | 我们的落点（文件:行/函数名）或"不移植" | 判定 | 理由 |
|---|---|---|---|---|
| **v1.18.0** 注意力盲区版 | ① catalog 默认面收敛：无 query 时过滤掉 `mark==='未解锁'`（`bootstrap.mjs@b39112d:838`，注释 `// v1.18 注意力盲区`；shim 版 `:972`）——**这半条已验真**。⚠️ 同一 CHANGELOG 小节 ① 里的"`all:true` 显式全量"**无端点对应物**【未验证·端点不存在】：`all:true` 字面量在 `@00c81b1` 与 `@b39112d` 各 **0 次**，两端点 `tools_catalog` 参数都只有 `query`/`domain`（`@00c81b1:1017`/`:1207`、`@b39112d:826`）。② 阶段文本去否定式：旧句 `Not yet callable (until delivery): every tool NOT in the Callable-now list stays locked`（`@00c81b1:159`）→ 新句 `More tools unlock with the next stage — browse on demand: tools_catalog(query) (single-point whitebox)`（`:249`）。③ level-up 技能卡：`phase_advance` 返回 `New this stage:` + 每工具一句≤46 字摘要（`:812-818`）。④ `tools_help` 白盒层级化：`helpUnlockLine`（`:161-166`，调用点 `:861`）。⑤ 自动初始化：`sessionFresh()` 判 `request/header reason==='initial'`（`:184-191`）→ `phase_begin` 命中即重置为 `{stage:0,guided:true}` 并重注入（`:728-733`）。⑥ STAGE_GUIDES 压成 2–4 行【未验证·端点不可观测】（`@b39112d:120-123` 是四条超长单行，压缩后的形态取不到，见 U4） | ① 不移植（**V1 上无阶段化门控**，见 7.0 术语；⚠️ **本行判定已按 U8 重裁改判为「部分可移植·未接线」，见 §7.5 重裁表**——以下原文保留作历史），`tools_catalog` 没有 stage 标记这个概念——`progressive.ts:379-395` 只列名字+静态摘要；且 `unlockedFor` 恒等于 `GLOBAL_SAFE`，`router-core.mjs:139-143` ⇒ 没有"未解锁"可过滤）；**措辞**落点 `router-core.mjs:198` `DESC.toolsCatalog`。<br>② 已等价：我方 `stageText` 本就用"推荐路线"而非否定式（`router-core.mjs:154`）。<br>③ 落点 `plugins/lib/progressive.ts:314-317`（`phase_advance` 返回串）——**只做 `New this stage` 一行**，"Pre-unlocked" 行见 v1.18.1 行的死代码说明。<br>④ 落点 `progressive.ts:397-409` `tools_help`（已有 `phase:` 归属行）；可补"请指出工具分配问题而不是寻求绕过"句。<br>⑤ 不移植（绑 DSH `session.events` 事件流）；**语义等价物**已存在：`router-core.mjs:173-179` `beginPhase`。<br>⑥ 仅取"本阶段做什么/验收标准"两段式，文本见 v1.20/v1.22 行 | **部分可移植** | 措辞（③④⑥）可移植且在 opencode 有落点；机制（①⑤）依赖 restrict 门控与 DSH 事件流。②④ 我方已有等价物，属"零动作" |
| **v1.18.1** 公告分组 · 全量标注 · 口径统一 | ① `phase_advance` 技能卡分两行 `New this stage:`（`:817`）/ `Pre-unlocked (already callable):`（`:818`）。② 默认目录预放标记：`catalogMarkExtra` 的 `（预放）` 分支（`:152-159`，`mark==='可调' && preUnlockedFor(stage).includes(name)`）。③ 全量图鉴 100% 标注。④ 口径统一：先装 meta shim 再渲染 `stageText`（`:652-656`）。⑤ 新增 helper `stageInfo`/`preUnlockedFor`/`catalogMarkExtra`/`helpUnlockLine`（`:136-166`） | ① 见 v1.18.0③行。② **不移植且必须知道它是死代码**：`preUnlockedFor(stage)`（`:143-149`）在 `windowFor = stage+1`（v1.20）下恒为空数组——**实测** `preUnlockedFor = [[],[],[],[]]`（4/4 阶段全空）⇒ `（预放）` 标记与 `Pre-unlocked` 行在 b39112d 上永不触达。③ **【未验证·端点不存在】"全量图鉴 100% 标注"**：该措辞是 CHANGELOG v1.18.1 小节标题原话，其机制依赖 `tools_catalog(all:true)`，而 `all:true` 字面量在两端点各 **0 次**（`@00c81b1:1017`/`:1207`、`@b39112d:826` 参数只有 `query`/`domain`）⇒ 见 v1.18.4/v1.18.5 行，**不得作为实现依据**。④ 无对应面（我方 `system.transform` 单点渲染，无 meta shim 双层）。⑤ 只需 `stageInfo` 语义：我方 `progressive.ts:403-407` 已用 `STAGES.findIndex` 内联该判定 | **部分可移植** | ①②③ 的机制（预放窗口、全量出口、shim 双源）在**V1 的无阶段化门控面**上无意义（V2 上有门控面，见 7.0 术语与 §7.5 U8）；`New this stage` 一行可移植到 `phase_advance` 返回串 |
| **v1.18.2** P0 减漂移 | ① `windowFor(stage)` 成窗口单一事实源（`:113`），`stageSummary`(`:129`)/`buildStagedSdk`(`:259`)/`markerFor`(`:357`)/`applyStageRestrict`(`:574`) 全部收敛到它。② 常量派生 `STAGE_SAFE = STAGES.flatMap(...)`（`:93`）、`GLOBAL_SAFE` 由它展开（`:94-102`）。③ `stageText` 非交付阶段输出 `Core:` + `Pre-unlocked (already callable):` 两行（`:246-248`）。④ `phase_begin` 引导取真实 `runtimeCallable` 而非静态回退（`:739-740`、`:771-773`） | ① 不移植（`windowFor` 是 restrict 窗口；**实测** `windowFor=[1,2,3,4]`）。② **已等价**：我方 `GLOBAL_SAFE`（`router-core.mjs:123-128`）本就是单份常量，`unlockedFor`（`:139-143`）由 `STAGES`+`GLOBAL_SAFE` 派生，无三处手抄。③ 我方 `stageText` 用 `Phase tools:` 一行——语义等价，无需改。④ 无对应面（我方无运行时"可见面"概念，工具恒全量上 wire） | **不可移植** | 四条全部是"门控面"的减漂移重构；**V1 上无阶段化门控面** ⇒ 无落点（**V2 上判定已按 U8 重裁改为「部分可移植」，见 §7.5 重裁表**）。唯一可带走的是"常量单源"这一纪律，我方已满足 |
| **v1.18.3** 综合评审修复 | ① `delivery_check` 补 `kind='external'`（`:452` 的 `ALLOWED` 集合）并把手写 `toJsonSchema` 升级为**递归**（`:34-35` `properties`/`items`；旧版扁平见 `@00c81b1` 的 `toJsonSchema`）。② own-first 索引：`registryFullIndex` 先 `ls.peek(scope)`（`:314-317`）。③ `memoryMuted` 漏网：`phase_advance` 卡分栏套 `muteAwareList`（`:810-811`）。④ 分类单源 `categorizeDomain`（`:168-176`，调用点 `:832`/`:963`）。⑤ 测试面=运行面：测试改 import `-v34`（`router.test.mjs:11`、`router.integration.test.mjs:24-25`，均带 `// v1.18.3` 注释） | ① external **已在 §6 完成**（`router-core.mjs:258` `EVIDENCE_KINDS` 含 `external`）。**递归 toJsonSchema 无对应面**：我方工具参数用 zod 声明（`progressive.ts:301`/`326-335`），schema 由 opencode 生成，不存在手写扁平化代码。② 无对应面（我方目录来自 `client.tool.ids()`，`progressive.ts:456-464`，无层链/own-layer 概念）。③ **不移植**（§6 已裁：我方从不注入 engram 文本，无可静音面）。④ 无对应面（我方 `tools_catalog` 无 domain 参数）。⑤ 我方已有等价纪律（单一插件文件 + `test/router-core.test.mjs` 直测 `router-core.mjs`） | **部分可移植** | 五项里 ① 的一半有落点且**已完成**；②④⑤ 无对应面；③ 已裁不移植 |
| **v1.18.4** P1 lastAdvance 闭环 | ① `lastAdvance:{at,reason}` 落盘 + 读回（`:545` 读、`:692` auto 记、`:804` 显式记）+ `dev_router_status` 展示（`:894`、shim `:1010`）。② `all:true` 汇总头 `N tools: C callable · M meta · L stage-locked · H host`。③ host 标注细分"宿主·交付期"/"宿主·常驻"（`:155-156`、`:165`） | ① **可移植（有真实落点）**：我方 `progressive.ts:141-156` `saveStage` 只存 `{stage,confirmed}`；`phase_advance` 的 `args.reason`（`:301`）**当前被接收但从未记录**——移植 = 在状态里加 `lastAdvance:{at,reason}` 并在 `dev_router_status`（`:412-430`）加一行"我为什么在第 N 阶段"。② **端点不存在**：`@00c81b1` 与 `@b39112d` 的 `tools_catalog` 参数都只有 `query`/`domain`（`:826`），无 `all`——该特性在 v1.18.1 加入、v1.18.5 删除，**在同一区间内净零**。③ 不移植（"阶段锁定/host 分层"是门控面概念） | **部分可移植** | ① 是纯状态记录，opencode 有完全等价面（`states.json` + status 工具），且能顺手修掉"`reason` 收了却丢掉"的现有缺口；②③ **V1 上无阶段化门控面**（V2 上有，见 7.0 术语） |
| **v1.18.5** 删除 all:true | `tools_catalog(all:true)` 全量出口删除；`DESC.toolsCatalog` 改为"无全量出口——严格按阶段推进，未解锁工具名称不进入视野"（`:60`）；参数表确认无 `all`（`:826`） | 不移植。我方 `DESC.toolsCatalog`（`router-core.mjs:198`）本就无 `all` 参数，`tools_catalog` 也无 `all`（`engine.ts:422`）。`TOOL_SUMMARIES` 是静态单级摘要，无"全量出口"可关 | **部分可移植**（**U8 重裁后**） | 我方 `tools_catalog` **恒无 `all` 出口**（该出口我方从未有，上游自己 v1.18.5 也删了它）⇒ 这一半仍不移植。但"**恒为全量面**"那句**已随 U8 重裁作废**：V2 + `OPENCODE_ROUTER_GATE=1` 下阶段 0/1 无写入面 ⇒"目录默认面不必铺满"这条纪律有了真实落点（`engine.ts:423-435` 仍未接 stage 标记，见 §7.5 重裁表 v1.18.0 行） |
| **v1.19.0** 严格 workflow：完成信号驱动晋级 | ① `autoAdvance` **重写为完成信号驱动**（`:513-525`）：0→1 `ask_user_question`/`todo_write`/`exit_plan_mode`；1→2 `todo_write`/`exit_plan_mode`；2→3 `delivery_check`。**删掉"工具名/文本即跳级"**（旧实现见 `@00c81b1` 的 `autoAdvance`：`STAGES.findIndex` 跳级 + `写一个/创建/生成/实现/构建/build/create…` 文本正则 + `todo_write→1`）。② 阶段 0 强制对齐：`STAGE_GUIDES[0]` 收尾 `No alignment, no advancement.`（`:120`）。③ `phase_advance` 保留为显式闯关 | ① **可移植（硬项，且是我方最大缺口）**：我方 `router-core.mjs:159-167` `advanceStage` **就是上游删掉的那一版语义**（`names.includes('todowrite')` 或 `names.includes('task')` + `write/edit/apply_patch→2` + `bash` 或 `/verif…finished…done/i` 文本正则 → 3）。**实测上游新语义**：`autoAdvance(0,['write'])=0`、`autoAdvance(0,['edit'],'开始开发 创建实现')=0`、`autoAdvance(1,['edit'])=1`、`autoAdvance(2,['bash'])=2`、`autoAdvance(0,['todo_write'])=1`、`autoAdvance(2,['delivery_check'])=3`。② 落点 `router-core.mjs:132` STAGE_GUIDES[0]（我方现无对齐硬句）。③ 我方 `progressive.ts:299-319` 已有显式 `phase_advance`——保留 | **可移植** | **纯逻辑**，无平台依赖：入参就是"本阶段以来的工具调用名集合"，opencode 侧完全可得（`chat.message`/`messages.transform` 的 `output.parts[].tool`）。⚠️ 我方 `advanceStage` 目前**在生产代码里没有调用者**（`grep -rn advanceStage plugins/` 只命中定义与测试）——移植必须同时决定"接上自动推进"或"只同步文本语义" |
| **v1.19.1** 引导 > 打回 | ① 任务回显：`firstUserTask()` 遍历 `session.events` 里 `e.type === 'user/message'` 的条目，取 `const src = e.data?.source ?? e.data?.message?.source` 后只要 **`src?.kind === 'user'`** 的那条（**不是**直接读 `e.data.source.kind`；数据面是 `session.events`，`:208-219`），>160 字截断加 `…`，`stageText` 输出 `Task: <…>`（`:227`，调用点 `:656`/`:740`/`:773`）。**实测** 200 字输入 → 长度 161（160+省略号）。② `→ Done? …` 每关收尾（`STAGE_GUIDES[0]`:120、`[1]`:121、`[2]`:122；`:123` 是末关不带）。③ `Next goal: <阶段名> — complete it via its completion signal (…)` （`:819`、shim `:1037`）。④ 引导而非打回：未解锁工具给"请指出工具分配问题（调整 STAGES），而不是寻求绕过"（`:164-165`） | ① 落点 `router-core.mjs` 新增纯函数 `firstUserTask(text)`（我方首条用户文本已存在：`progressive.ts:49` `firstUserText` Map、`:184` 写入）+ `stageText(stage, taskText)` 增 `Task:` 行。② 落点 `router-core.mjs:131-136` `STAGE_GUIDES` 各行尾。③ 落点 `progressive.ts:314-317`。④ 落点 `progressive.ts:397-409` | **可移植** | 四条全是文本 + 一个纯函数；**无需任何平台面**。① 的"只认 `src.kind==='user'`"在我方对应"只认真实用户消息、不认插件注入"——我方 `firstUserText`（`progressive.ts:184`）也正是只从 `chat.message` 的真实用户文本里取，恰是同一语义；**实现者不要去找 `session.events` 那个面**（opencode 侧不存在），用现成的 `firstUserText` 即可 |
| **v1.20.0** 取消预解锁：每阶段只看当下 | ① `windowFor(stage)` 由 `stage+3` 改 `stage+1`（注释 `:109-112`，实现 `:113`；旧 `Math.min(stage + 3, …)` 见 `@00c81b1` 的 `stageSummary`/`buildStagedSdk`/`applyStageRestrict`）。② `STAGE_GUIDES` 重写为"本阶段做什么 + 验收标准 + 道德引导（做扎实、后面的工具不用急）"（`:119-124`）。③ `toolsCatalog`/`phaseAdvance` 描述去掉"预放"字样（`:60`/`:62`）。④ 机制框架 `windowFor`/`preUnlockedFor`/`stageSummary`/`catalogMarkExtra` **保留**以便回退 | ① 机制不移植（我方无 restrict 窗口）。② **文本可移植**：落点 `router-core.mjs:131-136`；要点是"只说当下这三件事"，**且不预告后续工具**。③ 落点 `router-core.mjs:198-201` `DESC.toolsCatalog`/`DESC.phaseAdvance`。④ **不移植且要登记为反例**：上游保留的四件里 `preUnlockedFor` 是死的（**实测**恒 `[]`），`（预放）`/`Pre-unlocked` 是死分支——照抄"预放"概念会照抄一个永不触达的分支 | **部分可移植** | 哲学（注意力只给当下）与阶段引导结构可移植；预放窗口机制在 opencode 无宿主。**附带必读**：上游 v1.20 与 v1.18.1 组合后自废了 v1.18.1 的一半公告语义——这是"机制保留但不使用"的漂移样本 |
| **v1.21.0** dev_page_check 截图清理 | `pageCheckRunOnce` 生成新截图后按 mtime 只保留 `.dsh-shots` 最近 12 张；新增 `readdirSync`/`rmSync` import（CHANGELOG v1.21.0） | 不移植（工具本体未移植，§5/§6 已裁）。**代码锚点只余遗留物**：`bootstrap.mjs@b39112d:23` 的 `readdirSync, rmSync` import——**v1.23 删函数时没删 import**，**实测** 全文件 0 个使用点（`grep -n readdirSync` 与 `grep -n rmSync` 各只命中 `:23` 这处 import） | **不可移植** | ①本平台无 `dev_page_check`；②**该版本的机制在两个端点上都不存在**（v1.21 加入、v1.23 删除，同区间净零）⇒ 连"上游最终态"都无从引用。登记为"端点不可验证 + 上游自身遗留死 import" |
| **v1.22.0** 防局部最优引导 | `STAGE_GUIDES[2]` 增补 `**Avoid local-optima (v1.22):**` 三段式——① 保持整体产物可用；② 同一细节多轮不收敛就退一步问"阻塞还是打磨"；③ 保留一个能工作的版本，顽固问题先完成其余再回头（`:122`） | **文本可移植**，落点 `router-core.mjs:134` `STAGE_GUIDES[2]`（开发阶段）。上游举例"finite-difference sign / conservation drift"是渲染任务绑定词，移植时留作"举例"或换通用表述（**登记漂移**） | **可移植** | 纯引导文本、无平台指涉；对应 opencode"开发阶段自检"面。⚠️ 与 §6"单一事实源"条目同源约束：`STAGE_GUIDES[2]` 已被"re-read 契约 / write·edit 结果不整段打印 / 跨语言转义"占用，需按序拼接而非覆盖 |
| **v1.23.0** 大道至简：删除自研 dev_page_check | ① 删工具本体 + page_check 函数族（`git diff 00c81b1 b39112d` 的 `@@ -320,316 +411,6 @@` 一块，约 316 行）。⚠️ CHANGELOG 自称"12 个 page_check 相关函数"，**与本 diff 实际不符**【未验证】：从 diff 消失的函数声明共 **14 个**（13 个 page 家族 + `safeStringify`：`pageRunnerPath`/`stripDomNoise`/`extractTitle`/`extractSelectorText`/`extractConsoleLines`/`runSandboxJs`/`normalizePageUrl`/`pageFail`/`pageCheckRun`/`forceTreeKill`/`pageCheckRunOnce`/`diagnosePageFail`/`pageCheckRender`），另有 `PAGE_BUSY_KEY` 常量；CHANGELOG 自己列的清单本身就是 14 项却写"12 个"。② `delivery_check` 不再自跑 headless smoke：传 `url` 时 `page-verify` **直接 FAIL** 并给出"用 bash 自测（headless Chrome/playwright）+ read_image(reviewed:true)"的指引（`:434-440`）。③ 引导改写为"verify with your OWN tools"（`:123` 阶段 3、`:72` `PROGRESSIVE_DECL`）。④ 删后残留：`:23` 死 import、`:105` `META_LIVE` 仍写 `'dev_page_check'`（**实测** `stageInfo('dev_page_check') = {kind:'meta'}`——上游自己没清干净） | **部分可移植——留"验结果不锁工具"精神，弃工具**：我方本就没有页面工具（§6 已裁），骨架面已在 `router-core.mjs:259-303` `validateDeliveryEvidence`（`requireReviewedVisual` 参数对应上游 `args.url` 分支，`progressive.ts:362` 对应 `page:true`）。**可移植措辞**：`DESC.deliveryCheck`（`router-core.mjs:204`）+ `STAGE_GUIDES[3]`（`:135`）增"用自己的工具验证（bash 跑截图 + 亲自看图 reviewed:true），不依赖固定页面工具"。（`:123` 的"门禁失败先做假设审计、代码本来就对就说对"那句属 v1.28 行，见下） | **部分可移植** | "门禁验结果、不锁工具"是平台无关原则且我方已具备骨架。⚠️ **实现期硬约束**：我方 `describe_image` 是**仅展示**（§1 映射表已载"仅展示"），**不能**充当 `reviewed:true` 的来源；移植这句措辞时必须写清"reviewed = 亲自看图"，否则等于给对方一个假逃生口 |
| **v1.24.0** numeric 不变量校验 + 压上下文 | ① `kind='numeric'` 进 `ALLOWED`（`:452`：`file/page/image/run/test/text/external/numeric`）与 schema enum（`:912`）；numeric 分支要求 `result` 匹配 `/^-?[\d.eE+-]+$/`（`:463-468`）。② `DESC`/工具参数文档同步（`:64`/`:910`）。③ 压上下文：删 `START_GUIDE` 与 `PROGRESSIVE_DECL` 重复的 meta 声明（`@00c81b1` 的 `START_GUIDE` 含 `Meta tools are always available: …`；`@b39112d:76-81` 已无该行，只留 `:66-73` 一份） | ① **可移植（硬项）**，落点**两处口径**：`plugins/lib/router-core.mjs:258` `EVIDENCE_KINDS` 增 `'numeric'`（供 `progressive.ts:329` 的 `z.enum`）＋ `:259-303` `validateDeliveryEvidence` 增 numeric 分支（要求 `result` 存在且为数值字面）。**注意上游没有 `EVIDENCE_KINDS` 常量**——它是 deliveryCheck 内的局部 `ALLOWED` Set（`:452`）；我方是常量单源，两处都要改。② 落点 `router-core.mjs:204` `DESC.deliveryCheck`（kind 清单）+ `:135` `STAGE_GUIDES[3]`（kind 清单）+ `progressive.ts:330/334`。③ 我方无重复（`PROGRESSIVE_DECL` 只有一份，`router-core.mjs:183-189`）⇒ 已满足 | **可移植** | 纯校验逻辑 + 纯文本。⚠️ **不要照抄上游的错误示例**：**实测** `result='2.07'`→`ok=true`；`result='minr=2.07'`→`ok=false`（detail 里却把 `minr=2.07` 写成 `e.g.` 示例）；`result='not-a-number'`→`ok=false`。CHANGELOG v1.24.0 自称"已实测：minr=2.07→PASS"，**与代码矛盾**——移植时用上游的**正则**、不要用它的**例子** |
| **v1.25.0** 验证失败先怀疑假设 | CHANGELOG 称阶段 3 引导增补 `doubt the HYPOTHESIS first`：先质疑最初假设（符号/边界/物理不变量），回到第一性原理重推导，**再**查门禁/证据 | **可移植的是 `:123` 实际存在的那段，不是 CHANGELOG 的标题措辞**：`On verification failure, hold a quick hypothesis-audit (guidance, not a hard block): before touching the implementation, name in one line (a) which assumption you are now re-checking, (b) what NEW evidence you just gained…`（`:123`；该句措辞与 commit 标题里 v1.28 的"验证失败假设审计"对应，见 7.3-3）。落点 `router-core.mjs:135` `STAGE_GUIDES[3]` | **部分可移植**【归属未验证】 | **检索结论**：全文件大小写不敏感检索 `doubt the hypothesis` **只命中 `:123` 一处**，且该处语句是"假设审计（两问）+ 不得制造 bug 来 justify 返工"。v1.25 的原文在两**端点**上都取不到（`@00c81b1` 的阶段 3 引导在 `:106`，其文本为 `Phase: verification → delivery gate. Unlocked: pwsh/bash/read_image/jobs + dev_page_check + delivery_che…`，无该句亦无 hypothesis 字样）。⇒ **v1.25 的实现文本无法从端点证实**，只按 v1.28 文本移植 |
| **v1.26.0** 上下文资产化（注意力回收） | `STAGE_GUIDES[1]` 增补 `**Attention reclamation (v1.26):**`：注意区留"任务目标 + 当前决策 + 现场证据"；已定的探索/细节**沉降到 `engram_store`**；过期/被取代/已解决的内容真正放下；原则句 `Do not hold "everything might be useful" in mind — that is attention leakage, not diligence.`（`:121`） | **原则可移植、指名不可移植**。落点 `router-core.mjs:133` `STAGE_GUIDES[1]`：留"注意区留什么 + 丢弃回收 + 注意力泄漏不是细心"三句（§6 已载"上游英文原义、工具名按映射表替换"）；**剔除 `engram_store`**（§1 映射表：`engram_*` → 无，DSH 专属记忆服务）。"沉降到记忆层"在 opencode 无宿主 ⇒ 改写为"落地到工作区笔记/探针文件"或**只留两条** | **部分可移植** | 原则是模型底层特性层面的、与平台无关；指名（`engram_store`）是本平台不存在的服务。⚠️ 实现者必须二选一并登记漂移（改成落盘 / 只留两条），**不得**留一个指不到的"记忆层" |
| **v1.27.0** 隔离与并行（支柱 4） | `STAGE_GUIDES[1]` 增补 `**Isolation & parallel (pillar 4):**`：两个独立关注点污染单线程、或子问题吞噬主线预算时，**push it into a `subagent` / `workflow`（独立上下文）**；让子代理持有自己的注意力，主线留在关键路径（`:121`） | **部分可移植**：原则可移植且我方**有部分对应面**——`task`（`router-core.mjs:220` `task: delegate a subagent task`）。**剔除 `workflow`/`ralph`/`fork`**（opencode 无，`:173` 的 `categorizeDomain` 正则里还并列着这三个名字，那是上游的概念分类不是工具存在性证明）。落点 `router-core.mjs:133` | **部分可移植** | 指名里只有 `subagent`（我方的 `task`）可留；其余三个是本平台不存在的编排件。⚠️ **实现期错位风险**：我方 `STAGES[1].tools` 只有 `todowrite`（`router-core.mjs:117`），若在阶段 1 引导里点名 `task`，会出现"引导里有、阶段工具表里没有"的自相矛盾——须同步 `STAGES[1].tools` 或在措辞上不点名 |
| **v1.28.0**（**无 CHANGELOG 小节**，只有 commit 标题与代码注释） | ① `:495-498` 注释 `// v1.28（引导，不强杀）` + 检查项 `numeric-assertion`（`pass: true`，非阻塞）：evidence 里没有任何 numeric 项时提示"若该交付物有可测不变量（守恒量/半径/计数/编译成功），加一条 `kind=numeric, result=<number>`"。② `:123` 的 hypothesis-audit 句自述 `this turns "doubt the hypothesis" from a prompt into a habit`（即 v1.28 把 v1.25 的"提示"变成"习惯化两问"） | **可移植（非阻塞 hint）**：落点 `router-core.mjs:259-303` `validateDeliveryEvidence`——返回值增加 `hints[]`（或返回一个 `pass` 恒 true 的伪检查项），`progressive.ts:365-375` 在输出里打印提示行且**不影响 `ok`** | **可移植** | **实测**：`deliveryCheck` 对 `kind='text'` 的合格证据仍会 push `numeric-assertion` 且 `ok=true` ⇒ 证明它确实非阻塞。归属见 7.3：**v1.28 的内容在代码里、但 CHANGELOG 没有小节、`ROUTER_VERSION` 也没 bump** |
| **纯文档提交** `da5d35b` / `0cd9a46` | 只改 `docs/STANDARD-PLAN.md`（84/50 与 1/1），无代码 | 无动作 | **纯文档** | `git show --stat` 证明两次提交各只碰一个 doc 文件 |
| **b39112d 内的纯文档文件** | `CHANGELOG.md`(+204)、`README.md`(+40)、`AGENTS.md`(+110 新)、`docs/FEEDBACK-v34.md`(+83 新)、`docs/STANDARD-PLAN.md`、`docs/archive/README.md`(+33 新)、`probe/README.md`(+37 新)、`probe/cot-lexicon.md`(+233 新)、`.gitignore`(+48 新) | 无动作（`probe/cot-lexicon.md` 是上游 CoT 词典，不进我方注入面） | **纯文档** | 逐文件属上游自有 docs/工具链；无跨仓落点 |
| **非 preset 的代码面** | `router.test.mjs`(+163/−)、`router.integration.test.mjs`(+236/−)、新增 `router-bootstrap-v34.selftest.mjs`(+132)、`scripts/sync-preset.cjs`(+129 新) | 无动作 | **不可移植** | 全是上游自测与同步脚本（`sync-preset.cjs` 维护上游两份 bootstrap 的 `?v=` 缓存穿透号；我方单文件插件无此面）。**可带走的是纪律**：v1.18.3 的"测试面=运行面"（测试 import 必须与挂载文件同一个），我方已满足 |

### 7.2 剔除清单（本平台不存在的指名 token —— 实现者照单剔除）

来源：`scripts/upstream/router-bootstrap.mjs`（= `b39112d` 逐字节）。行号即该文件行号。
"我方有无"按本仓库现状核（`plugins/` + `agents/`）。**凡在下表内的 token 出现在移植文本里，即为缺陷。**

| # | token | 上游出处（行） | 我方有无 | 剔除动作 |
|---|---|---|---|---|
| 1 | `engram_store` | :86（STAGES[2]）、:97（GLOBAL_SAFE）、:121（v1.26 引导）、:233（muted 替换串） | **无**（§1 映射表 `engram_*` → 无） | 删/改写为"落地到工作区笔记"，禁留"记忆层"指代 |
| 2 | `engram_recall` `engram_verify` `engram_respond` `engram_search` `engram_open` `engram_link` `engram_propose` `engram_confirm` `engram_reject` `engram_update` `engram_remove` `engram_promote` `engram_status` | :84-87（STAGES）、:97-99（GLOBAL_SAFE）、:121、:231-234 | **无** | 同上；`muteAwareList`/`isMemoryTool`（:177-181）整族不移植 |
| 3 | `run_code` | :7、:171（categorizeDomain）、:255（注释）、:328、:661（`available.has('run_code')`） | **无**（PTC/SDK 段不移植，§5/§6 已裁） | 删；连带 `buildStagedSdk`（:254-267）、`tools:sdk` 段处理不移植 |
| 4 | `presentAs` | :7、:736、:769 | **无** | 删（我方无呈现层切换） |
| 5 | `restrict`（`tools.restrict` 交集门控） | :11-12、:573-584、`applyStageRestrict`(:565-586)、`sharedLift`/`restrictLift`(:559-562)、status 的 `restrict released`(:895/:1010) | **V1 上无阶段化门控面**（V1 无等价面，§5 已裁）；**V2 上有等价面**（`SessionContext.tools` 可变，见 7.0 术语末条与 §7.5 U8 行）。⚠️ **这不等价于"opencode 无真隐藏"**：静态 `permission: <tool>: deny` 真隐藏已被本项目实验实证，见 7.0 术语与 `README.md`。我方 `plugins/` 里 `restrict` 这个词**0 次命中**（无实现面、无注释面） | 整族不移植（交集门控的**全量收窄语义**）；只取"锁写入面"子集，落点 `plugins/lib/host/v2.ts` 的 `ctx.session.hook("context")` + `R` 的 `unlockedFor`；`windowFor`/`preUnlockedFor`（:113/:143）随之不移植 |
| 6 | `dev_page_check` | :105（`META_LIVE` 残留）、:117（注释）、:434（注释）、:943（注释） | **无** | 剔除所有"固定页面工具"指代（**注意**：v1.23 的引导句 `Page verify with your OWN tools`（:123/:72）**保留**，它剔的正是这个 token） |
| 7 | `dev_reload_preset_live` | :68、:100、:105、:1072、:1214 | **无** | 删（我方无热重载工具） |
| 8 | `dev_reset_experience` | :105、:1162 | **无** | 删 |
| 9 | `get_goal` `create_goal` `update_goal`（goal tools 段） | :69、:101、:106、:893、:1010、:1124/:1130/:1141 | **无** | 删 goal tools 段（`GLOBAL_SAFE`:101、`META_GOAL`:106、status 的 `goalTools=` 行） |
| 10 | `subagent` | :121（v1.27 引导）、:173（`categorizeDomain` 正则） | **有等价**：`task`（`router-core.mjs:220`；**工具名**，`STAGES[1].tools` 与 `GLOBAL_SAFE` 里的 `task` 一律保留） | **保留但改名**：移植上游文本时写 `task`，不写 `subagent`（T13 轮已把 `TOOL_SUMMARIES.task` 的文案也换掉）。⚠️ **豁免一处，别误以为漏改**：`plugins/lib/classic.ts` 里 5 处 `subagent`（含真实注册的工具名 `dev_mode_subagent`）**判定为不改**，三条依据与反证见 **§8 的 `subagent` 豁免行** |
| 11 | `workflow` | :121（v1.27 引导）、:173、:513（注释） | **无** | 删 |
| 12 | `ralph` | :173 | **无** | 删 |
| 13 | `fork` | :75（"consequential fork"，**误命中**）、:173 | **无**（:75 是英文词不是工具） | 剔除 :173 的编排件指代即可；:75 不是 token |
| 14 | `read_image` | :72、:78、:87、:123、:239、:435、:439 | **改名**：`describe_image`（仅展示，§1 已载） | 改名；**并登记语义缺口**：`describe_image` 是"仅展示"，不足以充当 `reviewed:true` 证据来源（见 7.1 v1.23 行硬约束） |
| 15 | `pwsh` | :71、:78、:87、:123、:171、:591、:1178 | **改名**：`bash`（单一 shell，§1 已载） | 改名；`:123`/`:591` 的 Windows/Git-Bash 平台说明在 opencode 无意义，删 |
| 16 | `job_list` `job_output` `job_kill` | :87（STAGES[3]） | **无**（§1 已载"无 job 生命周期工具"） | 删 |
| 17 | `str_replace_editor` | :78、:86、:122、:170、:405-411（`isMutatingDev`） | **改名**：`apply_patch`（§1 已载） | 改名；`isMutatingDev` 只服务旧 `autoAdvance` 跳级，随 v1.19.0 一并废弃 |
| 18 | `web_search` `ask_user_question` `todo_write` `exit_plan_mode` | :78/:84/:120（web_search）；:78/:81/:84/:120/:251/:514-521；:78/:85/:120-121/:251/:387/:514-522/:819/:1037；:85/:121/:251/:514-522/:819/:1037 | **改名**：`websearch`、`question`、`todowrite`；**`exit_plan_mode` 无对应**（plan 靠 UI，§1 已载） | 改名三项；`exit_plan_mode` **从完成信号表里删掉**（我方完成信号 = `question`/`todowrite`/`delivery_check`） |
| 19 | `DSH_HOME`（默认根 `homedir()/.dsh`）+ `/router-standard/stages.json` | :528-529（`dshHomeForState()` / `stageFile()`） | **改名**：`~/.opencode/router-standard/stages.json`（`engine.ts:92-94` `stageFile()`） | 改名（已在 §6 或本表登记）。⚠️ **行号漂移（2026-10-12）**：本行原引 `progressive.ts:96-98`——该实现已洗出到 `plugins/lib/engine.ts`，`progressive.ts` 现为 22 行兼容壳。**写法对齐 §6 第 74 行的既有约定**（`homedir()/.dsh`），不再写成一个带 `/` 的绝对路径样串 |
| 20 | `session.events` / `request/header reason=initial` / `tool/code-dispatch` / `inbox.append` / `ctx.get('agentPresets')` / `ap.recompose` / `toolsSvc.view`·`layers`·`chainLayers`·`peek` / `agent/pre-step` | :184-191（sessionFresh）、:679（tool/code-dispatch）、:742/:775（inbox.append）、:892/:1229（agentPresets/recompose）、:292-347/:363-385（view/layers）、:671（agent/pre-step） | **无**（opencode 面 = `chat.message` / `messages.transform` / `system.transform`） | 整族不移植（平台适配，见 `docs/PORTING.md` §1/§3） |

> **本表"我方有无"列的判读约定（T8 复核修正；复核者只抽验了前 3 行，其余 17 行由作者本轮自查）**：
> 判据是 `grep -r <token> plugins/ agents/` 的**实现面**，不是字符串出现次数。本轮自查实测：
> - 17 个"**无**"里，`engram_*` / `run_code` / `dev_page_check` / `dev_reload_preset_live` / `dev_reset_experience` /
>   `get_goal`·`create_goal`·`update_goal` / `workflow` / `ralph` / `job_*` / `exit_plan_mode` / `str_replace_editor` /
>   `read_image` / `pwsh` 全部 **0 次命中**（`plugins/` 与 `agents/` 均 0）；
> - `presentAs`、`restrict` **本轮（2026-10-12）已各 0 次命中**：原命中的那处注释
>   （`plugins/lib/progressive.ts:27` 自述"上游 tools.restrict/presentAs 在 opencode 无等价物"）
>   随实现洗出到 `engine.ts` 而消失 ⇒ 现在连注释面都没有，**"无"更强成立**。
>   但 `restrict` 的**能力面**判定已按 §7.5 U8 重裁修正：**V1 无、V2 有**（`SessionContext.tools` 可变）。
> - `fork` **1 次命中，是英文词不是工具**：`router-core.mjs:220-221` 的注释在解释这处漂移本身
>   （"上游 `a consequential fork` → `a consequential decision`"）——与上游 `:75` 同款误命中，#13 行已对称注明。

### 7.3 版本归属判断（上游自相矛盾的裁决）

**观察到的三个互不一致的版本戳（都取自端点原文，不是 CHANGELOG 转述）**：

| 戳 | `@00c81b1` | `@b39112d` | 出处 |
|---|---|---|---|
| `CHANGELOG.md` 顶节 | `## v1.10.0`（但该节正文自述"版本 v1.15.0"） | `## v1.27.0` | `git show <c>:CHANGELOG.md` 首个 `## ` |
| `ROUTER_VERSION` 常量 | `'v1.15.0'` | **`'v1.20.0'`** | `router-bootstrap.mjs:44` / `:57` |
| `package.json` `version` | `0.3.0` | `0.3.0`（**未进 diff**） | `git diff --name-only 00c81b1 b39112d` 无 package.json |
| commit 标题 | `standard v1.17.1: …` | `注意力工程主线 v1.20-1.28` | `git log` |
| `## v1.17.1` 小节是否存在 | **不存在**（`00c81b1:CHANGELOG.md` 只有 v1.10.0/v1.9.0/v1.8.0/0.3.0 四节） | 存在，且自称"`ROUTER_VERSION` … v1.15.0 → **v1.17.1**" | 两次 `CHANGELOG.md` 的 `^## ` 列表 |

**判定（据代码，不据标题）**：

1. **代码内容到 v1.28，`ROUTER_VERSION` 停在 v1.20.0**。证据：`:495` 注释自称 `// v1.28（引导，不强杀）`、`:121` 引导里带 `(v1.26)` 与 `pillar 4`、`:122` 带 `(v1.22)`；而 `:57` 仍是 `'v1.20.0'`。⇒ **`ROUTER_VERSION` 在 v1.21 之后就没有再 bump**（v1.20.0 是最后一次）。这同时解释了"CHANGELOG 顶为 v1.27.0 而常量是 v1.20.0"——**不是矛盾，是常量滞后**。
2. **`00c81b1` 的代码内容也不等于它自报的 v1.17.1**：其 `ROUTER_VERSION` 是 **v1.15.0**（`@00c81b1:44`），CHANGELOG 顶节标题是 **v1.10.0**（该节正文却写"版本 v1.15.0"），commit 标题写 v1.17.1；而代码确实含 v1.17.1 的行为——`phase_begin` 的 guided 缺失修复在 `@00c81b1:960-965`（注释就写 `// v1.17.1 跨代兼容`；§6 已据此裁决）。同一份文件又仍是 v1.6 的预放语义（`@00c81b1:112` `Math.min(stage + 3, STAGES.length)`、`:266` `if (idx <= stage + 2) return '可调'`、阶段 3 引导在 `:106` 点名 `dev_page_check`）。⇒ 上游**长期**存在"标题/常量/CHANGELOG 三者不同步"，**v1.18.0→v1.27.0 的版本号一律只能按 CHANGELOG 小节归属**，不能按常量，也不能按标题。
3. **没有 v1.28.0 小节**：`CHANGELOG.md` 顶节即 v1.27.0，全文无 `## v1.28.0`；但代码里两处自称 v1.28。⇒ 裁决为：**v1.28 的内容在代码里（可引锚点），其 CHANGELOG 小节缺失**。本表按"代码里的 v1.28 内容"单列一行裁决，并在此登记"上游 CHANGELOG 缺一节"。
4. **`?v=` 缓存穿透号不是版本号**：`agent.cordis.yml` 的 `router-bootstrap-v34.mjs?v=88`、以及 CHANGELOG 里"同步 `?v=87/48`"——它是 `sync-preset.cjs` 维护的破缓存计数器，与语义版本无函数关系。**不得**用 `?v=` 反推版本（本轮明确不这么做）。
5. **判不了的就不判**：v1.18.4 的"`all:true` 汇总头"与 v1.21 的"截图保留最近 12 张"都是**中间态**（同区间内先加后删），在 `00c81b1` 与 `b39112d` 两个端点上都取不到，**无法验证其实现形态**——本表按"端点不存在/净零"处置，不按 CHANGELOG 描述编造实现。
6. **⚠️ 本区间内的 CHANGELOG 小节是"事后补写"的，连小节标题都只能算弱证据**：`@00c81b1` 的 `CHANGELOG.md` **只有 4 节**（v1.10.0 / v1.9.0 / v1.8.0 / 0.3.0），既无 v1.17.1 节，也无 v1.11–v1.16 各节；`@b39112d` 的 `CHANGELOG.md` 有 21 节（v1.27.0 … v1.17.1 / v1.15.0 / v1.9.0 / v1.8.0 / 0.3.0）。
   即 **v1.18.0→v1.27.0 的 16 个小节与 v1.17.1 小节（共 17 节）全部在 b39112d 这一个提交里一次性写入**（`git diff --numstat 00c81b1 b39112d -- CHANGELOG.md` = `204 1`，即顶部插入 **204** 行、删 1 行）。两个直接后果：
   - **v1.17.1 小节自称的"`ROUTER_VERSION` → v1.17.1"与端点代码（`v1.20.0`）不符**——它记录的是该版本当时的中间值，不是终态。⇒ 任何"CHANGELOG 说版本戳是 X"的说法都不能当实现证据。
   - 旧文件里标题为 **v1.10.0** 的那节（正文自述 v1.15.0）在 b39112d 里被**改标题为 v1.15.0**，内容未动。⇒ 连"某个版本号存在过"这件事都可能是补写/改标题的结果，**版本归属只能用"代码里有对应物"来确认**（本表每行都给了锚点，正是为此）。

### 7.4 实现清单（T7 轮的施工单；**已在 v0.5.0 落地，见 §8**）

约定：`R:` = `plugins/lib/router-core.mjs`，`P:` = `plugins/lib/progressive.ts`，`T:` = `test/router-core.test.mjs`。
每项末尾给"预期影响的现有测试"。**除 I1 的 (a) 分支外，全部为纯函数/纯文本，无平台新依赖**——
I1 若选"接上自动推进"，就落在我方**已有**的 `chat.message`/`messages.transform` 钩子上，不引入新平台面，但属于运行时接线（不是纯文本）。

| # | 上游锚点 | 我方目标 | 具体改什么 | 预期影响的现有测试 |
|---|---|---|---|---|
| **I1** | `:518-525`（`autoAdvance` 完成信号表）、`:120`（`No alignment, no advancement.`）、`:251`（stageText 尾句） | `R:159-167` `advanceStage` | ⚠️ **施工安全项（T8 复核独立确认，直接决定本轮成败）**：`advanceStage` 在**生产代码里没有调用者**——全仓只有 `test/router-core.test.mjs:62-67` 调它（`grep -rn advanceStage plugins/` 只命中定义；`plugins/lib/progressive.ts` 的 `phase_advance`（`P:299-319`）自己走 `st.stage = next`，从不调它）。⇒ **单独改 `advanceStage` 不会改变任何运行时行为，改了也不许宣称 I1 完成。** I1 必须与 **I2（`stageText`/`STAGE_GUIDES` 注入面）** 和 **I8（`phase_advance` 返回串）** **一起决定**，二选一：<br>**(a) 接上自动推进**——在 `chat.message`（`P:168-202`）或 `messages.transform`（`P:205-229`）里取上一条 assistant 的 `output.parts[].tool` 名集合，调 `advanceStage` 并落盘（注意：opencode 无上游的 `agent/pre-step`，推进点只能放这两个钩子之一）；<br>**(b) 不接自动推进**——则把"完成信号驱动"只作为**文本语义**同步（`stageText`/`STAGE_GUIDES` 尾句 + `DESC.phaseAdvance`），并**同步改写/删除** `advanceStage` 的旧跳级分支，避免留一个语义相反的导出函数误导后人。<br>无论选哪条，都要在证据文件里写明选了哪个、为什么，并证明运行时行为与所选路径一致。具体改动：`advanceStage` 重写为完成信号表 0→1 认 `question`/`todowrite`；1→2 认 `todowrite`；2→3 认 `delivery_check`；**删除**文本正则（`/start development…/`）、`bash→3`、`task→1` | `T:63-67` 五例中 **"开发工具 → 2"**（`advanceStage(1,["edit"])`）与 **"bash/完成声明 → 3"**（`advanceStage(2,["bash"])`、`advanceStage(2,[],"we are done")`）会失败——这正是上游删掉的旧语义，需按新语义重写；`T:63` 的 `task→1` 也要改。⚠️ 这 52 个测试**全部只覆盖 `router-core.mjs` 的纯函数**，不覆盖运行时——所以选 (a) 时不能靠它们验收，必须补一次真实链路读数（真实 `phase_advance`/阶段推进调用） |
| **I2** | `:208-219`（`firstUserTask`，160+`…`）、`:227`（`Task:` 行）、`:819`/`:1037`（`Next goal:`）、`:164-165`（引导而非打回） | `R` 新增 `firstUserTask(text)`；`R:149-156` `stageText`；`P:314-317` | ① `stageText(stage, taskText = '')` 增 `\nTask: <…>`（沿用 `progressive.ts:49` 的 `firstUserText`，**只认真实用户消息**）；② `STAGE_GUIDES[0..2]` 尾加 `→ Done? <完成判据> → <下一关>`；③ `phase_advance` 返回加 `Next goal: …`；④ `tools_help` 未解锁/未知分支补引导句 | `T:52-59`（`stageText` 断言，含越界钳制）、`T:171`（交付阶段提示）——需**扩参兼容**（新参默认空串），否则断言串变化而失败 |
| **I3** | `:113`（`windowFor=stage+1`）、`:119-124`（阶段引导三件事）、`:60`/`:62`（描述去"预放"） | `R:131-136` `STAGE_GUIDES`；`R:198-201` `DESC` | 按"本阶段做什么 / 验收标准 / 做扎实（后面工具不用急、不会提前来）"重排 `STAGE_GUIDES`；`DESC.toolsCatalog`/`DESC.phaseAdvance` 去除一切"预放/预解锁/预告后续工具"字样。**明确不移植** `windowFor`/`preUnlockedFor`（`:113`/`:143`，实测恒空） | `T:150-155`（`STAGE_GUIDES.length===4`、验证阶段含交付门）需随文本更新；`T:166`（`DESC` 五件套非空）不受影响 |
| **I4** | `:121`（v1.26 注意力回收）、`:122`（v1.22 防局部最优）、`:121`（v1.27 隔离与并行） | `R:133` `STAGE_GUIDES[1]`、`R:134` `STAGE_GUIDES[2]` | ① `[1]` 追加"注意区留什么（目标+当前决策+现场证据）/ 沉降 / 丢弃回收 / '可能有用就都记着 = 注意力泄漏'"——**剔除 `engram_store`**，二选一：改写为"落地到工作区笔记"或只留两条（登记漂移）；② `[1]` 追加"隔离与并行"——只点名我方的 `task`，**剔除 `workflow`/`ralph`/`fork`**；若点名 `task`，须同步 `STAGES[1].tools`（`R:117`）避免自相矛盾；③ `[2]` 追加"防局部最优"三段式，任务绑定举例（差分符号/守恒漂移）保留为举例或换通用表述 | `T:152-155` 需扩断言；`T:46-47`（`STAGES[0]`/`STAGES[2]` 工具表 `deepEqual`）——**若同步了 `STAGES[1].tools`，需新增 `[1]` 断言** |
| **I5** | `:452`（`ALLOWED` 含 `numeric`）、`:463-468`（numeric 校验分支与正则）、`:912`（schema enum）、`:64`/`:910`（文档 kind 清单）、`:495-498`（v1.28 非阻塞 hint） | `R:258` `EVIDENCE_KINDS`；`R:259-303` `validateDeliveryEvidence`；`R:204` `DESC.deliveryCheck`；`R:135` `STAGE_GUIDES[3]`；`P:325-335` args | ① `EVIDENCE_KINDS` 增 `'numeric'`（`P:329` 的 `z.enum` 自动跟随）；② `validateDeliveryEvidence` 增 numeric 分支：**要求 `result` 存在且为数值字面**（用上游正则 `/^-?[\d.eE+-]+$/`，**不要用上游的错误示例 `minr=2.07`**）；③ 增加 **非阻塞** `hints`（evidence 无 numeric 项时提示，且**不得**影响 `pass`）；④ 三处 kind 清单文本同步（含 `progressive.ts:330` target 说明加 numeric）；⑤ `P:365-375` 打印 hint 行 | `T:109-148` 需**新增**三例（数值 PASS / 非数值 FAIL / 缺 result FAIL）+ 一例"无 numeric 时给出非阻塞 hint 且 `pass` 仍为 true"；`T:146`（`EVIDENCE_KINDS` 含 external）旁加 numeric 断言 |
| **I6** | `:123`（阶段 3 hypothesis-audit 两问 + "不要制造 bug 来 justify 返工"）、`:72`/`:123`（`verify with your OWN tools`）、`:434-440`（`delivery_check` 不再自跑 smoke） | `R:135` `STAGE_GUIDES[3]`；`R:204` `DESC.deliveryCheck`；`P:321-377` `delivery_check` | ① 阶段 3 追加两问句（**先假定重检、再列新证据**）+ "代码本来就对就说对，不制造 bug"；② 追加"用我们自己的工具验证（bash + 截图看图 reviewed:true），不依赖固定页面工具"；③ **保留** `requireReviewedVisual`（`R:299-301`，对应上游 `args.url` 分支）并**写明** `describe_image` 是仅展示、不足以充当 `reviewed:true` 来源 | `T:140`（page 类要求 ≥1 reviewed 视觉证据）不变；`T:126`（page/image 必须 reviewed:true）不变；新增文本断言建议加在 `T:152-155` |
| **I7** | `:545`/`:692`/`:804`/`:894`（`lastAdvance` 落盘+展示）、`:155-156`/`:165`（host 标注，不移植） | `P:141-156` `saveStage`；`P:299-319` `phase_advance`；`P:412-430` `dev_router_status` | 状态加 `lastAdvance:{at, reason}`（`reason` 取 `args.reason`，**当前被接收后丢弃**，`P:301`→`P:302-318` 未使用）；`saveStage` 增参；`dev_router_status` 加一行 `lastAdvance=<ISO> (<reason>)` | 无现有测试覆盖 `saveStage`/状态工具（`T` 只测 `router-core.mjs` 纯函数）⇒ **需新增**（或在实现轮用真实 `dev_router_status` 调用做真实链路验证） |
| **I8** | `:817`（`New this stage:` 技能卡）、`:164-165`（未解锁引导句） | `P:314-317` `phase_advance` 返回 | 返回串改为 `advanced to phase N: <名>` + 换行 + `New this stage: <工具 — 一句摘要 + …>` + 换行 + `Next goal: …`（每工具摘要截 46 字，对应 `:812-815` 的 `card()`）。**不做**"Pre-unlocked"行（`preUnlockedFor` 恒空，见 v1.18.1 行） | 无现有测试 ⇒ 需新增 |
| **I9** | v1.18.3 的 `toJsonSchema` 递归（`:34-35`）、own-first 索引（`:314-317`）、分类单源（`:168-176`） | —— | **无动作**：我方用 zod（`P:301`/`P:326-335`）无手写 schema 扁平化；目录来自 `client.tool.ids()`（`P:456-464`）无层链；`tools_catalog` 无 `domain` 参数（`P:381`） | 无 |
| **I10** | v1.21.0 / v1.23.0 的 `dev_page_check` 机制族 | —— | **无动作**（工具本体从未移植，§5/§6 已裁）。**登记**：上游 `@b39112d:23` 的 `readdirSync,rmSync` 是 v1.23 删除时遗留的死 import——若照抄上游 import 行会连带带进两个未使用符号 | 无 |

**施工顺序建议**：I5（证据门，独立可测）→ **I1 先定 (a)/(b)**（它决定 I2/I8 要不要一起动；**只改 `advanceStage` 一个死函数 = 零运行时效果，不算完成**）→ I1+I2+I3（阶段语义与文本，三者共改 `stageText`/`STAGE_GUIDES`，一次到位避免反复改断言）→ I4+I6（引导增补）→ I7+I8（状态与技能卡）。
**每项落盘前必须**：`node --check` / 跑 `T` / 用真实 `dev_router_status` 与 `delivery_check` 调用做一次真实链路读数（本轮的读数与登记见 **§9**）。
⚠️ **测试面 ≠ 运行面**：`T` 的 52 个用例**只覆盖 `router-core.mjs` 的纯函数**，不覆盖 `progressive.ts` 的任何运行时接线——
所以 I1(a)/I7/I8 这类改动**光靠 `node --test` 全绿不能验收**，必须补真实链路读数（这正是上游 v1.18.3"测试面=运行面"那条纪律的反面教训）。

### 7.5 未验证 / 无法裁决清单（写清卡点，不写结论）

| # | 条目 | 卡点（缺什么证据） | 现有处置 |
|---|---|---|---|
| U1 | **v1.25.0 的实现文本** | CHANGELOG 声称的 `doubt the HYPOTHESIS first` 在两端点代码里都取不到；`@b39112d:123` 只有一段措辞对应 v1.28 的 hypothesis-audit。**缺**：v1.25 当轮的 bootstrap 原文（该版本不是 git tag，且中间态已被 b39112d 单提交覆盖） | 按 v1.28 文本裁决；本表标【归属未验证】 |
| U2 | **v1.21.0 的截图保留逻辑** | 同区间先加（v1.21）后删（v1.23），两端点均无 `pageCheckRunOnce`。**缺**：v1.21 中间态的可获取副本 | 判"不可移植 + 端点不可验证"，不按其描述编造 |
| U3 | **v1.18.4 的 `all:true` 汇总头** | 同上（v1.18.1 加 / v1.18.5 删）。两端点 `tools_catalog` 参数都只有 `query`/`domain` | 判"端点不存在"，只裁"我方本就无 `all` 参数" |
| U4 | **v1.18.0 的"STAGE_GUIDES 压缩为 2–4 行"是否真发生过** | `@b39112d` 的 `STAGE_GUIDES` 是四条**超长单行**（`:120-123`），压缩效果无法从端点观测；**缺**：v1.18.0 当轮原文 | 只裁"取结构（本阶段做什么/验收标准）"，不裁"压缩到几行" |
| U5 | **`engram_store` 在 opencode 是否存在任何等价物** | 本仓库断言"无"（§1 映射表、§6 memoryMuted 行），本轮**未在 opencode 侧核实**（不在授权读取面内）。**缺**：opencode 官方工具面清单的当轮核实 | 沿用 §1/§6 既有裁决（不移植）；若 U5 被推翻，7.1 v1.26 行的落点需重裁 |
| U6 | **`task` 工具的"独立上下文"是否真等于上游 `subagent` 语义** | 上游凭点是"subagent 持有独立上下文"；我方 `task`（`R:220`）的上下文隔离强度**未实测**。**缺**：一次真实 `task` 调用的上下文观测 | 文本层面可移植；"等价"这一断言标未验证，实现者写措辞时不要夸大 |
| U7 | **上游 `?v=` 与语义版本的映射** | 本轮已判定"不是版本号"（7.3-4），但 `?v=88`（yml）与 CHANGELOG 自称的 `?v=87` 差 1 的原因未查。**缺**：`sync-preset.cjs` 的运行记录 | 不用于任何归属判断 |
| U8 | **opencode 是否有可用的"阶段化工具呈现"替代面** | **前提已按 T8 复核更正**：§6/本表多处裁"不可移植"的依据不是"opencode 无门控"，而是"**V1 无*阶段化*门控**"（会话进行中无法开合请求里的工具集合，见 7.0 术语）。静态 `permission: <tool>: deny` 的**真隐藏**是**存在且已被本项目实验实证**的（`README.md`：`tool.ids` 枚举 ✅ / deny=请求级移除 ✅ / config.update 中断消息 ⚠️），只是**尚无任何一条 deny 按 stage 映射**（`agents/standard.md:25` 的 `doom_loop: deny` 是循环保护，与阶段无关；其余是 `allow`/`ask`）。**缺**（T8 当时）：把这套静态 deny 提升为"按 stage 动态开合"的可行性实测。<br>**⚠️ U8 已被推翻（2026-10-12，双线共存轮）：找到会话内动态收窄面的办法 = V2 的 `SessionContext.tools`。** 见下表「U8 重裁」。 | **原处置（T8 时）**：存量裁决**不变**，四行**无需重裁**——v1.18.0/1.18.2/1.18.5/1.20.0 要求的都是"会话进行中按阶段开合可见面"，静态加载期 deny 满足不了。**该处置已被下表取代**（U8 自己的措辞："若将来 U8 被推翻（找到会话内动态收窄面的办法），这四行需整体重裁"） |

#### U8 重裁（2026-10-12，**整体重裁**，依 U8 自己写下的推翻条件）

**推翻条件命中**：U8 原文的推翻条件 = "找到会话内动态收窄面的办法"。V2 给的正是那个办法。

**证据（三条，均为实测/源码锚点）**：

1. **面存在且可变**：V2 的 `SessionContext.tools: Record<string, {description, input}>`
   （`@opencode/plugin` 的 `promise/session.d.ts:29-35`，非 `readonly`）；
   `packages/core/src/session/model-request.ts:264-274` 按名单重建请求工具集合
   （`given.get(d) ?? byName.get(name)`，两边都对不上的条目被丢弃），
   `:420-425` 的 `agentHook` 以 `hooks.trigger("session","context", {…draft, agent, tools})` 把 `tools` 交给 hook。
   ⇒ **在 `context` hook 里删键 = 请求面收窄**。**该面已在真 V2 运行时实测通过**（`opencode2`）。
2. **V1 无等价面**（T8 结论仍然成立）：V1 的 15 个 hook 没有一个能增删请求里的工具集合（7.0 术语第二条）。
3. **⚠️ 旧 `unlockedFor` 恒等于全量 ⇒ 门控曾**空转**（这正是"重裁"而非"照抄"的实质证据）**：
   `R` 的旧 `GLOBAL_SAFE` 把 `STAGES` 里**全部 12 个阶段工具**都包含在内
   （`read/write/edit/glob/grep/bash/webfetch/websearch/question/todowrite/task/apply_patch`），
   而 `unlockedFor(stage) = STAGES[0..stage] ∪ GLOBAL_SAFE`（`R:142-146`）
   ⇒ **四个阶段的 `unlockedFor` 长度恒为 21、恒等于 `GLOBAL_SAFE` 本身，一个工具都收不掉**。
   实测（修复前）：`stage 0/1/2/3 → len 21, === GLOBAL_SAFE: true`（四行全 true）。
   ⇒ 若不先修这里，照 U8 写"V2 上有门控"就是**把一个空转机制写成能力**。

**用户裁定（2026-10-12）：只锁写入面。** 从 `GLOBAL_SAFE` 移出 `write` / `edit` / `apply_patch`，
其余（**含 `bash`**）保留。⇒ 门控开启后：**阶段 0/1 无写入面，阶段 2 起解锁**；`bash` 仍恒可用
（与 `STAGE_GUIDES[0]` 的 "an early sanity check is fine" 文案不矛盾）。
**理由**：语义是"未了解与对齐完就不准写文件"，正是上游 DSH 原意。
**修复后实测**（同一进程内当场量，非推断）：阶段 0/1 `len 18` 且三件写入工具均 `false`、`bash` `true`；
阶段 2/3 `len 21` 且三者 `true`；`GLOBAL_SAFE` `len 18`。

**四行整体重裁**（U8 点名的 v1.18.0 / v1.18.2 / v1.18.5 / v1.20.0）：

| 原行 | 原判定（T8 时，理由 = "会话中无法开合"） | **重裁后判定** | 重裁依据 |
|---|---|---|---|
| **v1.18.0**（§7.1 行） | ① 不移植——"我方 L0 无阶段化门控，`tools_catalog` 没有 stage 标记这个概念"（**该措辞未限定宿主，现已作废：它仅 V1 成立**） | **① 判定改为「部分可移植·未接线」**：`unlockedFor` 现已是 V2 门控的**真实调用方**（`engine.ts:281`），"未解锁"概念在 V2 上成立；但 `tools_catalog` 的 stage 标记**仍未接**（`engine.ts:423-435` 只列名字+静态摘要）⇒ 上游①的"默认面过滤未解锁"在 V2 上**可做而未做** | 面已存在（本条 1）；落点未做 |
| **v1.18.2**（§7.1 行） | 不可移植——"四条全部是门控面的减漂移重构；我方无阶段化门控面 ⇒ 无落点"（**该措辞未限定宿主，现已作废：它仅 V1 成立**） | **判定改为「部分可移植」**：`windowFor`/`stageSummary` 的**窗口语义**在 V2 上仍有落点（收窄名单就是窗口）；我方取的是"写入面到阶段 2"这一固定窗口，**未**取可配置 `windowFor`。`preUnlockedFor` 仍不移植（上游自身死代码，实测恒空） | 面已存在；我方只取子集 |
| **v1.18.5**（§7.1 行） | 不可移植——"我方**恒为全量面**（无阶段化门控 ⇒ 无'出口'概念）"（**该措辞未限定宿主，现已作废：它仅 V1 成立**） | **判定改为「部分可移植」**：**V2 + `OPENCODE_ROUTER_GATE=1` 下不再是全量面**，故"目录默认面不必铺满"这条纪律有了真实落点；但 `tools_catalog(all:true)` 这个**全量出口**本平台从未有、也不需要（上游自己 v1.18.5 就删了它）⇒ 仍不移植该出口本身 | 面已存在；该版本要删的东西我方本来就没有 |
| **v1.20.0**（§7.1 行） | 部分可移植——"① 机制不移植（我方无 restrict 窗口）" | **判定改为「部分可移植（机制那一半也已有落点）」**：① `windowFor=stage+1` 的**等价语义** = 我方"写入面到阶段 2"的解锁边界；② 文本可移植（原文已裁）；④ `preUnlockedFor` 死分支仍登记为反例，**不移植** | 面已存在；预解锁仍不移植 |

**未随之改动的部分（写清边界，避免读成"全部翻案"）**：
- `windowFor` / `preUnlockedFor` 的**预解锁窗口机制**仍**不移植**（上游自身死代码，实测 `preUnlockedFor=[[],[],[],[]]`）。
- 上游 `tools.restrict` 的**交集门控族**仍**不移植**（`sharedLift`/`restrictLift`/`applyStageRestrict` 一整套）；
  我方只取"从 `GLOBAL_SAFE` 移出写入面"这一个**静态名单子集**，由 V2 的 `context` hook 在请求期执行。
- **V1 上所有"不可移植"结论不变**：V1 无等价面，`OPENCODE_ROUTER_GATE` 在 V1 上无效果。
- 本重裁**不**触碰 `plugins/lib/router-core.mjs` 的只读快照契约——`GLOBAL_SAFE` 在**仓库自己的**
  `plugins/lib/router-core.mjs`（派生层），不是 `scripts/upstream/` 里的快照文件（见本文件开头"派生常量以本文件为基准"）。

## 8. 增量漂移记录（v0.5.0，I1–I8 落地）

§7.4 的施工单已在 v0.5.0 落地（用户就 I1 的行为分岔拍板：**选 (a) 接上自动推进**）。本表逐项记**落地位置**与**相对上游的漂移**。
`R:` = `plugins/lib/router-core.mjs`，`P:` = `plugins/lib/progressive.ts`，`T:` = `test/router-core.test.mjs`，`RT:` = `test/progressive-runtime.test.mjs`。

> ⚠️ **本表的 `P:` 行号自 2026-10-12（宿主缝重构）起已漂移**：v0.5.0 时 `progressive.ts` 是 561 行的全部实现；
> 现在实现已洗出到 `plugins/lib/engine.ts`（宿主中立业务）+ `plugins/lib/host/{v1,v2}.ts`（双适配器），
> `progressive.ts` 只剩 22 行兼容壳（仅再导出）。**本表行内的 `P:` 行号按"v0.5.0 当时的文件"读**，
> 现址映射与新增面见 **§9**。另：`T` 之外的测试面新增了 `test/host-seam.test.mjs`（`HS:`）。

| # | 项 | 落点 | 相对上游的漂移 / 说明 |
|---|---|---|---|
| I1 | 完成信号驱动晋级 | `R` `advanceStage(stage, toolCalls)` 重写 + 新 `R` `completionSignals(stage)`；**运行时接线**在 `P` 新增的 `collectToolCalls`/`autoAdvanceFromCalls`/`advanceFromMessages`，调用点：`P` 的 `experimental.chat.messages.transform`（主路径，唯一能看到 assistant `ToolPart` 的面）+ `chat.message`（防御性兜底） | ① 上游 0→1 还认 `exit_plan_mode`（本平台无）→ 完成信号表退化为 `question/todowrite`；② 上游用 `session.events` + `stageAtTime` 过滤，本平台无该面 → 改用**按 `callID` 记账**（`seenCalls`，上限 200）实现同一幂等语义；③ 上游 `agent/pre-step` 不存在 → 落在已有 hook 上；④ 删除了旧语义（`bash→3`、`task→1`、`write/edit→2`、文本正则 `/start development…/`、`/verif…finished…done/i`）；⑤ ⚠️ **`completionSignals(0)` 里的 `question` 那一半，在非交互 `opencode run` 下是死信号**（宿主把 `question` 从请求的 tools 数组移除，模型根本调不到它）⇒ 在该形态下，实际可行的 0→1 路径只剩 **`todowrite`** 或**显式 `phase_advance`**（交互态里 `question` 仍可用）；**这不是映射错误**：上游第一个完成信号确实是 `ask_user_question`（`:521`），我们按 §1 映射成 `question` 是**忠实映射**，只是本平台该信号的"可达性"取决于宿主是否交互态（机制与锚点见下面的"`question` 可见性"行） |
| I2 | 任务回显 / `→ Done?` / `Next goal` / 引导而非打回 | `R` 新 `firstUserTask(text)`；`R` `stageText(stage, taskText)` 增 `Task:` 行；`R` `STAGE_GUIDES[0..2]` 尾加 `→ Done?`；`P` `phase_advance` 返回加 `Next goal:`；`P` `tools_help` 未知工具补引导句 | 数据源漂移：上游 `firstUserTask(session)` 读 `session.events` 的 `e.data?.source ?? e.data?.message?.source`，本平台无该面 → 改收**纯文本入参**，由 `P` 的 `firstUserText`（`chat.message` 里首条真实用户文本）供给 |
| I3 | 取消预解锁（文本面） | `R` `STAGE_GUIDES` 四条重排（"本阶段做什么 + 验收标准 + 做扎实"）；`R` `DESC.toolsCatalog`/`DESC.phaseAdvance` 去"预放/预解锁/预告后续工具"字样；`R` `stageText` 尾句改为完成信号口径 | `windowFor`/`preUnlockedFor` **不移植**（实测恒空，上游自身死代码）；`DESC.toolsCatalog` 改为"工具全量可调（阶段是推荐路线，不是硬门控）"——**该措辞的适用面已随 U8 重裁收窄为「门控默认关时」**：V2 + `OPENCODE_ROUTER_GATE=1` 时写入面确实不在 wire 上，此时不可再自称"恒全量" |
| I4 | 注意力回收 / 隔离并行 / 防局部最优 | `R` `STAGE_GUIDES[1]`（v1.26 + v1.27）、`R` `STAGE_GUIDES[2]`（v1.22 按序追加，保留既有 re-read/转义契约） | ① **仅落一条**（用户二选一的口径）："已定细节**写进工作区笔记文件**"——剔除 `engram_store`（本平台无记忆服务），不留"记忆层"指代；② v1.27 只点名 `task`，剔除 `workflow`/`ralph`/`fork`；③ 同步 `R` `STAGES[1].tools = ['todowrite','task']`，消除"引导里有 task、阶段表里没有"的自相矛盾；④ 上游举例（finite-difference sign / conservation drift）未照抄，改为通用表述 |
| I5 | `kind='numeric'` 证据 + 非阻塞 hint | `R` `EVIDENCE_KINDS` 增 `numeric` + 新 `R` `NUMERIC_RESULT_RE`；`R` `validateDeliveryEvidence` 增 numeric 分支与 `hints[]`；`R` `DESC.deliveryCheck` 与 `STAGE_GUIDES[3]` kind 清单同步；`P` `delivery_check` args（zod enum 自动跟随）+ 打印 hint 行 | **用上游正则 `/^-?[\d.eE+-]+$/`，不用上游例子**（实测 `minr=2.07` → FAIL，上游 CHANGELOG 自称 PASS 是错的）；"两处口径"在本仓库是 `EVIDENCE_KINDS` 常量（供 zod enum）+ 校验函数，两处都已改；hint 恒 `pass`-中性（上游 `pass:true` 语义） |
| I6 | 假设审计 / 用自己的工具验证 | `R` `STAGE_GUIDES[3]` 增两问句 + "Verify with your OWN tools" + `describe_image only displays…` 边界；`R` `DESC.deliveryCheck` 同；`R` `validateDeliveryEvidence` 的 `requireReviewedVisual` **保留**（`P` 以 `page:true` 传入） | 上游的"用 read_image 复核"在本平台改名 `describe_image`，且**明确写了它不足以充当 `reviewed:true`**——补上了 §7.1 v1.23 行登记的语义缺口 |
| I7 | `lastAdvance` 闭环 | `P` 状态改为 `{stage, confirmed, lastAdvance}`（`loadStages`/`stateOf`/`saveStage` 全部接上）；`phase_advance` 的 `args.reason` 落盘；自动晋级记 `auto:<工具名>`；`dev_router_status` 增 `lastAdvance=` 行 | 上游 `stages.json` 的 `lastAdvance:{at,reason}` 一一对应；顺带修掉"`args.reason` 收了就丢"的既有缺口。⚠️ **`reason` 为 `null` 是设计、不是漏登记**：类型即 `{at: number; reason: string \| null}`，`phase_advance` 的 `reason` 参数是显式 `.optional()`；**显式 `phase_advance` 未传 `reason` 时 `reason = null`（时间戳仍有值）**，`auto:<工具名>` 只出现在**自动晋级**路径（`autoAdvanceFromCalls`）。展示面（`dev_router_status`）对 `null` 有兜底：只打印 ISO 时刻、不打印括号内容 |
| I8 | `New this stage` 技能卡 | `P` `phase_advance` 返回 `advanced to phase N` + `New this stage: <名> — <摘要首句截 46 字>`（分隔符沿用上游的竖线，逐工具走 `card()`）+ `Next goal: …` | **不做** `Pre-unlocked` 行（上游该分支恒不触达，见 §7.1 v1.18.1）。**⚠️ 漂移已修（T12 轮）**：v0.5.0 初版只给裸工具名（无摘要、无 46 字截断），T12 轮按上游 `bootstrap.mjs:812-815` 的 `card()` 补齐——摘要取 `R` 的 `TOOL_SUMMARIES`（上游取 registry 的 description），首句切分用上游同一个 `split(/\n\|\. /)[0]`，缺摘要时只给工具名（对齐上游 `found ? … : ''`）。**✅ 已清（T13 轮）**：`TOOL_SUMMARIES.task` 的文案曾是 `delegate a subagent task`，含 DSH 工具名 `subagent`——按 §7.2 #10 的"保留但改名"处置已改为 **`delegate work to a separate context`**（语义不变：`task` = 把工作派发到独立上下文；**`task` 作为工具名一律未动**，只换掉了 `subagent` 那个词）。同时把 `subagent` 纳入两处 `FORBIDDEN` 断言，并**扩大扫描面**使该判据真的覆盖到它曾出现的位置（`TOOL_SUMMARIES` 的全部值；运行时扫真实注册面时改用"深走对象取全部字符串"以覆盖 zod 非枚举的 `description`，深度上限 40 以覆盖嵌套参数 `evidence.items[].result`） |
| — | 版本 / 文档 | `package.json` 0.4.1→**0.5.0**；`R` `PLUGIN_VERSION`→`v0.5.0`、`UPSTREAM_BASELINE`→快照/语义双记；`plugins/routing-suite.ts`、`P` 头部版本同步；`docs/PORTING.md` 追加 v0.5.0 段；`README.md` 同步 | 三个文件里仍自称 `v0.4.0`/`v0.4.1` 的版本常量一并修正，全文一致 |
| — | 注入文本卫生 | `T` 新增"注入文本卫生"用例：对 **6** 个注入面（`PROGRESSIVE_DECL`/`PROACTIVITY_GUIDE`/`DESC`/`STAGE_GUIDES`/`stageText`/`TOOL_SUMMARIES`；`TOOL_SUMMARIES` 于 T13 轮纳入）逐 token 断言 §7.2 剔除清单里的 **24** 个指名**一个都不出现**，并带一条"判据可失败"的自证（⚠️ 本行原写"5 个注入面 / 23 个指名"——**实数 6 面 / 24 指名**，2026-10-12 程序计数更正，见 §9.2 #10） | 为了让它成为**可机械校验**的不变量，`PROACTIVITY_GUIDE` 有一处一词漂移：上游 `a consequential fork` → **`a consequential decision`**（`fork` 是 DSH 编排工具名，保留会让该判据永远假阳性） |
| I9/I10 | 无动作（§7 已裁） | —— | `toJsonSchema` 递归 / own-first 索引 / 分类单源：本仓库用 zod 与 `client.tool.ids()`，无对应面；`dev_page_check` 机制族：从未移植，且**未**照抄上游 `:23` 的死 import |
| — | **`question` 可见性：只在宿主交互态成立（T21 轮登记，补规格缺口）** | 我方落点：`R` 的 `STAGES[0].tools`（含 `question`）、`R` 的 `GLOBAL_SAFE`、`agents/standard.md:10` 的 `question: allow`。宿主锚点：`packages/opencode/src/tool/question.ts:15`（`Tool.define(…, "question", …)`，`src/tool/` 下唯一的"问用户"工具） | **工具名正确、要不要改：不改。** 三条性态（本轮按宿主源码与原日志复核）：① **名字对**——工具在 `tool/question.ts:15` 注册为 `question`，`src/tool/` 无 `ask*.ts`，宿主 `src/` 里 `ask_user_question` 命中 **0** 次 ⇒ §1 映射表那行成立；② **非交互 run 下不可见是必然的**——`cli/cmd/run.ts:430-448` 是 `const rules: PermissionV1.Ruleset = interactive ? []` 否则 `[{permission:"question",action:"deny",pattern:"*"}, plan_enter, plan_exit]`，而 `run.ts:273` `const interactive = args.mini` ⇒ 普通 `opencode run` **必然**带这三条 deny；结合本项目既有实测 **deny = 从请求的 tools 数组移除该工具**（`README.md:102` 自记的 `deny=请求级移除 ✅`），即完整解释真实会话里调 `question` 得到 `Invalid Tool`；③ **`agents/standard.md:10` 的 `question: allow` 语法语义合法**（与内置 `build`/`plan` agent 同形）**但在非交互 run 下被会话级 ruleset 覆盖为 deny ⇒ 不生效**——所以**不改 `agents/`**（改了也拦不住宿主覆盖，还会改动部署物字节）。**结论一句话**：「`question` 不在工具面上」只在非交互 run 成立、**不普遍成立**；「工具名是 `question`」普遍成立。本行只作性态说明，**不加自动断言**（依赖宿主交互态，非本仓库可断言的代码行为），也**不把 `question` 挂进任何 `FORBIDDEN`**（它是合法工具名） |
| — | **`subagent` 豁免：`classic.ts` 的 5 处不改（T15 轮登记，补规格缺口）** | `plugins/lib/classic.ts` `:21`（文件头注释）、`:488`（小节注释）、`:491`（**真实注册点** `dev_mode_subagent: tool({`）、`:510`/`:512`（该工具返回串与错误串） | **处置：不改。** 依据三条（均为实测）：① `plugins/routing-suite.ts:16` 是**三元互斥**——`OPENCODE_ROUTER_CLASSIC === "1" ? classicImpl : progressiveImpl`，同一时刻只注册一个 impl；② 实测 progressive 模式下 `hooks.tool` 恰 **7** 个键（`phase_begin`/`phase_advance`/`delivery_check`/`tools_catalog`/`tools_help`/`dev_router_status`/`dev_router_mode`）**不含** `dev_mode_subagent`，而 classic 模式 3 个键**含**它；③ 卫生判据（§8 的 `FORBIDDEN` 断言）的作用域就是 **progressive 的注入面**，而 `classic.ts:2-5` 自述"classic v0.3.1（冻结）……`OPENCODE_ROUTER_CLASSIC=1` 的回退实现（v0.3.1 原文冻结，不随上游演进）"。**反证（说明豁免不是为过断言而让路）**：`:491` 是**真实对外注册的工具名**，改名会改掉模型可见的工具标识（真实破坏性），而且 `:510`/`:512` 是该工具自己的返回/错误串、`:21`/`:488` 是注释——三处都不是"幻名指代"。与 §7.2 #10 的 `subagent` → `task` 改名互引：那里管的是**移植上游文本时**把 `subagent` 写成 `task`，本条管的是**本仓库既有代码**里一个真实存在的工具名 |

### 8.1 v0.5.0 的实现期决策（记录，供下一轮复核）

| 决策 | 取值 | 依据 |
|---|---|---|
| I1 落地面 | **(a) 接上自动推进**，主路径 `messages.transform` | 用户拍板。**读的是哪份类型（T12 轮更正）**：根 `node_modules` 是 `@opencode-ai/plugin@1.18.21`，而实装目录 `.opencode/node_modules` 是 **`1.18.18`**——两版的 `Hooks` 接口实测**完全相同**（15 个 hook 键、`tool.definition` 的 output 只有 `{description, parameters}`、`permission.ask` 的 output 仍是 ask/deny/allow），结论不受版本差影响，但引用时须写明是哪一份。**措辞更正（T12 轮）**：`chat.message` 的 `output` 是 `{ message: UserMessage; parts: Part[] }`——**`message` 面**不带工具调用，但**`parts` 面是可带 `ToolPart` 的**（两版同形）；主路径放 `messages.transform` 的真实理由是"那里拿到的是**完整会话数组**（含 assistant 消息的全部 part）"，不是"`chat.message` 结构上不可能带工具调用"。`P` 在 `chat.message` 里兜底读 `parts` 与该类型相容，保留 |
| 幂等机制 | 按 `callID` 记账（`seenCalls`，上限 200） | 本平台无 `session.events`/`stageAtTime`；同一调用重复出现在消息数组里不得重复晋级（`RT` 有专例） |
| v1.26 "沉降到记忆层" | 只保留一条：**写进工作区笔记文件** | §7.1 v1.26 行要求二选一；本平台无记忆服务，落盘是唯一有宿主的方案 |
| `STAGES[1].tools` | 加 `task` | §7.1 v1.27 行的错位风险：引导点名 `task` 就必须同步阶段表 |
| `describe_image` 与 `reviewed` | 保留 `requireReviewedVisual`，并在文本里写明 `describe_image` 不算复核 | §7.1 v1.23 行硬约束 |
| 版本口径 | `PLUGIN_VERSION = 'v0.5.0'`；`UPSTREAM_BASELINE = '@b39112d snapshot (v1.27.0); v1.18→v1.28 语义已按 §7 裁决移植/剔除'` | §4"两个基线分开记"：快照来源与实现面各自说清，不写自相矛盾的合并句。**注意**：v0.5.0 起"实现冻结点 = 00c81b1"的旧表述不再准确（v1.18→v1.28 的可移植子集已落地）⇒ §4 的该行同步为"快照来源 b39112d / 实现面对齐 v1.18→v1.28 可移植子集（§7.1 裁决）" |

## 9. 宿主缝重构与双线共存（2026-10-12）

上游 opencode 已分叉为 **V1**（`@opencode-ai/plugin`，npm 最新 **1.19.0**，命令 `opencode`）
与 **V2**（`@opencode/plugin@2.0.26`，命令 `opencode2`）。用户拍板**双线共存**。
本节记重构后的落地位置、`§8` 行号的现址映射、以及 U8 重裁带来的能力变化。

`E:` = `plugins/lib/engine.ts`，`H1:` = `plugins/lib/host/v1.ts`，`H2:` = `plugins/lib/host/v2.ts`，
`HC:` = `plugins/lib/host/contract.ts`，`RS:` = `plugins/routing-suite.ts`，`HS:` = `test/host-seam.test.mjs`。

### 9.1 §8 的 `P:` 行号 → 现址映射（实现已洗出）

| §8 里的 `P:` 行 | 原内容 | 现址 |
|---|---|---|
| `P:27` | `restrict`/`presentAs` 注释 | **已消失**（连注释面都没了，`restrict` 现 0 次命中） |
| `P:49`、`P:184` | `firstUserText` Map 与写入 | `E:74`、`E:217` |
| `P:96-98` | `stageFile()` | `E:92-94` |
| `P:141-156` | `saveStage` | `E:145-161` |
| `P:168-202` | `chat.message` hook | `H1:95-108` |
| `P:205-229` | `messages.transform` hook | `H1:111-129` |
| `P:299-319` | `phase_advance` | `E:325-357` |
| `P:301` | `phase_advance` 的 `args.reason` | `E:328` |
| `P:314-317` | 技能卡返回串 | `E:349-355` |
| `P:321-377` | `delivery_check` | `E:359-417` |
| `P:325-335` / `P:329` / `P:330` / `P:334` | `delivery_check` args / zod enum / target 说明 | `E:362-374` / `E:368` / `E:369` / `E:370` |
| `P:365-375` | 打印 hint 行 | `E:414` |
| `P:379-395` / `P:381` | `tools_catalog` | `E:419-436` / `E:422` |
| `P:397-409` / `P:403-407` | `tools_help` | `E:438-457` / `E:445-449` |
| `P:412-430` | `dev_router_status` | `E:459-466` + `E:491-506` |
| `P:456-464` | `client.tool.ids()` 目录 | `H1:47-56`（V1）/ `H2:79-88`（V2） |

**已删除**（不是漂移，是设计）：`collectToolCalls` / `advanceFromMessages` / `autoAdvanceFromCalls`
——见 9.2 第 3 条。

### 9.2 重构后的新事实（逐条，均为本机实测或源码锚点）

| # | 事实 | 锚点 / 读数 |
|---|---|---|
| 1 | **双线共存**：一个 `default` 同时满足两宿主 | `RS:42` `export default { id: PLUGIN_ID, setup, server }`。V2 只认 `default` 且要求 `id`+(`setup`\|`effect`)——`@opencode/plugin` 的 `Module` schema 是严格 `Schema.Struct`（`packages/core/src/plugin/module.ts:78-91`）；V1 的 `readV1Plugin(mode="detect")` 见 `server` 键即取 server 分支（`packages/opencode/src/plugin/shared.ts:272-285`，`origin/dev` 同号）。**混合形状已在本机真 V2 运行时实测通过**（`opencode2 plugin list` 认成 `local`，连跑 3 次） |
| 2 | **V1 下限 ≥ 1.18.29**（对象入口自该版本起受支持） | ⚠️ **此条是「仅指南」，不是实测读数**：本机无 1.18.29 tag 可独立验证，最近的 V1 树是 1.18.30。**不得**写成已实测 |
| 3 | **晋级触发器从消息面搬到逐调用工具事件** | V1 `H1:132-145` `tool.execute.after`；V2 `H2:136-148` `ctx.tool.hook("execute.after")`。**原因**：V2 hook 面的 `Message` 是 `{role, content}`、**没有 `parts` 字段**（`@opencode/ai` 的 `schema/messages.d.ts:426-429` 只有 `id`/`role`/`content`）⇒ 旧的消息面写法在 V2 上会**静默失效**（恒空数组、零报错）。搬到逐调用事件后，F7 那个 part 形状差异（V1 `type:"tool"`+`callID` vs V2 `type:"tool-call"`+`id`）被**消掉**而不是被翻译掉 |
| 4 | **阶段化门控 = V2 独有，默认关，且只锁写入面** | 实现 `H2:165-190`（`ctx.session.hook("context")` 按 `core.unlockedFor(stage)` 删 `event.tools` 的未解锁键）+ `E:281`（`visibleTools: gateEnabled() ? core.unlockedFor(stage) : null`）。开关 `E:55` `gateEnabled()` = `OPENCODE_ROUTER_GATE === "1"`，**动态读**（同一进程内可验证开/关两种取值）。**V1 上无此能力**（V1 无等价面，7.0 术语第二条）⇒ 正确口径 =「**V1 上无阶段化门控；V2 上有，默认关，且只锁写入面**」 |
| 5 | ⚠️ **门控曾空转（U8 重裁的实质证据）** | 旧 `GLOBAL_SAFE`（`R:126-131`）含全部 12 个阶段工具 ⇒ `unlockedFor(stage)` 四阶段长度恒 21、恒等于 `GLOBAL_SAFE`，**一个工具都收不掉**（实测四行全 `true`）。用户裁定"**只锁写入面**"：`write`/`edit`/`apply_patch` 移出 `GLOBAL_SAFE`，其余（含 `bash`）保留。**理由**：语义是"未了解与对齐完就不准写文件"，正是上游 DSH 原意 |
| 5b | **修复后实测读数**（同一进程内当场量） | `unlockedFor`：阶段 0/1 → **len 18**，`write`/`edit`/`apply_patch` 均 **false**、`bash` **true**；阶段 2/3 → **len 21**，三者 **true**；`GLOBAL_SAFE` **len 18**。⇒ **门控开启后阶段 0/1 确实无写入面**，不再是空转 |
| 6 | **`unlockedFor` 首次接上落点** | 该函数此前在 `R:142` 存在但**无调用方**（本轮首次接线到 `E:281`） |
| 7 | **V2 上 `OPENCODE_ROUTER_CLASSIC=1` 失效** | `H2:118-125`：classic 冻结版不进 V2 适配缝，实现**打日志并回退 progressive**（`console.warn`，不静默忽略）。**冻结回退仅 V1**（`RS:34-37` 的 `server` 分支仍走 `classicImpl`） |
| 8 | **`progressive.ts` 降级为兼容壳** | 22 行，只再导出（`E` 的业务 + `H1` 的 `makeV1Plugin`）。保留的两个理由：`tsconfig.json` 的 `include` 逐条列了该路径；`README.md` 部署清单点名它 |
| 9 | **测试面读数（2026-10-12）** | `npm test` = **135 例**（`router-core.test.mjs` 73 + `progressive-runtime.test.mjs` 29 + `host-seam.test.mjs` 33），基线 96；`npm run check` exit 0。README 此前写的"88 例"**是错的**，已更正。⚠️ 条数是**活读数**：宿主缝那一栏由另一 lane 同步扩写（本轮同一天内先后量到 115 / 117 / 135），引用须以当场输出为准 |
| 10 | **禁用 token 实为 24 条**（此前多处写 23） | 程序计数：`test/router-core.test.mjs` 与 `test/host-seam.test.mjs` 的 `FORBIDDEN` **各 24 条且集合相同**（`HS:484` 显式 `assert.equal(FORBIDDEN.length, 24)`）⇒ README/PORTING/本文件多处"23"已更正为 24 |

**三项已登记的行为差异**（第 11–13 条；**口径：相对本项目 v0.5.0**，**不是**相对 DSH 上游的移植差异——
上游从未有这套逐调用触发面。README 的 `## 已知边界` 指向本处）：

| # | 差异 | 锚点 / 读数 |
|---|---|---|
| 11 | **① 晋级可跨两级 + 对顺序敏感**——**已修，不再是差异** | 旧逐调用判定下同一轮 `[question, todowrite]` 会跨两级、且结果随顺序变。修法 = **每请求上限 +1**：`E:193-197`（`advancedThisRound` 为真时只记账不推进）、`E:207`（置真）、`E:308`（复位）。**轮边界 = 一次模型请求**，复位点 `onContextRequest`（`E:288`；R8 从 `onPrompt` 搬来，理由见 `E:290-307` 注记）⇒ 与旧"每请求天然一批"语义一致。钉住用例：`test/progressive-runtime.test.mjs:253`（"R7/R8 缺陷①…只晋级一级，且与顺序无关"） |
| 12 | **② `lastAdvance.reason` 只记致因工具名**（**保留，用户可见**） | `E:204` `const reason = "auto:" + call.name` ⇒ 只含**首个致因者**。旧形 `auto:read,question` → 新形 `auto:question`（旧值把未致因的 `read` 也写进去）。**该字段经 `dev_router_status` 展示 ⇒ 用户可见**，取值形态与 v0.5.0 不同。与第 13 条同源（"逐调用判定"取代"整批判定"的必然结果） |
| 13 | **③ 被上限挡下的信号被静默丢弃**（**保留**） | `E:194-197`：被挡下的调用**仍然走 `remember()`** ⇒ 其 `callID` 进 `seenCalls`（`E:190`，上限 `MAX_SEEN_CALLS = 200`，`E:169`）⇒ 再投递同一调用被 `E:188` 的 `seen.has()` 直接挡掉 ⇒ **该信号实例被烧掉**。后果：同一请求内 `phase_advance` 与完成信号共现时**丢一个信号**；若后续无新信号则**落后一级**。⚠️ **方向双向**：差分读数 256 序列中 **37 处**不一致（**11 落后 / 26 多进**），**全部**含 `phase_advance`；不含它的序列 0 处不一致 ⇒ **不是**单向的安全偏差。钉住用例：`test/progressive-runtime.test.mjs:314`（"R9 已登记差异③…钉住现状，防止静默变化"） |

### 9.3 与快照契约的关系（**未触碰只读快照**）

`node scripts/verify-upstream-snapshot.mjs` 仍 **exit 0**：`router-core.mjs`（sha256 `544c12c6…`，9900 B）
与 `router-bootstrap.mjs`（sha256 `152b9773…`，84429 B）逐字节未变。
⚠️ **注意别把两个同名文件搞混**：`GLOBAL_SAFE`/`unlockedFor` 的改动落在**仓库自己的派生层**
`plugins/lib/router-core.mjs`（本文件开头即声明"派生常量以本文件为基准，可以本地改写，但必须在此登记原因"），
**不是** `scripts/upstream/router-core.mjs`（那份是上游原文快照，CI 有字节级守护）。
本节的登记正是那条"必须登记原因"的履行。


### 9.4 版本 / 文档（v0.5.0 → **v0.6.0**，2026-10-12）

仿 §8 的版本行写法，登记本轮 bump 的全部落点（项目惯例见本文件 §8 的 v0.4.1→0.5.0 清单）：

| 落点 | 内容 |
|---|---|
| `package.json` | `"version": "0.5.0"` → **`"0.6.0"`** |
| `PLUGIN_VERSION` | `plugins/lib/router-core.mjs` → **`'v0.6.0'`** |
| 各文件头部 | `router-core.mjs` 头部 `(v0.6.0)`；`plugins/routing-suite.ts` 头部 `v0.6.0` |
| `README.md` | `:1` 标题 → **`v0.6.0`**；`:66`（`dev_router_status` 显示值）→ **`v0.6.0`** |
| `docs/PORTING.md` | 追加 **v0.6.0** 基线锚点段（标注本轮 = 宿主缝重构 + 双线共存 + 阶段化门控 + 版本）；既有 v0.5.0 段**未改写** |
| 全文一致 | `package.json` / `PLUGIN_VERSION` / `README.md:1` 三者一致为 `0.6.0` / `v0.6.0` |

**两处归属更正（本轮 C 组，非机械替换）**：`plugins/lib/router-core.mjs:126` 与 `:162`
原把**阶段化门控**的落地记在 **v0.5.0** 头上，但 v0.5.0（= `HEAD`）**根本没有门控**
——依据（本机复核）：`git show HEAD:plugins/lib/router-core.mjs` 的 `GLOBAL_SAFE` 是 **21 项全量版**
（含 `write`/`edit`/`apply_patch`），`git show HEAD:plugins/lib/progressive.ts` 里
`visibleTools|GATE|unlockedFor` **零命中**。门控是**本轮**接上的 ⇒ 两条注释**已更正为 v0.6.0**。

**B 组（历史引用，一律不动）**：`README.md:16/120/186`、`docs/PORTING.md:28/53`、
`plugins/lib/router-core.mjs:114/218/249`、`plugins/lib/progressive.ts:7/21`、
`plugins/lib/engine.ts:31/520/535`、`plugins/lib/host/v1.ts:81`、
`plugins/lib/host/v2.ts:123`（该处是 **`classic v0.3.1`**，冻结回退自身的版本号）。
