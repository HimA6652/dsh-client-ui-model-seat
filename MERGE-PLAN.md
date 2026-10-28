# 合并方案：dsh-client-ui-model-seat

## 实施结果（0.1.0 落地记录 + 0.1.1 修订）

> 本文档其余部分是**合并前的设计稿**，保留原样作为决策档案。实际落地时与设计不同之处见下表，代码为准、维护请看 [MAINTENANCE.md](MAINTENANCE.md)。

| 设计稿 | 实际落地 | 原因 |
| --- | --- | --- |
| B 的「座位看门狗」一并搬迁 | **未实现**；兜底改由 `SeatBoundary` 错误边界 + 单 `<style>` 注入承担 | 看门狗依赖 B 的 `data-dsh-pm-*` 命名空间，而同装上游时 B 的 `<style>` 永不删除，属性名相同会被其规则命中；`validate` 因此反向强制「no watchdog aliases」 |
| `freeze: "measured" \| "fixed"` + `fixedHeight` 配置项 | **未实现**；冻结是唯一策略，没有可配置项 | 两个变体在实现期合并成「一次测量 + 地板单调」，配置项只增加分支不增加能力 |
| 列布局宽 340 | **416**（168 + 236 + 2 + 4×2） | 照搬 B 的度量，见 B `client/client.js` 的列宽常量 |
| 搜索框按 B 的规则「仅当该供应商 > 6 个模型才渲染」 | **始终渲染且跨供应商** | 搜索的语义是「找到模型」，与当前供应商模型数无关；显隐本身还会改变列内容高度 |
| 保留 40px 返回箭头行 | **删除**；双向切换靠思考触发器与卡片头部 `.gptm-status` 按钮 | B 没有这一行，且它是「顶部大片空白」的直接成因 |
| 沿用 A 的存储键做迁移 | **换新键** `dsh-client-ui-model-seat:config:v1` / `:fast:v1`，不读旧键 | schema 从扁平色表升到 v3 双侧表，静默半迁移比回默认值更糟 |
| 注册优先级 `-2` | 已落地 | 与上游（`-1`）和自带控件（`0`）同装均不抛 |
| `data-gpt-helper` 别名 | 0.1.0 先保留 8 个；**0.1.1 全部删除**，只输出 `data-model-seat=*` | 保留期观察后确认没有第三方 CSS 依赖它们；留着反而让 A 的 `[data-gpt-helper]` 规则有机会命中本卡片。`validate` 改为反向检查：整份 bundle 不得出现 `data-gpt-helper`，并逐个断言 8 个 `data-model-seat` 值存在 |

验收数据（0.1.0，`npm run check` + `npm run e2e` + 真实 dsh）：validate 57 项、css-audit 190 规则/202 选择器、loadcheck 10 项、29 个用例全绿；fixture 卡片 416×420、指针静置 900 ms 高度不变、查询后仍为 `columns`；真实桌面 profile（15 个插件同装）6 个供应商、卡片 416×238、900 ms 内单一高度、控制台无错误。

验收数据（0.1.1）：validate 61 项、css-audit 193 规则/205 选择器（12 个 `.ms-` 类全部有规则且有渲染）、loadcheck 10 项、29 个用例全绿；`npm run e2e` 9 段全过、`problems: []`，卡片 416×420 高度恒定，新增的第 5 段断言空查询只剩一条带 8px 内边距的 `.ms-empty`（截图 `.shots/v011/03-empty-query.png`）。

---

> 依据：两个仓库的实际代码（A = `dsh-client-ui-gpt-helper` @ `bc18b1a` v0.2.0；B = `dsh-model-provider-prefix` @ `bc89f42` v0.2.6）、本机已装运行时（`@deepseek-ai/dsh-desktop-runtime 0.2.1-rc.2`）的槽位实现，以及我为复现闪动搭的 headless Edge + React 18 测试床。
> 结论都标了文件行号与实测数字；没验证到的写在**待确认**里，不猜。

## 0. 结论先行

1. **必须合并，不是可选项**。两个插件抢同一个 `single` 槽位 `conversation.input.model`，优先级都是 `-1`。运行时的 `single` 槽位在**同优先级第二次注册时直接抛错**，后加载的那个插件 `apply` 失败、座位不出现。这是注册期硬冲突，和样式无关。
2. **合并形态**：A 的壳（配色体系 `buildCss` + 24 token、滑块与粒子、快模式与长按锁、配色面板、i18n、localStorage 持久化）+ B 的数据与交互骨架（供应商列/模型列两段式、hover 换列、失败重试、座位看门狗、错误边界）。注册优先级改为 **`-2`**，低于两个原插件（`-1`）和原装控件（`0`），"三个都装也不崩，合并版赢"。
3. **闪动 bug 已复现并定位**：不是 React 渲染死循环，而是"**底边锚定 + 内容驱动高度 + hover 换列**"叠加出的"布局 → 指针 → 布局"闭环。实测 7 供应商 / 长供应商 60 模型：900ms 内**高度跳变 27 次**（16–18ms 一次，等于每帧一次）；**冻结卡片几何后 0 次**。
4. 有 **7 个待你拍板的选项**（第 7 节），每个都给了推荐值和代价；不答复我也能按推荐值实施。

---

## 1. 两个仓库的实现梳理

### 1.1 插件 A：dsh-client-ui-gpt-helper

**产物与入口**

| 项 | 值 | 位置 |
|---|---|---|
| 布局 | `lib/index.js`（宿主半边）+ `lib/client.js`（浏览器半边，131,308 B 单文件） | `package.json` |
| 浏览器入口 | `window.__ModuleLoader__.load({ id, factory })`，factory 只 `require('react')` | `lib/client.js:1` |
| 清单 | `exports['./client']`、`dsh.bundle.patch: './cordis.patch.yml'`、`dsh.client { platform:'web', immediately:true, inject:['@deepseek-ai/dsh-client-ui-conversation'] }` | `package.json` |
| 行注入 | `- insert: [{ id: gpt-helper, name: dsh-client-ui-gpt-helper }]` | `cordis.patch.yml` |
| 宿主半边 | 只有 `export function apply() {}` | `lib/index.js` |
| 开发脚本 | `validate / selfcheck / contrast / loadcheck` | `scripts/*.mjs` |

**注入方式**（`lib/client.js:3027-3081`）

