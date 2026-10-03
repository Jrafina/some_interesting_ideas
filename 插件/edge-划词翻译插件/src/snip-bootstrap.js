/**
 * 截屏翻译的动态注入入口（executeScript 用，必须是经典脚本）。
 * 用在 content script 没加载的页面（file:// 未授权、注入被拦等）：
 * background 先注入本文件，再由它 import 真正的 snip 模块并启动。
 */
(async () => {
  try {
    const m = await import(chrome.runtime.getURL("src/ui/snip.js"));
    if (m && m.startSnip) m.startSnip();
  } catch (e) {
    console.error("[划词翻译] 截屏翻译加载失败", e);
  }
})();
