/**
 * 页面注入脚本：双击/选中/右键菜单/快捷键 → 划词翻译浮窗
 */
(async () => {
  if (window.__ST_LOADED__) return;
  window.__ST_LOADED__ = true;

  let panel = null;
  try {
    panel = await import(chrome.runtime.getURL("src/ui/panel.js"));
  } catch (e) {
    console.error("[划词翻译] 加载浮窗模块失败", e);
    return;
  }

  let settings = { autoOnDblclick: true, autoOnSelect: false };
  try {
    const got = await chrome.storage.sync.get("settings");
    if (got && got.settings) {
      settings = Object.assign(settings, got.settings);
    }
  } catch (_) {}
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "sync" && changes.settings) {
      settings = Object.assign(settings, changes.settings.newValue || {});
    }
  });

  function currentSelection() {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed) return null;
    const text = sel.toString().trim();
    if (!text || text.length < 1) return null;
    let rect = null;
    try {
      const r = sel.getRangeAt(0).getBoundingClientRect();
      if (r && (r.width || r.height)) {
        rect = { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
      }
    } catch (_) {}
    if (!rect && lastMouse.x) {
      rect = { left: lastMouse.x, top: lastMouse.y, right: lastMouse.x, bottom: lastMouse.y };
    }
    return { text, rect };
  }

  const lastMouse = { x: 0, y: 0 };
  document.addEventListener(
    "mousemove",
    (e) => {
      lastMouse.x = e.clientX;
      lastMouse.y = e.clientY;
    },
    { passive: true }
  );

  document.addEventListener("dblclick", (e) => {
    if (!settings.autoOnDblclick) return;
    if (panel.isPanelEvent(e)) return;
    handle();
  });

  let selectTimer = null;
  document.addEventListener("mouseup", () => {
    if (!settings.autoOnSelect) return;
    clearTimeout(selectTimer);
    selectTimer = setTimeout(handle, 260);
  });

  function handle() {
    const sel = currentSelection();
    if (!sel) return;
    if (!/[\p{L}\p{N}]/u.test(sel.text)) return; // 纯符号不翻
    panel.translateAndShow(sel.text, sel.rect);
  }

  chrome.runtime.onMessage.addListener((msg) => {
    if (!msg || !msg.type) return;
    if (msg.type === "show-translation") {
      const sel = currentSelection();
      const rect = sel ? sel.rect : { left: lastMouse.x, top: lastMouse.y, right: lastMouse.x, bottom: lastMouse.y + 20 };
      panel.showPanel({ text: msg.text, rect, result: msg.result });
    } else if (msg.type === "translate-selection") {
      handle();
    } else if (msg.type === "snip-translate") {
      // 截屏翻译：懒加载，平时不占页面开销
      (async () => {
        try {
          const m = await import(chrome.runtime.getURL("src/ui/snip.js"));
          // msg.dataUrl 是可选的现成图片（手动触发时不会带）
          if (m && m.startSnip) m.startSnip(msg.dataUrl ? { dataUrl: msg.dataUrl } : undefined);
        } catch (e) {
          console.error("[划词翻译] 截屏翻译加载失败", e);
        }
      })();
    }
  });
})();
