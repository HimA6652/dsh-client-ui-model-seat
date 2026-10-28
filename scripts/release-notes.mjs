#!/usr/bin/env node
/**
 * 从 CHANGELOG.md 抽出某个版本的正文，作为 GitHub Release 的说明。
 *
 *   node scripts/release-notes.mjs v0.1.2 > notes.md
 *
 * 抽不到就退化成一句指向 CHANGELOG 的话，不编内容：
 * 漏写一个标题不该把整个发布流程卡死（release.mjs 会先硬拦一次）。
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const REPO = 'https://github.com/HimA6652/dsh-client-ui-model-seat'
const tag = process.argv[2] ?? ''
const version = tag.replace(/^v/, '')

if (version === '') {
  console.error('用法：node scripts/release-notes.mjs <tag>')
  process.exit(2)
}

const changelog = readFileSync(fileURLToPath(new URL('../CHANGELOG.md', import.meta.url)), 'utf8')
const lines = changelog.split(/\r?\n/)
const start = lines.findIndex((line) => line.startsWith('## [' + version + ']'))

if (start === -1) {
  console.error('CHANGELOG.md 里没有 ' + version + ' 的小节，Release 说明将只有安装提示。')
  console.log('详见 [CHANGELOG.md](' + REPO + '/blob/main/CHANGELOG.md)')
  process.exit(0)
}

let end = lines.findIndex((line, index) => index > start && line.startsWith('## '))
if (end === -1) end = lines.length

const body = lines.slice(start + 1, end).join('\n').trim()

console.log(
  [
    body,
    '',
    '---',
    '',
    '**安装 / 升级**',
    '',
    '```bash',
    '# 从 npm',
    'dsh plugin --profile desktop add dsh-client-ui-model-seat',
    '',
    '# 或者直接从仓库装',
    'dsh plugin --profile desktop add github:HimA6652/dsh-client-ui-model-seat',
    '```',
    '',
    '装完重启 DeepSeek Harness 桌面端。两个原插件（dsh-client-ui-gpt-helper、dsh-model-provider-prefix）请先卸载，它们与本插件抢同一个控件席位。',
  ].join('\n'),
)
