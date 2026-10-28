# CHANGELOG

版本号跟 `package.json` 的 `version` 走；每条只写用户能感知的行为变化和会咬人的坑，实现细节在 [`MAINTENANCE.md`](https://github.com/HimA6652/dsh-client-ui-model-seat/blob/main/MAINTENANCE.md)。

## [Unreleased]

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
