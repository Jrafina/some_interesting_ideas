import * as pdfjsLib from "../vendor/pdfjs/pdf.min.mjs";
import { translateAndShow, showPanel, isPanelEvent } from "./ui/panel.js";
import { startSnip } from "./ui/snip.js";

pdfjsLib.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL("vendor/pdfjs/pdf.worker.min.mjs");

const $ = (id) => document.getElementById(id);
const viewer = $("viewer");
const pagesBox = $("pages");

let doc = null;
let scale = 1.2;
let baseWidth = 600; // scale=1 时的页宽
let rendered = new Map(); // index -> scale
let visibleTimer = null;
const errors = []; // 渲染过程中收集的错误，便于排查

/* --------------------------- 打开与渲染 --------------------------- */
async function openFile(file) {
  if (!file) return;
  showLoading("正在解析 PDF…");
  try {
    const buf = await file.arrayBuffer();
    if (doc && doc.destroy) {
      const old = doc;
      doc = null; // 让进行中的渲染循环安静退出
      await old.destroy().catch(() => {});
    }
    errors.length = 0;
    doc = await pdfjsLib.getDocument({
      data: buf,
      cMapUrl: chrome.runtime.getURL("vendor/pdfjs/cmaps/"),
      cMapPacked: true,
      standardFontDataUrl: chrome.runtime.getURL("vendor/pdfjs/standard_fonts/"),
    }).promise;
    document.title = file.name + " · PDF 划词翻译";
    document.body.classList.add("loaded");
    const first = await doc.getPage(1);
    baseWidth = first.getViewport({ scale: 1 }).width;
    scale = fitScale();
    buildPages();
    updatePageLabel(1);
    hideLoading();
  } catch (e) {
    hideLoading();
    alert("打开 PDF 失败：" + (e && e.message ? e.message : e));
  }
}

function fitScale() {
  const w = viewer.clientWidth - 40;
  return Math.max(0.4, Math.min(3, w / baseWidth));
}

function buildPages() {
  pagesBox.innerHTML = "";
  rendered = new Map();
  for (let i = 1; i <= doc.numPages; i++) {
    const el = document.createElement("div");
    el.className = "page";
    el.dataset.index = String(i);
    el.style.width = Math.floor(baseWidth * scale) + "px";
    el.style.height = Math.floor((baseWidth * 1.414) * scale) + "px"; // 占位，渲染后修正
    pagesBox.appendChild(el);
    observer.observe(el);
  }
  // 不用 requestAnimationFrame：标签页不可见时它会被节流甚至不触发（切回标签会看到空白页）
  setTimeout(() => renderVisible(), 0);
}

const observer = new IntersectionObserver(
  (entries) => {
    for (const e of entries) {
      if (e.isIntersecting) scheduleRender(e.target);
    }
  },
  { root: viewer, rootMargin: "800px 0px" }
);

function scheduleRender(el) {
  clearTimeout(visibleTimer);
  visibleTimer = setTimeout(() => renderVisible(), 60);
}

let renderBusy = false;
let renderAgain = false;

/**
 * 渲染可见页。滚动、观察者、标签可见性变化都会调用它，
 * 用队列串行化：同一页绝不会同时渲染两次（pdf.js 会报
 * "Cannot use the same canvas during multiple render() operations"）。
 */
async function renderVisible() {
  if (!doc) return;
  if (renderBusy) {
    renderAgain = true;
    return;
  }
  renderBusy = true;
  try {
    do {
      renderAgain = false;
      if (!doc) break;
      const viewTop = viewer.scrollTop - 900;
      const viewBottom = viewer.scrollTop + viewer.clientHeight + 900;
      for (const el of pagesBox.children) {
        if (!doc) break;
        const top = el.offsetTop;
        const bottom = top + el.offsetHeight;
        if (bottom < viewTop || top > viewBottom) continue;
        const idx = Number(el.dataset.index);
        if (rendered.get(idx) === scale) continue;
        if (el.dataset.rendering === "1") continue;
        el.dataset.rendering = "1";
        try {
          await renderPage(idx, el);
        } catch (e) {
          pushError("第 " + idx + " 页：" + (e && e.message ? e.message : e));
          console.error("[reader] 渲染第 " + idx + " 页失败", e);
        } finally {
          el.dataset.rendering = "0";
        }
        // 让出主线程，避免长 PDF 卡住 UI
        await new Promise((r) => setTimeout(r, 0));
      }
    } while (renderAgain);
  } finally {
    renderBusy = false;
  }
}

function pushError(msg) {
  errors.push(msg);
  if (errors.length > 20) errors.shift();
}

