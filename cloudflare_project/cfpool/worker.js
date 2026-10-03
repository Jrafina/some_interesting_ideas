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
var HELP_TEXT = [
  "TG \u5B58\u50A8\u6C60 \xB7 \u547D\u4EE4\u4E00\u89C8",
  "",
  "\u628A\u6587\u4EF6\u76F4\u63A5\u53D1\u7ED9\u6211 = \u6536\u5F55\u8FDB\u6C60\u5B50\uFF08\u96F6\u4E0A\u4F20\uFF0C\u6587\u4EF6\u672C\u6765\u5C31\u5728 Telegram \u4E0A\uFF09",
  "\u60F3\u653E\u6307\u5B9A\u76EE\u5F55\uFF1A\u5728\u6587\u4EF6\u8BF4\u660E\u91CC\u5199\u4E00\u884C\u8DEF\u5F84\uFF0C\u4F8B\uFF1A/\u5DE5\u4F5C/2026\uFF08\u4E0D\u5B58\u5728\u4F1A\u81EA\u52A8\u521B\u5EFA\uFF09",
  "",
  "/search \u5173\u952E\u8BCD   \u6A21\u7CCA\u641C\u7D22\uFF1A\u6587\u4EF6\u540D\u6216\u6240\u5728\u8DEF\u5F84\u5305\u542B\u5373\u547D\u4E2D",
  "   \u4F8B\uFF1A/search \u62A5\u8868\u3000/search 2026 \u8D22\u52A1",
  "",
  "/ls [\u8DEF\u5F84]       \u5217\u51FA\u76EE\u5F55\u5185\u5BB9\uFF0C\u7701\u7565\u8DEF\u5F84\u5219\u5217\u6839\u76EE\u5F55",
  "   \u4F8B\uFF1A/ls\u3000/ls /\u5DE5\u4F5C/2026",
  "",
  "/get #\u7F16\u53F7       \u53D6\u56DE\u6587\u4EF6\uFF08\u7F16\u53F7\u6765\u81EA /ls \u6216 /search \u884C\u5C3E\u7684 #\u6570\u5B57\uFF09",
  "   \u4F8B\uFF1A/get #13\u3000\uFF08\u884C\u9996\u7684 1. 2. 3. \u53EA\u662F\u5E8F\u53F7\uFF0C\u4E0D\u80FD\u7528\u5B83\u53D6\u6587\u4EF6\uFF09",
  "",
  "/move \u6E90 \u76EE\u6807    \u79FB\u52A8\u6587\u4EF6\u6216\u6587\u4EF6\u5939\uFF0C\u76EE\u6807\u7559\u7A7A = \u632A\u5230\u6839\u76EE\u5F55",
  '   \u4F8B\uFF1A/move /\u5DE5\u4F5C/2026 /\u5F52\u6863\u3000/move "/\u6211\u7684 \u62A5\u544A"',
  "",
  "/rename \u8DEF\u5F84 \u65B0\u540D  \u6539\u540D\uFF08\u76EE\u5F55/\u6587\u4EF6\u90FD\u884C\uFF09\uFF0C\u4F4D\u7F6E\u4E0D\u52A8",
  "   \u4F8B\uFF1A/rename /\u5DE5\u4F5C/2026 2026\u5F52\u6863\u3000/rename /a/b.txt c.txt",
  "",
  "/rm \u8DEF\u5F84         \u5220\u9664\u6587\u4EF6\u6216\u76EE\u5F55\uFF08\u76EE\u5F55\u4F1A\u5148\u5F39\u786E\u8BA4\u6309\u94AE\uFF09",
  "   -f \u8DF3\u8FC7\u786E\u8BA4\u3000-file / -dir \u540C\u540D\u6D88\u6B67\u3000/rm #13 \u6309\u7F16\u53F7\u5220",
  "   \u4F8B\uFF1A/rm /\u5DE5\u4F5C/2026 -f\u3000/rm /a/b.txt -file",
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
  } catch (e) {
    console.error("event log failed", { t, message: e.message });
  }
}
__name(logEvent, "logEvent");
async function folderPathMaps(db) {
  const { results } = await db.prepare("SELECT id, name, parent_id FROM folders").all();
  const parents = /* @__PURE__ */ new Map();
  const names = /* @__PURE__ */ new Map();
  for (const r of results ?? []) {
    parents.set(r.id, r.parent_id);
    names.set(r.id, r.name);
  }
  const memo = /* @__PURE__ */ new Map();
  const resolve = /* @__PURE__ */ __name((fid) => {
    if (fid === null) return ["/", []];
    const hit = memo.get(fid);
    if (hit) return hit;
    const seg = names.get(fid);
    if (seg === void 0) return ["/", []];
    const [upStr, upList] = resolve(parents.get(fid) ?? null);
    const val = [
      upStr === "/" ? `/${seg}` : `${upStr.replace(/\/+$/, "")}/${seg}`,
      [...upList, { id: fid, name: seg }]
    ];
    memo.set(fid, val);
    return val;
  }, "resolve");
  for (const fid of parents.keys()) resolve(fid);
  const str = /* @__PURE__ */ new Map();
  const list = /* @__PURE__ */ new Map();
  for (const [fid, [s, l]] of memo) {
    str.set(fid, s);
    list.set(fid, l);
  }
  return { str, list };
}
__name(folderPathMaps, "folderPathMaps");
async function pathOf(db, folderId) {
  if (folderId === null) return "/";
  const maps = await folderPathMaps(db);
  return maps.str.get(folderId) ?? "/";
}
__name(pathOf, "pathOf");
async function resolvePath(db, path) {
  const segs = (path || "").split("/").filter((s) => s);
  if (!segs.length) return { id: null };
  let cur = null;
  for (const seg of segs) {
    const row = await db.prepare("SELECT id FROM folders WHERE parent_id IS ? AND name = ?").bind(cur, seg).first();
    if (!row) return { id: null, err: `\u8DEF\u5F84\u4E0D\u5B58\u5728\uFF1A${path}` };
    cur = row.id;
  }
  return { id: cur };
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
  let curPath = "";
  for (const raw of (path || "").split("/").filter((s) => s)) {
    const name = cleanFolderName(raw);
    const row = await db.prepare("SELECT id FROM folders WHERE parent_id IS ? AND name = ?").bind(cur, name).first();
    if (row) {
      cur = row.id;
    } else {
      const res = await db.prepare("INSERT INTO folders(name, parent_id, created_at) VALUES(?, ?, ?)").bind(name, cur, Date.now() / 1e3).run();
      cur = Number(res.meta.last_row_id);
      await logEvent(db, "mkdir", { path: `${curPath}/${name}` });
    }
    curPath += `/${name}`;
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
async function searchFiles(db, query, limit = MAX_HITS) {
  const toks = (query || "").split(/\s+/).filter(Boolean).map((t) => t.toLowerCase());
  if (!toks.length) return { items: [], total: 0 };
  const q = (query || "").trim().toLowerCase();
  const maps = await folderPathMaps(db);
  const { results } = await db.prepare(
    "SELECT id, name, size, mime, file_id, file_unique, message_id, chat_id, folder_id, created_at FROM files"
  ).all();
  const items = [];
  let total = 0;
  for (const r of results ?? []) {
    const nameL = (r.name || "").toLowerCase();
    const pStr = r.folder_id === null ? "/" : maps.str.get(r.folder_id) ?? "/";
    const pList = r.folder_id === null ? [] : maps.list.get(r.folder_id) ?? [];
    const fullL = `${pStr.replace(/\/+$/, "")}/${nameL}`;
    if (!toks.every((t) => fullL.includes(t))) continue;
    total += 1;
    if (total > limit) continue;
    let score;
    if (nameL === q) score = 0;
    else if (nameL.startsWith(q)) score = 1;
    else if (toks.every((t) => nameL.includes(t))) score = 2;
    else score = 3;
    items.push({ ...r, path: pList, path_str: pStr, score });
  }
  items.sort((a, b) => a.score - b.score || b.id - a.id);
  return { items, total };
}
__name(searchFiles, "searchFiles");
async function listFiles(db, folderId, limit, offset = 0) {
  const maps = await folderPathMaps(db);
  const { results } = await db.prepare(
    `SELECT id, name, size, mime, file_id, file_unique, message_id, chat_id, folder_id, created_at
       FROM files WHERE folder_id IS ? ORDER BY id DESC LIMIT ? OFFSET ?`
  ).bind(folderId, limit, offset).all();
  const pStr = folderId === null ? "/" : maps.str.get(folderId) ?? "/";
  const pList = folderId === null ? [] : maps.list.get(folderId) ?? [];
  return (results ?? []).map((r) => ({
    ...r,
    path: pList,
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
async function collectSubtree(db, folderId) {
  const folderIds = [];
  const files = [];
  let frontier = [folderId];
  const all = await db.prepare("SELECT id, parent_id FROM folders").all();
  const children = /* @__PURE__ */ new Map();
  for (const r of all.results ?? []) {
    const key = r.parent_id ?? -1;
    const arr = children.get(key) ?? [];
    arr.push(r.id);
    children.set(key, arr);
  }
  while (frontier.length) {
    const next = [];
    for (const fid of frontier) {
      folderIds.push(fid);
      for (const child of children.get(fid) ?? []) next.push(child);
      const { results } = await db.prepare("SELECT id, chat_id, message_id, size FROM files WHERE folder_id IS ?").bind(fid).all();
      for (const f of results ?? []) files.push(f);
    }
    frontier = next;
  }
  const bytes = files.reduce((s, f) => s + (f.size || 0), 0);
  return { folders: folderIds, files, bytes };
}
__name(collectSubtree, "collectSubtree");
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
      const kw = args.join(" ");
      if (!kw) {
        await sendMessage(token, cid, "\u7528\u6CD5\uFF1A/search \u5173\u952E\u8BCD\n\u4F8B\uFF1A/search \u62A5\u8868");
        return;
      }
      await replySearch(env, cid, kw);
      return;
    }
    case "/ls":
    case "/dir":
    case "/list":
      await replyLs(env, cid, args.join(" "));
      return;
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
      const t = await env.DB.prepare(
        "SELECT COUNT(*) AS c, COALESCE(SUM(size),0) AS s FROM files"
      ).first();
      const nf = await env.DB.prepare("SELECT COUNT(*) AS c FROM folders").first();
      await sendMessage(
        token,
        cid,
        `\u6C60\u5B50\u7EDF\u8BA1

\u6587\u4EF6 ${t?.c ?? 0} \u4E2A \xB7 \u5171 ${human(t?.s ?? 0)}
\u6587\u4EF6\u5939 ${nf?.c ?? 0} \u4E2A`
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
      const res2 = await env.DB.prepare("INSERT INTO folders(name, parent_id, created_at) VALUES(?, NULL, ?)").bind(inbox, Date.now() / 1e3).run();
      fid = Number(res2.meta.last_row_id);
      await logEvent(env.DB, "mkdir", { path: `/${inbox}` });
    }
  }
  const created = Date.now() / 1e3;
  const res = await env.DB.prepare(
    `INSERT INTO files(name, size, mime, file_id, file_unique, message_id, chat_id, folder_id, created_at)
       VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    info.name,
    info.size,
    info.mime,
    info.file_id,
    info.file_unique,
    msg?.message_id ?? null,
    String(cid),
    fid,
    created
  ).run();
  const newId = Number(res.meta.last_row_id);
  const path = await pathOf(env.DB, fid);
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
async function replyLs(env, cid, path) {
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
  const fid = folder.id;
  const subs = await listSubfolders(env.DB, fid);
  const files = await listFiles(env.DB, fid, LS_FILE_LIMIT);
  const hereStr = fid === null ? "/" : (await folderPathMaps(env.DB)).str.get(fid) ?? "/";
  const lines = [`\u76EE\u5F55 ${hereStr}`, ""];
  if (subs.length) {
    lines.push(`\u5B50\u76EE\u5F55\uFF08${subs.length}\uFF09`);
    for (const s of subs.slice(0, LS_DIR_LIMIT)) {
      lines.push(`  ${s.name}/   ${s.files} \u6587\u4EF6 \xB7 ${s.subs} \u5B50\u76EE\u5F55`);
    }
    lines.push("");
  }
  if (files.length) {
    lines.push(`\u6587\u4EF6\uFF08${files.length}\uFF09`);
    files.forEach((f, i) => {
      lines.push(`${i + 1}. ${f.name}   ${human(f.size)} \xB7 #${f.id}`);
    });
  }
  if (!subs.length && !files.length) lines.push("\uFF08\u7A7A\u76EE\u5F55\uFF09");
  const media = files.map((f) => ({ id: f.id, name: f.name, file_id: f.file_id, kind: mediaKind(f.name, f.mime) })).filter((m) => m.kind !== null);
  if (media.length > ALBUM_MAX) {
    const n = ALBUM_FAMILY.reduce((acc, [, want]) => acc + albumChunks(media.filter((m) => m.kind === want)).length, 0);
    lines.push(`\uFF08\u56FE\u7247/\u89C6\u9891\u5171 ${media.length} \u4E2A\uFF0C\u7F29\u7565\u56FE\u5206 ${n} \u6761\u6D88\u606F\u53D1\uFF09`);
  }
  lines.push(
    "",
    "\u53D6\u6587\u4EF6\uFF1A/get #\u7F16\u53F7\uFF08\u884C\u5C3E\u90A3\u4E2A #\u6570\u5B57\uFF09\u3000\u8FDB\u76EE\u5F55\uFF1A/ls \u5B8C\u6574\u8DEF\u5F84",
    "\u5220\uFF1A/rm \u8DEF\u5F84\u3000\u79FB\uFF1A/move \u6E90 \u76EE\u6807\u3000\u6539\u540D\uFF1A/rename \u8DEF\u5F84 \u65B0\u540D"
  );
  await sendMessage(token, cid, clip(lines.join("\n"), MSG_LIMIT));
  if (media.length) await sendMediaAlbum(env, cid, media);
}
__name(replyLs, "replyLs");
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
async function replySearch(env, cid, kw) {
  const { items, total } = await searchFiles(env.DB, kw, 20);
  if (!items.length) {
    await sendMessage(env.TG_BOT_TOKEN, cid, `\u6CA1\u6709\u5339\u914D\u300C${kw}\u300D\u7684\u6587\u4EF6\u3002`);
    return;
  }
  const lines = [`\u641C\u7D22\u300C${kw}\u300D\xB7 \u547D\u4E2D ${total} \u4E2A`, ""];
  for (const it of items) {
    lines.push(`#${it.id}  ${it.name}`);
    lines.push(`   ${human(it.size)} \xB7 ${it.path_str}`);
  }
  if (total > items.length) lines.push("", `\uFF08\u53EA\u5217\u51FA\u524D ${items.length} \u4E2A\uFF0C\u8BF7\u52A0\u5173\u952E\u8BCD\u7F29\u5C0F\u8303\u56F4\uFF09`);
  lines.push("", "\u53D6\u56DE\uFF1A/get #\u7F16\u53F7");
  await sendMessage(env.TG_BOT_TOKEN, cid, clip(lines.join("\n"), MSG_LIMIT));
}
__name(replySearch, "replySearch");
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
      '\u7528\u6CD5\uFF1A/rm \u8DEF\u5F84\n  \u5220\u76EE\u5F55\u4F1A\u5148\u5F39\u786E\u8BA4\u6309\u94AE\uFF0C\u52A0 -f \u8DF3\u8FC7\n  -file / -dir \u7528\u4E8E\u540C\u540D\u6D88\u6B67\u3000/rm #13 \u6309\u7F16\u53F7\u5220\u6587\u4EF6\n\u4F8B\uFF1A/rm /\u5DE5\u4F5C/2026\u3000/rm "/\u6211\u7684 \u62A5\u544A" -f\u3000/rm #13'
    );
    return;
  }
  const target = rest.join(" ");
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
  const sub = await collectSubtree(env.DB, node.id);
  const p = (await folderPathMaps(env.DB)).str.get(node.id) ?? target;
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

