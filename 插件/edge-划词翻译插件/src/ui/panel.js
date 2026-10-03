/**
 * 划词翻译浮窗（Shadow DOM，样式与宿主页面隔离）
 * 被 content.js（普通网页）与 reader.html（内置 PDF 阅读器）共用
 */

import { langLabel } from "../lib/engines.js";
import { isDictCandidate, formatDict } from "../lib/dict.js";

const HOST_ID = "__st_panel_host__";

let host = null;
let ui = null;
let lastText = "";

const CSS = `
:host { all: initial; }
* { box-sizing: border-box; }
.wrap {
  position: fixed; z-index: 2147483647;
  width: 400px; max-width: calc(100vw - 24px);
  background: rgba(255, 255, 255, .72);
  -webkit-backdrop-filter: blur(22px) saturate(180%);
  backdrop-filter: blur(22px) saturate(180%);
  color: #1f2328;
  border: 1px solid rgba(255, 255, 255, .65);
  border-radius: 16px;
  box-shadow: 0 10px 40px rgba(15, 23, 42, .16), 0 1px 0 rgba(255, 255, 255, .8) inset;
  font: 14px/1.6 -apple-system, "Segoe UI", "Microsoft YaHei", system-ui, sans-serif;
  overflow: hidden; user-select: text;
}
@supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))) {
  .wrap { background: rgba(255, 255, 255, .96); }
}
.head {
  display: flex; align-items: center; gap: 8px;
  padding: 9px 12px;
  background: rgba(255, 255, 255, .38);
  border-bottom: 1px solid rgba(15, 23, 42, .07);
  cursor: move; user-select: none;
}
.title { font-size: 12px; color: #6b7280; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.btn {
  border: 1px solid rgba(15, 23, 42, .1); background: rgba(255, 255, 255, .6); color: #1f2328;
  border-radius: 8px; padding: 3px 10px; font-size: 12px; cursor: pointer;
  -webkit-backdrop-filter: blur(6px); backdrop-filter: blur(6px);
  transition: background .15s ease, transform .15s ease;
}
.btn:hover { background: rgba(255, 255, 255, .95); }
.btn:active { transform: scale(.97); }
.btn.primary { background: #2b6cf6; border-color: #2b6cf6; color: #fff; }
.btn.primary:hover { background: #1f5fe0; }
.body { padding: 14px 16px; max-height: 44vh; overflow: auto; }
.orig {
  font-size: 12px; color: #6b7280; background: rgba(15, 23, 42, .045); border-radius: 10px;
  padding: 9px 11px; margin-bottom: 11px; max-height: 90px; overflow: auto; white-space: pre-wrap;
  word-break: break-word;
}
.out { font-size: 15px; white-space: pre-wrap; word-break: break-word; }
/* ---- 词典视图（单词多义）---- */
.dict-head { display: flex; align-items: baseline; gap: 8px; margin-bottom: 8px; }
.dict-head .word { font-size: 17px; font-weight: 600; letter-spacing: .2px; }
.dict-head .ph { font-size: 12px; color: #6b7280; font-family: ui-monospace, Consolas, "Courier New", monospace; }
.dict-row { display: flex; gap: 9px; padding: 7px 0; border-top: 1px solid rgba(15, 23, 42, .06); }
.dict-row:first-of-type { border-top: 0; }
.dict-row .pos {
  flex: 0 0 40px; color: #2b6cf6; font-size: 12px; font-weight: 600; padding-top: 2px;
  font-family: ui-monospace, Consolas, "Courier New", monospace;
}
.dict-row .pos:empty { display: none; }
.dict-row .defs { flex: 1; min-width: 0; font-size: 14px; word-break: break-word; }
.loading { color: #6b7280; font-size: 13px; display: flex; align-items: center; gap: 8px; }
.spin { width: 14px; height: 14px; border: 2px solid rgba(43, 108, 246, .25); border-top-color: #2b6cf6; border-radius: 50%; animation: st-spin .8s linear infinite; }
@keyframes st-spin { to { transform: rotate(360deg); } }
.err { color: #b42318; font-size: 13px; white-space: pre-wrap; }
.err ul { margin: 6px 0 0; padding-left: 18px; }
.foot {
  display: flex; align-items: center; justify-content: space-between; gap: 8px;
  padding: 8px 12px; border-top: 1px solid rgba(15, 23, 42, .07);
  background: rgba(255, 255, 255, .34);
  font-size: 11px; color: #8b949e;
}
`;

