做 Web3 的都知道，邮箱是数字身份证。市面上主流的邮箱方案，要么收费贵，要么隐私堪忧，要么前缀固定不能随意创建。

今天分享一个方案——利用 Cloudflare 的边缘计算能力，配合开源项目 CloudMail，实现零成本、免服务器、无限前缀、能收能发的私有邮箱系统。数据完全在自己手里。

## 为什么要私有邮箱

| 场景         | 痛点               | 价值                        |
| :----------- | :----------------- | :-------------------------- |
| 注册交易所   | 垃圾邮件轰炸主邮箱 | 用 `exchange@` 专门收验证码 |
| 注册空投项目 | 担心隐私泄露       | 用 `airdrop@` 隔离风险      |
| 注册金融机构 | 需要高安全性       | 用 `bank@` 独立管理         |
| 日常使用     | 主邮箱被污染       | 无限前缀随意切换            |

想用什么前缀就用什么前缀，`junk@`、`safe@`、`test@`，无限创建，完全免费。

## 准备工作：Cloudflare 三件套

| 服务            | 角色   | 说明                        |
| :-------------- | :----- | :-------------------------- |
| **D1 数据库**   | 账本   | 记录邮件索引、发件人等      |
| **KV 存储**     | 中转站 | 存储临时配置                |
| **R2 对象存储** | 仓库   | 免费 10GB，存邮件附件和正文 |

三个服务都在 Cloudflare 免费套餐内。

## 部署与环境搭建

### Fork 代码与部署 Worker

CloudMail GitHub：[点击前往](https://github.com/cunzhangcrypto/cloud-mail)

点 Fork 把代码复制到你自己的 GitHub。回到 Cloudflare 控制台，创建 Workers 应用程序，选择连接 GitHub 仓库。在高级设置里把路径设为 `mail-worker` ，点部署。

### 绑定自定义域

别用 CF 默认分配的那串长地址，绑自己的域名。比如 `mail.你的域名.com`。这样你的邮箱访问地址就是 `https://mail.你的域名.com`。

### 配置核心变量

进 Workers 设置 → 变量，添加这三个：

| 变量名   | 类型 | 示例值               | 说明           |
| :------- | :--- | :------------------- | :------------- |
| `domain` | JSON | `["你的域名.com"]`   | 你的根域名     |
| `admin`  | 文本 | `admin@你的域名.com` | 管理员邮箱     |
| `SECRET` | 文本 | 一串复杂字符         | 用于初始化后台 |

`SECRET` 设复杂一点，大小写字母加数字加符号。

## 开通存储与绑定

### 创建 D1 数据库

Cloudflare → Workers 和 Pages → D1 数据库 → 创建数据库，起名 `cloud-mail-db`。记录下数据库 ID。

### 创建 KV 命名空间

进 KV 命名空间 → 创建，起名 `cloud-mail-kv`。

### 创建 R2 存储桶

进 R2 对象存储 → 创建存储桶，起名 `cloud-mail-r2`。

### 绑定到 Worker

进 Worker → 设置 → 变量 → 绑定：

| 绑定项      | 变量名 | 选择的内容         |
| :---------- | :----- | :----------------- |
| D1 数据库   | `db`   | 你创建的 D1 数据库 |
| KV 命名空间 | `kv`   | 你创建的 KV 空间   |
| R2 存储桶   | `R2`   | 你创建的 R2 存储桶 |

变量名大小写都可以，但别填错。

## 开启收信与初始化

### 设置电子邮件路由

进 Cloudflare 域名管理 → 电子邮件路由 → 添加记录并启用。在路由规则中把 Catch-all 地址的操作设为"发送至 Worker"，目标选择你的 `cloud-mail` Worker。

这样无论别人往你域名的什么前缀发信，你都能收到。

### 初始化后台

访问 `https://你的域名/api/init/你的jwt_secret`

看到 `{"success":true}` 就行了。然后直接访问你的域名，注册并登录管理员账号。





## 如果需要添加单邮箱公开访问邮件

把cloudflare worker的代码改成`单邮箱邮件公开访问worker.js`里面的代码

F12打开`控制台`，输入：
```js
// 获取 test@jrafina.eu.cc 的收件箱链接
fetch('/api/mailbox/genToken/test@jrafina.eu.cc', {
  headers: { 'Authorization': localStorage.getItem('token') } // 或者 cookie 里存的 token
}).then(r => r.json()).then(d => console.log(d.data.url))

//注意：test@jrafina.eu.cc修改成你需要的邮箱
```

输出的url就能够查看到该邮箱的邮件



---



## 对接 Resend 实现发信

Cloudflare 默认只能收信。想发信需要 Resend。

去 [Resend 官网](https://resend.com/) 注册账号。添加你的域名，系统会提供 DNS 验证记录，回到 Cloudflare DNS 设置里添加。如果自动没加上就手动加。`_dmarc` 的 TXT 记录（内容 `v=DMARC1; p=none;`）也要添上，不然你的邮件可能被对方当成垃圾邮件。

在 Resend 生成 API Key，回到 CloudMail 后台 → 邮件设置，填入 Resend Token。配置完就能用任意前缀发邮件了。

## 绑定电报机器人（可选）

把 Telegram 机器人挂上，新邮件实时推送。

找 @BotFather 申请机器人 Token。找 @userinfobot 获取你的 Telegram ID。在 CloudMail 后台系统设置中开启 Telegram 推送，填入 Token 和 ID。记得去 Telegram 给你的机器人发个 `/start`，不然它没权限给你弹窗。

配置完成后，每封新邮件都会实时推送到手机。

## 体验

完全免费，无限前缀，数据自持，能收能发，电报秒提醒。就是配置步骤有点多，需要耐心。发信依赖 Resend，但免费额度每月 3000 封，个人用完全够。需要一个自己的域名。

## 一些常见的问题

**这套方案完全免费吗？**
是的。Cloudflare 的 D1、KV、R2、Workers 都在免费套餐内。Resend 每月 3000 封免费邮件。

**能创建多少个邮箱前缀？**
无限个。有人往你域名发信，任何前缀都会自动创建邮箱。

**能发邮件吗？**
能。对接 Resend 就行。

**没有域名可以用吗？**
不行。需要有一个自己的域名。

**电报机器人收不到推送怎么办？**
确认给机器人发过 `/start`，确认 Token 和 ID 填对了，确认 Worker 自定义域地址正确。

**Resend 免费额度够用吗？**
每月 3000 封，个人完全够。超出可以考虑付费。