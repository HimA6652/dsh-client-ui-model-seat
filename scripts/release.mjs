#!/usr/bin/env node
/**
 * 一条命令发版：查版本说明 → 自检 → 测试 → 发 npm → 提交 → 打标签 → 推送。
 * 推送标签后 .github/workflows/release.yml 会自动建 GitHub Release。
 *
 *   node scripts/release.mjs 0.1.2
 *   node scripts/release.mjs 0.1.2 --dry-run      # 只跑到测试为止：不发 npm、不提交、不打标签
 *   node scripts/release.mjs 0.1.2 --no-publish   # 跳过 npm，只发 GitHub
 *   node scripts/release.mjs 0.1.2 --no-push      # 提交和打标签，但不推
 *
 * 前提：CHANGELOG.md 里先写好 `## [0.1.2]` 那一节——Release 正文就是它，人不写脚本不编。
 */
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const version = (args[0] ?? '').replace(/^v/, '')
const dryRun = args.includes('--dry-run')
const noPush = args.includes('--no-push')
const noPublish = args.includes('--no-publish')

function fail(message) {
  console.error('✖ ' + message)
  process.exit(1)
}

function run(command, commandArgs) {
  console.log('$ ' + command + ' ' + commandArgs.join(' '))
  execFileSync(command, commandArgs, { cwd: ROOT, stdio: 'inherit' })
}

function output(command, commandArgs) {
  return execFileSync(command, commandArgs, { cwd: ROOT, encoding: 'utf8' }).trim()
}

// Windows 上 npm 是 .cmd 批处理，Node 20+ 不许直接 execFile 它（ENOENT/EINVAL），只能过 shell。
// git / node 仍走 execFile，参数不用关心空格与引号。
function runShell(command) {
  console.log('$ ' + command)
  execFileSync(command, { cwd: ROOT, stdio: 'inherit', shell: true })
}

function outputShell(command) {
  try {
    return execFileSync(command, { cwd: ROOT, encoding: 'utf8', shell: true, stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  } catch (error) {
    return String(error.stdout ?? '').trim()
  }
}

if (!/^\d+\.\d+\.\d+$/.test(version)) fail('用法：node scripts/release.mjs <major.minor.patch> [--dry-run] [--no-publish] [--no-push]')

const pkgPath = resolve(ROOT, 'package.json')
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
const packageName = pkg.name
const previous = pkg.version

// 门 1：版本说明先存在，否则发出去的 Release 是空的
const changelog = readFileSync(resolve(ROOT, 'CHANGELOG.md'), 'utf8')
if (!changelog.includes('## [' + version + ']')) {
  fail('CHANGELOG.md 里没有 "## [' + version + ']" 这一节，先把这版改了什么写进去')
}

// 门 2：工作区干净，免得分不清哪些改动进了这一版
const dirty = output('git', ['status', '--porcelain'])
if (dirty !== '') fail('工作区还有未提交的改动：\n' + dirty + '\n先提交或 stash，再发版')

// 门 3：在 main 上发
const branch = output('git', ['rev-parse', '--abbrev-ref', 'HEAD'])
if (branch !== 'main') fail('当前分支是 ' + branch + '，发版要在 main 上')

// 门 4：标签不能重名，远端也要查——本地没标签不代表远端没有（重装过机器就会踩）
if (output('git', ['tag', '--list', 'v' + version]) !== '') {
  fail('本地已有标签 v' + version + '——换新版本号，或先 git tag -d v' + version)
}
const remoteTag = outputShell('git ls-remote --tags origin v' + version)
if (remoteTag !== '') fail('远端 origin 上已经有 v' + version + '，版本号被占了；用新版本号')

// 改版本号：package.json 与 lib/client.js 的 BUILD 字面量两处
if (previous !== version) {
  writeFileSync(pkgPath, JSON.stringify({ ...pkg, version }, null, 2) + '\n')
  const clientPath = resolve(ROOT, 'lib/client.js')
  const client = readFileSync(clientPath, 'utf8')
  const patched = client.replace(/const BUILD = '[^']*\+merge'/, "const BUILD = '" + version + "+merge'")
  if (patched === client) fail('lib/client.js 里没找到 const BUILD = \'…+merge\'，版本号没法同步')
  writeFileSync(clientPath, patched)
  console.log('✔ 版本 ' + previous + ' → ' + version + '（package.json + lib/client.js BUILD）')
} else {
  console.log('✔ package.json 已经是 ' + version + '，只补标签')
}

// 内容检查与测试：坏版本不放行（prepublishOnly 会再跑一遍）
run('node', ['scripts/check-secrets.mjs'])
run('node', ['scripts/check-pack.mjs'])
run('node', ['scripts/release-notes.mjs', 'v' + version])
run('node', ['scripts/validate-plugin.mjs'])
runShell('npm test')

if (dryRun) {
  console.log('\n--dry-run：检查与测试都过了，但没发 npm、没提交、没打标签。版本号改动留在工作区，自己决定留还是撤。')
  process.exit(0)
}

// 发 npm：先确认登录态与版本号没被占，再传
if (!noPublish) {
  const who = outputShell('npm whoami')
  if (who === '') fail('npm 没登录，发布不了。先跑 npm whoami；只想发 GitHub 就加 --no-publish')
  console.log('✔ npm 登录用户：' + who)

  const already = outputShell('npm view ' + packageName + '@' + version + ' version')
  if (already === version) {
    fail(packageName + '@' + version + ' 已经在 npm 上了，别再传；换版本号或加 --no-publish 只发 GitHub')
  }
  runShell('npm publish')
  console.log('✔ ' + packageName + '@' + version + ' 已发布到 npm')
}

// 提交只带版本号两个文件：别用 git add -A 把私货一起推上去
run('git', ['add', 'package.json', 'lib/client.js'])
if (outputShell('git diff --cached --name-only') !== '') {
  run('git', ['commit', '-m', 'chore(release): v' + version])
} else {
  console.log('✔ 两个版本号文件都没有待提交的改动，跳过 commit')
}
run('git', ['tag', '-a', 'v' + version, '-m', 'v' + version])

if (noPush) {
  console.log('\n--no-push：提交与标签 v' + version + ' 已建好，推送请手动执行')
  console.log('  git push && git push origin v' + version)
  process.exit(0)
}

run('git', ['push'])
run('git', ['push', 'origin', 'v' + version])

const repo = (pkg.repository?.url ?? 'https://github.com/HimA6652/dsh-client-ui-model-seat.git').replace(/^git\+/, '').replace(/\.git$/, '')
console.log('\n✔ 已推送 v' + version + '。GitHub Release 由 Actions 自动创建，稍等半分钟：')
console.log('  ' + repo + '/releases')
if (noPublish) console.log('  npm 这次没发（--no-publish），需要时手动 npm publish')