function build() {
  host = document.getElementById(HOST_ID);
  if (host) {
    host.remove();
  }
  host = document.createElement("div");
  host.id = HOST_ID;
  const shadow = host.attachShadow({ mode: "open" });
  const style = document.createElement("style");
  style.textContent = CSS;
  const wrap = document.createElement("div");
  wrap.className = "wrap";
  wrap.innerHTML = `
    <div class="head">
      <span class="title">划词翻译</span>
      <button class="btn" data-act="copy">复制</button>
      <button class="btn" data-act="close">关闭 ✕</button>
    </div>
    <div class="body"><div class="loading"><span class="spin"></span><span>翻译中…</span></div></div>
    <div class="foot"><span class="meta"></span><span class="hint">Esc 关闭</span></div>
  `;
  shadow.appendChild(style);
  shadow.appendChild(wrap);
  document.documentElement.appendChild(host);

  const body = wrap.querySelector(".body");
  const meta = wrap.querySelector(".meta");
  const title = wrap.querySelector(".title");

  wrap.addEventListener("mousedown", (e) => {
    if (e.target.closest("button")) return;
    startDrag(wrap, e);
  });
  wrap.addEventListener("click", (e) => {
    const act = e.target.closest("button") && e.target.closest("button").dataset.act;
    if (act === "close") close();
    if (act === "copy") copyText(lastText);
  });

  ui = { wrap, body, meta, title };
  return ui;
}

function startDrag(wrap, e) {
  const startX = e.clientX;
  const startY = e.clientY;
  const rect = wrap.getBoundingClientRect();
  const baseLeft = rect.left;
  const baseTop = rect.top;
  const onMove = (ev) => {
    wrap.style.left = Math.min(Math.max(8, baseLeft + ev.clientX - startX), innerWidth - 80) + "px";
    wrap.style.top = Math.min(Math.max(8, baseTop + ev.clientY - startY), innerHeight - 40) + "px";
  };
  const onUp = () => {
    document.removeEventListener("mousemove", onMove);
    document.removeEventListener("mouseup", onUp);
  };
  document.addEventListener("mousemove", onMove);
  document.addEventListener("mouseup", onUp);
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text || "");
    flash("已复制");
  } catch (_) {
    const ta = document.createElement("textarea");
    ta.value = text || "";
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand("copy");
      flash("已复制");
    } catch (e2) {
      flash("复制失败");
    }
    ta.remove();
  }
}

function flash(msg) {
  if (!ui) return;
  ui.meta.textContent = msg;
  setTimeout(() => {
    if (ui) ui.meta.textContent = ui.meta.dataset.base || "";
  }, 1400);
}

function place(rect) {
  const w = ui.wrap.offsetWidth || 380;
  const h = ui.wrap.offsetHeight || 200;
  let left = (rect ? rect.right : innerWidth / 2) + 10;
  let top = rect ? rect.bottom + 6 : 80;
  if (left + w > innerWidth - 12) left = Math.max(12, (rect ? rect.left : innerWidth / 2) - w - 10);
  if (left < 12) left = 12;
  if (top + h > innerHeight - 12) top = Math.max(12, (rect ? rect.top : 80) - h - 8);
  ui.wrap.style.left = Math.max(8, Math.min(left, innerWidth - w - 8)) + "px";
  ui.wrap.style.top = Math.max(8, Math.min(top, innerHeight - 60)) + "px";
}

