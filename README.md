# Zyqwq 友链数据

这里是 [Zyqwq](https://www.zyqwq.cn/friend) 的友链数据仓库。每个已通过的友链都会自动进入站点。

## 申请前

请先在贵站任意一个公开页面添加本站友链，链接要实际出现在 HTML 中，不能只在 JavaScript 里临时生成。可以直接使用下面的信息：

```json
{
  "name": "Zyqwq",
  "avatar": "https://q2.qlogo.cn/headimg_dl?dst_uin=2869180171&spec=0",
  "description": "记录代码、技术与数字生活的个人网站",
  "url": "https://www.zyqwq.cn/"
}
```

本站链接必须指向 `https://www.zyqwq.cn/` 或 `https://zyqwq.cn/`。放在首页、友链页或关于页都可以。

## 提交步骤

1. 点击右上角 **Fork**，Fork 一份到自己的 GitHub 账号。
2. 在自己的仓库进入 `data` 文件夹，点击 **Add file → Create new file**。
3. 文件名填写你的站点域名，例如 `blog.example.com.json`，然后粘贴下面的模板：

```json
{
  "name": "网站名称",
  "avatar": "https://example.com/avatar.png",
  "description": "一句话介绍你的网站",
  "url": "https://blog.example.com/"
}
```

4. 提交这次修改，然后回到本仓库点击 **New pull request**，选择你刚提交的分支。
5. 按提示创建 Pull Request，等待自动检查。

检查通过后，Pull Request 会自动合并，友链会进入站点。站点通常会在 5 分钟内更新。

## 自动检查内容

- 每次只能新增、更新或删除一个 `data/*.json` 文件，不能修改工作流或其他文件。
- JSON 必须且只能包含 `name`、`avatar`、`description`、`url` 四个字段。
- 站点和头像必须使用 HTTPS，并且能够正常访问。
- 文件名必须与站点域名一致，例如 `https://blog.example.com/` 对应 `data/blog.example.com.json`。
- 你的站点页面中必须能找到指向 `zyqwq.cn` 的友链。
- 不允许与已有友链重复。

如果检查失败，Actions 会给出原因。直接在自己的 Fork 中修改同一个 JSON 文件并提交，Pull Request 会自动重新检查，不需要重新发起申请。

## 字段说明

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `name` | 是 | 网站名称，1 到 40 个字符 |
| `avatar` | 是 | 头像地址，使用 HTTPS，内容必须是图片 |
| `description` | 是 | 一句话简介，1 到 100 个字符 |
| `url` | 是 | 网站地址，使用 HTTPS |

## 修改或移除友链

- 修改：提交新的 Pull Request，更新你的 JSON 文件。
- 移除：提交 Pull Request 删除你的 JSON 文件。检查通过后会自动移除。
- 其他问题：请开 Issue，并附上对应的 Pull Request 或仓库链接。

请不要提交违法、仿冒、钓鱼、恶意跳转或无法正常访问的网站。仓库维护者可以拒绝或移除不符合要求的友链。
