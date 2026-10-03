const $ = (id) => document.getElementById(id);

$("openReader").onclick = () => chrome.tabs.create({ url: chrome.runtime.getURL("src/reader.html") });

async function render(text) {
  const out = $("out");
  if (!text) {
    out.className = "out glass empty";
    out.textContent = "结果会显示在这里";
    return;
  }
  out.className = "out glass";
  out.textContent = "翻译中…";
  const res = await chrome.runtime.sendMessage({ type: "translate", text });
  if (res && res.ok) {
    out.textContent = res.translation;
    out.className = "out glass";
  } else {
    out.textContent = "翻译失败：\n" + ((res && res.errors) || ["未知错误"]).join("\n");
    out.className = "out glass error";
  }
}

$("translateBtn").onclick = () => render($("input").value.trim());

$("pasteBtn").onclick = async () => {
  try {
    const t = await navigator.clipboard.readText();
    if (!t || !t.trim()) {
      $("out").className = "out empty";
      $("out").textContent = "剪贴板为空";
      return;
    }
    $("input").value = t.trim();
    await render(t.trim());
  } catch (e) {
    $("out").className = "out error";
    $("out").textContent = "读取剪贴板失败：" + (e && e.message ? e.message : e);
  }
};

chrome.runtime.onMessage.addListener((msg) => {
  if (msg && msg.type === "refresh-result") init();
});

async function init() {
  const got = await chrome.storage.session.get("lastResult");
  const r = got && got.lastResult;
  if (!r) return;
  if (r.text) {
    $("input").value = r.text;
    if (r.result) {
      const out = $("out");
      if (r.result.ok) {
        out.className = "out glass";
        out.textContent = r.result.translation;
      } else {
        out.className = "out glass error";
        out.textContent = "翻译失败：\n" + (r.result.errors || []).join("\n");
      }
    } else {
      await render(r.text);
    }
  } else {
    const notice = $("notice");
    notice.style.display = "block";
    notice.textContent =
      r.reason === "snip-unavailable"
        ? "当前页面（浏览器设置页、商店等）不允许截屏或注入脚本，截屏翻译用不了。请在普通网页或 PDF 阅读器里使用（Alt+S）。"
        : "当前页面（如 Edge 内置 PDF 阅读器）不允许插件读取选区。请回到该页面选中文本按 Ctrl+C，再点下面的「从剪贴板读取」。";
  }
}

init();
