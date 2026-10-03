import { TARGET_OPTIONS, langLabel } from "./lib/engines.js";
import { getSettings, saveSettings } from "./lib/store.js";

const $ = (id) => document.getElementById(id);

$("newWindow").onclick = () =>
  chrome.tabs.create({ url: chrome.runtime.getURL("src/window.html") });
$("openReader").onclick = () =>
  chrome.tabs.create({ url: chrome.runtime.getURL("src/reader.html") });
// 直接新开一个标签页，避免被浏览器塞进扩展页里那个小对话框
$("openOptions").onclick = () =>
  chrome.tabs.create({ url: chrome.runtime.getURL("src/options.html") });

function fillLangs(cur) {
  const sel = $("targetLang");
  sel.innerHTML = TARGET_OPTIONS.map(
    ([v, label]) => `<option value="${v}">${label}</option>`
  ).join("");
  sel.value = cur;
}
$("targetLang").onchange = async (e) => {
  const s = await getSettings();
  s.targetLang = e.target.value;
  await saveSettings(s);
};

$("clearBtn").onclick = () => {
  $("input").value = "";
  $("out").className = "out empty";
  $("out").textContent = "译文会显示在这里";
  $("meta").textContent = "";
  $("input").focus();
};

$("pasteBtn").onclick = async () => {
  try {
    const t = await navigator.clipboard.readText();
    if (t) $("input").value = t;
  } catch (_) {}
};

$("copyBtn").onclick = async () => {
  const text = $("out").textContent;
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
    const b = $("copyBtn");
    b.textContent = "已复制";
    setTimeout(() => (b.textContent = "复制"), 1400);
  } catch (_) {}
};

async function doTranslate() {
  const text = $("input").value.trim();
  if (!text) return;
  const out = $("out");
  out.className = "out";
  out.textContent = "翻译中…";
  const res = await chrome.runtime.sendMessage({ type: "translate", text });
  if (res && res.ok) {
    out.className = "out";
    out.textContent = res.translation;
    const tags = [];
    if (res.target) tags.push("→ " + langLabel(res.target));
    if (res.detected) tags.push("识别 " + langLabel(res.detected));
    if (res.account) tags.push("账号：" + res.account);
    if (res.upstream) tags.push("模型：" + res.upstream);
    if (res.engineLabel) tags.push(res.engineLabel);
    $("meta").textContent = tags.join(" · ");
  } else {
    out.className = "out error";
    out.textContent = "翻译失败：\n" + ((res && res.errors) || ["未知错误"]).join("\n");
    $("meta").textContent = "";
  }
}

$("translateBtn").onclick = doTranslate;
$("input").addEventListener("keydown", (e) => {
  if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    doTranslate();
  }
});

getSettings().then((s) => fillLangs(s.targetLang || "auto"));
$("input").focus();
