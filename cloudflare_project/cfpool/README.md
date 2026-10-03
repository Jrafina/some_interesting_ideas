# cf部署telegram bot做网盘

## 一、部署步骤

### 1. 建 D1 数据库  -------  命名：`cfpool`，绑定：`DB`

### 2. 建worker，复制粘贴`worker.js`代码

### 3. 四个变量

|       命名        |  值  |        备注         |
| :---------------: | :--: | :-----------------: |
|   TG_BOT_TOKEN    |      |      （密钥）       |
|   TG_AUTH_PASS    |      |  web端密码（密钥）  |
| TG_WEBHOOK_SECRET |      | webhook密钥（密钥） |
|    TG_CHAT_ID     |      |      （密钥）       |
|   TG_AUTH_USER    |      |      web端用户      |

- **如何获取chat ID?**

  - 如果挂了webhook，请先摘掉

  ```
  https://api.telegram.org/bot<你的BOT_TOKEN>/deleteWebhook
  ```

  - 在tg bot上面随便发一个消息，如：hi
  - 搜索栏输入链接

  ```
  https://api.telegram.org/bot<bot token>/getUpdates
  ```

  - 输出

  ```
  {"ok":true,"result":[{"update_id":占位,
  "message":{"message_id":24,"from":{"id":占位,"is_bot":false,"first_name":"占位","username":"占位","language_code":"zh-hans"},"chat":{"id":就是这个,"first_name":"占位","username":"占位","type":"private"},"date":占位,"text":"hi"}}]}
  ```

  



### 4. D1 建表

```sql
-- TG 存储池 · Cloudflare D1 表结构

-- ============ 池子索引============

CREATE TABLE IF NOT EXISTS files (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT NOT NULL,
    size        INTEGER NOT NULL DEFAULT 0,
    mime        TEXT,
    file_id     TEXT NOT NULL,
    file_unique TEXT,
    message_id  INTEGER,
    chat_id     TEXT,
    folder_id   INTEGER,
    created_at  REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS folders (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT NOT NULL,
    parent_id   INTEGER,
    created_at  REAL NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_files_folder   ON files(folder_id);
CREATE INDEX IF NOT EXISTS idx_folders_parent ON folders(parent_id);

-- 收录去重：同一个文件（file_unique_id 相同）只进池子一次。
-- SQLite 的 UNIQUE 允许多个 NULL，所以 file_unique 缺失的老数据不会互相冲突。
CREATE UNIQUE INDEX IF NOT EXISTS idx_files_unique ON files(file_unique);

-- ============ Workers 无状态所需的三张辅助表 ============

-- 1) webhook 幂等：Telegram 收不到 200 就会重发同一个 update。
--    先抢占 update_id，抢不到就说明已经处理过，直接返回 200。
CREATE TABLE IF NOT EXISTS seen_updates (
    update_id INTEGER PRIMARY KEY,
    ts        REAL NOT NULL
);

-- 2) /rm 删目录的待确认操作。
--    原版把它放在进程内存里（RM_PENDING），Workers 没有这个前提，
--    所以落到 D1；token 一次性，用完即删。
CREATE TABLE IF NOT EXISTS pending_rm (
    token     TEXT PRIMARY KEY,
    path      TEXT NOT NULL,
    folder_id INTEGER,
    chat_id   TEXT NOT NULL,
    files     INTEGER NOT NULL DEFAULT 0,
    folders   INTEGER NOT NULL DEFAULT 0,
    bytes     INTEGER NOT NULL DEFAULT 0,
    ts        REAL NOT NULL
);

-- 3) 审计事件流
--    注意：D1 自带 Time Travel（免费版 7 天 / 付费版 30 天），
--    灾备的第一道防线是它；这张表是第二道，也是可读的变更历史。
CREATE TABLE IF NOT EXISTS events (
    seq     INTEGER PRIMARY KEY AUTOINCREMENT,
    t       TEXT NOT NULL,
    payload TEXT NOT NULL,
    ts      REAL NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_events_ts ON events(ts);

```

