import { readdir, readFile } from 'node:fs/promises'
import { basename, join } from 'node:path'

export const FRIEND_KEYS = ['name', 'avatar', 'description', 'url']
export const MAX_FRIENDS = 500

const HOSTNAME_RE = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i
const CONTROL_CHAR_RE = /[\u0000-\u001f\u007f]/

function describe(label, message) {
  return label ? `${label}: ${message}` : message
}

function textLength(value) {
  return [...value].length
}

function validateHttpsUrl(raw, label, field) {
  let parsed
  try {
    parsed = new URL(raw)
  } catch {
    return { error: describe(label, `${field} 不是有效 URL`) }
  }

  if (parsed.protocol !== 'https:') {
    return { error: describe(label, `${field} 必须使用 HTTPS`) }
  }
  if (parsed.username || parsed.password) {
    return { error: describe(label, `${field} 不能包含用户名或密码`) }
  }
  if (parsed.port && parsed.port !== '443') {
    return { error: describe(label, `${field} 不能使用非 443 端口`) }
  }
  if (!HOSTNAME_RE.test(parsed.hostname)) {
    return { error: describe(label, `${field} 的域名无效`) }
  }
  if (parsed.href.length > 500) {
    return { error: describe(label, `${field} 过长`) }
  }
  if (parsed.hash) {
    return { error: describe(label, `${field} 不能包含 # 片段`) }
  }

  return { parsed }
}

export function validateFriendObject(value, options = {}) {
  const { label = '', expectedFile = '' } = options
  const errors = []

  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return [describe(label, 'JSON 根节点必须是对象')]
  }

  const keys = Object.keys(value)
  for (const key of FRIEND_KEYS) {
    if (!keys.includes(key)) errors.push(describe(label, `缺少字段 ${key}`))
  }
  for (const key of keys) {
    if (!FRIEND_KEYS.includes(key)) errors.push(describe(label, `不允许字段 ${key}`))
  }

  for (const field of FRIEND_KEYS) {
    if (typeof value[field] !== 'string') {
      errors.push(describe(label, `${field} 必须是字符串`))
      continue
    }
    if (value[field] !== value[field].trim()) {
      errors.push(describe(label, `${field} 首尾不能有空白字符`))
    }
    if (CONTROL_CHAR_RE.test(value[field])) {
      errors.push(describe(label, `${field} 不能包含控制字符`))
    }
  }

  if (typeof value.name === 'string' && (textLength(value.name) < 1 || textLength(value.name) > 40)) {
    errors.push(describe(label, 'name 长度必须为 1 到 40 个字符'))
  }
  if (typeof value.description === 'string' && (textLength(value.description) < 1 || textLength(value.description) > 100)) {
    errors.push(describe(label, 'description 长度必须为 1 到 100 个字符'))
  }

  let site
  if (typeof value.url === 'string') {
    const result = validateHttpsUrl(value.url, label, 'url')
    if (result.error) errors.push(result.error)
    else site = result.parsed
  }

  if (typeof value.avatar === 'string') {
    const result = validateHttpsUrl(value.avatar, label, 'avatar')
    if (result.error) errors.push(result.error)
  }

  if (expectedFile && site) {
    const expected = `${site.hostname.toLowerCase()}.json`
    if (expectedFile !== expected) {
      errors.push(describe(label, `文件名应为 ${expected}，而不是 ${expectedFile}`))
    }
  }

  return errors
}

export function normalizeFriend(friend) {
  return {
    name: friend.name,
    avatar: friend.avatar,
    description: friend.description,
    url: friend.url,
  }
}

export async function readFriendFiles(dataDir) {
  const entries = await readdir(dataDir, { withFileTypes: true })
  const jsonEntries = entries
    .filter((entry) => entry.name.endsWith('.json'))
    .sort((a, b) => a.name.localeCompare(b.name, 'en'))
  const errors = []
  const friends = []

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) {
      errors.push(`${entry.name}: data 目录只能直接存放 .json 文件`)
    }
  }

  if (jsonEntries.length > MAX_FRIENDS) {
    errors.push(`友链数量不能超过 ${MAX_FRIENDS}`)
  }

  for (const entry of jsonEntries) {
    const filePath = join(dataDir, entry.name)
    let value
    try {
      value = JSON.parse(await readFile(filePath, 'utf8'))
    } catch (error) {
      errors.push(`${entry.name}: JSON 解析失败（${error?.message || '格式错误'}）`)
      continue
    }

    const rowErrors = validateFriendObject(value, {
      label: entry.name,
      expectedFile: entry.name,
    })
    if (rowErrors.length) {
      errors.push(...rowErrors)
      continue
    }

    friends.push(normalizeFriend(value))
  }

  const urls = new Map()
  const names = new Map()
  for (const friend of friends) {
    const normalizedUrl = new URL(friend.url).href.replace(/\/$/, '').toLowerCase()
    const normalizedName = friend.name.toLowerCase()
    if (urls.has(normalizedUrl)) {
      errors.push(`${friend.url}: 与 ${urls.get(normalizedUrl)} 的友链重复`)
    } else {
      urls.set(normalizedUrl, friend.name)
    }
    if (names.has(normalizedName)) {
      errors.push(`${friend.name}: 网站名称与 ${names.get(normalizedName)} 重复`)
    } else {
      names.set(normalizedName, friend.name)
    }
  }

  return { friends, errors, fileNames: jsonEntries.map((entry) => basename(entry.name)) }
}

export function buildFriendsIndex(friends) {
  const collator = new Intl.Collator('zh-CN', { sensitivity: 'base', numeric: true })
  const sorted = [...friends].sort((a, b) => collator.compare(a.name, b.name) || collator.compare(a.url, b.url))
  return `${JSON.stringify(sorted, null, 2)}\n`
}
