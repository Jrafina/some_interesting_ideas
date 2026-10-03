/*!
 * TG 存储池 · Cloudflare Workers 版 —— 控制台部署用的单文件构建产物
 *
 * 生成时间：2026-09-22T02:47:20.630Z
 * 源码与唯一真相：本仓库的 cfpool/src/*.ts（改了源码必须重跑 npm run build:dashboard）
 * 已自包含：不依赖任何 npm 包，也不需要 nodejs_compat（只用 Workers 全局）
 */
var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// src/config.ts
var FILE_KEYS = [
  "document",
  "video",
  "audio",
  "animation",
  "voice",
  "video_note"
];
var KEY_EXT = {
  voice: ".ogg",
  video_note: ".mp4",
  video: ".mp4",
  audio: ".mp3",
  animation: ".mp4"
};
var IMG_EXT = /* @__PURE__ */ new Set([
  ".jpg",
  ".jpeg",
  ".png",
  ".webp",
  ".bmp",
  ".gif",
  ".heic",
  ".avif",
  ".tif",
  ".tiff",
  ".jfif"
]);
var VID_EXT = /* @__PURE__ */ new Set([
  ".mp4",
  ".mov",
  ".mkv",
  ".webm",
  ".avi",
  ".m4v",
  ".3gp",
  ".flv",
  ".wmv",
  ".mpg",
  ".mpeg",
  ".ts"
]);
var ALBUM_MAX = 10;
var ALBUM_FAMILY = [
  ["\u89C6\u9891", "video", "video"],
  ["\u56FE\u7247", "image", "photo"]
];
var ALBUM_SINGLE = {
  photo: ["sendPhoto", "photo"],
  video: ["sendVideo", "video"],
  document: ["sendDocument", "document"]
};
var MAX_HITS = 200;
var LS_FILE_LIMIT = 100;
var LS_DIR_LIMIT = 40;
var MSG_LIMIT = 4e3;
var PENDING_TTL = 600;
var SEEN_TTL = 86400;
var DEFAULT_INBOX = "\u6536\u4EF6\u7BB1";
// —— 扩容改造新增 ——
var PAGE_DEFAULT = 100;        // 网页端每页条数（默认）
var PAGE_MAX = 500;            // 网页端每页条数（上限，防一次拉太多）
var BOT_PAGE = 20;             // Telegram 每页条数（配合 4096 字符上限）
var BOT_DIR_LIMIT = 20;        // Telegram 每页最多列几个子目录
var EXPORT_CHUNK = 1000;       // 导出每批读多少行（1000 行 ≈ 1.8ms 纯 JS CPU，给 10ms 上限留足余量）
var FULL_EXPORT_GUARD = 3000;  // 整包导出超过这么多行就拒绝（Free 档 10ms CPU 撑不住），改用分块
var SEARCH_TOTAL_TTL = 600;    // 搜索命中总数的缓存秒数
var SCHEMA_VERSION = 4;        // 库结构版本；改了 ensureSchema 就 +1
var HELP_TEXT = [
  "TG \u5B58\u50A8\u6C60 \xB7 \u547D\u4EE4\u4E00\u89C8",
  "",
  "\u628A\u6587\u4EF6\u76F4\u63A5\u53D1\u7ED9\u6211 = \u6536\u5F55\u8FDB\u6C60\u5B50\uFF08\u96F6\u4E0A\u4F20\uFF0C\u6587\u4EF6\u672C\u6765\u5C31\u5728 Telegram \u4E0A\uFF09",
  "\u60F3\u653E\u6307\u5B9A\u76EE\u5F55\uFF1A\u5728\u6587\u4EF6\u8BF4\u660E\u91CC\u5199\u4E00\u884C\u8DEF\u5F84\uFF0C\u4F8B\uFF1A/\u5DE5\u4F5C/2026\uFF08\u4E0D\u5B58\u5728\u4F1A\u81EA\u52A8\u521B\u5EFA\uFF09",
  "",
  "/search \u5173\u952E\u8BCD [\u9875\u53F7]  \u6A21\u7CCA\u641C\u7D22\uFF1A\u6587\u4EF6\u540D\u6216\u6240\u5728\u8DEF\u5F84\u5305\u542B\u5373\u547D\u4E2D",
  "   \u4F8B\uFF1A/search \u62A5\u8868\u3000/search 2026 \u8D22\u52A1\u3000/search \u62A5\u8868 2",
  "",
  "/ls [\u8DEF\u5F84] [\u9875\u53F7] \u5217\u51FA\u76EE\u5F55\u5185\u5BB9\uFF0C\u7701\u7565\u8DEF\u5F84\u5219\u5217\u6839\u76EE\u5F55",
  "   \u4F8B\uFF1A/ls\u3000/ls /\u5DE5\u4F5C/2026\u3000/ls /\u5DE5\u4F5C/2026 2",
  "   \u7FFB\u9875\uFF1A\u7ED3\u679C\u4E0B\u65B9\u7684\u25C0 \u25B6 \u6309\u94AE\uFF08\u4E0A\u4E00\u9875/\u4E0B\u4E00\u9875\uFF09",
  "",
  "/get #\u7F16\u53F7       \u53D6\u56DE\u6587\u4EF6\uFF08\u7F16\u53F7\u6765\u81EA /ls \u6216 /search \u884C\u5C3E\u7684 #\u6570\u5B57\uFF09",
  "   \u4F8B\uFF1A/get #13\u3000\uFF08\u884C\u9996\u7684 1. 2. 3. \u53EA\u662F\u5E8F\u53F7\uFF0C\u4E0D\u80FD\u7528\u5B83\u53D6\u6587\u4EF6\uFF09",
  "",
  "/move \u6E90 \u76EE\u6807    \u79FB\u52A8\u6587\u4EF6\u6216\u6587\u4EF6\u5939\uFF0C\u76EE\u6807\u7559\u7A7A = \u632A\u5230\u6839\u76EE\u5F55",
  '   \u4F8B\uFF1A/move /\u5DE5\u4F5C/2026 /\u5F52\u6863\u3000/move "/\u6211\u7684 \u62A5\u544A"',
  "/move -to \u76EE\u6807 \u6E90\u2026   \u4E00\u53E3\u6C14\u79FB\u591A\u4E2A\uFF08\u6700\u591A 10 \u9879\uFF09",
  "   \u4F8B\uFF1A/move -to /\u5F52\u6863 /a /b/c #13\u3000\u4E0D\u5E26 -to \u65F6\u6700\u540E\u4E00\u4E2A\u53C2\u6570\u5C31\u662F\u76EE\u6807",
  "",
  "/rename \u8DEF\u5F84 \u65B0\u540D  \u6539\u540D\uFF08\u76EE\u5F55/\u6587\u4EF6\u90FD\u884C\uFF09\uFF0C\u4F4D\u7F6E\u4E0D\u52A8",
  "   \u4F8B\uFF1A/rename /\u5DE5\u4F5C/2026 2026\u5F52\u6863\u3000/rename /a/b.txt c.txt",
  "",
  "/rm \u8DEF\u5F84\u2026        \u5220\u9664\u6587\u4EF6\u6216\u76EE\u5F55\uFF08\u76EE\u5F55\u4F1A\u5148\u5F39\u786E\u8BA4\u6309\u94AE\uFF09\uFF0C\u53EF\u4E00\u53E3\u6C14\u7ED9\u591A\u4E2A\uFF08\u6700\u591A 10 \u4E2A\uFF09",
  "   -f \u8DF3\u8FC7\u786E\u8BA4\u3000-file / -dir \u540C\u540D\u6D88\u6B67\u3000/rm #13 \u6309\u7F16\u53F7\u5220",
  "   \u4F8B\uFF1A/rm /\u5DE5\u4F5C/2026 -f\u3000/rm /a/b.txt -file\u3000/rm #13 #14 /\u5F52\u6863/old",
  "   \u8DEF\u5F84\u91CC\u6709\u7A7A\u683C\u8981\u7528\u5F15\u53F7\u5305\u8D77\u6765\uFF1A/rm \"/\u6211\u7684 \u62A5\u544A\"",
  "",
  "/stats           \u6C60\u5B50\u7EDF\u8BA1",
  "/pass            \u770B\u7F51\u9875\u7AEF\u8D26\u53F7\u5BC6\u7801",
  "/help            \u672C\u6761\u8BF4\u660E",
  "",
  "\u6CE8\u610F\uFF1A\u8FD9\u4E00\u7248\u6CA1\u6709\u7F51\u9875\u7AEF\u4E0A\u4F20/\u4E0B\u8F7D \u2014\u2014 \u5B57\u8282\u5168\u8D70 Telegram \u5BA2\u6237\u7AEF\u3002",
  "\u7F51\u9875\u53EA\u7528\u6765\u6D4F\u89C8\u76EE\u5F55\u3001\u641C\u7D22\u3001\u6539\u540D\u3001\u79FB\u52A8\u3001\u5220\u9664\u3002"
].join("\n");

// src/util.ts
var SLASH_RE = /[/\\]/g;
function cleanFolderName(raw) {
  const name = (raw || "").trim().replace(SLASH_RE, "_");
  return (name.replace(/^[. ]+|[. ]+$/g, "") || "\u672A\u547D\u540D\u6587\u4EF6\u5939").slice(0, 120);
}
__name(cleanFolderName, "cleanFolderName");
function cleanFileName(raw) {
  const name = (raw || "").trim().replace(SLASH_RE, "_");
  return name.slice(0, 120);
}
__name(cleanFileName, "cleanFileName");
function normPath(path) {
  const segs = (path || "").split("/").filter((s) => s);
  return "/" + segs.join("/");
}
__name(normPath, "normPath");
function parentPath(path) {
  const p = normPath(path);
  if (p === "/") return "/";
  const idx = p.lastIndexOf("/");
  return idx <= 0 ? "/" : p.slice(0, idx);
}
__name(parentPath, "parentPath");
function baseName(path) {
  const p = normPath(path);
  if (p === "/") return "";
  return p.slice(p.lastIndexOf("/") + 1);
}
__name(baseName, "baseName");
function splitArgs(raw) {
  const pairs = {
    "'": "'",
    '"': '"',
    "\u201C": "\u201D",
    "\u2018": "\u2019",
    "\u300C": "\u300D"
  };
  const out = [];
  let buf = [];
  let quote = null;
  for (const ch of raw) {
    if (quote) {
      if (ch === pairs[quote]) quote = null;
      else buf.push(ch);
    } else if (ch in pairs) {
      quote = ch;
    } else if (/\s/.test(ch)) {
      if (buf.length) {
        out.push(buf.join(""));
        buf = [];
      }
    } else {
      buf.push(ch);
    }
  }
  if (buf.length) out.push(buf.join(""));
  return out;
}
__name(splitArgs, "splitArgs");
function human(n) {
  let v = Number(n ?? 0);
  if (!Number.isFinite(v) || v < 0) v = 0;
  for (const unit of ["B", "KB", "MB", "GB", "TB"]) {
    if (v < 1024 || unit === "TB") {
      return unit === "B" ? `${v.toFixed(0)} B` : `${v.toFixed(1)} ${unit}`;
    }
    v /= 1024;
  }
  return "0 B";
}
__name(human, "human");
function mediaKind(name, mime) {
  const m = (mime || "").toLowerCase();
  if (m.startsWith("image/")) return "image";
  if (m.startsWith("video/")) return "video";
  const dot = (name || "").lastIndexOf(".");
  const ext = dot >= 0 ? name.slice(dot).toLowerCase() : "";
  if (IMG_EXT.has(ext)) return "image";
  if (VID_EXT.has(ext)) return "video";
  return null;
}
__name(mediaKind, "mediaKind");
function clip(text, limit) {
  return text.length > limit ? text.slice(0, limit - 1) + "\u2026" : text;
}
__name(clip, "clip");
function timingSafeEqualStr(a, b) {
  const ab = new TextEncoder().encode(a);
  const bb = new TextEncoder().encode(b);
  let diff = ab.length ^ bb.length;
  const n = Math.max(ab.length, bb.length);
  for (let i = 0; i < n; i++) {
    diff |= (ab[i] ?? 0) ^ (bb[i] ?? 0);
  }
  return diff === 0;
}
__name(timingSafeEqualStr, "timingSafeEqualStr");
function randomToken(bytes = 12) {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return Array.from(buf, (b) => b.toString(16).padStart(2, "0")).join("");
}
__name(randomToken, "randomToken");

// src/db.ts
async function logEvent(db, t, payload) {
  try {
    await db.prepare("INSERT INTO events(t, payload, ts) VALUES(?, ?, ?)").bind(t, JSON.stringify(payload), Date.now() / 1e3).run();
    await bumpCounters(db, { events: 1 });
  } catch (e) {
    console.error("event log failed", { t, message: e.message });
  }
}
__name(logEvent, "logEvent");

// ============================================================================
// 扩容改造 · 库结构迁移（惰性 + 幂等，第一次请求自动跑，之后走模块级缓存）
// 目标：
//   1) folders.path 物化路径 —— 干掉每次请求都全量扫 folders 的 folderPathMaps()
//   2) counters 计数器      —— 干掉 /api/stats 的 COUNT(*) 全表扫
//   3) 几个复合索引          —— 让分页/子目录计数走索引而不是全表
// ============================================================================
var COUNTER_KEYS = ["files", "bytes", "folders", "events"];
var schemaReady = false;
async function ensureSchema(db) {
  if (schemaReady) return;
  try {
    const row = await db.prepare("SELECT v FROM meta WHERE k = 'schema_v'").first();
    if (row && row.v === String(SCHEMA_VERSION)) {
      schemaReady = true;
      return;
    }
  } catch {
    // meta 表还不存在 —— 首次部署，继续往下建
  }
  const ddl = [
    "CREATE TABLE IF NOT EXISTS meta(k TEXT PRIMARY KEY, v TEXT)",
    "CREATE TABLE IF NOT EXISTS counters(k TEXT PRIMARY KEY, v INTEGER NOT NULL DEFAULT 0)",
    "CREATE TABLE IF NOT EXISTS pending_sr(token TEXT PRIMARY KEY, q TEXT NOT NULL, total INTEGER, ts REAL NOT NULL)",
    "CREATE INDEX IF NOT EXISTS idx_files_folder_id ON files(folder_id, id DESC)",
    "CREATE INDEX IF NOT EXISTS idx_folders_parent_name ON folders(parent_id, name)",
    "CREATE INDEX IF NOT EXISTS idx_pending_sr_q ON pending_sr(q)"
  ];
  for (const sql of ddl) {
    try {
      await db.prepare(sql).run();
    } catch (e) {
      console.warn("ddl skipped", { sql, message: e.message });
    }
  }
  // 去掉两个完全重复的索引（实测 2 万文件下白占 0.55MB ≈ 文件侧存储的 11%，且每次写入多 2 行索引）：
  //   idx_files_unique2  与 idx_files_unique 完全同列，后者还带 UNIQUE 去重约束 → 删重复的非唯一版
  //   idx_files_folder   被 (folder_id, id DESC) 完全覆盖（最左前缀）              → 删单列版
  try {
    await db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS idx_files_unique ON files(file_unique)").run();
  } catch (e) {
    console.warn("create idx_files_unique failed", e.message);
  }
  const indexExists = async (name) => !!(await db.prepare("SELECT 1 AS x FROM sqlite_schema WHERE type = 'index' AND name = ?").bind(name).first());
  try {
    if (await indexExists("idx_files_unique")) await db.prepare("DROP INDEX IF EXISTS idx_files_unique2").run();
  } catch (e) {
    console.warn("drop idx_files_unique2 failed", e.message);
  }
  try {
    if (await indexExists("idx_files_folder_id")) await db.prepare("DROP INDEX IF EXISTS idx_files_folder").run();
  } catch (e) {
    console.warn("drop idx_files_folder failed", e.message);
  }
  let hasPath = true;
  try {
    await db.prepare("SELECT path FROM folders LIMIT 1").first();
  } catch {
    hasPath = false;
  }
  if (!hasPath) {
    try {
      await db.prepare("ALTER TABLE folders ADD COLUMN path TEXT").run();
    } catch (e) {
      console.warn("add folders.path failed", e.message);
    }
  }
  // 注意：这个索引必须在 path 列存在之后才能建（否则 "no such column: path"）
  try {
    await db.prepare("CREATE INDEX IF NOT EXISTS idx_folders_path ON folders(path)").run();
  } catch (e) {
    console.warn("index folders.path failed", e.message);
  }
  // files.full_key：把 "小写全路径/小写文件名" 冗余成一列，
  // 搜索从 "JOIN folders + 每行 2 次 LIKE" 变成 "每行 1 次 instr"，实测最坏 1.73ms vs 6.66ms。
  let hasKey = true;
  try {
    await db.prepare("SELECT full_key FROM files LIMIT 1").first();
  } catch {
    hasKey = false;
  }
  if (!hasKey) {
    try {
      await db.prepare("ALTER TABLE files ADD COLUMN full_key TEXT").run();
    } catch (e) {
      console.warn("add files.full_key failed", e.message);
    }
  }
  try {
    await db.prepare("CREATE INDEX IF NOT EXISTS idx_files_full_key ON files(full_key)").run();
  } catch (e) {
    console.warn("index files.full_key failed", e.message);
  }
  // 物化路径回填：一次递归把所有目录算完，只更新还空着的
  try {
    const miss = await db.prepare("SELECT COUNT(*) AS c FROM folders WHERE path IS NULL").first();
    if ((miss?.c ?? 0) > 0) {
      await db.prepare(
        `WITH RECURSIVE t(id, p) AS (
           SELECT id, '/' || name FROM folders WHERE parent_id IS NULL
           UNION ALL SELECT f.id, t.p || '/' || f.name FROM folders f JOIN t ON f.parent_id = t.id)
         UPDATE folders SET path = (SELECT p FROM t WHERE t.id = folders.id) WHERE path IS NULL`
      ).run();
    }
  } catch (e) {
    console.error("backfill folders.path failed", e.message);
  }
  // full_key 回填（必须放在 folders.path 之后，它要用到 path）
  try {
    const missK = await db.prepare("SELECT COUNT(*) AS c FROM files WHERE full_key IS NULL").first();
    if ((missK?.c ?? 0) > 0) {
      await db.prepare(
        `UPDATE files
            SET full_key = lower(COALESCE((SELECT path FROM folders WHERE folders.id = files.folder_id), '')) || '/' || lower(name)
          WHERE full_key IS NULL`
      ).run();
    }
  } catch (e) {
    console.error("backfill files.full_key failed", e.message);
  }
  await seedCounters(db);
  // 只有确认没有 NULL 才算迁移成功；否则下次请求重试，避免留下半成品
  let clean = false;
  try {
    const left = await db.prepare("SELECT COUNT(*) AS c FROM folders WHERE path IS NULL").first();
    const leftK = await db.prepare("SELECT COUNT(*) AS c FROM files WHERE full_key IS NULL").first();
    clean = (left?.c ?? 0) === 0 && (leftK?.c ?? 0) === 0;
  } catch {
    clean = false;
  }
  if (clean) {
    try {
      await db.prepare("INSERT INTO meta(k, v) VALUES('schema_v', ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v").bind(String(SCHEMA_VERSION)).run();
      schemaReady = true;
    } catch (e) {
      console.warn("write schema_v failed", e.message);
    }
  }
}
__name(ensureSchema, "ensureSchema");

async function readCounters(db) {
  const out = { files: 0, bytes: 0, folders: 0, events: 0 };
  try {
    const { results } = await db.prepare("SELECT k, v FROM counters").all();
    for (const r of results ?? []) if (r.k in out) out[r.k] = Number(r.v) || 0;
  } catch (e) {
    console.warn("readCounters failed", e.message);
  }
  return out;
}
__name(readCounters, "readCounters");
async function bumpCounters(db, delta) {
  const stmts = [];
  for (const k of COUNTER_KEYS) {
    const d = Number(delta[k] || 0);
    if (!d) continue;
    stmts.push(db.prepare("INSERT INTO counters(k, v) VALUES(?, ?) ON CONFLICT(k) DO UPDATE SET v = v + excluded.v").bind(k, d));
  }
  if (!stmts.length) return;
  try {
    if (typeof db.batch === "function") await db.batch(stmts);
    else for (const s of stmts) await s.run();
  } catch (e) {
    console.error("bumpCounters failed", e.message);
  }
}
__name(bumpCounters, "bumpCounters");
async function seedCounters(db) {
  try {
    const t = await db.prepare("SELECT COUNT(*) AS files, COALESCE(SUM(size),0) AS bytes FROM files").first();
    const f = await db.prepare("SELECT COUNT(*) AS c FROM folders").first();
    const ev = await db.prepare("SELECT COUNT(*) AS c FROM events").first();
    const vals = { files: t?.files ?? 0, bytes: t?.bytes ?? 0, folders: f?.c ?? 0, events: ev?.c ?? 0 };
    for (const k of COUNTER_KEYS) {
      await db.prepare("INSERT INTO counters(k, v) VALUES(?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v").bind(k, vals[k]).run();
    }
  } catch (e) {
    console.error("seedCounters failed", e.message);
  }
}
__name(seedCounters, "seedCounters");
async function recountCounters(db) {
  await seedCounters(db);
  return readCounters(db);
}
__name(recountCounters, "recountCounters");

