# 项目长期记忆 · TG 存储池

> 跨会话的稳定事实与约定。日常细节写入 `YYYY-MM-DD.md`。

## 项目身份

- 目标：用 Telegram 当网盘——自建 Bot API（`--local`）+ FastAPI，本地 SQLite 当索引，Telegram 私聊当存储本体。
- 源码目录 `C:\Users\Jrafina\Desktop\tg\`：`server/`（工作副本）→ `deploy/`（打包副本）→ `tgpool-deploy.tar.gz`。
- 服务器 `82.158.224.64`，应用装在 `/opt/tgpool/`。
- Bot：@storage_pool_bot（名称「存储池」），`chat_id 8575978784` 即用户本人私聊——**存储池就是用户与 bot 的私聊**。

## 铁律（改代码前必读）

1. **改完必须同步 `server/` → `deploy/`**，两者 md5 必须一致，再重新打包 tar.gz。
2. **打包顺序**：所有改动做完 → 最后打包 → 再验证。先打包后改脚本会造成"测试假失败"。
3. **长轮询必须单进程**。`tgpool.service` 必须保持 `--workers 1`，否则同一批 update 被多 worker 重复处理、回复重复。
4. 每次部署后校验 `md5sum /opt/tgpool/app/app.py` 与本地一致；原文件留 `app.py.bak-<用途>-<日期>`。
5. `.workbuddy/` 是项目数据目录，**不可删除**。
6. **`tools/rebuild_index.py` 也在部署包里**：改了 journal 事件（比如 2026-09-20 新增的 `ren`）
   必须 `server/tools/` → `deploy/tools/` 一起同步并重新打包，否则线上重放器不认新事件。
7. 覆盖线上 `app.py` 前先 `base64 -w0` 拉下线上版本与本机 `diff`，确认差异只有自己改的那些行。

## 部署包结构

```
tgpool-deploy/
├── deploy.sh          一键部署（含 preflight 文件清单 + step_files 拷贝清单，两处都要加文件）
├── app/{app.py, requirements.txt, static/{index.html, background.jpg}}
├── tools/{rebuild_index.py, backup_index.py, clean_cache.py, show_password.py, test_search_logic.py}
└── tgpool.service
```
文档（README / DEPLOY / DISASTER / REBUILD）**不在包内**，只存在于本机仓库。

打包命令（在临时目录里做，避免把 __pycache__ 和多余目录带进包）：

```bash
D=$(mktemp -d)/tgpool-deploy && mkdir -p "$D"
cp -r deploy/app deploy/tools deploy/deploy.sh deploy/tgpool.service "$D"/
find "$D" -name __pycache__ -type d -exec rm -rf {} +
chmod 755 "$D/deploy.sh"
(cd "$(dirname "$D")" && tar czf tgpool-deploy.tar.gz tgpool-deploy)
```

## 本地工具链

- SSH：`ssh_run.py`（执行命令）/ `ssh_put.py`（二进制安全上传）/ `ssh_upload.py`（文本，会规范化换行）。
  ⚠️ **`PASS` 硬编码在四个文件里**（`ssh_run.py` / `ssh_put.py` / `ssh_upload.py` / `ssh_push.py`），
  服务器换密码就要**四个一起改**（2026-09-20 换过一次，只改一个会漏）。
- Python：`C:\Users\Jrafina\.workbuddy\binaries\python\envs\tg-server\Scripts\python.exe`（含 paramiko；**不含 fastapi**）。
- **测试用 venv：`C:\Users\Jrafina\.workbuddy\binaries\python\envs\tgtest\Scripts\python.exe`**
  （含 fastapi 0.141 / httpx / python-multipart）。**逻辑测试本地就能跑，不必上服务器**：
  `cd <副本>/tools && APP_DIR=<副本> .../envs/tgtest/Scripts/python.exe test_search_logic.py`
  （`APP_DIR` 指到含 app.py 的目录；脚本同目录要有 `rebuild_index.py`，测试会 import 它做重放校验）。
- 服务器 venv：`/opt/tgpool/venv/bin/python`（**Python 3.10.12**，含 fastapi/httpx）。
  ⚠️ 3.10 的 f-string **不能跨行写表达式**（`{...}` 里换行会 SyntaxError）—— 上传到服务器的脚本要注意。
- 真机验证套路（本地测不出 Telegram 行为时用）：`scripts/probe_file_id_type.py`（探针，自己收尾删消息）、
  `scripts/ls_live_check.py`（在服务器上 `import app` 直接调 `_reply_ls`，走真实 API、跑完自删消息；
  ⚠️ **多个路径必须在同一个 `asyncio.run` 里跑完**，否则模块级 httpx client 的 loop 被关掉，
  第二次报 `RuntimeError: Event loop is closed`——是脚本写法问题，不是 app 的 bug）、
  `scripts/web_api_check.py`（打真机网页接口：走 `127.0.0.1:8080` + Basic auth，
  改真实文件名再在 `finally` 里改回，**不增删文件**）。
  跑法：`cd /opt/tgpool && set -a && . ./tgpool.env && set +a && TG_BOT_POLL=0 APP_DIR=/opt/tgpool/app /opt/tgpool/venv/bin/python <脚本>`
  （纯网页接口的脚本不需要 `TG_BOT_POLL=0`）。
- ⚠️ **网页 app 实际监听 `127.0.0.1:8080`**（nginx 8443 反代；`TG_PORT` 默认值是 8000 但线上不是）。
- ⚠️ `ssh_run.py '命令'` **外层一律用单引号**：写成双引号再转义内部 `"` 会在 Git Bash 报
  `unexpected EOF while looking for matching "`。内层要 `curl -u "$U:$P"` 就外层单引号 + 内层双引号。
