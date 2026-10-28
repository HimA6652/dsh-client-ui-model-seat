#!/usr/bin/env node
/**
 * 扫一遍会进仓库的文本文件，专门找两类别的东西：
 *   1. 凭据形状的字串（token / 私钥 / 云厂商 key）——零容忍。
 *   2. 本机元信息（开发机用户名、绝对路径、内网地址、真实账号名）——不写进公开文档。
 *
 * 命中判定很粗暴，宁可误报：修掉它只要几秒，漏掉一个要清 git 历史。
 * 确实是占位符或文档里必须出现的名字，就在那一行末尾加 secret-ok 注释。
 *
 *   node scripts/check-secrets.mjs
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..')
const ALLOW_MARK = 'secret-ok'
const MAX_BYTES = 2 * 1024 * 1024

// test/vendor 是 React 的 UMD 压缩包（单行几百 KB），.research / .shots 是不进仓库的临时材料。
const SKIP_DIRS = new Set(['node_modules', '.git', '.shots', '.research', 'memory', 'vendor', 'coverage'])
const TEXT_EXT = /(?:^|\/)[^/]+\.(?:md|txt|mjs|js|mts|ts|json|ya?ml|yml|html|css|sh|ps1|cjs|svg)$/i

// 占位符白名单：文档里本来就该写这些名字，不当作真实用户名
const PLACEHOLDER = /^(?:you|your|user|username|name|me|someone|example|<.*|\$\(.*|\{.*|x{1,}|\d+|\.{2,}|path|to|home|profile)$/i

const RULES = [
  { id: 'github token', re: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{16,}\b/g },
  { id: 'github fine-grained token', re: /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g },
  { id: 'api key (sk-…)', re: /\bsk-[A-Za-z0-9_-]{16,}\b/g },
  { id: 'aws access key', re: /\bAKIA[0-9A-Z]{16}\b/g },
  { id: 'private key block', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/g },
  { id: 'npm authToken', re: /^\s*\/\/registry\.npmjs\.org\/:_authToken\s*=/gm },
  { id: 'windows dev path', re: /[A-Za-z]:[\\/](?:Users|ProgramData)[\\/]([^\\/\s"'`]+)/g, segment: 1 },
  { id: 'posix home path', re: /(?:^|[\s"'(=])\/(?:Users|home)\/([A-Za-z0-9._-]+)/g, segment: 1 },
  // 127.0.0.1 是回环地址，本地服务工具的文档里到处都有，不算泄漏；只盯局域网段
  { id: 'lan ip', re: /\b(?:10|192\.168|172\.(?:1[6-9]|2\d|3[01]))\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g },
]

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === '.git') continue
    const full = join(dir, entry)
    const info = statSync(full)
    if (info.isDirectory()) {
      if (!SKIP_DIRS.has(entry)) walk(full, out)
      continue
    }
    if (info.size > MAX_BYTES) continue
    if (!TEXT_EXT.test('/' + entry)) continue
    out.push(full)
  }
  return out
}

const problems = []
let scanned = 0

for (const file of walk(ROOT)) {
  const rel = relative(ROOT, file).split('\\').join('/')
  // 本文件全是正则字面量，自己扫自己只会刷屏
  if (rel === 'scripts/check-secrets.mjs') continue
  const lines = readFileSync(file, 'utf8').split(/\r?\n/)
  scanned += 1

  lines.forEach((line, index) => {
    if (line.includes(ALLOW_MARK)) return
    for (const rule of RULES) {
      rule.re.lastIndex = 0
      let match
      while ((match = rule.re.exec(line)) !== null) {
        if (rule.segment !== undefined && PLACEHOLDER.test(match[rule.segment] ?? '')) continue
        problems.push(rel + ':' + (index + 1) + '  [' + rule.id + ']  ' + match[0].trim())
      }
    }
  })
}

if (problems.length > 0) {
  console.error('✖ 这些位置看起来带着凭据或本机信息：')
  for (const line of problems) console.error('  ' + line)
  console.error('\n共 ' + problems.length + ' 处。改成占位符（/path/to/…、<your-name>）后重跑；确属占位就在行尾加 ' + ALLOW_MARK + '。')
  process.exit(1)
}

console.log('✔ 扫了 ' + scanned + ' 个文本文件，没有凭据形状的字串，也没有本机路径')