\u5305\u542B ${sub.folders.length} \u4E2A\u76EE\u5F55\u3001${sub.files.length} \u4E2A\u6587\u4EF6\uFF0C\u5171 ${human(sub.bytes)}\u3002
\u5220\u9664\u540E\u5C06\u4ECE Telegram \u4E00\u5E76\u79FB\u9664\uFF0C\u4E14\u4E0D\u53EF\u6062\u590D\u3002`;
  const tk = randomToken(12);
  await env.DB.prepare("INSERT INTO pending_rm(token, path, folder_id, chat_id, files, folders, bytes, ts) VALUES(?,?,?,?,?,?,?,?)").bind(tk, p, node.id, String(cid), sub.files.length, sub.folders.length, sub.bytes, Date.now() / 1e3).run();
  await sendMessage(token, cid, stat + sameHint, {
    reply_markup: {
      inline_keyboard: [[
        { text: "\u786E\u8BA4\u5220\u9664", callback_data: `rm:ok:${tk}` },
        { text: "\u53D6\u6D88", callback_data: `rm:no:${tk}` }
      ]]
    }
  });
}
__name(replyRm, "replyRm");
async function doDeleteFile(env, cid, fid, name) {
  const row = await env.DB.prepare("SELECT id, chat_id, message_id FROM files WHERE id = ?").bind(fid).first();
  if (!row) {
    await sendMessage(env.TG_BOT_TOKEN, cid, `\u6CA1\u6709 #${fid} \u8FD9\u4E2A\u6587\u4EF6\u3002`);
    return;
  }
  const n = await deleteMessages(env.TG_BOT_TOKEN, [row], env.TG_CHAT_ID || String(cid));
  await env.DB.prepare("DELETE FROM files WHERE id = ?").bind(fid).run();
  await logEvent(env.DB, "del", { id: fid });
  await sendMessage(
    env.TG_BOT_TOKEN,
    cid,
    `\u5DF2\u5220\u9664 #${fid}  ${name}
\uFF08Telegram \u4FA7\u6D88\u606F\u5220\u9664 ${n} \u6761\uFF09`
  );
}
__name(doDeleteFile, "doDeleteFile");
async function doDeleteFolder(env, cid, path, sub) {
  const n = await deleteMessages(env.TG_BOT_TOKEN, sub.files, env.TG_CHAT_ID || String(cid));
  for (const f of sub.files) {
    await env.DB.prepare("DELETE FROM files WHERE id = ?").bind(f.id).run();
  }
  for (const f of sub.folders.slice().reverse()) {
    await env.DB.prepare("DELETE FROM folders WHERE id = ?").bind(f).run();
  }
  await logEvent(env.DB, "rmd", { path });
  await sendMessage(
    env.TG_BOT_TOKEN,
    cid,
    `\u5DF2\u5220\u9664\u76EE\u5F55 ${path}
${sub.folders.length} \u4E2A\u76EE\u5F55\u3001${sub.files.length} \u4E2A\u6587\u4EF6 \uFF08\u5171 ${human(sub.bytes)}\uFF09\uFF0CTelegram \u4FA7\u5220\u9664 ${n} \u6761\u6D88\u606F`
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
  const sub = await collectSubtree(env.DB, node.id);
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
async function isSelfOrDescendant(env, candidate, ancestor) {
  let cur = candidate;
  const guard = /* @__PURE__ */ new Set();
  while (cur !== null) {
    if (cur === ancestor) return true;
    if (guard.has(cur)) return true;
    guard.add(cur);
    const row = await env.DB.prepare("SELECT parent_id FROM folders WHERE id = ?").bind(cur).first();
    cur = row?.parent_id ?? null;
  }
  return false;
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
  const srcRaw = parts[0];
  const dstRaw = parts.length > 1 ? parts.slice(1).join(" ") : "/";
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
  if (dst.id === src.id) {
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
    await env.DB.prepare("UPDATE files SET folder_id = ? WHERE id = ?").bind(dst.id, src.id).run();
    await logEvent(env.DB, "mv", { path: dstRaw, id: src.id });
  } else {
    const clash = await env.DB.prepare("SELECT id FROM folders WHERE parent_id IS ? AND name = ?").bind(dst.id, name).first();
    if (clash) {
      await sendMessage(token, cid, `\u76EE\u6807\u76EE\u5F55\u91CC\u5DF2\u7ECF\u6709\u540C\u540D\u5B50\u76EE\u5F55\u300C${name}/\u300D\uFF0C\u5148\u6539\u540D\u6216\u6362\u76EE\u5F55\u3002`);
      return;
    }
    await env.DB.prepare("UPDATE folders SET parent_id = ? WHERE id = ?").bind(dst.id, src.id).run();
    const maps2 = await folderPathMaps(env.DB);
    const newPath = maps2.str.get(src.id) ?? "";
    await logEvent(env.DB, "mvd", { path: srcPath, new: newPath });
  }
  const maps = await folderPathMaps(env.DB);
  const shown = src.kind === "file" ? `${dstRaw.replace(/\/+$/, "") || ""}/${name}` : maps.str.get(src.id) ?? "";
  await sendMessage(token, cid, `\u5DF2\u79FB\u52A8
${srcPath}
\u2192 ${normPath(shown)}`);
}
__name(replyMove, "replyMove");
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
    await env.DB.prepare("UPDATE files SET name = ? WHERE id = ?").bind(name2, node.id).run();
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
  const oldPath = srcPath;
  await env.DB.prepare("UPDATE folders SET name = ? WHERE id = ?").bind(name, node.id).run();
  const newPath = (await folderPathMaps(env.DB)).str.get(node.id) ?? "";
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
  }
  *{box-sizing:border-box}
  body{margin:0;font:14px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;background:var(--bg);color:var(--fg)}
  header{display:flex;align-items:center;gap:16px;padding:12px 18px;background:var(--panel);border-bottom:1px solid var(--line);position:sticky;top:0;z-index:5;flex-wrap:wrap}
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
  aside{width:248px;flex:0 0 248px;border-right:1px solid var(--line);min-height:calc(100vh - 57px);padding:12px;background:var(--panel)}
  main{flex:1;padding:18px;min-width:0}
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
    <table>
      <thead><tr><th>\u540D\u79F0</th><th style="width:90px">\u5927\u5C0F</th><th style="width:230px"></th></tr></thead>
      <tbody id="rows"></tbody>
    </table>
    <div class="empty" id="empty" style="display:none"></div>
  </main>
</div>

<div class="toast" id="toast"></div>

<script>
var currentFolder = null;
var currentPath = "/";
var isSearching = false;

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

function openFolder(id){
  isSearching = false;
  currentFolder = id;
  return api("/api/list" + (id===null ? "" : "?folder=" + encodeURIComponent(id))).then(function(d){
    currentPath = d.path;
    if(d.folder_id === null) currentFolder = null;
    render(d);
    return loadTree();
  }).catch(function(e){ toast(e.message, true); });
}

function doSearch(q){
  if(!q){ isSearching = false; return openFolder(currentFolder); }
  isSearching = true;
  return api("/api/list?q=" + encodeURIComponent(q)).then(function(d){
    currentPath = null;
    render(d, q);
  }).catch(function(e){ toast(e.message, true); });
}

function render(d, kw){
  var crumb;
  if(d.mode === "search"){
    crumb = '\u641C\u7D22 <b>' + esc(kw) + '</b> \xB7 \u547D\u4E2D ' + d.total + ' \u4E2A' +
            (d.files.length < d.total ? '\uFF08\u53EA\u663E\u793A\u524D ' + d.files.length + ' \u4E2A\uFF09' : '');
  } else {
    crumb = "\u4F4D\u7F6E\uFF1A<b>" + esc(d.path) + "</b>";
  }
  $("crumb").innerHTML = crumb;

  var html = "";
  if(d.mode === "list" && d.folders && d.folders.length){
    for(var i=0;i<d.folders.length;i++){
      var f = d.folders[i];
      html += '<tr data-kind="folder" data-id="' + f.id + '">' +
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
    return fetch(url + (force ? "?force=1" : ""), {method:"DELETE"}).then(function(r){
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

function refresh(){
  return Promise.all([loadStats(), isSearching ? loadTree() : openFolder(currentFolder)]);
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
$("btn-export").addEventListener("click", function(){ window.location.href = "/api/export"; });

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
    headers: { "www-authenticate": 'Basic realm="TG \u5B58\u50A8\u6C60", charset="UTF-8"' }
  });
}
__name(unauthorized, "unauthorized");
async function apiStats(env) {
  const t = await env.DB.prepare(
    "SELECT COUNT(*) AS files, COALESCE(SUM(size),0) AS bytes FROM files"
  ).first();
  const f = await env.DB.prepare("SELECT COUNT(*) AS c FROM folders").first();
  const ev = await env.DB.prepare("SELECT COUNT(*) AS c FROM events").first();
  return json({
    ok: true,
    files: t?.files ?? 0,
    bytes: t?.bytes ?? 0,
    bytes_human: human(t?.bytes ?? 0),
    folders: f?.c ?? 0,
    events: ev?.c ?? 0,
    // 明确告诉前端：这一版没有上传下载，别去渲染那两个按钮
    capabilities: { upload: false, download: false }
  });
}
__name(apiStats, "apiStats");
async function apiList(env, url) {
  const q = (url.searchParams.get("q") || "").trim();
  if (q) {
    const { items, total: total2 } = await searchFiles(env.DB, q, 500);
    return json({
      ok: true,
      mode: "search",
      query: q,
      total: total2,
      files: items.map(toFileDto)
    });
  }
  const raw = url.searchParams.get("folder");
  const folderId = raw === null || raw === "" ? null : Number(raw);
  if (folderId !== null && !Number.isFinite(folderId)) return fail("folder \u53C2\u6570\u4E0D\u5408\u6CD5");
  const folder = folderId === null ? { id: null } : await resolvePathById(env, folderId);
  if (!folder) return fail("\u76EE\u5F55\u4E0D\u5B58\u5728", 404);
  const maps = await folderPathMaps(env.DB);
  const subs = await listSubfolders(env.DB, folderId);
  const files = await listFiles(env.DB, folderId, 500);
  const total = await countFilesIn(env.DB, folderId);
  return json({
    ok: true,
    mode: "list",
    folder_id: folderId,
    path: folderId === null ? "/" : maps.str.get(folderId) ?? "/",
    path_list: folderId === null ? [] : maps.list.get(folderId) ?? [],
    folders: subs,
    files: files.map(toFileDto),
    total
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
  const { results } = await env.DB.prepare("SELECT id, name, parent_id FROM folders ORDER BY name COLLATE NOCASE").all();
  const rows = results ?? [];
  const byParent = /* @__PURE__ */ new Map();
  const nodes = /* @__PURE__ */ new Map();
  for (const r of rows) nodes.set(r.id, r);
  const build = /* @__PURE__ */ __name((pid, depth) => {
    if (depth > 32) return [];
    return rows.filter((r) => (r.parent_id ?? null) === pid).map((r) => ({ id: r.id, name: r.name, children: build(r.id, depth + 1) }));
  }, "build");
  void byParent;
  return json({ ok: true, root: build(null, 0) });
}
__name(apiTree, "apiTree");
async function apiCreateFolder(env, body) {
  const name = cleanFolderName(String(body?.name ?? ""));
  const parentId = body?.parent_id === null || body?.parent_id === void 0 ? null : Number(body.parent_id);
  if (parentId !== null && !Number.isFinite(parentId)) return fail("parent_id \u4E0D\u5408\u6CD5");
  if (parentId !== null && !await resolvePathById(env, parentId)) return fail("\u4E0A\u7EA7\u76EE\u5F55\u4E0D\u5B58\u5728", 404);
  const clash = await env.DB.prepare("SELECT id FROM folders WHERE parent_id IS ? AND name = ?").bind(parentId, name).first();
  if (clash) return fail(`\u8FD9\u4E2A\u76EE\u5F55\u4E0B\u5DF2\u7ECF\u6709\u300C${name}/\u300D\u4E86`, 409);
  const res = await env.DB.prepare("INSERT INTO folders(name, parent_id, created_at) VALUES(?, ?, ?)").bind(name, parentId, Date.now() / 1e3).run();
  const id = Number(res.meta.last_row_id);
  const maps = await folderPathMaps(env.DB);
  const p = maps.str.get(id) ?? `/${name}`;
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
  const mapsBefore = await folderPathMaps(env.DB);
  const oldPath = mapsBefore.str.get(id) ?? `/${row.name}`;
  await env.DB.prepare("UPDATE folders SET name = ? WHERE id = ?").bind(name, id).run();
  const mapsAfter = await folderPathMaps(env.DB);
  const newPath = mapsAfter.str.get(id) ?? `/${name}`;
  await logEvent(env.DB, "mvd", { path: oldPath, new: newPath });
  return json({ ok: true, id, name, old_path: oldPath, path: newPath, changed: true });
}
__name(apiUpdateFolder, "apiUpdateFolder");
async function apiDeleteFolder(env, id, force) {
  const folder = await resolvePathById(env, id);
  if (!folder) return fail("\u76EE\u5F55\u4E0D\u5B58\u5728", 404);
  const sub = await collectSubtree(env.DB, id);
  if (!force && (sub.files.length || sub.folders.length > 1)) {
    return json({
      ok: false,
      need_confirm: true,
      folders: sub.folders.length,
      files: sub.files.length,
      bytes_human: human(sub.bytes),
      message: `\u76EE\u5F55\u975E\u7A7A\uFF08${sub.folders.length} \u76EE\u5F55 / ${sub.files.length} \u6587\u4EF6\uFF09\u3002\u786E\u8BA4\u8BF7\u5E26 force=1 \u518D\u6765\u4E00\u6B21\u3002`
    }, 409);
  }
  const maps = await folderPathMaps(env.DB);
  const path = maps.str.get(id) ?? "";
  const n = await deleteMessages(env.TG_BOT_TOKEN, sub.files, env.TG_CHAT_ID || "");
  for (const f of sub.files) {
    await env.DB.prepare("DELETE FROM files WHERE id = ?").bind(f.id).run();
  }
  for (const f of sub.folders.slice().reverse()) {
    await env.DB.prepare("DELETE FROM folders WHERE id = ?").bind(f).run();
  }
  await logEvent(env.DB, "rmd", { path });
  return json({ ok: true, deleted_folders: sub.folders.length, deleted_files: sub.files.length, tg_messages: n });
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
    await env.DB.prepare("UPDATE files SET name = ? WHERE id = ?").bind(name, id).run();
    const parentMaps = await folderPathMaps(env.DB);
    await logEvent(env.DB, "ren", {
      id,
      name,
      path: row.folder_id === null ? "/" : parentMaps.str.get(row.folder_id) ?? "/"
    });
  }
  if (wantMove) {
    await env.DB.prepare("UPDATE files SET folder_id = ? WHERE id = ?").bind(folderId, id).run();
    const maps = await folderPathMaps(env.DB);
    await logEvent(env.DB, "mv", { id, path: folderId === null ? "/" : maps.str.get(folderId) ?? "/" });
  }
  return json({ ok: true, id, name, folder_id: folderId });
}
__name(apiUpdateFile, "apiUpdateFile");
async function apiDeleteFile(env, id) {
  const row = await env.DB.prepare("SELECT id, name, chat_id, message_id FROM files WHERE id = ?").bind(id).first();
  if (!row) return fail("\u6587\u4EF6\u4E0D\u5B58\u5728", 404);
  const n = await deleteMessages(env.TG_BOT_TOKEN, [row], env.TG_CHAT_ID || "");
  await env.DB.prepare("DELETE FROM files WHERE id = ?").bind(id).run();
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
    await env.DB.prepare("UPDATE files SET folder_id = ? WHERE id = ?").bind(dst.id, src.id).run();
    await logEvent(env.DB, "mv", { id: src.id, path: target });
    return json({ ok: true, kind: "file", id: src.id, moved_to: `${target.replace(/\/+$/, "")}/${name}` });
  }
  if (src.id === null) return fail("\u6839\u76EE\u5F55\u4E0D\u80FD\u79FB\u52A8");
  let cur = dst.id;
  const guard = /* @__PURE__ */ new Set();
  while (cur !== null) {
    if (cur === src.id) return fail("\u4E0D\u80FD\u628A\u76EE\u5F55\u79FB\u52A8\u5230\u81EA\u5DF1\u6216\u81EA\u5DF1\u7684\u5B50\u76EE\u5F55\u91CC");
    if (guard.has(cur)) break;
    guard.add(cur);
    const up = await env.DB.prepare("SELECT parent_id FROM folders WHERE id = ?").bind(cur).first();
    cur = up?.parent_id ?? null;
  }
  const clash = await env.DB.prepare("SELECT id FROM folders WHERE parent_id IS ? AND name = ?").bind(dst.id, name).first();
  if (clash) return fail(`\u76EE\u6807\u76EE\u5F55\u91CC\u5DF2\u6709\u5B50\u76EE\u5F55\u300C${name}/\u300D`, 409);
  await env.DB.prepare("UPDATE folders SET parent_id = ? WHERE id = ?").bind(dst.id, src.id).run();
  const after = await folderPathMaps(env.DB);
  const newPath = after.str.get(src.id) ?? "";
  await logEvent(env.DB, "mvd", { path: source, new: newPath });
  return json({ ok: true, kind: "folder", id: src.id, old_path: source, path: newPath });
}
__name(apiMoveByPath, "apiMoveByPath");
async function apiExport(env) {
  const files = await env.DB.prepare("SELECT * FROM files ORDER BY id").all();
  const folders = await env.DB.prepare("SELECT * FROM folders ORDER BY id").all();
  const events = await env.DB.prepare("SELECT seq, t, payload, ts FROM events ORDER BY seq").all();
  const stamp = (/* @__PURE__ */ new Date()).toISOString().replace(/[-:]/g, "").replace(/\..+$/, "").replace("T", "-");
  return new Response(
    JSON.stringify({
      ok: true,
      exported_at: (/* @__PURE__ */ new Date()).toISOString(),
      counts: {
        files: files.results?.length ?? 0,
        folders: folders.results?.length ?? 0,
        events: events.results?.length ?? 0
      },
      files: files.results ?? [],
      folders: folders.results ?? [],
      events: events.results ?? []
    }),
    {
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
        "content-disposition": `attachment; filename="cfpool-index-${stamp}.json"`
      }
    }
  );
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
      if (path === "/" || path === "/index.html") {
        if (method !== "GET") return errorJson("method not allowed", 405);
        return new Response(renderPage(), {
          headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" }
        });
      }
      if (path === "/api/stats" && method === "GET") return await apiStats(env);
      if (path === "/api/list" && method === "GET") return await apiList(env, url);
      if (path === "/api/tree" && method === "GET") return await apiTree(env);
      if (path === "/api/export" && method === "GET") return await apiExport(env);
      if (path === "/api/move" && method === "POST") {
        return await apiMoveByPath(env, await request.json().catch(() => ({})));
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
      return errorJson(`${err?.name || "Error"}: ${err?.message || "unknown"}`, 500);
    }
  }
};
export {
  index_default as default
};

