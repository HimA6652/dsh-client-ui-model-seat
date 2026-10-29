# dsh-client-ui-model-seat 维护手册

> 读者：要改这个插件的人（包括未来的你）。
> 目标：不读 3601 行也能定位改动点；改完知道为什么没坏。
> 行号基线：`lib/client.js` 共 3601 行、`BUILD = 0.2.1+merge`。**行号会漂移**，
> 每一处都同时给了函数名或唯一字符串，以函数名为准、行号为辅。

## 0. 三十秒上手

- 这是一个**单文件 bundle 插件**：`lib/index.js`（Host 半边，空实现）+ `lib/client.js`（浏览器半边，3601 行，手写，无构建步骤）。
- 它只做一件事：抢占会话输入框里 `conversation.input.model` 这个**槽位**，把 dsh 自带的模型选择器换成"供应商列 + 模型列 + 粒子思考滑块"三合一控件。
- 它同时是 A（`dsh-client-ui-gpt-helper`：外壳、粒子滑块、配色面板、i18n）和 B（`dsh-model-provider-prefix`：两列卡片骨架）的合并体，两个上游都不能同时装 —— 它们注册同一个槽位、同一优先级，运行时会抛。
- 唯一必须守住的特性：**卡片尺寸只能由锚点与布局决定，不能由内容决定**。所有看起来"多余"的代码（freeze、floor、scrollbar-gutter、query 不改布局）都是为了这条。

## 1. 仓库地图

| 路径 | 作用 | 改动时要动它吗 |
| --- | --- | --- |
| `lib/client.js` | 全部前端实现与样式（3601 行） | 是，几乎所有功能改动都在这里 |
| `lib/index.js` | Host 半边；只导出 `name` 与空的 `apply()` | 基本不动（`validate` 禁止 Host 半边碰 DOM） |
| `cordis.patch.yml` | 往 profile 插一行 `{ id: model-seat, name: dsh-client-ui-model-seat }` | 换插件 id 时才动 |
| `package.json` | `dsh.client` / `dsh.bundle.patch` / `files` / scripts | 加脚本、改注入目标时动 |
| `README.md` | 对外说明（英文） | 行为变更时同步；已知限制、安装通道、测试命令都在里面 |
| `README.zh.md` | 同一份说明的中文版（202 行）；与英文版顶部的语言开关互相指向 | 改英文版时同步；两份的命令与表格必须等价 |
| `CHANGELOG.md` | 面向用户的版本说明；GitHub Release 的正文来源 | 每次发版前**先**写，`release.mjs` 会硬拦没有的一节 |
| `MAINTENANCE.md` | 本文（中文） | 结构变更时同步 |
| `MARKET.md` | 投递 dsh 插件市场的完整步骤与条目内容 | 市场规则变化时同步 |
| `assets/` | 图标与三张截图（截图由 `npm run shots` 生成，不手抠） | 换皮时重跑 `shots` |
| `screenshots.json` | 声明仓库里的截图给市场 nightly 抓取（1-8 条相对路径） | 增删截图时同步 |
| `publish/market-entry.yml` | 待提交给 `awesome-dsh-plugin` 的条目 | 与 `package.json` 描述保持一致 |
| `.github/workflows/release.yml` | `v*` 标签触发，跑自检与测试后建 GitHub Release | 随发版流程变化 |
| `.github/workflows/ci.yml` | 推到 `main` / 每个 PR / 手动触发：`npm run check` + 真实 Edge 的 `npm run e2e`，截图作为 artifact 留存 | 加检查项或换 runner 时 |
| `MERGE-PLAN.md` | 合并前的设计文档，**历史档案**；文首"实施结果"一节记录了与设计的偏差 | 不改，只在重大偏差时补一行 |
| `scripts/validate-plugin.mjs` | 清单/补丁/入口/bundle 加载/apply 的静态+运行时校验（80 项） | 新增入口契约时加检查 |
| `scripts/doc-anchor-check.mjs` | 校验本文里 `符号`（行号）锚点与区间仍落在 `client.js` 内，并核对"3601 行"这个自称 | 本文改结构或 `client.js` 增删行后会被自动覆盖 |
| `scripts/css-audit.mjs` | 样式表作用域、死类、border-box、上游属性残留的审计 | 新增 `.ms-` 类时会被自动覆盖 |
| `scripts/loadcheck.mjs` | 针对本机 dsh checkout 做加载与优先级排序检查（无 checkout 时跳过） | 少动 |
| `scripts/check-secrets.mjs` | 凭据形状与本机路径扫描（33 个文本文件） | 新增本机相关文档时会被自动覆盖 |
| `scripts/check-pack.mjs` | `files` 与真实 npm 制品的四向对账 | 增删发布文件时 |
| `scripts/release.mjs` | 一条命令发版：四道门 → 检查 → npm → 提交 → 标签 → 推送 | 发版规则变化时 |
| `scripts/release-notes.mjs` | 从 CHANGELOG 抽 Release 正文 | 少动 |
| `scripts/shots.mjs` | 生成 `assets/screenshot-*.png`（真实 bundle + demo 数据，2 倍图） | 换皮或加截图时 |
| `scripts/browser-check.mjs` | 真浏览器 E2E（CDP + headless Edge），9 个段落 | 交互变更时同步 |
| `scripts/live-check.mjs` | 在**真实 dsh** 页面上跑的断言 | 同上 |
| `test/*.test.mjs` | 41 个 node:test 用例（frame/i18n/register/rows/bolt） | 同上 |
| `test/harness/` | fixture 页面：假的槽位注册表 + 假的模型目录 | 需要新 fixture 时动 |
| `test/vendor/` | React 开发版 UMD（`react.js` 110 KB + `react-dom.js` 1.08 MB，MIT），E2E/live-check 的页面依赖；**插件运行时不使用**（运行时从宿主 `__ModuleLoader__` 取 React） | 只在升级 React 时替换 |
| `tools/merge/gen-client.mjs` | **历史工具**，从 A 的 bundle 生成初稿；**默认拒绝运行**，`--force` 才覆盖且先写 `lib/client.js.bak-gen-<时间戳>` | 只在考古时读 |
| `.research/` | 两个上游仓库的只读克隆，供对照 | 只读 |
| `memory/` | 项目记忆（11 篇，中文）；**已在 `.gitignore` 里，不进仓库也不进 npm 包** | 决策/事故/待办变化时 |
| `.shots/` | E2E 截图输出 | 可删 |
| `node_modules/` | 空（无运行时依赖）；`link:` 安装后由宿主提供 React | 不提交 |

依赖关系：**零运行时依赖**。`require("react")` / `require("react-dom")` 由模块加载器注入；不再声明 `peerDependencies`（`link:` 安装无法解析 peer，且两半都不 import cordis）。

## 2. 运行时链路

```
~/.dsh/profiles/<profile>/package.json  dependencies + dsh.profile.bundles 里有 dsh-client-ui-model-seat
        │
        ▼  profile boot（Electron 启动 / `dsh --profile X`）
cordis 读 bundle 的 dsh.bundle.patch → cordis.patch.yml → echo - insert: { id: model-seat }
        │
        ▼  Web 前端的模块加载器
window.__ModuleLoader__.load({ id: "dsh-client-ui-model-seat", factory })   ← lib/client.js 第一行
        │
        ▼  cordis 调 apply(ctx)，ctx 带 inject 列表（slots / modelDirectories / sessions / locale / remote）
apply()  →  ① 先写 <style id="dsh-model-seat-style">（构建好的 CSS 文本）
           ② 注册 i18n 词典（NS = "model-seat"）
           ③ slots.inject("conversation.input.model", () => slots.register({ …, priority: -2 }, SeatBoundary))
        │
        ▼  槽位渲染：<SeatBoundary><ModelSeat …/></SeatBoundary>
ModelSeat  useSyncExternalStore(directory) → 读快照 → 渲染触发器 + portal 卡片
```

四个关键点：

1. **`priority: -2` 是"更低的数字优先"**。dsh 自带的控件是 `0`，两个上游都是 `-1`；`-2` 既压住它们、又不会触发"同优先级重复注册"的异常。改动优先级前先读 `registerSeat()` 的注释。
2. **`available` 由宿主给**：`sessions.subagentAddress(sessionId) === undefined`。被寻址的子代理会话里不渲染控件（`return null`），这不是 bug。
3. **每个会话一个目录**：`modelDirectories.directoryFor(sessionId).store`，`subscribe`/`getSnapshot` 就是这个 store。
4. **顺序契约**：`<style>` 必须在第一次渲染前进 `<head>`，否则首帧是裸 DOM（E2E 的 "sheet injected once" 与 `register.test.mjs` 都在守这一条）。

## 3. `lib/client.js` 代码地图

文件是"分区 + 函数式"结构，自上而下 12 段：

| 段 | 行 | 内容 | 关键符号 |
| --- | --- | --- | --- |
| 1 | 1–61 | 加载器外壳与常量 | `BUILD`、`NS`、`CONFIG_KEY`、`DEFAULT_HOTKEY` |
| 2 | 62–270 | 颜色 token 表与规范化 | `COLOR_TOKENS`（62）、`TOKEN_BY_KEY`、`normalizeColors/Sides/Slots`、`tokenValueFor`（243） |
| 3 | 271–370 | 明暗判定与热键解析 | `THEME_ATTRIBUTE`（271）、`detectSide`（284）、`parseHotkey`、`hotkeyMatches` |
| 4 | 371–709 | 配置 schema v3 + 迁移 + store + 闪电记忆（含 cookie 镜像与跨会话交接） | `defaultConfig`（371）、`normalizeConfig`（392）、`configToDocument`（418）、`importSchemes`、`createStore`（505）、`CONFIG_STORE`（530）、`BOLT_KEY`（555）、`BOLT_COOKIE`（556）、`BOLT_LAST`（571）、`BOLT_COOKIE_SESSIONS`（577）、`BOLT_COOKIE_BYTES`（578）、`normalizeBoltRecord`（580）、`parseBoltMemory`（593）、`readCookie`（610）、`readBoltMemory`（631）、`writeBoltCookie`（639）、`BOLT_STORE`（657）、`writeBoltMemory`（670） |
| 5 | 710–1272 | 生成样式表 | `cssStatements`（734）、`resolveSide`、`buildCss`（771）、`CSS_TEMPLATE`（792 起；内含 `.ms-empty` 空状态规则） |
| 5b | 1273–1410 | i18n 词典 | `ZH`（1273）、`EN`（1342） |
| 6 | 1411–1523 | 图标与粒子 | `Caret`（1412）、`BOLT_PATH`（1435）、`Bolt`（1437）、`ResetIcon`（1453）、`Check`（1472）、`PARTICLES`（1491）、`levelRatios`（1517） |
| 7 | 1524–2260 | 外观面板与其 hooks | `PANEL_STORE`（1530）、`ConfigPanel`（1560）、`useConfigPanelHotkey`（2233） |
| 8 | **2261–2388** | **几何引擎（核心）＋闪电回退与交接** | `CARD_GAP`（2267）、`CARD_TALL`（2269）、`COLUMNS_WIDTH`（2271）、`PANEL_WIDTH`（2272）、`PANEL_MIN_HEIGHT`（2282）、`MODELS_MIN_ROWS`（2286）、`MODELS_ROW_HEIGHT`（2290）、`MODELS_CHROME`（2291）、`MODELS_MIN_HEIGHT`（2292）、`clamp`（2294）、`frame`（2302）、`geometryKey`（2333）、`boltReturnIndex`（2347）、`boltMemoryFor`（2373） |
| 9 | 2389–2464 | 行模型（纯函数） | `groupById`（2389）、`providerLabel`（2398）、`providerRows`（2405）、`modelRows`（2436） |
| 10 | 2465–2573 | 样式注入与注册 | `STYLE_ID`（2466）、`applyStyleSheet`（2468）、`WarnGlyph`（2481）、`SLOT`（2492）、`registerSeat`（2529） |
| 11 | **2574–3553** | **`ModelSeat` 组件** | 状态、几何、选择、滑块、渲染（见下表） |
| 12 | 3554–3601 | 导出半边 | `inject`、`apply`、`__internals`（3586） |

