# dsh-client-ui-model-seat 维护手册

> 读者：要改这个插件的人（包括未来的你）。
> 目标：不读 3642 行也能定位改动点；改完知道为什么没坏。
> 行号基线：`lib/client.js` 共 3642 行、`BUILD = 0.1.1+merge`。**行号会漂移**，
> 每一处都同时给了函数名或唯一字符串，以函数名为准、行号为辅。

## 0. 三十秒上手

- 这是一个**单文件 bundle 插件**：`lib/index.js`（Host 半边，空实现）+ `lib/client.js`（浏览器半边，3642 行，手写，无构建步骤）。
- 它只做一件事：抢占会话输入框里 `conversation.input.model` 这个**槽位**，把 dsh 自带的模型选择器换成"供应商列 + 模型列 + 粒子思考滑块"三合一控件。
- 它同时是 A（`dsh-client-ui-gpt-helper`：外壳、粒子滑块、配色面板、fast 锁、i18n）和 B（`dsh-model-provider-prefix`：两列卡片骨架）的合并体，两个上游都不能同时装 —— 它们注册同一个槽位、同一优先级，运行时会抛。
- 唯一必须守住的特性：**卡片尺寸只能由锚点与布局决定，不能由内容决定**。所有看起来"多余"的代码（freeze、floor、scrollbar-gutter、query 不改布局）都是为了这条。

## 1. 仓库地图

| 路径 | 作用 | 改动时要动它吗 |
| --- | --- | --- |
| `lib/client.js` | 全部前端实现与样式（3642 行） | 是，几乎所有功能改动都在这里 |
| `lib/index.js` | Host 半边；只导出 `name` 与空的 `apply()` | 基本不动（`validate` 禁止 Host 半边碰 DOM） |
| `cordis.patch.yml` | 往 profile 插一行 `{ id: model-seat, name: dsh-client-ui-model-seat }` | 换插件 id 时才动 |
| `package.json` | `dsh.client` / `dsh.bundle.patch` / `files` / scripts | 加脚本、改注入目标时动 |
| `README.md` | 对外说明（英文） | 行为变更时同步 |
| `MAINTENANCE.md` | 本文（中文） | 结构变更时同步 |
| `MERGE-PLAN.md` | 合并前的设计文档，**历史档案**；文首"实施结果"一节记录了与设计的偏差 | 不改，只在重大偏差时补一行 |
| `scripts/validate-plugin.mjs` | 清单/补丁/入口/bundle 加载/apply 的静态+运行时校验（61 项） | 新增入口契约时加检查 |
| `scripts/css-audit.mjs` | 样式表作用域、死类、border-box、上游属性残留的审计 | 新增 `.ms-` 类时会被自动覆盖 |
| `scripts/loadcheck.mjs` | 针对本机 dsh checkout 做加载与优先级排序检查（无 checkout 时跳过） | 少动 |
| `scripts/browser-check.mjs` | 真浏览器 E2E（CDP + headless Edge），9 个段落 | 交互变更时同步 |
| `scripts/live-check.mjs` | 在**真实 dsh** 页面上跑的断言 | 同上 |
| `test/*.test.mjs` | 29 个 node:test 用例（frame/i18n/register/rows） | 同上 |
| `test/harness/` | fixture 页面：假的槽位注册表 + 假的模型目录 | 需要新 fixture 时动 |
| `test/vendor/` | React 开发版 UMD（`react.js` 110 KB + `react-dom.js` 1.08 MB，MIT），E2E/live-check 的页面依赖；**插件运行时不使用**（运行时从宿主 `__ModuleLoader__` 取 React） | 只在升级 React 时替换 |
| `tools/merge/gen-client.mjs` | **历史工具**，从 A 的 bundle 生成初稿；**默认拒绝运行**，`--force` 才覆盖且先写 `lib/client.js.bak-gen-<时间戳>` | 只在考古时读 |
| `.research/` | 两个上游仓库的只读克隆，供对照 | 只读 |
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
| 1 | 1–67 | 加载器外壳与常量 | `BUILD`、`NS`、`CONFIG_KEY`、`FAST_KEY`、`LONG_PRESS_MS`、`DEFAULT_HOTKEY` |
| 2 | 68–279 | 颜色 token 表与规范化 | `COLOR_TOKENS`（68）、`TOKEN_BY_KEY`、`normalizeColors/Sides/Slots`、`tokenValueFor`（252） |
| 3 | 280–379 | 明暗判定与热键解析 | `THEME_ATTRIBUTE`（280）、`detectSide`（293）、`parseHotkey`、`hotkeyMatches` |
| 4 | 380–617 | 配置 schema v3 + 迁移 + store | `defaultConfig`（380）、`normalizeConfig`（401）、`configToDocument`（427）、`importSchemes`、`createStore`（514）、`rearmFastFromStorage`（570） |
| 5 | 618–1195 | 生成样式表 | `cssStatements`（618）、`resolveSide`、`buildCss`（655）、`CSS_TEMPLATE`（676 起；内含 `.ms-empty` 空状态规则） |
| 5b | 1196–1339 | i18n 词典 | `ZH`（1196）、`EN`（1264） |
| 6 | 1340–1566 | 图标与粒子 | `Bolt`（1340）、`Caret`、`Check`、`ResetIcon`、`LockMark`、`PARTICLES`（1491）、`levelRatios`（1524） |
| 7 | 1567–2359 | 外观面板与其 hooks | `ConfigPanel`（1567）、`useConfigPanelHotkey`（2240）、`useFastLock`（2276）、`useLongPress`（2311） |
| 8 | **2360–2407** | **几何引擎（核心）** | `CARD_MIN_HEIGHT`（2360）、`COLUMNS_WIDTH`（2363）、`PANEL_WIDTH`（2364）、`frame`（2374）、`clamp`、`geometryKey`（2404） |
| 9 | 2408–2484 | 行模型（纯函数） | `groupById`（2408）、`providerLabel`、`providerRows`（2424）、`modelRows`（2455） |
| 10 | 2485–2590 | 样式注入与注册 | `STYLE_ID`（2485）、`applyStyleSheet`（2487）、`SeatBoundary`、`SLOT`（2511）、`registerSeat`（2548） |
| 11 | **2591–3595** | **`ModelSeat` 组件** | 状态、几何、选择、滑块、渲染（见下表） |
| 12 | 3596–3642 | 导出半边 | `inject`、`apply`、`__internals`（3629） |