- `inject: ['slots','modelDirectories','sessions','locale','remote','remote.session']`。注释写明 `remote.session` 是 `modelDirectories.directoryFor()` 内部解析所需，否则报 `cannot get property "remote.session" without inject`。
- `ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'gpt-helper: dictionaries')`，NS = `gpt-helper`。
- `ctx.slots.inject('conversation.input.model', () => ctx.slots.register({ name, priority: -1, locale: NS, inject: (sessionId) => ({ available, directory, load, select }) }, ModelEffortControl))`。
- 注释（`:3047-3058`）说明：`single` 槽位按 priority 升序取第一个渲染，同优先级抛错；原装控件默认 `0`；boot-graph 插件不会自动分配优先级，必须显式给负数。

**DOM / 样式 / 事件**

- 触发栏：**单按钮** `.gptm-trigger[data-gpt-helper=model-effort-trigger]`（闪电 + 模型名 + 等级 + caret），`data-fast` / `data-ultra` / `data-locked` 驱动样式（`:2710-2742`）。
- 弹层：portal 到 `document.body` 的 `.gptm-menu[role=dialog]`，`position: fixed` + 内联 `left/bottom`（`:2990-3007`）；宽 258px、`max-height: min(440px, 100vh - 96px)`、`overflow: hidden`、**高度随内容增长**（`:714-726`）；入场动画 `gptm-in 160ms`（`translateY(3px) scale(.985)`，`:727-730`）。
- 两个 pane：
  - `thinking`：快模式开关（点按切换 / 长按 600ms 加锁）、状态按钮（跳到模型 pane）、重置、`.gptm-slider`（轨道/填充/刻度/42 粒子/滑块，键盘 Arrow/Home/End）、提示行（`:2844-2987`）。
  - `models`：`.gptm-paneHead` + 搜索（`choices.length > 4` 才出现）+ `.gptm-scroll`（**唯一滚动区**，`flex:1 1 auto; min-height:0; overflow-y:auto`）+ 供应商分组标题 `.gptm-heading` + 行 `.gptm-row`（`:2762-2839`）。
- 关闭/重定位：外部 `mousedown` 关闭；`keydown` capture 的 Escape `stopPropagation` 后关闭；`resize` 与 `scroll(capture)` 重算位置（只改 `left/bottom`，**不重算内容高度**）；`panelOpen` 时关闭弹层。
- 事件细节：滑块用 window 级 `pointermove/pointerup/pointercancel` + pointer capture；长按用 `useLongPress`（`:2171-2210`），`consumed()` 吞掉长按后的 click；配色面板快捷键 `Ctrl+Shift+Alt+G`（`:2100-2126`）。
- 状态：`CONFIG_STORE`（键 `dsh-client-ui-gpt-helper:config:v1`，含配色库/快捷键/激活位）、`FAST_STORE`（键 `:fast:v1`，`{fast, locked}`，加锁强制 fast=true）、`PANEL_STORE`（不持久化）。快模式**纯视觉**，不参与 `select()`。
- 样式：`buildCss(config)` 每次渲染生成 `<style>` 文本，把 24 个 token 解析成**字面量颜色**（注释给了"Chromium 丢弃只含 var() 的声明"的实测原因）；box-sizing 重置只覆盖 `.gptm-root/.gptm-menu` 子树（`:676`），因为宿主没有全局重置。
- 错误处理：**没有错误边界**；README 记录渲染期 `ReferenceError` 会让整个 web boot 挂（`web boot: 1 entry did not activate`）。

### 1.2 插件 B：dsh-model-provider-prefix

**产物与入口**：`index.js`（宿主半边，空 `apply`）+ `client/client.js`（677 行 / 30,700 B 单文件）；`dsh.client { inject: ['@deepseek-ai/dsh-client-ui-conversation','@deepseek-ai/dsh-client-ui-model-selection'], platform:'web' }`（无 `immediately`）；行 `- insert: [{ id: dsh-model-provider-prefix, name: dsh-model-provider-prefix }]`；`engines.dsh: '>=0.2.1-rc.2'`。

**注入方式**（`client/client.js:529-656`）

- 同槽位、同优先级 `-1`；组件被 `SeatBoundary`（`:489-513`）包住，出错时渲染 `Model` 兜底按钮。
- **座位看门狗**：`attempt()` 先 dispose 再注册；`seatRendered()` 查 `document.querySelector('[data-dsh-pm-trigger]')`；`LADDER = [60,150,350,700,1200,2000,3200]` + `MutationObserver(document.body, {childList:true, subtree:true})`（rAF 合并）；连续 miss 退避 `min(200 + 200n, 2000)`；disposer 清定时器、断开 observer、释放注册。
- 为什么要它：会话/输入框重挂时槽位会被重新占用，一次性注册会丢座位。

**DOM / 样式 / 事件**

- **两个触发按钮**：`[data-dsh-pm-trigger]`（模型：`Provider/Model`）与 `[data-dsh-pm-trigger][data-dsh-pm-effort]`（强度；仅当当前模型声明了 reasoning 才渲染）。
- 卡片 `[data-dsh-pm-pop]`：portal，`position: fixed`；`cardStyle(rect, width)`（`:245-251`）返回 `{ left, bottom: innerHeight - rect.top + 6, maxHeight: min(420, rect.top - 24) }` —— **底边锚定、高度由内容决定、`maxHeight` 由触发栏位置算**。
- 三列 `[data-dsh-pm-col=providers|models|effort]`，宽 168 / 236 / 196（`:14-62`）；行 `[data-dsh-pm-row]`，`onMouseEnter`/`onFocus` → `onHover`（`:221-242`）。hover 供应商只换模型列、**不关闭**；点模型/强度调用 `face.select` 后关闭。
- 搜索：模型数 > 6 才出现，范围限当前供应商。
- 样式：单 `<style id="dsh-model-provider-prefix-style">`，只用 `var(--dsw-alias-*)`，z-index 1200，**没有 box-sizing 重置**（content-box）。
- README 自述限制：无键盘导航、中文硬编码。

### 1.3 冲突的硬证据

`single` 槽位注册实现（`@deepseek-ai/dsh-web-frontend/dist/assets/index-CN7NIWNw.js` 的 `register()`）：

```js
case "single": {
  const h = r.entries.find(m => (m.options.priority ?? 0) === n);
  if (h) throw new Error(`single slot "${e.name}" already has a registration at priority ${n} … register at a different priority to shadow it (lowest renders)`);
  break
}
```

