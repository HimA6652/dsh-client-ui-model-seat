#!/usr/bin/env node
/**
 * 核对 npm 真正会发布的内容，把自己当成一个挑剔的 reviewer：
 *   1. package.json 的 files 里不许出现目录——目录会把里面的垃圾一起带上（*.bak 就是这么溜出去的）。
 *   2. 制品里不许出现备份、日志、临时文件。
 *   3. files 里写了的每一个文件都必须真的在制品里（写了却不在 = 打包规则写错了）。
 *   4. 制品里不许有清单外的文件——只有 package.json / README.md / LICENSE / CHANGELOG.md 天然豁免。
 *
 *   node scripts/check-pack.mjs
 *
 * 判定依据是 npm pack --dry-run --json 的真实输出，不是我们的想象。
 */
import { spawnSync } from 'node:child_process'
import { readFileSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SELF = ['package.json', 'README.md', 'LICENSE', 'CHANGELOG.md']
const FORBIDDEN = /\.(?:bak|orig|rej|swp|tmp|log|tsbuildinfo)$|~(?:\/|$)|(?:^|\/)\.DS_Store$|(?:^|\/)node_modules\//
const pkg = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8'))
const declared = pkg.files ?? []
const problems = []

// 断言 1：files 只许写文件，不许写目录
for (const entry of declared) {
  let info
  try {
    info = statSync(resolve(ROOT, entry))
  } catch {
    problems.push('files 里写了 ' + entry + '，但磁盘上没有这个路径')
    continue
  }
  if (info.isDirectory()) {
    problems.push('files 里是目录：' + entry + '——目录会连里面的临时文件一起带走，逐个列文件')
  }
}

// 拿 npm 的视角看制品（Windows 上 npm 是 .cmd，必须过 shell）
const packed = spawnSync('npm pack --dry-run --json', { cwd: ROOT, encoding: 'utf8', shell: true, maxBuffer: 16 * 1024 * 1024 })
if (packed.status !== 0) {
  console.error('✖ npm pack --dry-run --json 跑失败：')
  console.error(packed.stderr?.trim() || packed.error?.message)
  process.exit(1)
}
let shipped = []
let totalBytes = 0
try {
  const report = JSON.parse(packed.stdout.slice(packed.stdout.indexOf('[')))
  shipped = report[0].files.map((file) => file.path.split('\\').join('/'))
  totalBytes = report[0].size
} catch (error) {
  console.error('✖ 解析 npm pack 输出失败：' + error.message)
  console.error(packed.stdout.slice(0, 400))
  process.exit(1)
}

// 断言 2：制品里不许有备份 / 日志 / 临时文件
for (const file of shipped) {
  if (FORBIDDEN.test(file)) problems.push('制品里混进了不该发的文件：' + file)
}

// 断言 3：files 写了的必须真的在
for (const entry of declared) {
  if (!shipped.includes(entry)) problems.push('files 里写了 ' + entry + '，但 npm 制品里没有')
}

// 断言 4：制品里不许有清单外的
const allowed = new Set([...declared, ...SELF])
for (const file of shipped) {
  if (!allowed.has(file)) problems.push('制品里有清单外的文件：' + file + '——要么加进 files，要么删掉')
}

if (problems.length > 0) {
  console.error('✖ 制品清单有问题：')
  for (const line of problems) console.error('  ' + line)
  process.exit(1)
}

console.log('✔ 制品清单干净：' + shipped.length + ' 个文件，合计 ' + (totalBytes / 1024).toFixed(1) + ' kB')
console.log('  ' + shipped.join('\n  '))
