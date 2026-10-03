# CloudFlare-ImgBed 图床部署教程总结

> 使用 **MarSeventh/CloudFlare-ImgBed + Cloudflare Pages + R2 + Workers KV**，在 Cloudflare 全球边缘网络部署一个低成本、可自定义域名、支持 API/WebDAV 的个人图床。

## 一、方案概览

| 项目       | 说明                                               |
| ---------- | -------------------------------------------------- |
| 图床程序   | MarSeventh/CloudFlare-ImgBed                       |
| 前端与函数 | Cloudflare Pages                                   |
| 图片本体   | Cloudflare R2                                      |
| 图片元数据 | Workers KV                                         |
| 预计耗时   | 30–45 分钟                                         |
| 月度成本   | 免费额度内 ¥0                                      |
| 适用场景   | 博客图床、Markdown 图片托管、API 上传、WebDAV 管理 |

示例中的 `gaoliming-imgbed`、`img.nanye.site` 等需替换为自己的项目名和域名。

---

## 二、前置准备

- 邮箱：注册 Cloudflare 和 GitHub。
- 境外支付方式：Visa / Mastercard / PayPal，用于开通 R2。
- 域名：可选但推荐。
- 能访问 Cloudflare 和 GitHub 的网络环境。

### 免费额度

| 资源            | 免费额度                           |
| --------------- | ---------------------------------- |
| R2 存储         | 10 GB                              |
| R2 写入 Class A | 100 万次/月                        |
| R2 读取 Class B | 1000 万次/月                       |
| R2 出站流量     | 无限免费                           |
| Pages Functions | 10 万次请求/天                     |
| Workers KV      | 10 万读/天 + 1000 写/天 + 1GB 存储 |
| 自定义域名      | 不限数量                           |

个人使用通常不会超限。

---

## 三、部署流程

### 1. Cloudflare 账号准备

1. 注册 Cloudflare 账号并验证邮箱。
2. 如需自定义域名，将根域名添加到 Cloudflare，修改 NS 服务器，等待状态变为“活动”。
3. 绑定支付方式：头像 → Billing → Payment Info → 添加付款方式。
   - 仅用于开通 R2，免费额度内不会扣费。

### 2. 开通 R2 并创建存储桶

1. Cloudflare 控制台 → R2 对象存储 → 启用 R2。
2. 创建存储桶：
   - 名称：全局唯一，如 `yourname-imgbed`
   - 位置：亚太地区 APAC
   - 默认存储类：标准
3. 创建后暂不操作，后续绑定到 Pages。

### 3. Fork 项目到 GitHub

1. 打开 `https://github.com/MarSeventh/CloudFlare-ImgBed`
2. 点击 Fork → Create fork。
3. 得到自己的仓库：`你的用户名/CloudFlare-ImgBed`。

### 4. 创建 Cloudflare Pages 项目

1. Cloudflare 控制台 → 计算 → Workers 和 Pages → 创建应用程序。
2. 注意：默认显示 Worker 创建页，需翻到页面底部，点击“想要部署 Pages? 开始使用”。
3. 连接 GitHub：
   - 选择 `Only select repositories`
   - 勾选 `CloudFlare-ImgBed`
   - Install & Authorize
4. 配置构建参数：

| 配置项       | 填写内容          |
| ------------ | ----------------- |
| 项目名称     | `yourname-imgbed` |
| 生产分支     | `main`            |
| 框架预设     | None              |
| 构建命令     | `npm install`     |
| 构建输出目录 | `frontend-dist`   |
| 根目录       | 留空              |
| 环境变量     | 留空              |

关键易错点：

- 构建命令必须是 `npm install`，不是 `npm run build`。
- 输出目录必须是 `frontend-dist`。

保存并部署，首次约 2–5 分钟。部署完成后先不要访问，因为 KV 和 R2 尚未绑定。

### 5. 创建并绑定 KV

1. Cloudflare 控制台 → 存储和数据库 → Workers KV → 创建实例。
2. 命名空间名称：`img_url`。
3. 回到 Pages 项目 → 设置 → 绑定 → 添加 → KV 命名空间。
4. 填写：
   - 变量名称：`img_url`
   - KV 命名空间：`img_url`

### 6. 绑定 R2 到 Pages

继续在绑定页面添加：

- 类型：R2 存储桶
- 变量名称：`img_r2`
- R2 存储桶：你的桶名，如 `yourname-imgbed`

绑定完成后应有两条记录：

| 类型        | 名称      | 值                |
| ----------- | --------- | ----------------- |
| KV 命名空间 | `img_url` | `img_url`         |
| R2 存储桶   | `img_r2`  | `yourname-imgbed` |

### 7. 重新部署使绑定生效

1. Pages 项目 → 部署 → 最新部署 → “…” → 重试部署。
2. 等待 1–3 分钟。
3. 日志出现 `Compiled Worker successfully`、`Upload complete!`、`Success` 即正常。

---

## 四、初始化图床后台

访问：

```text
https://yourname-imgbed.pages.dev/dashboard
```

### 必做设置

1. **设置管理员账密**
   - 首次默认空密码，必须立刻设置。
   - 后台 → 安全设置 → 管理端认证 → 设置用户名和强密码 → 保存。
   - 保存后会登出，用新账密重新登录。

2. **启用 R2 上传渠道**
   - 后台 → 上传设置 → CloudFlare R2。
   - 应自动出现 `R2_env` 渠道。
   - 确保开关为蓝色启用状态 → 保存。

3. **创建 API Token**
   - 后台 → 安全设置 → API Token 管理 → 添加。
   - 名称自定义，权限建议全勾，过期时间按需。
   - Token 只完整显示一次，立即保存。