`ModelSeat` 内部再分 8 块（行号 = 0.1.1）：

| 块 | 行 | 说明 |
| --- | --- | --- |
| hooks 与 store | 2591–2639 | `useSyncExternalStore`（2592）、11 个 `useState`（2596–2609）、8 个 `useRef`（2610–2617）、`useFastLock()`（2622）、`useConfigPanelHotkey()`（2623）、`useLongPress`（2638） |
| 派生数据 | 2640–2790 | `groups/current/pending/busy/disabled`、`layout`（2652）、`choices`、`currentChoice`、`reasoning/efforts/effectiveEffort`、`levels`、`ratios`、`levelIndex`、`displayIndex`、`displayLabel`、`modelLabel`、`isUltra`、`tremble`、`shownRatio`，以及搜索框聚焦等只读副作用（2721 起） |
| 开关与关闭 | 2791–2846 | `close`（2791）、`toggleCard`（2807）、外部 pointerdown 与 Escape（2823–2846） |
| 几何 ①锚点 | 2847–2889 | `frameKey`（2880）、`anchorKey`（2883）、量触发器盒、监听 resize/滚动（2872–2873）、`setRect`（只在盒变化时） |
| 几何 ②冻结 | 2890–2942 | 量自然高度 → `setFrozen`（2907）；`document.fonts.ready` 复量（2933） |
| 样式表重建 | 2943–2946 | 配置变化 → 重新 `buildCss` → `applyStyleSheet`（2944） |
| 选择与滑块 | 2947–3190 | `submit`（2956）、`showQuota`、`applyLevel`、`chooseModel`（2990）、`reset`、`ratioFromClientX`、`nearestIndex`、`snapBack`、`beginDrag`（3081）、`finishDrag`、`cancelDrag`、`onSliderKey`（3154）、`triggerTitle`（3175） |
| 渲染 | 3191–3595 | `triggers`（3191）、`menu`（3249）、两列、思考面板、portal（3577） |

参数化的纯函数（`__internals` 暴露，测试直接用）：

- `frame(anchor, layout, naturalHeight, floorHeight) -> { left, bottom, width, height, flipped }`
- `geometryKey(layout, status, levelCount) -> string`
- `providerRows(state, currentProvider) -> Row[]`、`modelRows(group, query, current) -> Row[]`
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
wanted = min(max(natural, floor), 420)          // 132 是下限
above  = anchor.top    - 8                      // CARD_GAP
below  = innerHeight - anchor.bottom - 8
flipped = above < wanted && below > above
room    = flipped ? below : above
height  = max(132, min(wanted, room))
left    = clamp(anchor.left, 12, innerWidth - width - 12)
bottom  = flipped ? innerHeight - anchor.top + 8 : innerHeight - anchor.bottom - 8
```

`bottom` 用 `position: fixed` 的底边定位，因此卡片是从底边往上长的 —— 这正是上游闪动的物理来源，也是为什么 `natural` 必须被冻结而不是每帧重算。

### 5.2 两段式几何

```
open/pane/anchor/status 变化
   │
   ├─ ① 锚点段（2853–2895）：读触发器 getBoundingClientRect → setRect（只有盒真的变了才 set）
   │
   ├─ ② 冻结段（2896–2948）：card.style.height = "auto"; maxHeight = "none"
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

