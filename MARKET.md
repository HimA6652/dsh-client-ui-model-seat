# 上架 dsh-market 的实施手册

> 目标：让 `dsh-client-ui-model-seat` 出现在 dsh 的「插件市场 → 发现」里，并能一键安装。
> 本文所有结论都标注了来源；推断项标注「待确认」。今天是 2026-10-28（Asia/Shanghai）。

## 0. 结论先行

市场本身**不收提交**。它只是一份精选清单的展示层：

- 你在 [awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin) 里加**一个 YAML 文件**；
- 那份清单合并后由 CI 生成 `plugins.json` 与站点；
- dshmarket 每次打开**实时**拉 `https://awesome-dsh-plugin.com/plugins.json`，并且**只允许安装清单里的来源**。

所以"推送到 dsh-market"实际是九个具体动作：整理仓库 → 建 GitHub 仓库 → 推代码 → 打 tag → （推荐）发 npm → 写 entry → 提 PR → 等评审合并 → 验证。仓库需**创建满 1 天**才能过 CI，所以今天建仓、明天提 PR 是最早路径。

## 1. 市场侧的机制（有据）

| 事实 | 出处 |
| --- | --- |
| 只允许安装精选列表内的来源，其它一律拒绝 | `dshmarket/README.zh.md:82` |
| 想让插件上架，去 awesome-dsh-plugin 提 PR（不是往市场仓库提） | `README.zh.md:118` |
| 每次打开实时请求 `awesome-dsh-plugin.com/plugins.json`，不缓存兜底 | `README.zh.md:128` |
| 列表数据在 `data/plugins/`，一个插件一个 YAML，README 由脚本生成、**不要手改** | contributing.md「Adding a plugin」 |
| CI 顺序检查：≤3 条/PR → `dsh.bundle` 是否存在 → 仓库年龄 ≥1 天 → awesome-lint + 站点构建 | contributing.md「What CI checks」 |
| 条目字段：`url` `name` `category` `description{en,zh}`，可选 `icon` `tarball` | contributing.md 示例 |
| 市场侧读到的字段还包括 `npm` `stars` `version` `downloads` `capabilities`（由 CI 抓取/扫描，不由投稿人填写） | `dshmarket/src/registry.ts` `RegistryPlugin` 注释（#348、#401） |
| 分类取值含 `ui`、`model` 等 24 个 | contributing.md「Valid `category` values」 |

清单当前规模（今晚实测）：`count: 7406`，`updated: 2026-10-27`，`plugins.json` 约 9.5 MB。

清单里的一行长这样（今晚从 `plugins.json` 直接取的真实记录，只保留有值的字段）：

```json
{"name":"dsh-client-ui-gpt-helper","owner":"AprilCrystal","url":"https://github.com/AprilCrystal/dsh-client-ui-gpt-helper","category":"ui","npm":null,"stars":2,"downloads":null,"capabilities":[],"install":"dsh plugin --profile web add github:AprilCrystal/dsh-client-ui-gpt-helper","added":"2026-10-17"}
```

三条从实读里得到的结论，直接决定我们怎么写条目：

- **`install` 由 CI 生成，不是投稿人写的。** A 的安装方式是 `github:AprilCrystal/dsh-client-ui-gpt-helper`；B 因为多了一个 `tarball` 字段，安装方式变成 `add "https://github.com/zszz3/dsh-model-provider-prefix/releases/download/v0.2.6/dsh-model-provider-prefix-0.2.6.tgz"` —— 写死版本号的资产链接会随发版腐烂，**这就是我们不写 `tarball` 的直接理由**。
- **`npm` 字段是自动探测的。** 7406 条里 3716 条有 `npm`、3690 条没有；同为 GitHub 源的 `bycall/dsh-answer-reviewer` 带着 `"npm": "dsh-answer-reviewer"`，`install` 也随之换成包名。结论：**发到 npm 后不用改条目**，下一次构建自动把安装方式换成包名并开始统计下载量。
- **`capabilities` 是 CI 静态扫描的结果**（`capabilityCheckedAt: 2026-10-27T23:34:24.928Z`），两个上游都是 `[]`。我们不联网、不碰凭据，扫描大概率同样为空——PR 里如实写就行。

两个上游**都已在册**，且都归类 `ui`：