- ⚠️ 2026-09-14~20：`ssh_run.py` 的旧 root 密码被拒（`AuthenticationException`，站点活着 = 只是凭据不对）。
  2026-09-20 用户给了新密码后恢复；**再遇到就直接问用户，不要猜**。

## 关键实测数字

- 下载 TTFB ≈ 总耗时（`getFile` 阻塞至整份落盘）；预热后 TTFB 0.014s。
- 服务器上行带宽 ~580 KB/s；备份耗时 ≈ 索引体积线性（9000 文件 ~3s）。
- 上传不占服务器磁盘，下载占（`documents/`）；清理用 `clean_cache.py`。

## 聊天命令层（v1.5→v1.9，`app.py` 内）

- 在 Telegram 里可用：`/search`（模糊搜索：文件名或**所在路径**包含即命中，网页与 bot 同一套 `search_files()`）、`/backups`（云端备份包列出/取回，读 remote.jsonl，不进索引）、`/ls`、`/get`、`/stats`、`/help`、
  **`/rm`（删文件/删目录，删目录先弹确认按钮，`-f` 跳过、`-file`/`-dir` 消歧、`#编号` 按 id 删）**、
  **`/move`（移动文件/目录，目标可留空=根目录，路径含空格用引号）**、
  **`/rename`（改名，文件/目录都行，位置不动、零传输；`-file`/`-dir` 消歧，别名 `/ren`）**、
  （网页端也有：文件行/文件夹行的「重命名」按钮，走同一套 journal）
  **`/pass`（聊天里查网页账号密码）**；
  **直接把文件发给 bot 即自动收录**。
- 长轮询 `getUpdates`，不依赖公网回调；`offset` 存 `/opt/tgpool/tg_offset.json`。
- 取回文件用 **`copyMessage`（零带宽）**，失败回退 `sendDocument(file_id)`；
  反向上传**根本不传输字节**（文件已在 Telegram 上），故无大小限制。
- 白名单：`TG_CHAT_ID` + `TG_BOT_ADMIN_IDS`；`TG_BOT_POLL=0` 可整体关闭；`TG_BOT_SHOW_PASS=0` 关 `/pass`。
- 诊断：`GET /api/bot/status`（看 `token_ok` / `last_poll` / `handled` / `getme`）。
- ⚠️ **`rebuild_index.py` 只认 journal、不认 caption**。任何新的入库入口都必须写
  `journal/index.jsonl` 且字段与网页上传一致（含 `path`），目录自动创建要逐级写 `mkdir` 事件。
- ⚠️ **journal 的 `path` 一律是「目录路径」**：`add`/`mv` 记的是**所在目录**（不是文件全路径！），
  `mvd` 记 `{path: 旧目录, new: 新目录}`（**目录改名也用它**，`replay()` 的 mvd 分支按前缀改写，天然支持），
  `ren` 记 `{id, name, path:所在目录}`（文件改名，2026-09-20 新增，`rebuild_index.py` 已支持），
  `rmd`/`del` 见 `rebuild_index.replay()`。
  写错了不会报错，只会静默重建出一棵错目录树（2026-09-14 `/move` 踩过，被测试的「重放==现库」断言抓住）。
- ⚠️ **Telegram 的 file_id 有"底层类型"，同一个相册只能装同族**（2026-09-20 真机实测，探针见
  `scripts/probe_file_id_type.py`）：`sendPhoto` 拒 document/thumbnail 型；`sendMediaGroup` 里
  document 与 photo/video 混 → `MEDIA_INVALID`；原消息虽都带 thumbnail，但 thumbnail 的 file_id
  也不能当 photo 发。池子里文件多为 document 型（网页上传走 sendDocument）——**别再指望"一个相册装下所有媒体"**。
