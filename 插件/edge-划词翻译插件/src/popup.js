import { TARGET_OPTIONS, langLabel } from "./lib/engines.js";
import { getSettings, saveSettings } from "./lib/store.js";

const $ = (id) => document.getElementById(id);

// 顶部按钮：每次点击都新开一个窗口/标签，可以并存多个
$("openReader").onclick = () =>
  chrome.tabs.create({ url: chrome.runtime.getURL("src/reader.html") });
$("openWindow").onclick = () =>
  chrome.tabs.create({ url: chrome.runtime.getURL("src/window.html") });
// 直接新开一个标签页，避免被浏览器塞进扩展页里那个小对话框
$("openOptions").onclick = () =>
  chrome.tabs.create({ url: chrome.runtime.getURL("src/options.html") });

// 截屏翻译：交给 background 去触发当前页，popup 立刻关掉免得挡视线
$("snipBtn").onclick = async () => {
  try {
    await chrome.runtime.sendMessage({ type: "snip-translate" });
  } catch (_) {}
  window.close();
};

$("clearBtn").onclick = () => {
  $("input").value = "";
  $("out").textContent = "结果会显示在这里";
  $("out").className = "out glass empty";
  $("input").focus();
};

async function setTarget(v) {
  const s = await getSettings();
  s.targetLang = v;
  await saveSettings(s);
}

function fillLangs(cur) {
  const sel = $("targetLang");
  sel.innerHTML = TARGET_OPTIONS.map(
    ([v, label]) => `<option value="${v}">${label}</option>`
  ).join("");
  sel.value = cur;
}

$("targetLang").onchange = (e) => setTarget(e.target.value);
$("swap").onclick = async () => {
  const s = await getSettings();
  const next = s.targetLang === "en" ? "zh-CN" : "en";
  await setTarget(next);
  fillLangs(next);
  flashOut("已切换为 " + langLabel(next) + "，点翻译即可");
};

async function doTranslate() {
  const text = $("input").value.trim();
  if (!text) return;
  const out = $("out");
  out.className = "out glass";
  out.textContent = "翻译中…";
  const res = await chrome.runtime.sendMessage({ type: "translate", text });
  if (res && res.ok) {
    out.innerHTML = "";
    out.append(document.createTextNode(res.translation));
    out.className = "out glass";
    const tags = [];
    if (res.target) tags.push("→ " + langLabel(res.target));
    if (res.account) tags.push("账号：" + res.account);
    if (res.upstream) tags.push("模型：" + res.upstream);
    if (res.engineLabel) tags.push(res.engineLabel);
    const meta = document.createElement("div");
    meta.className = "meta";
    meta.textContent = tags.join(" · ");
    out.appendChild(meta);
  } else {
    out.textContent = "翻译失败：\n" + ((res && res.errors) || ["未知错误"]).join("\n");
    out.className = "out glass error";
  }
}

$("translateBtn").onclick = doTranslate;
$("input").addEventListener("keydown", (e) => {
  if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) doTranslate();
});

async function readClipboard(silent) {
  try {
    const t = await navigator.clipboard.readText();
    if (t && t.trim()) {
      $("input").value = t.trim();
      await doTranslate();
      return true;
    }
    if (!silent) flashOut("剪贴板为空");
  } catch (e) {
    if (!silent) flashOut("读取剪贴板失败，请点击“粘贴”按钮");
  }
  return false;
}

function flashOut(msg) {
  const out = $("out");
  out.className = "out glass empty";
  out.textContent = msg;
}

$("pasteBtn").onclick = () => readClipboard(false);

// 兜底：在 Edge 内置 PDF 阅读器里选中文本后按 Ctrl+C，再点开插件图标即可自动翻译
getSettings().then((s) => {
  fillLangs(s.targetLang || "auto");
  if (s.popupReadClipboard !== false) readClipboard(true);
});

$("input").focus();