`ModelSeat` 内部再分 9 块（行号 = 未发布的工作树，`lib/client.js` 3601 行）：

| 块 | 行 | 说明 |
| --- | --- | --- |
| hooks 与 store | 2574–2607 | `useSyncExternalStore`（2575）、11 个 `useState`（2579–2592）、7 个 `useRef`（2594–2600）、`useConfigPanelHotkey`（2602）、配色 store（2603） |
| 派生数据 | 2608–2742 | `groups`（2608）、`current`（2609）、`pending`（2610）、`busy`（2611）、`disabled`（2614）、`layout`（2620）、`choices`（2622）、`currentChoice`、`reasoning`/`efforts`/`effectiveEffort`、`levels`、`ratios`、`levelIndex`、`displayIndex`、`displayLabel`、`modelLabel`（2668）、`isUltra`（2676）、闪电记忆 `boltMemory`（2683）、`hasBolt`（2689）、`atTop`（2690）、跨会话交接 `boltBack`（2693）/`boltBackFromMemory`（2711）、**`boltOn = hasBolt && boltBack !== null`（2706，0.2.2 起在顶档但没记忆不算开）**、`boltIdleAtTop`（2709）、`boltBackIndex`（2710）、`boltTitle`（2713）、换模型清记忆（2719–2728）、`shownRatio`（2730） |
| 开关与关闭 | 2743–2800 | `close`（2743）、`toggleCard`（2759）、外部 pointerdown 与 Escape |
| 几何 ①锚点 | 2801–2831 | 量触发器盒、监听 resize/滚动、`setRect`（只在盒变化时）、`place`（2801） |
| 几何 ②冻结 | 2832–2922 | `frameKey`（2832）、`anchorKey`（2835）、`measure`（2846）、按本布局宽度量（先写 `card.style.width` 再量）、`carry`（2875）、`frame()`、`document.fonts.ready` 复量 |
| 选择提交 | 2923–2963 | `submit`（2923）、`showQuota`（2932）、`applyLevel`（2941）：除闪电以外的任何改档都会清掉闪电记忆 |
| 闪电 | 2964–3031 | `toggleBolt`（2964）把按下前的 effort 记进会话存储并跳到最高档，再按回到那一档；`boltIdleAtTop` 时直接 return（不发明记忆），回退分支带 `dropLast` 退役跨会话镜像；`chooseModel`（2988）、`reset`（3006）紧接其后，同样清记忆 |
| 滑块指针 | 3032–3168 | `ratioFromClientX`（3032）、`nearestIndex`（3043）、`snapBack`（3056）、`beginDrag`（3075）、`finishDrag`（3094）、`cancelDrag`（3114）、`onSliderKey`（3148） |
| 渲染 | 3169–3553 | `triggerTitle`（3169）、`triggerProvider`（3175）、`triggers`（3182）、两列、思考面板 head（`data-quota` / `data-bolt`，3385–3386）、`effort-bolt`（3394，`disabled: sliderDisabled || boltIdleAtTop` 在 3398）、`effort-reset`（3425）、portal（3510）、根节点（3546） |

参数化的纯函数（`__internals` 暴露，测试直接用）：

- `frame(anchor, layout, naturalHeight, floorHeight) -> { left, bottom, width, height, flipped }`
- `geometryKey(layout, status, levelCount) -> string`
- `providerRows(state, currentProvider) -> Row[]`、`modelRows(group, query, current) -> Row[]`
- `boltReturnIndex(levels, memory, defaultEffort) -> number`：闪电要回到的档位下标 —— 先按 effort id 认记忆里的那一档，其次是模型默认（默认就是顶档则跳过），再其次是顶档下一档；`-1` 表示无处可回
- `boltMemoryFor(records, sessionKey, provider, model, atTop) -> record | null`：本会话的记录优先；本会话没有时，只有在**已经处于顶档**才借上一次启动留下的 `last` 交接记录，且必须同 provider/model
- `groupById(groups, id)`、`providerLabel(state, id)`

## 4. 必须守住的 10 条不变量

> 每一条都被某个检查守着；如果想改某条，先改检查，再改代码。

| # | 不变量 | 破坏后的症状 | 守护者 |
| --- | --- | --- | --- |
| 1 | `frame()` 只依赖 anchor / layout / natural / floor，**不读 DOM、不读内容** | 闪动复现；高度在指针悬停时来回跳 | `frame.test.mjs` 全部 10 例 |
| 2 | 改动 `layout` 才允许改宽度；**query 不参与** `layout` 计算 | 打字时卡片变宽变窄、搜索框在指针下移位 | `browser-check` 第 4 段的 `layout === "columns"` |
| 3 | 卡片 `box-sizing: border-box`，且内联 `height` 等于实测值 | 内边距把实测高度撑爆 → 每次复量都变大 | `css-audit` 的 border-box 检查 + `still.heights` 只有一个值 |
| 4 | 列的滚动发生在列内部（`.ms-rows { overflow-y: auto; scrollbar-gutter: stable }`） | 60 个模型把卡片顶高；滚动条出现/消失再引起宽度跳 | `still.modelsScroll`（1920/345）与 `still.changes === 0` |
| 5 | 复量只在 open / pane / anchor / status 变化时发生，**hover 从不复量** | 悬停切换供应商就抖动 | `still` 段落连采 900 ms |
| 6 | 只注册**一个**座位，`priority: -2`，槽位名 `conversation.input.model` | 与上游同时装时抛异常；或渲染两份控件 | `register.test.mjs` + `validate`（one registration / priority -2 / slot name） |
| 7 | 全站只有**一个** `<style id="dsh-model-seat-style">`，且在 `<head>` | 多人重复 apply 后样式重复膨胀；热更新后旧样式残留 | `register.test.mjs` + `validate`（one style element / head still has one sheet） |
| 8 | 不出现 `data-dsh-pm-*`、不出现 `data-gpt-helper`、不出现上游模块 id 与上游存储键 | 与上游 CSS 互相污染（B 的 `<style>` 永不删除，A 的 `[data-gpt-helper]` 规则也可能命中） | `validate` 的 no watchdog aliases / no hereditary aliases / no upstream id / no upstream key |
| 9 | 所有颜色走 `var(--c-*)` 标记 → `buildCss` 解析成字面量 | 本色 Chromium 丢弃只含 `var()` 的声明 → 整块颜色失效 | `css-audit` 的 unresolved colour markers |
| 10 | `.ms-*` 规则必须挂在控件根下（`[data-model-seat]` 前缀） | 规则泄漏到宿主页面其它组件 | `css-audit` 的 no unscoped .ms- selectors / every rule rooted in the control |

## 5. 几何引擎（为什么卡片不会自己动）

### 5.1 `frame()` 的公式

```js
width  = clamp(layout === "columns" ? 416 : 300, 0, innerWidth  - 24)
wanted = min(max(natural, floor), 420)          // floor = 冻结的既有高度，缺省 0
above  = anchor.top    - 8                      // CARD_GAP
below  = innerHeight - anchor.bottom - 8
flipped = above < wanted && below > above
room    = flipped ? below : above
floor2 = layout === "columns" ? 333 : 96        // 两套下限（0.2.1 起）
height = max(floor2, min(wanted, room))
left    = clamp(anchor.left, 12, innerWidth - width - 12)
bottom  = flipped ? innerHeight - anchor.top + 8 : innerHeight - anchor.bottom - 8
```

`bottom` 用 `position: fixed` 的底边定位，因此卡片是从底边往上长的 —— 这正是上游闪动的物理来源，也是为什么 `natural` 必须被冻结而不是每帧重算。

### 5.2 两段式几何

```
open/pane/anchor/status 变化
   │
   ├─ ① 锚点段（2796–2830）：读触发器 getBoundingClientRect → setRect（只有盒真的变了才 set）
   │
   ├─ ② 冻结段（2832–2922）：card.style.width 先定成本布局宽度；card.style.height = "auto"; maxHeight = "none"
   │        natural = card.offsetHeight      ← 用 offsetHeight 而不是 rect.height
   │        因为入场动画有 transform: scale()，rect 会被缩放
   │        恢复原 height/maxHeight；setFrozen(frame(rect, layout, natural, floor))
   │
   └─ 之后：hover、查询、滚动列内部 —— 一律不复量（滚动只更新 rect，不改 natural）
```

`floor`（"地板"）语义：**同一个锚点内，高度只能变大**。它解决的是"思考面板比模型卡片矮"这一类切换：从 420 的卡片切到更矮的面板时，卡片不会当场塌到指针下方的搜索框上。锚点变化（resize / 滚动）把 floor 归零。

### 5.3 为什么不用纯 CSS 自适应

因为三条约束同时成立时，CSS 给不出稳定解：

1. 卡片是 `position: fixed` + 底边锚定（触发器的位置由宿主决定）；
2. 内容的**高度**由指针所在行决定（hover 换列）；
3. 内容必须完整显示（不能裁切，`overflow: hidden` 会让"列表显示不全"变成另一个 bug）。

用 JS 冻结一次测得的高度，是把"内容 → 布局"这条边切断；CSS 只能把三条约束里的一条做成动态的，于是必然形成自反馈环。

## 6. 样式系统

### 6.1 三段式

1. **token 表**（`COLOR_TOKENS`，68–133）：每一行是 `{ key, label, cssVar, light, dark }`，`cssVar` 形如 `--c-trigger.model`。`--c-menu-*` 一组必须两侧都给值——面板底色取自宿主的 `--dsw-alias-bg-layer-1`，浅色主题下就是白卡（0.1.3 修的就是这里）。
2. **模板**（`CSS_TEMPLATE`，676 起）：所有颜色写成 `var(--c-*)`，**不写具体色值**。模板分两段：`.gptm-*`（外壳/触发器/面板，来自 A）与 `.ms-*`（两列卡片，来自 B）。
3. **构建**（`buildCss`，655）：把每个 `var(--c-*)` 按 light 值解析 → 得到主样式表；再把每条语句按 dark 解析，只有**解析结果不同**的语句才进 `html[data-ds-theme-source="dark"] { … }`；最后加一个 `@media (prefers-color-scheme: dark)` 兜底（页面没有主题属性时生效）。

