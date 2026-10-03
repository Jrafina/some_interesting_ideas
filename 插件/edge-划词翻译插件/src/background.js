import { getSettings } from "./lib/store.js";
import { translate, testEngine, engineLabel, ocrViaProxy } from "./lib/engines.js";
import { lookupWord, isDictCandidate, formatDict } from "./lib/dict.js";

const MENU_TRANSLATE = "st-translate-selection";
const MENU_READER = "st-open-reader";
const MENU_SNIP = "st-snip-translate";

async function ensureMenus() {
  await chrome.contextMenus.removeAll();
  chrome.contextMenus.create({
    id: MENU_TRANSLATE,
    title: "翻译选中文本（划词翻译）",
    contexts: ["selection"],
  });
  chrome.contextMenus.create({
    id: MENU_SNIP,
    title: "截屏翻译（框选区域）",
    contexts: ["page", "action"],
  });
  chrome.contextMenus.create({
    id: MENU_READER,
    title: "打开 PDF 划词翻译阅读器",
    contexts: ["page", "action"],
  });
}

chrome.runtime.onInstalled.addListener(async () => {
  await ensureMenus();
  const { greeted } = await chrome.storage.local.get("greeted");
  if (!greeted) {
    await chrome.storage.local.set({ greeted: true });
    // 直接开标签页：openOptionsPage 在某些环境下会落到扩展页里那个小对话框
    chrome.tabs.create({ url: chrome.runtime.getURL("src/options.html") });
  }
});

chrome.runtime.onStartup.addListener(() => {
  ensureMenus();
});

/** 把结果送到页面浮窗；页面不可注入时退化到独立结果页 */
async function deliverToTab(tab, text, result) {
  if (!tab || !tab.id) return false;
  try {
    await chrome.tabs.sendMessage(tab.id, { type: "show-translation", text, result });
    return true;
  } catch (_) {}
  // 内置 PDF 阅读器页没有 content script，改为广播，由它自己监听
  if (tab.url && tab.url.startsWith(chrome.runtime.getURL("src/reader.html"))) {
    chrome.runtime.sendMessage({ type: "show-translation", text, result }).catch(() => {});
    return true;
  }
  return false;
}

async function openResultPage(text, result, reason) {
  await chrome.storage.session.set({
    lastResult: { text, result, reason: reason || "" },
  });
  const url = chrome.runtime.getURL("src/result.html");
  const tabs = await chrome.tabs.query({ url });
  if (tabs && tabs.length) {
    await chrome.tabs.update(tabs[0].id, { active: true });
    await chrome.tabs.sendMessage(tabs[0].id, { type: "refresh-result" });
  } else {
    await chrome.tabs.create({ url });
  }
}

/**
 * 启动截屏翻译：只负责"通知页面开始"，截图由页面回头发 capture-tab 来要
 * （先截图再弹框选浮层，浮层才不会把自己截进去；顺序由 snip.js 控制）。
 * 分发顺序：content script → 自己的扩展页（reader 广播） → 动态注入 bootstrap。
 */
async function startSnip(tab) {
  if (!tab || !tab.id) return;
  try {
    await chrome.tabs.sendMessage(tab.id, { type: "snip-translate" });
    return;
  } catch (_) {}
  const isOwnPage = tab.url && tab.url.startsWith(chrome.runtime.getURL(""));
  if (isOwnPage) {
    // reader 等扩展页收不到 tabs.sendMessage，改广播（它们自己监听 runtime 消息）
    chrome.runtime.sendMessage({ type: "snip-translate" }).catch(() => {});
    return;
  }
  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["src/snip-bootstrap.js"],
    });
  } catch (e) {
    // chrome:// 、商店页等注入不了
    openResultPage("", null, "snip-unavailable").catch(() => {});
  }
}

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === MENU_READER) {
    chrome.tabs.create({ url: chrome.runtime.getURL("src/reader.html") });
    return;
  }
  if (info.menuItemId === MENU_SNIP) {
    await startSnip(tab);
    return;
  }
  if (info.menuItemId !== MENU_TRANSLATE) return;

  const selected = (info.selectionText || "").trim();
  if (!selected) {
    // Edge 内置 PDF 阅读器等页面拿不到选区，走剪贴板兜底页
    await openResultPage("", null, "no-selection");
    return;
  }
  const settings = await getSettings();
  // 单个单词先查词典 —— 和双击 / Alt+T 保持一致，否则会"双击出词性列表、右键只给一个词义"。
  // 结果里同时塞一份 translation 文本，兜底结果页（result.html）不用改也能正常显示。
  let result = null;
  if (isDictCandidate(selected)) {
    const dict = await lookupWord(selected);
    if (dict) {
      result = {
        ok: true,
        dict,
        translation: formatDict(selected, dict),
        engine: "dict",
        engineLabel: "有道词典",
      };
    }
  }
  if (!result) result = await translate(selected, settings);
  const ok = await deliverToTab(tab, selected, result);
  if (!ok) await openResultPage(selected, result);
});

