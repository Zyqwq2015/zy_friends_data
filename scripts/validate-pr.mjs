import { lookup } from 'node:dns/promises'
import { appendFile, readFile, writeFile } from 'node:fs/promises'
import { isIP } from 'node:net'
import { resolve } from 'node:path'
import { buildFriendsIndex, readFriendFiles } from './friend-data.mjs'

const dataDir = resolve(process.argv[2] || '.pr-head/data')
const changedFilesPath = resolve(process.argv[3] || 'changed-files.txt')
const reportPath = resolve(process.env.VALIDATION_REPORT || 'validation-report.md')
const OUR_HOSTS = new Set(['zyqwq.cn', 'www.zyqwq.cn'])
const USER_AGENT = 'ZyqwqFriendsValidator/1.0 (+https://www.zyqwq.cn/friend)'
const MAX_HTML_BYTES = 2 * 1024 * 1024
const MAX_AVATAR_BYTES = 8 * 1024 * 1024
const REQUEST_TIMEOUT_MS = 10_000

function normalizeHost(hostname) {
  return hostname.toLowerCase().replace(/\.$/, '')
}

function isPrivateIpv4(ip) {
  const parts = ip.split('.').map(Number)
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true
  const [a, b] = parts
  return a === 0
    || a === 10
    || a === 127
    || (a === 100 && b >= 64 && b <= 127)
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 0)
    || (a === 192 && b === 168)
    || (a === 198 && (b === 18 || b === 19))
    || (a === 198 && b === 51 && parts[2] === 100)
    || (a === 203 && b === 0 && parts[2] === 113)
    || a >= 224
}

function isPrivateIpv6(ip) {
  const normalized = ip.toLowerCase()
  if (normalized === '::' || normalized === '::1') return true
  if (normalized.startsWith('fc') || normalized.startsWith('fd')) return true
  if (normalized.startsWith('fe8') || normalized.startsWith('fe9') || normalized.startsWith('fea') || normalized.startsWith('feb')) return true
  if (normalized.startsWith('ff')) return true
  const mapped = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)
  return Boolean(mapped && isPrivateIpv4(mapped[1]))
}

function isPrivateAddress(ip) {
  const version = isIP(ip)
  if (version === 4) return isPrivateIpv4(ip)
  if (version === 6) return isPrivateIpv6(ip)
  return true
}

async function assertPublicUrl(url) {
  if (url.protocol !== 'https:') throw new Error('远程地址必须使用 HTTPS')
  if (url.username || url.password) throw new Error('远程地址不能包含登录凭据')
  if (url.port && url.port !== '443') throw new Error('远程地址不能使用非 443 端口')
  const host = normalizeHost(url.hostname)
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) {
    throw new Error(`不允许访问内网地址 ${host}`)
  }

  const addresses = await lookup(host, { all: true, verbatim: true })
  if (!addresses.length) throw new Error(`无法解析域名 ${host}`)
  if (addresses.some((entry) => isPrivateAddress(entry.address))) {
    throw new Error(`${host} 解析到了非公网地址`)
  }
}

async function safeFetch(input, options = {}, redirects = 0) {
  const url = new URL(input)
  if (redirects > 5) throw new Error('重定向次数过多')
  await assertPublicUrl(url)

  const response = await fetch(url, {
    ...options,
    redirect: 'manual',
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    headers: {
      'User-Agent': USER_AGENT,
      Accept: options.accept || '*/*',
      ...options.headers,
    },
  })

  if ([301, 302, 303, 307, 308].includes(response.status)) {
    const location = response.headers.get('location')
    await response.body?.cancel()
    if (!location) throw new Error(`收到 ${response.status} 重定向，但没有 Location`)
    return safeFetch(new URL(location, url), options, redirects + 1)
  }

  return response
}

async function readBodyLimited(response, limit) {
  const contentLength = Number(response.headers.get('content-length') || 0)
  if (contentLength > limit) throw new Error(`响应内容超过 ${Math.round(limit / 1024)} KiB`)
  if (!response.body) return ''

  const reader = response.body.getReader()
  const chunks = []
  let total = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > limit) {
      await reader.cancel()
      throw new Error(`响应内容超过 ${Math.round(limit / 1024)} KiB`)
    }
    chunks.push(value)
  }

  const merged = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    merged.set(chunk, offset)
    offset += chunk.byteLength
  }
  return new TextDecoder().decode(merged)
}

function extractLinks(html, baseUrl) {
  const links = []
  const re = /<a\b[^>]*?\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi
  let match
  while ((match = re.exec(html))) {
    const raw = match[1] || match[2] || match[3] || ''
    try {
      const url = new URL(raw, baseUrl)
      url.hash = ''
      links.push(url)
    } catch {}
  }
  return links
}

function isOurHost(url) {
  return OUR_HOSTS.has(normalizeHost(url.hostname))
}

function looksLikeFriendPage(url, origin) {
  if (url.origin !== origin) return false
  return /(?:^|\/)(?:friends?|links?|blogroll|about|friend-links|youqing|友情|友链)(?:\/|$)/i.test(url.pathname)
}