颜色改动因此不需要动 CSS：改 token 的 light/dark 值，`buildCss` 输出的文本就变了，`applyStyleSheet` 发现文本不同才替换 `<style>` 内容。

反过来，**只有明暗两侧解析结果不同的 `var(--c-*)` 语句才会多出那两份主题覆盖副本**；宿主 token `var(--dsw-*)` 不进 `resolveSide`，挂在它上面的规则永远只有一条。据此判断计数变化：

- 改掉/删掉一条含 `--c-*` 的规则 → 计数 **−2**（0.1.3 把触发器斜杠的颜色去掉：193 规则 / 205 选择器 → 191 / 203，diff 里正是一条 `html[data-ds-theme-source="dark"]` 副本加一条 `@media` 副本）；
- 反过来，**给一条只有 dark 值的 token 补上 light 值** → 用到它的规则突然“两侧解析结果不同”，每条多出两份副本：计数 **+2**。0.1.3 给 `--c-menu-*` 补 light 值就是这么多了 10 规则 / 10 选择器（190 / 202 → 200 / 212）；
- 整条删掉一条只挂 `--dsw-*` 的规则 → 计数 **−1**（0.1.3 删掉 `.gptm-hint`：191 / 203 → 190 / 202）。

看到计数变了先按这两条归类，不是规则丢了。

### 6.2 三个必须知道的浏览器事实

1. **只含 `var()` 的声明会被丢弃**：本项目所在的 Chromium 里，`color: var(--x)` 在 `--x` 未定义时整条声明消失（不是回退到 inherit）。所以模板里禁止裸 `var(--dsw-*)`，只用 `var(--c-*)` 标记；`css-audit` 的 "no unresolved colour markers" 在守这条。
2. **`0.5px` 在 dpr=1 上渲染成 1 设备像素**：`border: 0.5px` 计算值是 `0.5px`，但 `getComputedStyle` 报 `1px`（实测 `searchBorder` 为 `1px solid rgb(230, 234, 239)`）。视觉上是 1px 发丝线，属于预期。
3. **dsh 不设全局 `box-sizing: border-box`**（逐组件声明），所以卡片必须自己声明，否则内联宽度是内容宽、轨道宽 22px。

### 6.3 命名空间与作用域规则

- 结构类用 `gptm-`（外壳）与 `ms-`（卡片）。
- `.ms-*` 一律写成 `[data-model-seat="menu"] .ms-row` 这种**从控件根出发**的选择器；`css-audit` 会拒绝裸 `.ms-*`。
- 颜色只用 `var(--c-*)`；尺寸/间距用字面量（`168px`、`32px`），改宽度时同步改 `COLUMNS_WIDTH`。
- 不写 `!important`（`css-audit` 拒绝）。

### 6.4 卡片的度量（改宽度必看）

| 部分 | 值 | 定义处 |
| --- | --- | --- |
| 卡片外框（列布局） | `padding: 4px`、`border: 0.5px`、`border-radius: var(--dsw-radius-md)` | `.gptm-menu[data-pane="models"]` |
| 供应商列 | `flex: 0 0 168px` | `.ms-col[data-col="providers"]` |
| 模型列 | `flex: 0 0 236px`，`margin-left: 2px`，`padding-left: 6px`，`border-left: 0.5px` | `.ms-col[data-col="models"]` |
| 合计宽度 | `168 + 236 + 2 + 4*2 = 416` | `COLUMNS_WIDTH` |
| 思考面板宽度 | `300` | `PANEL_WIDTH` |
| 行 | `min-height: 32px`、`padding: 5px 8px`、`font: 13px/20px` | `.ms-row` |
| 搜索框 | `height: 30px`、`border: 0.5px`、`margin: 2px 4px 4px` | `.ms-search` |
| 列头 | `padding: 6px 8px 3px`、`11px/16px`、`weight 500` | `.ms-colHead` |
| 分隔线 | `height: 0.5px`、`margin: 3px 4px` | `.ms-sep` |

**改宽度 = 改三处**：CSS 里的 `flex-basis`、`COLUMNS_WIDTH` 常量、`frame.test.mjs` 里的期望值（`416`）。漏一处会被 `browser-check` 的 `shape.width` 抓住。

## 7. 数据流

### 7.1 快照形状（来自宿主，只读）

```js
state = {
  status: "loading" | "ready" | "error",   // 决定 geometryKey 的一部分
  groups: [ { id, name, models: [ { id, name, reasoning: { defaultEffort?, efforts: [{ id, name }] } } ] } ],
  current: { provider, model, reasoningEffort? } | null,
  pending: null | { … },                  // 非 null 表示宿主还在落盘 → busy
  errors / error,                         // error 渲染在卡片顶部一行
  failures: [ id | { id, name } ],        // 加载失败的供应商 → 生成 retry 行
  retainedEffort: string | undefined,     // 模型没有等级时的显示兜底
}
```

### 7.2 派生链

```
groups ──► choices（扁平化所有 {group, model}）──► currentChoice（按 current.provider/model 找）
currentChoice.model.reasoning ──► efforts ──► levels（必要时前置 provider-default）
levels ──► ratios（levelRatios(n)：桩位比例）──► 滑块 --value；levels 也进 geometryKey
levels + effectiveEffort ──► levelIndex ──► displayIndex（拖动时用 dragIndex 覆盖）──► displayLabel
modelLabel = 名称 ?? "provider/model" ?? loading/fallback 文案
```

`levels.length` 参与 `geometryKey`：等级数变化（换模型）会触发一次复量，这是**唯一允许在打开状态下改变高度**的路径，且高度只会变大（floor）。

### 7.3 写入路径

| 动作 | 调用 | 关闭卡片 |
| --- | --- | --- |
| 点模型行 | `select({ provider, model, reasoningEffort })`，`reasoningEffort` 取该模型的 `defaultEffort`（若就是当前模型则沿用当前值） | 成功才关 |
| 拖动/键盘改等级 | `applyLevel(index)` → `select({ provider: current.provider, model: current.model, reasoningEffort })` | 不关 |
| 复位按钮 | 选回 `defaultEffort ?? efforts[0].id`（`reset`，2984） | 不关 |
| retry 行 | `load()` 重新拉取该供应商 | 不关 |

`submit()`（2904）只关心 `result === undefined || result.ok === true` 才算成功；失败时卡片**保持打开**，错误由宿主的 `error` 字段渲染出来。这是刻意的：关掉卡片会藏起失败原因。

## 8. 交互状态机

### 8.1 状态

| 状态 | 类型 | 初值 | 谁改它 |
| --- | --- | --- | --- |
| `open` | boolean | `false` | `toggleCard` / `close` / Escape / 外部 pointerdown |
| `pane` | `"thinking" \| "models"` | `"thinking"` | 两个触发器、`.gptm-status` |
| `query` | string | `""` | 模型列里的 `.ms-search` |
| `rect` | anchor 盒 \| null | `null` | 几何 ① 段（只在盒变时 set） |
| `frozen` | `{ key, frame }` \| null | `null` | 几何 ② 段 |
| `hoveredProvider` | id \| null | `null` | 供应商行的 mouseenter/focus（查询模式下被 `pinned` 屏蔽） |
| `quota` | boolean | `false` | 打到最高档时的配额提示（145 ms 后出现，1350 ms 后消失） |
| `dragging` / `snapping` / `dragIndex` / `dragRatio` | 滑块手势态 | — | 滑块 pointer 事件 |

全局（不随组件走）：`CONFIG_STORE`（配色）、`PANEL_STORE`（外观面板开关）。

### 8.2 转移

| 触发 | 结果 |
| --- | --- |
| 点模型触发器 | `pane !== "models"` → 切到 models 并打开；已经是 models → 关闭 |
| 点思考触发器 | 同理，目标是 thinking |
| 打开时清空 | `query = ""`、`hoveredProvider = null`、`load()` 重新拉目录 |
| Escape / 卡片外 pointerdown | `close()`：`open=false`、`pane="thinking"`、`rect=null`、`frozen=null`、`hoveredProvider=null` |
| 打开外观面板 | 热键（默认 `Ctrl+Shift+Alt+G`）→ 卡片自动关闭（`panelOpen` 副作用） |
| 选模型成功 | 关闭卡片 |
| 选模型失败 | 保持打开，顶部显示宿主 `error` |

### 8.3 两种布局，一个 frame

| pane | layout | 宽 | 内容 |
| --- | --- | --- | --- |
| `models` | `columns` | 416 | 供应商列 + 模型列（列头/搜索/行） |
| `thinking` | `panel` | 300 | 头部（状态按钮 + 复位）+ 粒子滑块 |

**布局只由 `pane` 决定。** `query` 只改变模型列里渲染哪些行，不改变布局、不改变宽度、不触发复量。

### 8.4 可访问性契约

- 两个触发器：`aria-haspopup="dialog"`，`aria-expanded` 绑定各自 pane；思考触发器另有 `aria-label` 与 `title`，两句都跟着当前档位走。
- 卡片：`role="dialog"`；两列容器：`role="group" aria-label=t("aria.modelProvider")`。
- 行：`role="menuitemradio"` + `aria-checked`（选中项为 `true`）。
- 滑块：`role="slider"` + `aria-valuemin/max/now/valuetext`；`Home`/`End`/方向键可用。

## 9. 配置与持久化

### 9.1 schema v3

```js
{
  version: 3,
  hotkey: "Ctrl+Shift+Alt+G",        // 面板热键；非法输入回落到默认值并报 invalid
  paused: false,                     // 总开关：true = 全部使用出厂色（配色保留）
  crossApply: null | "light" | "dark" // 用哪一侧的配色同时渲染两侧
  slots: { light: { scheme: name|null }, dark: { scheme: name|null } },
  schemes: { [name]: { name, colors: { [tokenKey]: "#rrggbb" } } },
  sides:   { light: { [tokenKey]: "#rrggbb" }, dark: { … } },
}
```

### 9.2 一个 token 的最终色（优先级，自高到低）

1. `paused === true` → 出厂色（`token.value` / `token.dark`）；
2. `sides[side][key]` —— 面板里手工调的那一格；
3. `schemeForSide(config, side).colors[key]` —— 当前侧激活的配色方案；
4. 出厂字面量。

**第 2 条故意压过第 3 条**：面板行写的就是 `sides`，反过来会让"刚输入的颜色"被激活方案吞掉，表现为"改了没反应"。

`crossApply` 只影响 `schemeForSide`（渲染），不影响 `editScheme`（面板编辑的目标侧）。

### 9.3 迁移

`normalizeConfig`（392）接受三种输入：

- v1：扁平 `colors: { token: value }`；
- v2：`colors: { light: {…}, dark: {…} }` 的按侧表；
- v3：当前形状。

迁移后统一升成 v3；同时**清掉指向不存在方案的激活**（`slots[side].scheme` 指向已删除的方案时置 `null`），避免出现"激活了一个空方案"。

**不读上游存储键**（`dsh-client-ui-gpt-helper:config:v1`）：schema 变了，静默半迁移比回默认值更糟。`validate` 里有检查专门防止上游键复活。