即：**同优先级 = 抛错；不同优先级 = 不抛错，数值最小者渲染**。A 的源码注释（`:3047-3058`）独立得出同一结论。

---

## 2. 合并后的目录/文件结构与入口设计

### 2.1 目录树

```
dsh-client-ui-model-seat/
├─ package.json
├─ cordis.patch.yml           # - insert: [{ id: model-seat, name: dsh-client-ui-model-seat }]
├─ index.js                   # 宿主半边（name + 空 apply），与 B 同形
├─ lib/
│  ├─ index.js                # 也可以；最终发布形态见 2.2（择一，不并存）
│  └─ client.js               # 出厂 bundle（window.__ModuleLoader__.load），唯一浏览器产物
├─ test/
│  ├─ data.test.mjs           # B 的纯数据层：resolve / providerRows / modelRows / effortRows / effortLabel
│  ├─ seat.test.mjs           # 清单、注册优先级、inject 并集、看门狗重注册、边界兜底
│  └─ frame.test.mjs          # 新增：冻结几何纯函数 frame() 的不变量
├─ scripts/
│  ├─ validate-plugin.mjs     # 移植 A：清单契约只读校验
│  ├─ loadcheck.mjs           # 移植 A：按宿主方式加载 bundle 并 apply（stub React）
│  └─ css-audit.mjs           # 新增：token 覆盖 / 无裸色值 / 无未定义选择器
├─ tools/flicker/             # 闪动回归（开发用，见 5.4）
│  ├─ harness.js
│  ├─ index.html
│  └─ run.mjs
├─ docs/
│  ├─ prototype.html          # 移植自 A（设计原型，保留）
│  └─ migration.md            # 从 A/B 迁移、兼容与回滚
├─ README.md
└─ LICENSE
```

**最终只用一套半边布局**：沿用 A 的 `lib/`（`lib/index.js` + `lib/client.js`），删掉上面的 `index.js` 备选行。理由：合并版是 A 的 fork，A 的 `loadcheck/validate` 脚本、`exports` 约定、`files` 白名单都是按 `lib/` 写的，沿用可少改测试代码。

### 2.2 入口设计（package.json）

```json
{
  "name": "dsh-client-ui-model-seat",
  "version": "0.1.0",
  "type": "module",
  "exports": {
    ".": "./lib/index.js",
    "./client": "./lib/client.js",
    "./package.json": "./package.json"
  },
  "files": ["lib/index.js", "lib/client.js", "cordis.patch.yml", "README.md", "LICENSE"],
  "engines": { "dsh": ">=0.2.1-rc.2" },
  "peerDependencies": { "@deepseek-ai/cordis": "~4.0.4" },
  "dsh": {
    "bundle": { "patch": "./cordis.patch.yml" },
    "client": {
      "platform": "web",
      "immediately": true,
      "inject": [
        "@deepseek-ai/dsh-client-ui-conversation",
        "@deepseek-ai/dsh-client-ui-model-selection"
      ]
    }
  }
}
```

- `immediately: true` 取 A 的（更早注入，避免"座位先被原装控件占一帧"）；`inject` 取两者并集。
- 行 id 用 `model-seat`（**不能**沿用 `gpt-helper` 或 `dsh-model-provider-prefix`，否则可能与残留行重名，见第 6 节迁移）。
- 浏览器半边仍是**单文件 bundle**：`dsh.client` 只认 `platform / inject / external / immediately` 四个字段（`@deepseek-ai/dsh-client-modules/lib/index.js` 的 `parseDshClient`），bundle URL 由 `exports['./client']` 决定，**不支持多入口/构建期分包**。两个上游插件也都是"直接提交的 bundle、零构建"，沿用这条约定能让 `loadcheck` 与单测直接跑出厂字节（测什么就发什么）。

### 2.3 文件内分区（单文件的可维护性约定）

`lib/client.js` 按固定顺序分段，段首注释写职责与"不可越界的约束"：

| 段 | 内容 | 约束 |
|---|---|---|
| §0 | `BUILD`、`NS`、`STORAGE_KEY`、`SLOT`、`PRIORITY`、几何常量 | 只放常量 |
| §1 | token 表 + `buildCss` + `CSS_TEMPLATE` + **单一** `head` 样式节点 `#dsh-model-seat-style`（config 变化时整块重写，见 C22） | 颜色只能来自 token，禁止裸 hex |
| §2 | i18n 字典（zh/en） | 所有可见文案都走 `t()` |
| §3 | stores（config / fast / panel）+ 存储迁移 | 快照不可变，持久化只写新键 |
| §4 | 纯数据层（B 移植）：`resolve/groupById/effortLabel/providerRows/modelRows/effortRows` | 无 DOM、无 React，可直接单测 |
| §5 | 几何：`frame(rect, pane, natural)` 纯函数 + `MIN/MAX/宽度` 常量 | **只吃 rect/pane/natural，绝不接收 hover/query** |
| §6 | 触发栏（两个按钮） | 只读状态，不改几何 |
| §7 | 卡片（三 pane：providers / models / effort） | 内部滚动，外部尺寸固定 |
| §8 | 冻结测量 effect + 关闭/重定位 | 几何只写内联样式，不参与渲染 |
| §9 | 注册与看门狗 + 错误边界 + `__internals` 导出 | 优先级 `-2` |

### 2.4 注册骨架（与 A 同形，只改三处）

```js
export default {
  inject: ['slots', 'modelDirectories', 'sessions', 'locale', 'remote', 'remote.session'],
  apply(ctx) {
    console.info(`[model-seat] client half applied — build ${BUILD}`)      // ① 激活信标改前缀
    ctx.effect(() => ctx.locale.register(NS, { zh: ZH, en: EN }), 'model-seat: dictionaries')
    registerSeat(ctx)                                                     // ② 包一层看门狗
  },
}
// registerSeat 内部：slots.register({ name: 'conversation.input.model', priority: -2, locale: NS, inject }, SeatBoundary(ModelSeat))
```

`__internals = { ModelSeat, SeatBoundary, resolve, groupById, effortLabel, providerRows, modelRows, effortRows, frame }` 供 `node --test` 直接调用（B 的测试就是这么写的，`test/client.test.mjs:146-152`）。

---

## 3. 共存方式、冲突点与消解

### 3.1 功能归属表（先证明"一个都没漏"）

