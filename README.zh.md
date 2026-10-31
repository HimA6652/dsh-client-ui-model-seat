# dsh-client-ui-model-seat

[English](README.md) · **中文**

dsh 输入区的「模型 + 思考强度」控件。它由两个插件合并而来 —— 两者都替换同一个座位，
装在一起必然打架：

- **dsh-client-ui-gpt-helper** —— 外壳：token 驱动的配色、粒子思考滑块、外观面板、
  i18n 词典，以及按会话接线的那一层。
- **dsh-model-provider-prefix** —— 卡片骨架：provider 列与 model 列并排，悬停决定右列
  显示哪个 provider，加载失败的 provider 变成一条重试行。

![卡片：左侧 provider，右侧是悬停 provider 的模型](https://raw.githubusercontent.com/HimA6652/dsh-client-ui-model-seat/main/assets/screenshot-1.png)
![搜索一次跨全部 provider，卡片尺寸不变](https://raw.githubusercontent.com/HimA6652/dsh-client-ui-model-seat/main/assets/screenshot-2.png)
![思考面板：粒子滑块与复位按钮](https://raw.githubusercontent.com/HimA6652/dsh-client-ui-model-seat/main/assets/screenshot-3.png)

用它**取代**任何一个原插件，而不是与它们并存：

    dsh plugin remove dsh-client-ui-gpt-helper
    dsh plugin remove dsh-model-provider-prefix

维护这个仓库：代码地图、让卡片保持稳定的那几条不变量、测试矩阵、真机验证配方都在
[MAINTENANCE.md](https://github.com/HimA6652/dsh-client-ui-model-seat/blob/main/MAINTENANCE.md)。
每个版本的改动见 [CHANGELOG.md](https://github.com/HimA6652/dsh-client-ui-model-seat/blob/main/CHANGELOG.md)。

适用场景 / Who it is for:

| 你是…… | 这个插件给你 |
| --- | --- |
| 需要在模型旁边看见 provider 的人 | 一个触发器显示 `provider/model`，一张卡片带两列。 |
| provider 列表很长的人 | 悬停左列即可；右列换内容，卡片不动。 |
| 会调思考强度的人 | 独立的强度触发器 + 粒子滑块；轨道动效常开。 |
| 同时装着两个原插件的人 | 一个座位，而不是两个装不到一起的。 |

依赖 dsh `>= 0.2.1-rc.2`（`engines.dsh`）。纯客户端：不发起网络请求、不读凭证、
没有宿主模块。

## 它做什么

| 界面 | 行为 |
| --- | --- |
| 模型触发器 | `provider/model` 一串字（斜杠两侧无间距），加一个箭头。点开是 provider + 模型双列卡片；再点一次关闭。若同一行里已经有别人在报 provider —— dsh-providers-hub 的 JetHub 徽标就挂在座位旁边的 `conversation.input.right` 槽里 —— 触发器收起自己的前缀、只显示模型名，供应商只出现一次。 |
| 强度触发器 | 当前思考档位（`Max`、`Medium`……）。点开是粒子滑块；只有当前模型声明了思考档位时才渲染。 |
| provider 列 | 会话目录里的全部 provider 与各自模型数，当前 provider 打勾，加载失败的变成重试行。 |
| 模型列 | 列头显示指针所在 provider；列内有一个 30 px 搜索框。悬停左列只换右列，**卡片本身不动**。 |
| 搜索 | 输入时**跨全部 provider** 搜索，并在每行标出所属 provider。打字过程中卡片保持双列形状 —— 会变形的卡片正是这个插件要消掉的尺寸闪动。 |
| 思考滑块 | 沿用外壳的粒子滑块，跑在当前模型的档位阶梯上，支持方向键 / Home / End。 |
| 思考面板头部 | 左边是当前档位（点它回到双列卡片），中间那个闪电一下跳到最高思考强度、再按回到开启前那一档，右边是复位按钮 —— 恢复当前模型的默认档位。 |
| 外观面板 | `Ctrl+Shift+Alt+G`。明暗两侧各自的颜色 token、配色库、JSON 导入导出、重置、把一侧套到另一侧、实时预览。 |

几何：双列布局卡片宽 `416 px`，思考面板宽 `300 px`，都夹在视口内；两种布局各留自己的
下限 —— 双列是 8 个模型行即 `333 px`，思考面板 `96 px`，卡片不会矮过自身内容，
上限都是 `420 px`，上方空间更宽裕时卡片翻到触发器之上。

## 这次合并必须解决的闪动

上游那张卡片以**下边缘**为锚点、按**内容**定高度，而内容又由**指针下的那一行**决定。
当一个 provider 的模型多到卡片装不下时，这三件事闭成一个环：

1. 卡片撑高到装下模型列表，上边缘因此上移；
2. 指针本来在某个 provider 行上，行被推走了 —— 指针现在落在别的行上（或卡片外面），
   于是右列换内容或清空；
3. 卡片缩回去，指针又回到原来那行，环重新开始 —— 在旧包上实测 **900 ms 内高度翻转 27 次**。

合并后的卡片把「框」变成只依赖锚点与布局的函数，环就断了：

- `frame(anchor, layout, natural, floor)` 是纯函数：把宽高夹进视口，上方更宽裕时翻到触发器之上。
- 自然高度在卡片还隐藏时（`data-ready="false"`）按 (布局, 状态, 档位数) **只测一次**，之后在这个
  键不变期间冻结。
- 两列各自内部滚动（`scrollbar-gutter: stable`），所以再长的模型列表也不改变卡片外高。
- `box-sizing: border-box` 让内联高度等于测到的高度。
- `floor` 是卡片当前已有的高度：同一次摆放里后来的重新测量只能把卡片撑大，不会缩到指针底下。
  换锚点（尺寸变化、滚动）时 floor 归零重来。
- 搜索词不改变布局，所以打字永远不会改变卡片尺寸。

重新测量只发生在：打开、切换面板、锚点移动（滚动/改窗）、状态变化 —— 悬停时从不测量。

## 配置

所有面向用户的设置都在外观面板里改，没有 profile 配置键。状态存在一条 `localStorage` 记录里：

| Key | 形状 |
| --- | --- |
| `dsh-client-ui-model-seat:config:v1` | `{ version: 3, hotkey, paused, crossApply, slots: { light: { scheme }, dark: { scheme } }, schemes: { name: { name, colors } }, sides: { light, dark } }` |

`paused: true` 会关掉全部自定义颜色（面板总开关）；`slots[side].scheme` 指定某一侧启用的配色，
`sides[side]` 存这一侧逐个 token 的微调（优先级高于配色本身，所以手改的值不会被悄悄吞掉），
`crossApply` 让一侧的颜色套到两侧。
外壳插件写下的记录（`dsh-client-ui-gpt-helper:config:v1`）**不读**：schema 已经变了，
一次半截静默迁移比回到默认值更糟。这条记录在加载时、`storage` 事件时、窗口重新获得焦点时读取。
`dsh-client-ui-model-seat:fast:v1` 不再读也不再写：轨道动效常开，旧键原样留着 —— 回滚到 0.1.2 时它的锁定状态还在。

## DOM 契约

给 CSS 和测试用的稳定钩子：

| 元素 | 属性 |
| --- | --- |
| 根 | `[data-model-seat="root"]`，另有 `data-build` |
| 触发器 | `[data-model-seat="model-trigger"]`、`[data-model-seat="effort-trigger"]` |
| 卡片 | `[data-model-seat="menu"]`，带 `data-pane`、`data-layout`、`data-ready`、`data-flipped`、`data-ultra` |
| 两列 | `.ms-col[data-col="providers"]`、`.ms-col[data-col="models"]` |
| 列头 | `.ms-colHead`，分隔线 `.ms-sep` |
| 搜索 | `.ms-search`（在模型列内） |
| 行 | `.ms-row[data-kind="provider"\|model\|retry"]`，`data-active`、`data-current`，计数 `.ms-count`，注记 `.ms-rowNote` |
| 滑块 | `[data-model-seat="thinking-slider"]` |
| 颜色面板 | `[data-model-seat="config-panel"]`，背景 `[data-model-seat="config-backdrop"]` |
| 兜底 | `[data-model-seat="fallback"]` —— 错误边界渲染的内容 |

这就是全部契约：自 0.1.1 起不再输出 `data-gpt-helper` 或 `data-dsh-pm-*`。针对任一上游插件
写的 CSS 不再匹配，这正是目的 —— 外壳插件留下的 `[data-gpt-helper]` 规则本来会把这张卡片
重新涂一遍。`npm run validate` 会在这两个前缀回来时失败。

## 安装

    dsh plugin add dsh-client-ui-model-seat@0.2.2                        # 从 registry（写死版本，见下）
    dsh plugin add dsh-client-ui-model-seat                              # 从 registry（裸包名）
    dsh plugin add github:HimA6652/dsh-client-ui-model-seat              # 从源码
    dsh plugin add link:/absolute/path/to/dsh-client-ui-model-seat       # 本地检出

两个通道发布的是同一份文件树。npm 页面是
[npmjs.com/package/dsh-client-ui-model-seat](https://www.npmjs.com/package/dsh-client-ui-model-seat)，
首次发布是 `0.1.2`，当前版本是 `0.2.2`。

> **裸包名会装到旧版本**：pnpm 11 默认有 `minimumReleaseAge`（1440 分钟）的供应链闸门，裸包名会解析成**「满 24 小时的最新版」**而不是 `latest`——实测 2026-10-29 发完 `0.2.1` 之后 `pnpm add dsh-client-ui-model-seat` 装到的是 `0.1.2`。这不是一次性事故而是机制：`0.2.2` 发出去的当天，满一天的最新版仍然是 `0.2.1`，裸包名就解析到 `0.2.1`。要立刻装到最新，把版本写死（`@0.2.2`，pnpm 会把它记进 profile 的 `minimumReleaseAgeExclude`）；或者等一天再装。

插件的 bundle 只往 profile 里插一行（`id: model-seat`），并以 `priority: -2` 注册它的座位，
所以残留的任一原插件（`-1`）或内置控件（`0`）会被遮蔽，而不是撞在一起。

`desktop` profile 不能用普通 CLI 改 —— 它会回答
`profile "desktop" is managed exclusively by the Electron application`。改用 desktop host CLI
（见 MAINTENANCE.md 的「安装、升级、回滚」）。

截图是生成的不是手裁的：`npm run shots` 把真实 bundle 渲染在 harness 上、喂一套演示 provider，
然后按 2x 裁出 PNG。

## 在真实 dsh 上验证

`npm run e2e` 跑的是夹具页面。要在真实 dsh web 应用里验同一份 bundle 又不动自己的数据，
给它一个一次性的 `DSH_HOME`：

    SEAT_HOME=C:/Users/you/AppData/Local/Temp/seat-live-home
    mkdir -p "$SEAT_HOME" && cp ~/.dsh/.credentials.yaml "$SEAT_HOME/"
    export DSH_HOME=$SEAT_HOME
    DSH=<checkout>/node_modules/@deepseek-ai/dsh/lib/bin.js
    node "$DSH" --profile seatcheck --from-default-profile web --help   # 用 web 模板建 seatcheck
    node "$DSH" plugin --profile seatcheck add link:$PWD
    node "$DSH" --profile seatcheck --port 6124 --host 127.0.0.1 --no-open

那份凭证副本是让账号的模型目录能解析出来的东西；没有它卡片是空的。启动横幅会打印带
`?token=` 的地址，把它交给

    npm run live -- --url "http://127.0.0.1:6124/?token=..."

`--publish` 还会点一行模型并断言触发器重新贴标签。它会写账号里的模型选择，所以默认关闭、
也所以这一跑必须放在一次性 `DSH_HOME` 上。检查会报告触发器标签、卡片布局/高/宽、900 ms 的
帧采样、思考面板，以及任何提到这个座位的 console 错误；有问题时以非零退出。你自己的
`~/.dsh` 与桌面应用全程不参与。

## 开发

    npm run check       # 密钥 + 制品 + 清单 + 文档锚点 + CSS 审计 + 加载检查 + 单元测试
    npm run check:secret # 全部文本文件里的开发机路径、token、私钥
    npm run check:pack   # `files` 与真实 npm 制品双向核对
    npm run validate     # 清单、patch 行、入口模块、bundle 加载、apply
    npm run docs         # MAINTENANCE.md 的行号锚点与区间是否还对得上 client.js
    npm run css          # 样式作用域与死类审计
    npm run loadcheck    # 对着已安装的 dsh 检出跑（没有就跳过）
    npm test             # node:test 单元与集成测试
    npm run e2e          # 在 headless Edge 里经 CDP 驱动真实 bundle（浅色方案）
    npm run e2e:dark     # 同一套断言，prefers-color-scheme: dark
    npm run check:all    # check + e2e + e2e:dark
    npm run live -- --url URL   # 同样的检查，跑在真实 dsh 里
    npm run release 0.2.2       # 门禁 → npm → 提交 → 打标签 → 推送（见 CHANGELOG 规则）

`npm run e2e` 把 `test/harness/` 挂在一个回环端口上，用 headless Edge 经 CDP 打开，分十四节断言：
双列卡片、指针停在 60 个模型上时高度不变、关掉再打开的确定性、跨 provider 查询、空查询提示
（一个带内边距的 `.ms-empty`、零行）、思考面板（闪电按钮、动效常开、自有高度、顶底内缩相等、图标与文字的对比度）、
减少动效分支、列头状态按钮回到双列、模型列八行下限、颜色面板热键、重载后闪电仍亮、换 origin 重启与新会话交接、
同一行里有渠道徽标时前缀退让、以及干净的 console。`--shot DIR` 会写出截图；
`--dump` 打印卡片盒模型与子元素。e2e 的 React 来自仓库里提交的 `test/vendor/` UMD 构建，
所以新克隆无需外部目录、无需网络；`--vendor DIR` / `REACT_VENDOR=DIR` 可以覆盖。

`lib/client.js` 是**手写**的 —— 3671 行单文件 bundle，没有构建步骤，因为 `dsh.client` 只接受一个
`./client` 入口。`tools/merge/gen-client.mjs` 当初从外壳 bundle 生成了第一稿，如今只作存档：
不带 `--force` 它会拒绝运行，即便带了也会先把当前文件备份成 `lib/client.js.bak-gen-<timestamp>`。

## 已知限制

- **一个座位，一个主人。** 插件以 `priority: -2` 注册 `conversation.input.model`。若有别的插件
  以同一优先级注册同一槽位，胜负由挂载顺序决定，不由本插件决定。
- **没有列间键盘导航。** 方向键在获得焦点的列内移动（滑块、搜索框、行），Tab 离开卡片。
  换 provider 靠悬停与点击。
- **卡片不做动画。** 切换面板或 provider 在一帧内重排是设计如此 —— 会动画的高度正是这次合并
  消掉的尺寸环。改窗口大小会重新测一次夹取，所以开着的卡片会跟着视口走。
- **颜色存在 `localStorage`**（`dsh-client-ui-model-seat:config:v1`），按浏览器 profile 独立。
  它们不跟着账号跨机器走；面板的 JSON 导入导出是唯一的搬运方式。
- **搜索只覆盖模型名与 id，不覆盖 provider 名。** 输入 `ollama` 是通过模型找到 `ollama/qwen`，
  不是通过 provider 列。
- **只有 web 客户端这一面**（`dsh.client.platform: "web"`，桌面应用渲染的就是它）。终端面不受影响。
- **`lib/client.js` 是一个手写文件**，没有构建步骤；`dsh.client` 只接受一个 `./client` 入口。
  没有逐模型的覆盖层：插件改的是座位，不是模型列表。

## 许可

MIT，见 LICENSE。两个上游同样是 MIT：dsh-client-ui-gpt-helper 归 AprilCrystal，
dsh-model-provider-prefix 归 zszz3，版权行都保留在 LICENSE 里。