### 9.4 快速档动效（恒开）与闪电按钮

滑轨的粒子漂移是**常开**的：`.gptm-trail` 的基础 `opacity` 就是 `1`，粒子的 `--spin` 直接写 `1`（旧的 fast on 值），没有开关、没有长按锁，也没有持久化键。

- 0.2.1 把闪电**以新语义**恢复：它不是 fast 模式的开关，而是思考档位的跳顶按钮（`toggleBolt`，2945）。按下记住当前档的 effort id 并跳到最高档；再按按 effort id 找回原档（列表重建过就退回记忆里的下标）。任何其它途径改档 —— 滑块、方向键、复位、换模型 —— 都会清掉记忆（`applyLevel` 的 `keepBolt` 选项、`chooseModel`、`reset`、监听 `current?.provider` / `current?.model` 的效果）。
- 只有 `levels.length > 1` 才渲染闪电（`hasBolt`，2677）：单档模型没有“更高”可跳，head 收掉那一列而不是显示一个死按钮（`data-bolt="false"` 时网格回到 `1fr 34px`）。
- 重启之后是**新会话**（宿主每次启动都新开一个 session id，实测 `session-e3f3e1b1` → `session-44268fb2`），按会话分桶的记忆在那里查不到，所以 `writeBoltMemory` 额外写一个保留桶 `last`（`BOLT_LAST`）：`boltMemoryFor` 先查本会话，查不到且**已经在顶档**（`atTop`）才借 `last`，并且必须同 provider/model；桶满裁剪时 `last` 永不淘汰（`filter((key) => key !== BOLT_LAST)`）。
- 跳顶走 `announceTop: true`，和滑块拖到顶一样弹 1.35 s 的「更快消耗使用额度」横幅；横幅期间 head 的三个按钮 `opacity: 0` + `pointer-events: none`（`.gptm-head[data-quota="true"] .gptm-iconBtn`），所以第二次点击要等横幅消失。这个取舍与复位按钮早就存在的行为一致，不是新增。
- 0.1.3 及以前是 `FAST_STORE`（`dsh-client-ui-model-seat:fast:v1`，形状 `{ fast, locked }`）+ 600 ms 长按锁（`useLongPress`、`LONG_PRESS_MS`）。那条链路连同 `.gptm-fastToggle`、`LockMark`、`LockIcon`、`fast.label` / `fast.locked` 词条与 `data-fast` / `data-locked` / `data-tremble` 在 0.1.3 一次删净，0.2.1 没有把它带回来（§18 第 10、11 条）。
- 旧键既不读也不写，也不主动清理：用户回滚到 0.1.2 时锁定态还在。`validate` 的 `no fast-mode store` 守着它不复活。
- 再想要开关：先读第 4 节不变量 1/5 —— 开关会改内容高度，必须走 `frameKey`。

### 9.5 跨窗口

`window.addEventListener("storage", …)` 只在**其它**窗口写入时触发，所以本地写入无需广播；只有配色 store 会重读（`PANEL_STORE` 不落盘），不做合并。

## 10. i18n

- 一个命名空间 `model-seat`，在 `apply()` 里注册（早于第一次渲染），两种语言 `zh` / `en`。
- 组件拿到的 `t` 来自槽位注入的 `locale`；`t("a.b", { x })` 支持模板参数。
- 规则：
  1. 两个语言**键集完全一致**（`i18n.test.mjs`）；
  2. 代码里出现的每个字面量键都必须能解析（同上）；
  3. 不许有死键（"no dictionary entry is unreachable from the bundle"）：删功能时同步删键，例如移除返回箭头时一并删掉了 `action.back`；
  4. 中英文文案必须真的不同（防止复制粘贴时忘改）。
- 常用键：`pane.providers`（供应商）、`pane.models`（模型）、`search.placeholder`（搜索模型）、`provider.account`（DeepSeek 账户）、`retry.row`（重试）、`aria.modelProvider`。

## 11. 测试矩阵

### 11.1 一键

```
npm run check       # secret → pack → validate → docs → css → loadcheck → test   （约 5 s，不需要浏览器）
npm run e2e         # headless Edge + CDP                                 （约 20 s，用仓库内 test/vendor 的 react）
npm run check:all   # 两者
```

发版前的最后一道是 `prepublishOnly`（`check:pack` + `check:secret` + `npm test`）：`npm publish` 自己会把它跑一遍，绕过脚本手敲 `npm publish` 也躲不过去。

### 11.2 每个脚本守什么

| 脚本 | 数量 | 守的东西 | 失败时先看 |
| --- | --- | --- | --- |
| `check-secrets.mjs` | 34 个文件 | 凭据形状（GitHub/OpenAI/AWS token、私钥、npm authToken）与本机路径（Windows 用户目录、POSIX home、局域网 IP）；占位符白名单避免误报；行尾 `secret-ok` 可豁免 | 打印的文件:行号 |
| `check-pack.mjs` | 4 条断言 | `files` 无目录项、制品无备份/日志、`files` 全在、制品无清单外文件 | 打印的第一条 `✖` |
| `validate-plugin.mjs` | 103 项 | 清单字段、`files`、`exports`、补丁行 id/name、入口 `name`/`apply`、Host 半边不碰 DOM、只有一次 `__ModuleLoader__.load`、`apply` 是真函数、`__internals` 齐全、`BUILD` 存在且含版本、无上游模块 id/上游存储键、无 `data-dsh-pm-`、无 `data-gpt-helper`、8 个 `data-model-seat` 值齐全（含 `effort-bolt` / `effort-reset`）、无锁绘制（`no lock drawing`）、闪电九件套（绘制 `bolt drawing present`、双档位 `bolt needs two levels`、跳顶 `bolt jumps to the top level`、按 effort id 记与回 `bolt remembers its level` / `bolt restores by effort id`、按会话持久化 `bolt memory is per session` / `bolt memory survives a restart` / `bolt memory belongs to one model`、在顶档不算按下三件套（`the bolt only lights from a memory` / `the bolt is inert at the top` / `turning the bolt off retires the hand-over`）、记忆的 cookie 镜像 `bolt memory mirrors into a cookie` / `the cookie mirror is host-scoped` / `the cookie mirror is read when storage is gone` / `bolt outlives its conversation` / `the hand-over only speaks at the top` / `the hand-over is never aged out`）、座位键存在、只注册一次、槽位名、优先级 `-2`、locale 命名空间、按会话 inject、边界组件、词典注册、中英双语、只有一个 `<style>`、样式 id、样式体量、`frame` 契约（`per-layout frame floor`）、卡片规则（含 `eight-row model floor`）、槽位动画保留、样式复用、head 里只有一张表、可发布（没有 `private`）、license/author/repository 齐全、商店资产（图标存在、`screenshots.json` 可解析且 1-8 条相对路径都存在） | 打印的第一条 `✖` |
| `doc-anchor-check.mjs` | 107 符号 / 29 区间 | 本文每个 `符号`（行号）都还能在 `client.js` 的 3601 行里找到同名符号、区间不越界不倒序；顺带核对文首"3601 行"与 `BUILD` 版本号 | 打印的第一个越界锚点（`MAINTENANCE.md:行号 符号 不在 client.js:行号`） |
| `css-audit.mjs` | 182 规则 / 192 选择器 | `<style>` 注入、括号平衡、无 `!important`、无未解析颜色标记、无模板占位符、无上游属性选择器、选择器数 > 60、无裸 `.ms-`、每条规则挂在控件根下、每个渲染出的 `.ms-` 类都有规则、卡片是 border-box；死规则只 warn | `css-audit:` 汇总行 + 上一条 `✖` |
| `loadcheck.mjs` | 6 项 | 注入目标存在、槽位在加载的前端里声明、注册表按优先级排序、入口名与包名一致、`apply` 导出、补丁行 id 是新的、补丁只插一行；**没有 dsh checkout 时整体跳过**（不算失败） | `skipped` 说明 |
| `test/frame.test.mjs` | 10 | `frame()` 纯函数语义：列宽、面板更窄、短内容被本布局的下限抬起（列 333 / 面板 96）、上下翻转、锚点底边、无空间时不翻、视口夹取、封顶后与自然高度无关、`geometryKey` 只随三要素变、冻结高度只增不减 | 对应用例名 |
| `test/i18n.test.mjs` | 6 | 见第 10 节 | 对应用例名 |
| `test/register.test.mjs` | 6 | 注册恰好一次且 `-2`、每会话一个目录、子代理隐藏、`<style>` 只进 head 一次、没有直连服务时走 `ctx.inject`、没有 effect runner 也能注册词典、错误边界回落 | 对应用例名 |
| `test/rows.test.mjs` | 7 | `groupById` 容错、`providerLabel` 回显未知 id、供应商行 + retry 行、空状态、retry 行无 id 时按位置兜底、模型行标记当前项 + 大小写无关过滤、缺 group/缺名字 | 对应用例名 |
| `test/bolt.test.mjs` | 12 | `boltReturnIndex`：记忆里的 effort id 命中、id 已消失时退回模型默认、模型默认就是顶档时再退一档、供应商默认档（`effort` 为 `undefined`）、下面已无档位返回 `-1`、空 `levels` 返回 `-1`；`boltMemoryFor` 的交接语义：本会话的记录优先于 `last` 镜像、新会话在顶档时继承镜像、没到顶档时镜像沉默、镜像只对同一个 provider/model 说话、清掉本会话记录不影响下一次启动、一条记录都没有时返回 `null` | 对应用例名 |
| `browser-check.mjs` | 报告分组 | `shape` 两列卡片（宽度/内边距/搜索框在模型列/触发器整段 `provider/model` 无空格且斜杠与 provider 间距 ≤1.5px）、`still` 指针静置 60 个模型 900 ms 高度不变、`swapped` 悬停换列不位移、`reopened` 关→开可复现、`filtered` 查询跨供应商且布局不变、`selections` 思考面板滑块/键盘/闪电三态（未按 → 跳顶 → 回原档，手动改档即失效）/动效常开/复位按钮与选中后改名、`pane.inset` 顶底内缩相等、`shortCard` 八行下限 333 且列内滚动、`fast` 配色热键与状态按钮、`bolt` 的重载（7b）与**换 origin 重启**（7c：第二个 HTTP 服务器、`localStorage` 读回必须为 `null`、灯与「回到哪一档」仍要对）、**新会话交接**（7d：同一浏览器 profile、`?session=session-9` 的新页面，`localStorage` 仍为空，灯与回退档位由 `last` 桶给出、提交次数为 0）、`restart` 段记录新 origin 与读到的存储、`motion` 段记录减少动效前后的漂移，外加控制台无错误 | 报告里 `problems[]` 与 `shape`/`still`/`filtered` |
| `live-check.mjs` | 视页面而定 | 真实 dsh 页面上：样式只注入一次、触发器形如 `provider/model`、卡片能开、两列、显示前已量好（`data-ready`）、内联高度冻结、900 ms 内只有一个高度、思考面板无搜索框、Escape 关闭、闪电存在且未按下（只读，不点）、思考面板顶底内缩相等、闪电与复位按钮对比度 ≥ 4.5；`--publish` 额外点一个模型并断言触发器改名 | `problems[]` / `consoleErrors[]` |