> **这一版起，上面这段 SQL 不是必须的手工步骤了。** Worker 每个 isolate 第一次收到请求时会惰性自迁移
> （建 `meta` / `counters` / `pending_sr`，补 `folders.path` / `files.full_key` 和索引，并回填历史数据），
> 成功后在 `meta.schema_v` 打标，之后只在冷启动时花一条极便宜的查询短路掉。
> 老库直接换成新版 Worker 就能用，**不用手动 ALTER TABLE**。
> 想手动跑一遍也可以，把下面这段贴进 D1 控制台即可（幂等，重复跑没事）：
>
> ```sql
> CREATE TABLE IF NOT EXISTS meta(k TEXT PRIMARY KEY, v TEXT);
> CREATE TABLE IF NOT EXISTS counters(k TEXT PRIMARY KEY, v INTEGER NOT NULL DEFAULT 0);
> CREATE TABLE IF NOT EXISTS pending_sr(token TEXT PRIMARY KEY, q TEXT NOT NULL, total INTEGER, ts REAL NOT NULL);
> ALTER TABLE folders ADD COLUMN path TEXT;      -- 已存在会报错，忽略即可
> ALTER TABLE files   ADD COLUMN full_key TEXT;  -- 已存在会报错，忽略即可
> CREATE INDEX IF NOT EXISTS idx_files_folder_id   ON files(folder_id, id DESC);
> CREATE INDEX IF NOT EXISTS idx_folders_parent_name ON folders(parent_id, name);
> CREATE INDEX IF NOT EXISTS idx_folders_path      ON folders(path);
> CREATE INDEX IF NOT EXISTS idx_files_full_key    ON files(full_key);
> INSERT INTO meta(k,v) VALUES ('schema_v','3') ON CONFLICT(k) DO UPDATE SET v='3';
> -- 然后调一次 POST /api/admin/recount 把计数器对齐
> ```

### 5.设 webhook

打开命令行

```bash
curl -4  http://127.0.0.1:7897 \
  "https://api.telegram.org/bot<TOKEN>/setWebhook" \
  -d "url=https://cfpool.<你的子域>.workers.dev/tg/<SECRET>" \
  -d "secret_token=<SECRET>" \
  -d 'allowed_updates=["message","callback_query"]' \
  -d "drop_pending_updates=true"
```

期望返回 `{"ok":true,"result":true,"description":"Webhook was set"}`。

查看是否生效：

```bash
curl -4 -x http://127.0.0.1:7897 "https://api.telegram.org/bot<TOKEN>/getWebhookInfo"
```

看 `url` 对不对、`pending_update_count` 是否为 0、**`last_error_message` 是否为空**。
有 `last_error_message` 就说明 Telegram 打你 Worker 打不通（域名拼错 / 没部署 / Worker 报错）。



## 二、迁移索引怎么办

### 1. 先摘掉webhook

搜索栏输入：

```
https://api.telegram.org/bot<TOKEN>/deleteWebhook
```

看到 `"ok":true` 就行。不然迁移过程中新实例会边导边写。

### 2. 旧账号：把数据读出来

在旧账号的D1数据库控制台中输入：

```sql
SELECT * FROM folders;
SELECT * FROM files;
```

### 3. 生成可直接粘贴的 INSERT（关键一步）

回**旧**控制台，运行下面这两段 —— 它们不查数据，而是**直接吐出 INSERT 语句**，省得你手写引号：

```sql
SELECT 'INSERT INTO folders(id,name,parent_id,created_at) VALUES (' || id || ',''' || replace(name,'''','''''') || ''',' || COALESCE(parent_id,'NULL') || ',' || created_at || ');' FROM folders;



SELECT 'INSERT INTO files(id,name,size,mime,file_id,file_unique,message_id,chat_id,folder_id,created_at) VALUES (' || id || ',''' || replace(name,'''','''''') || ''',' || size || ',''' || replace(COALESCE(mime,''),'''','''''') || ''',''' || replace(file_id,'''','''''') || ''',''' || replace(COALESCE(file_unique,''),'''','''''') || ''',' || COALESCE(message_id,'NULL') || ',''' || replace(COALESCE(chat_id,''),'''','''''') || ''',' || COALESCE(folder_id,'NULL') || ',' || created_at || ');' FROM files;

```

输出：

