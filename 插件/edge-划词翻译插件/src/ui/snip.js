/**
 * 截屏翻译：框选屏幕区域 → 截图裁剪 → 自建代理 OCR → 走引擎链翻译 → 浮窗显示
 * 共用于 content.js（普通网页，动态 import）与 reader.js（内置 PDF 阅读器，静态 import）
 *
 * 触发链：Alt+S / 右键菜单 / popup 按钮 → background 转发消息 "snip-translate"。
 * 截图由 background 调 captureVisibleTab（需要 activeTab 授权），在浮层出现
 * 之前就截好，所以框选界面里看到的是"冻结"的页面，拖框不会把浮层自己截进去。
 *
 * 坐标映射：截图是物理像素，框选是 CSS 像素，用
 *   scaleX = img.naturalWidth / window.innerWidth
 * 换算 —— 浏览器缩放 / devicePixelRatio 都被这个比值自动吃掉。
 */

import { translateAndShow, showPanel } from "./panel.js";

const HOST_ID = "__st_snip_host__";

let host = null;
let shadow = null;

const CSS = `
:host { all: initial; }
* { box-sizing: border-box; }
.layer {
  position: fixed; inset: 0; z-index: 2147483647;
  cursor: crosshair; user-select: none;
}
.shot {
  position: absolute; left: 0; top: 0; width: 100%; height: 100%;
  user-select: none; -webkit-user-drag: none;
}
.shade { position: absolute; inset: 0; background: rgba(15, 23, 42, .42); }
.sel {
  position: absolute; display: none;
  border: 1.5px solid #2b6cf6; border-radius: 4px;
  /* 巨大 spread 的 box-shadow 当遮罩：框内清晰、框外压暗 */
  box-shadow: 0 0 0 200000px rgba(15, 23, 42, .42);
}
.sel .size {
  position: absolute; right: 0; bottom: -30px;
  padding: 2px 8px; border-radius: 7px; white-space: nowrap;
  background: rgba(255, 255, 255, .78);
  -webkit-backdrop-filter: blur(10px); backdrop-filter: blur(10px);
  border: 1px solid rgba(255, 255, 255, .7);
  color: #1f2328; font: 12px/1.5 -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif;
}
.hint {
  position: absolute; top: 18px; left: 50%; transform: translateX(-50%);
  padding: 6px 14px; border-radius: 10px; white-space: nowrap;
  background: rgba(255, 255, 255, .72);
  -webkit-backdrop-filter: blur(18px) saturate(180%); backdrop-filter: blur(18px) saturate(180%);
  border: 1px solid rgba(255, 255, 255, .65);
  box-shadow: 0 4px 20px rgba(15, 23, 42, .14);
  color: #1f2328; font: 13px/1.5 -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif;
  cursor: default;
}
.toast {
  position: fixed; z-index: 2147483647;
  display: flex; align-items: center; gap: 8px;
  padding: 8px 14px; border-radius: 11px; max-width: 70vw;
  background: rgba(255, 255, 255, .72);
  -webkit-backdrop-filter: blur(18px) saturate(180%); backdrop-filter: blur(18px) saturate(180%);
  border: 1px solid rgba(255, 255, 255, .65);
  box-shadow: 0 8px 30px rgba(15, 23, 42, .18);
  color: #1f2328; font: 13px/1.5 -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif;
}
.toast .spin {
  width: 13px; height: 13px; flex: none; border-radius: 50%;
  border: 2px solid rgba(43, 108, 246, .25); border-top-color: #2b6cf6;
  animation: st-snip-spin .8s linear infinite;
}
@keyframes st-snip-spin { to { transform: rotate(360deg); } }
.toast.err { color: #b42318; }
`;

function send(msg) {
  try {
    return chrome.runtime.sendMessage(msg);
  } catch (e) {
    return Promise.resolve({ ok: false, error: String((e && e.message) || e) });
  }
}

function ensureHost() {
  if (host) host.remove();
  host = document.createElement("div");
  host.id = HOST_ID;
  shadow = host.attachShadow({ mode: "open" });
  const style = document.createElement("style");
  style.textContent = CSS;
  shadow.appendChild(style);
  document.documentElement.appendChild(host);
  return shadow;
}