| # | A 的功能 | 合并后 | 说明 |
|---|---|---|---|
| A1 | 接管 `conversation.input.model` | 保留 | 优先级改 `-2` |
| A2 | 单触发按钮（闪电+模型+等级+caret） | **改造** | 拆成两个按钮（见 3.2） |
| A3 | 思考强度 pane（滑块+粒子+刻度） | 保留 | 成为 `effort` pane |
| A4 | 快模式点按切换 | 保留 | 挂在模型按钮的 `data-fast` + 强度 pane 的闪电键 |
| A5 | 长按 600ms 锁定快模式 | 保留 | 原 `useLongPress` |
| A6 | 等级键盘操作（Arrow/Home/End） | 保留 | 滑块不变 |
| A7 | 模型 pane：分组平铺 + 搜索 | **改造** | 改为供应商列/模型列（B 形态） |
| A8 | 选中即提交，失败不关闭 | 保留 | **覆盖 B 的"无条件关闭"**（B 忽略 `select()` 返回值） |
| A9 | 重置（清快模式 + 默认等级） | 保留 | |
| A10 | 配色面板（24 token + 配色库 + 导入导出 + 快捷键） | 保留并扩展到 30 token | 新增供应商列/选中态/分隔线 token |
| A11 | i18n zh/en | 保留并扩充 | 吸收 B 的硬编码中文 |
| A12 | localStorage 持久化 | 保留 + 迁移旧键 | 见 6.3 |
| A13 | 外部点击/Escape/滚动/resize | 保留 | resize/scroll 只改位置，不重量高度 |
| A14 | 状态文案（quota / 快模式锁定 / 加载中） | 保留 | |
| B1 | 两个触发按钮 | 保留 | 合并后的主形态 |
| B2 | 供应商列 → 模型列 | 保留 | |
| B3 | hover 供应商即换列（不关闭） | 保留 | **闪动根因所在，靠冻结几何解决** |
| B4 | 搜索（>6 才出现） | 改造 | 规则见 3.3 |
| B5 | 失败行 + 重试（`face.load()`） | 保留 | A 没有这个能力 |
| B6 | 强度列表 + `Default` 文案 | **改造** | 强度 UI 统一为 A 的滑块；`effortLabel` 保留 |
| B7 | `SeatBoundary` 错误边界 | 保留 | 修掉 A "渲染抛错炸掉整个 web boot" 的隐患 |
| B8 | 座位看门狗 | 保留 | 选择器换成本插件的 |
| B9 | 子代理会话隐藏（`available`） | 保留 | 与 A 一致 |
| B10 | 仅用 token 的 CSS | 改造 | 并入 A 的 `buildCss`（否则配色面板管不到） |
| B11 | 测试套件（20 例） | 移植 | 纯数据层原样过，座位层改路径 |

### 3.2 冲突点与消解（逐条）

| # | 冲突 | A 的做法 | B 的做法 | 消解办法 |
|---|---|---|---|---|
| C1 | **槽位注册** | `priority:-1` | `priority:-1` | 合并版 `-2`：**不同优先级不抛错，最小者渲染**；原装 `0` 也被压住 |
| C2 | 触发栏 DOM | 1 个按钮（模型+等级+闪电） | 2 个按钮（模型 / 强度） | 采用 2 个按钮：`.ms-seat` 容器内 `.ms-trigger`（闪电+供应商/模型+caret）+ `.ms-effort`（等级+caret，无 reasoning 时不渲染）；原 A 的等级文字移入第二按钮 |
| C3 | 弹层容器 | `.gptm-menu` 258px，"随内容长高" | `[data-dsh-pm-pop]` 412px 三列，"随内容长高 + maxHeight" | 统一成一个卡片组件：宽度按 pane 固定（模型 **430**、强度 **258**），高度**冻结**（见第 4 节）；卡片本身不滚动，列内滚动 |
| C4 | 模型选择交互 | 平铺分组 + 跨供应商搜索 | 供应商列 + 模型列 + 限当前供应商搜索 | **空查询 = B 的两列；有查询 = 跨供应商命中列表**（行内带供应商标题）。两条原行为都保住 |
| C5 | 强度 UI 归属 | 粒子滑块 | 强度列表 | 滑块是唯一编辑入口；B 的列表不迁移（同一语义，两个 UI 会互相打脸），但保留 `effortLabel` 的 Default 文案用于滑块刻度 |
| C6 | i18n | zh/en 字典 + locale NS | 硬编码中文 | 统一 NS `model-seat`，B 的 8 条中文进字典（`供应商/模型/推理强度/搜索模型/正在读取…/暂无可用供应商/重试/选择供应商`） |
| C7 | 样式来源 | `buildCss` 字面量 token | `var(--dsw-alias-*)` 直引 | 单一 `buildCss` + 单一 `head` 样式节点；卡片新增 token（供应商列底色、行 hover、选中行、列分隔线、卡片描边、列标题），配色面板一并可控；`css-audit` 禁裸色值 |
| C8 | z-index | 弹层 1100 / 配色遮罩 1200 / 面板 1201 | 卡片 1200 | 统一 `1100 / 1200 / 1201`；卡片用 1100（与宿主弹层同级，低于配色面板） |
| C9 | box-sizing | 子树内重置 | 无重置（content-box） | 卡片根节点起统一 `border-box`（否则冻结高度会多出 9px，实测 271.5 vs 263.5） |
| C10 | 定位与测量 | resize/scroll 重算位置，不重量内容 | 打开时测一次 `rect` | 打开/pane 切换时测一次 `rect` 并**冻结盒子**；resize/scroll 只改 `left/bottom`；不因 hover/键入/数据刷新重测 |
| C11 | 重注册 | 无（`apply` 时注册一次） | LADDER + MutationObserver | 保留 B 的看门狗（这是 B 存在的价值之一），检查目标改成本插件的选择器 |
| C12 | 错误边界 | 无 | `SeatBoundary` | 保留；兜底文案改 `模型`，并 `console.error` 带 build 号 |
| C13 | 注入依赖 | 6 项（含 `remote`/`remote.session`） | 3 项 | 并集 6 项（B 缺 `locale` 会拿不到 `t`；A 缺任一项会让 `directoryFor` 抛错） |
| C14 | 宿主半边 | 空 `apply` | 空 `apply` | 保留一个空 `apply` + `export const name` |
| C15 | 行 id | `gpt-helper` | `dsh-model-provider-prefix` | 新 id `model-seat`；不复制旧行，避免重复 insert |
| C16 | 存储键 | 两个 `gpt-helper:*` | 无 | 新键 + **一次性读取旧键迁移**（配色库不能丢） |
| C17 | 快模式语义 | 纯视觉 | 无 | 保留纯视觉（不参与 `select()`），只在模型按钮与强度 pane 上有状态 |
| C18 | 全局快捷键 | `Ctrl+Shift+Alt+G` | 无 | 保留；已抽查 shipped 包无同字面量快捷键（待确认见 7.6） |
| C19 | 提交流程 | `submit()` 看返回值，失败不关 | 无条件关闭 | 采用 A 的语义，作为合并后统一行为 |
| C20 | `mousedown` 关闭 vs 打开动画 | 已处理（trigger 内不关） | 已处理 | 保留 A 的判定，外加卡片内点击不关闭 |
| C21 | **外来样式表泄漏**（自审新发现，容易漏） | `<style>` 写在组件子树里，组件不渲染就不存在 | `apply()` 把 `<style id="dsh-model-provider-prefix-style">` 追加到 `document.head`（B `:65-77`），**从不移除**；B 被挤到 `-1` 不再渲染，样式却还在 | ① 卡片/列/行**不保留** `data-dsh-pm-*` 别名（只给两个触发按钮保留，B 的看门狗只需要它）；② 自有规则统一写成 `[data-model-seat] .ms-*`（特异性 0,2,0 > B 的 0,1,0），与两份样式表的插入顺序无关 |
| C22 | 两份 `<style>` | 每次渲染重建（携带配色字面量） | apply 时建一次静态结构 | 合并为**一个** `head` 节点 `#dsh-model-seat-style`：结构与颜色都写在里面，config 变化时整块重写（配色面板改动是低频操作）；渲染路径不再产出 `<style>` |