function renderLoading(text, label) {
  ui.body.innerHTML = `<div class="loading"><span class="spin"></span><span>${escapeHtml(label || "翻译中…")}</span></div>`;
  ui.title.textContent = truncate(text || "", 28);
  ui.meta.textContent = "";
  ui.meta.dataset.base = "";
}

function renderResult(text, result) {
  ui.title.textContent = truncate(text || "", 28);
  // 结果里直接带着词典数据（右键菜单那条路是 background 里查好的）→ 画词典视图
  if (result && result.ok && result.dict) {
    renderDict(text, result.dict);
    return;
  }
  if (result && result.ok) {
    const parts = [];
    parts.push(`<div class="orig">${escapeHtml(text)}</div>`);
    parts.push(`<div class="out">${escapeHtml(result.translation)}</div>`);
    ui.body.innerHTML = parts.join("");
    const tags = [result.engineLabel || (result.engine || "")];
    const pair = pairLabel(result);
    if (pair) tags.push(pair);
    if (result.account) tags.push("账号：" + result.account); // AI 接口用的是哪个账号
    if (result.upstream) tags.push("模型：" + result.upstream); // 自建代理实际用的模型（qwen3-30b / m2m100 ...）
    ui.meta.textContent = tags.filter(Boolean).join(" · ");
    ui.meta.dataset.base = ui.meta.textContent;
    lastText = result.translation;
  } else {
    const errs = (result && result.errors) || ["未知错误"];
    // 上下文失效不是"引擎配置"问题，别甩那句会把人带偏的提示
    const stale = !!(result && result.stale);
    const hint = stale ? STALE_HINT : "请在设置里检查翻译引擎配置。";
    ui.body.innerHTML =
      `<div class="err"><b>${stale ? "脚本已失效" : "翻译失败"}</b><ul>` +
      errs.map((e) => `<li>${escapeHtml(e)}</li>`).join("") +
      `</ul><div style="margin-top:8px">${escapeHtml(hint)}</div></div>`;
    ui.meta.textContent = stale ? "需刷新页面" : "失败";
    ui.meta.dataset.base = ui.meta.textContent;
    lastText = text || "";
  }
}

export function close() {
  if (host) {
    host.remove();
    host = null;
    ui = null;
  }
}

/**
 * 词典视图：单词多义（n. 表，手表 / v. 看，注视 …）
 * 数据来自 background → 有道词典，18~27ms；这里只管画。
 */
function renderDict(word, dict) {
  ui.title.textContent = truncate(word || "", 28);
  const ph = dict.phonetic ? `<span class="ph">/${escapeHtml(dict.phonetic)}/</span>` : "";
  const rows = dict.entries
    .map(
      (e) =>
        `<div class="dict-row"><span class="pos">${escapeHtml(e.pos)}</span>` +
        `<span class="defs">${escapeHtml(e.defs.join("；"))}</span></div>`
    )
    .join("");
  ui.body.innerHTML =
    `<div class="dict"><div class="dict-head"><span class="word">${escapeHtml(word)}</span>${ph}</div>${rows}</div>`;
  const n = dict.entries.reduce((s, e) => s + e.defs.length, 0);
  ui.meta.textContent = "有道词典 · " + (dict.entries.length > 1 ? dict.entries.length + " 组释义" : n + " 条释义");
  ui.meta.dataset.base = ui.meta.textContent;
  lastText = formatDict(word, dict); // 复制出来是 "watch /wɑːtʃ/\nv. …\nn. …"
}

export function isPanelEvent(e) {
  return !!(host && e && e.target && host.contains(e.target));
}

/**
 * @param {{text:string, rect?:DOMRect|{left:number,top:number,right:number,bottom:number}, result?:object, loading?:string}} opts
 */