### 11.3 fixture 的可调旋钮

`test/harness/index.html` 支持 `?providers=N&models=M&long=I&current=K`：

- `providers` 供应商数（默认 6）、`models` 每家模型数（默认 60，用来触发列内滚动）；
- `long` 长名字填充（验证省略号）、`current` 初始选中项；
- 每个模型都带 `low/medium/high` 三档、`defaultEffort = "medium"`；
- `directory.select` 会记到 `window.__selections` 并重新发布快照（所以选择后 UI 真的会变）。

### 11.4 读一遍就知道坏在哪

- `still.changes > 0` 或 `still.heights` 多于一个值 → 不变量 1/2/4/5 被破坏；
- `shape.width !== 416` → `COLUMNS_WIDTH` 与 CSS 不同步；
- `shape.colsTop > 5` → 有人把旧的 40px 头部加回来了；
- `shape.searchBorder` 里没有 `solid` → 搜索框边框又被写成 `none`；
- `filtered.layout !== "columns"` → 查询开始改变布局（闪动回归）。

### 11.5 CI（`.github/workflows/ci.yml`）

跑到 `windows-latest` 上，因为 e2e 是用 CDP 驱动**本机 Edge**（`msedge.exe`），不下载浏览器、不装 Playwright；仓库零运行时依赖，所以也没有 `npm ci`。

| 触发 | 说明 |
| --- | --- |
| `push` 到 `main` | 每次合并后跑一遍 |
| `pull_request` | 任何 PR |
| `workflow_dispatch` | 手动 |

步骤：`checkout` → `setup-node 22` → **Locate Edge**（找不到 `msedge.exe` 就直接失败，而不是让 e2e 报看不懂的错）→ `npm run check` → `npm run e2e -- --browser "$env:EDGE" --shot e2e-shots` → 上传 `e2e-shots`（`if: always()`，失败时也能看图）。

两个和本地不同、但值得知道的点：

- `concurrency: ci-${{ github.workflow }}-${{ github.ref }}` + `cancel-in-progress`：同一个分支连着推，只跑最后一版。
- CI **不重跑 `npm run shots`**：截图是给人看的资产，不同机器字形渲染不完全一致，拿它做字节级 diff 只会假红。

## 12. 在真实 dsh 上验证

### 12.1 临时 DSH_HOME（推荐，绝不碰自己的库）

```bash
SEAT_HOME=~/AppData/Local/Temp/seat-live-home
mkdir -p "$SEAT_HOME" && cp ~/.dsh/.credentials.yaml "$SEAT_HOME/"
export DSH_HOME=$SEAT_HOME
DSH=/path/to/dsh/node_modules/@deepseek-ai/dsh/lib/bin.js
# --from-default-profile 是启动参数，不是 plugin 参数：带它启动一次即可用 web 模板建出 seatcheck
node "$DSH" --profile seatcheck --from-default-profile web --help
node "$DSH" plugin --profile seatcheck add link:/path/to/dsh-client-ui-model-seat
node "$DSH" --profile seatcheck --port 6124 --host 127.0.0.1 --no-open
# 从 banner 里取 http://127.0.0.1:6124/?token=…
npm run live -- --url "http://127.0.0.1:6124/?token=…"
```

没有 `.credentials.yaml` 时模型目录是空的（卡片只有"未找到供应商"），所以要先复制。

### 12.2 拷贝 desktop profile（验证与用户整套插件共存）

桌面 profile 才是真实环境：把 `~/.dsh/profiles/desktop` 整个复制到临时 home 的 `profiles/<newname>`，把 `package.json` 里的 `name` 改成 `dsh-profile-<newname>`，再 `node bin.js --profile <newname> --port 6127 …`。这样 15 个插件一起加载，能验证"优先级 -2 与其它插件不打架"。

### 12.3 `live-check` 报告的读法

| 字段 | 含义 |
| --- | --- |
| `pageState.covered` | 页面被别的插件（例如用户须知弹窗）挡住时为 `true` —— 先处理遮挡，否则后面全不可信 |
| `triggers.{model,effort,build}` | 触发器文本、思考档位、`data-build`（确认加载的是当前构建） |
| `card.{layout,ready,height,width,providers,models}` | 卡片形状与数据量 |
| `still.{frames,heights}` | 900 ms 内采到的高度集合；理想是单元素数组 |
| `pane.{slider,now,max,trail,drift}` | 思考面板的内容：滑块档位、轨道透明度（恒为 1）、粒子动画 |
| `consoleErrors` | 只收集与座位相关的错误 |

`--publish` 会真的写账号模型选择，只在临时 home 上开。

## 13. 故障排查

| 症状 | 判据 | 处置 |
| --- | --- | --- |
| 输入框里出现**两个**模型控件 | 同时装了上游（`-1`）？但 `-2` 应压住它；更可能是宿主的自带控件版本变了 | 看 `~/.dsh/profiles/<p>/package.json` 的 `dsh.profile.bundles`；`validate` 的 "priority -2" 是否过 |
| 启动即报"同一槽位重复注册" | 本插件与上游**同优先级**了 | 确认 `registerSeat` 里是 `-2`；上游是 `-1` |
| 卡片打开后高度抖动 | `still.changes > 0` | 检查是否有人把内容塞进 frame 计算、或在 hover 里 set：见第 4 节不变量 1/5 |
| 打字时卡片变宽 | `filtered.layout` 不是 `columns` | `layout` 被人改回依赖 `query` 了 |
| 搜索框没有边框 | `shape.searchBorder` 无 `solid` | `.ms-search` 的 `border` 被删或被 `border: none` 覆盖 |
| 卡片顶部有大片空白 | `shape.colsTop > 5` | 旧的 40px 返回箭头行被加回来，或 `.gptm-menu[data-pane="models"]` 的 `padding: 4px` 丢了 |
| 触发器只显示模型、没有供应商 | `triggers.model` 里没有 `" / "` | `triggerProvider` 为空：`current === null` 或 `providerLabel` 拿不到组名 |
| 颜色改了没反应 | 面板里改了但界面不变 | ①`paused` 是否被打开；②是否被激活方案的同一 token 覆盖（第 9.2 节优先级）；③`<style>` 是否真的更新（看 `data-build` 与 head 里 style 的 `textContent` 长度） |
| 深色模式下颜色不对 | 页面 `<html>` 上有 `data-ds-theme-source` 吗 | `detectSide` 先读属性；属性缺失时靠 `prefers-color-scheme` |
| 思考触发器不出现 | 当前模型没有 `reasoning` 或没有等级 | `displayLabel === undefined` 时按设计不渲染 |
| 卡片浮在错误位置 | `flipped` 与预期不符 | 触发器靠近视口顶部时是**预期**翻转；检查 `CARD_GAP`/`CARD_MARGIN` |
| 列内滚动条一出现就抖 | 少了 `scrollbar-gutter: stable` | 见 `.ms-rows` |
| 升级宿主后卡片不出现 | 控制台有 `[model-seat] client half applied` 吗 | 没有 = `apply` 没被调用：`dsh.client.inject` 的目标包名变了 |

## 14. 常见改动配方

### 14.1 改卡片宽度

1. `.ms-col[data-col="providers"]` 的 `flex-basis` 或模型列同项；
2. `COLUMNS_WIDTH`（2271 行）改成新合计；
3. `test/frame.test.mjs` 里的 `416` 期望值；
4. `npm run check && npm run e2e`，看 `shape.width`。

### 14.2 加一个颜色 token

1. `COLOR_TOKENS` 加一行 `{ key, label, cssVar: "--c-<area>.<name>", value, dark }`；
2. CSS 里把硬编码色改成 `var(--c-<area>.<name>)`；
3. `npm run css`（未解析标记会被抓）；
4. 面板会自动多出一行（面板按 token 表渲染），无需改 UI。

### 14.3 加一条文案

1. `ZH` 与 `EN` **同时**加同一个键；
2. 组件里用 `t("...")`；
3. `npm test`（三处一致性与死键检查会自动覆盖）。

### 14.4 换存储键 / 升 schema

1. 改 `CONFIG_KEY`；
2. `defaultConfig` 的 `version` +1，在 `normalizeConfig` 里加迁移分支；
3. `configToDocument` 输出新形状；
4. 更新 `validate` 的 "seat keys present" 与 README/本文档；
5. 旧键**不删**（用户可能回滚），但也不读。

### 14.5 加第三个 pane

1. `pane` 的取值域加一项；
2. `layout` 映射里给它一个 layout（宽度常量要同步加）；
3. `geometryKey` 已经包含 `layout`，无需改；
4. 渲染分支加一条；
5. `browser-check` 加一段断言。

### 14.6 改搜索行为

- 现在：`needle === ""` → 显示 hovered/active 供应商的模型；否则 → **全供应商**扁平结果 + 每行 `provider` 注记 + `pinned`（禁止 hover 反过来重建列表）。
- 若改成"只搜当前供应商"：只需改 `modelCol` 的表达式，**不要**动 `layout`。

### 14.7 调优先级

`registerSeat` 里 `priority: -2`。任何等于上游（`-1`）或自带（`0`）的值都会让"同时安装"重新变成冲突。改完必须更新 `validate` 与 `register.test.mjs` 的期望值。

## 15. 与两个上游的差异对照

| 能力 | A（gpt-helper） | B（provider-prefix） | 本插件 |
| --- | --- | --- | --- |
| 卡片骨架 | 单面板 | 两列 + 悬停切换 | **B 的两列**（168/236/416） |
| 触发器 | `模型 ⌄ 档位` | `供应商 / 模型 ⌄` | **B 的三段式**（供应商 + `/` + 模型），后面接思考档位按钮 |
| 搜索框 | 卡片顶部独立搜索行（30px，无边框） | 模型列内（有边框，且仅当该供应商 > 6 个模型才渲染） | **B 的位置 + 有边框**，但**始终显示**且**跨供应商** |
| 返回箭头 | 有（40px 头部行） | 无 | **删除**；用思考触发器和 `.gptm-status` 双向切换 |
| 思考滑块 | 粒子滑块 + 42 粒子 | 无 | 保留 A |
| 快速档动效 | 600 ms 长按锁的开关 | 无 | **恒开**：开关、长按锁、`…:fast:v1` 在 0.1.3 删净；闪电在 0.2.1 以「跳最高思考档 / 回原档」的身份回来，不再是快速开关（§9.4） |
| 配色面板 | token 表 + 方案库 + JSON 导入导出 | 无 | 保留 A |
| 错误重试行 | 无 | 有 | 保留 B（`providerRows` 里的 `retry` 行） |
| 尺寸策略 | 内容驱动 | 内容驱动（闪动源） | **帧驱动**：`frame` + 冻结 + 列内滚动 |
| DOM 属性 | `data-gpt-helper=*` | `data-dsh-pm-*` | **只有 `data-model-seat=*`**（root / menu / model-trigger / effort-trigger / thinking-slider / config-panel / config-backdrop）；0.1.1 起两个上游属性一个都不输出 |
| 归属命名空间 | `dsh-client-ui-gpt-helper` | `dsh-model-provider-prefix` | `dsh-client-ui-model-seat`（模块 id / 存储键 / 补丁 id / 槽位 locale 全部换新） |