### 3.3 三个"合并后才出现的新选择"（不是原样叠加）

1. **宽度双档**：模型 pane 430px（168 + 1 + 236 + 22 padding + 2 border），强度 pane 258px。切 pane 时宽度会变——这是**点击驱动**的显式变化，不参与闪动闭环；切完立即重新冻结。
2. **搜索跨供应商**：空查询走 B 的两列；输入后模型列变成"全目录命中 + 供应商小标题"。理由：A 的搜索是跨供应商的，B 的是局部限定的，合并后两种都有用户预期。
3. **滑块是唯一强度入口**：B 的强度列不迁移。若你想要"列表快捷档位"，是 7.4 的待确认项。

---

## 4. 闪动 bug：成因与修复

### 4.1 复现（headless Edge 156 + React 18.3.1 UMD，1200×900，触发栏在 y≈848）

| 场景 | 卡片高度 | 900ms 内高度跳变 | 结论 |
|---|---|---|---|
| 7 供应商，供应商 #1 有 60 模型，悬停 #1 | 263.5 ↔ 428 | **27 次**（16–18ms/次） | 稳定复现 |
| 同上，重开一次（Escape → 再开） | 同上 | 27 次 | 与首次打开无关 |
| 10 供应商 / 60 模型 | 263.5 ↔ 428 | 19 次 | 供应商越多越明显 |
| 5 供应商 / 60 模型 | — | 1 次 | 指针在增长后落到卡片外，不闭环 |
| 4 供应商 / 40 模型 | — | 1 次 | 同上 |
| 长供应商是"当前选中"的供应商，悬停短供应商 | 428 → 263.5 一次 | 0 次 | 指针落空 → 不闭环 |
| **注入固定高度**（`height:428px !important`） | 428 恒定 | **0 次** | 控制变量：高度一变就完蛋 |
| **冻结实测高度**（本次修复） | 263.5 恒定 | **0 次** | 见 4.4 |

### 4.2 成因链（实测 + 代码对照）

1. 卡片是 `position: fixed`、**底边锚定**（`bottom = innerHeight - rect.top + 6`，B `client/client.js:250`），高度没有显式值，由内容决定（`maxHeight: min(420, rect.top - 24)`，同处）。
2. 供应商行 `onMouseEnter → setHoveredProvider`（B `:221-242`），**只换模型列内容、不关闭卡片**。
3. 悬停到"60 个模型"的供应商 → 模型列从 3 行长到 60 行 → 卡片自然高度 263.5 → 428（+164.5px）。
4. 因为底边固定，**顶边上移 164px**。指针没动，但它现在落在**另一个供应商行**（列表整体上移约 5 行）。
5. 那一行的供应商只有 3 个模型 → 高度缩回 263.5 → 行下移 → 指针又回到长列表供应商 → 回到第 3 步。每一步都在同一帧内完成（React state → layout），所以循环周期 ≈ 1 帧（实测 16–18ms）。

**触发条件**（两者同时满足才出现）：
- 某个供应商的模型数超过模型列可视高度（出现滚动）；
- 供应商行数足够多，让卡片伸缩后指针仍落在某个供应商行上。

这正是你描述的"某个 provider 下模型过多、列表显示不全时放大缩小反复闪动"。

### 4.3 为什么 A 单独不闪、合并后必须修

A 的 `.gptm-menu` **也是"高度随内容增长"**（`:709-726` 的注释明确写了"the popover grows with its content"），但 A 的模型列表对 hover 无内容变化（hover 只改背景），高度恒定 → 没有闭环。合并后卡片必须承载 B 的 hover 换列，于是把 B 的 bug 引进 A 的壳里。**所以冻结几何不是"顺手优化"，是合并的必要条件。**

### 4.4 修复方案

**不变量：卡片盒子只能是 `(open, pane, rect, status)` 的函数，永远不能是 `(hoveredProvider, query, …)` 的函数。**

实现（实测 0 抖动）：

1. **纯函数** `frame(rect, pane, natural)`：`width` 按 pane 取常量；`height = clamp(natural, min(MIN[pane], room), min(MAX, room))`，`room = rect.top - 16`；`left = clamp(8, rect.left, innerWidth - width - 8)`；`bottom = innerHeight - rect.top + 8`。
2. **只测一次的布局 effect**（`useLayoutEffect`，依赖只含 `[open, pane, rect, status]`）：
   ```js
   el.style.height = 'auto'; el.style.maxHeight = 'none'
   const natural = el.getBoundingClientRect().height
   const box = frame(rect, pane, natural)
   el.style.height = box.height + 'px'   // 只写内联样式，不进 React 渲染
   ```
   几何**不放进 React state**：否则测量 → setState → 重渲染 → 再布局，会多一帧抖动。