```yaml
# data/plugins/AprilCrystal__dsh-client-ui-gpt-helper.yml
url: https://github.com/AprilCrystal/dsh-client-ui-gpt-helper
name: AprilCrystal/dsh-client-ui-gpt-helper
category: ui
```
```yaml
# data/plugins/zszz3__dsh-model-provider-prefix.yml
url: https://github.com/zszz3/dsh-model-provider-prefix
name: zszz3/dsh-model-provider-prefix
category: ui
tarball: https://github.com/zszz3/dsh-model-provider-prefix/releases/download/v0.2.6/dsh-model-provider-prefix-0.2.6.tgz
```

这直接决定投稿策略：评审规则第 4 条是「是否已被现有条目覆盖」，所以描述与 PR 正文必须把「这是两者的**合并超集**，且两者**装在一起就冲突**」讲清楚，否则会被判重复。

## 2. 现状对照（逐条实测）

| contributing.md 的要求 | 我们的现状 | 差距 |
| --- | --- | --- |
| `package.json` 声明 `dsh.bundle` | ✅ `dsh.bundle.patch = ./cordis.patch.yml`，且 `cordis.patch.yml` 用新行 id `model-seat` | 无 |
| 只声明 `dsh.client` 会失败 | ✅ 两个都有，`dsh.client.platform = web` | 无 |
| 仓库公开、真实代码 | ❌ 工作区不是 git 仓库，也没有 GitHub 仓库 | 要建 |
| 仓库创建满 1 天 | ❌ 尚未创建 | 今天建，明天提 |
| 仓库加 `dsh-plugin` topic | ❌ | 建仓后加 |
| 描述如实、不夸大 | ✅ 按实际功能起草（见 §5） | 无 |
| npm 包（推荐，免构建授权） | ❌ 三个名字在 npm 均不存在 | 可发 |
| 图标（可选，GitHub 托管位图） | ✅ 新做 `assets/icon-180.png`（180×180） | 无 |
| 截图（可选，**放在自己仓库**的 `screenshots.json`） | ✅ 三张 2x 实拍（`assets/screenshot-1..3.png`），`npm run shots` 可重生成 | 无 |
| 上游版权保留 | ✅ MIT，LICENSE 已补两行上游版权 | 无 |

**代码行为审计**（评审会看源码）：`lib/client.js` 无 `fetch`/`XMLHttpRequest`/`eval`/`new Function`，只有 4 处 `localStorage`（配色配置与快速模式锁）。投稿时如实写「无网络请求、无凭据访问」，这正是静态扫描会去看的地方。

## 3. 本机环境事实（已实测）

| 项 | 结果 | 影响 |
| --- | --- | --- |
| `gh` CLI | 未安装 | 建仓库/开 PR 走浏览器或 REST |
| `git` → `github.com:22` | 不通（~`/.ssh/config` 已把 github.com 指到 `ssh.github.com:443`） | 只能走这条 SSH 别名，已验证 `Hi HimA6652!` |
| `https://github.com` | 连不上 | 不要用 HTTPS 克隆/推送 |
| `https://api.github.com` | 走 `curl --ssl-no-revoke` 返回 200（schannel 吊销检查离线，不加参数报 `CRYPT_E_REVOCATION_OFFLINE`） | 有 token 时可用 REST |
| npm registry | 直连正常，已登录 `hima6652` | 可以直接 `npm publish` |
| npm 包名 | `dsh-client-ui-model-seat` / `dsh-model-provider-prefix` / `dsh-client-ui-gpt-helper` 全部 404 | 名字空着，先到先得 |
| 本机安装方式 | 已是 `link:E:\...\dsh-client-ui-model-seat` 进 desktop profile | 上架不改变本机行为 |

## 4. 九步实施

### 步骤 1｜仓库整理（多数已完成，可复核）

已完成：`assets/icon-180.png`、`package.json` 元数据（去掉 `private`，加 `license`/`author`/`contributors`/`repository`/`homepage`/`bugs`/`keywords`）、`LICENSE` 补上游版权、`screenshots.json` 声明三张截图（`assets/screenshot-1..3.png`，由 `npm run shots` 在真实 bundle 上渲染并裁切，2x，深色主题，供应商名为演示数据）。截图**放在自己仓库**是规则明确鼓励的做法：以后换图只推自己的仓库，市场下一轮夜间构建自动抓取，不必再开 PR。

复核：

```sh
npm pack --dry-run        # 只应打进 5 个文件 + package.json
node scripts/validate-plugin.mjs
```

### 步骤 2｜建 GitHub 仓库

浏览器（最省事）：打开 <https://github.com/new>，名字 `dsh-client-ui-model-seat`，Public，**不要**勾 README / .gitignore / license。

或带 token 的 REST：