1. **token 表**（`COLOR_TOKENS`，68–131）：每一行是 `{ key, label, cssVar, light, dark }`，`cssVar` 形如 `--c-trigger.model`。
2. **模板**（`CSS_TEMPLATE`，676 起）：所有颜色写成 `var(--c-*)`，**不写具体色值**。模板分两段：`.gptm-*`（外壳/触发器/面板，来自 A）与 `.ms-*`（两列卡片，来自 B）。
3. **构建**（`buildCss`，655）：把每个 `var(--c-*)` 按 light 值解析 → 得到主样式表；再把每条语句按 dark 解析，只有**解析结果不同**的语句才进 `html[data-ds-theme-source="dark"] { … }`；最后加一个 `@media (prefers-color-scheme: dark)` 兜底（页面没有主题属性时生效）。

颜色改动因此不需要动 CSS：改 token 的 light/dark 值，`buildCss` 输出的文本就变了，`applyStyleSheet` 发现文本不同才替换 `<style>` 内容。

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
| 复位按钮 | 先解锁 fast → `setFast(false)` → 选回 `defaultEffort ?? efforts[0].id` | 不关 |
| retry 行 | `load()` 重新拉取该供应商 | 不关 |

`submit()`（2962）只关心 `result === undefined || result.ok === true` 才算成功；失败时卡片**保持打开**，错误由宿主的 `error` 字段渲染出来。这是刻意的：关掉卡片会藏起失败原因。

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

全局（不随组件走）：`CONFIG_STORE`（配色）、`FAST_STORE`（fast + lock）、`PANEL_STORE`（外观面板开关）。

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
| `thinking` | `panel` | 300 | 头部（bolt + 状态按钮 + 复位）+ 粒子滑块 + 提示 |

**布局只由 `pane` 决定。** `query` 只改变模型列里渲染哪些行，不改变布局、不改变宽度、不触发复量。

### 8.4 可访问性契约

- 两个触发器：`aria-haspopup="dialog"`，`aria-expanded` 绑定各自 pane；思考触发器另有 `aria-label` 与 `title`（锁定时是 `fast.locked`）。
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

`normalizeConfig`（401）接受三种输入：

- v1：扁平 `colors: { token: value }`；
- v2：`colors: { light: {…}, dark: {…} }` 的按侧表；
- v3：当前形状。

迁移后统一升成 v3；同时**清掉指向不存在方案的激活**（`slots[side].scheme` 指向已删除的方案时置 `null`），避免出现"激活了一个空方案"。

**不读上游存储键**（`dsh-client-ui-gpt-helper:config:v1`）：schema 变了，静默半迁移比回默认值更糟。`validate` 里有检查专门防止上游键复活。

### 9.4 fast 状态

```js
{ fast: boolean, locked: boolean }   // dsh-client-ui-model-seat:fast:v1
```

- `readFast` 保证 `locked === true` 时 `fast` 必为 `true`。
- 写入后同步到 `FAST_STORE`；`storage` 事件、窗口 focus、pointerdown（捕获阶段）都会重新读盘 —— 这是为了"另一个窗口改了 fast，这个窗口的按钮标签也要变"。
- 长按 600 ms（`LONG_PRESS_MS`）在 bolt 上切换 `locked`；`useLongPress` 只管计时并以 `consumed()` 让调用方丢掉长按后紧跟的那次 `click`，非左键（`pointerType === "mouse" && button !== 0`）直接忽略。

### 9.5 跨窗口

`window.addEventListener("storage", …)` 只在**其它**窗口写入时触发，所以本地写入无需广播；两个 store 都重读，不做合并。

## 10. i18n

- 一个命名空间 `model-seat`，在 `apply()` 里注册（早于第一次渲染），两种语言 `zh` / `en`。
- 组件拿到的 `t` 来自槽位注入的 `locale`；`t("a.b", { x })` 支持模板参数。
- 规则：
  1. 两个语言**键集完全一致**（`i18n.test.mjs`）；
  2. 代码里出现的每个字面量键都必须能解析（同上）；
  3. 不许有死键（"no dictionary entry is unreachable from the bundle"）：删功能时同步删键，例如移除返回箭头时一并删掉了 `action.back`；
  4. 中英文文案必须真的不同（防止复制粘贴时忘改）。
