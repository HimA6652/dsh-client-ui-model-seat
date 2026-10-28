# CHANGELOG

版本号跟 `package.json` 的 `version` 走；每条只写用户能感知的行为变化和会咬人的坑，实现细节在 [`MAINTENANCE.md`](https://github.com/HimA6652/dsh-client-ui-model-seat/blob/main/MAINTENANCE.md)。

## [Unreleased]

## [0.2.0] - 2026-10-28

**破坏性变更**：快速模式的开关与 `600 ms` 长按锁整套删除，粒子滑轨的漂移改为**常开**。界面与 0.1.2 相比少了一个闪电按钮与面板头部的一个开关，卡片几何、存储键、DOM 钩子都没变，不需要重装或迁移。

### Added

- `npm run docs`（`scripts/doc-anchor-check.mjs`）：校验 `MAINTENANCE.md` 里每个「符号（行号）」锚点与区间是否还落在 `client.js` 内，并顺带核对文首自称的行数与 `BUILD` 版本；已挂进 `npm run check`。
- `README.zh.md`：与英文版等价的中文说明，两份顶部互加语言开关；已加入 `files`（制品 13 个文件）。
- `.github/workflows/ci.yml`：推到 `main` / 每个 PR / 手动触发时跑 `npm run check` 与真 Edge 的 `npm run e2e`，截图作为 artifact 留存 14 天。
- `scripts/shots.mjs --scheme light|dark`：截图脚本可显式指定配色方案。
- `npm run e2e:dark`：`browser-check` 新增 `--scheme light|dark`（默认 light），报告多出 `scheme` 与 `pane` 两段；CI 浅深各跑一遍，截图仍只留浅色那一轮。
- 夹具 `test/harness/index.html` 补齐宿主 alias token：`--dsw-*` 18 个，浅深各一套（此前一个都没定义，页面底色写死，浅色主题的问题在夹具里根本测不出来）。

### Changed

- `npm run check` 从 6 道闸变 7 道（新增 `docs`）。
- `css-audit` 计数一路变化，按发生顺序记：190 / 202（0.1.2 基线）→ 191 / 203（斜杠去掉颜色，不带颜色的规则不再生成浅深两份副本）→ 200 / 212（`--c-menu-*` 补 light 值，卡面上 10 条规则各多一份 dark 副本）→ **173 / 183**（本轮删掉闪电开关与长按锁：含 `--c-*` 的整条规则删 −1，两侧同色的 token 删 −2）。`validate` 从 80 项变 **82** 项。
- `browser-check` 第 5 段：原本验长按锁的两段换成验复位按钮，新增「面板里没有闪电控件」「轨道常亮」「42 个粒子在跑且 `--spin=1`」「旧 `…:fast:v1` 没人写」四条断言；`validate` 新增 `no fast-mode store` / `no fast-mode switch` / `no bolt or lock drawing`。
- 三张 README 截图重出：列宽从 340 到 416 的改动对上，配色跟随深色方案。
- 触发器读作 `供应商/模型名` 一串字：三段（provider / 斜杠 / 模型）包进同一个 flex item，按钮的 `gap: 4px` 只留在标签与箭头之间，斜杠两侧间距为 0；斜杠去掉负边距与灰色 caret token，颜色继承文字色（副作用：`css-audit` 从 193 规则 / 205 选择器变成 191 / 203——不带颜色的规则不再生成浅深两份覆盖副本）。e2e 增加了「整段文本无空格」与「斜杠与 provider 间距 ≤1.5px」两条断言。

### Fixed

- 从模型两列切到思考面板后卡片高度被上一布局的冻结高度夹住：`carry` 现在只在同一个 `frameKey` 内生效（锚点相同、布局或状态变了就重新量），`measure()` 也先按本布局宽度写 `card.style.width` 再量。实测思考面板 300×132（此前被夹在 416×420 里）。
- 浅色主题下思考面板的闪电、刷新图标与模型名和卡片同色：`--c-menu-*` 一组的 light 值原本与 dark 相同（白色），而面板底色取自宿主的 `--dsw-alias-bg-layer-1`，浅色主题下就是白卡。现在两侧各自给值；e2e 新增对比度断言（light 复位图标 10.09 / 模型行 15.34，dark 16.53 / 13.71 —— 闪电那一对随开关一起消失）。
- `scripts/shots.mjs --out <新目录>` 报 ENOENT：`mkdirSync(OUT)` 原本排在截图之后，现在提前到第一次写入之前。
- 截图里的触发器看着发灰：headless 浏览器默认浅色方案，而插件的 token 定义在 `prefers-color-scheme: dark` 下，于是暗底上画了浅色 token。截图脚本现在先 `Emulation.setEmulatedMedia` 再导航，并把页面底色对齐卡片背景。

### Removed

- 快速模式的**整套开关**：触发器上的闪电、思考面板头部的开关按钮、`Bolt` / `LockMark` / `LockIcon` 三个绘制函数、`600 ms` 长按锁、`…:fast:v1` 持久化与它的两条重读监听、`tremble` 怠速态、`data-fast` / `data-locked` / `data-tremble` 三种状态属性、`fast.label` / `fast.locked` 词条，以及只给它们用的 5 个 token。粒子滑轨的漂移改为**常开**（`.gptm-trail` 基础 `opacity: 1`，`--spin: 1`），思考面板头部从「状态 + 开关 + 复位」收成「状态 + 复位」。旧键既不读也不写，回滚到 0.1.3 时锁定状态还在。
- 0.1.3 删掉的那条提示行「长按闪电锁定／解锁快速模式」的两个 `title` 出口（快速开关按钮、状态按钮锁定态）随之消失。

### Upgrade

- 装了 0.1.2 的不用重装：配色仍存在 `dsh-client-ui-model-seat:config:v1`；`0.1.3` 从未发布，所以没有「升级到 0.1.3 再升级」这一步。
- 旧的 `…:fast:v1` 既不读也不写：回滚到 0.1.2 时锁定状态还在，不需要手动清理。
- 本机用 `link:` 装的：**完全退出 DeepSeek 再启动**才会加载新 bundle（插件在 profile 启动时挂载，热重载不管用）。

## [0.1.2] - 2026-10-28

界面与 0.1.1 一致，这一版把发布通道和文档补齐，npm 通道从这一版开通。

### Added

- `npm run check:secret` / `npm run check:pack`：发布前扫凭据形状与本机路径，并拿 `npm pack` 的真实产物跟 `files` 四向对账（目录项、`.bak` / `.log`、声明了却没打进去的文件都会被拦下）。
- `scripts/release.mjs`：查版本说明 → 工作区干净 → 在 main → 本地与远端标签都不存在，四道闸过后才发；tag 推送后由 Release workflow 建 GitHub Release，正文取自本文件。
- `CHANGELOG.md`（本文件）。

### Changed

- 制品清单从目录改成逐文件枚举：0.1.1 的 `files` 写的是 `assets`，任何临时截图、`.bak` 都会跟着包走；现在只发 `files` 里的 11 条确定路径（加上 `package.json` 一共 12 个文件）。
- 文档里的本机绝对路径全部换成 `/path/to/...` 占位；README 的维护文档、更新日志链接改为绝对地址（在 npm 页面上原本是死链）。
- README 增加「适用场景」与「已知限制」两节，并写明当前只有 GitHub 安装通道。

### Upgrade

- 装了 0.1.1 的不用重装，界面与存储键都没变（颜色仍在 `dsh-client-ui-model-seat:config:v1`）。
- 这一版起可以直接用 npm 通道：`dsh plugin --profile <profile> add dsh-client-ui-model-seat`；GitHub 通道照旧。

## [0.1.1] - 2026-10-28

首个公开版本：把两个只能二选一的 composer 模型控件合成一个。

### Added

- 合并后的模型控件：Provider / 模型触发按钮 + 两列卡片，占用 `conversation.input.model` 席位并以 `priority: -2` 注册，因此原插件（`-1`）或内置控件（`0`）留在 profile 里也不会撞车。
- 思考强度触发按钮与粒子滑块；`600 ms` 长按闪电锁定 fast 模式，锁定状态跨刷新保留。
- 跨供应商搜索：输入时把所有供应商的同名模型列在一起，卡片尺寸不变。
- 外观面板（`Ctrl+Shift+Alt+G`）：双主题色板、方案库、JSON 导入导出、跨主题套用。

### Changed

- 卡片高度改为测量一次后冻结，供应商列悬停只换右侧内容、不改外框尺寸。
- 不再输出 `data-gpt-helper` / `data-dsh-pm-*` 钩子；卡片改用 `.ms-*` 与 `data-model-seat`。

### Fixed

- 某个供应商模型过多时选择窗口反复放大缩小：卡片贴底、按内容自适应高度、又按悬停换列，构成布局与指针的回环（旧实现实测 900 ms 内 27 次高度翻转）。现在几何只由锚点与布局决定，两列各自滚动。

### Upgrade

- 从原插件迁过来：先 `dsh plugin remove dsh-client-ui-gpt-helper` 与 `dsh plugin remove dsh-model-provider-prefix`，再装本插件；两个原插件与本插件不要同时启用。
- 颜色配置不继承旧键（不读 `dsh-client-ui-gpt-helper:config:v1`），首次启动是默认配色，之后存到 `dsh-client-ui-model-seat:config:v1`。