**刻意的取舍**：B 的"搜索框只在模型多时出现"没有照搬。原因：我们允许跨供应商搜索，而搜索框承担的是"怎么找到模型"，与当前供应商的模型数无关；而且它的出现/消失本身会改变列内容高度（闪动风险）。

## 16. 已知风险与硬约束

1. **`tools/merge/gen-client.mjs` 会覆盖手写文件**。它是初稿生成器（从 `A` 的 3083 行 bundle 逐段打补丁），跑一次就会把 3601 行的合并体换成只有 A 的旧版本。现已加门禁：不带 `--force` 直接 `exit 1` 并打印原因；带 `--force` 也会先写 `lib/client.js.bak-gen-<时间戳>` 备份。保留原因：里面记录了当年 A 的锚点。
2. **E2E 的 React vendor 已收进仓库** `test/vendor/`（开发版 UMD，MIT）。`scripts/browser-check.mjs` 与 `scripts/shots.mjs` 默认读它，`--vendor DIR` / `REACT_VENDOR` 仍可覆盖。
3. **桌面 profile 不可用普通 CLI 改**：`bin.js` 的 `rejectElectronProfile` 会抛 `profile "desktop" is managed exclusively by the Electron application`；必须走 `@deepseek-ai/dsh-desktop-host/lib/cli.js` 的 `runCli({ manageDesktopProfile: true, … })`。
4. **`0.5px` 在各 dpr 下不等宽**（dpr=1 时 1 设备像素），视觉可接受，不要用 JS 去"修正"。
5. **只含 `var()` 的声明会被丢弃**，所以颜色必须是构建期字面量。
6. **单座位**：本插件不提供"关掉自己"的开关；要停就用 `dsh plugin remove`。
7. **无运行时依赖、无构建步骤**：改完 `lib/client.js` 直接用，但宿主只在 boot 时挂载 bundle，**改完必须重开应用**（Ctrl+R 只重载页面，不重新加载 bundle —— 除非宿主热更新）。
8. **`.research/` 与 `.shots/` 不进仓库**：`.gitignore` 里有这两条，还有 `node_modules/`、`.tmp-*.log`、`*.tgz`。新增临时目录时记得同时加规则，并用 `git check-ignore -v <path>` 验证真的被挡住（见 §19.1）。

## 17. 安装、升级、回滚

### 17.1 装（web / 普通 profile）

```bash
# 从 npm（0.1.2 起；0.2.1 实测 2.7 s，零依赖）
node <dsh>/node_modules/@deepseek-ai/dsh/lib/bin.js plugin --profile <p> add dsh-client-ui-model-seat

# 从公开仓库（同样实测可装）
node <dsh>/node_modules/@deepseek-ai/dsh/lib/bin.js plugin --profile <p> add github:HimA6652/dsh-client-ui-model-seat

# 从本地工作区（开发时用这条，改完要重启应用才生效）
node <dsh>/node_modules/@deepseek-ai/dsh/lib/bin.js plugin --profile <p> add link:/path/to/dsh-client-ui-model-seat
```

npm 通道自 `0.1.2` 起开通（现为 `0.2.1`：`npm view dsh-client-ui-model-seat version` → `0.2.1`，maintainer `hima6652`）。首次发布时 registry 会顺手建一个 `0.0.0-stage` 占位版本，已用 `npm deprecate` 标注说明，装版不会选中它。

### 17.2 装（desktop profile）

```js
// C:/Users/<you>/AppData/Local/Temp/seat-desktop-cli.mjs
import { runDesktopCli } from "file:///path/to/dsh/node_modules/@deepseek-ai/dsh-desktop-host/lib/cli.js"
await runDesktopCli(
  "/path/to/dsh",
  "/path/to/dsh/../runtime",
)
```

```bash
node seat-desktop-cli.mjs plugin --profile desktop add link:/path/to/dsh-client-ui-model-seat
```

改完 `package.json` 的 `dependencies` 与 `dsh.profile.bundles`（追加到末尾）。**必须整退出应用再启动**，bundle 在 profile boot 时挂载。

### 17.3 回滚

```bash
node seat-desktop-cli.mjs plugin --profile desktop remove dsh-client-ui-model-seat
```

或恢复安装时写的备份（`~/.dsh/profiles/desktop/` 下）：`package.json.bak-<时间戳>`、`cordis.yml.bak-<时间戳>`、`cordis.patch.yml.bak-<时间戳>`。`cordis.patch.yml` 由 bundle 自己的 `dsh.bundle.patch` 提供，`plugin add` 不会写它 —— 若手工改过，一并还原。

### 17.4 与上游共存

- 同装不炸（`-2` 压住 `-1`），但**上游的 CSS 仍在**：B 的 `<style id="dsh-model-provider-prefix-style">` 永不删除。0.1.1 起我们不再输出 `data-gpt-helper` 别名，A 的选择器已无从命中；我们的规则全部挂在 `[data-model-seat]` 下，也不输出 `data-dsh-pm-*`，所以两边的规则都落不到我们身上。
- 迁移建议：先装本插件确认可用，再移除两个上游；移除后重启应用。
## 18. 待办与已办

本轮已完成（都有实测）：

1. ~~`gen-client.mjs` 加门禁~~ —— 不带 `--force` 时 `exit 1` 并打印拒绝原因；带 `--force` 先落 `lib/client.js.bak-gen-<时间戳>` 备份。实测：直接运行 `exit=1`，`lib/client.js` 保持不变、无 `.bak-gen-*` 产生。
2. ~~`.gitignore`~~ —— `node_modules/`、`.shots/`、`.research/`、`.tmp-*.log`、`*.tgz`。
3. ~~React vendor 收进仓库~~ —— `test/vendor/`（`react.js` 109,931 B + `react-dom.js` 1,080,227 B，开发版 UMD，附来源说明）。`browser-check.mjs` 默认改读仓库内目录，`--vendor` / `REACT_VENDOR` 可覆盖。实测：把 `_repro` 的两个 react 文件改名隐藏后 `npm run e2e` 仍 `exit 0`、`problems: []`，证明不再依赖仓库外目录。
4. ~~`MERGE-PLAN.md` 归档~~ —— 文首「实施结果」偏差表，其余章节标注为历史设计稿。

5. ~~`data-gpt-helper` 别名清理~~ —— 0.1.1 一次删净 8 个别名（root / model-trigger / effort-trigger / menu / thinking-slider / fast-toggle / config-panel / config-backdrop），配置面板与背板改为输出 `data-model-seat="config-panel"` / `"config-backdrop"`。同步改了两侧守护：`validate` 去掉 5 条 alias 检查，换成 `no hereditary aliases`（整份 bundle 不含 `data-gpt-helper`）+ 8 个 `data-model-seat` 值的存在性循环；`browser-check` / `live-check` 的选择器全部改指 `data-model-seat`。
6. ~~空状态文案统一~~ —— 两处空状态改用 `.ms-empty`（`lib/client.js` 的 CSS_TEMPLATE 内，`padding: 8px`、12px/18px、`--dsw-alias-label-caption`），不再用贴顶的 `gptm-note`。**一处事实更正**：供应商列从来不会被查询筛空 —— `providerRows(state, current?.provider)` 不接收 needle，所以「供应商列为空」只发生在真的没有任何供应商时；「查询无匹配」只会出现在模型列。因此两处虽然共用同一个类，文案仍分开（`status.noProviders` / `empty.models`）。e2e 新增第 5 段：输入 `zzz-no-such-model` → 断言恰好一条 `.ms-empty`、0 行、`paddingTop === 8px`、`fontSize === 12px`，并截图 `.shots/v011/03-empty-query.png`。
7. ~~`ArrowLeft` 图标~~ —— 0.1.1 删除（返回箭头早就没了，它只剩死代码）。删除后 `lib/client.js` 为 3642 行（0.1.2 的基线），§3 的两张行号表已随那次重定基线一起更新。
8. ~~版本号 0.1.1~~ —— `package.json` `version` 与 `lib/client.js` 的 `BUILD = '0.1.1+merge'` 同步；`browser-check` 现在从 `package.json` 读版本号并断言根节点 `data-build` 等于「版本号 + `+merge`」，两边再也不会各写一份。

9. ~~思考面板底部的长按提示行~~ —— 0.1.3 删除。`fast.lockHint`（“长按闪电锁定／解锁快速模式”）原本占三个出口：面板底部的一行 `.gptm-hint`、快速开关按钮的 `title`、状态按钮锁定态的 `title`。三处连同中英词条与 `.gptm-hint` 规则一起删掉，长按行为本身保留（`useLongPress`、`LONG_PRESS_MS`，e2e 仍在验“按住锁上 / 再按住解开”）。删后 `lib/client.js` 从 3642 行落到 3634 行；随后 0.1.3 的两条修复（token 注释 +2、`measure()` +15）把它推到 **3651 行**，§3 两张行号表与全文锚点/区间按这个基线重算（`doc-anchor-check` 63 符号 / 28 区间全过）。`browser-check` 第 5 段新增断言：思考面板里 `.gptm-hint` 数量为 0。

10. ~~快速模式的开关、长按锁与持久化键~~ —— 未发布的工作树删除。要求的原话是「删掉闪电符号，把动效固定为开」，实际删掉的比一个图标多：触发器上的 `.gptm-triggerBolt`、思考面板头部的 `.gptm-fastToggle`、`Bolt` / `LockMark` / `LockIcon` 三个绘制函数、`FAST_STORE`（`…:fast:v1`）、`readFast` / `rearmFastFromStorage` / `useFastLock` / `useLongPress`、focus 与 pointerdown 两个重读监听、`tremble` 怠速态与 `@keyframes gptm-tremble`、`data-fast` / `data-locked` / `data-tremble` 三种状态属性、`fast.label` / `fast.locked` 词条，以及 `trigger.bolt` / `trigger.lockMark` / `menu.boltLit` / `slider.particleIdle` / `slider.particleIdleGlow` 五个颜色 token（`menu.bolt` 留着：复位按钮还在用）。滑轨改为 `--spin: 1`、`.gptm-trail` 的 `opacity: 1`；面板头部网格从 `34px 1fr 34px` 收成 `1fr 34px`。`lib/client.js` 从 3651 行落到 **3335 行**；`css-audit` 200 / 212 → **173 / 183**；`validate` 80 → **82** 项（新增 `no fast-mode store` / `no fast-mode switch` / `no bolt or lock drawing`）；`browser-check` 新增「思考面板里没有 bolt 控件」「轨道常亮」「42 个粒子以 `gptm-drift` 跑且 `--spin=1`」三条断言，原本验长按锁的两段换成验复位按钮；`live-check` 同步。§3 两张行号表与全文锚点/区间按这个基线重算。