- 常用键：`pane.providers`（供应商）、`pane.models`（模型）、`search.placeholder`（搜索模型）、`provider.account`（DeepSeek 账户）、`retry.row`（重试）、`fast.lockHint`、`aria.modelProvider`。

## 11. 测试矩阵

### 11.1 一键

```
npm run check       # validate → css → loadcheck → test     （约 3 s，不需要浏览器）
npm run e2e         # headless Edge + CDP                    （约 20 s，用仓库内 test/vendor 的 react）
npm run check:all   # 两者
```

### 11.2 每个脚本守什么

| 脚本 | 数量 | 守的东西 | 失败时先看 |
| --- | --- | --- | --- |
| `validate-plugin.mjs` | 61 项 | 清单字段、`files`、`exports`、补丁行 id/name、入口 `name`/`apply`、Host 半边不碰 DOM、只有一次 `__ModuleLoader__.load`、`apply` 是真函数、`__internals` 齐全、`BUILD` 存在且含版本、无上游模块 id/上游存储键、无 `data-dsh-pm-`、无 `data-gpt-helper`、8 个 `data-model-seat` 值齐全、座位键存在、只注册一次、槽位名、优先级 `-2`、locale 命名空间、按会话 inject、边界组件、词典注册、中英双语、只有一个 `<style>`、样式 id、样式体量、`frame` 契约、卡片规则、槽位动画保留、样式复用、head 里只有一张表 | 打印的第一条 `✖` |
| `css-audit.mjs` | 193 规则 / 205 选择器 | `<style>` 注入、括号平衡、无 `!important`、无未解析颜色标记、无模板占位符、无上游属性选择器、选择器数 > 60、无裸 `.ms-`、每条规则挂在控件根下、每个渲染出的 `.ms-` 类都有规则、卡片是 border-box；死规则只 warn | `css-audit:` 汇总行 + 上一条 `✖` |
| `loadcheck.mjs` | 10 项 | 注入目标存在、槽位在加载的前端里声明、注册表按优先级排序、入口名与包名一致、`apply` 导出、补丁行 id 是新的、补丁只插一行；**没有 dsh checkout 时整体跳过**（不算失败） | `skipped` 说明 |
| `test/frame.test.mjs` | 10 | `frame()` 纯函数语义：列宽、面板更窄、自然高度优先、上下翻转、锚点底边、无空间时不翻、视口夹取、封顶后与自然高度无关、`geometryKey` 只随三要素变、地板语义 | 对应用例名 |
| `test/i18n.test.mjs` | 6 | 见第 10 节 | 对应用例名 |
| `test/register.test.mjs` | 6 | 注册恰好一次且 `-2`、每会话一个目录、子代理隐藏、`<style>` 只进 head 一次、没有直连服务时走 `ctx.inject`、没有 effect runner 也能注册词典、错误边界回落 | 对应用例名 |
| `test/rows.test.mjs` | 7 | `groupById` 容错、`providerLabel` 回显未知 id、供应商行 + retry 行、空状态、retry 行无 id 时按位置兜底、模型行标记当前项 + 大小写无关过滤、缺 group/缺名字 | 对应用例名 |
| `browser-check.mjs` | 8 段 | ①两列卡片（宽度/内边距/搜索框在模型列/触发器三段）②指针静置 60 个模型 900 ms 高度不变 ③关→开可复现 ④查询跨供应商且布局不变 ⑤思考面板滑块/键盘/fast/长按 ⑥状态按钮回两列 ⑦配色热键 ⑧控制台无错误 | 报告里 `problems[]` 与 `shape`/`still`/`filtered` |
| `live-check.mjs` | 视页面而定 | 真实 dsh 页面上：样式只注入一次、触发器形如 `provider/model`、卡片能开、两列、显示前已量好（`data-ready`）、内联高度冻结、900 ms 内只有一个高度、思考面板无搜索框、Escape 关闭；`--publish` 额外点一个模型并断言触发器改名 | `problems[]` / `consoleErrors[]` |

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

## 12. 在真实 dsh 上验证

### 12.1 临时 DSH_HOME（推荐，绝不碰自己的库）