---

## 五、测试上传

访问首页：

```text
https://yourname-imgbed.pages.dev
```

拖入图片或选择文件上传。成功后应显示文件名和四种链接格式：

- URL
- Markdown
- HTML
- BBCode

复制 URL 在新标签打开，能显示图片即成功。  
同时可在 Cloudflare → R2 → 你的桶中看到刚上传的文件。

---

## 六、绑定自定义子域名

1. Pages 项目 → 自定义域 → 设置自定义域。
2. 输入 `img.yoursite.com`。
3. 点继续 → 激活域。

### DNS 处理

- 情况 A：无通配符记录  
  Cloudflare 自动添加 `img` CNAME 指向 `yourname-imgbed.pages.dev`，自动激活。

- 情况 B：存在 `*.yoursite.com` 通配符  
  手动确认或添加 DNS 记录：
  - 类型：CNAME
  - 名称：`img`
  - 目标：`yourname-imgbed.pages.dev`
  - 代理状态：橙色“已代理”
  - TTL：自动

等待状态变为“已激活”。

### 添加放行域名

新域名生效后，必须回后台设置：

后台 → 系统设置 → 安全设置 → 访问管理 → 放行域名，填入：

```text
img.yoursite.com,yourname-imgbed.pages.dev
```

保存，否则可能被来源校验拦截。

---

## 七、最终验证

以下地址应可正常访问：

| 地址                                          | 用途                |
| --------------------------------------------- | ------------------- |
| `https://yourname-imgbed.pages.dev`           | Cloudflare 默认域名 |
| `https://yourname-imgbed.pages.dev/dashboard` | 管理后台            |
| `https://img.yoursite.com`                    | 自定义子域名        |

最终测试：从自定义域名上传图片，获取链接后新标签打开，能显示即完成。

---

## 八、常见问题速查

| 问题                       | 原因与解决                                                   |
| -------------------------- | ------------------------------------------------------------ |
| pages.dev 空白页           | 等待冷启动；检查 KV/R2 绑定；绑定后需重试部署                |
| 构建失败                   | 构建命令应为 `npm install`，输出目录应为 `frontend-dist`     |
| 自定义域一直验证中         | 检查 CNAME；代理状态必须为橙色“已代理”；处理通配符干扰       |
| 自定义域上传成功但图片报错 | 后台放行域名未添加                                           |
| 上传报错“未配置上传渠道”   | 上传设置中启用 `R2_env` 渠道并保存                           |
| 忘记管理员密码             | 删除 Workers KV `img_url` 中认证相关 key，重置为空后重新设置 |

---

## 九、维护与扩展

### 更新版本

1. 打开自己 Fork 的仓库。
2. 若提示落后，点击 `Sync fork` → `Update branch`。
3. Cloudflare Pages 自动重新部署。

### 备份

- 图片本体：已在 R2，自带高可用。
- 元数据：后台 → 系统状态 → 系统维护 → 备份数据，下载 JSON。
- 恢复：同一页面点击恢复数据。

### 扩展能力

- 支持多渠道：Telegram、Discord、S3、HuggingFace、WebDAV 等。
- 可做多通道负载均衡或主备容灾。
- 支持 REST API、WebDAV，便于对接 LLM、Agent、MCP。

### API 示例

```bash
curl -X POST "https://img.yoursite.com/upload?authCode=你的API_Token" \
  -F "file=@本地图片.png"
```

返回示例：

```json
[{"src": "/file/xxxxx.png"}]
```

拼接后即为图片访问链接：

```text
https://img.yoursite.com/file/xxxxx.png
```

主要端点：

| 端点                      | 用途        |
| ------------------------- | ----------- |
| `POST /upload`            | 上传图片    |
| `GET /api/manage/list`    | 列出图片    |
| `POST /api/manage/delete` | 删除图片    |
| `GET /random`             | 随机图      |
| `/dav/`                   | WebDAV 挂载 |

---

## 十、成本核算

| 资源            | 个人使用预估  | 免费上限   | 费用 |
| --------------- | ------------- | ---------- | ---- |
| R2 存储         | < 1 GB        | 10 GB      | ¥0   |
| R2 写入         | < 1000 次/月  | 100 万次   | ¥0   |
| R2 读取         | < 1 万次/月   | 1000 万次  | ¥0   |
| R2 流量         | 任意          | 无限免费   | ¥0   |
| Pages Functions | < 1000 次/天  | 10 万次/天 | ¥0   |
| Workers KV      | < 100 次写/天 | 1000 次/天 | ¥0   |
| 自定义域        | 1 个          | 不限       | ¥0   |

**每月总成本：¥0。**

---

## 十一、最终检查清单

- [ ] Cloudflare 账号已注册并验证邮箱
- [ ] R2 已开通，存储桶已创建
- [ ] GitHub 已 Fork `CloudFlare-ImgBed`
- [ ] Pages 已连接 GitHub 并部署成功
- [ ] 构建命令为 `npm install`
- [ ] 输出目录为 `frontend-dist`
- [ ] KV 已创建并绑定为 `img_url`
- [ ] R2 已绑定为 `img_r2`
- [ ] 已重试部署使绑定生效
- [ ] 已设置管理员账号密码
- [ ] 已启用 `R2_env` 上传渠道
- [ ] 已创建并保存 API Token
- [ ] 已测试上传并成功访问图片
- [ ] 如使用自定义域，已添加 CNAME 并设为橙色代理
- [ ] 已添加放行域名
- [ ] 已配置 KV 数据备份策略