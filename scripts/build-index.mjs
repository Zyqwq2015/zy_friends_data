import { writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { buildFriendsIndex, readFriendFiles } from './friend-data.mjs'

const dataDir = resolve(process.argv[2] || 'data')
const outputFile = resolve(process.argv[3] || 'friends.json')
const { friends, errors } = await readFriendFiles(dataDir)

if (errors.length) {
  console.error('友链数据校验失败：')
  for (const error of errors) console.error(`- ${error}`)
  process.exitCode = 1
} else {
  await writeFile(outputFile, buildFriendsIndex(friends), 'utf8')
  console.log(`已生成 ${outputFile}，共 ${friends.length} 条友链。`)
}
