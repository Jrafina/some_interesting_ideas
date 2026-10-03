# typora-imgbed-uploader

在 [Typora](https://typora.io/) 里写 Markdown 时，粘贴 / 插入的图片**自动上传**到
[CloudFlare ImgBed](https://github.com/MarSeventh/CloudFlare-ImgBed) 图床，文档里留下外链 URL。

**不装 PicGo，不改 Typora 源码，不碰主题，纯标准库 Python。**

> 本项目是第三方工具，与 Typora、CloudFlare ImgBed 均无隶属关系。
> Typora 是商业软件（本工具只调用它公开的 Custom Command 功能，无需修改）；
> 图床项目见 [MarSeventh/CloudFlare-ImgBed](https://github.com/MarSeventh/CloudFlare-ImgBed)。


---

## 为什么不用 PicGo

Typora 1.x 原生支持「上传服务设定 → Custom Command」：它把待上传图片的路径
**追加到你在设置里填的命令后面**执行，并**只读 stdout** 当作要插入的 URL。

所以整件事就是「写一个脚本，把图片 POST 到图床，把返回的 URL 打到 stdout」。
不需要 PicGo、不需要 Electron 打包、不需要改任何编辑器源码。详见
[为什么不用 PicGo](#为什么不用-picgo)。

## 特性

- **零第三方依赖**，只用 Python 标准库，`pip install` 都不用
- **不改 Typora 主题**（上传服务与主题是两套独立设置）
- **指定上传目录**，支持 `note/2026/10` 这种多级路径与日期占位符
- **修掉中文文件名 404**（图床返回的未编码 URL 会让浏览器 404，详见[已知坑](#已知坑)）
- 自带 `doctor.py` **一键体检**：文件、配置、连通性、认证、真上传、外链可下载全查一遍
- 自带 `typora_config.py` **只读查看** Typora 当前实际是什么设置
- 改配置时可用本地mock 图床验证逻辑，不往真图床传垃圾

## 快速开始

### 1. 环境要求

- Typora 1.x（Windows / macOS / Linux）
- Python 3.7+（Windows 安装时勾选「Add Python to PATH」）

### 2. 克隆并配置

```bash
git clone <this-repo> typora-imgbed-uploader
cd typora-imgbed-uploader

# 复制配置模板
cp config.example.json config.json      # Windows: copy config.example.json config.json
```

编辑 `config.json`，至少填两项：

```json
{
  "domain": "https://你的图床域名",
  "token":   "你的 API Token（需 upload 权限）"
}
```

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `domain` | ✅ | 你的图床地址，**只填域名**，不要带 `/upload` 之类的路径 |
| `token` | ✅¹ | API Token，需要 `upload` 权限。后台「系统设置 →安全设置 → API Token 管理」里创建 |
| `authCode` | ✅¹ | 上传认证码。**与 `token` 二选一**，填了它就不需要 `token` |
| `uploadChannel` | | 存储渠道，按你后台实际配的填（见下）。不确定留 `telegram` |
| `uploadFolder` | | 上传目录，支持日期占位符。留空 = 全部放根目录 |
| `serverCompress` | | 仅 `telegram` 生效，服务端压缩图片省空间 |
| `timeout` | | 单次上传超时秒数，默认 90 |

> ¹ 图床没开认证的话，`token` 和 `authCode` 都可以留空。

> ⚠️ **`https://cfbed.sanyue.de` 是项目的官方文档站，不是图床实例。**
> 那个域名下 `/upload`、`/file/` 全是 404。填错会直接失败。

### 3. 体检

```bash
python doctor.py
```

全绿就说明环境没问题。它会真传一张测试图并验证外链能下载。

### 4. 接到 Typora

```bash
python install.py
```

它会打印一行命令，复制到 Typora：

> 文件 → 偏好设置 → 图像 → **插入图片时** 选「上传图片」→ **上传服务** 选 `Custom Command` → 粘贴 → 点「验证图片上传选项」

生成的命令长这样（**路径务必带双引号**，本机路径有空格时不加会散）：

```
"<python.exe绝对路径>" "<仓库路径>/upload.py"
```

命令末尾**不要**自己加参数 —— Typora 会自动把图片路径追加到最后。

### 5. 确认生效

```bash
python typora_config.py
```

只读显示 Typora 当前实际设置：上传服务选了哪项、命令里两个路径还在不在、主题有没有被影响。

之后在 Typora 里粘贴截图，就会变成：

```markdown
![](https://你的图床域名/file/1791034677161_xxx.png)
```

## 指定上传文件夹

改 `config.json` 的 `uploadFolder`：

```json
"uploadFolder": "note/{yyyy}/{mm}"
```

| 占位符 | 含义 |
| --- | --- |
| `{yyyy}` | 四位年，如 `2026` |
| `{yy}` | 两位年，如 `26` |
| `{mm}` | 两位月，如 `10` |
| `{dd}` | 两位日 |
| `{yyyymm}` | 六位年月，如 `202610` |

所以 `"note/{yyyy}/{mm}"` 在 2026 年 10 月上传就落到 `note/2026/10/`。

也可以临时指定，优先级从高到低：

```bash
python upload.py --folder "临时/草稿" 图.png   # 1. 命令行
set IMGBED_FOLDER=env/目录                     # 2. 环境变量
# 3. 都不给时用 config.json 里的 uploadFolder
```

中文目录、多级目录、含点的目录名（`v1.0`）都支持。

> **为什么没有「按文档名自动归档」？**
> Typora 会先把粘贴的图片存到 `%LOCALAPPDATA%\Temp\typora-user-images\<日期>\`，
> 脚本拿到的路径属于这个暂存目录，取不到你正在编辑的文档名 —— 原理上就做不到。
> 要按文档归类请手动改 `uploadFolder`。

## 批量处理已有文档

Typora 里选中图片 → `格式 → 图像 → 上传所有本地图片`，会逐个上传并把本地路径替换成 URL。
**建议先存一份文档副本。**

## 文件说明

| 文件 | 必需 | 作用 |
| --- | --- | --- |
| `upload.py` | ✅ | 上传桥，核心。Typora 调它 |
| `config.json` | ✅ | 你的配置（**含凭据，已 gitignore**） |
| `config.example.json` | | 配置模板，含逐项说明 |
| `install.py` | | 部署入口：检查配置 + 打印要粘的命令 + 语法自检 |
| `doctor.py` | | 一键体检（含真实上传与中文文件名验证） |
| `typora_config.py` | | 只读查看 Typora 当前设置 |
| `_test_urlencode.py` | | 测试：URL 编码边界 |
| `_test_args.py` | | 测试：参数解析边界 |
| `_test_typora_config.py` | | 测试：Typora 配置解析 |
| `_mock_server.py` | | 开发用：本地假图床 |

> **只有 `upload.py` + `config.json` 是运行时必需的**，其余都是辅助工具。
> 想知道自己的安装是否正常，跑 `python doctor.py` 即可。
> 下划线开头的是开发/测试文件，不影响使用。

## 常用命令

```bash
python install.py                    # 部署 / 重装：检查 + 打印命令
python doctor.py                     # 体检：全链路自检（会真传 2 张测试图）
python doctor.py --no-upload         # 只看静态配置，不真传
python typora_config.py              # 看 Typora 实际设置（只读）
python upload.py 图.png              # 手动上传一张
python upload.py --folder note 图.png # 手动上传到指定目录

python _test_urlencode.py            # 改过 upload.py 后建议跑
python _test_args.py
python _test_typora_config.py
```

## 已知坑

### 图片 404，但「验证上传」显示成功

**这是最容易撞的一个。** 「上传成功」≠「图片能打开」，前者只证明文件存进图床了。

图床返回的 `src` 里如果带中文 / 全角 / emoji，Typora 会**原样**写进 Markdown，
而浏览器请求这段路径时**不会**替你做百分号编码（这些字符不是合法 URL 字符），
文件名对不上 → 404。Typora 的验证按钮只看上传返回值、不去 GET 那个 URL，
所以能躲过这个坑。

本工具已在 `upload.py` 里对 URL 做百分号编码，修掉了这个问题。
实测对照（同一张图，只改文件名）：

| 文件名 | 修复前 | 修复后 |
| --- | --- | --- |
| `ascii.png` | 200 | 200 |
| `测试中文.png` | 404 | 200 |
| `fullwidth（1）.png` | 404 | 200 |
| `emoji💩.png` | 404 | 200 |
| `2026-4-4（1）💩1💩.jpg` | 404 | 200 |

### 排错速查

| 现象 | 原因 |
| --- | --- |
| Typora 里完全没反应 | 命令框路径没加双引号；或python 路径变了（跑 `install.py` 重新生成） |
| `上传失败 HTTP 401` | token 填错、复制时带了空格/换行，或被后台吊销 |
| `上传失败 HTTP 403` | 认证过了但没权限，或图床开了白名单模式 / 访问域名限制 |
| `上传失败：连不上图床` | 域名写错，或本机网络问题 |
| `上传失败：响应不是 JSON` | 域名指向了文档站/别的服务，不是图床实例 |
| 报「渠道不可用」 | `uploadChannel` 填的不是后台实际在用的渠道 |
| 上传成功但插进文档成了文字 | stdout 混进了日志 —— 检查有没有 `print()` 打到了 stdout |
| 图片能显示但 Markdown 里是本地路径 | 「插入图片时」没选「上传图片」 |

调试时看 stderr 里的 `→ POST ...` 和 `← publicUrl: ...` 两行，
能直接看出请求打到了哪、返回了什么。`→ POST` 出现说明 Typora 调用成功了，
问题一定在服务端响应那一侧。

## 为什么不用 PicGo

评估过两个方案（结论：不选第二个）：

| 方案 | 结论 |
| --- | --- |
| **Typora Custom Command** ✅ | Typora 1.x 原生支持，填一条命令即可。不装 PicGo、不改源码、不动主题 |
| 换开源编辑器改源码 ❌ | Typora 本体闭源改不了；MarkText / Zettlr 的图片上传插件生态差，基本都绑 PicGo；自己 build 签名打包 Electron，上游一更新就废 |

还有一个常见误解：**Typora 的「上传服务设定」和「主题」是两套完全独立的设置**，
选上传服务**不会**动主题。

## 安全说明

- `config.json` 里有明文 token，已在 `.gitignore` 里，**请勿提交或公开分享**。
  泄露了就回图床后台吊销重建。
- 建议只给 token 最小权限（本工具只需 `upload`）。批量删图/查图另建带
  `list` / `delete` 权限的 token，别给上传用的加权。

## 图床 API 速查

本工具对接的接口（[完整文档](https://cfbed.sanyue.de/api/upload.html)）：

- 端点：`POST {domain}/upload`，`multipart/form-data`，文件字段名固定 `file`
- 认证二选一：query `?authCode=xxx`，或 header `Authorization: Bearer {token}`
- 响应：`[{"src": "/file/xxx.png"}]`
  `publicUrl` **只有**在后台设了「默认 URL 前缀」时才有；没设就返回 `src`，
  需要客户端补域名（本工具两种都处理）
- 可用渠道：`telegram` / `cfr2` / `s3` / `discord` / `huggingface` / `webdav`

## License

[MIT](LICENSE)