function isCancelled(e) {
  const s = (e && (e.name || "")) + " " + (e && e.message ? e.message : "");
  return /cancel/i.test(s);
}

async function renderPage(index, el) {
  // 上一次渲染还没结束就先取消，避免同一 canvas 被并发使用
  if (el.__task) {
    try {
      el.__task.cancel();
    } catch (_) {}
    el.__task = null;
  }
  const page = await doc.getPage(index);
  const viewport = page.getViewport({ scale });
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  el.style.width = Math.floor(viewport.width) + "px";
  el.style.height = Math.floor(viewport.height) + "px";

  let canvas = el.querySelector("canvas");
  if (!canvas) {
    canvas = document.createElement("canvas");
    el.appendChild(canvas);
  }
  canvas.width = Math.floor(viewport.width * dpr);
  canvas.height = Math.floor(viewport.height * dpr);
  canvas.style.width = Math.floor(viewport.width) + "px";
  canvas.style.height = Math.floor(viewport.height) + "px";
  const ctx = canvas.getContext("2d");

  // 先铺文本层：即使画布渲染失败，划词翻译依旧可用
  let layer = el.querySelector(".text-layer");
  if (!layer) {
    layer = document.createElement("div");
    layer.className = "text-layer";
    el.appendChild(layer);
  }
  await renderTextLayer(page, layer, viewport);

  const params = { canvasContext: ctx, viewport };
  if (dpr !== 1) params.transform = [dpr, 0, 0, dpr, 0, 0];
  const task = page.render(params);
  el.__task = task;
  try {
    await Promise.race([
      task.promise,
      new Promise((_, rej) => setTimeout(() => rej(new Error("画布渲染超时")), 25000)),
    ]);
    rendered.set(index, scale);
  } catch (e) {
    if (!isCancelled(e)) {
      pushError("第 " + index + " 页画布：" + (e && e.message ? e.message : e));
      console.error("[reader] 第 " + index + " 页画布渲染失败", e);
    }
  } finally {
    if (el.__task === task) el.__task = null;
  }
}

// 从后台标签切回来时补齐渲染（后台时 rAF/观察者回调可能被暂停）
document.addEventListener("visibilitychange", () => {
  if (!document.hidden && doc) renderVisible();
});
window.addEventListener("focus", () => {
  if (doc) renderVisible();
});

async function renderTextLayer(page, container, viewport) {
  const content = await page.getTextContent();
  container.textContent = "";
  const measurer = document.createElement("span");
  measurer.style.position = "absolute";
  measurer.style.visibility = "hidden";
  measurer.style.whiteSpace = "pre";
  container.appendChild(measurer);

  for (const item of content.items) {
    if (!item.str) continue;
    const tx = pdfjsLib.Util.transform(viewport.transform, item.transform);
    const fontHeight = Math.hypot(tx[2], tx[3]) || 12;
    const angle = Math.atan2(tx[1], tx[0]);
    const span = document.createElement("span");
    span.textContent = item.str;
    span.style.font = `${fontHeight}px sans-serif`;
    span.style.left = tx[4] + "px";
    span.style.top = tx[5] - fontHeight + "px";

    measurer.style.font = `${fontHeight}px sans-serif`;
    measurer.textContent = item.str;
    const w = measurer.getBoundingClientRect().width;
    const target = item.width * viewport.scale;
    let tf = "";
    if (Math.abs(angle) > 0.01) tf += `rotate(${angle}rad) `;
    if (w > 0 && isFinite(target / w) && Math.abs(target / w - 1) > 0.01) {
      tf += `scaleX(${target / w})`;
    }
    if (tf) span.style.transform = tf.trim();
    container.appendChild(span);
  }
  measurer.remove();
}

/* --------------------------- 交互 --------------------------- */
const pickFile = () => $("file").click();
$("pick").onclick = pickFile;
// 中间那块大区域也能点：点它等同于「打开本地 PDF」
$("empty").addEventListener("click", pickFile);
$("empty").addEventListener("keydown", (e) => {
  if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    pickFile();
  }
});
$("file").onchange = (e) => {
  const f = e.target.files && e.target.files[0];
  if (f) openFile(f);
  e.target.value = "";
};

document.addEventListener("dragover", (e) => {
  e.preventDefault();
  document.body.classList.add("drag");
});
document.addEventListener("dragleave", () => document.body.classList.remove("drag"));
document.addEventListener("drop", (e) => {
  e.preventDefault();
  document.body.classList.remove("drag");
  const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
  if (f) openFile(f);
});