3. **`box-sizing: border-box`** 覆盖卡片：不然冻结的是 content-box 高度，实际渲染 271.5（多 8px padding + 1px border），开卡瞬间就有一次跳动。
4. 卡片 `overflow: hidden`；三列各自 `overflow-y: auto; min-height: 0`；供应商列与模型列滚动位置互不影响。
5. 只在 **open 由关到开 / 切 pane / rect 变化（resize、滚动、dpr）/ status 由非 ready 变 ready** 时重测；hover、键入、store 其它字段一律不重测。
6. 补充护栏：`document.fonts.ready` 后若仍打开，静默重测一次（字体晚到会改变自然高度）。

**为什么不用别的办法**：
- "固定死高度 428"：小列表时卡片一半是空气（可作降级，不作默认）。
- "顶部锚定 + 向下增长"：行不再从指针下经过，确实不闭环，但卡片会盖住输入框（卡片就在输入框正上方），不可接受。
- "pointermove 记 y 再回写 hovered"：仍有帧内两跳，且增加一个状态源。
- "防抖/节流 setHoveredProvider"：只是把 60fps 变成 10fps，肉眼仍是闪。

### 4.5 修复验收标准

- `tools/flicker/run.mjs --providers 7 --models 60 --hover 1` → `flips: 0`（基线 27）。
- 悬停长/短供应商来回切换 10 次，卡片 `height` 始终等于开卡时的值。
- 视口 1200×900 / 900×700 / 375×667 三档：卡片不超出视口、不盖住输入框、触发栏不换行。
- 缩放（浏览器 90%/110%）与桌面端 Ctrl+± 后重新打开，高度正确。

### 4.6 边界情况（实施时要覆盖）

| 情况 | 处理 |
|---|---|
| 触发栏贴近顶部（room < 200） | `height` 取 `min(natural, room)`，列内滚动；`min-height` 也随之降级 |
| 打开后模型列表才加载完（`status` 变化） | 允许重测一次；此后不再因数据重测 |
| 供应商只有 1 个模型 | 卡片保持 `MIN_HEIGHT`（模型 pane 220 / 强度 pane 180），不留一条缝 |
| 供应商名很长 | 列内省略号，不换行（否则列高变化） |
| 强度 pane 刻度数变化 | 卡片高度冻结 → 多出来的内容在 pane 内滚动 |
| 开卡入场动画（`scale(.985)` 160ms） | 动画只改 transform，不改尺寸；`prefers-reduced-motion` 下关闭 |

---

## 5. 分步实施顺序与每步验证

> 每步都能独立回退；每步结束都跑一遍 `node --test test/` 与 `node scripts/loadcheck.mjs`。仓库不做 git commit（除非你要求）。

### 步骤 1｜骨架（预计 30 分钟）
- 建 `package.json`、`cordis.patch.yml`、`lib/index.js`、最小 `lib/client.js`（`__ModuleLoader__.load` + 空 `apply` + 激活信标）。
- **验证**：`node scripts/validate-plugin.mjs` 全过；用 10 行 stub 加载 bundle 不抛错；`console.info` 行出现。
- **回退**：纯新增目录，删除即可。

### 步骤 2｜移植 A（不改行为）
- 整文件搬入，脚本化改名：`gptm-` → `ms-`、`data-gpt-helper` → `data-model-seat`（公开节点保留旧属性作别名，见 6.4）、`NS`、`BUILD`、`console` 标签、存储键（先只改名，仍读写旧键，步骤 7 再做迁移）。
- **验证**：`loadcheck`；用 CDP 测试床打开/关闭、切 pane、选模型、拖滑块、长按锁定、开配色面板，逐项与 A 基线录制对比（DOM 文本 + `getBoundingClientRect`）；`css-audit` 报 0 个未定义 token。
- **回退**：`lib/client.js` 回到步骤 1 的最小文件。

### 步骤 3｜移植 B 的数据层与看门狗
- 搬 `resolve/groupById/effortLabel/providerRows/modelRows/effortRows`（保持函数名）；搬 `SeatBoundary`、`registerSeat/seatRendered/ensure/LADDER/observer`；优先级 `-2`，选择器 `[data-model-seat="trigger"]`。
- 把 B 的 20 个测试改路径跑通；补 `seat.test.mjs` 的优先级与 inject 并集断言。
- **验证**：`node --test test/` ≥ 24 例全绿；harness 里手动 dispose 槽位后 3s 内座位自动回位（看门狗生效）。
- **回退**：删 `registerSeat` 调用，退回 A 的一次性注册。

### 步骤 4｜卡片合并 + 冻结（本次核心）
- 三 pane 结构：`providers`（168px）+ `models`（236px）+ `effort`（A 的滑块）；`frame()`；冻结 effect；宽度常量 430 / 258。
- **验证**：
  - `node tools/flicker/run.mjs --providers 7 --models 60 --hover 1` → `flips: 0`；
  - `--providers 4 --models 40`、`--providers 10 --models 60` 同样 0；
  - 三档视口不溢出；键盘 Escape / Tab / 滑块方向键可用；
  - 空查询=两列、有查询=跨供应商，两条路径各有断言。
- **回退**：`git diff` 只涉及 §5/§7/§8 三段，可单独回滚。

### 步骤 5｜样式与 i18n 统一
- 新增 6 个 token 进 `COLOR_TOKENS` 与 `CSS_TEMPLATE`；两份 `<style>` 合成 `#dsh-model-seat-style` 一个 `head` 节点（见 C22）；z-index 归一；`box-sizing` 覆盖卡片；B 的中文入字典。
- **验证**：`node scripts/css-audit.mjs`（每个 `var(--c-x)` 都有表项、无裸 hex、`.ms-*` 选择器都有定义）；浅/深两主题截图；切 `en` 后渲染文本里 grep 无中文。
- **回退**：token 表与 CSS 是纯数据，回滚=还原这两个常量块。

### 步骤 6｜看门狗 / 边界 / 注入并集
- **验证**：注入 `directoryFor` 抛错的桩 → 座位渲染兜底"模型"按钮、控制台有 error、页面不白屏；`inject` 列表与 A 一致（6 项）。
- **回退**：去掉 `SeatBoundary` 包装（回到 A 行为，风险自负）。