export function showPanel(opts) {
  const text = (opts.text || "").trim();
  if (!text) return;
  build();
  lastText = text;
  renderLoading(text, opts.loading);
  place(opts.rect);
  bindGlobalClose();
  if (opts.result) {
    renderResult(text, opts.result);
    place(opts.rect);
  }
}

let bound = false;
function bindGlobalClose() {
  if (bound) return;
  bound = true;
  document.addEventListener(
    "mousedown",
    (e) => {
      if (host && !host.contains(e.target)) close();
    },
    true
  );
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && host) {
      close();
      bound = false;
    }
  });
}

/**
 * 扩展被重新加载/更新后，**已经打开的网页**里那份旧 content script 会变成"孤儿"：
 * 它还在页面上跑（双击照样触发、浮窗照样弹），但手里的 chrome.runtime 已经断连，
 * 任何 sendMessage 都抛 `Extension context invalidated.`。
 *
 * 实测（tests/tmp-invalidate.cjs）：
 *  - 重新加载扩展后，没刷新的页面必现这个错；PDF 阅读器是扩展自己的页面，每次打开都是新加载，所以正常。
 *  - 想让 background 重新注入 content.js 去救它 → **做不到**：扩展只有 activeTab（按手势逐次授予），
 *    没有任意站点的 host 权限，executeScript 直接报
 *    "Cannot access contents of the page. Extension manifest must request permission..."
 *  - **刷新页面（F5）→ 立即恢复**，这是唯一出路。
 * 所以这里必须给出"刷新页面"的提示，而不是甩一句"请在设置里检查翻译引擎配置"（会把用户带偏）。
 */
function ctxAlive() {
  try {
    return !!(chrome && chrome.runtime && chrome.runtime.id);
  } catch (_) {
    return false;
  }
}

function ctxInvalidated(err) {
  return /context invalidated/i.test(String((err && err.message) || err || ""));
}

const STALE_HINT = "网页里的脚本已失效（扩展刚被重新加载或更新过）。刷新本页（F5 / Ctrl+R）后即可恢复。";

/** 请求翻译并展示；单个英文单词走词典视图（多义），其余走翻译引擎链 */
export async function translateAndShow(text, rect) {
  const clean = (text || "").trim();
  if (!clean) return;
  const asWord = isDictCandidate(clean);
  showPanel({ text: clean, rect, loading: asWord ? "查询词典…" : "" });
  // 上下文已经没了就别白等 sendMessage 抛错，直接给可操作的提示
  if (!ctxAlive()) {
    if (!host || lastText !== clean) return;
    renderResult(clean, { ok: false, errors: ["Extension context invalidated."], stale: true });
    place(rect);
    return;
  }
  let result;
  try {
    if (asWord) {
      const r = await chrome.runtime.sendMessage({ type: "lookup-word", word: clean });
      if (!host || lastText !== clean) return; // 已被关闭或切换
      // 查到就画词典；查不到（词库没有 / 网络不通）不报错，往下走翻译
      if (r && r.ok && r.dict) {
        renderDict(clean, r.dict);
        place(rect);
        return;
      }
    }
    result = await chrome.runtime.sendMessage({ type: "translate", text: clean });
  } catch (e) {
    result = { ok: false, errors: [String(e && e.message)], stale: ctxInvalidated(e) };
  }
  if (!host || lastText !== clean) return; // 已被关闭或切换
  renderResult(clean, result);
  place(rect);
}

/** "英 → 中" 这类方向标签；拿不到识别结果时只显示目标 */
function pairLabel(result) {
  const to = result.target ? langLabel(result.target) : "";
  if (!to) return result.detected ? "识别：" + result.detected : "";
  const from = result.detected ? langLabel(result.detected) : "自动";
  return from + " → " + to;
}

function truncate(s, n) {
  s = String(s).replace(/\s+/g, " ").trim();
  return s.length > n ? s.slice(0, n) + "…" : s;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[c]);
}