```sh
curl --ssl-no-revoke -sS -X POST https://api.github.com/user/repos \
  -H "Authorization: Bearer $GITHUB_TOKEN" \
  -H "Accept: application/vnd.github+json" \
  -d '{"name":"dsh-client-ui-model-seat","description":"Merged composer model seat for DeepSeek Harness","private":false}'
```

验证：`git ls-remote git@github.com:HimA6652/dsh-client-ui-model-seat.git` 不再报 not found。

### 步骤 3｜首次提交并推送

```sh
cd /path/to/dsh-client-ui-model-seat
git init -b main
git config user.name  "HimA6652"
git config user.email "<你的 GitHub 邮箱>"
git add -A
git commit -m "feat: merged model seat 0.1.1 (gpt-helper + model-provider-prefix)"
git remote add origin git@github.com:HimA6652/dsh-client-ui-model-seat.git
git push -u origin main
```

验证：`git log --oneline -1`、`git ls-remote origin main` 与本地 SHA 一致。

### 步骤 4｜打 tag + 可选 Release

```sh
git tag -a v0.1.1 -m "0.1.1"
git push origin v0.1.1
```

只有**不发 npm、又不希望用户从源码安装**时才需要 Release 附 `.tgz`；插件无构建步骤，源码安装本来就干净，建议跳过以免 `latest/download/` 链接随版本失效。

### 步骤 5｜加 topic

浏览器仓库首页右上齿轮 → Topics：`dsh`、`dsh-plugin`、`deepseek-harness`、`client-plugin`。
（REST：`PUT /repos/HimA6652/dsh-client-ui-model-seat/topics`，body `{"names":[...]}`。）

### 步骤 6｜发 npm（推荐）

```sh
npm publish --access public          # 0.1.1
npm view dsh-client-ui-model-seat version dist.tarball
```

好处：安装免 `allowBuilds` 构建授权、可锁版本、GitHub 不可达的网络也能装。若账号开了 2FA，命令会要 `--otp`。

### 步骤 7｜写 entry 文件

内容已备好：[`publish/market-entry.yml`](publish/market-entry.yml)。PR 里的目标路径必须是：

```
data/plugins/HimA6652__dsh-client-ui-model-seat.yml
```

（文件名 = `<owner>__<repo>.yml`，大小写照 GitHub 原样。）

### 步骤 8｜提 PR

浏览器路线：<https://github.com/awesome-dsh-plugin/awesome-dsh-plugin> → `data/plugins` → **Add file → Create new file** → 文件名与内容如上 → *Propose new file*。GitHub 会自动 fork 并开 PR。

REST 路线（有 token 时）：

```sh
curl --ssl-no-revoke -X POST https://api.github.com/repos/awesome-dsh-plugin/awesome-dsh-plugin/forks
# 然后用 ssh 推一个分支 + POST /repos/awesome-dsh-plugin/awesome-dsh-plugin/pulls
```

PR 正文见 §6；**一个 PR 只加这一条**（上限 3 条）。

### 步骤 9｜合并后验证

```sh
curl -sS https://awesome-dsh-plugin.com/plugins.json | grep -c 'dsh-client-ui-model-seat'   # ≥1
```

然后：市场里搜 `model-seat` → 卡片出现（图标是我们的）→ 一键安装 → `dsh plugin list` 里出现 `dsh-client-ui-model-seat` → 触发器与两栏卡片正常 → 卸载两个旧插件后仍然正常。

## 5. 可直接用的 entry

```yaml
url: https://github.com/HimA6652/dsh-client-ui-model-seat
name: HimA6652/dsh-client-ui-model-seat
category: ui
icon: https://raw.githubusercontent.com/HimA6652/dsh-client-ui-model-seat/main/assets/icon-180.png
description:
  en: 'Merges the two composer model-seat plugins that cannot be installed together into one control: a Provider / Model trigger opening a two-column card where hovering the provider column swaps the models without moving the card, a separate reasoning-effort trigger with a particle slider, and a search that spans every provider while the card keeps its size.'
  zh: '把两个无法同时安装的输入框模型控件插件合并成一个控件：「供应商/模型」钮点开是两栏卡片，鼠标所指供应商的模型就地切换、卡片不移动；推理强度是旁边的独立钮，带粒子滑杆；搜索跨全部供应商，且卡片尺寸保持不变。'
```

图标与截图都不写进条目：`icon` 已在上面这一行里声明，截图走仓库根的 `screenshots.json`（`["assets/screenshot-1.png", …]`），市场夜间构建自己来取。