### 步骤 7｜兼容层（存储迁移 + 旧属性别名）
- 读旧键 `dsh-client-ui-gpt-helper:config:v1` / `:fast:v1`，新键不存在时复制写入新键；**只在两个触发按钮上**保留 `data-dsh-pm-trigger` / `data-dsh-pm-effort` 别名（B 的看门狗只需要它们），卡片/列/行不保留旧别名（见 C21）。
- **验证**：
  1. 预置旧 localStorage → 载入 → 配色生效且新键已写；
  2. `document.querySelectorAll('[data-dsh-pm-trigger]').length === 2`（B 的看门狗据此停止重注册）；
  3. **交叉验证（B 仍装着的情况）**：`getComputedStyle` 断言卡片 `z-index: 1100`、`box-sizing: border-box`、`padding` 与 `overflow` 等于本插件值——若被 B 的 `head` 样式压住，这里会最先暴露；
  4. `document.querySelectorAll('style').length` 里本插件只有一个 `#dsh-model-seat-style`。
- **回退**：删掉迁移函数，旧键仍在，不丢数据。

### 步骤 8｜打包、安装、真机验收、回滚
- `dsh plugin add link:/path/to/dsh-client-ui-model-seat`（pnpm 支持 `link:`，实测见 7.7）；把 `dsh-client-ui-model-seat` 加进 profile `package.json` 的 `dsh.profile.bundles`（或在插件管理器里开启）；重启桌面端。
- **验收**：
  1. 控制台出现 `[model-seat] client half applied — build …`；
  2. 触发栏两个按钮出现，原装座位消失；
  3. 真实数据（7+ 供应商、长模型列表）悬停不闪，录屏/采样 0 次跳变；
  4. 选模型后 `/model` 显示一致；子代理会话里座位隐藏；
  5. 关掉再开、切会话、重挂输入框，座位都在。
- **回滚**：从 `dsh.profile.bundles` 删掉该包 → 重启（原装座位立即回来，因为槽位 0 还在）；再 `dsh plugin --profile desktop remove dsh-client-ui-model-seat`。

---

## 6. 风险、回滚与兼容

### 6.1 风险表

| 风险 | 概率 | 影响 | 缓解 |
|---|---|---|---|
| 未来有插件注册 `-3` 抢座位 | 低 | 合并版静默消失 | 看门狗找不到自己的触发器时 `console.warn` 一次；README 写明优先级契约 |
| 冻结高度与真实内容不符（字体/缩放/数据晚到） | 中 | 卡片多一条空白或早一截滚动 | 重测时机限定 + `fonts.ready` 重测 + resize 重冻结 |
| 几何写内联样式，绕过 React | 中 | 测试难断言 | `frame()` 是纯函数，单测覆盖；DOM 断言只读 inline style |
| 配色 token 漏项 | 中 | 某块不跟随配色 | `css-audit` 强制每个 `var(--c-*)` 有表项 |
| 两个按钮挤爆窄输入框 | 中 | 换行/省略 | 375px 视口验收；两级 `max-width` 与 ellipsis |
| 看门狗与 React 重挂竞争 | 低 | 座位偶发闪烁一次 | 保留 B 的退避（`min(200+200n,2000)`），只在触发器不在时重注册 |
| `head` 里那一大块 CSS 在 config 变化时整块重写 | 低 | 打开配色面板拖动时掉帧 | 重写只发生在 config 变化（低频）；必要时按 `requestAnimationFrame` 合并一次 |
| `select()` 失败不关闭（沿用 A） | 低 | 用户以为没点上 | 失败行/错误提示沿用 A 的 `busy` 态 + 保留 `t` 文案 |

### 6.2 兼容策略：已经装了原插件的用户（你标"待补充"的那条）

三档，推荐 **B 档（软兼容）**：

| 档 | 做法 | 优点 | 代价 |
|---|---|---|---|
| A 硬切 | 优先级 `-1`，README 要求先卸载原插件 | 语义最干净 | 同优先级会抛错：忘了卸载 = 座位消失（正是现在的故障） |
| **B 软兼容（推荐）** | 优先级 `-2` + 保留旧 DOM 属性 + 存储键迁移 | 装了原插件也能直接用，迁移无感 | 原插件仍在内存里跑（B 的看门狗会停，A 无看门狗），属"惰性共存" |
| C 双轨 | 额外提供一个"仅强度"或"仅模型"的配置开关 | 满足只想换一半的人 | 增加两条渲染分支与测试面，不建议首发做 |

**B 档的具体保证**：
- 原 A（`-1`）在合并版（`-2`）存在时**不会抛错**，只是不再渲染；它的 `locale` 注册与 `console.info` 无害。
- 原 B（`-1`）同理；其看门狗会因为合并版保留的 `[data-dsh-pm-trigger]` 属性判定"已渲染"而停止轮询。
- 原 B 的 `<style id="dsh-model-provider-prefix-style">` **会一直留在 head 里**（B 从不移除），所以合并版的卡片/列/行不携带 `data-dsh-pm-*` 别名、自有规则一律 `[data-model-seat] .ms-*` 提高特异性——这条必须在步骤 7 用 `getComputedStyle` 交叉验证。
- 旧 localStorage 配色/快模式一次性迁移，用户不会突然变回默认色。
- `docs/migration.md` 给出"推荐卸载顺序"：先启用合并版 → 确认座位正常 → 再移除旧插件 → 重启。

### 6.3 数据与状态

- 新键：`dsh-client-ui-model-seat:config:v1`、`:fast:v1`；旧键只读不删（回滚后旧插件仍能用）。
- 配色库/方案 JSON 结构保持不变（A 的 `configToDocument` 不动），跨版本可导入导出。

### 6.4 DOM 契约（兼容层清单）

| 节点 | 新属性 | 保留的旧属性 |
|---|---|---|
| 根 | `data-model-seat="root"` | `data-gpt-helper="root"` |
| 模型按钮 | `data-model-seat="trigger"` | `data-gpt-helper="model-effort-trigger"`、`data-dsh-pm-trigger` |
| 强度按钮 | `data-model-seat="effort-trigger"` | `data-dsh-pm-trigger`、`data-dsh-pm-effort` |
| 卡片 | `data-model-seat="menu"` | 无（**刻意不给** `data-dsh-pm-pop`，见 C21） |
| 列 | `data-model-seat-col="providers\|models\|effort"` | 无 |
| 行 | `data-model-seat-row` | 无（与 C21 同理，避免被 B 的 `[data-dsh-pm-row]` 规则命中） |