chrome.commands.onCommand.addListener(async (command) => {
  if (command === "open-reader") {
    chrome.tabs.create({ url: chrome.runtime.getURL("src/reader.html") });
    return;
  }
  if (command === "snip-translate") {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    await startSnip(tab);
    return;
  }
  if (command === "translate-selection") {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.id) return;
    try {
      await chrome.tabs.sendMessage(tab.id, { type: "translate-selection" });
      return;
    } catch (_) {}
    if (tab.url && tab.url.startsWith(chrome.runtime.getURL("src/reader.html"))) {
      chrome.runtime.sendMessage({ type: "translate-selection" }).catch(() => {});
      return;
    }
    await openResultPage("", null, "no-content-script");
  }
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    if (!msg || typeof msg.type !== "string") return;
    if (msg.type === "translate") {
      const settings = await getSettings();
      const result = await translate(msg.text, settings);
      // 浮窗要显示"自建代理（Workers AI）"这类中文名，而不是 engine 的内部代号
      if (result && result.engine) result.engineLabel = engineLabel(result.engine);
      sendResponse(result);
    } else if (msg.type === "lookup-word") {
      // 单词多义：拿真词典数据（18~27ms），比让 AI 编又快又准。
      // 只能在这里 fetch —— content script 的跨域请求受宿主页 CORS 约束。
      sendResponse({ ok: true, dict: await lookupWord(msg.word) });
    } else if (msg.type === "test-engine") {
      const settings = await getSettings();
      sendResponse(await testEngine(msg.engine, settings));
    } else if (msg.type === "snip-translate") {
      // popup 的「截屏翻译」按钮
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      await startSnip(tab);
      sendResponse({ ok: true });
    } else if (msg.type === "capture-tab") {
      // 截屏翻译：在框选浮层出现前把当前页截下来（需要 activeTab 授权）
      try {
        const windowId = sender && sender.tab ? sender.tab.windowId : chrome.windows.WINDOW_ID_CURRENT;
        const dataUrl = await chrome.tabs.captureVisibleTab(windowId, { format: "png" });
        sendResponse({ ok: true, dataUrl });
      } catch (e) {
        sendResponse({ ok: false, error: String((e && e.message) || e) });
      }
    } else if (msg.type === "snip-ocr") {
      const settings = await getSettings();
      try {
        const r = await ocrViaProxy(msg.image, settings);
        sendResponse({ ok: true, text: r.text, engine: r.engine });
      } catch (e) {
        sendResponse({ ok: false, error: String((e && e.message) || e) });
      }
    } else if (msg.type === "open-reader") {
      chrome.tabs.create({ url: chrome.runtime.getURL("src/reader.html") });
      sendResponse({ ok: true });
    } else if (msg.type === "request-host-permission") {
      const origin = msg.origin;
      const granted = await chrome.permissions.request({ origins: [origin] });
      sendResponse({ granted });
    } else if (msg.type === "has-host-permission") {
      const got = await chrome.permissions.contains({ origins: [msg.origin] });
      sendResponse({ granted: got });
    }
  })().catch((e) => sendResponse({ ok: false, error: String(e && e.message) }));
  return true; // 异步响应
});