- ⚠️ **`/ls` 只认目录**：`_reply_ls` 用 `_resolve_path()`（只查 `folders` 表），
  拿**文件路径**喂它会回「路径不存在」——路径明明是对的，容易让人以为文件丢了（2026-09-20 用户实际踩到）。
  已修：目录解析失败时再用 `_resolve_node()` 看一眼，是文件就回「这是文件 + /get 该怎么写 + /ls 父目录」。
  `/get` `/rm` `/move` `/rename` 用的是 `_resolve_node()`，**文件路径本来就正常**。
- `/ls` 文字清单**文件行带行首序号**（2026-09-20 加）：`1. 文件名   大小 · #id`，从 1 连续编到 N
  （子目录行**不编号**，进目录用路径）。⚠️ **序号 ≠ `#编号`**：序号只用来数数，取文件必须用行尾 `#id`
  （`/get #13`）。为免混淆，`/ls` 底部提示、`HELP_TEXT`、`/get` 的用法报错都统一写成
  「`/get #编号`（行尾那个 #数字）」。`files_` 是 `ORDER BY id DESC`，所以序号 1 是最新的。
- `/ls` 带缩略图（2026-09-20 加，同日改成"分族"）：文字清单原样先发，然后**视频一族一条、
  图片一族一条**相册（`ALBUM_FAMILY`），每族按 `ALBUM_MAX=10` 切片，**装不下自动分多条**
  （12 张图 = 10+2 两条）。每项说明是「文件名 + #编号」。缩略图复用池子里的 `file_id`，**零带宽**；
  视频项按 `video` 发时 Telegram 自动用原消息的 thumbnail 当预览（= 首帧），**不用下视频、不用 ffmpeg**。
  发法：`_send_album_batch()` 先整片按真身类型（图片 photo / 视频 video），整片被拒就**整片**退回 document
  （`sendDocument` 对所有型都安全）—— 刻意**不拆条**，否则"所有图片一条"就守不住。
  只有 1 个媒体时退回单张 `sendPhoto`/`sendVideo`/`sendDocument`；全失败只记日志、绝不影响 /ls 文字。
  **已删除**旧的多候选分组逻辑 `_album_attempts()` 与 `PHOTO_NAME_RE`（改成"分族"后不再需要）。
- **网页端与 bot 共用同一套 journal**（2026-09-20 加网页端文件改名时定的）：网页 `PATCH /api/files/{id}`
  走 `update_file()`（认 `{name?, folder_id?}`，两者可一起给），改名写 `ren`、换目录写 `mv`；
  文件夹改名走 `PATCH /api/folders/{id}`（`clean_folder_name`）。
  ⚠️ 两个 clean 不一样：`clean_file_name` **不动首尾的点**（`.env` 合法）、空名不兜底；
  `clean_folder_name` 会 `strip(". ")` 且空名兜底成"未命名文件夹"。
- 关键代码位置：`_bot_poll_loop` / `_handle_message` / `_handle_file_message` /
  `_incoming_file` / `_send_file` / `_reply_ls` / `_media_kind` / `_album_chunks` /
  `_send_album_batch` / `_send_media_album` / `_reply_rm` / `_reply_move` / `_reply_rename` /
  `_do_delete_folder` / `_tg_delete_messages` / `_resolve_node` / `_split_args` /
  `clean_file_name` / `update_file`。
- 自测：`APP_DIR=<副本目录> <venv>/python tools/test_search_logic.py`
  （**287 项**，临时库 + 打桩 `_tg`，不联网；含 journal 重放一致性、网页删除/改名接口回归、脚本测试）。
  缩略图相册那部分用 `typed_tg` 打桩 —— 它会按真机规则校验 file_id 的"底层类型"。
- 删 Telegram 消息走 `_tg_delete_messages()`：`deleteMessages` 批量（每批 100 条），
  失败退回逐条 `deleteMessage`；按每行自己的 `chat_id` 分组（跨会话收录的文件原消息不在池子会话里）。
- 找回/重设密码：`tools/show_password.py`（纯标准库，读 `tgpool.env`；`--token` / `--json` / `--reset --yes`）；
  聊天里 `/pass` 是同一信息的出口。

## 踩坑速查

- `Content-Disposition` 塞中文会 500 → 用 ASCII 兜底名 + `filename*=UTF-8''`。
- logrotate 需要显式 `su root root`，否则静默跳过。
- `telegram-bot-api` 的 systemd 单元是 inactive 属**正常**，bot API 实际跑在 docker 容器 `tg-bot-api`（127.0.0.1:8081）。
- 服务端路由是 `/api/list`、`/api/stats`（**不是** `/api/files`）；均需 Basic auth。
- `api.telegram.org` 偶发返回 `401 Unauthorized`（2026-09-11 出现过一次，次日自愈）。
  **单次 401 不足以判定 token 失效**——必须以 `sendMessage`/`getMe` 能成功为准再下结论。