11. ``闪电以新语义回归、思考面板高度、模型列八行下限`` —— 0.2.1。①闪电点击跳到最高思考档、再点回到开启前的档位（按 effort id 记忆；滑块、方向键、复位、换模型都会清记忆）。②思考面板底部 31px 空白：旧代码只有一个下限 `CARD_MIN_HEIGHT = 132`，而面板自然高只有 101，多出的 31px 全落在滑块下方；改成每布局一套下限（`PANEL_MIN_HEIGHT` 96 / `MODELS_MIN_HEIGHT` 333），`.gptm-menu` 的 padding 从 `9px 11px 12px` 收成 `12px 11px` —— 实测面板 300×101，首个与末个子元素到边框各 13px。③模型卡高度下限 8 行：32×8 + 表头 25 + 线 6.5 + 搜索 36 + 内边距 8 + 边框 1 = 333，指针在 2 个模型的供应商与 60 个模型的供应商之间移动时卡片不再重排。`validate` 82 → **91** 项；`css-audit` 现为 **182 / 192**；`browser-check` 第 5 段扩成闪电循环（12 条断言）+ 新增 6b 段（八行下限）；`live-check` 只读地验闪电存在且未按下、顶底内缩相等、对比度 ≥ 4.5。`lib/client.js` 从 3217 行增到 **3335 行**。④闪电的开启态跨重启丢失（用户 2026-10-29 报「某一个对话我开启闪电按钮，退出 dsh 重新打开之后没有被延续」）：`boltPrev` 原本只是组件 state，而会话已经把顶档的 `reasoningEffort` 恢复回来了，于是重启后按钮看着是灭的、按下去反而把顶档记成「上一档」，成了死键。改法是把记忆持久化到 `dsh-client-ui-model-seat:bolt:v1`（按会话 id 分桶、最多 64 个会话、带 provider/model 归属校验），并把「已经处于顶档」也算作开启态（`atTop`）；回退档位抽成纯函数 `boltReturnIndex`（记忆 id → 模型默认 → 顶档下一档 → `-1`），滑块、方向键、复位、换模型只要有真实改档就清记忆。`validate` 91 → **95** 项（新增四条持久化检查），`npm test` 29 → **35**（新增 `test/bolt.test.mjs` 6 条），`lib/client.js` 3335 → **3579 行**，§3 两张表与全文锚点/区间按这个基线重算。⑤ 跨 origin 的重启才算真重启（同一天二次排查）：dsh 每次启动都以 `--port 0` 起 UI 服务（实测 3091 → 3092），而 `localStorage` 按 host **和端口** 分桶（同一浏览器同一 host 实测 5511 → 5512 读到 `null`，cookie 仍读得回），所以④里那份记忆在真重启后读不到 —— 灯还亮是因为宿主端把 `reasoningEffort` 写进了 `storages/session_projcache/sessions/session-<id>.json`（`record.rows.modelSelection.val.pending.reasoningEffort`），但「按下去回到哪一档」会退化成「回到默认」。现在 `writeBoltMemory` 同时写一份 cookie `dsh-model-seat-bolt`（host 作用域、`path=/`、一年、`SameSite=Lax`；最多 8 个会话 / 3500 字节，超了裁最旧的），`readBoltMemory` 先读 `localStorage`、空了再读 cookie；刻意**不做**「挂载时把档位拉回最高」的补偿，那会覆盖用户在原生 UI 里手动改的档。`browser-check` 新增 7c 段：第二个 HTTP 服务器占另一个端口，`Page.navigate` 过去后先断言 origin 真的变了、`localStorage` 读回 `null`，再断言灯仍亮、`title` 仍是「回到开启前的思考强度」、按一下回到 medium 且提交次数为 0（读回而不是重写）。夹具的档位持久化也从 `localStorage` 换成 cookie（`harness-effort`），否则夹具会在换 origin 时自己丢档位，把正确行为测成 bug。`validate` 95 → **98** 项（cookie 镜像三件套）。⑥ 跨会话交接（同一天第三次排查）：宿主每次启动都新开一个会话，而记忆按会话分桶，于是重启后的新会话查不到上一会话的记录 —— 灯因为 `atTop` 还亮着，回退档位却退化成「回到默认」。`writeBoltMemory` 现在额外写保留桶 `last`（`BOLT_LAST`），`boltMemoryFor(records, sessionKey, provider, model, atTop)` 先查本会话、查不到且已经在顶档才借 `last`（同 provider/model 才认），裁剪时 `last` 永不淘汰；`browser-check` 新增 7d 段（同一浏览器 profile 导航到 `?session=session-9` 的新会话，`localStorage` 仍为空、灯与回退档位由 `last` 给出、提交次数 0）。`validate` 98 → **101** 项（`bolt outlives its conversation` / `the hand-over only speaks at the top` / `the hand-over is never aged out`），`npm test` 35 → **41**（`test/bolt.test.mjs` 6 → 12），行数仍是 3579。

   ⑦ **「闪电默认是开着的」**（同一天第四次排查，0.2.1 发出前）。现象：用户打开思考面板就看见闪电是亮的，但他从没按过。真机取证（克隆 desktop profile 起一份独立副本，`%TEMP%/seat-bolt-home` / profile `deskcheck-bolt` / 端口 6141）：`dsh-client-ui-model-seat:bolt:v1` 读回 `null`、cookie `dsh-model-seat-bolt` 读回 `null`、`Object.keys` 是空数组，而 `aria-pressed="true"`、`title="回到默认思考强度"`、`aria-valuenow="3"`（Max）。也就是说灯亮**只**来自 `atTop` —— 宿主把这个模型恢复在顶档，旧实现把「已经在顶档」也算成开启态（`boltOn = hasBolt && (boltBack !== null || atTop)`）。改法：开启态只认记忆，`boltOn = hasBolt && boltBack !== null`（2706）；顶档无记忆时新增 `boltIdleAtTop`（2709），按钮保持描边深色、`title` 换成「已经在最高思考强度」、`disabled: sliderDisabled || boltIdleAtTop`（3398），`toggleBolt` 见到它就 return（不发明记忆）；关灯路径（按下回退 / 手动改档 / 换模型 / 复位）一律带 `dropLast: true` 把跨会话镜像 `last` 一起删掉，否则旧按压会在日后某次启动把灯重新点亮（`writeBoltMemory` 的 `else if (dropLast) delete next[BOLT_LAST]`）。`validate` 101 → **103** 项（删 `a restored top level lights the bolt`，加 `the bolt only lights from a memory` / `the bolt is inert at the top` / `turning the bolt off retires the hand-over`），`browser-check` 7b 段由「顶档点亮」改成五条反向断言（顶档深色 / 顶档文案 / `disabled` / 按下无变化 / 退回一档按钮又可用），行数 3579 → **3601**（换模型的清理 effect 与按钮 `disabled` 各多一行、`boltTitle` 三元变三行），§3 两张表与全文锚点/区间按这个基线重算。
仍待办：

12. **列间键盘导航** —— 用户在 0.1.1 明确说这一轮不做：左/右方向键在供应商列与模型列之间移焦点。现状是 Tab 在卡片内自然穿行、滑块的方向键已实现（`onSliderKey`，`lib/client.js:3148`）。将来要做，注意别让焦点移动触发 `setRect`/`setFrozen` 复量。
13. **host 半边的 `engines.dsh`** —— 随容器 API 稳定后再复核 `>=0.2.1-rc.2` 是否仍准确。

## 19. 发布流程与提交规范

本节是 `E:/DeepseekHarnessWorkspace/0000docs/` 那两份规范的落地版本：规则原文在那边，这里只写本仓库怎么执行、拿什么证明执行了。

### 19.1 不可提交清单（由 .gitignore 挡住，由 check-secrets 兜底）

| 类别 | 具体东西 | 为什么不行 | 怎么挡 |
| --- | --- | --- | --- |
| 凭据 | `.credentials.yaml`、任何 token / 私钥 / `sk-…` | 零容忍，进过一次就要清 git 历史 | `check-secrets` 命中即 `exit 1` |
| 本机路径 | `C:/Users/<用户名>/…`、`X:/ProgramData/<文件夹>`、`/home/<用户名>` | 把开发机身份写进公开文档 | `check-secrets` 的 `windows dev path` / `posix home path` 规则；占位符白名单（`you`、`<your-name>`、`/path/to/`）不误报 |
| 内网地址 | `192.168.x.x`、`10.x.x.x`、`172.16-31.x.x` | 暴露内网拓扑；`127.0.0.1` 是回环、文档里必须写，不算泄漏 | `check-secrets` 的 `lan ip` 规则 |
| 私有服务名 | 真实 key 池名、内部代理名、账号余额 | 元信息层泄漏 | 人工评审；harness 演示数据只用公开供应商名 |
| 中间产物 | `.research/`（上游克隆）、`.shots/`（截图）、`*.tgz`、`node_modules/`、`.tmp-*.log` | 体积与内容都不可控 | `.gitignore` |
| 备份文件 | `*.bak`、`lib/client.js.bak-gen-*` | 会连带把旧代码发到 npm | `.gitignore` + `check-pack` 的 `FORBIDDEN` 规则 |

验证方式是让 git 回答，而不是看文件：

```bash
git check-ignore -v .research .shots node_modules lib/client.js.bak-gen-20261027
# 每行都必须有输出（命中规则）；任何一行空着就说明没挡住
```

本机环境事实：没有 `gh` CLI；`git push` 走 SSH（`~/.ssh/config` 已把 `github.com` 映射到 `ssh.github.com:443`，22 端口不可用）；`api.github.com` 需要 `curl --ssl-no-revoke`。

### 19.2 制品清单：files 只能列文件

`package.json` 的 `files` **不允许出现目录**。曾经写过 `"assets"`：目录语义是“把里面所有东西都带上”，一个 `*.bak` 或临时截图会跟着发布出去。现在逐文件列出，并由 `npm run check:pack` 拿 `npm pack --dry-run --json` 的真实输出反向核对四条：

1. `files` 里每一项 `statSync(...).isDirectory() === false`；
2. 制品里不含 `*.bak/orig/rej/swp/tmp/log/tsbuildinfo`、`~`、`.DS_Store`、`node_modules/`；
3. `files` 写了的每一项都真的在制品里；
4. 制品里没有清单外的文件 —— 只有 `package.json` / `README.md` / `LICENSE` / `CHANGELOG.md` 天然豁免。

### 19.3 双向验证配方（改完门禁必跑一次）

只证明“现在是绿的”不够，要证明它**会红**。在隔离副本里做，别动本体：

```bash
cp -r . /tmp/seat-gate && cd /tmp/seat-gate
# ① 把 files 写回目录 → 必须红
node -e "const f='package.json',p=JSON.parse(require('fs').readFileSync(f,'utf8'));p.files=p.files.map(x=>x.startsWith('assets/')?'assets':x);require('fs').writeFileSync(f,JSON.stringify(p,null,2))"
node scripts/check-pack.mjs; echo "expect 1, got $?"
# ② 删掉一个 files 里声明过的文件 → 必须红（第 1、3 条断言）
mv assets/screenshot-3.png /tmp/ && node scripts/check-pack.mjs; echo "expect 1, got $?"
mv /tmp/screenshot-3.png assets/
# ③ 把备份文件写进 files → 必须红（第 2 条断言：它真的会进制品）
echo x > assets/icon-180.png.bak
node -e "const fs=require('fs'),p=JSON.parse(fs.readFileSync('package.json','utf8'));p.files.push('assets/icon-180.png.bak');fs.writeFileSync('package.json',JSON.stringify(p,null,2))"
node scripts/check-pack.mjs; echo "expect 1, got $?"
# ④ 还原 → 必须绿
git checkout -- package.json && rm assets/icon-180.png.bak
node scripts/check-pack.mjs; echo "expect 0, got $?"
```