let scrollTimer = null;
viewer.addEventListener("scroll", () => {
  clearTimeout(scrollTimer);
  scrollTimer = setTimeout(() => {
    updateCurrentPage();
    renderVisible();
  }, 120);
});

function updateCurrentPage() {
  if (!doc) return;
  const center = viewer.scrollTop + viewer.clientHeight / 2;
  let cur = 1;
  for (const el of pagesBox.children) {
    if (el.offsetTop <= center) cur = Number(el.dataset.index);
  }
  updatePageLabel(cur);
}

function updatePageLabel(p) {
  $("pageLabel").textContent = doc ? `${p} / ${doc.numPages}` : "— / —";
}

function gotoPage(p) {
  if (!doc) return;
  const i = Math.max(1, Math.min(doc.numPages, p));
  const el = pagesBox.children[i - 1];
  if (el) {
    el.scrollIntoView({ block: "start" });
    updatePageLabel(i);
  }
}

$("prev").onclick = () => gotoPage(currentIndex() - 1);
$("next").onclick = () => gotoPage(currentIndex() + 1);

function currentIndex() {
  const m = $("pageLabel").textContent.match(/(\d+)\s*\/\s*(\d+)/);
  return m ? Number(m[1]) : 1;
}

async function setScale(s, keepAnchorPage) {
  if (!doc) return;
  const anchor = keepAnchorPage || currentIndex();
  const anchorTop = pagesBox.children[anchor - 1]
    ? pagesBox.children[anchor - 1].offsetTop - viewer.scrollTop
    : 0;
  scale = Math.max(0.4, Math.min(4, s));
  for (const el of pagesBox.children) {
    el.style.width = Math.floor(baseWidth * scale) + "px";
    el.style.height = Math.floor(baseWidth * 1.414 * scale) + "px";
  }
  rendered = new Map();
  await renderVisible();
  // 重新按锚点页定位
  const el = pagesBox.children[anchor - 1];
  if (el) viewer.scrollTop = el.offsetTop - anchorTop;
  $("zoomLabel").textContent = Math.round(scale * 100) + "%";
  updatePageLabel(anchor);
}

$("zoomIn").onclick = () => setScale(scale + 0.2);
$("zoomOut").onclick = () => setScale(scale - 0.2);
$("fitWidth").onclick = () => setScale(fitScale());

document.addEventListener("keydown", (e) => {
  if (e.altKey && (e.key === "t" || e.key === "T")) {
    e.preventDefault();
    triggerTranslateSelection();
  }
});

function selectionInfo() {
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed) return null;
  const text = sel.toString().trim();
  if (!text) return null;
  let rect = null;
  try {
    const r = sel.getRangeAt(0).getBoundingClientRect();
    if (r && (r.width || r.height)) {
      rect = { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
    }
  } catch (_) {}
  return { text, rect };
}

function triggerTranslateSelection() {
  const info = selectionInfo();
  if (!info) return;
  translateAndShow(info.text, info.rect);
}

document.addEventListener("dblclick", (e) => {
  if (isPanelEvent(e)) return;
  const info = selectionInfo();
  if (!info) return;
  if (!/[\p{L}\p{N}]/u.test(info.text)) return;
  translateAndShow(info.text, info.rect);
});

// 右键菜单 / 快捷键从 background 转发过来
chrome.runtime.onMessage.addListener((msg) => {
  if (!msg || !msg.type) return;
  if (msg.type === "translate-selection") {
    triggerTranslateSelection();
  } else if (msg.type === "snip-translate") {
    // 截屏翻译（Alt+S / 右键菜单；background 广播过来）
    startSnip();
  } else if (msg.type === "show-translation") {
    const info = selectionInfo();
    const rect = (info && info.rect) || { left: 200, top: 120, right: 400, bottom: 140 };
    showPanel({ text: msg.text, rect, result: msg.result });
  }
});

function showLoading(t) {
  let el = document.getElementById("loading");
  if (!el) {
    el = document.createElement("div");
    el.id = "loading";
    document.body.appendChild(el);
  }
  el.textContent = t;
  el.classList.add("on");
}
function hideLoading() {
  const el = document.getElementById("loading");
  if (el) el.classList.remove("on");
}

$("zoomLabel").textContent = Math.round(scale * 100) + "%";

// 调试 / 自动化测试入口
window.__stReader = {
  openFile,
  renderVisible,
  state: () => ({
    numPages: doc ? doc.numPages : 0,
    scale,
    rendered: Array.from(rendered.entries()),
    spans: document.querySelectorAll(".text-layer > span").length,
    errors: errors.slice(),
  }),
};