三个判断点：
- **分类取 `ui`。** 两个上游都在 `ui`；按 contributing.md，分类选偏了维护者会直接改，不会打回。
- **不加 `tarball`。** 插件没有构建步骤，`github:` 源码安装即可；发 npm 后更没必要，还避免 `latest/download/` 的版本腐烂。
- **描述里不写数字。** 写了「46 个工具」就得真有 46 个；我们的卖点是形态与稳定性，用可验证的行为描述。

## 6. PR 正文模板

```markdown
Adds dsh-client-ui-model-seat (ui).

Both halves already exist on the list: AprilCrystal/dsh-client-ui-gpt-helper and
zszz3/dsh-model-provider-prefix. What neither can do is run next to the other —
both replace the same composer seat, and registering twice at the same priority
throws, so a user who installs both gets one of them silently dropped. This
plugin is the merged implementation: the two-column Provider/Model card from one,
the particle thinking slider and theming from the other, one row (id: model-seat)
instead of two.

It also removes the resize loop the two-column card had when a provider held more
models than fit: the card is measured once per open and frozen, columns scroll
internally, and search spans every provider without changing the card's shape.

- MIT, both upstream copyright notices kept in LICENSE.
- No network requests, no credential access; localStorage holds the two
  preferences (color config, fast-mode lock) and nothing else.
- Install: `dsh plugin add dsh-client-ui-model-seat` (npm) or
  `dsh plugin add github:HimA6652/dsh-client-ui-model-seat`.

If you'd rather not carry three entries for one seat, marking the two upstreams
`deprecated` with `replacement: HimA6652/dsh-client-ui-model-seat` is fine by me —
that is what the catalog fields are for. Happy to leave that to your call.
```

中文补充（如果 PR 用中文写）：同一段内容把「同一个槽位重复注册会抛错」与「两栏卡片尺寸冻结」两点说清即可。

## 7. 后续发版

1. 改 `package.json` 版本 → `npm publish` → `git tag vX.Y.Z && git push --tags`；
2. entry 文件**不用改**（url 不变；`install` 会跟着 npm 探测结果自动变）；
3. `stars`、`version`、`downloads` 由清单 CI 每日刷新，市场侧自动跟上；
4. 界面变了就 `npm run shots` 重拍三张截图推到 main —— `screenshots.json` 在你自己仓库里，夜间构建自动取，不必开 PR；
5. 要改描述就编辑自己那条 `data/plugins/HimA6652__dsh-client-ui-model-seat.yml` 再开 PR，**不要手改 README**。

## 8. 风险与回滚

| 风险 | 触发条件 | 处置 |
| --- | --- | --- |
| 被判与两个上游重复 | 评审按「先到先得」看 | PR 正文已给出理由（互斥 + 合并超集 + 修了闪动）；必要时请维护者把上游标 `deprecated`/`replacement` |
| 仓库年龄不足 1 天 | 建仓当天提 PR | 明天再提；CI 会明说 |
| 描述被判夸大 | 写了做不到的事 | 现描述逐句可验，且不含数字 |
| npm 名字被抢 | 有人先注册 | 尽早 `npm publish` |
| 目标网络装不上 | GitHub 不可达 | 发 npm（首选）；或 Release 附版本无关的 `.tgz` |
| 与上游同时安装 | 用户没卸载旧插件 | 我们的 bundle 用新行 id `model-seat`，不会撞 id，但三个插件会争同一个槽位；README 已写卸载命令，可选做运行时告警 |
| 要撤回 | — | npm：72 小时内 `npm unpublish`，之后用 `npm deprecate`；清单：关 PR 或提删除 PR；本机：`dsh plugin remove dsh-client-ui-model-seat` |

## 9. 待确认

1. **GitHub 账号与仓库名**：SSH 握手返回 `Hi HimA6652!`，故按 `HimA6652/dsh-client-ui-model-seat` 起草；若想换名，改 entry 的 `url`/`name`/文件名三处。
2. **提交邮箱**：`git config user.email` 目前为空，需要你给一个（用来算提交署名与 GitHub 归属）。
3. **是否立即发 npm 0.1.1**：清单里 `npm` 是自动探测的，发了之后安装方式变成 `dsh plugin add dsh-client-ui-model-seat` 并开始累计下载量；不发也能上架（走 `github:` 源，安装时需要网络与构建授权）。名字空着，早发早占位。
4. **是否顺手请维护者 deprecated 两个上游**：合并后它们已成"装了就冲突"的旧形态，标 `replacement` 对用户最省心，但那是维护者的判断。
5. **README 语言**：现在是英文主文档 + 中文 `MAINTENANCE.md`；清单只要求 entry 的双语描述，不要求 README 双语。要不要补中文 README，等你定。