```bash
SEAT_HOME=~/AppData/Local/Temp/seat-live-home
mkdir -p "$SEAT_HOME" && cp ~/.dsh/.credentials.yaml "$SEAT_HOME/"
export DSH_HOME=$SEAT_HOME
DSH=/path/to/dsh/node_modules/@deepseek-ai/dsh/lib/bin.js
node "$DSH" plugin --profile seatcheck --from-default-profile web
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
| `pane.{slider,search,now,max,fast}` | 思考面板的内容 |
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
2. `COLUMNS_WIDTH`（约 2369 行）改成新合计；
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
| fast 模式 | 600 ms 长按锁 | 无 | 保留 A |
| 配色面板 | token 表 + 方案库 + JSON 导入导出 | 无 | 保留 A |
| 错误重试行 | 无 | 有 | 保留 B（`providerRows` 里的 `retry` 行） |
| 尺寸策略 | 内容驱动 | 内容驱动（闪动源） | **帧驱动**：`frame` + 冻结 + 列内滚动 |
| DOM 属性 | `data-gpt-helper=*` | `data-dsh-pm-*` | **只有 `data-model-seat=*`**（root / menu / model-trigger / effort-trigger / thinking-slider / fast-toggle / config-panel / config-backdrop）；0.1.1 起两个上游属性一个都不输出 |
| 归属命名空间 | `dsh-client-ui-gpt-helper` | `dsh-model-provider-prefix` | `dsh-client-ui-model-seat`（模块 id / 存储键 / 补丁 id / 槽位 locale 全部换新） |

**刻意的取舍**：B 的"搜索框只在模型多时出现"没有照搬。原因：我们允许跨供应商搜索，而搜索框承担的是"怎么找到模型"，与当前供应商的模型数无关；而且它的出现/消失本身会改变列内容高度（闪动风险）。

## 16. 已知风险与硬约束

1. **`tools/merge/gen-client.mjs` 会覆盖手写文件**。它是初稿生成器（从 `A` 的 3083 行 bundle 逐段打补丁），跑一次就会把 3642 行的合并体换成只有 A 的旧版本。现已加门禁：不带 `--force` 直接 `exit 1` 并打印原因；带 `--force` 也会先写 `lib/client.js.bak-gen-<时间戳>` 备份。保留原因：里面记录了当年 A 的锚点。
2. **E2E 的 React vendor 已收进仓库** `test/vendor/`（开发版 UMD，MIT）。`scripts/browser-check.mjs` 与 `scripts/shots.mjs` 默认读它，`--vendor DIR` / `REACT_VENDOR` 仍可覆盖。
3. **桌面 profile 不可用普通 CLI 改**：`bin.js` 的 `rejectElectronProfile` 会抛 `profile "desktop" is managed exclusively by the Electron application`；必须走 `@deepseek-ai/dsh-desktop-host/lib/cli.js` 的 `runCli({ manageDesktopProfile: true, … })`。
4. **`0.5px` 在各 dpr 下不等宽**（dpr=1 时 1 设备像素），视觉可接受，不要用 JS 去"修正"。
5. **只含 `var()` 的声明会被丢弃**，所以颜色必须是构建期字面量。
6. **单座位**：本插件不提供"关掉自己"的开关；要停就用 `dsh plugin remove`。
7. **无运行时依赖、无构建步骤**：改完 `lib/client.js` 直接用，但宿主只在 boot 时挂载 bundle，**改完必须重开应用**（Ctrl+R 只重载页面，不重新加载 bundle —— 除非宿主热更新）。
8. **`.research/` 与 `.shots/` 会被提交**：没有 `.gitignore`，注意别把 700 MB 克隆或截图带进仓库。

## 17. 安装、升级、回滚

### 17.1 装（web / 普通 profile）

```bash
node <dsh>/node_modules/@deepseek-ai/dsh/lib/bin.js plugin --profile <p> add link:/path/to/dsh-client-ui-model-seat
```

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
7. ~~`ArrowLeft` 图标~~ —— 0.1.1 删除（返回箭头早就没了，它只剩死代码）。删后 `lib/client.js` 从 3651 行落到 3642 行，§3 的两张行号表已随本次重定基线一起更新。
8. ~~版本号 0.1.1~~ —— `package.json` `version` 与 `lib/client.js` 的 `BUILD = '0.1.1+merge'` 同步；`browser-check` 现在从 `package.json` 读版本号并断言根节点 `data-build` 等于「版本号 + `+merge`」，两边再也不会各写一份。

仍待办：

9. **列间键盘导航** —— 用户在 0.1.1 明确说这一轮不做：左/右方向键在供应商列与模型列之间移焦点。现状是 Tab 在卡片内自然穿行、滑块的方向键已实现（`onSliderKey`，`lib/client.js:3154`）。将来要做，注意别让焦点移动触发 `setRect`/`setFrozen` 复量。
10. **host 半边的 `engines.dsh`** —— 随容器 API 稳定后再复核 `>=0.2.1-rc.2` 是否仍准确。