// 物化路径：查 1 行就能拿到某目录的完整路径，不再全量扫 folders
async function pathOfId(db, folderId) {
  if (folderId === null || folderId === void 0) return "/";
  try {
    const row = await db.prepare("SELECT path FROM folders WHERE id = ?").bind(folderId).first();
    return row?.path ?? "/";
  } catch {
    return "/";
  }
}
__name(pathOfId, "pathOfId");
async function pathOf(db, folderId) {
  return pathOfId(db, folderId);
}
__name(pathOf, "pathOf");
function joinPath(up, name) {
  const base = !up || up === "/" ? "" : String(up).replace(/\/+$/, "");
  return `${base}/${name}`;
}
__name(joinPath, "joinPath");
// 搜索键：小写全路径 + 小写文件名。写入口径必须和 SQLite 的 lower() 完全一致，否则搜不到。
// 注意：SQLite 的 lower() 只处理 ASCII，所以这里也只能用 ASCII 小写（不能用 JS toLowerCase，
// 它对 É 这类非 ASCII 大写也会转，两边口径就不一致了）。
function asciiLower(s) {
  return String(s).replace(/[A-Z]/g, (c) => c.toLowerCase());
}
__name(asciiLower, "asciiLower");
function fileKeyOf(folderPath, name) {
  return asciiLower(joinPath(folderPath, name));
}
__name(fileKeyOf, "fileKeyOf");
async function fileKeyFor(db, folderId, name) {
  return fileKeyOf(await pathOfId(db, folderId), name);
}
__name(fileKeyFor, "fileKeyFor");
// 子树 id：递归 CTE 只读子树那几行（老实现是每次 SELECT 全表 + 每层再查一次）
async function subtreeIds(db, rootId) {
  const { results } = await db.prepare(
    `WITH RECURSIVE sub(id) AS (SELECT ? UNION ALL SELECT f.id FROM folders f JOIN sub ON f.parent_id = sub.id)
     SELECT id FROM sub`
  ).bind(rootId).all();
  return (results ?? []).map((r) => Number(r.id));
}
__name(subtreeIds, "subtreeIds");
// 改名/移动后，把子树里所有目录的 path 前缀一次性换掉（单条语句）。
// 【踩过的坑】调用方都是「先 UPDATE 根目录的 path，再调这里」，所以根目录的 path 此刻已经是 newPath。
// 老写法 `path = newPath || substr(path, length(oldPath)+1)` 对根目录就会变成
//   newPath + substr(newPath, len(oldPath)+1)
// 只有新旧路径长度完全一样时才凑巧等于 newPath；长度不同（默认情况）就会拼坏：
// 实测 /批量测试/A → /批量测试/B 会得到 "/批量测试/B/A/A"（改名同理，新名长度不同就中招）。
// 现在显式给根目录赋 newPath，后代才走 substr；定位用 id 或 path 前缀，和调用顺序无关。
// 【另一个坑 · 必须记住】定位后代不能用 `path LIKE '旧路径/%'`：SQLite 的 LIKE 对 ASCII 默认
//   大小写不敏感，`'/ABC/Tmp' LIKE '/abc/%'` 返回 1。于是把 /abc 移走时，/ABC 下的兄弟目录
//   会被一起按旧前缀重写成 /ABC/abc/Tmp（实测 seed 复现）。前缀一律用 instr(col, ?) = 1 这种
//   大小写敏感的写法（详见 pathPrefixPred 的注释）。
async function repathSubtree(db, rootId, oldPath, newPath) {
  const prefix = String(oldPath) + "/";
  await db.prepare(
    `UPDATE folders SET path = CASE WHEN id = ? THEN ? ELSE ? || substr(path, length(?) + 1) END
      WHERE id = ? OR instr(path, ?) = 1`
  ).bind(rootId, newPath, newPath, oldPath, rootId, prefix).run();
}
__name(repathSubtree, "repathSubtree");
// 目录改名/移动后，把子树里所有文件的搜索键前缀一起换掉（单条语句，靠 idx_files_folder 定位）
async function repathFilesSubtree(db, rootId, oldPath, newPath) {
  await db.prepare(
    `WITH RECURSIVE sub(id) AS (SELECT ? UNION ALL SELECT f.id FROM folders f JOIN sub ON f.parent_id = sub.id)
     UPDATE files SET full_key = ? || substr(full_key, length(?) + 1) WHERE folder_id IN (SELECT id FROM sub)`
  ).bind(rootId, asciiLower(newPath), asciiLower(oldPath)).run();
}
__name(repathFilesSubtree, "repathFilesSubtree");
// 从自己往上的祖先链（给前端面包屑用），1 条语句、最多 32 行
async function ancestorsOf(db, folderId) {
  if (folderId === null || folderId === void 0) return [];
  try {
    const { results } = await db.prepare(
      `WITH RECURSIVE up(id, name, parent_id, depth) AS (
         SELECT id, name, parent_id, 0 FROM folders WHERE id = ?
         UNION ALL SELECT f.id, f.name, f.parent_id, up.depth + 1 FROM folders f JOIN up ON f.id = up.parent_id
       ) SELECT id, name, depth FROM up ORDER BY depth DESC`
    ).bind(folderId).all();
    return (results ?? []).map((r) => ({ id: Number(r.id), name: r.name }));
  } catch {
    return [];
  }
}
__name(ancestorsOf, "ancestorsOf");
// 【已删除】folderPathMaps()：老实现对每次请求都做 "SELECT id,name,parent_id FROM folders"
// 全量扫一遍，再在 JS 里递归拼路径；listFiles / replyLs 各调 2 次。
// 实测目录数 1k/5k/10k/20k/221k 时，本函数单次 0.77/3.30/8.65/19.24/308.23 ms —— 是"进目录就 1102"的元凶。
// 现在改成 folders.path 物化路径（pathOfId 查 1 行）+ subtreeIds 递归 CTE。
async function resolvePath(db, path) {
  // 物化路径后，解析整条路径从 "每段一次查询" 变成 "一次等值查询"
  const p = normPath(path);
  if (p === "/") return { id: null };
  const row = await db.prepare("SELECT id FROM folders WHERE path = ?").bind(p).first();
  if (row) return { id: row.id };
  return { id: null, err: `\u8DEF\u5F84\u4E0D\u5B58\u5728\uFF1A${path}` };
}
__name(resolvePath, "resolvePath");
async function resolveNode(db, path, want = "") {
  const p = normPath(path);
  if (p === "/") {
    if (want === "file") return { kind: null, id: null, err: "\u6839\u76EE\u5F55\u4E0D\u662F\u6587\u4EF6\uFF0C\u6CA1\u6CD5\u6309\u6587\u4EF6\u5904\u7406" };
    return { kind: "folder", id: null };
  }
  const folder = await resolvePath(db, p);
  const pfid = await resolvePath(db, parentPath(p));
  let fileId = null;
  if (!pfid.err) {
    const row = await db.prepare("SELECT id FROM files WHERE folder_id IS ? AND name = ?").bind(pfid.id, baseName(p)).first();
    fileId = row ? row.id : null;
  }
  if (want === "folder") {
    if (folder.id === null) return { kind: null, id: null, err: `\u76EE\u5F55\u4E0D\u5B58\u5728\uFF1A${p}` };
    return { kind: "folder", id: folder.id };
  }
  if (want === "file") {
    if (fileId === null) return { kind: null, id: null, err: `\u6587\u4EF6\u4E0D\u5B58\u5728\uFF1A${p}` };
    return { kind: "file", id: fileId };
  }
  if (folder.id !== null) return { kind: "folder", id: folder.id };
  if (fileId !== null) return { kind: "file", id: fileId };
  return { kind: null, id: null, err: `\u8DEF\u5F84\u4E0D\u5B58\u5728\uFF1A${p}` };
}
__name(resolveNode, "resolveNode");
async function ensureFolderPath(db, path) {
  let cur = null;
  let curPath = "/";
  for (const raw of (path || "").split("/").filter((s) => s)) {
    const name = cleanFolderName(raw);
    const full = joinPath(curPath, name);
    const row = await db.prepare("SELECT id FROM folders WHERE path = ?").bind(full).first();
    if (row) {
      cur = row.id;
    } else {
      const res = await db.prepare("INSERT INTO folders(name, parent_id, path, created_at) VALUES(?, ?, ?, ?)").bind(name, cur, full, Date.now() / 1e3).run();
      cur = Number(res.meta.last_row_id);
      await bumpCounters(db, { folders: 1 });
      await logEvent(db, "mkdir", { path: full });
    }
    curPath = full;
  }
  return cur;
}
__name(ensureFolderPath, "ensureFolderPath");
async function listSubfolders(db, folderId) {
  const { results } = await db.prepare(
    `SELECT f.id, f.name,
              (SELECT COUNT(*) FROM files x WHERE x.folder_id = f.id)   AS files,
              (SELECT COUNT(*) FROM folders y WHERE y.parent_id = f.id) AS subs
       FROM folders f WHERE f.parent_id IS ?
       ORDER BY f.name COLLATE NOCASE`
  ).bind(folderId).all();
  return results ?? [];
}
__name(listSubfolders, "listSubfolders");
// 【已删除】likeEsc / likeContains：原来是给 `LIKE ... ESCAPE` 转义 % 和 _ 用的，现已全部不用。
// 原因见 pathPrefixPred 那段注释 —— SQLite 的 LIKE 对 ASCII 大小写不敏感，前缀匹配会误伤
// 路径只差大小写的兄弟项（实测 '/ABC/Tmp' LIKE '/abc/%' → 1）。全库改成大小写敏感写法后，
// 这里再留一个「看起来能安全做前缀匹配」的工具函数只会给以后埋雷，所以直接删掉。
// 搜索相关的 LIKE 也已不存在：files.full_key 走 instr()（大小写敏感，且 full_key 本身是小写口径）。
// 相关性打分：只对"当前这一页"做。SQL 里排序要先把全部命中行都算一遍 → 实测 9.14ms vs 0.43ms。
function scoreOfMatch(name, q, toks) {
  const n = asciiLower(name);
  if (n === q) return 0;
  if (n.startsWith(q)) return 1;
  if (toks.every((t) => n.includes(t))) return 2;
  return 3;
}
__name(scoreOfMatch, "scoreOfMatch");
// 搜索：过滤与分页全下推到 SQL，只取当前页；命中总数可选（按需才多扫一遍）
// 老实现是 "SELECT * FROM files" 全表捞进 JS 再逐个 includes()，
// 行数一多就是 CPU 爆炸 + 内存爆炸（1700 万行时单次 60s+）。
// 新实现走 files.full_key 单列 instr：20k 行下最坏 1.73ms、命中时 0.25ms。
async function searchFilesPage(db, query, limit, offset = 0, wantTotal = false) {
  const toks = (query || "").split(/\s+/).filter(Boolean).map((t) => asciiLower(t));
  if (!toks.length) return { items: [], has_more: false, total: 0 };
  const q = asciiLower((query || "").trim());
  const where = toks.map(() => "instr(full_key, ?) > 0").join(" AND ");
  const { results } = await db.prepare(
    `SELECT f.id, f.name, f.size, f.mime, f.file_id, f.file_unique, f.message_id, f.chat_id, f.folder_id, f.created_at,
            COALESCE(d.path, '/') AS path_str
       FROM files f LEFT JOIN folders d ON d.id = f.folder_id
      WHERE ${where}
      ORDER BY f.id DESC
      LIMIT ? OFFSET ?`
  ).bind(...toks, limit + 1, offset).all();
  const rows = results ?? [];
  const hasMore = rows.length > limit;
  const items = rows.slice(0, limit);
  for (const it of items) it.score = scoreOfMatch(it.name, q, toks);
  items.sort((a, b) => a.score - b.score || b.id - a.id);
  let total = null;
  if (wantTotal) {
    const c = await db.prepare(`SELECT COUNT(*) AS c FROM files WHERE ${where}`).bind(...toks).first();
    total = c?.c ?? 0;
  }
  return { items, has_more: hasMore, total };
}
__name(searchFilesPage, "searchFilesPage");
// 兼容旧调用点：不需要分页元数据时用它
async function searchFiles(db, query, limit = MAX_HITS) {
  const r = await searchFilesPage(db, query, limit, 0, true);
  return { items: r.items, total: r.total ?? r.items.length };
}
__name(searchFiles, "searchFiles");
async function listFiles(db, folderId, limit, offset = 0) {
  const pStr = await pathOfId(db, folderId);
  const { results } = await db.prepare(
    `SELECT id, name, size, mime, file_id, file_unique, message_id, chat_id, folder_id, created_at
       FROM files WHERE folder_id IS ? ORDER BY id DESC LIMIT ? OFFSET ?`
  ).bind(folderId, limit, offset).all();
  return (results ?? []).map((r) => ({
    ...r,
    path_str: pStr,
    score: 0,
    media: mediaKind(r.name, r.mime)
  }));
}
__name(listFiles, "listFiles");
async function countFilesIn(db, folderId) {
  const row = await db.prepare("SELECT COUNT(*) AS c FROM files WHERE folder_id IS ?").bind(folderId).first();
  return row?.c ?? 0;
}
__name(countFilesIn, "countFilesIn");
// 【已删除】collectSubtree(db, folderId)：老实现 = 全表扫 folders + 每个目录各查一次 files，
// 目录上万时就是上万次 D1 查询；老删除又是每个文件/目录各一条 DELETE，
// 超过 1000 个就直接撞 D1 单次调用查询数上限。现在由下面两个函数取代。
// 【踩过的坑】子树前缀匹配必须大小写敏感，所以不能用 LIKE（对 ASCII 大小写不敏感）：
//   实测 `'/ABC/Tmp' LIKE '/abc/%'` → 1，而 `instr('/ABC/Tmp','/abc/')` → 0。
//   用 LIKE 的后果：删除 /abc 会把 /ABC 整棵子树一起删；改名/移动 /abc 会把 /ABC 下的目录重写坏。
// 也不能用 `substr(col, 1, ?)`：SQLite 的 length/substr 按「字符」计数，JS 的 String.length 按
//   UTF-16 码元计数，遇到 emoji 目录名就对不上（'/🎉/'.length 是 4，SQLite length 是 3），
//   前缀判断会静默失效。instr(col, ?) = 1 只吃前缀本身、不做长度换算，任何 Unicode 都稳。
// folders.path 是 TEXT 且没指定 COLLATE → BINARY → instr 大小写敏感，正是我们要的。
function pathPrefixPred(col) {
  return `(${col} = ? OR instr(${col}, ?) = 1)`;
}
__name(pathPrefixPred, "pathPrefixPred");
// pathPrefixPred 的绑定参数，顺序固定：精确值, 前缀
function pathPrefixBinds(rootPath) {
  const p = String(rootPath);
  return [p, p === "/" ? "/" : p + "/"];
}
__name(pathPrefixBinds, "pathPrefixBinds");
async function collectSubtreeFast(db, rootPath) {
  const binds = pathPrefixBinds(rootPath);
  const { results: frows } = await db.prepare(
    `SELECT id, chat_id, message_id, size FROM files
      WHERE folder_id IN (SELECT id FROM folders WHERE ${pathPrefixPred("path")})`
  ).bind(...binds).all();
  const files = frows ?? [];
  const c = await db.prepare(
    `SELECT COUNT(*) AS c FROM folders WHERE ${pathPrefixPred("path")}`
  ).bind(...binds).first();
  const bytes = files.reduce((s, f) => s + (f.size || 0), 0);
  return { folderCount: Number(c?.c ?? 0), files, bytes };
}
__name(collectSubtreeFast, "collectSubtreeFast");
// 整棵子树一次删掉（先删文件，再删目录 —— 谓词只读 folders，不自引用，不会边删边算错）
async function purgeSubtree(db, rootPath) {
  const binds = pathPrefixBinds(rootPath);
  const rf = await db.prepare(
    `DELETE FROM files WHERE folder_id IN (SELECT id FROM folders WHERE ${pathPrefixPred("path")})`
  ).bind(...binds).run();
  const rd = await db.prepare(
    `DELETE FROM folders WHERE ${pathPrefixPred("path")}`
  ).bind(...binds).run();
  return {
    files: Number(rf?.meta?.changes ?? 0),
    folders: Number(rd?.meta?.changes ?? 0)
  };
}
__name(purgeSubtree, "purgeSubtree");
async function claimUpdate(db, updateId) {
  try {
    await db.prepare("INSERT INTO seen_updates(update_id, ts) VALUES(?, ?)").bind(updateId, Date.now() / 1e3).run();
    return true;
  } catch {
    return false;
  }
}
__name(claimUpdate, "claimUpdate");
async function pruneSeenUpdates(db) {
  try {
    await db.prepare("DELETE FROM seen_updates WHERE ts < ?").bind(Date.now() / 1e3 - SEEN_TTL).run();
  } catch (e) {
    console.error("prune seen_updates failed", e.message);
  }
}
__name(pruneSeenUpdates, "pruneSeenUpdates");
// 搜索分页态（pending_sr）过期清理
async function prunePendingSr(db) {
  try {
    await db.prepare("DELETE FROM pending_sr WHERE ts < ?").bind(Date.now() / 1e3 - 3600).run();
  } catch (e) {
    console.warn("prune pending_sr failed", e.message);
  }
}
__name(prunePendingSr, "prunePendingSr");

