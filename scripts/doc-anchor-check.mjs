#!/usr/bin/env node
/**
 * MAINTENANCE.md 的行号锚点自检。
 *
 * 文档里写着 `symbol`（1234）与 1234–1290 两类引用，代码一改就会漂。
 * 这个脚本把每个锚点拿回 lib/client.js 里核对：符号必须真的出现在那一行，
 * 每个区间必须落在文件行数以内且起点不大于终点。漂了就退出 1。
 *
 *   node scripts/doc-anchor-check.mjs
 *
 * 只读不改：它不会去"修"文档，因为差一位的行号只有人能判断该往哪边挪。
 */
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
// --doc / --code 只给测试用：拿一份改过的副本跑一遍，证明这个脚本真的会报错，
// 而不是永远打印一行 ✔。
const argv = process.argv.slice(2)
const flag = (name, fallback) => {
  const at = argv.indexOf('--' + name)
  return at >= 0 && argv[at + 1] !== undefined ? resolve(argv[at + 1]) : fallback
}
const DOC = flag('doc', resolve(ROOT, 'MAINTENANCE.md'))
const CODE = flag('code', resolve(ROOT, 'lib', 'client.js'))

const md = readFileSync(DOC, 'utf8').split(/\r?\n/)
const js = readFileSync(CODE, 'utf8').split(/\r?\n/)
// 末尾空行不算一行：编辑器的"最后一行"和真实代码行号差一位。
const total = js[js.length - 1] === '' ? js.length - 1 : js.length

const problems = []
let anchors = 0
const ranges = []
for (let i = 0; i < md.length; i++) {
  const line = md[i]
  for (const m of line.matchAll(/`([A-Za-z_][A-Za-z0-9_]*)`（(\d+)/g)) {
    anchors++
    const symbol = m[1]
    const at = Number(m[2])
    const text = js[at - 1] ?? ''
    if (!text.includes(symbol)) {
      problems.push('MAINTENANCE.md:' + (i + 1) + ' ' + symbol + ' 不在 client.js:' + at + '（该行是 ' + JSON.stringify(text.slice(0, 80)) + '）')
    }
  }
  for (const m of line.matchAll(/(\d{1,4})–(\d{1,4})/g)) {
    const from = Number(m[1])
    const to = Number(m[2])
    if (from < 1 || to > total || from > to) {
      problems.push('MAINTENANCE.md:' + (i + 1) + ' 区间 ' + m[0] + ' 越界或倒序（client.js 共 ' + total + ' 行）')
    } else {
      ranges.push([from, to])
    }
  }
}

// 文档自称的总行数是第二处会被改代码打脸的地方。
const claimed = md.join('\n').match(/(\d{3,5}) 行/)
if (claimed !== null && Number(claimed[1]) !== total) {
  problems.push('MAINTENANCE.md 自称 ' + claimed[1] + ' 行，client.js 实际 ' + total + ' 行')
}

// 区间允许嵌套：文档先给整段（`apply`（2591–3595）），再给段内的小块
// （2591–2639、2596–2609……）。所以这里只查越界和倒序，不查重叠。

if (problems.length > 0) {
  console.error('✖ 文档锚点与代码对不上（' + problems.length + ' 处）：')
  for (const line of problems) console.error('  ' + line)
  process.exit(1)
}
console.log('✔ 文档锚点：' + anchors + ' 个符号、' + ranges.length + ' 段区间，全部落在 client.js 的 ' + total + ' 行内')