function teardown() {
  if (host) {
    host.remove();
    host = null;
    shadow = null;
  }
}

/* ------------------------------ 提示气泡 ------------------------------ */
let toastTimer = null;

function showToast(text, opts) {
  if (!shadow) ensureHost();
  let el = shadow.querySelector(".toast");
  if (!el) {
    el = document.createElement("div");
    el.className = "toast";
    el.innerHTML = `<span class="spin"></span><span class="msg"></span>`;
    shadow.appendChild(el);
  }
  el.classList.toggle("err", !!(opts && opts.err));
  el.querySelector(".spin").style.display = opts && opts.spin === false ? "none" : "";
  el.querySelector(".msg").textContent = text;
  const rect = opts && opts.rect;
  let left = rect ? rect.left : innerWidth / 2 - 80;
  let top = rect ? rect.bottom + 10 : innerHeight / 2 - 40;
  left = Math.max(8, Math.min(left, innerWidth - 200));
  top = Math.max(8, Math.min(top, innerHeight - 50));
  el.style.left = left + "px";
  el.style.top = top + "px";
  clearTimeout(toastTimer);
  if (opts && opts.ttl) {
    toastTimer = setTimeout(() => {
      el.remove();
      if (!shadow.querySelector(".layer")) teardown();
    }, opts.ttl);
  }
}

function hideToast() {
  clearTimeout(toastTimer);
  const el = shadow && shadow.querySelector(".toast");
  if (el) el.remove();
}

/* ------------------------------ 框选界面 ------------------------------ */

/**
 * 显示冻结截图，让用户拖一个框。resolve({ image, rect }) 或 resolve(null)（取消）。
 */
function beginSelect(dataUrl) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onerror = () => {
      teardown();
      resolve(null);
      showToast("截图加载失败", { err: true, ttl: 3000 });
    };
    img.onload = () => runSelect(img, resolve);
    img.src = dataUrl;
  });
}

function runSelect(img, resolve) {
  const root = ensureHost();

  const layer = document.createElement("div");
  layer.className = "layer";
  const shot = document.createElement("img");
  shot.className = "shot";
  shot.src = img.src;
  shot.draggable = false;
  const shade = document.createElement("div");
  shade.className = "shade";
  const sel = document.createElement("div");
  sel.className = "sel";
  sel.innerHTML = `<span class="size"></span>`;
  const hint = document.createElement("div");
  hint.className = "hint";
  hint.textContent = "拖动框选要翻译的区域 · Esc / 右键取消";
  layer.append(shot, shade, sel, hint);
  root.appendChild(layer);

  let x0 = 0;
  let y0 = 0;
  let dragging = false;

  const onKey = (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      finish(null);
    }
  };
  const onDown = (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    dragging = true;
    x0 = e.clientX;
    y0 = e.clientY;
    shade.style.display = "none";
    sel.style.display = "block";
    sel.style.left = x0 + "px";
    sel.style.top = y0 + "px";
    sel.style.width = "0px";
    sel.style.height = "0px";
  };
  const onMove = (e) => {
    if (!dragging) return;
    const left = Math.min(x0, e.clientX);
    const top = Math.min(y0, e.clientY);
    const w = Math.abs(e.clientX - x0);
    const h = Math.abs(e.clientY - y0);
    sel.style.left = left + "px";
    sel.style.top = top + "px";
    sel.style.width = w + "px";
    sel.style.height = h + "px";
    sel.querySelector(".size").textContent = Math.round(w) + " × " + Math.round(h);
  };
  const onUp = (e) => {
    if (e.button !== 0 || !dragging) return;
    dragging = false;
    const x1 = e.clientX;
    const y1 = e.clientY;
    const w = Math.abs(x1 - x0);
    const h = Math.abs(y1 - y0);
    // 太小的框当"点了一下"处理：取消而不是送一张空白图去 OCR
    if (w < 12 || h < 12) {
      finish(null);
      return;
    }
    finish({
      image: crop(img, x0, y0, x1, y1),
      rect: {
        left: Math.min(x0, x1),
        top: Math.min(y0, y1),
        right: Math.max(x0, x1),
        bottom: Math.max(y0, y1),
      },
    });
  };
  const onCancel = (e) => {
    e.preventDefault();
    finish(null);
  };
  const onWheel = (e) => e.preventDefault(); // 框选中锁滚动，免得底下的页面跑掉

  function finish(result) {
    document.removeEventListener("keydown", onKey, true);
    layer.remove();
    if (!result) teardown();
    resolve(result);
  }

  document.addEventListener("keydown", onKey, true);
  layer.addEventListener("mousedown", onDown);
  layer.addEventListener("mousemove", onMove);
  layer.addEventListener("mouseup", onUp);
  layer.addEventListener("contextmenu", onCancel);
  layer.addEventListener("wheel", onWheel, { passive: false });
}

