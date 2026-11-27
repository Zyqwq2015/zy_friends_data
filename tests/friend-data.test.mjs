import assert from 'node:assert/strict'
import test from 'node:test'
import { buildFriendsIndex, validateFriendObject } from '../scripts/friend-data.mjs'

const valid = {
  name: '示例站点',
  avatar: 'https://example.com/avatar.png',
  description: '一个示例站点',
  url: 'https://blog.example.com/',
}

test('接受符合要求的友链对象', () => {
  assert.deepEqual(validateFriendObject(valid, { expectedFile: 'blog.example.com.json' }), [])
})

test('拒绝额外字段', () => {
  const errors = validateFriendObject({ ...valid, color: 'red' }, { expectedFile: 'blog.example.com.json' })
  assert.ok(errors.some((error) => error.includes('不允许字段 color')))
})

test('拒绝非 HTTPS 地址', () => {
  const errors = validateFriendObject({ ...valid, url: 'http://blog.example.com/' }, { expectedFile: 'blog.example.com.json' })
  assert.ok(errors.some((error) => error.includes('必须使用 HTTPS')))
})

test('文件名必须与域名一致', () => {
  const errors = validateFriendObject(valid, { expectedFile: 'wrong.example.com.json' })
  assert.ok(errors.some((error) => error.includes('文件名应为 blog.example.com.json')))
})

test('索引输出可以重新解析', () => {
  const output = buildFriendsIndex([valid])
  assert.deepEqual(JSON.parse(output), [valid])
  assert.ok(output.endsWith('\n'))
})