`check-secrets` 同理：往任意 `.md` 写一行 `X:/ProgramData/<文件夹>`（把 X 换成一个盘符字母）必须 `exit 1`，改成 `/path/to/x` 必须 `exit 0`。

### 19.4 一条命令发版

```bash
# 1) 先手写 CHANGELOG.md 里的 "## [0.2.0] - YYYY-MM-DD" 小节（脚本不替你编）
# 2) 再跑
npm run release 0.2.0               # 检查 → npm → 提交 → 打标签 → 推送
npm run release 0.2.0 --dry-run     # 只跑到测试为止
npm run release 0.2.0 --no-publish  # 不发 npm，只发 GitHub
npm run release 0.2.0 --no-push     # 提交 + 标签，不推
```

`scripts/release.mjs` 的四道硬门（按失败顺序）：

1. `CHANGELOG.md` 里存在 `## [<version>]` —— 否则发出去的 Release 是空的；
2. `git status --porcelain` 为空 —— 否则分不清哪些改动进了这一版；
3. 当前分支是 `main`；
4. 标签 `v<version>` 本地没有、**远端也没有**（`git ls-remote --tags origin v<version>`；换过机器时本地干净而远端有）。

过了门才动版本号：`package.json` 的 `version` 与 `lib/client.js:16` 的 `BUILD = '<version>+merge'` 一起改（`browser-check` 断言 `data-build === 版本号 + '+merge'`，两边不一致 e2e 立刻红）。随后依次跑 `check-secrets` → `check-pack` → `release-notes` → `validate` → `npm test`，再用 `npm whoami` 与 `npm view <pkg>@<version>` 确认版本号没被占，才 `npm publish`。

提交阶段只 `git add package.json lib/client.js`；暂存区为空就跳过 commit（空 commit 会让脚本当场退出，把标签和推送一起带走）。之后 `git tag -a v<version>` → `git push` → `git push origin v<version>`，Actions 建 Release。

### 19.5 中途挂掉的恢复

| 挂在哪 | 现状 | 怎么收 |
| --- | --- | --- |
| 检查跑完、npm 没发 | 工作区里两个版本号文件已改 | `git checkout -- package.json lib/client.js`，或直接接着跑（幂等） |
| npm 已发、没提交 | 注册表有版本，仓库没对应提交 | 用 `npm run release <同版本> --no-publish` 走完提交与标签 |
| 提交了、没打标签 | 提交已在 main 上 | `git tag -a v<version> -m v<version> && git push && git push origin v<version>` |
| 打了标签、没推 | 本地有标签 | 只 `git push origin v<version>` |
| 推了标签、Actions 失败 | 没有 Release 页 | 修好 workflow 重跑，或本地 `gh release create --verify-tag` |
| 发出去的版本有 bug | 已有人装 | 不发 `npm unpublish`，改 CHANGELOG 发补丁版本 |

首次发布（0.1.2）踩到的两个坑，记在这里免得下次当成事故：

- `npm publish` 打印 `+ pkg@x.y.z` 与 "being processed and may take a few minutes" 之后，注册表 packument 会先只有一条 `0.0.0-stage`（描述写着 "Temporary package placeholder for staged publishing"），大约 1 分钟后真版本才落到 `dist-tags.latest`。**不要因此重跑 publish**，用 `npm view <pkg> version` 复核即可。这个占位版本用 `npm deprecate <pkg>@0.0.0-stage "<说明>"` 标注，别 `unpublish`。
- pnpm 11 默认带 `minimumReleaseAge`（**1440 分钟**）供应链闸门，**写死版本**安装时 pnpm 会把该版本记进 profile 的 `pnpm-workspace.yaml` 的 `minimumReleaseAgeExclude`（`--profile … add dsh-client-ui-model-seat@0.2.1` 实测通过，装到的就是 `0.2.1`）；开了 `minimumReleaseAgeStrict` 的 profile 会先弹一次确认。
- **裸包名不会装到刚发的版本**：`minimumReleaseAge` 会让裸名解析成「满一天的最新版」。实测 2026-10-29T07:26Z 发完 `0.2.1` 之后，`pnpm add dsh-client-ui-model-seat`（以及 `dsh plugin add` 不带版本）装到的是 **`0.1.2`** —— `0.2.0`（前一日 10:37Z）与 `0.2.1` 都还没过闸门。这不是插件 bug；README 里两条安装命令因此写成「写死版本 / 裸包名」并列。判断现场装的是哪版：`node -e "console.log(require('<profile>/node_modules/dsh-client-ui-model-seat/package.json').version)"`。

### 19.6 渠道对齐（本仓库实际开了几个）

| 渠道 | 现状 | 对齐要求 |
| --- | --- | --- |
| git 标签 | `v0.2.1` 已推（annotated `8972323`，peeled `721f591`）；此前 `v0.2.0` annotated `fa57ea3` / peeled `9b13e9a`、`v0.1.2` annotated `4ca9f6b` / peeled `eb8ba43` | 与 `package.json` 的 `version` 一致 |
| GitHub Release | 由 `.github/workflows/release.yml` 在 `v*` 标签上自动创建，正文取 `CHANGELOG.md` 同版本小节 | 发之前把正文里的旧措辞重扫一遍 |
| npm | 已发布 `0.2.1`（2026-10-29T07:26:03Z，13 文件 243.9 kB / 解包 390.7 kB，shasum `2cd8659`）、`0.2.0`（2026-10-28T10:37:58Z，232.7 kB）与 `0.1.2`（06:38:18Z）；`0.0.0-stage` 是首次发布的占位版本，已 deprecate | 用 `npm run release <ver>` 发，tag / Release / npm 三者同号 |
| dsh 插件市场 | PR **#10053**（`Add HimA6652/dsh-client-ui-model-seat (ui)`）已开、`Submission gate` 与 `check` 全绿，等维护者合并（见 `MARKET.md`） | 合并后再核对市场页的安装串；上游补 deprecated 的提议写在 PR 正文里 |

### 19.7 已记录的决策

- **不改写 git 历史**。首次推送用了 `git add -A` 与散文式提交说明，当时没有任何 npm 制品，改写历史的收益低于风险。从现在起按规范提交，历史留档；这条决定本身写在这里，免得下一个人以为是忘了。
- **`v0.1.1` 标签早于 `CHANGELOG.md`**。当时的 Release 正文是手写的。**不要**移动或重打 `v0.1.1`：下一个版本号走 `release.mjs`，三条渠道重新对齐。
- **带 CHANGELOG 的 Release 从 `0.1.2` 起**。`0.1.2`、`0.2.0`、`0.2.1` 都是 `release.mjs` 发的、正文取自 CHANGELOG；下一个版本号从 `0.2.2` 起。
- **“先不发”是四层意思**：① 不写版本说明 ② 不提交 ③ 不推送 ④ 不打标签/不发 npm。听到这四个字先问是哪一层，默认按 ①+② 处理（改完留在工作区）。

### 19.8 提交信息规范

```
type(scope): 一句话，50-70 字符，句尾不加句号

问题是什么 → 怎么改的 → 影响面
```

- `type`：`feat` / `fix` / `docs` / `chore` / `test` / `refactor`；`scope` 用目录或子系统（`client`、`scripts`、`harness`）。
- 一行只讲一件事；写问题和改法，不写“我为什么这样想”。
- 提交信息是公开页面：不出现分支名、人名、会话号。
- 例：`fix(client): freeze card height so hover cannot resize it`。

### 19.9 Actions 红了怎么查

job 日志（`/actions/runs/<run>/logs`）和 artifact 下载都要登录，而本机的 HTTPS 凭据属于另一个没有 push 权限的账号，所以「打开页面看日志」这条路在命令行里是断的。免登录还能读的是 **check-run annotations**：

```bash
# 1) 拿最新 run 的结论
node -e "fetch('https://api.github.com/repos/HimA6652/dsh-client-ui-model-seat/actions/runs?per_page=3',{headers:{'user-agent':'x'}}).then(r=>r.json()).then(j=>j.workflow_runs.forEach(r=>console.log(r.head_sha.slice(0,7),r.status,r.conclusion,r.id)))"
# 2) 拿 job 的 id，再读它这一层的 annotations（注意是 job id，不是 step id）
node -e "fetch('https://api.github.com/repos/HimA6652/dsh-client-ui-model-seat/actions/runs/<run>/jobs',{headers:{'user-agent':'x'}}).then(r=>r.json()).then(j=>j.jobs.forEach(x=>console.log(x.name,x.id)));"
node -e "fetch('https://api.github.com/repos/HimA6652/dsh-client-ui-model-seat/check-runs/<job>/annotations',{headers:{'user-agent':'x'}}).then(r=>r.json()).then(a=>a.forEach(x=>console.log(x.annotation_level,'|',x.message)))"
```

```powershell
# 日志要走认证；没有 gh 时用已存的 git 凭据也能读（该账号只读，够用）
$env:GITHUB_TOKEN = '...'   # 只读 token 即可；本机现存凭据是 ylh440104，不能建 token
```

因此 `ci.yml` 的两个 e2e 步骤在失败时会把日志里匹配 `"the ` / `threw` / `browser-check:` / `no react vendor` / `never opened port` / `"problems"` 的那几行 `::error::` 出来 —— 断言失败的具体文案就靠在 annotation 里。

第二个真发现打的是同一张牌（发布 0.2.1 之后连红三个 run：`721f591` → `40835311229`、`790fb81` → `40835687184`、`ee20704` → `40835906266`，annotation 里是 `"the hand-over names the level it replaced — {"label":"Back to the level before the bolt"}"` 这类英文标签）：**夹具的语言跟着浏览器走**，而断言写的是中文。修法是把语言也变成显式输入 —— 夹具读 `?lang=zh|en` 并暴露 `window.__lang`，`browser-check` 每次导航都带 `lang=zh`、启动参数带 `--lang=zh-CN`、并断言 `window.__lang === 'zh'`。弯路记一笔：`Emulation.setLocaleOverride` **无效**，独立探针实测它只影响 `Intl`，`navigator.language` 前后都是 `en-US`。

首跑（run `40673400351`）红的就是这条链路的第一个真发现：runner 的系统开了「减少动效」，`prefers-reduced-motion: reduce` 让 `.gptm-particle` 的 `animation-name` 算成 `none`，「粒子以满强度漂移」被误判。修法是两边都显式 `Emulation.setEmulatedMedia` 钉住 `prefers-reduced-motion`，并把 `reduce` 分支写成反向断言（见 `browser-check` 第 5b 段）。**本地绿 / CI 红**时优先怀疑三件事：媒体特性默认值、慢机器上的采样帧数、Node 版本差异（CI 用 22，本机 24）。
