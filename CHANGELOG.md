# CHANGELOG

版本号跟 `package.json` 的 `version` 走；每条只写用户能感知的行为变化和会咬人的坑，实现细节在 [`MAINTENANCE.md`](https://github.com/HimA6652/dsh-client-ui-model-seat/blob/main/MAINTENANCE.md)。

## [Unreleased]

### Fixed

- **e2e 的断言按中文写，夹具的语言却跟着浏览器走**，于是 CI（en-US 的 Edge）把控件渲染成英文，「回到开启前的思考强度」这类标签断言全红，本机 zh-CN 永远绿 —— 与上一条 reduced-motion 是同一类错误：环境输入没钉死。现在夹具认 URL 上的 `?lang=zh|en`（`browser-check` 固定跑 `lang=zh` 并把 `window.__lang` 断言成 `zh`，Edge 启动参数也补了 `--lang=zh-CN`），报告里多一个 `lang` 字段。注意 `Emulation.setLocaleOverride` 解决不了这个问题：实测它只改 `Intl`，`navigator.language` 仍是 `en-US`。

## [0.2.1] - 2026-10-29

### Added

- **思考面板头部的闪电按钮**（`data-model-seat="effort-bolt"`）—— 语义与 0.2.0 删掉的那个不同：点一下跳到**最高**思考档位，再点一下回到**按下去之前的那一档**。记忆按 effort id 存（不是下标：模型换了、档位表变了也能对上），任何别的途径改了档位（滑块、方向键、复位、换模型）都会立刻清掉这份记忆，所以永远不会"回到一个已经不存在的位置"。按下时图标由描边变实心、`title` 换成回退语义，两次点击各提交一次选择。只在档位数 > 1 时出现，重置按钮加了 `data-model-seat="effort-reset"`。
- `npm run docs`（`scripts/doc-anchor-check.mjs`）也挂进了 `npm run check`（0.2.0 已加，这里只是把它列进 0.2.1 的验收集）。
- `browser-check` 第 5 段扩成闪电循环（跳顶、回退、按 effort id 复原、两次点击的高度都不变、手动改档清记忆）、新增 6b 段（模型列八行下限、240 ms 零高度变化）、7b 段（重载后灯仍亮）、7c 段（换 origin 重启：第二个端口、`localStorage` 读回必须为 `null`）、7d 段（新会话交接：第三个端口 + `?session=session-9`）。

### Fixed

- **思考面板底部多出一条空白**：卡片高度原先只有一条 `CARD_MIN_HEIGHT = 132` 的下限，而面板的自然高度只有 101，多出的 31px 全落在滑轨下方（flex 列自上而下排）。现在按布局分别取自然高度（双列 333 / 面板 101），上下各留 12px；e2e 断言「顶底内缩相等」，浅深两套实测都是 13/13，卡片高度 101。
- **供应商只有两三个模型时卡片被压得很矮**：双列布局新增八行下限 `MODELS_MIN_ROWS = 8`（8 × 32px + 卡内其余 76.5px → 333px），多出来的模型由模型列自己滚动。实测 `scrollHeight/clientHeight = 256/256`、240 ms 内高度变化 0 次。
- **e2e 在「系统开了减少动效」的机器上误判**。`prefers-reduced-motion: reduce` 会把 `.gptm-particle` 的 `animation-name` 算成 `none`，于是「粒子以满强度漂移」这条断言在健康的 bundle 上失败 —— CI 首跑（run `40673400351`）就是这么红的，而本机是 `no-preference`，所以本地永远绿。现在 `browser-check` 与 `live-check` 都显式把 `prefers-reduced-motion` 钉成 `no-preference`，并新增反向断言：切到 `reduce` 时漂移停、粒子停在 `0.35`、卡片入场动画也停，切回来立刻恢复。

- **闪电的「回到哪一档」在重启后丢失**：`localStorage` 按 host **和端口** 分桶，而 dsh 每次启动都换端口（实测 3091 → 3092，同一浏览器 5511 → 5512 读回 `null` 而同 host 的 cookie 仍在），所以真重启之后那份记忆读不到 —— 灯还亮是宿主把档位写进了会话 sidecar（`storages/session_projcache/sessions/session-<id>.json` 的 `modelSelection.val.pending.reasoningEffort`），但按钮会退化成「回到默认思考强度」。现在记忆同时写一份 cookie `dsh-model-seat-bolt`（host 作用域、`path=/`、一年、`SameSite=Lax`；最多 8 个会话 / 3500 字节，超了裁最旧的），`readBoltMemory` 先读 `localStorage`、空了再读 cookie；刻意不做「挂载时把档位拉回最高」的补偿，那会覆盖用户在原生 UI 里手动改的档。`browser-check` 新增 7c 段：第二个 HTTP 服务器占另一个端口，导航过去后先断言 origin 变了、`localStorage` 读回 `null`，再断言灯仍亮、`title` 仍是回退语义、按一下回到 medium 且提交次数为 0（读回而非重写）。
- **重启后的新会话会把闪电的「回到哪一档」忘掉**：宿主每次启动都新开一个会话（实测 boot1 `session-e3f3e1b1` → boot2 `session-44268fb2`），记忆按会话分桶，新会话里查不到上一会话的记录 —— 灯因为「已经处于顶档」还亮着，回退档位却退化成「回到默认思考强度」。现在 `writeBoltMemory` 同时写一个保留桶 `last`，`boltMemoryFor` 先查本会话、查不到且已经处于顶档才借 `last`（同 provider/model 才认），裁剪时 `last` 永不淘汰。`browser-check` 新增 7d 段：导航到第三个端口、`?session=session-9` 的新会话，`localStorage` 仍为空，灯与回退档位由 `last` 给出，提交次数为 0（读回而非重写）。
- **闪电看着像「默认开着」**：顶档时按钮是亮的，但用户从没按过。旧实现把「已经在最高档」也算作开启态（`boltOn = hasBolt && (boltBack !== null || atTop)`），而宿主恢复的档位本来就可能就是 Max —— 真机实测（克隆 desktop profile 起一份独立副本）`dsh-client-ui-model-seat:bolt:v1` 与 cookie `dsh-model-seat-bolt` **都是空的**、`keys: []`，`aria-pressed` 依然是 `true`，也就是说灯亮与记忆无关，纯粹是档位在顶。现在开启态只来自「有地方可回」：`boltOn = hasBolt && boltBack !== null`；顶档且没记忆时按钮保持深色（描边）、`title` 换成「已经在最高思考强度」并 `disabled`，按下不发明记忆；任何关灯路径（按下回退 / 滑块或方向键改档 / 换模型 / 复位）都带 `dropLast` 把跨会话镜像 `last` 一起退役，否则旧按压会在日后某次启动把灯重新点亮。`browser-check` 7b 段改成 5 条：顶档深色、顶档文案、顶档 `disabled`、按下它什么都不变、退回一档按钮又可用。

### Changed

- `npm test` 从 35 条变 41 条（`test/bolt.test.mjs` 6 → 12，新增 `boltMemoryFor` 的交接六条），`validate` 98 → **103** 项（跨会话交接三件套：`bolt outlives its conversation` / `the hand-over only speaks at the top` / `the hand-over is never aged out`；随后「在顶档不算按下」三件套：`the bolt only lights from a memory` / `the bolt is inert at the top` / `turning the bolt off retires the hand-over`）。
- `validate` 从 82 项变 91 项：`no bolt or lock drawing` 拆成 `no lock drawing` + `bolt drawing present`，另加 `bolt remembers its level` / `bolt restores by effort id` / `bolt jumps to the top level` / `bolt needs two levels` / `per-layout frame floor` / `eight-row model floor`；`SEAT_VALUES` 补 `effort-bolt` / `effort-reset`。
- `live-check` 在真机上只**读**闪电（`aria-pressed`、图标填充/描边、对比度、顶底内缩），不点它：真机点一下会把 reasoning effort 发布到账号目录。
- CI 的两个 e2e 步骤在失败时把报告里失败的那几行 `::error::` 成 check-run annotation（公开仓库的 job 日志要登录才能下载，annotations 免登录可读），artifact 另外收 `e2e-*.log`。
- `MAINTENANCE.md` 按新代码重基线：`client.js` 从 3217 行长到 3601 行（闪电持久化 + cookie 镜像 + 跨会话交接 + 「默认关闭」语义各一次），108 个符号与 29 个区间重定位，段表（补 `BOLT_PATH` / `Bolt` 与 5 个几何常量）、`ModelSeat` 内部 9 块表、§5.1 的下限公式、§9.4 的闪电语义、§11 的各项计数全部对齐；`frame.test.mjs` 的旧断言（短内容 → 132）换成「短内容被本布局下限抬起」（列 333 / 面板 96）。

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
