# CHANGELOG

版本号跟 `package.json` 的 `version` 走；每条只写用户能感知的行为变化和会咬人的坑，实现细节在 [`MAINTENANCE.md`](https://github.com/HimA6652/dsh-client-ui-model-seat/blob/main/MAINTENANCE.md)。

## [Unreleased]

### Added

- `npm run check:pack` / `npm run check:secret`：发布前核对 npm 制品清单与本机路径、凭据形状。
- `scripts/release.mjs` 与 tag 触发的 Release workflow，Release 正文取自本文件对应小节。

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