// src/tg.ts
var apiBaseOverride = "";
function setApiBase(v) {
  if (typeof v === "string" && v.trim()) apiBaseOverride = v.trim().replace(/\/+$/, "");
  return apiBaseOverride;
}
__name(setApiBase, "setApiBase");
function apiBase(token) {
  return `${apiBaseOverride || "https://api.telegram.org"}/bot${token}`;
}
__name(apiBase, "apiBase");
async function tgCall(token, method, params = {}) {
  try {
    const resp = await fetch(`${apiBase(token)}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(params)
    });
    const data = await resp.json();
    if (!data || typeof data.ok !== "boolean") {
      return { ok: false, description: "unexpected response shape" };
    }
    return data;
  } catch (e) {
    return { ok: false, description: `${e.name}: ${e.message}` };
  }
}
__name(tgCall, "tgCall");
function tgErr(r) {
  return r.description || `error_code=${r.error_code ?? "?"}`;
}
__name(tgErr, "tgErr");
async function sendMessage(token, chatId, text, extra = {}) {
  const r = await tgCall(token, "sendMessage", {
    chat_id: chatId,
    text,
    disable_web_page_preview: true,
    ...extra
  });
  if (!r.ok) {
    console.warn("sendMessage failed", {
      chatId,
      error_code: r.error_code,
      description: r.description,
      text: text.slice(0, 120)
    });
  }
  return r;
}
__name(sendMessage, "sendMessage");
async function editMessageCaption(token, chatId, messageId, caption) {
  return tgCall(token, "editMessageCaption", {
    chat_id: chatId,
    message_id: messageId,
    caption
  });
}
__name(editMessageCaption, "editMessageCaption");
async function copyMessage(token, chatId, fromChatId, messageId) {
  return tgCall(token, "copyMessage", {
    chat_id: chatId,
    from_chat_id: fromChatId,
    message_id: messageId
  });
}
__name(copyMessage, "copyMessage");
async function sendDocumentById(token, chatId, fileId) {
  return tgCall(token, "sendDocument", { chat_id: chatId, document: fileId });
}
__name(sendDocumentById, "sendDocumentById");
async function deleteMessages(token, rows, fallbackChatId) {
  const byChat = /* @__PURE__ */ new Map();
  for (const r of rows) {
    if (!r.message_id) continue;
    const cid = String(r.chat_id || fallbackChatId);
    const list = byChat.get(cid) ?? [];
    list.push(Number(r.message_id));
    byChat.set(cid, list);
  }
  let deleted = 0;
  let failed = 0;
  for (const [cid, mids] of byChat) {
    for (let i = 0; i < mids.length; i += 100) {
      const chunk = mids.slice(i, i + 100);
      const r = await tgCall(token, "deleteMessages", {
        chat_id: cid,
        message_ids: chunk
      });
      if (r.ok) {
        deleted += chunk.length;
        continue;
      }
      for (const mid of chunk) {
        const one = await tgCall(token, "deleteMessage", { chat_id: cid, message_id: mid });
        if (one.ok) deleted += 1;
        else failed += 1;
      }
    }
  }
  if (failed) console.warn("some messages not deleted", { failed, deleted });
  return deleted;
}
__name(deleteMessages, "deleteMessages");

// src/bot.ts
async function handleUpdate(env, update) {
  const updateId = Number(update?.update_id);
  if (Number.isFinite(updateId)) {
    const fresh = await claimUpdate(env.DB, updateId);
    if (!fresh) {
      console.log("duplicate update ignored", { updateId });
      return;
    }
  }
  if (update?.callback_query) {
    await handleCallback(env, update.callback_query);
    return;
  }
  if (update?.message) {
    await handleMessage(env, update.message);
    return;
  }
}
__name(handleUpdate, "handleUpdate");
function allowed(env, chatId, fromId) {
  const ids = /* @__PURE__ */ new Set([String(chatId), String(fromId)]);
  const chat = (env.TG_CHAT_ID || "").trim();
  if (chat && ids.has(chat)) return true;
  const admins = (env.TG_BOT_ADMIN_IDS || "").split(",").map((s) => s.trim()).filter(Boolean);
  return admins.some((a) => ids.has(a));
}
__name(allowed, "allowed");
function whitelistUnset(env) {
  return !(env.TG_CHAT_ID || "").trim() && !(env.TG_BOT_ADMIN_IDS || "").trim();
}
__name(whitelistUnset, "whitelistUnset");
async function handleMessage(env, msg) {
  const token = env.TG_BOT_TOKEN;
  const cid = msg?.chat?.id;
  const fromId = msg?.from?.id;
  if (!allowed(env, cid, fromId)) {
    if (whitelistUnset(env)) {
      await sendMessage(
        token,
        cid,
        `\u5C1A\u672A\u914D\u7F6E\u767D\u540D\u5355\uFF0C\u6240\u4EE5\u6211\u4E0D\u6267\u884C\u4EFB\u4F55\u547D\u4EE4\u3002

\u4F60\u7684 chat_id\uFF1A${cid}
from_id\uFF1A${fromId}

\u628A chat_id \u5199\u8FDB Worker \u53D8\u91CF TG_CHAT_ID\uFF08\u6216\u628A from_id \u5199\u8FDB TG_BOT_ADMIN_IDS\uFF09\u540E\u5373\u53EF\u4F7F\u7528\u3002/help \u770B\u547D\u4EE4\u3002`
      );
      return;
    }
    console.warn("ignored unauthorized chat", { cid, fromId });
    return;
  }
  const text = (msg?.text || "").trim();
  if (!text) {
    const info = incomingFile(msg);
    if (info) await handleFileMessage(env, msg, cid, info);
    return;
  }
  if (!text.startsWith("/")) return;
  const parts = text.split(/\s+/);
  const cmd = (parts[0] || "").split("@")[0].toLowerCase();
  const args = parts.slice(1);
  const body = parts.length > 1 ? text.split(/\s+/).slice(1).join(" ").trim() : "";
  switch (cmd) {
    case "/search":
    case "/s":
    case "/find": {
      const ex = extractExplicitPage(args);
      const kw = ex.rest.join(" ");
      if (!kw) {
        await sendMessage(token, cid, "\u7528\u6CD5\uFF1A/search \u5173\u952E\u8BCD [#\u9875\u53F7]\n\u4F8B\uFF1A/search \u62A5\u8868\u3000/search 2026 \u8D22\u52A1\u3000/search \u62A5\u8868 #2");
        return;
      }
      await replySearch(env, cid, kw, ex.page);
      return;
    }
    case "/ls":
    case "/dir":
    case "/list": {
      const ex = extractExplicitPage(args);
      const t = await parseLsTarget(env, ex.rest.join(" "));
      await replyLs(env, cid, t.path, ex.page > 1 ? ex.page : t.page);
      return;
    }
    case "/get": {
      const raw = (args[0] || "").replace(/^#/, "");
      if (!/^\d+$/.test(raw)) {
        await sendMessage(
          token,
          cid,
          "\u7528\u6CD5\uFF1A/get #\u7F16\u53F7\n\u7F16\u53F7\u6765\u81EA /ls \u6216 /search \u7ED3\u679C\u91CC\u884C\u5C3E\u7684 #\u6570\u5B57\uFF08\u884C\u9996\u7684 1. 2. 3. \u53EA\u662F\u5E8F\u53F7\uFF0C\u4E0D\u662F\u7F16\u53F7\uFF09"
        );
        return;
      }
      const ok = await sendFile(env, cid, Number(raw));
      if (!ok) await sendMessage(token, cid, `\u53D6\u56DE #${raw} \u5931\u8D25\uFF0C\u53EF\u80FD\u5DF2\u88AB\u5220\u9664\u3002`);
      return;
    }
    case "/rm":
    case "/del":
    case "/delete":
      await replyRm(env, cid, body);
      return;
    case "/move":
    case "/mv":
      await replyMove(env, cid, body);
      return;
    case "/rename":
    case "/ren":
      await replyRename(env, cid, body);
      return;
    case "/pass":
    case "/pwd":
    case "/password":
      await replyPass(env, cid);
      return;
    case "/stats": {
      const c = await readCounters(env.DB);
      await sendMessage(
        token,
        cid,
        `\u6C60\u5B50\u7EDF\u8BA1

\u6587\u4EF6 ${c.files} \u4E2A \xB7 \u5171 ${human(c.bytes)}
\u6587\u4EF6\u5939 ${c.folders} \u4E2A \xB7 \u4E8B\u4EF6 ${c.events} \u6761`
      );
      return;
    }
    case "/start":
    case "/help":
    case "/h":
      await sendMessage(token, cid, HELP_TEXT);
      return;
    default:
      await sendMessage(token, cid, `\u672A\u77E5\u547D\u4EE4 ${cmd}

${HELP_TEXT}`);
  }
}
__name(handleMessage, "handleMessage");
function incomingFile(msg) {
  for (const key of FILE_KEYS) {
    const obj = msg?.[key];
    if (!obj || !obj.file_id) continue;
    let name = (obj.file_name || "").trim();
    if (!name && key === "audio") {
      const title = (obj.title || "").trim();
      if (title) name = `${title}.mp3`;
    }
    if (!name) {
      const ext = KEY_EXT[key] ?? "";
      name = `${key}-${String(obj.file_unique_id || "x").slice(0, 12)}${ext}`;
    }
    return {
      file_id: obj.file_id,
      file_unique: obj.file_unique_id ?? null,
      name,
      size: Number(obj.file_size || 0),
      mime: obj.mime_type ?? null
    };
  }
  const photos = msg?.photo;
  if (Array.isArray(photos) && photos.length) {
    const best = photos.reduce((a, b) => Number(b?.file_size || 0) > Number(a?.file_size || 0) ? b : a);
    if (best?.file_id) {
      return {
        file_id: best.file_id,
        file_unique: best.file_unique_id ?? null,
        name: `photo-${String(best.file_unique_id || "x").slice(0, 12)}.jpg`,
        size: Number(best.file_size || 0),
        mime: "image/jpeg"
      };
    }
  }
  return null;
}
__name(incomingFile, "incomingFile");
async function handleFileMessage(env, msg, cid, info) {
  const token = env.TG_BOT_TOKEN;
  const inbox = env.TG_BOT_INBOX || DEFAULT_INBOX;
  let targetPath = null;
  const cap = String(msg?.caption || "").trim();
  if (cap.startsWith("/")) targetPath = cap.split(/\r?\n/)[0].trim();
  if (info.file_unique) {
    const dup = await env.DB.prepare("SELECT id, name FROM files WHERE file_unique = ?").bind(info.file_unique).first();
    if (dup) {
      await sendMessage(
        token,
        cid,
        `\u8FD9\u4E2A\u6587\u4EF6\u5DF2\u7ECF\u5728\u6C60\u5B50\u91CC\u4E86\uFF0C\u672A\u91CD\u590D\u6536\u5F55\u3002

#${dup.id}  ${dup.name}`
      );
      return;
    }
  }
  let fid;
  if (targetPath) {
    fid = await ensureFolderPath(env.DB, targetPath);
  } else {
    const row = await env.DB.prepare("SELECT id FROM folders WHERE parent_id IS NULL AND name = ?").bind(inbox).first();
    if (row) {
      fid = row.id;
    } else {
      const res2 = await env.DB.prepare("INSERT INTO folders(name, parent_id, path, created_at) VALUES(?, NULL, ?, ?)").bind(inbox, `/${inbox}`, Date.now() / 1e3).run();
      fid = Number(res2.meta.last_row_id);
      await bumpCounters(env.DB, { folders: 1 });
      await logEvent(env.DB, "mkdir", { path: `/${inbox}` });
    }
  }
  const created = Date.now() / 1e3;
  const path = await pathOf(env.DB, fid);
  const res = await env.DB.prepare(
    `INSERT INTO files(name, size, mime, file_id, file_unique, message_id, chat_id, folder_id, created_at, full_key)
       VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    info.name,
    info.size,
    info.mime,
    info.file_id,
    info.file_unique,
    msg?.message_id ?? null,
    String(cid),
    fid,
    created,
    fileKeyOf(path, info.name)
  ).run();
  const newId = Number(res.meta.last_row_id);
  await bumpCounters(env.DB, { files: 1, bytes: Number(info.size || 0) });
  await logEvent(env.DB, "add", {
    id: newId,
    name: info.name,
    size: info.size,
    mime: info.mime,
    tg_file_id: info.file_id,
    tg_unique: info.file_unique,
    message_id: msg?.message_id ?? null,
    chat_id: String(cid),
    path,
    created_at: created
  });
  if (!cap && msg?.message_id) {
    await editMessageCaption(token, cid, msg.message_id, `TGPOOL ${path}`);
  }
  await sendMessage(
    token,
    cid,
    `\u5DF2\u6536\u5F55 #${newId}
${info.name}
${human(info.size)} \xB7 ${path}

\u60F3\u653E\u522B\u7684\u76EE\u5F55\uFF1A\u53D1\u6587\u4EF6\u65F6\u5728\u8BF4\u660E\u91CC\u5199\u4E00\u884C\u8DEF\u5F84\uFF0C\u4F8B\uFF1A/\u5DE5\u4F5C/2026
\uFF08\u76EE\u5F55\u4E0D\u5B58\u5728\u4F1A\u81EA\u52A8\u521B\u5EFA\uFF09`
  );
}
__name(handleFileMessage, "handleFileMessage");
// 翻页键盘：只有多于 1 页才给键盘，避免单页时多一条无意义按钮
function pageKeyboard(prefix, key, page, totalPages) {
  if (!(totalPages > 1)) return null;
  const row = [];
  if (page > 1) row.push({ text: "\u25C0 \u4E0A\u4E00\u9875", callback_data: `${prefix}:${key}:${page - 1}` });
  row.push({ text: `${page} / ${totalPages}`, callback_data: "noop" });
  if (page < totalPages) row.push({ text: "\u4E0B\u4E00\u9875 \u25B6", callback_data: `${prefix}:${key}:${page + 1}` });
  return { inline_keyboard: [row] };
}
__name(pageKeyboard, "pageKeyboard");
// 从参数里抽出显式页码（#3 或 -p 3）。裸数字不当页码 —— 否则 /search 2026 会被吃掉。
function extractExplicitPage(args) {
  const rest = [];
  let page = 1;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    const m = /^#(\d{1,6})$/.exec(a);
    if (m) {
      page = Number(m[1]);
      continue;
    }
    if (a === "-p" || a === "-page") {
      const n = args[i + 1];
      if (n && /^\d{1,6}$/.test(n)) {
        page = Number(n);
        i += 1;
      }
      continue;
    }
    rest.push(a);
  }
  return { rest, page: Math.max(1, page) };
}
__name(extractExplicitPage, "extractExplicitPage");
// /ls 专用：末尾裸数字当页码，但仅当"整条路径解析不出目录、而掐掉数字后能解析"时才认
async function parseLsTarget(env, raw) {
  const s = (raw || "").trim();
  if (!s) return { path: "", page: 1 };
  const m = /^(.*\S)[\s]+(\d{1,6})$/.exec(s);
  if (!m) return { path: s, page: 1 };
  const head = m[1].trim();
  const full = await resolvePath(env.DB, normPath(s));
  if (!full.err) return { path: s, page: 1 };
  const headFolder = await resolvePath(env.DB, normPath(head));
  if (!headFolder.err) return { path: head, page: Math.max(1, Number(m[2])) };
  return { path: s, page: 1 };
}
__name(parseLsTarget, "parseLsTarget");
async function replyLs(env, cid, path, page = 1) {
  const token = env.TG_BOT_TOKEN;
  const here = normPath(path);
  const folder = await resolvePath(env.DB, here);
  if (folder.err) {
    const node = await resolveNode(env.DB, here);
    if (node.kind === "file" && node.id !== null) {
      const row = await env.DB.prepare("SELECT name FROM files WHERE id = ?").bind(node.id).first();
      const fname = row?.name ?? here.split("/").pop() ?? here;
      const parent = parentPath(here);
      await sendMessage(
        token,
        cid,
        `\u300C${fname}\u300D\u662F\u6587\u4EF6\uFF0C\u4E0D\u662F\u76EE\u5F55 \u2014\u2014 /ls \u53EA\u80FD\u5217\u76EE\u5F55\u3002

\u53D6\u56DE\u5B83\uFF1A
/get ${here}

\u770B\u5B83\u6240\u5728\u7684\u76EE\u5F55\uFF1A
/ls ${parent}`
      );
      return;
    }
    await sendMessage(token, cid, `${folder.err}

\u7528 /ls \u67E5\u770B\u6839\u76EE\u5F55\u3002`);
    return;
  }
  await renderLs(env, cid, folder.id, page);
}
__name(replyLs, "replyLs");
async function replyLsById(env, cid, cbid, fid, page = 1) {
  const exists = fid === null ? true : !!(await env.DB.prepare("SELECT id FROM folders WHERE id = ?").bind(fid).first());
  if (!exists) {
    await tgCall(env.TG_BOT_TOKEN, "answerCallbackQuery", { callback_query_id: cbid, text: "\u8FD9\u4E2A\u76EE\u5F55\u5DF2\u4E0D\u5B58\u5728" });
    await sendMessage(env.TG_BOT_TOKEN, cid, "\u8FD9\u4E2A\u76EE\u5F55\u5DF2\u7ECF\u4E0D\u5B58\u5728\u4E86\uFF0C\u91CD\u65B0 /ls \u770B\u4E00\u4E0B\u3002");
    return;
  }
  await tgCall(env.TG_BOT_TOKEN, "answerCallbackQuery", { callback_query_id: cbid });
  await renderLs(env, cid, fid, page);
}
__name(replyLsById, "replyLsById");
// 目录渲染（分页版）：只取当前页的 20 个文件，不再一次拉 100 个再截断
async function renderLs(env, cid, fid, page = 1) {
  const token = env.TG_BOT_TOKEN;
  const hereStr = await pathOfId(env.DB, fid);
  const total = await countFilesIn(env.DB, fid);
  const totalPages = Math.max(1, Math.ceil(total / BOT_PAGE));
  const wantPage = Math.max(1, Number(page) || 1);
  if (wantPage > totalPages) {
    await sendMessage(
      token,
      cid,
      `\u300C${hereStr}\u300D\u53EA\u6709 ${totalPages} \u9875\uFF08\u5171 ${total} \u4E2A\u6587\u4EF6\uFF09\uFF0C\u6CA1\u6709\u7B2C ${wantPage} \u9875\u3002

/ls ${hereStr} #1`
    );
    return;
  }
  const offset = (wantPage - 1) * BOT_PAGE;
  const files = await listFiles(env.DB, fid, BOT_PAGE, offset);
  const subs = wantPage === 1 ? await listSubfolders(env.DB, fid) : [];
  const lines = [`\u76EE\u5F55 ${hereStr}`, ""];
  if (subs.length) {
    lines.push(`\u5B50\u76EE\u5F55\uFF08${subs.length}\uFF09`);
    for (const s of subs.slice(0, BOT_DIR_LIMIT)) {
      lines.push(`  ${s.name}/   ${s.files} \u6587\u4EF6 \xB7 ${s.subs} \u5B50\u76EE\u5F55`);
    }
    if (subs.length > BOT_DIR_LIMIT) lines.push(`  \u2026\u53E6\u6709 ${subs.length - BOT_DIR_LIMIT} \u4E2A\uFF0C\u76F4\u63A5 /ls <\u8DEF\u5F84> \u8FDB\u53BB\u770B`);
    lines.push("");
  }
  if (files.length) {
    lines.push(`\u6587\u4EF6\uFF08\u5171 ${total} \xB7 \u7B2C ${wantPage} / ${totalPages} \u9875\uFF09`);
    files.forEach((f, i) => {
      lines.push(`${offset + i + 1}. ${f.name}   ${human(f.size)} \xB7 #${f.id}`);
    });
  }
  if (!files.length && !subs.length) lines.push("\uFF08\u7A7A\u76EE\u5F55\uFF09");
  const media = files.map((f) => ({ id: f.id, name: f.name, file_id: f.file_id, kind: mediaKind(f.name, f.mime) })).filter((m) => m.kind !== null);
  if (media.length > ALBUM_MAX) {
    const n = ALBUM_FAMILY.reduce((acc, [, want]) => acc + albumChunks(media.filter((m) => m.kind === want)).length, 0);
    lines.push(`\uFF08\u56FE\u7247/\u89C6\u9891\u5171 ${media.length} \u4E2A\uFF0C\u7F29\u7565\u56FE\u5206 ${n} \u6761\u6D88\u606F\u53D1\uFF09`);
  }
  lines.push(
    "",
    "\u53D6\u6587\u4EF6\uFF1A/get #\u7F16\u53F7\uFF08\u884C\u5C3E\u90A3\u4E2A #\u6570\u5B57\uFF09\u3000\u8FDB\u76EE\u5F55\uFF1A/ls \u5B8C\u6574\u8DEF\u5F84 [#\u9875\u53F7]",
    "\u5220\uFF1A/rm \u8DEF\u5F84\u3000\u79FB\uFF1A/move \u6E90 \u76EE\u6807\u3000\u6539\u540D\uFF1A/rename \u8DEF\u5F84 \u65B0\u540D"
  );
  const kb = pageKeyboard("ls", fid === null ? "r" : String(fid), wantPage, totalPages);
  await sendMessage(token, cid, clip(lines.join("\n"), MSG_LIMIT), kb ? { reply_markup: kb } : {});
  if (media.length) await sendMediaAlbum(env, cid, media);
}
__name(renderLs, "renderLs");
function albumChunks(items) {
  const out = [];
  for (let i = 0; i < items.length; i += ALBUM_MAX) out.push(items.slice(i, i + ALBUM_MAX));
  return out;
}
__name(albumChunks, "albumChunks");
async function sendMediaAlbum(env, cid, items) {
  const token = env.TG_BOT_TOKEN;
  for (const [, want, prefer] of ALBUM_FAMILY) {
    const group = items.filter((m) => m.kind === want);
    if (!group.length) continue;
    for (const chunk of albumChunks(group)) {
      try {
        if (chunk.length === 1) {
          const single = ALBUM_SINGLE[prefer] ?? ALBUM_SINGLE.document;
          const r = await tgCall(token, single[0], {
            chat_id: cid,
            [single[1]]: chunk[0].file_id,
            caption: `#${chunk[0].id} ${chunk[0].name}`
          });
          if (r.ok) continue;
          const d = await tgCall(token, "sendDocument", {
            chat_id: cid,
            document: chunk[0].file_id,
            caption: `#${chunk[0].id} ${chunk[0].name}`
          });
          if (!d.ok) console.warn("single media send failed", tgErr(d));
          continue;
        }
        const asType = await tgCall(token, "sendMediaGroup", {
          chat_id: cid,
          media: chunk.map((m) => ({
            type: prefer,
            media: m.file_id,
            caption: `#${m.id} ${m.name}`.slice(0, 1024)
          }))
        });
        if (asType.ok) continue;
        const asDoc = await tgCall(token, "sendMediaGroup", {
          chat_id: cid,
          media: chunk.map((m) => ({
            type: "document",
            media: m.file_id,
            caption: `#${m.id} ${m.name}`.slice(0, 1024)
          }))
        });
        if (!asDoc.ok) console.warn("album send failed", tgErr(asDoc));
      } catch (e) {
        console.warn("media album error", e.message);
      }
    }
  }
}
__name(sendMediaAlbum, "sendMediaAlbum");
async function sendFile(env, cid, fid) {
  const token = env.TG_BOT_TOKEN;
  const row = await env.DB.prepare("SELECT file_id, message_id, chat_id FROM files WHERE id = ?").bind(fid).first();
  if (!row) return false;
  if (row.message_id) {
    const r = await copyMessage(token, cid, row.chat_id || env.TG_CHAT_ID || String(cid), row.message_id);
    if (r.ok) return true;
    console.warn("copyMessage failed", { fid, why: tgErr(r) });
  }
  const r2 = await sendDocumentById(token, cid, row.file_id);
  if (r2.ok) return true;
  console.warn("sendDocument(file_id) failed", { fid, why: tgErr(r2) });
  return false;
}
__name(sendFile, "sendFile");
// 搜索分页：命中总数算一次缓存住（pending_sr 表），翻页不再重复全表扫
async function resolveSearchState(env, q) {
  const now = Date.now() / 1e3;
  try {
    const row = await env.DB.prepare(
      "SELECT token, total FROM pending_sr WHERE q = ? AND ts > ? ORDER BY ts DESC LIMIT 1"
    ).bind(q, now - SEARCH_TOTAL_TTL).first();
    if (row && row.total !== null && row.total !== void 0) {
      return { token: row.token, total: Number(row.total) };
    }
  } catch (e) {
    console.warn("pending_sr lookup failed", e.message);
  }
  const probe = await searchFilesPage(env.DB, q, 1, 0, true);
  const total = probe.total ?? 0;
  const tk = randomToken(8);
  try {
    await env.DB.prepare("INSERT INTO pending_sr(token, q, total, ts) VALUES(?,?,?,?) ON CONFLICT(token) DO UPDATE SET q=excluded.q, total=excluded.total, ts=excluded.ts").bind(tk, q, total, now).run();
    if (Math.random() < 0.15) await prunePendingSr(env.DB);
  } catch (e) {
    console.warn("pending_sr insert failed", e.message);
  }
  return { token: tk, total };
}
__name(resolveSearchState, "resolveSearchState");
async function replySearch(env, cid, kw, page = 1) {
  const wantPage = Math.max(1, Number(page) || 1);
  const { token: tk, total } = await resolveSearchState(env, kw);
  if (!total) {
    await sendMessage(env.TG_BOT_TOKEN, cid, `\u6CA1\u6709\u5339\u914D\u300C${kw}\u300D\u7684\u6587\u4EF6\u3002`);
    return;
  }
  const totalPages = Math.max(1, Math.ceil(total / BOT_PAGE));
  if (wantPage > totalPages) {
    await sendMessage(
      env.TG_BOT_TOKEN,
      cid,
      `\u300C${kw}\u300D\u53EA\u6709 ${totalPages} \u9875\uFF08\u547D\u4E2D ${total} \u4E2A\uFF09\uFF0C\u6CA1\u6709\u7B2C ${wantPage} \u9875\u3002

/search ${kw} #1`
    );
    return;
  }
  await renderSearch(env, cid, kw, total, totalPages, tk, wantPage);
}
__name(replySearch, "replySearch");
async function replySearchByToken(env, cid, cbid, tk, page = 1) {
  const row = await env.DB.prepare("SELECT q, total FROM pending_sr WHERE token = ?").bind(tk).first();
  if (!row) {
    await tgCall(env.TG_BOT_TOKEN, "answerCallbackQuery", { callback_query_id: cbid, text: "\u8FD9\u6761\u641C\u7D22\u5DF2\u5931\u6548\u6216\u8FC7\u671F\uFF0C\u8BF7\u91CD\u65B0 /search" });
    return;
  }
  await tgCall(env.TG_BOT_TOKEN, "answerCallbackQuery", { callback_query_id: cbid });
  const total = Number(row.total ?? 0);
  await renderSearch(env, cid, row.q, total, Math.max(1, Math.ceil(total / BOT_PAGE)), tk, Math.max(1, Number(page) || 1));
}
__name(replySearchByToken, "replySearchByToken");
async function renderSearch(env, cid, kw, total, totalPages, tk, page) {
  const offset = (page - 1) * BOT_PAGE;
  const { items } = await searchFilesPage(env.DB, kw, BOT_PAGE, offset, false);
  const lines = [`\u641C\u7D22\u300C${kw}\u300D\xB7 \u547D\u4E2D ${total} \u4E2A \xB7 \u7B2C ${page} / ${totalPages} \u9875`, ""];
  for (const it of items) {
    lines.push(`#${it.id}  ${it.name}`);
    lines.push(`   ${human(it.size)} \xB7 ${it.path_str}`);
  }
  if (!items.length) lines.push("\uFF08\u8FD9\u4E00\u9875\u6CA1\u6709\u5185\u5BB9\uFF09");
  lines.push("", "\u53D6\u56DE\uFF1A/get #\u7F16\u53F7\u3000\u7FFB\u9875\uFF1A\u4E0B\u65B9\u6309\u94AE\uFF0C\u6216 /search \u5173\u952E\u8BCD #\u9875\u53F7");
  const kb = pageKeyboard("sr", tk, page, totalPages);
  await sendMessage(env.TG_BOT_TOKEN, cid, clip(lines.join("\n"), MSG_LIMIT), kb ? { reply_markup: kb } : {});
}
__name(renderSearch, "renderSearch");
async function replyRm(env, cid, body) {
  const token = env.TG_BOT_TOKEN;
  const args = splitArgs(body);
  const flags = new Set(args.filter((a) => a.startsWith("-")));
  const rest = args.filter((a) => !a.startsWith("-"));
  const want = flags.has("-file") ? "file" : flags.has("-dir") ? "folder" : "";
  const force = flags.has("-f") || flags.has("-force");
  if (!rest.length) {
    await sendMessage(
      token,
      cid,
      '\u7528\u6CD5\uFF1A/rm \u8DEF\u5F84\u2026\n  \u53EF\u4EE5\u4E00\u53E3\u6C14\u5220\u591A\u4E2A\uFF1A/rm /\u5DE5\u4F5C/2026 /a/b.txt #13\n  \u5220\u76EE\u5F55\u4F1A\u5148\u5F39\u4E00\u6B21\u786E\u8BA4\u6309\u94AE\uFF0C\u52A0 -f \u8DF3\u8FC7\n  -file / -dir \u7528\u4E8E\u540C\u540D\u6D88\u6B67\u3000/rm #13 \u6309\u7F16\u53F7\u5220\u6587\u4EF6'
    );
    return;
  }
  if (rest.length > MAX_RM_TARGETS) {
    await sendMessage(token, cid, `\u4E00\u6B21\u6700\u591A\u5220 ${MAX_RM_TARGETS} \u4E2A\u76EE\u6807\uFF08\u8FD9\u6B21\u7ED9\u4E86 ${rest.length} \u4E2A\uFF09\uFF0C\u8BF7\u5206\u6279\u3002`);
    return;
  }
  // ---- 单目标：完全保留原行为（文件直接删、目录弹确认）----
  if (rest.length === 1) {
    const target = rest[0];
    if (/^#?\d+$/.test(target)) {
      const fid = Number(target.replace(/^#/, ""));
      const row = await env.DB.prepare("SELECT id, name FROM files WHERE id = ?").bind(fid).first();
      if (!row) {
        await sendMessage(token, cid, `\u6CA1\u6709 #${fid} \u8FD9\u4E2A\u6587\u4EF6\u3002`);
        return;
      }
      await doDeleteFile(env, cid, fid, row.name);
      return;
    }
    const node = await resolveNode(env.DB, target, want);
    if (!node.kind) {
      await sendMessage(token, cid, node.err || `\u627E\u4E0D\u5230\uFF1A${target}`);
      return;
    }
    if (node.kind === "file") {
      const row = await env.DB.prepare("SELECT name FROM files WHERE id = ?").bind(node.id).first();
      await doDeleteFile(env, cid, node.id, row?.name ?? target);
      return;
    }
    if (node.id === null) {
      await sendMessage(token, cid, "\u6839\u76EE\u5F55\u4E0D\u80FD\u5220\u3002");
      return;
    }
    const p = (await pathOfId(env.DB, node.id)) || target;
    const sub = await collectSubtreeFast(env.DB, p);
    const parent = await resolvePath(env.DB, parentPath(p));
    let sameNameFile = null;
    if (!parent.err && p !== "/") {
      sameNameFile = await env.DB.prepare("SELECT id FROM files WHERE folder_id IS ? AND name = ?").bind(parent.id, p.split("/").pop() ?? "").first();
    }
    const sameHint = sameNameFile ? `

\u6CE8\u610F\uFF1A\u540C\u7EA7\u8FD8\u6709\u4E2A\u540C\u540D**\u6587\u4EF6**\uFF08#${sameNameFile.id}\uFF09\u3002\u53EA\u5220\u5B83\u8BF7\u7528\uFF1A
/rm ${p} -file` : "";
    if (force) {
      await doDeleteFolder(env, cid, p, sub);
      return;
    }
    const stat = `\u76EE\u5F55 ${p}

\u5305\u542B ${sub.folderCount} \u4E2A\u76EE\u5F55\u3001${sub.files.length} \u4E2A\u6587\u4EF6\uFF0C\u5171 ${human(sub.bytes)}\u3002
\u5220\u9664\u540E\u5C06\u4ECE Telegram \u4E00\u5E76\u79FB\u9664\uFF0C\u4E14\u4E0D\u53EF\u6062\u590D\u3002`;
    const tk = randomToken(12);
    await env.DB.prepare("INSERT INTO pending_rm(token, path, folder_id, chat_id, files, folders, bytes, ts) VALUES(?,?,?,?,?,?,?,?)").bind(tk, p, node.id, String(cid), sub.files.length, sub.folderCount, sub.bytes, Date.now() / 1e3).run();
    await sendMessage(token, cid, stat + sameHint, {
      reply_markup: {
        inline_keyboard: [[
          { text: "\u786E\u8BA4\u5220\u9664", callback_data: `rm:ok:${tk}` },
          { text: "\u53D6\u6D88", callback_data: `rm:no:${tk}` }
        ]]
      }
    });
    return;
  }
  // ---- 多目标：全部解析完，合并成一条确认 ----
  const nodes = await resolveManyNodes(env.DB, rest);
  const fileIds = [];
  const folderIds = [];
  const bad = [];
  for (const raw of rest) {
    const n = nodes.get(raw);
    if (!n || n.kind === null) {
      bad.push(`${raw}\uFF08${n?.err || "\u627E\u4E0D\u5230"}\uFF09`);
      continue;
    }
    if (n.kind === "folder" && n.id === null) bad.push(`${raw}\uFF08\u6839\u76EE\u5F55\u4E0D\u80FD\u5220\uFF09`);
    else if (n.kind === "folder") folderIds.push(n.id);
    else fileIds.push(n.id);
  }
  if (!fileIds.length && !folderIds.length) {
    await sendMessage(token, cid, `\u5168\u90FD\u6CA1\u627E\u5230\uFF1A\n${bad.join("\n")}`);
    return;
  }
  if (folderIds.length > BATCH_DEL_FOLDER_LIMIT) {
    await sendMessage(token, cid, `\u4E00\u6B21\u6700\u591A\u5220 ${BATCH_DEL_FOLDER_LIMIT} \u4E2A\u76EE\u5F55\uFF08\u8FD9\u6B21 ${folderIds.length} \u4E2A\uFF09\uFF0C\u8BF7\u5206\u6279\u3002`);
    return;
  }
  const plan = await planBatchDelete(env.DB, fileIds, folderIds);
  const badHint = bad.length ? `\n\n\u8DF3\u8FC7 ${bad.length} \u4E2A\uFF1A\n${bad.slice(0, 5).join("\n")}` : "";
  // 和单条接口同口径：显式点名的文件直接删（单选文件本来就不弹确认），
  // 只有「目录里有东西」才需要确认按钮。
  const risky = plan.sub.files.length > 0 || plan.folders > plan.roots.length;
  if (force || !risky) {
    const n = await deleteMessages(token, [...plan.sub.files, ...plan.filesSel], env.TG_CHAT_ID || String(cid));
    const res = await applyBatchDelete(env, plan);
    await sendMessage(token, cid, `\u5DF2\u5220\u9664 ${res.deleted_files} \u4E2A\u6587\u4EF6\u3001${res.deleted_folders} \u4E2A\u76EE\u5F55\uFF08\u5171 ${human(plan.bytes)}\uFF09\nTelegram \u4FA7\u5220\u9664 ${n} \u6761\u6D88\u606F${badHint}`);
    return;
  }
  const tk = randomToken(12);
  await env.DB.prepare("INSERT INTO pending_rm(token, path, folder_id, chat_id, files, folders, bytes, ts) VALUES(?,?,?,?,?,?,?,?)")
    .bind(tk, JSON.stringify({ fileIds: plan.filesSel.map((r) => Number(r.id)), folderIds }), -1, String(cid), plan.files, plan.folders, plan.bytes, Date.now() / 1e3)
    .run();
  await sendMessage(
    token,
    cid,
    `\u5C06\u5220\u9664 ${plan.folders} \u4E2A\u76EE\u5F55\u3001${plan.files} \u4E2A\u6587\u4EF6\uFF0C\u5171 ${human(plan.bytes)}\u3002\n\u5220\u9664\u540E\u5C06\u4ECE Telegram \u4E00\u5E76\u79FB\u9664\uFF0C\u4E0D\u53EF\u6062\u590D\u3002${badHint}`,
    {
      reply_markup: {
        inline_keyboard: [[
          { text: "\u786E\u8BA4\u5220\u9664", callback_data: `brm:ok:${tk}` },
          { text: "\u53D6\u6D88", callback_data: `brm:no:${tk}` }
        ]]
      }
    }
  );
}
__name(replyRm, "replyRm");
async function doDeleteFile(env, cid, fid, name) {
  const row = await env.DB.prepare("SELECT id, chat_id, message_id, size FROM files WHERE id = ?").bind(fid).first();
  if (!row) {
    await sendMessage(env.TG_BOT_TOKEN, cid, `\u6CA1\u6709 #${fid} \u8FD9\u4E2A\u6587\u4EF6\u3002`);
    return;
  }
  const n = await deleteMessages(env.TG_BOT_TOKEN, [row], env.TG_CHAT_ID || String(cid));
  await env.DB.prepare("DELETE FROM files WHERE id = ?").bind(fid).run();
  await bumpCounters(env.DB, { files: -1, bytes: -Number(row.size || 0) });
  await logEvent(env.DB, "del", { id: fid });
  await sendMessage(
    env.TG_BOT_TOKEN,
    cid,
    `\u5DF2\u5220\u9664 #${fid}  ${name}
\uFF08Telegram \u4FA7\u6D88\u606F\u5220\u9664 ${n} \u6761\uFF09`
  );
}
__name(doDeleteFile, "doDeleteFile");
// 目录删除：先把 Telegram 侧消息删掉（需要 message_id），再用 2 条 SQL 清索引
async function doDeleteFolder(env, cid, path, sub) {
  const n = await deleteMessages(env.TG_BOT_TOKEN, sub.files, env.TG_CHAT_ID || String(cid));
  const del = await purgeSubtree(env.DB, path);
  await bumpCounters(env.DB, { files: -del.files, folders: -del.folders, bytes: -Number(sub.bytes || 0) });
  await logEvent(env.DB, "rmd", { path });
  await sendMessage(
    env.TG_BOT_TOKEN,
    cid,
    `\u5DF2\u5220\u9664\u76EE\u5F55 ${path}
${del.folders} \u4E2A\u76EE\u5F55\u3001${del.files} \u4E2A\u6587\u4EF6 \uFF08\u5171 ${human(sub.bytes)}\uFF09\uFF0CTelegram \u4FA7\u5220\u9664 ${n} \u6761\u6D88\u606F`
  );
}
__name(doDeleteFolder, "doDeleteFolder");
async function handleCallback(env, cb) {
  const token = env.TG_BOT_TOKEN;
  const data = cb?.data || "";
  const cbid = cb?.id;
  const msg = cb?.message;
  const cid = msg?.chat?.id;
  if (!allowed(env, cid, cb?.from?.id)) {
    await tgCall(token, "answerCallbackQuery", { callback_query_id: cbid, text: "\u65E0\u6743\u64CD\u4F5C" });
    return;
  }
  if (data === "noop" || /^(ls|sr):/.test(data)) {
    await handlePageCallback(env, cid, cbid, data);
    return;
  }
  const bm = /^brm:(ok|no):([0-9a-f]+)$/.exec(data);
  if (bm) {
    await handleBatchRmCallback(env, cid, cbid, msg, bm[1], bm[2]);
    return;
  }
  const m = /^rm:(ok|no):([0-9a-f]+)$/.exec(data);
  if (!m) {
    await tgCall(token, "answerCallbackQuery", { callback_query_id: cbid });
    return;
  }
  const [, action, tk] = m;
  const row = await env.DB.prepare("SELECT token, path, folder_id, chat_id, files, folders, bytes, ts FROM pending_rm WHERE token = ?").bind(tk).first();
  if (!row) {
    await tgCall(token, "answerCallbackQuery", { callback_query_id: cbid, text: "\u8FD9\u4E2A\u786E\u8BA4\u5DF2\u5931\u6548" });
    if (msg?.message_id) {
      await tgCall(token, "editMessageReplyMarkup", { chat_id: cid, message_id: msg.message_id });
    }
    return;
  }
  await env.DB.prepare("DELETE FROM pending_rm WHERE token = ?").bind(tk).run();
  if (Date.now() / 1e3 - row.ts > PENDING_TTL) {
    await tgCall(token, "answerCallbackQuery", { callback_query_id: cbid, text: "\u5DF2\u8D85\u65F6\uFF0C\u8BF7\u91CD\u65B0\u6267\u884C /rm" });
    if (msg?.message_id) {
      await tgCall(token, "editMessageReplyMarkup", { chat_id: cid, message_id: msg.message_id });
    }
    return;
  }
  if (action === "no") {
    await tgCall(token, "answerCallbackQuery", { callback_query_id: cbid, text: "\u5DF2\u53D6\u6D88" });
    if (msg?.message_id) {
      await tgCall(token, "editMessageText", {
        chat_id: cid,
        message_id: msg.message_id,
        text: `\u5DF2\u53D6\u6D88\u5220\u9664 ${row.path}`
      });
    }
    return;
  }
  await tgCall(token, "answerCallbackQuery", { callback_query_id: cbid, text: "\u6B63\u5728\u5220\u9664\u2026" });
  const node = await resolveNode(env.DB, row.path, "folder");
  if (!node.kind || node.id === null) {
    if (msg?.message_id) {
      await tgCall(token, "editMessageText", {
        chat_id: cid,
        message_id: msg.message_id,
        text: `${row.path} \u5DF2\u4E0D\u5B58\u5728\u3002`
      });
    }
    return;
  }
  const sub = await collectSubtreeFast(env.DB, row.path);
  if (msg?.message_id) {
    await tgCall(token, "editMessageText", {
      chat_id: cid,
      message_id: msg.message_id,
      text: `\u5DF2\u786E\u8BA4\u5220\u9664 ${row.path}`
    });
  }
  await doDeleteFolder(env, cid, row.path, sub);
}
__name(handleCallback, "handleCallback");
// 多目标删除的确认按钮（brm:ok / brm:no）。pending_rm 里用 folder_id = -1 标记批量，
// path 存 JSON（{fileIds:[...], folderIds:[...]}）——复用同一张表，不新加表。
async function handleBatchRmCallback(env, cid, cbid, msg, action, tk) {
  const token = env.TG_BOT_TOKEN;
  const row = await env.DB.prepare("SELECT token, path, folder_id, chat_id, files, folders, bytes, ts FROM pending_rm WHERE token = ?").bind(tk).first();
  const clearButtons = async () => {
    if (msg?.message_id) await tgCall(token, "editMessageReplyMarkup", { chat_id: cid, message_id: msg.message_id });
  };
  if (!row) {
    await tgCall(token, "answerCallbackQuery", { callback_query_id: cbid, text: "\u8FD9\u4E2A\u786E\u8BA4\u5DF2\u5931\u6548" });
    await clearButtons();
    return;
  }
  await env.DB.prepare("DELETE FROM pending_rm WHERE token = ?").bind(tk).run();
  if (Date.now() / 1e3 - row.ts > PENDING_TTL) {
    await tgCall(token, "answerCallbackQuery", { callback_query_id: cbid, text: "\u5DF2\u8D85\u65F6\uFF0C\u8BF7\u91CD\u65B0\u6267\u884C /rm" });
    await clearButtons();
    return;
  }
  if (action === "no") {
    await tgCall(token, "answerCallbackQuery", { callback_query_id: cbid, text: "\u5DF2\u53D6\u6D88" });
    if (msg?.message_id) {
      await tgCall(token, "editMessageText", { chat_id: cid, message_id: msg.message_id, text: "\u5DF2\u53D6\u6D88\u6279\u91CF\u5220\u9664" });
    }
    return;
  }
  let payload = null;
  try {
    payload = JSON.parse(row.path);
  } catch {
    payload = null;
  }
  if (!payload) {
    await tgCall(token, "answerCallbackQuery", { callback_query_id: cbid, text: "\u8FD9\u4E2A\u786E\u8BA4\u5DF2\u5931\u6548" });
    await clearButtons();
    return;
  }
  await tgCall(token, "answerCallbackQuery", { callback_query_id: cbid, text: "\u6B63\u5728\u5220\u9664\u2026" });
  if (msg?.message_id) {
    await tgCall(token, "editMessageText", { chat_id: cid, message_id: msg.message_id, text: `\u5DF2\u786E\u8BA4\uFF0C\u6B63\u5728\u5220\u9664 ${row.files} \u4E2A\u6587\u4EF6 / ${row.folders} \u4E2A\u76EE\u5F55\u2026` });
  }
  const fileIds = Array.isArray(payload.fileIds) ? payload.fileIds.map(Number).filter((n) => Number.isFinite(n) && n > 0) : [];
  const folderIds = Array.isArray(payload.folderIds) ? payload.folderIds.map(Number).filter((n) => Number.isFinite(n) && n > 0) : [];
  const plan = await planBatchDelete(env.DB, fileIds, folderIds);
  const n = await deleteMessages(token, [...plan.sub.files, ...plan.filesSel], env.TG_CHAT_ID || String(cid));
  const res = await applyBatchDelete(env, plan);
  await sendMessage(token, cid, `\u5DF2\u5220\u9664 ${res.deleted_files} \u4E2A\u6587\u4EF6\u3001${res.deleted_folders} \u4E2A\u76EE\u5F55\uFF08\u5171 ${human(plan.bytes)}\uFF09\nTelegram \u4FA7\u5220\u9664 ${n} \u6761\u6D88\u606F`);
}
__name(handleBatchRmCallback, "handleBatchRmCallback");
// 翻页按钮回调：ls:<folderId|r>:<page> / sr:<token>:<page>
async function handlePageCallback(env, cid, cbid, data) {
  if (data === "noop") {
    await tgCall(env.TG_BOT_TOKEN, "answerCallbackQuery", { callback_query_id: cbid });
    return;
  }
  const ls = /^ls:(r|\d+):(\d{1,6})$/.exec(data);
  if (ls) {
    const fid = ls[1] === "r" ? null : Number(ls[1]);
    await replyLsById(env, cid, cbid, fid, Number(ls[2]));
    return;
  }
  const sr = /^sr:([0-9a-f]+):(\d{1,6})$/.exec(data);
  if (sr) {
    await replySearchByToken(env, cid, cbid, sr[1], Number(sr[2]));
    return;
  }
  await tgCall(env.TG_BOT_TOKEN, "answerCallbackQuery", { callback_query_id: cbid, text: "\u8FD9\u4E2A\u6309\u94AE\u5DF2\u5931\u6548" });
}
__name(handlePageCallback, "handlePageCallback");
// 用物化路径判断祖先关系：2 次单行查询，不再沿 parent_id 一圈圈往上查
async function isSelfOrDescendant(env, candidate, ancestor) {
  if (candidate === ancestor) return true;
  const cand = await pathOfId(env.DB, candidate);
  const anc = await pathOfId(env.DB, ancestor);
  if (anc === "/") return true;
  return cand === anc || cand.startsWith(anc.replace(/\/+$/, "") + "/");
}
__name(isSelfOrDescendant, "isSelfOrDescendant");
async function replyMove(env, cid, body) {
  const token = env.TG_BOT_TOKEN;
  const parts = splitArgs(body);
  if (parts.length < 1 || !parts[0]) {
    await sendMessage(
      token,
      cid,
      '\u7528\u6CD5\uFF1A/move \u6E90 \u76EE\u6807\n  \u76EE\u6807\u7559\u7A7A = \u632A\u5230\u6839\u76EE\u5F55\n\u4F8B\uFF1A/move /\u5DE5\u4F5C/2026 /\u5F52\u6863\u3000/move "/\u6211\u7684 \u62A5\u544A" /\u5F52\u6863\u3000/move /\u5F52\u6863/old\n'
    );
    return;
  }
  // 多目标语法：/move [-to 目标] 源1 源2 …
  // 不带 -to 时最后一个参数是目标 —— 与老的 /move 源 目标 完全兼容，单源行为一字不改。
  const ti = parts.indexOf("-to");
  let srcRaw = parts[0];
  let dstRaw = parts.length > 1 ? parts.slice(1).join(" ") : "/";
  if (ti >= 0) {
    if (ti + 1 >= parts.length) {
      await sendMessage(token, cid, "\u7528\u6CD5\uFF1A/move -to \u76EE\u6807 \u6E90\u2026\u3002-to \u540E\u9762\u8981\u8DDF\u76EE\u6807\u76EE\u5F55\u3002");
      return;
    }
    dstRaw = parts[ti + 1];
    const srcsTo = parts.filter((_, i) => i !== ti && i !== ti + 1).filter((s) => s && !s.startsWith("-"));
    if (!srcsTo.length) {
      await sendMessage(token, cid, "\u7528\u6CD5\uFF1A/move -to \u76EE\u6807 \u6E90\u2026\u3002\u6CA1\u770B\u5230\u6E90\u3002");
      return;
    }
    if (srcsTo.length > MAX_MOVE_TARGETS) {
      await sendMessage(token, cid, `\u4E00\u6B21\u6700\u591A\u79FB ${MAX_MOVE_TARGETS} \u9879\uFF08\u8FD9\u6B21 ${srcsTo.length} \u9879\uFF09\uFF0C\u8BF7\u5206\u6279\u3002`);
      return;
    }
    if (srcsTo.length > 1) {
      await replyMoveMany(env, cid, srcsTo, dstRaw);
      return;
    }
    srcRaw = srcsTo[0];
  } else if (parts.length > 2) {
    const srcsMulti = parts.slice(0, -1);
    if (srcsMulti.length > MAX_MOVE_TARGETS) {
      await sendMessage(token, cid, `\u4E00\u6B21\u6700\u591A\u79FB ${MAX_MOVE_TARGETS} \u9879\uFF08\u8FD9\u6B21 ${srcsMulti.length} \u9879\uFF09\uFF0C\u8BF7\u5206\u6279\u3002`);
      return;
    }
    await replyMoveMany(env, cid, srcsMulti, parts[parts.length - 1]);
    return;
  }
  const src = await resolveNode(env.DB, srcRaw);
  if (!src.kind) {
    await sendMessage(token, cid, src.err || `\u627E\u4E0D\u5230\uFF1A${srcRaw}`);
    return;
  }
  if (src.kind === "folder" && src.id === null) {
    await sendMessage(token, cid, "\u6839\u76EE\u5F55\u4E0D\u80FD\u79FB\u52A8\u3002");
    return;
  }
  const dst = await resolvePath(env.DB, dstRaw);
  if (dst.err) {
    await sendMessage(token, cid, `${dst.err}

\u76EE\u6807\u76EE\u5F55\u5FC5\u987B\u5DF2\u5B58\u5728\uFF1B\u7528 /ls \u770B\u770B\u6709\u54EA\u4E9B\u76EE\u5F55\uFF0C\u6216\u5148\u5EFA\u597D\u3002`);
    return;
  }
  // 注意：src.id 是「文件 id」时不能和 dst.id（目录 id）比 —— 两个表的主键会撞号
  if (src.kind === "folder" && dst.id === src.id) {
    await sendMessage(token, cid, "\u6E90\u548C\u76EE\u6807\u540C\u4E00\u4E2A\u76EE\u5F55\uFF0C\u6CA1\u5F97\u79FB\u3002");
    return;
  }
  const srcPath = normPath(srcRaw);
  const name = srcPath.split("/").pop() ?? "";
  if (src.kind === "folder" && src.id !== null && dst.id !== null) {
    if (await isSelfOrDescendant(env, dst.id, src.id)) {
      await sendMessage(token, cid, "\u4E0D\u80FD\u628A\u76EE\u5F55\u79FB\u52A8\u5230\u81EA\u5DF1\u6216\u81EA\u5DF1\u7684\u5B50\u76EE\u5F55\u91CC\u3002");
      return;
    }
  }
  if (src.kind === "file") {
    const clash = await env.DB.prepare("SELECT id FROM files WHERE folder_id IS ? AND name = ?").bind(dst.id, name).first();
    if (clash) {
      await sendMessage(token, cid, `\u76EE\u6807\u76EE\u5F55\u91CC\u5DF2\u7ECF\u6709\u540C\u540D\u6587\u4EF6\u300C${name}\u300D(#${clash.id})\uFF0C\u5148\u6539\u540D\u6216\u6362\u76EE\u5F55\u3002`);
      return;
    }
    const dstPathForFile = await pathOfId(env.DB, dst.id);
    await env.DB.prepare("UPDATE files SET folder_id = ?, full_key = ? WHERE id = ?").bind(dst.id, fileKeyOf(dstPathForFile, name), src.id).run();
    await logEvent(env.DB, "mv", { path: dstRaw, id: src.id });
  } else {
    const clash = await env.DB.prepare("SELECT id FROM folders WHERE parent_id IS ? AND name = ?").bind(dst.id, name).first();
    if (clash) {
      await sendMessage(token, cid, `\u76EE\u6807\u76EE\u5F55\u91CC\u5DF2\u7ECF\u6709\u540C\u540D\u5B50\u76EE\u5F55\u300C${name}/\u300D\uFF0C\u5148\u6539\u540D\u6216\u6362\u76EE\u5F55\u3002`);
      return;
    }
    const oldPath = await pathOfId(env.DB, src.id);
    const newPath = joinPath(await pathOfId(env.DB, dst.id), name);
    await env.DB.prepare("UPDATE folders SET parent_id = ?, path = ? WHERE id = ?").bind(dst.id, newPath, src.id).run();
    await repathSubtree(env.DB, src.id, oldPath, newPath);
    await repathFilesSubtree(env.DB, src.id, oldPath, newPath);
    await logEvent(env.DB, "mvd", { path: srcPath, new: newPath });
  }
  const shown = src.kind === "file" ? joinPath(dstRaw, name) : await pathOfId(env.DB, src.id);
  await sendMessage(token, cid, `\u5DF2\u79FB\u52A8
${srcPath}
\u2192 ${normPath(shown)}`);
}
__name(replyMove, "replyMove");
// 单个移动的执行体：目录 3 条 SQL（自身 + 子树 path + 子树 full_key），文件 1 条。
async function moveOne(env, src, dst, srcRaw) {
  const srcPath = normPath(srcRaw);
  const name = srcPath.slice(srcPath.lastIndexOf("/") + 1);
  if (src.kind === "file") {
    const clash = await env.DB.prepare("SELECT id FROM files WHERE folder_id IS ? AND name = ?").bind(dst.id, name).first();
    if (clash) return { ok: false, err: `\u76EE\u6807\u76EE\u5F55\u91CC\u5DF2\u7ECF\u6709\u540C\u540D\u6587\u4EF6\u300C${name}\u300D(#${clash.id})\uFF0C\u5148\u6539\u540D\u6216\u6362\u76EE\u5F55\u3002` };
    await env.DB.prepare("UPDATE files SET folder_id = ?, full_key = ? WHERE id = ?").bind(dst.id, fileKeyOf(dst.path, name), src.id).run();
    await logEvent(env.DB, "mv", { path: dst.path, id: src.id });
    return { ok: true, shown: joinPath(dst.path, name) };
  }
  if (dst.id !== null && src.id !== null && await isSelfOrDescendant(env, dst.id, src.id)) {
    return { ok: false, err: "\u4E0D\u80FD\u628A\u76EE\u5F55\u79FB\u52A8\u5230\u81EA\u5DF1\u6216\u81EA\u5DF1\u7684\u5B50\u76EE\u5F55\u91CC\u3002" };
  }
  const clash = await env.DB.prepare("SELECT id FROM folders WHERE parent_id IS ? AND name = ?").bind(dst.id, name).first();
  if (clash) return { ok: false, err: `\u76EE\u6807\u76EE\u5F55\u91CC\u5DF2\u7ECF\u6709\u540C\u540D\u5B50\u76EE\u5F55\u300C${name}/\u300D\uFF0C\u5148\u6539\u540D\u6216\u6362\u76EE\u5F55\u3002` };
  const oldPath = await pathOfId(env.DB, src.id);
  const newPath = joinPath(dst.path, name);
  await env.DB.prepare("UPDATE folders SET parent_id = ?, path = ? WHERE id = ?").bind(dst.id, newPath, src.id).run();
  await repathSubtree(env.DB, src.id, oldPath, newPath);
  await repathFilesSubtree(env.DB, src.id, oldPath, newPath);
  await logEvent(env.DB, "mvd", { path: srcPath, new: newPath });
  return { ok: true, shown: newPath };
}
__name(moveOne, "moveOne");
// 多源移动：源全部先一次批量解析（2 条 SQL），再逐个落库，最后给一张逐项清单。
async function replyMoveMany(env, cid, srcs, dstRaw) {
  const token = env.TG_BOT_TOKEN;
  const dst = await resolvePath(env.DB, normPath(dstRaw));
  if (dst.err) {
    await sendMessage(token, cid, `${dst.err}

\u76EE\u6807\u76EE\u5F55\u5FC5\u987B\u5DF2\u5B58\u5728\uFF1B\u7528 /ls \u770B\u770B\u6709\u54EA\u4E9B\u76EE\u5F55\uFF0C\u6216\u5148\u5EFA\u597D\u3002`);
    return;
  }
  const dstPath = await pathOfId(env.DB, dst.id);
  const nodes = await resolveManyNodes(env.DB, srcs);
  const lines = [];
  let okN = 0;
  for (const raw of srcs) {
    const node = nodes.get(raw);
    if (!node || node.kind === null) {
      lines.push(`\u2717 ${raw}\uFF1A${node?.err || "\u627E\u4E0D\u5230"}`);
      continue;
    }
    if (node.kind === "folder" && node.id === null) {
      lines.push(`\u2717 ${raw}\uFF1A\u6839\u76EE\u5F55\u4E0D\u80FD\u79FB\u52A8`);
      continue;
    }
    if (node.kind === "folder" && node.id === dst.id) {
      lines.push(`\u2717 ${raw}\uFF1A\u5DF2\u5728\u76EE\u6807\u76EE\u5F55\u91CC`);
      continue;
    }
    const r = await moveOne(env, node, { id: dst.id, path: dstPath }, raw);
    if (r.ok) {
      okN++;
      lines.push(`\u2713 ${normPath(raw)} \u2192 ${normPath(r.shown)}`);
    } else {
      lines.push(`\u2717 ${normPath(raw)}\uFF1A${r.err}`);
    }
  }
  await sendMessage(token, cid, `\u5DF2\u79FB\u52A8 ${okN}/${srcs.length} \u9879\uFF08\u76EE\u6807 ${dstPath}\uFF09

${lines.join("\n")}`);
}
__name(replyMoveMany, "replyMoveMany");
async function replyRename(env, cid, body) {
  const token = env.TG_BOT_TOKEN;
  const parts = splitArgs(body);
  if (parts.length < 2) {
    await sendMessage(
      token,
      cid,
      '\u7528\u6CD5\uFF1A/rename \u8DEF\u5F84 \u65B0\u540D\n  \u76EE\u5F55\u548C\u6587\u4EF6\u90FD\u80FD\u6539\uFF0C\u4F4D\u7F6E\u4E0D\u52A8\n  \u540C\u540D\u6D88\u6B67\u52A0 -file / -dir\n\u4F8B\uFF1A/rename /\u5DE5\u4F5C/2026 2026\u5F52\u6863\u3000/rename /a/b.txt c.txt\u3000/rename "/\u6211\u7684 \u62A5\u544A" \u62A5\u544A -dir'
    );
    return;
  }
  const flags = new Set(parts.filter((p) => /^-(file|dir)$/.test(p)));
  const rest = parts.filter((p) => !/^-(file|dir)$/.test(p));
  if (rest.length < 2) {
    await sendMessage(token, cid, "\u8DEF\u5F84\u548C\u65B0\u540D\u90FD\u8981\u7ED9\u3002");
    return;
  }
  const want = flags.has("-file") ? "file" : flags.has("-dir") ? "folder" : "";
  const srcRaw = rest[0];
  const newRaw = rest.slice(1).join(" ");
  const node = await resolveNode(env.DB, srcRaw, want);
  if (!node.kind || node.id === null) {
    await sendMessage(token, cid, node.err || `\u627E\u4E0D\u5230\uFF1A${srcRaw}`);
    return;
  }
  const srcPath = normPath(srcRaw);
  const parent = await resolvePath(env.DB, parentPath(srcPath));
  if (node.kind === "file") {
    const name2 = cleanFileName(newRaw);
    if (!name2) {
      await sendMessage(token, cid, "\u65B0\u540D\u5B57\u662F\u7A7A\u7684\u3002");
      return;
    }
    const row = await env.DB.prepare("SELECT name FROM files WHERE id = ?").bind(node.id).first();
    if (row?.name === name2) {
      await sendMessage(token, cid, "\u65B0\u540D\u5B57\u548C\u539F\u6765\u4E00\u6837\uFF0C\u6CA1\u6539\u52A8\u3002");
      return;
    }
    const clash2 = await env.DB.prepare("SELECT id FROM files WHERE folder_id IS ? AND name = ? AND id <> ?").bind(parent.id, name2, node.id).first();
    if (clash2) {
      await sendMessage(token, cid, `\u8FD9\u4E2A\u76EE\u5F55\u91CC\u5DF2\u7ECF\u6709\u300C${name2}\u300D(#${clash2.id}) \u4E86\u3002`);
      return;
    }
    await env.DB.prepare("UPDATE files SET name = ?, full_key = ? WHERE id = ?").bind(name2, await fileKeyFor(env.DB, parent.id, name2), node.id).run();
    await logEvent(env.DB, "ren", { id: node.id, name: name2, path: parentPath(srcPath) });
    await sendMessage(token, cid, `\u5DF2\u6539\u540D
${row?.name ?? srcRaw}
\u2192 ${name2}`);
    return;
  }
  const name = cleanFolderName(newRaw);
  const oldRow = await env.DB.prepare("SELECT name FROM folders WHERE id = ?").bind(node.id).first();
  if (oldRow?.name === name) {
    await sendMessage(token, cid, "\u65B0\u540D\u5B57\u548C\u539F\u6765\u4E00\u6837\uFF0C\u6CA1\u6539\u52A8\u3002");
    return;
  }
  const clash = await env.DB.prepare("SELECT id FROM folders WHERE parent_id IS ? AND name = ? AND id <> ?").bind(parent.id, name, node.id).first();
  if (clash) {
    await sendMessage(token, cid, `\u8FD9\u4E2A\u76EE\u5F55\u91CC\u5DF2\u7ECF\u6709\u540C\u540D\u5B50\u76EE\u5F55\u300C${name}/\u300D\u4E86\u3002`);
    return;
  }
  const oldPath = await pathOfId(env.DB, node.id);
  const newPath = joinPath(parent.id === null ? "/" : await pathOfId(env.DB, parent.id), name);
  await env.DB.prepare("UPDATE folders SET name = ?, path = ? WHERE id = ?").bind(name, newPath, node.id).run();
  await repathSubtree(env.DB, node.id, oldPath, newPath);
  await repathFilesSubtree(env.DB, node.id, oldPath, newPath);
  await logEvent(env.DB, "mvd", { path: oldPath, new: newPath });
  await sendMessage(token, cid, `\u5DF2\u6539\u540D
${oldPath}
\u2192 ${newPath}`);
}
__name(replyRename, "replyRename");
async function replyPass(env, cid) {
  const show = !["0", "false", "no", ""].includes(String(env.TG_BOT_SHOW_PASS ?? "1").toLowerCase());
  if (!show) {
    await sendMessage(env.TG_BOT_TOKEN, cid, "\u7F51\u9875\u5BC6\u7801\u67E5\u8BE2\u5DF2\u5173\u95ED\uFF08TG_BOT_SHOW_PASS=0\uFF09\u3002");
    return;
  }
  const user = env.TG_AUTH_USER || "admin";
  const pass = env.TG_AUTH_PASS || "";
  if (!pass) {
    await sendMessage(
      env.TG_BOT_TOKEN,
      cid,
      "\u7F51\u9875\u5BC6\u7801\u8FD8\u6CA1\u8BBE\u7F6E\u3002\n\u5728\u9879\u76EE\u76EE\u5F55\u6267\u884C\uFF1A\nnpx wrangler secret put TG_AUTH_PASS"
    );
    return;
  }
  await sendMessage(
    env.TG_BOT_TOKEN,
    cid,
    `\u7F51\u9875\u7AEF\u8D26\u53F7\uFF1A${user}
\u7F51\u9875\u7AEF\u5BC6\u7801\uFF1A${pass}

\u6B64\u5BC6\u7801\u5B58\u5728 Worker secret \u91CC\uFF0C\u4E0D\u4F1A\u5199\u8FDB\u4EE3\u7801\u3002`
  );
}
__name(replyPass, "replyPass");

// src/ui.ts
function renderPage() {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>TG \u5B58\u50A8\u6C60</title>
<style>
  :root{
    --bg:#f7f7f5; --panel:#ffffff; --line:#e4e2dc; --fg:#22221f; --muted:#6b6a64;
    --accent:#185fa5; --danger:#a32d2d; --soft:#f1efe8;
    --glass:rgba(255,255,255,.86);
    --glass-strong:rgba(255,255,255,.78);
  }
  *{box-sizing:border-box}
  body{
    margin:0;
    font:14px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;
    color:var(--fg);
    background:url("https://img.1795857.xyz/file/17673907924028800.jpg") no-repeat center center fixed;
    background-size:cover;
    min-height:100vh;
  }
  header{display:flex;align-items:center;gap:16px;padding:12px 18px;background:var(--glass);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);border-bottom:1px solid var(--line);position:sticky;top:0;z-index:5;flex-wrap:wrap}
  h1{font-size:15px;font-weight:500;margin:0}
  .spacer{flex:1}
  .stats{color:var(--muted);font-size:13px}
  input,button{font:inherit;color:inherit}
  input[type=search],input[type=text]{padding:6px 10px;border:1px solid var(--line);border-radius:8px;background:#fff;min-width:0}
  button{padding:6px 12px;border:1px solid var(--line);border-radius:8px;background:#fff;cursor:pointer}
  button:hover{border-color:#c9c6bd;background:#fbfbfa}
  button.link{border:none;background:none;color:var(--accent);padding:2px 6px}
  button.link:hover{background:var(--soft)}
  button.danger{color:var(--danger)}
  .wrap{display:flex;align-items:flex-start;gap:0}
  aside{width:248px;flex:0 0 248px;border-right:1px solid var(--line);min-height:calc(100vh - 57px);padding:12px;background:var(--glass);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px)}
  main{flex:1;padding:18px;min-width:0;background:var(--glass-strong);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);min-height:calc(100vh - 57px)}
  ul.tree{list-style:none;margin:0;padding-left:12px}
  ul.tree.root{padding-left:0}
  .node{padding:4px 6px;border-radius:6px;cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .node:hover{background:var(--soft)}
  .node.active{background:#e6f1fb;color:#0c447c}
  .crumb{color:var(--muted);font-size:13px;margin-bottom:12px;word-break:break-all}
  .crumb b{color:var(--fg);font-weight:500}
  table{width:100%;border-collapse:collapse}
  th{text-align:left;font-weight:500;color:var(--muted);font-size:12px;padding:6px 8px;border-bottom:1px solid var(--line)}
  td{padding:8px;border-bottom:1px solid #f0efea;vertical-align:middle}
  tr:hover td{background:#fcfcfb}
  .name{word-break:break-all}
  .id{color:var(--muted);font-size:12px;margin-right:8px}
  .size{color:var(--muted);white-space:nowrap;font-size:13px}
  .acts{white-space:nowrap;text-align:right}
  .muted{color:var(--muted)}
  .empty{padding:28px 8px;color:var(--muted)}
  .toast{position:fixed;left:50%;transform:translateX(-50%);bottom:24px;background:#22221f;color:#fff;padding:9px 16px;border-radius:8px;opacity:0;transition:opacity .18s;pointer-events:none;z-index:20;max-width:80vw}
  .toast.show{opacity:1}
  .note{background:#faeeda;border:1px solid #f0c9a0;color:#633806;padding:9px 12px;border-radius:8px;margin-bottom:14px;font-size:13px}
  .pager{display:none;align-items:center;gap:6px;flex-wrap:wrap;margin-top:14px;padding-top:12px;border-top:1px solid var(--line);font-size:13px;color:var(--muted)}
  .pager button{font-size:13px;padding:4px 10px}
  .pager button:disabled{opacity:.4;cursor:not-allowed;background:#fff}
  .pg-info{margin:0 4px}
  .pg-jump input{width:54px;padding:4px 6px;border:1px solid var(--line);border-radius:6px;background:#fff;text-align:center}
  .pg-size select{padding:4px 6px;border:1px solid var(--line);border-radius:6px;background:#fff}
  .pick{width:34px}
  .pick input{width:15px;height:15px;margin:0;vertical-align:middle;cursor:pointer;accent-color:var(--accent)}
  .batchbar{display:none;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:10px;padding:8px 12px;border:1px solid #cfd9e4;background:#eef4fb;border-radius:8px;font-size:13px}
  .batchbar .n{color:var(--muted)}
  .batchbar button{font-size:13px;padding:5px 10px}
  .batchbar button.danger{color:var(--danger)}
  tr.picked td{background:#eef4fb}
  tr.picked:hover td{background:#e6eef8}
</style>
</head>
<body>
<header>
  <h1>TG \u5B58\u50A8\u6C60</h1>
  <div class="stats" id="stats">\u8F7D\u5165\u4E2D\u2026</div>
  <div class="spacer"></div>
  <input type="search" id="q" placeholder="\u641C\u7D22\u6587\u4EF6\u540D\u6216\u8DEF\u5F84\u2026" style="width:240px">
  <button id="btn-refresh">\u5237\u65B0</button>
</header>

<div class="wrap">
  <aside>
    <ul class="tree root" id="tree"></ul>
  </aside>
  <main>
    <div class="note">
      \u8FD9\u4E00\u7248\u53EA\u505A\u7BA1\u7406\uFF1A<b>\u4E0A\u4F20\u548C\u4E0B\u8F7D\u8BF7\u7528 Telegram \u5BA2\u6237\u7AEF</b>\uFF08\u628A\u6587\u4EF6\u53D1\u7ED9 bot \u5373\u81EA\u52A8\u6536\u5F55\uFF09\u3002
    </div>
    <div class="crumb" id="crumb"></div>
    <div style="margin-bottom:10px;display:flex;gap:8px;flex-wrap:wrap">
      <button id="btn-newfolder">\u65B0\u5EFA\u6587\u4EF6\u5939</button>
      <button id="btn-export">\u5BFC\u51FA\u7D22\u5F15</button>
    </div>
    <div class="batchbar" id="batchbar">
      <span class="n" id="batchinfo">\u5DF2\u9009 0 \u9879</span>
      <button id="btn-bmove">\u79FB\u52A8\u9009\u4E2D</button>
      <button id="btn-bdel" class="danger">\u5220\u9664\u9009\u4E2D</button>
      <button id="btn-bclear">\u6E05\u7A7A\u9009\u62E9</button>
    </div>
    <table>
      <thead><tr><th class="pick"><input type="checkbox" id="chk-all" title="\u5168\u9009\u672C\u9875"></th><th>\u540D\u79F0</th><th style="width:90px">\u5927\u5C0F</th><th style="width:230px"></th></tr></thead>
      <tbody id="rows"></tbody>
    </table>
    <div class="empty" id="empty" style="display:none"></div>
    <div class="pager" id="pager">
      <button id="pg-first">\u00AB \u9996\u9875</button>
      <button id="pg-prev">\u2039 \u4E0A\u4E00\u9875</button>
      <span class="pg-info" id="pg-info"></span>
      <button id="pg-next">\u4E0B\u4E00\u9875 \u203A</button>
      <button id="pg-last">\u672B\u9875 \u00BB</button>
      <span class="pg-jump">\u8DF3\u5230 <input type="text" id="pg-input" inputmode="numeric"> \u9875</span>
      <span class="pg-size">\u6BCF\u9875
        <select id="pg-size">
          <option value="50">50</option>
          <option value="100" selected>100</option>
          <option value="200">200</option>
          <option value="500">500</option>
        </select>
        \u6761</span>
    </div>
  </main>
</div>

<div class="toast" id="toast"></div>

<script>
var currentFolder = null;
var currentPath = "/";
var isSearching = false;
var PAGE_SIZE = 100;
var curPage = 1;
var curTotalPages = 1;
var lastQuery = "";
// 目录树只在「首次加载 / 手动刷新 / 改过目录结构」时重拉。
// 旧实现每次点开目录都重拉整棵树 = 每次点击扫 F 行（F=目录数），是纯浪费的 D1 行读取。
var treeDirty = true;

function $(id){ return document.getElementById(id); }
var ESC = {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"};
function esc(s){ return String(s==null?"":s).replace(/[&<>"']/g, function(c){ return ESC[c]; }); }

var toastTimer = null;
function toast(msg, bad){
  var t = $("toast");
  t.textContent = msg;
  t.style.background = bad ? "#a32d2d" : "#22221f";
  t.classList.add("show");
  if(toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(function(){ t.classList.remove("show"); }, 2600);
}

function api(path, opts){
  var init = opts || {};
  init.headers = Object.assign({"content-type":"application/json"}, init.headers||{});
  return fetch(path, init).then(function(r){
    return r.json().catch(function(){ return {}; }).then(function(data){
      if(!r.ok) throw new Error(data.error || data.message || ("HTTP " + r.status));
      return data;
    });
  });
}

function loadStats(){
  return api("/api/stats").then(function(d){
    $("stats").textContent = "\u6587\u4EF6 " + d.files + " \u4E2A \xB7 \u5171 " + d.bytes_human + " \xB7 \u6587\u4EF6\u5939 " + d.folders + " \u4E2A";
  });
}

function loadTree(){
  treeDirty = false;
  return api("/api/tree").then(function(d){
    var html = "";
    html += '<li><div class="node' + (currentFolder===null && !isSearching ? " active" : "") + '" data-folder="root">/ \u6839\u76EE\u5F55</div>';
    html += renderNodes(d.root);
    html += "</li>";
    $("tree").innerHTML = html;
  });
}

function renderNodes(nodes){
  if(!nodes || !nodes.length) return "";
  var out = '<ul class="tree">';
  for(var i=0;i<nodes.length;i++){
    var n = nodes[i];
    out += '<li><div class="node' + (currentFolder===n.id && !isSearching ? " active" : "") +
           '" data-folder="' + n.id + '">' + esc(n.name) + "/</div>" + renderNodes(n.children) + "</li>";
  }
  return out + "</ul>";
}

function openFolder(id, page){
  isSearching = false;
  currentFolder = id;
  lastQuery = "";
  curPage = page || 1;
  var qs = "page=" + curPage + "&limit=" + PAGE_SIZE + (id===null ? "" : "&folder=" + encodeURIComponent(id));
  return api("/api/list?" + qs).then(function(d){
    currentPath = d.path;
    if(d.folder_id === null) currentFolder = null;
    render(d);
    renderPager(d);
    // 只有树脏了才重拉（首次 / 刷新 / 刚改过目录结构），普通翻目录不再白扫一遍 folders
    return treeDirty ? loadTree() : Promise.resolve();
  }).catch(function(e){ toast(e.message, true); });
}

function doSearch(q, page){
  if(!q){ lastQuery = ""; isSearching = false; curPage = 1; return openFolder(currentFolder); }
  isSearching = true;
  lastQuery = q;
  curPage = page || 1;
  return api("/api/list?q=" + encodeURIComponent(q) + "&page=" + curPage + "&limit=" + PAGE_SIZE).then(function(d){
    currentPath = null;
    render(d, q);
    renderPager(d);
  }).catch(function(e){ toast(e.message, true); });
}

function renderPager(d){
  var box = $("pager");
  var tp = Number(d.total_pages || 1);
  var pg = Number(d.page || 1);
  var total = Number(d.total || 0);
  curTotalPages = tp;
  curPage = pg;
  if(tp <= 1){ box.style.display = "none"; return; }
  box.style.display = "flex";
  $("pg-info").textContent = "\u7B2C " + pg + " / " + tp + " \u9875 \xB7 \u5171 " + total + " \u6761";
  $("pg-first").disabled = pg <= 1;
  $("pg-prev").disabled = pg <= 1;
  $("pg-next").disabled = pg >= tp;
  $("pg-last").disabled = pg >= tp;
  $("pg-input").value = "";
}

function gotoPage(p){
  p = Number(String(p).replace(/[^0-9]/g, ""));
  if(!p || p < 1) return;
  if(p > curTotalPages) p = curTotalPages;
  if(p === curPage) return;
  if(isSearching) doSearch(lastQuery, p); else openFolder(currentFolder, p);
}

function render(d, kw){
  var crumb;
  if(d.mode === "search"){
    crumb = '\u641C\u7D22 <b>' + esc(kw) + '</b> \xB7 \u547D\u4E2D ' + d.total + ' \u4E2A' +
            ((d.total_pages||1) > 1 ? '\uFF08\u7B2C ' + d.page + ' / ' + d.total_pages + ' \u9875\uFF09' : '');
  } else {
    crumb = "\u4F4D\u7F6E\uFF1A<b>" + esc(d.path) + "</b>" + ((d.total||0) > 0 ? ' \xB7 ' + d.total + ' \u4E2A\u6587\u4EF6' : '');
  }
  $("crumb").innerHTML = crumb;

  var html = "";
  if(d.mode === "list" && d.folders && d.folders.length){
    for(var i=0;i<d.folders.length;i++){
      var f = d.folders[i];
      html += '<tr data-kind="folder" data-id="' + f.id + '">' +
        '<td class="pick"><input type="checkbox" class="rowchk" data-kind="folder" data-id="' + f.id + '" data-name="' + esc(f.name) + '"></td>' +
        '<td class="name"><span class="id">\u76EE\u5F55</span><a href="#" class="open-dir" data-folder="' + f.id + '">' + esc(f.name) + "/</a></td>" +
        '<td class="size">' + f.files + " \u6587\u4EF6</td>" +
        '<td class="acts">' +
          '<button class="link act-rename" data-kind="folder" data-id="' + f.id + '" data-name="' + esc(f.name) + '">\u6539\u540D</button>' +
          '<button class="link act-move" data-kind="folder" data-id="' + f.id + '" data-name="' + esc(f.name) + '">\u79FB\u52A8</button>' +
          '<button class="link danger act-del" data-kind="folder" data-id="' + f.id + '" data-name="' + esc(f.name) + '">\u5220\u9664</button>' +
        "</td></tr>";
    }
  }
  if(d.files && d.files.length){
    for(var j=0;j<d.files.length;j++){
      var x = d.files[j];
      html += '<tr data-kind="file" data-id="' + x.id + '">' +
        '<td class="pick"><input type="checkbox" class="rowchk" data-kind="file" data-id="' + x.id + '" data-name="' + esc(x.name) + '"></td>' +
        '<td class="name"><span class="id">#' + x.id + "</span>" + esc(x.name) +
          (d.mode === "search" ? '<div class="muted" style="font-size:12px">' + esc(x.path_str) + "</div>" : "") +
        "</td>" +
        '<td class="size">' + esc(x.size_human) + "</td>" +
        '<td class="acts">' +
          '<button class="link act-rename" data-kind="file" data-id="' + x.id + '" data-name="' + esc(x.name) + '">\u6539\u540D</button>' +
          '<button class="link act-move" data-kind="file" data-id="' + x.id + '" data-name="' + esc(x.name) + '">\u79FB\u52A8</button>' +
          '<button class="link danger act-del" data-kind="file" data-id="' + x.id + '" data-name="' + esc(x.name) + '">\u5220\u9664</button>' +
        "</td></tr>";
    }
  }

  $("rows").innerHTML = html;
  syncChecks();
  var empty = $("empty");
  if(!html){
    empty.style.display = "block";
    empty.textContent = d.mode === "search" ? "\u6CA1\u6709\u5339\u914D\u7684\u6587\u4EF6\u3002" : "\uFF08\u7A7A\u76EE\u5F55\uFF09";
  } else {
    empty.style.display = "none";
  }
}

function filePath(name){
  if(isSearching || currentPath === null) return null;
  return (currentPath === "/" ? "" : currentPath) + "/" + name;
}

function newFolder(){
  var name = prompt("\u65B0\u6587\u4EF6\u5939\u540D\uFF08\u5EFA\u5728\u5F53\u524D\u76EE\u5F55\u4E0B\uFF09\uFF1A");
  if(!name) return;
  treeDirty = true;
  api("/api/folders", {method:"POST", body: JSON.stringify({name:name, parent_id: currentFolder})})
    .then(function(){ toast("\u5DF2\u65B0\u5EFA"); return openFolder(currentFolder); })
    .catch(function(e){ toast(e.message, true); });
}

function renameNode(kind, id, oldName){
  var name = prompt("\u65B0\u540D\u5B57\uFF1A", oldName);
  if(name === null || name === oldName) return;
  var url = kind === "file" ? "/api/files/" + id : "/api/folders/" + id;
  api(url, {method:"PATCH", body: JSON.stringify({name:name})})
    .then(function(){ toast("\u5DF2\u6539\u540D"); return refresh(); })
    .catch(function(e){ toast(e.message, true); });
}

function moveNode(kind, id, name){
  var p = filePath(name);
  if(!p){ toast("\u641C\u7D22\u7ED3\u679C\u91CC\u8BF7\u5148\u8FDB\u5165\u76EE\u5F55\u518D\u79FB\u52A8", true); return; }
  var target = prompt("\u79FB\u52A8\u5230\u54EA\u4E2A\u76EE\u5F55\uFF08\u5199\u7EDD\u5BF9\u8DEF\u5F84\uFF0C\u7559\u7A7A = \u6839\u76EE\u5F55\uFF09\uFF1A", "/");
  if(target === null) return;
  api("/api/move", {method:"POST", body: JSON.stringify({source:p, target:target})})
    .then(function(d){ toast("\u5DF2\u79FB\u52A8\u5230 " + (d.moved_to || d.path)); return refresh(); })
    .catch(function(e){ toast(e.message, true); });
}

function delNode(kind, id, name){
  var p = kind === "file" ? filePath(name) : null;
  if(kind === "file" && !p){ toast("\u641C\u7D22\u7ED3\u679C\u91CC\u8BF7\u5148\u8FDB\u5165\u76EE\u5F55\u518D\u5220\u9664", true); return; }
  if(!confirm("\u786E\u8BA4\u5220\u9664 " + name + "\uFF1F\\n\u5220\u9664\u540E Telegram \u4E0A\u7684\u539F\u4EF6\u4E5F\u4F1A\u4E00\u5E76\u79FB\u9664\uFF0C\u4E0D\u53EF\u6062\u590D\u3002")) return;
  var url = kind === "file" ? "/api/files/" + id : "/api/folders/" + id;

  function attempt(force){
    return fetch(url + (force ? "?force=1" : ""), {method:"DELETE", headers:{"content-type":"application/json"}}).then(function(r){
      return r.json().catch(function(){ return {}; }).then(function(d){
        if(r.ok) return {done:true};
        if(d && d.need_confirm) return {need:true, msg:d.message};
        throw new Error(d.error || d.message || ("HTTP " + r.status));
      });
    });
  }

  attempt(false).then(function(res){
    if(res.done){ toast("\u5DF2\u5220\u9664"); return refresh(); }
    if(res.need && confirm(res.msg + "\\n\\n\u786E\u5B9A\u8FDE\u540C\u91CC\u9762\u7684\u5185\u5BB9\u4E00\u8D77\u5220\u9664\u5417\uFF1F")){
      return attempt(true).then(function(){ toast("\u5DF2\u5220\u9664"); return refresh(); });
    }
  }).catch(function(e){ toast(e.message, true); });
}

// ---------- 多选 + 批量删除 / 批量移动 ----------
// sel 以 "kind:id" 为键，跨页跨目录累积选择，最后一次性提交。
var sel = {};
function selKey(kind, id){ return kind + ":" + id; }
function selList(){ var out = []; for(var k in sel){ if(Object.prototype.hasOwnProperty.call(sel, k)) out.push(sel[k]); } return out; }
function setSel(items){
  sel = {};
  for(var i=0;i<items.length;i++){ sel[selKey(items[i].kind, items[i].id)] = items[i]; }
}
function updateBatchBar(){
  var n = selList().length;
  $("batchbar").style.display = n ? "flex" : "none";
  $("batchinfo").textContent = "已选 " + n + " 项";
}
function syncChecks(){
  var boxes = $("rows").querySelectorAll("input.rowchk");
  var n = 0;
  for(var i=0;i<boxes.length;i++){
    var b = boxes[i];
    b.checked = !!sel[selKey(b.getAttribute("data-kind"), b.getAttribute("data-id"))];
    if(b.checked) n++;
    var tr = b.parentNode && b.parentNode.parentNode;
    if(tr && tr.classList){ if(b.checked) tr.classList.add("picked"); else tr.classList.remove("picked"); }
  }
  var all = $("chk-all");
  if(all){
    all.checked = boxes.length > 0 && n === boxes.length;
    all.indeterminate = n > 0 && n < boxes.length;
  }
  updateBatchBar();
}
function toggleSel(kind, id, name, on){
  var k = selKey(kind, String(id));
  if(on) sel[k] = { kind: kind, id: Number(id), name: name || "" };
  else delete sel[k];
  updateBatchBar();
}
// 按服务端限额切片：一次请求最多 200 个条目，且目录数不能超（删除 20 / 移动 10）
function planChunks(items, max, maxFolders){
  var out = [], cur = [], f = 0;
  for(var i=0;i<items.length;i++){
    var it = items[i];
    var isF = it.kind === "folder";
    if(cur.length && (cur.length >= max || (isF && f >= maxFolders))){ out.push(cur); cur = []; f = 0; }
    cur.push(it);
    if(isF) f++;
  }
  if(cur.length) out.push(cur);
  return out;
}
function postRaw(url, payload){
  return fetch(url, {method:"POST", headers:{"content-type":"application/json"}, body: JSON.stringify(payload)})
    .then(function(r){
      return r.json().catch(function(){ return {}; }).then(function(d){ return {status:r.status, ok:r.ok, d:d||{}}; });
    });
}
// 逐批提交；第一批不带 force，服务端说 need_confirm 就弹一次确认，之后整轮都带 force。
function runBatch(url, items, extra, maxFolders, verb, pick){
  var chunks = planChunks(items, 200, maxFolders);
  var acc = 0, done = 0;
  function step(i, force){
    return postRaw(url, Object.assign({items: chunks[i]}, extra, force ? {force:1} : {})).then(function(res){
      if(res.status === 409 && res.d && res.d.need_confirm){
        if(!confirm("【确认" + verb + "】\\n" + (res.d.message || "") + "\\n\\n继续吗？")) return null;
        return step(i, true);
      }
      if(!res.ok) throw new Error(res.d.error || res.d.message || ("HTTP " + res.status));
      acc += pick(res.d);
      done += chunks[i].length;
      if(i + 1 < chunks.length){
        toast(verb + "中… " + done + "/" + items.length);
        return step(i + 1, force);
      }
      return true;
    });
  }
  step(0, false).then(function(r){
    if(r === null){
      setSel(items.slice(done));
      toast("已取消" + verb + "（前面已完成的批次不会回退）");
      return refresh();
    }
    setSel([]);
    return refresh().then(function(){ toast(verb + "完成：" + acc + " 项"); });
  }).catch(function(e){
    setSel(items.slice(done));
    toast(e.message, true);
  });
}
function batchDel(){
  var items = selList();
  if(!items.length) return;
  if(!confirm("确认删除选中的 " + items.length + " 项？\\n目录会连同里面的内容一起删，Telegram 上的原文件也会一并移除，不可恢复。")) return;
  runBatch("/api/batch-delete", items, {}, 20, "删除", function(d){ return (d.deleted_files||0) + (d.deleted_folders||0); });
}
function batchMove(){
  var items = selList();
  if(!items.length) return;
  var target = prompt("移动选中项到哪个目录（写绝对路径，留空 = 根目录）：", "/");
  if(target === null) return;
  runBatch("/api/batch-move", items, {target:target}, 10, "移动", function(d){ return (d.moved_files||0) + (d.moved_folders||0); });
}

function refresh(){
  treeDirty = true;  // 手动刷新 = 树也要重拉
  return Promise.all([loadStats(), isSearching ? doSearch(lastQuery, curPage) : openFolder(currentFolder, curPage)]);
}

$("tree").addEventListener("click", function(ev){
  var n = ev.target.closest(".node");
  if(!n) return;
  var f = n.getAttribute("data-folder");
  $("q").value = "";
  openFolder(f === "root" ? null : Number(f));
});

$("rows").addEventListener("click", function(ev){
  var t = ev.target;
  if(t && t.tagName === "INPUT" && t.classList && t.classList.contains("rowchk")){
    toggleSel(t.getAttribute("data-kind"), t.getAttribute("data-id"), t.getAttribute("data-name"), t.checked);
    syncChecks();
    return;
  }
  if(!t || t.tagName !== "BUTTON") {
    var link = t.closest && t.closest(".open-dir");
    if(link){ ev.preventDefault(); openFolder(Number(link.getAttribute("data-folder"))); }
    return;
  }
  var kind = t.getAttribute("data-kind");
  var id = Number(t.getAttribute("data-id"));
  var name = t.getAttribute("data-name");
  if(t.classList.contains("act-rename")) renameNode(kind, id, name);
  else if(t.classList.contains("act-move")) moveNode(kind, id, name);
  else if(t.classList.contains("act-del")) delNode(kind, id, name);
});

var qi = $("q");
var qt = null;
qi.addEventListener("input", function(){
  if(qt) clearTimeout(qt);
  var v = qi.value.trim();
  qt = setTimeout(function(){ doSearch(v); }, 260);
});

$("btn-refresh").addEventListener("click", function(){ refresh(); });
$("btn-newfolder").addEventListener("click", newFolder);
$("btn-export").addEventListener("click", function(){ doExport(this); });

$("chk-all").addEventListener("change", function(){
  var on = !!this.checked;
  var boxes = $("rows").querySelectorAll("input.rowchk");
  for(var i=0;i<boxes.length;i++){
    var b = boxes[i];
    toggleSel(b.getAttribute("data-kind"), b.getAttribute("data-id"), b.getAttribute("data-name"), on);
  }
  syncChecks();
});
$("btn-bmove").addEventListener("click", batchMove);
$("btn-bdel").addEventListener("click", batchDel);
$("btn-bclear").addEventListener("click", function(){ setSel([]); syncChecks(); });

// 分块导出：浏览器一页页拉，服务端每次只做一批（每请求 CPU 远低于 10ms）。
// 不要退回 window.location.href = "/api/export"：整包在 2 万行时 45~50ms 纯 JS CPU，Free 档必 1102。
function doExport(btn){
  if(btn.disabled) return;
  btn.disabled = true;
  var old = btn.textContent;
  var out = { ok: true, exported_at: new Date().toISOString(), files: [], folders: [], events: [], counts: {} };
  function spin(kind){ btn.textContent = "\u5BFC\u51FA\u4E2D\u2026 " + kind + " " + out[kind].length; }
  function pull(kind, url, after, cb){
    fetch(url + "&after=" + after).then(function(r){ return r.json(); }).then(function(d){
      if(!d.ok) throw new Error(d.error || "bad");
      var rows = d.rows || [];
      for(var i = 0; i < rows.length; i++) out[kind].push(rows[i]);
      spin(kind);
      if(d.done){ cb(); return; }
      pull(kind, url, d.next_after, cb);
    }).catch(function(e){
      btn.disabled = false;
      btn.textContent = old;
      alert("\u5BFC\u51FA\u5931\u8D25\uFF1A" + (e && e.message ? e.message : e));
    });
  }
  function finish(){
    out.counts = { files: out.files.length, folders: out.folders.length, events: out.events.length };
    var blob = new Blob([JSON.stringify(out)], {type: "application/json"});
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "cfpool-index-" + out.exported_at.replace(/[:.]/g, "-") + ".json";
    document.body.appendChild(a);
    a.click();
    setTimeout(function(){ URL.revokeObjectURL(a.href); a.remove(); }, 0);
    btn.disabled = false;
    btn.textContent = old;
  }
  pull("files", "/api/export?mode=files&limit=1000", 0, function(){
    pull("folders", "/api/export?mode=folders&limit=1000", 0, function(){
      pull("events", "/api/export?mode=events&limit=1000", 0, finish);
    });
  });
}

$("pg-first").addEventListener("click", function(){ gotoPage(1); });
$("pg-prev").addEventListener("click", function(){ gotoPage(curPage - 1); });
$("pg-next").addEventListener("click", function(){ gotoPage(curPage + 1); });
$("pg-last").addEventListener("click", function(){ gotoPage(curTotalPages); });
$("pg-input").addEventListener("keydown", function(ev){
  if(ev.key === "Enter") gotoPage(this.value);
});
$("pg-size").addEventListener("change", function(){
  PAGE_SIZE = Number(this.value) || 100;
  if(isSearching) doSearch(lastQuery, 1); else openFolder(currentFolder, 1);
});

refresh();
<\/script>
</body>
</html>`;
}
__name(renderPage, "renderPage");

// src/web.ts
function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }
  });
}
__name(json, "json");
function fail(message, status = 400) {
  return json({ ok: false, error: message }, status);
}
__name(fail, "fail");
function checkAuth(req, env) {
  const header = req.headers.get("authorization") || "";
  if (!header.toLowerCase().startsWith("basic ")) return false;
  let decoded;
  try {
    decoded = atob(header.slice(6).trim());
  } catch {
    return false;
  }
  const idx = decoded.indexOf(":");
  if (idx < 0) return false;
  const user = decoded.slice(0, idx);
  const pass = decoded.slice(idx + 1);
  const wantUser = env.TG_AUTH_USER || "admin";
  const wantPass = env.TG_AUTH_PASS || "";
  if (!wantPass) return false;
  const uOk = timingSafeEqualStr(user, wantUser);
  const pOk = timingSafeEqualStr(pass, wantPass);
  return uOk && pOk;
}
__name(checkAuth, "checkAuth");
function unauthorized() {
  return new Response("\u9700\u8981\u767B\u5F55", {
    status: 401,
    headers: { "www-authenticate": 'Basic realm="cfpool", charset="UTF-8"' }
  });
}
__name(unauthorized, "unauthorized");
// CSRF 防护。Basic 凭证是浏览器自动附带的，跨站页面能"盲发"写请求（响应因缺 CORS 头读不到，
// 但副作用已经生效）—— 服务端必须自己区分「本人点的」和「别人的页面触发的」。三道一起上：
//   1) 带了 Origin 头 → 必须等于本站 origin。跨站 fetch / form 一定会带 Origin，带错了直接拒。
//   2) 没带 Origin → 看 Sec-Fetch-Site，只认 same-origin / none，其余（cross-site、same-site）一律拒。
//      <img>/<iframe>/fetch 这类请求不带 Origin，靠这一条兜住。
//      **例外**：顶层文档导航（dest=document + 读方法）放行 —— 从别处点链接进来会标 cross-site，
//      那是正常访问不是 CSRF（详见下面 checkCsrf 里的注释）。
//   3) 写方法必须显式声明 content-type: application/json。浏览器表单和 simple request 发不出这个类型；
//      跨站 fetch 想发就得走 CORS 预检，而本服务不返回任何 CORS 头 → 预检必然失败。
// 注意 1)、2) 对读方法同样生效：GET /api/admin/recount 也是会干活的（全表重算），不能放过。
// 副作用：用 curl 调写接口必须带 -H "content-type: application/json"。
const CSRF_SAFE_METHODS = /* @__PURE__ */ new Set(["GET", "HEAD", "OPTIONS"]);
function mediaTypeOf(req) {
  const ct = req.headers.get("content-type") || "";
  const semi = ct.indexOf(";");
  return (semi === -1 ? ct : ct.slice(0, semi)).trim().toLowerCase();
}
__name(mediaTypeOf, "mediaTypeOf");
function checkCsrf(req, url) {
  const method = req.method.toUpperCase();
  const origin = req.headers.get("origin");
  if (origin !== null && origin !== url.origin) {
    return errorJson("跨站请求已拒绝（Origin 不匹配）", 403);
  }
  // 例外：用户自己发起的**顶层文档导航**（地址栏输入、收藏夹、从搜索引擎/聊天软件点进来的链接）。
  // 浏览器对这类请求会标 Sec-Fetch-Site: cross-site（来源站点确实是别的站点），但它不是 CSRF：
  //   ① 导航只能发 GET，攻击者没法用导航触发写操作（表单 POST 会带 Origin，上面那条先拦住了）；
  //   ② 攻击者读不到响应，也没有任何"副作用被静默触发"的可能。
  // 不做这个例外会**误伤正常访问**：从别处点链接进来会拿到 403 的裸 JSON，连页面都打不开。
  // 注意 <iframe> 的 dest 是 "iframe" 而不是 "document"，不放行；<img> 是 dest="image"，也不放行。
  const dest = req.headers.get("sec-fetch-dest");
  const topLevelNav = dest === "document" && CSRF_SAFE_METHODS.has(method);
  const site = req.headers.get("sec-fetch-site");
  // 非顶层导航时：只放行 same-origin（本站页面自己发的）和 none（地址栏/书签直连）。
  // 必须连 same-site 一起拒：同主机不同端口、或同一主域下的另一个子域，浏览器都标 same-site，
  // 但那是**另一个 origin**，对我们这种单 origin 的应用没有任何合法用途。
  // （实测踩过：<img> 打的跨站 GET 就是 same-site，只拦 cross-site 会让它 200。）
  if (!topLevelNav && origin === null && site !== null && site !== "same-origin" && site !== "none") {
    // 回显请求类型（dest 只有 document/iframe/image/empty… 这几个固定取值，白名单后截断，不反射任意串），
    // 这样"正常访问被拒"时能一眼看出是「顶层导航（document）」还是「子资源（image/iframe/empty）」。
    const destSafe = /^[a-z]{0,12}$/.test(dest || "") ? (dest || "-") : "?";
    return errorJson("跨站请求已拒绝（Sec-Fetch-Site: " + site + " · 请求类型: " + destSafe + "）", 403);
  }
  if (!CSRF_SAFE_METHODS.has(method) && mediaTypeOf(req) !== "application/json") {
    return errorJson("content-type 必须是 application/json", 415);
  }
  return null;
}
__name(checkCsrf, "checkCsrf");
async function apiStats(env) {
  // 计数器读 1 次（4 行），不再对 files/folders/events 各来一次 COUNT(*) 全表扫
  const c = await readCounters(env.DB);
  return json({
    ok: true,
    files: c.files,
    bytes: c.bytes,
    bytes_human: human(c.bytes),
    folders: c.folders,
    events: c.events,
    // 明确告诉前端：这一版没有上传下载，别去渲染那两个按钮
    capabilities: { upload: false, download: false }
  });
}
__name(apiStats, "apiStats");
function pageParams(url) {
  const rawLimit = Number(url.searchParams.get("limit"));
  const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(Math.floor(rawLimit), PAGE_MAX) : PAGE_DEFAULT;
  const rawPage = Number(url.searchParams.get("page"));
  const page = Number.isFinite(rawPage) && rawPage > 0 ? Math.floor(rawPage) : 1;
  return { limit, page, offset: (page - 1) * limit };
}
__name(pageParams, "pageParams");
async function apiList(env, url) {
  const { limit, page, offset } = pageParams(url);
  const q = (url.searchParams.get("q") || "").trim();
  if (q) {
    // 命中总数：缓存命中就直接用，没缓存才算一次 COUNT
    const state = await resolveSearchState(env, q);
    const total = state.total ?? 0;
    const totalPages = Math.max(1, Math.ceil(total / limit));
    const { items } = await searchFilesPage(env.DB, q, limit, offset, false);
    return json({
      ok: true,
      mode: "search",
      query: q,
      total,
      page,
      limit,
      total_pages: totalPages,
      has_prev: page > 1,
      has_next: page < totalPages,
      folders: [],
      files: items.map(toFileDto)
    });
  }
  const raw = url.searchParams.get("folder");
  const folderId = raw === null || raw === "" ? null : Number(raw);
  if (folderId !== null && !Number.isFinite(folderId)) return fail("folder \u53C2\u6570\u4E0D\u5408\u6CD5");
  const folder = folderId === null ? { id: null } : await resolvePathById(env, folderId);
  if (!folder) return fail("\u76EE\u5F55\u4E0D\u5B58\u5728", 404);
  const path = await pathOfId(env.DB, folderId);
  const pathList = await ancestorsOf(env.DB, folderId);
  const subs = await listSubfolders(env.DB, folderId);
  const total = await countFilesIn(env.DB, folderId);
  const totalPages = Math.max(1, Math.ceil(total / limit));
  const files = await listFiles(env.DB, folderId, limit, offset);
  return json({
    ok: true,
    mode: "list",
    folder_id: folderId,
    path,
    path_list: pathList,
    folders: subs,
    files: files.map(toFileDto),
    total,
    page,
    limit,
    total_pages: totalPages,
    has_prev: page > 1,
    has_next: page < totalPages
  });
}
__name(apiList, "apiList");
function toFileDto(f) {
  return {
    id: f.id,
    name: f.name,
    size: f.size,
    size_human: human(f.size),
    mime: f.mime,
    created_at: f.created_at,
    path_str: f.path_str,
    media: f.media ?? null
  };
}
__name(toFileDto, "toFileDto");
async function resolvePathById(env, id) {
  const row = await env.DB.prepare("SELECT id FROM folders WHERE id = ?").bind(id).first();
  return row ?? null;
}
__name(resolvePathById, "resolvePathById");
async function apiTree(env) {
  // 老实现里每层都 list.filter() 扫一遍 → O(F²)：4047 个目录就超 10ms CPU。
  // 现在先按 parent 分桶，再一次性递归组装 → O(F)。
  const { results } = await env.DB.prepare("SELECT id, name, parent_id FROM folders ORDER BY name COLLATE NOCASE").all();
  const rows = results ?? [];
  const ROOT_KEY = "__root__";
  const childrenOf = /* @__PURE__ */ new Map();
  for (const r of rows) {
    const key = r.parent_id === null || r.parent_id === void 0 ? ROOT_KEY : r.parent_id;
    const arr = childrenOf.get(key);
    if (arr) arr.push(r);
    else childrenOf.set(key, [r]);
  }
  const seen = /* @__PURE__ */ new Set();
  const build = /* @__PURE__ */ __name((pid, depth) => {
    if (depth > 32) return [];
    const list = childrenOf.get(pid) ?? [];
    const out = [];
    for (const r of list) {
      if (seen.has(r.id)) continue;
      seen.add(r.id);
      out.push({ id: r.id, name: r.name, children: build(r.id, depth + 1) });
    }
    return out;
  }, "build");
  return json({ ok: true, root: build(ROOT_KEY, 0) });
}
__name(apiTree, "apiTree");
async function apiCreateFolder(env, body) {
  const name = cleanFolderName(String(body?.name ?? ""));
  const parentId = body?.parent_id === null || body?.parent_id === void 0 ? null : Number(body.parent_id);
  if (parentId !== null && !Number.isFinite(parentId)) return fail("parent_id \u4E0D\u5408\u6CD5");
  if (parentId !== null && !await resolvePathById(env, parentId)) return fail("\u4E0A\u7EA7\u76EE\u5F55\u4E0D\u5B58\u5728", 404);
  const clash = await env.DB.prepare("SELECT id FROM folders WHERE parent_id IS ? AND name = ?").bind(parentId, name).first();
  if (clash) return fail(`\u8FD9\u4E2A\u76EE\u5F55\u4E0B\u5DF2\u7ECF\u6709\u300C${name}/\u300D\u4E86`, 409);
  const p = joinPath(parentId === null ? "/" : await pathOfId(env.DB, parentId), name);
  const res = await env.DB.prepare("INSERT INTO folders(name, parent_id, path, created_at) VALUES(?, ?, ?, ?)").bind(name, parentId, p, Date.now() / 1e3).run();
  const id = Number(res.meta.last_row_id);
  await bumpCounters(env.DB, { folders: 1 });
  await logEvent(env.DB, "mkdir", { path: p });
  return json({ ok: true, id, name, path: p });
}
__name(apiCreateFolder, "apiCreateFolder");
async function apiUpdateFolder(env, id, body) {
  const row = await env.DB.prepare("SELECT id, name, parent_id FROM folders WHERE id = ?").bind(id).first();
  if (!row) return fail("\u76EE\u5F55\u4E0D\u5B58\u5728", 404);
  const name = cleanFolderName(String(body?.name ?? ""));
  if (name === row.name) return json({ ok: true, id, name, changed: false });
  const clash = await env.DB.prepare("SELECT id FROM folders WHERE parent_id IS ? AND name = ? AND id <> ?").bind(row.parent_id, name, id).first();
  if (clash) return fail(`\u540C\u7EA7\u5DF2\u6709\u300C${name}/\u300D`, 409);
  const oldPath = await pathOfId(env.DB, id);
  const newPath = joinPath(row.parent_id === null ? "/" : await pathOfId(env.DB, row.parent_id), name);
  await env.DB.prepare("UPDATE folders SET name = ?, path = ? WHERE id = ?").bind(name, newPath, id).run();
  await repathSubtree(env.DB, id, oldPath, newPath);
  await repathFilesSubtree(env.DB, id, oldPath, newPath);
  await logEvent(env.DB, "mvd", { path: oldPath, new: newPath });
  return json({ ok: true, id, name, old_path: oldPath, path: newPath, changed: true });
}
__name(apiUpdateFolder, "apiUpdateFolder");
async function apiDeleteFolder(env, id, force) {
  const folder = await resolvePathById(env, id);
  if (!folder) return fail("\u76EE\u5F55\u4E0D\u5B58\u5728", 404);
  const path = await pathOfId(env.DB, id);
  const sub = await collectSubtreeFast(env.DB, path);
  if (!force && (sub.files.length || sub.folderCount > 1)) {
    return json({
      ok: false,
      need_confirm: true,
      folders: sub.folderCount,
      files: sub.files.length,
      bytes_human: human(sub.bytes),
      message: `\u76EE\u5F55\u975E\u7A7A\uFF08${sub.folderCount} \u76EE\u5F55 / ${sub.files.length} \u6587\u4EF6\uFF09\u3002\u786E\u8BA4\u8BF7\u5E26 force=1 \u518D\u6765\u4E00\u6B21\u3002`
    }, 409);
  }
  const n = await deleteMessages(env.TG_BOT_TOKEN, sub.files, env.TG_CHAT_ID || "");
  const del = await purgeSubtree(env.DB, path);
  await bumpCounters(env.DB, { files: -del.files, folders: -del.folders, bytes: -Number(sub.bytes || 0) });
  await logEvent(env.DB, "rmd", { path });
  return json({ ok: true, deleted_folders: del.folders, deleted_files: del.files, tg_messages: n });
}
__name(apiDeleteFolder, "apiDeleteFolder");
async function apiUpdateFile(env, id, body) {
  const row = await env.DB.prepare("SELECT id, name, folder_id FROM files WHERE id = ?").bind(id).first();
  if (!row) return fail("\u6587\u4EF6\u4E0D\u5B58\u5728", 404);
  let name = row.name;
  if (body?.name !== void 0) {
    name = cleanFileName(String(body.name));
    if (!name) return fail("\u65B0\u6587\u4EF6\u540D\u4E0D\u80FD\u4E3A\u7A7A");
  }
  let folderId = row.folder_id;
  let wantMove = false;
  if (body?.folder_id !== void 0) {
    folderId = body.folder_id === null ? null : Number(body.folder_id);
    if (folderId !== null && !await resolvePathById(env, folderId)) return fail("\u76EE\u6807\u76EE\u5F55\u4E0D\u5B58\u5728", 404);
    wantMove = folderId !== row.folder_id;
  }
  if (name !== row.name) {
    const clash = await env.DB.prepare("SELECT id FROM files WHERE folder_id IS ? AND name = ? AND id <> ?").bind(row.folder_id, name, id).first();
    if (clash) return fail(`\u540C\u7EA7\u5DF2\u6709\u540C\u540D\u6587\u4EF6\u300C${name}\u300D(#${clash.id})`, 409);
  }
  if (wantMove) {
    const clash = await env.DB.prepare("SELECT id FROM files WHERE folder_id IS ? AND name = ?").bind(folderId, name).first();
    if (clash) return fail(`\u76EE\u6807\u76EE\u5F55\u91CC\u5DF2\u6709\u540C\u540D\u6587\u4EF6\uFF08#${clash.id}\uFF09`, 409);
  }
  if (name !== row.name) {
    await env.DB.prepare("UPDATE files SET name = ?, full_key = ? WHERE id = ?").bind(name, await fileKeyFor(env.DB, row.folder_id, name), id).run();
    await logEvent(env.DB, "ren", {
      id,
      name,
      path: await pathOfId(env.DB, row.folder_id)
    });
  }
  if (wantMove) {
    await env.DB.prepare("UPDATE files SET folder_id = ?, full_key = ? WHERE id = ?").bind(folderId, await fileKeyFor(env.DB, folderId, name), id).run();
    await logEvent(env.DB, "mv", { id, path: await pathOfId(env.DB, folderId) });
  }
  return json({ ok: true, id, name, folder_id: folderId });
}
__name(apiUpdateFile, "apiUpdateFile");
async function apiDeleteFile(env, id) {
  const row = await env.DB.prepare("SELECT id, name, chat_id, message_id, size FROM files WHERE id = ?").bind(id).first();
  if (!row) return fail("\u6587\u4EF6\u4E0D\u5B58\u5728", 404);
  const n = await deleteMessages(env.TG_BOT_TOKEN, [row], env.TG_CHAT_ID || "");
  await env.DB.prepare("DELETE FROM files WHERE id = ?").bind(id).run();
  await bumpCounters(env.DB, { files: -1, bytes: -Number(row.size || 0) });
  await logEvent(env.DB, "del", { id });
  return json({ ok: true, id, name: row.name, tg_messages: n });
}
__name(apiDeleteFile, "apiDeleteFile");
async function apiMoveByPath(env, body) {
  const source = normPath(String(body?.source ?? ""));
  const target = normPath(String(body?.target ?? "/"));
  if (source === "/") return fail("\u6839\u76EE\u5F55\u4E0D\u80FD\u79FB\u52A8");
  const src = await resolveNode(env.DB, source);
  if (!src.kind) return fail(src.err || `\u627E\u4E0D\u5230\uFF1A${source}`);
  const dst = await resolvePath(env.DB, target);
  if (dst.err) return fail(`${dst.err}\uFF08\u76EE\u6807\u76EE\u5F55\u5FC5\u987B\u5DF2\u5B58\u5728\uFF09`);
  if (src.kind === "folder" && dst.id === src.id) return fail("\u6E90\u548C\u76EE\u6807\u76F8\u540C");
  const name = source.split("/").pop() ?? "";
  if (src.kind === "file") {
    const clash2 = await env.DB.prepare("SELECT id FROM files WHERE folder_id IS ? AND name = ?").bind(dst.id, name).first();
    if (clash2) return fail(`\u76EE\u6807\u76EE\u5F55\u91CC\u5DF2\u6709\u540C\u540D\u6587\u4EF6\u300C${name}\u300D(#${clash2.id})`, 409);
    await env.DB.prepare("UPDATE files SET folder_id = ?, full_key = ? WHERE id = ?").bind(dst.id, await fileKeyFor(env.DB, dst.id, name), src.id).run();
    await logEvent(env.DB, "mv", { id: src.id, path: target });
    return json({ ok: true, kind: "file", id: src.id, moved_to: `${target.replace(/\/+$/, "")}/${name}` });
  }
  if (src.id === null) return fail("\u6839\u76EE\u5F55\u4E0D\u80FD\u79FB\u52A8");
  if (await isSelfOrDescendant(env, dst.id, src.id)) return fail("\u4E0D\u80FD\u628A\u76EE\u5F55\u79FB\u52A8\u5230\u81EA\u5DF1\u6216\u81EA\u5DF1\u7684\u5B50\u76EE\u5F55\u91CC");
  const clash = await env.DB.prepare("SELECT id FROM folders WHERE parent_id IS ? AND name = ?").bind(dst.id, name).first();
  if (clash) return fail(`\u76EE\u6807\u76EE\u5F55\u91CC\u5DF2\u6709\u5B50\u76EE\u5F55\u300C${name}/\u300D`, 409);
  const oldPath = await pathOfId(env.DB, src.id);
  const newPath = joinPath(target, name);
  await env.DB.prepare("UPDATE folders SET parent_id = ?, path = ? WHERE id = ?").bind(dst.id, newPath, src.id).run();
  await repathSubtree(env.DB, src.id, oldPath, newPath);
  await repathFilesSubtree(env.DB, src.id, oldPath, newPath);
  await logEvent(env.DB, "mvd", { path: source, new: newPath });
  return json({ ok: true, kind: "folder", id: src.id, old_path: source, path: newPath });
}
__name(apiMoveByPath, "apiMoveByPath");

// ===== 批量操作（网页端多选 / Telegram 多目标共用）=====
// 原则：一批条目用尽量少的 SQL 干掉。Free 档每次 Worker 调用只有 50 条 D1 查询额度，
// 「每个条目一次查询」在 20 个条目时就已经超了，所以全部走 IN (...) 分批。
var ID_CHUNK = 60;            // 单条 SQL 最多绑多少个 id（D1 对绑定参数个数有上限，留足余量）
var SUBTREE_CHUNK = 20;       // 多根子树合并查询的根数上限（每个根占 2 个绑定参数 → 40 < D1 的 100 上限）
var BATCH_LIMIT = 200;        // 一次批量请求最多处理多少个条目
var BATCH_DEL_FOLDER_LIMIT = 20;  // 一次批量删除里最多几个目录
var BATCH_MOVE_FOLDER_LIMIT = 10; // 一次批量移动里最多几个目录（每个目录 3 条 SQL）
var MAX_RM_TARGETS = 10;          // Telegram /rm 一次最多几个目标（每个目标要单独解析）
var MAX_MOVE_TARGETS = 10;        // Telegram /move 一次最多几个源
function ph(n) {
  return new Array(n).fill("?").join(",");
}
__name(ph, "ph");
// sqlTpl 里用 %IN% 占位，lead 是写在 IN 之前的绑定参数
async function queryInChunks(db, sqlTpl, ids, lead = []) {
  const out = [];
  for (let i = 0; i < ids.length; i += ID_CHUNK) {
    const part = ids.slice(i, i + ID_CHUNK);
    const { results } = await db.prepare(sqlTpl.replace("%IN%", ph(part.length))).bind(...lead, ...part).all();
    for (const r of results ?? []) out.push(r);
  }
  return out;
}
__name(queryInChunks, "queryInChunks");
async function execInChunks(db, sqlTpl, ids, lead = []) {
  let changes = 0;
  for (let i = 0; i < ids.length; i += ID_CHUNK) {
    const part = ids.slice(i, i + ID_CHUNK);
    const r = await db.prepare(sqlTpl.replace("%IN%", ph(part.length))).bind(...lead, ...part).run();
    changes += Number(r?.meta?.changes ?? 0);
  }
  return changes;
}
__name(execInChunks, "execInChunks");
async function selectByIds(db, sqlTpl, ids) {
  if (!ids.length) return [];
  return await queryInChunks(db, sqlTpl, ids);
}
__name(selectByIds, "selectByIds");
// p 是不是在 root 之下（含 root 自身）
function isUnder(path, root) {
  if (root === "/") return true;
  return path === root || String(path).startsWith(root + "/");
}
__name(isUnder, "isUnder");
// 选中目录里如果有祖孙关系，只留祖先：后代本来就跟着祖先一起没了，重复算会double计数
function dedupeRoots(paths) {
  const sorted = [...new Set(paths.map(String))].sort((a, b) => a.length - b.length);
  const keep = [];
  for (const p of sorted) if (!keep.some((k) => isUnder(p, k))) keep.push(p);
  return keep;
}
__name(dedupeRoots, "dedupeRoots");
function multiSubtreeWhere(n) {
  return new Array(n).fill(0).map(() => `(${pathPrefixPred("path")})`).join(" OR ");
}
__name(multiSubtreeWhere, "multiSubtreeWhere");
function multiSubtreeBinds(roots) {
  const b = [];
  for (const p of roots) b.push(...pathPrefixBinds(p));
  return b;
}
__name(multiSubtreeBinds, "multiSubtreeBinds");
// 多根子树的合并统计：每 SUBTREE_CHUNK 个根只花 3 条 SQL（条目 / 目录 id / 文件），
// 对比「每个根各调一次 collectSubtreeFast」（每根 2 条）在根数多时省一大截。
async function collectSubtreesMany(db, roots) {
  const files = [];
  const folderIds = [];
  let bytes = 0;
  for (let i = 0; i < roots.length; i += SUBTREE_CHUNK) {
    const part = roots.slice(i, i + SUBTREE_CHUNK);
    const where = multiSubtreeWhere(part.length);
    const binds = multiSubtreeBinds(part);
    const { results: frows } = await db.prepare(
      `SELECT id, chat_id, message_id, size FROM files WHERE folder_id IN (SELECT id FROM folders WHERE ${where})`
    ).bind(...binds).all();
    for (const r of frows ?? []) {
      files.push(r);
      bytes += Number(r.size || 0);
    }
    const { results: drows } = await db.prepare(
      `SELECT id FROM folders WHERE ${where}`
    ).bind(...binds).all();
    for (const r of drows ?? []) folderIds.push(Number(r.id));
  }
  return { folderCount: folderIds.length, folderIds, files, bytes };
}
__name(collectSubtreesMany, "collectSubtreesMany");
async function purgeSubtreesMany(db, roots) {
  let files = 0;
  let folders = 0;
  for (let i = 0; i < roots.length; i += SUBTREE_CHUNK) {
    const part = roots.slice(i, i + SUBTREE_CHUNK);
    const where = multiSubtreeWhere(part.length);
    const binds = multiSubtreeBinds(part);
    const rf = await db.prepare(
      `DELETE FROM files WHERE folder_id IN (SELECT id FROM folders WHERE ${where})`
    ).bind(...binds).run();
    files += Number(rf?.meta?.changes ?? 0);
    const rd = await db.prepare(`DELETE FROM folders WHERE ${where}`).bind(...binds).run();
    folders += Number(rd?.meta?.changes ?? 0);
  }
  return { files, folders };
}
__name(purgeSubtreesMany, "purgeSubtreesMany");
// items = [{kind:"file"|"folder", id}] → 两个去重后的 id 列表
function parseBatchItems(raw) {
  const fileIds = [];
  const folderIds = [];
  const list = Array.isArray(raw) ? raw.slice(0, BATCH_LIMIT) : [];
  for (const it of list) {
    const id = Math.trunc(Number(it?.id));
    if (!Number.isFinite(id) || id <= 0) continue;
    if (String(it?.kind || "file") === "folder") folderIds.push(id);
    else fileIds.push(id);
  }
  return { fileIds: [...new Set(fileIds)], folderIds: [...new Set(folderIds)] };
}
__name(parseBatchItems, "parseBatchItems");
function idOrNull(v) {
  return v === null || v === void 0 ? null : Number(v);
}
__name(idOrNull, "idOrNull");
// 批量删除「先算一遍」：谁会被删、多少字节。确认前和真删时都走这一条，保证两边数字一致。
async function planBatchDelete(db, fileIds, folderIds) {
  const frows = await selectByIds(db, "SELECT id, path FROM folders WHERE id IN (%IN%)", folderIds);
  const roots = dedupeRoots(frows.map((r) => String(r.path)));
  const sub = await collectSubtreesMany(db, roots);
  const subFolderSet = new Set(sub.folderIds);
  const allFrows = await selectByIds(db, "SELECT id, name, chat_id, message_id, size, folder_id FROM files WHERE id IN (%IN%)", fileIds);
  const filesSel = allFrows.filter((r) => !subFolderSet.has(Number(r.folder_id)));
  const bytes = sub.bytes + filesSel.reduce((s, f) => s + Number(f.size || 0), 0);
  return { roots, sub, filesSel, bytes, folders: sub.folderCount, files: sub.files.length + filesSel.length };
}
__name(planBatchDelete, "planBatchDelete");
// 真正落库（Telegram 侧消息要调用方自己先删 —— 需要 chat_id/message_id 的那几行在 plan 里）
async function applyBatchDelete(env, plan) {
  const delSub = await purgeSubtreesMany(env.DB, plan.roots);
  const delFiles = plan.filesSel.length ? await execInChunks(env.DB, "DELETE FROM files WHERE id IN (%IN%)", plan.filesSel.map((r) => Number(r.id))) : 0;
  await bumpCounters(env.DB, { files: -(delSub.files + delFiles), folders: -delSub.folders, bytes: -plan.bytes });
  if (delFiles + delSub.files) await logEvent(env.DB, "del", { n: delFiles + delSub.files, batch: true, ids: plan.filesSel.slice(0, 20).map((r) => Number(r.id)) });
  if (plan.roots.length) await logEvent(env.DB, "rmd", { n: delSub.folders, batch: true, paths: plan.roots.slice(0, 10) });
  return { deleted_files: delFiles + delSub.files, deleted_folders: delSub.folders };
}
__name(applyBatchDelete, "applyBatchDelete");
async function apiBatchDelete(env, body) {
  const { fileIds, folderIds } = parseBatchItems(body?.items);
  if (!fileIds.length && !folderIds.length) return fail("没有选中任何条目");
  if (folderIds.length > BATCH_DEL_FOLDER_LIMIT) {
    return fail(`一次最多删 ${BATCH_DEL_FOLDER_LIMIT} 个目录（选了 ${folderIds.length} 个），请分批`);
  }
  const force = body?.force === true || body?.force === 1 || body?.force === "1";
  const plan = await planBatchDelete(env.DB, fileIds, folderIds);
  // 确认口径和单条接口对齐：单选文件（DELETE /api/files/:id）本来就不弹确认，
  // 单选空目录也不弹；只有「目录里有东西」才要 force。
  if (!force && (plan.sub.files.length > 0 || plan.folders > plan.roots.length)) {
    return json({
      ok: false,
      need_confirm: true,
      folders: plan.folders,
      files: plan.files,
      bytes_human: human(plan.bytes),
      message: `选中 ${folderIds.length} 个目录 / ${fileIds.length} 个文件；连带算下来要删 ${plan.folders} 个目录、${plan.files} 个文件（共 ${human(plan.bytes)}）。确认请带 force=1 再来一次。`
    }, 409);
  }
  const n = await deleteMessages(env.TG_BOT_TOKEN, [...plan.sub.files, ...plan.filesSel], env.TG_CHAT_ID || "");
  const res = await applyBatchDelete(env, plan);
  return json({ ok: true, deleted_folders: res.deleted_folders, deleted_files: res.deleted_files, tg_messages: n });
}
__name(apiBatchDelete, "apiBatchDelete");
async function apiBatchMove(env, body) {
  const { fileIds, folderIds } = parseBatchItems(body?.items);
  if (!fileIds.length && !folderIds.length) return fail("没有选中任何条目");
  if (folderIds.length > BATCH_MOVE_FOLDER_LIMIT) {
    return fail(`一次最多移 ${BATCH_MOVE_FOLDER_LIMIT} 个目录（选了 ${folderIds.length} 个），请分批`);
  }
  let dstId = null;
  if (body?.target_id !== void 0 && body?.target_id !== null && body?.target_id !== "") {
    const tid = Math.trunc(Number(body.target_id));
    if (!Number.isFinite(tid)) return fail("target_id 不合法");
    if (!await resolvePathById(env, tid)) return fail("目标目录不存在", 404);
    dstId = tid;
  } else {
    const dst = await resolvePath(env.DB, normPath(String(body?.target ?? "/")));
    if (dst.err) return fail(`${dst.err}（目标目录必须已存在）`);
    dstId = dst.id;
  }
  const dstPath = await pathOfId(env.DB, dstId);
  let movedFiles = 0;
  let already = 0;
  let movedFolders = 0;
  if (fileIds.length) {
    const rows = await selectByIds(env.DB, "SELECT id, name, folder_id FROM files WHERE id IN (%IN%)", fileIds);
    const movers = [];
    for (const r of rows) {
      if (idOrNull(r.folder_id) === idOrNull(dstId)) already++;
      else movers.push(r);
    }
    if (movers.length) {
      const names = movers.map((r) => String(r.name));
      const dup = names.find((n, i) => names.indexOf(n) !== i);
      if (dup) return fail(`选中项里有多个同名文件「${dup}」，一次性移过去会互相覆盖，请分批或先改名`, 409);
      const clash = await queryInChunks(env.DB, "SELECT name FROM files WHERE folder_id IS ? AND name IN (%IN%)", names, [dstId]);
      if (clash.length) return fail(`目标目录里已有同名文件「${clash[0].name}」，请先改名或换目录`, 409);
      const prefix = (dstPath === "/" ? "" : asciiLower(dstPath)) + "/";
      await execInChunks(
        env.DB,
        "UPDATE files SET folder_id = ?, full_key = ? || lower(name) WHERE id IN (%IN%)",
        movers.map((r) => Number(r.id)),
        [dstId, prefix]
      );
      await logEvent(env.DB, "mv", { n: movers.length, path: dstPath });
      movedFiles = movers.length;
    }
  }
  if (folderIds.length) {
    const frows = await selectByIds(env.DB, "SELECT id, path FROM folders WHERE id IN (%IN%)", folderIds);
    const roots = dedupeRoots(frows.map((r) => String(r.path)));
    for (const p of roots) {
      if (isUnder(dstPath, p)) return fail(`不能把「${p}」移动到它自己或它的子目录里`);
    }
    const kept = [];
    for (const p of roots) {
      const row = frows.find((r) => String(r.path) === p);
      if (row) kept.push({ id: Number(row.id), path: p, name: p.slice(p.lastIndexOf("/") + 1) });
    }
    const names = kept.map((k) => k.name);
    const dup = names.find((n, i) => names.indexOf(n) !== i);
    if (dup) return fail(`选中项里有多个同名目录「${dup}/」，请分批移动或先改名`, 409);
    const clash = await queryInChunks(env.DB, "SELECT name FROM folders WHERE parent_id IS ? AND name IN (%IN%)", names, [dstId]);
    if (clash.length) return fail(`目标目录里已有同名目录「${clash[0].name}/」，请先改名或换目录`, 409);
    for (const k of kept) {
      const newPath = joinPath(dstPath, k.name);
      await env.DB.prepare("UPDATE folders SET parent_id = ?, path = ? WHERE id = ?").bind(dstId, newPath, k.id).run();
      await repathSubtree(env.DB, k.id, k.path, newPath);
      await repathFilesSubtree(env.DB, k.id, k.path, newPath);
      movedFolders++;
    }
    if (kept.length) await logEvent(env.DB, "mvd", { n: kept.length, new: dstPath });
  }
  return json({ ok: true, target: dstPath, moved_files: movedFiles, moved_folders: movedFolders, already_there: already });
}
__name(apiBatchMove, "apiBatchMove");
// 一次解析多个路径 —— /ls 那种逐个 resolveNode 是「每路径 3 条 SQL」，
// 这里全部压成 2 条：目录一条 IN，文件一条按 (父路径, 文件名) 的两列 IN。
async function resolveManyNodes(db, raws) {
  const out = /* @__PURE__ */ new Map();
  const wanted = [];
  const byId = [];
  for (const raw of raws) {
    // #13 / 13 —— 和单目标 /rm #13 一个口径：按文件编号解析，不当路径
    if (/^#?\d+$/.test(raw)) {
      byId.push({ raw, id: Number(raw.replace(/^#/, "")) });
      continue;
    }
    const p = normPath(raw);
    if (p === "/") {
      out.set(raw, { kind: "folder", id: null });
      continue;
    }
    wanted.push({ raw, path: p, parent: parentPath(p), name: baseName(p) });
  }
  if (byId.length) {
    const rows = await queryInChunks(db, "SELECT id FROM files WHERE id IN (%IN%)", byId.map((b) => b.id));
    const found = /* @__PURE__ */ new Set();
    for (const r of rows ?? []) found.add(Number(r.id));
    for (const b of byId) {
      if (found.has(b.id)) out.set(b.raw, { kind: "file", id: b.id });
      else out.set(b.raw, { kind: null, id: null, err: `没有 #${b.id} 这个文件` });
    }
  }
  if (!wanted.length) return out;
  const paths = [...new Set(wanted.map((w) => w.path))];
  const frows = await queryInChunks(db, "SELECT id, path FROM folders WHERE path IN (%IN%)", paths);
  const folderMap = /* @__PURE__ */ new Map();
  for (const r of frows ?? []) folderMap.set(String(r.path), Number(r.id));
  const parents = [...new Set(wanted.map((w) => w.parent))];
  const names = [...new Set(wanted.map((w) => w.name))];
  let fileRows = [];
  if (parents.length && names.length) {
    fileRows = await queryInChunks(
      db,
      "SELECT f.id AS id, f.name AS name, COALESCE(fo.path, '/') AS ppath FROM files f LEFT JOIN folders fo ON fo.id = f.folder_id " +
        `WHERE COALESCE(fo.path, '/') IN (${ph(parents.length)}) AND f.name IN (%IN%)`,
      names,
      parents
    );
  }
  for (const w of wanted) {
    const fid = folderMap.get(w.path);
    if (fid !== void 0) {
      out.set(w.raw, { kind: "folder", id: fid });
      continue;
    }
    const hit = fileRows.find((r) => String(r.ppath) === w.parent && String(r.name) === w.name);
    if (hit) {
      out.set(w.raw, { kind: "file", id: Number(hit.id) });
      continue;
    }
    out.set(w.raw, { kind: null, id: null, err: `路径不存在：${w.path}` });
  }
  return out;
}
__name(resolveManyNodes, "resolveManyNodes");
// 流式导出：用 id/seq 游标一批批读，边读边吐，内存与表大小无关。
// 老实现是三条 SELECT * + 一个巨型 JSON.stringify：1700 万行时内存和 CPU 双双爆炸（实测 1M 行就要 1.9s 且占住整块内存）。
async function dumpCursorInto(controller, enc, db, sql, key, chunk, onCount) {
  let cursor = 0;
  let first = true;
  let buf = "";
  for (let guard = 0; guard < 1e5; guard++) {
    const { results } = await db.prepare(sql).bind(cursor, chunk).all();
    const rows = results ?? [];
    if (!rows.length) break;
    cursor = Number(rows[rows.length - 1][key]);
    onCount(rows.length);
    for (const r of rows) {
      buf += (first ? "" : ",") + JSON.stringify(r);
      first = false;
      // 攒够 32KB 再入队：每行一次 enqueue 在 2 万行时会变成几万次流写入，CPU 全耗在这上面
      if (buf.length >= 32768) {
        controller.enqueue(enc.encode(buf));
        buf = "";
      }
    }
    if (rows.length < chunk) break;
  }
  if (buf) controller.enqueue(enc.encode(buf));
}
__name(dumpCursorInto, "dumpCursorInto");
async function apiExport(env, url) {
  const mode = (url.searchParams.get("mode") || "full").toLowerCase();
  const chunk = Math.min(Math.max(Number(url.searchParams.get("chunk")) || EXPORT_CHUNK, 50), 5000);
  if (mode === "meta") {
    const c = await readCounters(env.DB);
    return json({ ok: true, exported_at: (/* @__PURE__ */ new Date()).toISOString(), counts: { files: c.files, folders: c.folders, events: c.events }, chunk });
  }
  // 分块导出：一次只回一批，浏览器循环拉。这是 Free 档唯一能跑通的大导出方式——
  // 整包（mode=full）实测 2 万行要 45~50ms 纯 JS CPU，必然撞 1102。
  if (mode === "files" || mode === "folders" || mode === "events") {
    const after = Number(url.searchParams.get("after")) || 0;
    const limit = Math.min(Math.max(Number(url.searchParams.get("limit")) || EXPORT_CHUNK, 1), 2000);
    const sql = mode === "events" ? "SELECT seq, t, payload, ts FROM events WHERE seq > ? ORDER BY seq LIMIT ?" : mode === "files" ? "SELECT * FROM files WHERE id > ? ORDER BY id LIMIT ?" : "SELECT * FROM folders WHERE id > ? ORDER BY id LIMIT ?";
    const key = mode === "events" ? "seq" : "id";
    const { results } = await env.DB.prepare(sql).bind(after, limit).all();
    const rows = results ?? [];
    const next_after = rows.length ? Number(rows[rows.length - 1][key]) : after;
    return json({ ok: true, mode, rows, count: rows.length, next_after, done: rows.length < limit });
  }
  const stamp = (/* @__PURE__ */ new Date()).toISOString().replace(/[-:]/g, "").replace(/\..+$/, "").replace("T", "-");
  // 整包导出的守门：索引一大就必然撞 1102（实测 2.5 万行 ≈ 45~50ms 纯 JS CPU），
  // 与其让用户看一个毫无解释的 1102，不如直接说明该走分块。force=1 可强制（Paid 档）。
  {
    const force = ["1", "true", "yes", "on"].includes(String(url.searchParams.get("force") || "").toLowerCase());
    const c = await readCounters(env.DB);
    const total = (c.files || 0) + (c.folders || 0) + (c.events || 0);
    if (!force && total > FULL_EXPORT_GUARD) {
      return json({
        ok: false,
        error: "index_too_large_for_full_export",
        total,
        guard: FULL_EXPORT_GUARD,
        hint: "\u6574\u5305\u5BFC\u51FA\u4F1A\u649E Free \u6863 10ms CPU \u4E0A\u9650\u3002\u6539\u7528 mode=files|folders|events + after/limit \u5206\u5757\u62C9\uFF08\u7F51\u9875\u7AEF\u300C\u5BFC\u51FA\u7D22\u5F15\u300D\u6309\u94AE\u5DF2\u81EA\u52A8\u5206\u5757\uFF09\uFF1B\u786E\u5B9E\u8981\u6574\u5305\u5C31\u52A0 force=1\uFF08\u9700 Paid \u6863\uFF09\u3002"
      }, 413);
    }
  }
  const enc = new TextEncoder();
  const counts = { files: 0, folders: 0, events: 0 };
  const errors = [];
  const stream = new ReadableStream({
    async start(controller) {
      const emit = (s) => controller.enqueue(enc.encode(s));
      emit(`{"ok":true,"exported_at":${JSON.stringify((/* @__PURE__ */ new Date()).toISOString())},"files":[`);
      try {
        await dumpCursorInto(controller, enc, env.DB, "SELECT * FROM files WHERE id > ? ORDER BY id LIMIT ?", "id", chunk, (n) => {
          counts.files += n;
        });
      } catch (e) {
        errors.push(`files: ${e.message}`);
      }
      emit(`],"folders":[`);
      try {
        await dumpCursorInto(controller, enc, env.DB, "SELECT * FROM folders WHERE id > ? ORDER BY id LIMIT ?", "id", chunk, (n) => {
          counts.folders += n;
        });
      } catch (e) {
        errors.push(`folders: ${e.message}`);
      }
      emit(`],"events":[`);
      try {
        await dumpCursorInto(controller, enc, env.DB, "SELECT seq, t, payload, ts FROM events WHERE seq > ? ORDER BY seq LIMIT ?", "seq", chunk, (n) => {
          counts.events += n;
        });
      } catch (e) {
        errors.push(`events: ${e.message}`);
      }
      emit(`],"counts":{"files":${counts.files},"folders":${counts.folders},"events":${counts.events}}`);
      if (errors.length) emit(`,"errors":${JSON.stringify(errors)}`);
      emit(`}`);
      controller.close();
    }
  });
  return new Response(stream, {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "content-disposition": `attachment; filename="cfpool-index-${stamp}.json"`
    }
  });
}
__name(apiExport, "apiExport");

// src/index.ts
var JSON_HEADERS = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" };
function errorJson(message, status = 500) {
  return new Response(JSON.stringify({ ok: false, error: message }), {
    status,
    headers: JSON_HEADERS
  });
}
__name(errorJson, "errorJson");
function idFromPath(path, prefix) {
  if (!path.startsWith(prefix)) return null;
  const rest = path.slice(prefix.length);
  if (!/^\d+$/.test(rest)) return null;
  return Number(rest);
}
__name(idFromPath, "idFromPath");
var index_default = {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method.toUpperCase();
    setApiBase(env.TG_API_BASE);
    try {
      // 惰性自迁移：每个 isolate 生命周期内只真跑一次（其余请求命中模块级缓存）
      try {
        await ensureSchema(env.DB);
      } catch (e) {
        console.error("ensureSchema failed", { message: e?.message });
      }
      if (path.startsWith("/tg/")) {
        if (method !== "POST") return errorJson("method not allowed", 405);
        const secret = env.TG_WEBHOOK_SECRET || "";
        if (!secret) return errorJson("TG_WEBHOOK_SECRET \u672A\u8BBE\u7F6E", 503);
        const fromPath = path.slice("/tg/".length);
        const fromHeader = request.headers.get("x-telegram-bot-api-secret-token") || "";
        const pathOk = timingSafeEqualStr(fromPath, secret);
        const headerOk = timingSafeEqualStr(fromHeader, secret);
        if (!pathOk || !headerOk) {
          console.warn("webhook rejected", { pathOk, headerOk });
          return errorJson("forbidden", 403);
        }
        let update;
        try {
          update = await request.json();
        } catch {
          return errorJson("bad json", 400);
        }
        try {
          await handleUpdate(env, update);
        } catch (e) {
          const err = e;
          console.error("update processing failed", {
            updateId: update?.update_id,
            name: err?.name,
            message: err?.message,
            stack: err?.stack
          });
        }
        if (Math.random() < 0.02) ctx.waitUntil(pruneSeenUpdates(env.DB));
        return new Response("ok", { status: 200 });
      }
      if (path === "/health") {
        return new Response(JSON.stringify({ ok: true }), { headers: JSON_HEADERS });
      }
      if (!checkAuth(request, env)) return unauthorized();
      {
        const csrf = checkCsrf(request, url);
        if (csrf) return csrf;
      }
      if (path === "/" || path === "/index.html") {
        if (method !== "GET") return errorJson("method not allowed", 405);
        return new Response(renderPage(), {
          headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" }
        });
      }
      if (path === "/api/stats" && method === "GET") return await apiStats(env);
      if (path === "/api/list" && method === "GET") return await apiList(env, url);
      if (path === "/api/tree" && method === "GET") return await apiTree(env);
      if (path === "/api/export" && method === "GET") return await apiExport(env, url);
      if (path === "/api/admin/recount" && (method === "GET" || method === "POST")) {
        const c = await recountCounters(env.DB);
        return json({ ok: true, counters: c });
      }
      if (path === "/api/move" && method === "POST") {
        return await apiMoveByPath(env, await request.json().catch(() => ({})));
      }
      if (path === "/api/batch-delete" && method === "POST") {
        return await apiBatchDelete(env, await request.json().catch(() => ({})));
      }
      if (path === "/api/batch-move" && method === "POST") {
        return await apiBatchMove(env, await request.json().catch(() => ({})));
      }
      if (path === "/api/folders" && method === "POST") {
        return await apiCreateFolder(env, await request.json().catch(() => ({})));
      }
      const fid = idFromPath(path, "/api/folders/");
      if (fid !== null) {
        if (method === "PATCH") {
          return await apiUpdateFolder(env, fid, await request.json().catch(() => ({})));
        }
        if (method === "DELETE") {
          const force = url.searchParams.get("force") === "1";
          return await apiDeleteFolder(env, fid, force);
        }
      }
      const fileId = idFromPath(path, "/api/files/");
      if (fileId !== null) {
        if (method === "PATCH") {
          return await apiUpdateFile(env, fileId, await request.json().catch(() => ({})));
        }
        if (method === "DELETE") return await apiDeleteFile(env, fileId);
      }
      return errorJson("not found", 404);
    } catch (e) {
      const err = e;
      console.error("unhandled", { path, method, name: err?.name, message: err?.message, stack: err?.stack });
      return errorJson(`internal error: ${err?.name || "Error"}`, 500);
    }
  }
};
export {
  index_default as default
};