### 6.5 回滚路径（三级）

1. **只回退卡片几何**：还原 §5/§8（`frame` + 冻结 effect），其它保留 → 闪动 bug 回来，但功能全在。
2. **回退到 A 的行为**：优先级改回 `-1`、移除看门狗 → 与今天等价。
3. **整体回滚**：从 `dsh.profile.bundles` 移除 + 重启；原装控件（priority 0）立即接管，无需重装任何东西。

---

## 7. 自审记录与待确认

### 7.1 我核对了什么（防止"结论没有依据"）

| 结论 | 依据 |
|---|---|
| 同优先级注册会抛错 | 运行时 `register()` 源码（§1.3）+ A 的注释 `lib/client.js:3047-3058` |
| 负优先级能压住原装控件 | 同一段源码：`lowest renders`；A 与 B 都用 `-1` 在线上跑 |
| 闪动是几何闭环 | §4.1 的 7 组对照实验（含"注入固定高度 → 0 次"的反证） |
| A 的弹层也是内容驱动高度 | `lib/client.js:709-726` 注释与 CSS |
| A 单独不闪 | A 的 hover 只改背景色，无内容变化（`:2813-2837` 行渲染不依赖 hover） |
| B 的看门狗会被旧属性"哄住" | `seatRendered()` 只查 `[data-dsh-pm-trigger]`（B `:573-579`） |
| `dsh.client` 只支持单入口 | `parseDshClient` 只认 `platform/inject/external/immediately`，bundle 由 `exports['./client']` 决定 |
| 安装/启用机制 | `dsh plugin` = 转发 pnpm；bundle 层来自 `dsh.profile.bundles`（`dsh-app-boot/lib/index.js:495-620`） |
| B 的样式会留到卸载前 | `ensureStyle()` 把 \<style> 追加到 `document.head`（B `:65-77`），disposer 不删（`:626-634` 只清定时器/observer/注册） |
| B 的测试规模 | `grep -c '^test(' test/client.test.mjs` = 20 |

### 7.2 我改掉的初稿判断

- 初稿想保留 B 的强度列表 → 改成不迁移：滑块与列表是同一语义的两个 UI，同时存在会让"当前值到底谁说了算"变得含混（7.4 仍可改）。
- 初稿想引入 esbuild + `src/` → 改成单文件：`dsh.client` 不支持多入口，两个上游都是零构建，引入构建会让"测的字节 ≠ 发的字节"。
- 初稿想把 `gptm-` 类名全保留 → 改成脚本化改名：留着旧前缀会让后来维护者误以为还有 `gpt-helper` 依赖。
- 初稿把"固定高度"当方案 → 改成"冻结实测高度"：固定 428 在小列表场景下留空 160px。

### 7.3 仍待确认（会在实施时用实测补齐，不靠猜）

| # | 事项 | 现状 | 计划 |
|---|---|---|---|
| Q1 | 真机端到端验收 | Web GUI `http://127.0.0.1:60230` 返回 401（需要 `dsh web` 打印的带 token URL），桌面端无远程调试端口 | 步骤 8 用桌面端窗口 + 控制台日志验收；或你给一次带 token 的 URL |
| Q2 | `dsh plugin add link:` 是否被 pnpm 接受 | pnpm 文档支持 `link:` 协议，本机 pnpm 11.22.0 | 步骤 8 实测；失败则退回 `file:` 或直接拷目录 |
| Q3 | 配色面板快捷键是否撞宿主 | 已抽查 shipped 包无 `Ctrl+Shift+Alt+G` 字面量 | 步骤 5 在快捷键面板确认 |
| Q4 | 合并版在 `dsh 0.2.2+` 是否仍匹配 | `engines.dsh` 取下限 `>=0.2.1-rc.2` | 与上游同步策略见 README |

### 7.4 需要你拍板（每个都有推荐值，不答按推荐执行）

| # | 问题 | 推荐 |
|---|---|---|
| D1 | 是否兼容已装原插件的用户？ | **兼容**（优先级 `-2` + 旧属性 + 存储迁移），见 6.2 |
| D2 | 触发栏用两个按钮（B 形态）还是 A 的单按钮？ | **两个按钮**（等级移到第二个按钮） |
| D3 | 搜索语义：空查询两列 / 有查询跨供应商？ | **是**（两边的原有预期都保住） |
| D4 | 是否保留 B 的强度列表（滑块旁的档位快捷条）？ | **不保留**（同一语义一个入口） |
| D5 | 是否保留 A 的 `data-gpt-helper` 旧属性？ | **保留一段时间**（第三方 CSS 兼容，成本为零） |
| D6 | 发布形态：npm 包 / `github:` / 本地 `link:`？ | **先本地 `link:` 验证，稳定后打 npm 包** |
| D7 | 闪动修复的降级选项：真机上仍有轻微跳动时，是否接受"固定高度"作为兜底开关？ | **接受**，做成 `freeze: 'measured' \| 'fixed'` 常量（默认 measured） |

### 7.5 交付物清单（"开始"之后我会产出）

- `lib/client.js`（合并 bundle）、`lib/index.js`、`package.json`、`cordis.patch.yml`
- `test/*.test.mjs`（≥24 例）、`scripts/{validate-plugin,loadcheck,css-audit}.mjs`
- `tools/flicker/`（闪动回归，含本次 7 组基线数据）
- `docs/migration.md`、`README.md`
- 一份实施日志：每步的实际命令、实际输出、与本文档的偏差

## 8. 验收方式（你读完后怎么判断可行）

1. 第 3 节的 22 条冲突项是否覆盖了你遇到的现象（尤其 C1 注册冲突、C4 选择交互、C10 定位测量、C21 外来样式表泄漏）。
2. 第 4 节的成因链是否与你看到的"放大缩小反复闪动"对得上（哪一步不符合，我按你的描述再复现）。
3. 第 5 节的 8 步是否每步都有可执行的验证命令（有一步说不清，就是方案缺陷）。
4. 第 7.4 的 7 个选项是否接受推荐值。
5. 以上都 OK，回"开始"，我按 5.1 → 5.8 顺序实施，并在每步结束时贴实测输出。