![](https://img.1795857.xyz/file/cfpool_readme/tgp.png)

```sql
INSERT INTO folders(id,name,parent_id,created_at) VALUES (1,占位,NULL,占位);

INSERT INTO files(id,name,size,mime,file_id,file_unique,message_id,chat_id,folder_id,created_at) VALUES (占位);
```



### 4. 导入索引

把上述输出，在新账号D1控制台中输入

### 5. 重新挂载webhook

### 6. 验证

- 新控制台：`SELECT COUNT(*) FROM files;`
- 浏览器登录 `/api/stats`（用新实例自己的密码，不是旧的那个）
- Telegram 里发 `/ls`

---

## 三、v10 扩容改造（本版单文件已包含）

`001_worker_添加背景图.js` 仍是**单个文件**，可直接粘贴进 Worker，不需要构建。
这一版围绕 Free 档的 **10ms CPU / 请求**上限重做。

### 1. 翻页

| 位置 | 用法 |
| --- | --- |
| 网页端 | 列表底部有「首页 / 上一页 / 下一页 / 末页 + 跳页 + 每页条数」（默认 100，上限 500）；搜索结果同样分页 |
| Telegram | `/ls [路径] [#页码]`、`/search 关键词 [#页码]`，每页 20 条，带上一页 / 下一页按钮 |

翻页走真实 SQL 分页（`LIMIT/OFFSET`），不是把全表读进 JS 再切片。

### 2. 额度优化：改了什么 + 实测（20,000 文件 / 5,000 目录）

| 操作 | 旧 | 新 | 提速 |
| --- | --- | --- | --- |
| `/api/stats` | 5.3ms / 3 条 SQL | 1.4ms / 1 条 | 3.8× |
| `/api/tree` | 153ms | 18.6ms | 8.2× |
| `/api/list` 根目录 | 32ms | 1.7ms | 18.8× |
| `/api/list` 进目录第 2 页 | 38ms | 3.4ms | 11.2× |
| `/api/list` 搜索（命中多） | 125ms | 2.7ms | 45.9× |
| `/api/list` 搜索（无命中） | 107ms | 7.8ms | 13.8× |

根因与做法：

1. **物化路径 `folders.path`** —— 旧实现每次请求都全表扫 folders、在 JS 里搭路径表；目录从 1k 涨到 221k 时单次 CPU 从 0.77ms 涨到 308ms，这就是「点开文件夹就 1102」的来源。现在按 `path` 直查，子树用递归 CTE 一条语句搞定。
2. **计数器表 `counters`** —— `/api/stats` 不再 `COUNT(*)` / `SUM(size)` 全表扫。
3. **搜索键 `files.full_key`** = `lower(路径)/lower(文件名)`，用 `instr(full_key, ?) > 0` 单列匹配。比 `LIKE` + 每行 `lower()` 快得多（实测最坏 1.73ms vs 6.66ms），也比 FTS5 trigram 合适 —— trigram 中文要 3 个字起才命中，搜 2 个字直接空。
4. **列表 / 搜索走 SQL 分页**，不再把整表读进 JS。
5. **`/api/tree` 从 O(F²) 降到 O(F)** —— 旧实现每层 `filter()` 全表扫，4047 个目录就超 10ms；现在按 parent 分桶一次组装。
6. **目录删除 / 移动改批量 SQL**，不再每行一条语句。
7. **改名的搜索键维护** —— 文件改名、目录改名/移动后，`full_key` 会跟着更新（漏掉就会出现「改名后搜不到」）。
8. **清掉两个重复索引** —— `idx_files_unique2` 与 `idx_files_unique` 同列（后者还带 UNIQUE 约束，前者纯属白占）；`idx_files_folder` 被 `(folder_id, id DESC)` 最左前缀完全覆盖。实测每文件省 24 B 存储，每次收录少写 2 行索引（写入额度 +25%）。迁移会自动 DROP，已部署的库升级后自动生效。
9. **目录树改成按需拉取** —— 旧实现每次点开目录都重拉整棵目录树（等于每次点击扫 F 行，F = 目录数）。现在只有「首次加载 / 手动刷新 / 改过目录结构」才拉。已用真跑页面脚本的测试验证（`.workbuddy/harness/test-ui.mjs`）。

### 3. 导出改成浏览器分块

「导出索引」按钮不再一次性下载整包，而是浏览器按 `mode=files|folders|events` + `after/limit` 一块块拉（每块 1000 行），拼好再落盘。

原因：整包导出实测 2 万行要 **45~50ms 纯 JS CPU** —— 这是数据量本身的开销，换什么序列化方式都差不多 —— 必然撞 Free 档 10ms 上限 → 1102。分块后单请求 ≈ 1.8ms。

顺手加了守门：索引超过 3000 行时，整包导出直接返回 **413 + 说明**，而不是让你看到一个没头没尾的 1102。确实要整包（Paid 档）就加 `?force=1`。

```
GET /api/export?mode=meta                                  # 先看条数
GET /api/export?mode=files&after=<id>&limit=1000           # → {rows, next_after, done}
GET /api/export?mode=folders&after=<id>&limit=1000
GET /api/export?mode=events&after=<seq>&limit=1000
```

### 4. 新增接口

| 接口 | 作用 |
| --- | --- |
| `POST /api/admin/recount` | 用真实行数重算计数器。手动改过库、或怀疑计数漂了时调一次 |
| `POST /api/batch-delete` | 批量删除（详见第五章）。body：`{items:[{kind,id}], force?}` |
| `POST /api/batch-move` | 批量移动（详见第五章）。body：`{items:[{kind,id}], target:"/路径" 或 target_id}` |

### 5. 注意

- 这批改动是**直接改在单文件产物上**的。如果仓库里还有 `src/*.ts` 源工程，下次重跑构建会覆盖掉，需要把同样的改动合并回源。
- 迁移在首个请求时自动完成；库很大时这一次会慢一点（几千目录量级仍在百毫秒内），之后恢复。

---

## 四、能存多少个文件（改造后实测）

先记住 Free 档的几个数（官方口径）：

| 额度 | Free 档 |
| --- | --- |
| Workers 请求 | 100,000 / 天 |
| Workers CPU | 10 ms / 请求 |
| **单个 D1 数据库大小** | **500 MB** |
| D1 存储（账号总量） | 5 GB |
| D1 行读取 | **5,000,000 / 天** |
| D1 行写入 | **100,000 / 天** |
| D1 查询数 | 50 / 每个 Worker 请求 |
| D1 单条 SQL 时长 | 30 s |

> ⚠ 注意区分「单库上限」和「账号总量」：本项目只用**一个**数据库，所以吃的是 **500 MB** 那一档，不是 5 GB。
>
> 关键：D1 的「行读取」按**扫描**行数计费，不是返回行数。官方原话：「A query that filters on an unindexed column may return fewer rows to your Worker, but is still required to read (scan) more rows.」

### 1. 存储：约 200 万个文件

实测 `files` 表 + 它的 3 个索引：2 万行时 239 字节/行，10 万行时 243 字节/行（基本线性）。加上目录（126 字节/个）和事件：

**500 MB ÷ 243 B ≈ 216 万个文件。**

（文件本体在 Telegram 上，D1 里只有索引，所以「能存多少」只受索引大小约束。）

### 2. 行写入：每天最多约 1.25 万次收录

每次收录一个文件 ≈ **8 行写入**（files 1 + 3 个索引 + counters 2 + events 1 + events 索引 1）。100,000 ÷ 8 = **12,500 个/天**。（清理重复索引前是 10 行 → 1 万/天。）

### 3. 行读取：真正的天花板，取决于你搜不搜

每次操作的扫描行数（查询计划实测：搜索是 `SCAN files`，目录树是 `SCAN folders`）：

| 操作 | 扫描行数 |
| --- | --- |
| 搜索（10 分钟内重复同一关键词） | 几百行（命中总数已缓存） |
| 搜索（首次，且**有结果**） | ≈ **N**（命中总数那次 `COUNT(*)` 必须全表扫） |
| 搜索（首次，且**没结果**） | ≈ **3N**（探测 + COUNT + 取页面，三遍都没有早停机会） |
| 目录树重拉 | F（目录数） |
| 打开 / 翻目录一次 | 该目录所有直接子目录的文件数之和 |

所以在「每天首次搜索 Q 次、其中 miss 比例 m」的用法下：

```
5,000,000 ≥ Q × (1 + 2m) × N  +  打开目录消耗  +  F × 目录树重拉次数
```

反推的上限（目录数 3000、每天翻目录 200 次各扫 2500 行、目录树 5 次）：

| 每天首次搜索 | 最多能存 |
| --- | --- |
| 0 次 | ≈ **216 万**（撞 500 MB 单库上限） |
| 10 次 | ≈ **22 万** |
| 30 次 | ≈ **7.5 万** |
| 100 次 | ≈ **2.2 万** |
| 300 次 | ≈ **7500** |

一句话：**「能存多少」不是存储决定的，是你每天搜几次决定的** —— 只有完全不搜索时，才会撞到 500 MB / 216 万个的存储线。

### 4. 还剩两个跟存储无关的规模天花板

- **搜索会随文件数变慢**：实测未命中搜索 2 万文件 6.5ms、10 万文件 25ms（本机 SQLite 口径）。这个扫描在 D1 侧、不计 Worker CPU，但你能直接感觉到变慢，D1 单条查询也会越来越吃力。
- **目录树仍然随目录数变慢**：实测 5005 个目录 13.7ms，而且这部分是**真·Worker CPU**（组装树在 JS 里做）。几千目录内安全，上万要小心 1102。

> 交互版：仓库根目录的 `额度上限_改造后.html`，可以按自己的使用强度反推上限。

### 5. 单一操作最多能执行多少次（10,000 个文件）

假设 10,000 个文件，两种目录形态各算一遍。数字由 `.workbuddy/harness/probe-ops.mjs` 真跑 Worker + 记录每条 SQL 折算得出（可复现：`node .workbuddy/harness/probe-ops.mjs --layout=deep`）。

**形态 A · 三层**（根 → 10 个一级 → 100 个二级，每二级 100 个文件；共 110 目录）

| 操作 | 行读取 | 行写入 | 每天最多 | 先撞哪个 |
| --- | --- | --- | --- | --- |
| 进网页（首屏 3 个请求） | 224 | 0 | **22,321** | 行读取 |
| 打开一个一级目录 | 1,017 | 0 | **4,916** | 行读取 |
| 网页搜索（首次·有命中） | 10,215 | 1 | **489** | 行读取 |
| 网页搜索（首次·无命中） | 30,001 | 1 | **166** | 行读取 |
| 网页搜索（同一关键词 10 分钟内重复） | 208 | 0 | **24,038** | 行读取 |
| 网页改名（纯 API） | 106 | 208 | **480** | 行写入 |
| 网页改名（点一次，含自动刷新） | 1,237 | 208 | **480** | 行写入 |
| Telegram `/ls` | 110 | 1 | **45,454** | 行读取 |
| Telegram `/ls <路径>` | 1,013 | 1 | **4,935** | 行读取 |
| Telegram `/search`（首次） | 10,053 | 2 | **497** | 行读取 |
| Telegram `/search`（10 分钟内重复） | 46 | 1 | **100,000** | 请求数 |

**形态 B · 扁平**（100 个目录都挂在根下，每个 100 个文件；共 100 目录）

| 操作 | 行读取 | 每天最多 | 与形态 A 的差别 |
| --- | --- | --- | --- |
| 进网页（首屏 3 个请求） | **10,204** | **490** | 差 **45 倍** —— 根目录那一层要统计每个子目录的文件数 |
| 打开一个目录 | 207 | 24,154 | 反而更便宜 |
| Telegram `/ls` | **10,100** | **495** | 同上，差 20 倍 |
| Telegram `/ls <路径>` | 2 | 100,000（撞请求数） | 叶子目录没有子目录要统计 |
| 网页搜索 / `Telegram /search` / 改名 | 与形态 A 相同 | — | 这几项与目录形态无关 |

**结论：**
1. **最贵的是「搜索」**：首次搜索固定要付一次全表扫（命中 ≈ N，未命中 ≈ 3N）。10,000 文件下第一次搜只能做 166~489 次/天；但同一关键词 10 分钟内重复搜降到 208 行，**24,038 次/天**——把搜索的重复率提上去就能省很多。
2. **第二贵的是「进网页 / `/ls`」在扁平结构下的那一下**：根目录下的每个子目录都要 `COUNT` 一次它的直接文件数，扁平结构会让「打开首页」扫过接近全部文件的目录项。目录分三层就几乎免费。
3. **「改名」卡在行写入（480 次/天）**：改一个目录名要级联刷新子树里所有文件的 `full_key`（写 208 行 = 表行 + 索引）。**改名是这几项里唯一有写放大代价的**，别把大目录当草稿本反复改名。
4. **Telegram 操作每次至少写 1 行**（`seen_updates` 幂等表），所以 bot 操作天然封顶 100,000 次/天。
5. 这几项在 10,000 文件规模下 **CPU 都不是问题**（目录树只有 110 行要组装）。
---

## 五、批量删除 / 批量移动（v13 新增）

### 1. 网页端

文件列表最左边多了一列复选框：

- 表头的框 = **全选本页**（只影响当前这一页）
- 勾选后，上方出现蓝色操作条：`已选 N 项` + **移动选中** / **删除选中** / **清空选择**
- 选择是**跨页、跨目录累积**的（这正是批量条存在的意义）——可以在 `/工作` 勾 3 个、翻到 `/归档` 再勾 2 个，最后一次提交

### 2. Telegram 端

```text
/rm 路径…            删除多个目标（最多 10 个）
                     例：/rm /工作/2026 /a/b.txt #13
/move -to 目标 源…   一次移多个（最多 10 项）
                     例：/move -to /归档 /a /b/c #13
```

- `/rm` 的判定口径和单条接口完全一致：**只删文件（或空目录）→ 直接执行**；只要选中项里有「非空目录」→ 弹一次 `确认删除` 按钮，按钮带 token，10 分钟内有效，点过一次即作废（重复点不会重复执行）。
- `/move` 不带 `-to` 时，**最后一个参数就是目标**，所以老的 `/move 源 目标` 一字不用改；单源时的回复格式也没变。
- 路径里有空格要用引号包起来：`/rm "/我的 报告"`。多目标写法下，空格分隔的就是两个不同目标。

### 3. 为什么新增了 `POST /api/batch-delete` / `POST /api/batch-move`

不能靠前端循环调单条接口：删 200 个文件就是 200 次 Worker 请求，慢且难看。批量接口内部全部走 `IN (...)`，一次调用固定几条 SQL：

| 场景 | 服务端查询条数（实测） |
| --- | --- |
| 删 200 个文件 | **12** 条（取行 + 删除都按每 60 个 id 一条 SQL） |
| 删 ≤20 个目录（含子树） | **12** 条（子树谓词按每 20 个根合并成一条 SQL） |
| 移 200 个文件到同一目录 | **16** 条（含 4 条 `UPDATE … WHERE id IN (…)`） |
| 移 ≤10 个目录 | **36** 条（每个目录 3 条：自身 + 子树 path + 子树 full_key） |

对比：前端循环调单条接口删 200 个文件 = **200 次 Worker 请求 / 1200 条 SQL**。

Free 档每次 Worker 调用只有 **50 条 D1 查询**，所以服务端对目录数量卡了上限（删除 20 / 移动 10），前端按上限自动切片、逐批提交并显示进度。文件侧一条 SQL 最多绑 60 个 id，200 个文件也不会撞绑定参数上限。

关键实现点：

- **批量移动文件用一条 SQL 搞定**：`UPDATE files SET folder_id = ?, full_key = ? || lower(name) WHERE id IN (…)`。`lower()` 在 SQLite 里只处理 ASCII，和 JS 侧 `asciiLower()` 口径完全一致，所以前缀用 `?` 绑一次、文件名交给 SQL 降大小写，不用每行算一次。测试里专门用大写文件名（`A2-Part.TXT` → `/批量测试/c/a2-part.txt`）钉住这个口径。
- **「目录 + 目录里的文件」一起选中不会重复计数**：先按物化路径把选中目录去重成「最外层根」，再算一次子树文件集合；显式选中的文件如果在子树里就直接剔除，避免计数器重复扣、Telegram 消息重复删。
- **先算后写**：`planBatchDelete()` 负责「算一遍」（谁会被删、多少字节），确认弹窗和执行都调它，两边数字必然一致；`applyBatchDelete()` 才落库。

### 4. 顺手修掉的一个既有 bug：改名/移动会把子树 path 拼坏

`repathSubtree()` 原来是递归 CTE + `path = newPath || substr(path, length(oldPath)+1)`。但所有调用方都是**先把根目录自己的 path 改成 newPath，再调它**，于是根目录会算成：

```text
newPath || substr(newPath, length(oldPath) + 1)
```

只有新旧路径长度完全一样时才凑巧等于 `newPath`。长度不同（绝大多数情况）就会拼出尾巴：

| 操作 | 老实现结果 |
| --- | --- |
| `/工作/A` 移到 `/归档/sub` | `/归档/sub/A` + `ub/A` = **`/归档/sub/Aub/A`** |
| 目录改名 `A` → `ABCDE` | **`/工作/ABCDEBCDE`** |

也就是说：**只要新名字长度和旧名字不一样，被改名/移动的目录自身的 path 就会坏掉**（后代反而没事，它们走的是 `substr`）。之前没被发现，是因为老用例里移动前后的路径长度恰好相同。

现在改成显式给根目录赋 `newPath`，后代才走 `substr`，并用 `id = ? OR instr(path, ?) = 1` 定位（**不是 `LIKE`**，原因见下一节）：

```sql
UPDATE folders SET path = CASE WHEN id = ? THEN ? ELSE ? || substr(path, length(?) + 1) END
 WHERE id = ? OR instr(path, ?) = 1
```

和调用顺序无关，顺带还省掉了一次递归 CTE。

**存量数据自查**：如果之前用旧版本改过目录名、或把目录移到过不同深度的地方，库里可能已经躺着坏掉的 `path`。自查 SQL 见第 5 节 ①（这条和下面那个 LIKE bug 造成的坏法长得一样，一次查完就行）。

一条都查不出来 = 你的库是干净的（以后也不会再坏了）。查出来有货：这些目录按 path 查是查不到的（`/ls`、面包屑、`/api/move` 的路径解析都会受影响），但它的 id / parent_id 是好的，可以用 `want` 列回写修复。

### 5. 又修一个（模糊测试挖出来的）：子树前缀匹配踩了 SQLite 的 `LIKE` 大小写不敏感

上一节修完之后，我又写了一个**不变量模糊测试**（`.workbuddy/harness/probe-invariants.mjs`）来兜底：真跑 Worker，随机做 400～1200 次「收录 / 建目录 / 改名 / 移动 / 批量移动 / 批量删除 / `/rm` 多目标 / `/move` 多源」，**每做完一步就校验四条硬不变量**：

1. 每个目录 `path === joinPath(父目录 path, name)`
2. 没有两个目录 path 相同；文件的 `folder_id` 必须指向存在的目录
3. 每个文件 `full_key === asciiLower(joinPath(目录 path, name))`
4. `counters` 的 `files/bytes/folders/events` === 真实 `COUNT` / `SUM`

**seed=1 第 372 步就炸了**：

```text
第 372 步 [批量移动目录] 批移目录 175,153 → /ABC (200 2)
✗ 目录 #146「Tmp」path="/ABC/abc/Tmp"，按父子关系应为 "/ABC/Tmp"
✗ 文件 #110「Tmp.zip」full_key="/abc/tmp/tmp.zip"，应为 "/abc/abc/tmp/tmp.zip"
```

出错前 / 出错后一对比就清楚了：第 372 步移动的是 `#153「abc」`（旧路径 `/abc`），但**完全不在 `/abc/` 下的 `#146「Tmp」`（父是 `/ABC`）也被改了路径**。

根因是 **SQLite 的 `LIKE` 对 ASCII 默认大小写不敏感**：

```sql
SELECT '/ABC/Tmp' LIKE '/abc/%';   -- 1  ← 命中！
SELECT instr('/ABC/Tmp','/abc/');  -- 0  ← 不命中
```

所以 `path LIKE '旧路径/%'` 这种子树前缀写法，一旦库里存在**路径只差大小写**的目录（`/abc` 和 `/ABC` 完全可以并存，建目录的重名检查是大小写敏感的），就会：

| 操作 | 用 LIKE 的后果 |
| --- | --- |
| 改名 / 移动 `/abc` | `/ABC` 下的目录被按 `/abc` 的前缀重写 → `path` 与父子关系对不上 |
| 删 `/abc` | **`/ABC` 整棵子树被一起删掉**（模糊测试里实测：要删 2 个目录，实际删了 3 个） |

这不是"路径写丑了"，是**误删**。为什么之前没被发现：老用例里没有只差大小写的兄弟目录。

现在全库的前缀匹配统一改成大小写敏感的 `instr(col, ?) = 1`（`folders.path` 是 `TEXT` 且没指定 `COLLATE` → BINARY，`instr` 正好大小写敏感）：

```js
// 子树前缀谓词
function pathPrefixPred(col) {
  return `(${col} = ? OR instr(${col}, ?) = 1)`;
}
function pathPrefixBinds(rootPath) {
  const p = String(rootPath);
  return [p, p === "/" ? "/" : p + "/"];
}
```

它覆盖了 3 个调用点：`repathSubtree()`、`collectSubtreeFast()` / `purgeSubtree()`（单根）、`multiSubtreeWhere()` / `multiSubtreeBinds()`（多根，批量删除/移动走这条）。`repathFilesSubtree()` 不用改 —— 它是靠递归 CTE 从 `folder_id` 往下找的，本来就跟路径字符串无关（这也是为什么坏现场里"目录 path 被改坏、里面文件 full_key 没跟着动"）。

**顺便避掉的第二个坑**：`instr` 而不是 `substr(col, 1, ?)`。SQLite 的 `length`/`substr` 按**字符**计数，JS 的 `String.length` 按 **UTF-16 码元**计数，遇到 emoji 目录名就对不上：

```sql
SELECT length('/🎉/');                  -- 3     （JS: '/🎉/'.length === 4）
SELECT substr('/🎉/子/x.txt', 1, 4);    -- /🎉/子  ← 前缀判断直接错
SELECT instr('/🎉/子/x.txt', '/🎉/');   -- 1      ← 只吃前缀本身，没有长度换算
```

用 `substr` 的写法会让 emoji 目录下的子树静默漏改。`instr` 版本任何 Unicode 都稳，绑定参数也从 3 个回到 2 个（`SUBTREE_CHUNK=20` → 40 个参数，仍在 D1 的 100 上限内）。

**存量数据自查（D1 控制台跑）**：如果之前用旧版本删过 / 改过名字或移动过目录，库里可能有被写坏的 `path` / `full_key`，或者已经被多删了东西（多删找不回来，只能靠 TG 侧消息是否还在判断）。三条自查：

```sql
-- ① 目录 path 与父子关系对不上
SELECT f.id, f.name, f.path AS got,
       (CASE WHEN p.path IS NULL OR p.path = '/' THEN '/' ELSE p.path || '/' END) || f.name AS want
  FROM folders f LEFT JOIN folders p ON p.id = f.parent_id
 WHERE f.path IS NULL
    OR f.path <> (CASE WHEN p.path IS NULL OR p.path = '/' THEN '/' ELSE p.path || '/' END) || f.name
 ORDER BY f.id;

-- ② 文件 full_key 与所在目录对不上（搜索会漏）
SELECT f.id, f.name, f.full_key AS got,
       lower(COALESCE(p.path, '') || '/' || f.name) AS want
  FROM files f LEFT JOIN folders p ON p.id = f.folder_id
 WHERE f.full_key <> lower(COALESCE(p.path, '') || '/' || f.name)
 LIMIT 50;

-- ③ 有没有两个目录撞同一个 path
SELECT path, COUNT(*) c, GROUP_CONCAT(id) ids FROM folders GROUP BY path HAVING c > 1;
```

三条都空 = 库是干净的。① 有货可以拿 `want` 列回写；② 有货可以整列重算（`UPDATE files SET full_key = …`）。

### 6. 测试

- `node .workbuddy/harness/test.mjs` → **252 通过 / 0 失败**（F 段：批量删除/移动、去重计数、计数器自洽、`brm:` 确认与取消、多目标 `/rm` `/move`；G 段：**只差大小写的兄弟目录 + emoji 目录名**，覆盖改名 / 移动 / 子树统计 / 单删 / 批量删六条路径）
- `node .workbuddy/harness/probe-invariants.mjs --seed=N --ops=M` → **12 个种子 × 400 步 + 3 个种子 × 1200 步，不变量全部成立**（这套东西就是用来挖上面那个 LIKE bug 的：把谓词改回 `LIKE` 重跑，G 段立刻红 11 条，`actual=3 expect=2`，说明它会多删）
- `node .workbuddy/harness/test-ui.mjs` → **22 通过 / 0 失败**（表头全选、批量条、切片逻辑、真跑一次批量删除与批量移动）
- `node .workbuddy/harness/e2e-ui-batch.mjs` → **14 通过 / 0 失败**（真浏览器：headless Edge + CDP，Worker 当模块跑 + 本地代理。验布局、全选、批量条、真点一次「删除选中」，截图落在 `.workbuddy/harness/tmp/`）
- `node .workbuddy/harness/probe-ops.mjs` → 额度数字无回退（改名仍卡在行写入 480 次/天），且没有出现"未覆盖的 SQL"（新 SQL 已并入成本模型）