/* ------------------------------ 裁剪 ------------------------------ */

function crop(img, x0, y0, x1, y1) {
  const scaleX = img.naturalWidth / Math.max(1, innerWidth);
  const scaleY = img.naturalHeight / Math.max(1, innerHeight);
  let sx = Math.max(0, Math.round(Math.min(x0, x1) * scaleX));
  let sy = Math.max(0, Math.round(Math.min(y0, y1) * scaleY));
  let sw = Math.max(1, Math.round(Math.abs(x1 - x0) * scaleX));
  let sh = Math.max(1, Math.round(Math.abs(y1 - y0) * scaleY));
  if (sx + sw > img.naturalWidth) sw = img.naturalWidth - sx;
  if (sy + sh > img.naturalHeight) sh = img.naturalHeight - sy;

  // 尺寸策略：视觉模型按 1280×720 一档处理，大了先自己压（省流量）；
  // 小区域放大 2 倍，小字号更容易识别。
  const longest = Math.max(sw, sh);
  let k = 1;
  if (longest > 1280) k = 1280 / longest;
  else if (longest < 320) k = 2;

  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(sw * k));
  canvas.height = Math.max(1, Math.round(sh * k));
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
  let out = canvas.toDataURL("image/png");
  if (out.length > 3_500_000) out = canvas.toDataURL("image/jpeg", 0.9); // 兜底降体积
  return out;
}

/* ------------------------------ 主流程 ------------------------------ */

/**
 * @param {{dataUrl?:string}} [opts] dataUrl 可直接给一张图（跳过截图）。
 *        生产触发不带它；留给"从剪贴板图片翻译"这类入口和自动化测试。
 */
export async function startSnip(opts) {
  if (host) return; // 已在框选中

  let dataUrl = (opts && opts.dataUrl) || "";
  if (!dataUrl) {
    const cap = await send({ type: "capture-tab" });
    if (!cap || !cap.ok || !cap.dataUrl) {
      showToast("截屏失败：" + ((cap && cap.error) || "当前页面不允许截图"), { err: true, ttl: 4000 });
      return;
    }
    dataUrl = cap.dataUrl;
  }

  const picked = await beginSelect(dataUrl);
  if (!picked) return; // 用户取消

  showToast("正在识别文字…", { rect: picked.rect });
  let ocr = null;
  try {
    ocr = await send({ type: "snip-ocr", image: picked.image });
  } catch (e) {
    ocr = { ok: false, error: String((e && e.message) || e) };
  }

  const text = ocr && ocr.ok ? String(ocr.text || "").trim() : "";
  if (!ocr || !ocr.ok) {
    hideToast();
    teardown();
    // 复用翻译浮窗展示错误：带 Esc 关闭 / 拖动 / 复制那套行为
    showPanel({
      text: "（截屏翻译）",
      rect: picked.rect,
      result: { ok: false, errors: ["文字识别失败：" + ((ocr && ocr.error) || "未知错误")] },
    });
    return;
  }
  if (!text) {
    showToast("没识别到文字，试试框大一点或放大页面", { err: true, ttl: 3500 });
    setTimeout(teardown, 3600);
    return;
  }

  hideToast();
  teardown();
  translateAndShow(text, picked.rect); // 走原有引擎链 + 浮窗
}