async function verifyBacklink(siteUrl) {
  const initial = new URL(siteUrl)
  const queue = [
    initial.href,
    new URL('/friend', initial.origin).href,
    new URL('/friends', initial.origin).href,
    new URL('/links', initial.origin).href,
    new URL('/blogroll', initial.origin).href,
    new URL('/about', initial.origin).href,
  ].map((value) => {
    const url = new URL(value)
    url.hash = ''
    return url.href
  })
  const queued = new Set(queue)
  const visited = new Set()
  const failures = []

  while (queue.length && visited.size < 10) {
    const current = queue.shift()
    if (visited.has(current)) continue
    visited.add(current)

    let response
    try {
      response = await safeFetch(current, { accept: 'text/html,application/xhtml+xml' })
    } catch (error) {
      failures.push(`${new URL(current).host}${new URL(current).pathname}: ${error?.message || '访问失败'}`)
      continue
    }

    if (!response.ok) {
      failures.push(`${new URL(current).pathname}: HTTP ${response.status}`)
      await response.body?.cancel()
      continue
    }

    let html
    try {
      html = await readBodyLimited(response, MAX_HTML_BYTES)
    } catch (error) {
      failures.push(`${new URL(current).pathname}: ${error?.message || '读取失败'}`)
      continue
    }

    const links = extractLinks(html, current)
    if (links.some(isOurHost)) return { ok: true, checkedUrl: current }

    for (const link of links) {
      const href = link.href
      if (!queued.has(href) && !visited.has(href) && looksLikeFriendPage(link, initial.origin) && queue.length < 8) {
        queued.add(href)
        queue.push(href)
      }
    }
  }

  const details = failures.length ? `（${failures.slice(0, 3).join('；')}）` : ''
  return {
    ok: false,
    message: `没有在站点页面中找到指向 zyqwq.cn 的友链${details}`,
  }
}

async function verifyAvatar(avatarUrl) {
  let response
  try {
    response = await safeFetch(avatarUrl, { accept: 'image/avif,image/webp,image/png,image/jpeg,image/gif,image/svg+xml' })
  } catch (error) {
    return { ok: false, message: `头像无法访问：${error?.message || '请求失败'}` }
  }

  if (!response.ok) {
    await response.body?.cancel()
    return { ok: false, message: `头像返回 HTTP ${response.status}` }
  }

  const contentType = (response.headers.get('content-type') || '').toLowerCase()
  const contentLength = Number(response.headers.get('content-length') || 0)
  await response.body?.cancel()

  if (!contentType.startsWith('image/')) {
    return { ok: false, message: `头像响应不是图片（Content-Type: ${contentType || '未提供'}）` }
  }
  if (contentLength > MAX_AVATAR_BYTES) {
    return { ok: false, message: '头像文件大于 8 MiB' }
  }
  return { ok: true }
}

function cleanReportText(value) {
  return String(value)
    .replace(/[\r\n]+/g, ' ')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .slice(0, 500)
}

function buildReport(title, errors, successText) {
  if (!errors.length) {
    return `## ${title}\n\n${successText}\n\n通过后将自动合并，无需手动操作。\n`
  }
  const lines = errors.slice(0, 20).map((error) => `- ${cleanReportText(error)}`)
  if (errors.length > 20) lines.push(`- 另有 ${errors.length - 20} 个问题，请查看 Actions 日志。`)
  return `## ${title}\n\n${lines.join('\n')}\n\n请直接修改 Fork 中的 JSON 文件并提交，检查会自动重新运行。\n`
}

async function publishReport(title, errors, successText) {
  const report = buildReport(title, errors, successText)
  await writeFile(reportPath, report, 'utf8')
  console.log(report)
  if (process.env.GITHUB_STEP_SUMMARY) {
    await appendFile(process.env.GITHUB_STEP_SUMMARY, report, 'utf8')
  }
}

function parseChangedFiles(content) {
  return content
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      const [status, ...paths] = line.split('\t')
      return { status, paths }
    })
}

const errors = []
const changed = parseChangedFiles(await readFile(changedFilesPath, 'utf8'))
const changedJson = changed.filter(({ status, paths }) => status === 'A' && /^data\/[^/]+\.json$/.test(paths[0] || ''))

if (changed.length !== 1) {
  errors.push(`一次 Pull Request 只能修改一个文件，当前修改了 ${changed.length} 个`)
} else if (changedJson.length !== 1) {
  errors.push('本次修改必须是新增一个 data/<站点域名>.json 文件')
}

const { friends, errors: dataErrors } = await readFriendFiles(dataDir)
errors.push(...dataErrors)

if (!errors.length) {
  const changedPath = changed[0].paths[0]
  const fileName = changedPath.slice('data/'.length)
  const friend = friends.find((item) => new URL(item.url).hostname.toLowerCase() === fileName.slice(0, -'.json'.length))
  if (!friend) {
    errors.push(`没有找到 ${changedPath} 对应的有效友链`)
  } else {
    const [backlink, avatar] = await Promise.all([
      verifyBacklink(friend.url),
      verifyAvatar(friend.avatar),
    ])
    if (!backlink.ok) errors.push(backlink.message)
    if (!avatar.ok) errors.push(avatar.message)
  }
}

if (errors.length) {
  await publishReport('友链自动检查未通过', errors)
  process.exitCode = 1
} else {
  const preview = buildFriendsIndex(friends)
  await publishReport(
    '友链自动检查通过',
    [],
    `已经验证站点、头像和回链，索引预计生成 ${friends.length} 条友链。\n\n<details><summary>预览</summary>\n\n\`\`\`json\n${preview.slice(0, 1200)}\n\`\`\`\n\n</details>`,
  )
}
