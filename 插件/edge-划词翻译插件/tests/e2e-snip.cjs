/* 截屏翻译端到端：真实 Edge + 真实扩展 + 本地 mock 代理
 * 链路：触发 snip → 页面截图 → 框选 → 裁剪 → POST /ocr（mock）→ 走引擎链 POST /translate（mock）→ 浮窗译文
 * 断言点：浮层出现/取消、拖框尺寸、裁剪后走到 OCR、译文进浮窗、无未捕获异常。
 */
const { spawn } = require("child_process");
const http = require("http");
const path = require("path");
const os = require("os");
const fs = require("fs");

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const CDP_PORT = 9347;
const WEB_PORT = 8793;
const MOCK_PORT = 8794;
const EXT_DIR = path.resolve(__dirname, "..");
const PROFILE = path.join(os.tmpdir(), "st-e2e-snip-" + Date.now());
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>snip test</title>
<style>body{font:18px/2 sans-serif;padding:40px;max-width:640px}</style></head><body>
<h1>Reading test page</h1>
<p id="t">The quick brown fox jumps over the lazy dog.</p>
<p id="t2">Translation should also work on this paragraph.</p>
</body></html>`;

let pass = 0,
  fail = 0;
function ok(cond, name, extra) {
  if (cond) {
    pass++;
    console.log("  ✓ " + name);
  } else {
    fail++;
    console.log("  ✗ " + name + (extra !== undefined ? "  → " + JSON.stringify(extra) : ""));
  }
}

/* ------------------------- CDP 连接（可多目标） ------------------------- */
function conn(wsUrl) {
  const c = { id: 0, pending: new Map(), ws: null, errors: [] };
  c.ws = new WebSocket(wsUrl);
  c.open = new Promise((res, rej) => {
    c.ws.onopen = res;
    c.ws.onerror = rej;
  });
  c.ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id) {
      const p = c.pending.get(m.id);
      if (p) {
        c.pending.delete(m.id);
        m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result);
      }
      return;
    }
    if (m.method === "Runtime.exceptionThrown")
      c.errors.push((m.params.exceptionDetails.exception || {}).description || m.params.exceptionDetails.text);
    if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error")
      c.errors.push((m.params.args || []).map((a) => a.value || a.description).join(" "));
  };
  c.send = (method, params) =>
    new Promise((res, rej) => {
      const i = ++c.id;
      c.pending.set(i, { res, rej });
      c.ws.send(JSON.stringify({ id: i, method, params: params || {} }));
      setTimeout(() => {
        if (c.pending.has(i)) {
          c.pending.delete(i);
          rej(new Error("CDP 超时 " + method));
        }
      }, 60000);
    });
  c.evaluate = async (expr) => {
    const r = await c.send("Runtime.evaluate", {
      expression: expr,
      awaitPromise: true,
      returnByValue: true,
      userGesture: true,
    });
    if (r.exceptionDetails)
      throw new Error((r.exceptionDetails.exception || {}).description || r.exceptionDetails.text);
    return r.result.value;
  };
  c.waitFor = async (expr, timeout = 30000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) {
      try {
        if (await c.evaluate(expr)) return true;
      } catch (e) {}
      await sleep(200);
    }
    return false;
  };
  return c;
}

/* ------------------------- 本地 mock 代理 ------------------------- */
const mockHits = { ocr: [], translate: [] };
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};
const mockServer = http.createServer((req, res) => {
  if (req.method === "OPTIONS") {
    res.writeHead(204, CORS);
    res.end();
    return;
  }
  let body = "";
  req.on("data", (d) => (body += d));
  req.on("end", () => {
    let j = {};
    try {
      j = JSON.parse(body);
    } catch (_) {}
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    Object.entries(CORS).forEach(([k, v]) => res.setHeader(k, v));
    if (req.url.startsWith("/ocr")) {
      mockHits.ocr.push(j);
      if (j.token !== "test-token") {
        res.statusCode = 401;
        res.end(JSON.stringify({ ok: false, error: "token 无效" }));
        return;
      }
      const looksLikePng = /^data:image\/(png|jpeg);base64,/.test(String(j.image || ""));
      res.end(JSON.stringify(looksLikePng
        ? { ok: true, text: "Mock OCR text", engine: "mock-ocr" }
        : { ok: false, error: "image 格式不对" }));
      return;
    }
    if (req.url.startsWith("/translate")) {
      mockHits.translate.push(j);
      res.end(JSON.stringify({ ok: true, translation: "【mock】" + j.q, detected: "en", engine: "mock-model" }));
      return;
    }
    res.statusCode = 404;
    res.end(JSON.stringify({ ok: false, error: "not found" }));
  });
});

const pageServer = http.createServer((req, res) => {
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.end(PAGE);
});

let proc;
(async () => {
  await new Promise((r) => mockServer.listen(MOCK_PORT, "127.0.0.1", r));
  await new Promise((r) => pageServer.listen(WEB_PORT, "127.0.0.1", r));
  console.log(`  测试页：http://127.0.0.1:${WEB_PORT}/  ·  mock 代理：http://127.0.0.1:${MOCK_PORT}`);

  proc = spawn(
    EDGE,
    [
      "--headless=new",
      "--remote-debugging-port=" + CDP_PORT,
      "--user-data-dir=" + PROFILE,
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-gpu",
      "--no-sandbox",
      "--load-extension=" + EXT_DIR,
      "--disable-extensions-except=" + EXT_DIR,
      "about:blank",
    ],
    { stdio: "ignore" }
  );

  let extId = null;
  let swUrl = null;
  for (let i = 0; i < 120 && !extId; i++) {
    await sleep(300);
    try {
      const list = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json();
      const sw = list.find((t) => t.type === "service_worker" && String(t.url).includes("/src/background.js"));
      if (sw) {
        extId = String(sw.url).match(/chrome-extension:\/\/([^/]+)\//)[1];
        swUrl = sw.webSocketDebuggerUrl;
      }
    } catch (e) {}
  }
  ok(!!extId, "扩展加载成功", extId);
  if (!extId) return cleanup();

  // 页面目标
  const list = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json();
  const pageTarget = list.find((t) => t.type === "page" && t.url === "about:blank") || list.find((t) => t.type === "page");
  const page = conn(pageTarget.webSocketDebuggerUrl);
  await page.open;
  await page.send("Runtime.enable");
  await page.send("Page.enable");
  await page.send("Page.bringToFront").catch(() => {});

  // service worker 目标：用来下发触发消息、写设置（等于 background 的内部视角）
  const sw = conn(swUrl);
  await sw.open;
  await sw.send("Runtime.enable");

  ok(
    (await sw.evaluate(`!!(chrome && chrome.tabs && chrome.scripting)`)) === true,
    "SW 上下文可用（chrome.tabs/scripting 在）"
  );

  await page.send("Page.navigate", { url: `http://127.0.0.1:${WEB_PORT}/` });
  ok(await page.waitFor('!!document.getElementById("t") && document.readyState === "complete"', 30000), "测试页加载");

  /* 触发截屏翻译：等价于 background.startSnip 最后那步 tabs.sendMessage。
   * 注意：扩展首次安装会自己开一个 options 欢迎页并抢占"活动标签"，所以先把非扩展页
   * （也就是我们的测试页）激活 —— 生产环境里活动标签就是用户正在看的那一页。
   * content.js 是先 await 动态 import 再注册 onMessage 的，刚导航完可能还没挂上监听 → 重试。
   * 传 img 时消息里带 dataUrl，snip 会跳过截图直接用这张图。 */
  async function triggerSnip(img) {
    const msg = img
      ? `{ type: "snip-translate", dataUrl: ${JSON.stringify(img)} }`
      : '{ type: "snip-translate" }';
    const expr = `(async () => {
      const all = await chrome.tabs.query({});
      const t = all.find((x) => !x.url || !String(x.url).startsWith("chrome-extension://"));
      if (!t) return { sent: "no-tab" };
      await chrome.tabs.update(t.id, { active: true });
      const out = { id: t.id, status: t.status || "" };
      try { await chrome.tabs.sendMessage(t.id, ${msg}); out.sent = "ok"; }
      catch (e) { out.sent = e.message; }
      return out;
    })()`;
    let r = await sw.evaluate(expr);
    for (let i = 0; i < 20 && r.sent !== "ok"; i++) {
      await sleep(300);
      r = await sw.evaluate(expr);
    }
    return r;
  }

  // 写设置：只留自建代理，指向 mock；关掉双击自动翻译免得干扰
  const settingsSet = await sw.evaluate(`(async () => {
    await chrome.storage.sync.set({ settings: {
      targetLang: "auto", order: ["proxy"], autoOnDblclick: false, autoOnSelect: false,
      proxy: { url: "http://127.0.0.1:${MOCK_PORT}/translate", token: "test-token" }
    }});
    const got = await chrome.storage.sync.get("settings");
    return got.settings && got.settings.proxy && got.settings.proxy.token;
  })()`);
  ok(settingsSet === "test-token", "设置写入成功（代理指向 mock）", settingsSet);

  // ---- 阶段 1：真实截图路径（headless 拿不到 activeTab，只能验证错误提示是可读的）----
  // 生产环境 Alt+S / 右键菜单 / 点插件图标都会授予 activeTab，headless 里没有"用户手势"这回事，
  // 权限弹窗也点不了（实测 chrome.permissions.request 直接挂起），所以这里只断言失败 UX。
  let trg = await triggerSnip();
  if (trg.sent !== "ok") {
    // 打不开就查一遍隔离世界：content script 到底有没有注入
    const probe = await sw.evaluate(`(async () => {
      const all = await chrome.tabs.query({});
      const t = all.find((x) => !x.url || !String(x.url).startsWith("chrome-extension://"));
      const out = { tabs: all.map((x) => ({ id: x.id, active: x.active, status: x.status })) };
      if (!t) return out;
      try {
        const r = await chrome.scripting.executeScript({
          target: { tabId: t.id },
          func: () => ({ loaded: !!window.__ST_LOADED__, hasRuntime: !!(window.chrome && chrome.runtime && chrome.runtime.id) }),
        });
        out.probe = r[0] && r[0].result;
      } catch (e) { out.probe = "err:" + e.message; }
      return out;
    })()`);
    console.log("   诊断：", JSON.stringify({ trg, probe }, null, 1));
  }
  ok(trg.sent === "ok", "触发消息送达 content script", trg);

  const toastThere = await page.waitFor(
    `(() => { const h = document.getElementById("__st_snip_host__"); return !!(h && h.shadowRoot && h.shadowRoot.querySelector(".toast")); })()`,
    15000
  );
  const toastText = toastThere
    ? await page.evaluate(`document.getElementById("__st_snip_host__").shadowRoot.querySelector(".toast").textContent.trim()`)
    : "";
  ok(toastThere && /截屏失败/.test(toastText), "无 activeTab 时给出可读的失败提示", toastText);
  ok(/activeTab|all_urls|permission/i.test(toastText), "提示里带了真实原因（权限）", toastText);
  // 不能在这里手动 remove：snip.js 里还存着 host 引用，删了 DOM 会让下一次触发被当成"正在框选中"。
  // 等 toast 自己超时退场（ttl 4s），顺便验证它会自动消失。
  ok(await page.waitFor('!document.getElementById("__st_snip_host__")', 8000), "失败提示会自动消失");

  // ---- 阶段 2：注入一张图跑通后半程（框选 → 裁剪 → OCR → 翻译 → 浮窗）----
  // 触发消息里带 dataUrl 时会跳过截图这一步，其余完全相同。
  const shot = await page.evaluate(`(() => {
    const c = document.createElement("canvas");
    c.width = 900; c.height = 320;
    const g = c.getContext("2d");
    g.fillStyle = "#fff"; g.fillRect(0, 0, 900, 320);
    g.fillStyle = "#111"; g.font = "28px sans-serif";
    g.fillText("The quick brown fox jumps over the lazy dog.", 30, 90);
    g.fillText("Translation should also work on this paragraph.", 30, 150);
    g.fillText("第三行中文也要能识别。", 30, 210);
    return c.toDataURL("image/png");
  })()`);
  ok(/^data:image\/png;base64,/.test(shot) && shot.length > 500, "测试用图准备就绪", String(shot).length);

  const trg2 = await triggerSnip(shot);
  ok(trg2.sent === "ok", "带图触发送达", trg2);

  const overlayThere = await page.waitFor('!!document.getElementById("__st_snip_host__")', 15000);
  ok(overlayThere, "框选浮层出现");
  if (!overlayThere) return cleanup();

  const hint = await page.evaluate(`(() => {
    const s = document.getElementById("__st_snip_host__").shadowRoot;
    const i = s.querySelector("img.shot");
    return {
      hint: (s.querySelector(".hint") || {}).textContent || "",
      shot: !!i,
      kids: Array.from(s.children).map((e) => e.tagName + "." + (e.className || "")),
      nat: i ? [i.naturalWidth, i.naturalHeight] : null,
    };
  })()`);
  if (!hint.shot) console.log("    浮层内容：", JSON.stringify(hint), page.errors.slice(0, 3));
  ok(/框选/.test(hint.hint), "浮层带操作提示", hint.hint);
  ok(hint.shot && hint.nat && hint.nat[0] === 900, "浮层里是冻结的截图（尺寸 900×320）", hint.nat);

  // 拖框：在图上选一块包含文字的区域
  const box = { x1: 20, y1: 60, x2: 640, y2: 235 };
  await page.send("Input.dispatchMouseEvent", { type: "mousePressed", x: box.x1, y: box.y1, button: "left", clickCount: 1 });
  await page.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: box.x1 + 120, y: box.y1 + 40, button: "left" });
  const during = await page.evaluate(`(() => {
    const s = document.getElementById("__st_snip_host__").shadowRoot.querySelector(".sel");
    return s ? { display: getComputedStyle(s).display, size: (s.querySelector(".size") || {}).textContent || "" } : null;
  })()`);
  ok(!!during && during.display === "block" && /\d+\s*×\s*\d+/.test(during.size), "拖动时显示选框与尺寸", during);
  await page.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: box.x2, y: box.y2, button: "left" });
  await page.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: box.x2, y: box.y2, button: "left", clickCount: 1 });

  // 等 OCR + 翻译走完 → 浮窗（成功显示译文，失败显示错误）
  const panelThere = await page.waitFor('!!document.getElementById("__st_panel_host__")', 40000);
  ok(panelThere, "翻译浮窗出现（OCR → 翻译链路通）");
  const panel = panelThere
    ? await page.evaluate(`(() => {
        const s = document.getElementById("__st_panel_host__").shadowRoot;
        const q = (sel) => { const e = s.querySelector(sel); return e ? e.textContent.trim() : ""; };
        return { orig: q(".orig"), out: q(".out"), err: q(".err"), meta: q(".meta") };
      })()`)
    : null;
  if (panel) {
    const okChain = panel.out.includes("【mock】Mock OCR text") && mockHits.translate.length > 0;
    ok(okChain, "OCR 文本经引擎链翻译后进浮窗", { panel, ocrHits: mockHits.ocr.length, tp: mockHits.translate.length });
    if (!okChain) console.log("    面板内容：", JSON.stringify(panel));
    const img = mockHits.ocr[0] && mockHits.ocr[0].image;
    ok(/^data:image\/png;base64,/.test(String(img)) && String(img).length > 200, "上传的是裁剪后的 PNG", img ? String(img).slice(0, 40) + "…(" + String(img).length + " 字符)" : img);
  }
  ok(!(await page.evaluate('!!document.getElementById("__st_snip_host__")')), "选完自动收起选框浮层");

  // Esc 取消
  await page.evaluate('document.getElementById("__st_panel_host__") && document.getElementById("__st_panel_host__").remove()');
  await triggerSnip(shot);
  const again = await page.waitFor('!!document.getElementById("__st_snip_host__")', 15000);
  ok(again, "再次触发能起浮层");
  await page.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
  await page.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
  ok(await page.waitFor('!document.getElementById("__st_snip_host__")', 5000), "Esc 能取消框选");

  // 右键取消
  await triggerSnip(shot);
  await page.waitFor('!!document.getElementById("__st_snip_host__")', 15000);
  await page.send("Input.dispatchMouseEvent", { type: "mousePressed", x: 300, y: 200, button: "right", clickCount: 1 });
  await page.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: 300, y: 200, button: "right", clickCount: 1 });
  ok(await page.waitFor('!document.getElementById("__st_snip_host__")', 5000), "右键能取消框选");

  ok(page.errors.length === 0, "页面无未捕获异常 / console.error", page.errors.slice(0, 5));
  ok(sw.errors.length === 0, "SW 无未捕获异常 / console.error", sw.errors.slice(0, 5));

  console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
  cleanup();
})().catch((e) => {
  console.error("测试脚本异常：", e);
  fail++;
  cleanup();
});

function cleanup() {
  try {
    proc && proc.kill();
  } catch (e) {}
  try {
    mockServer.close();
    pageServer.close();
  } catch (e) {}
  setTimeout(() => {
    try {
      fs.rmSync(PROFILE, { recursive: true, force: true });
    } catch (e) {}
    process.exit(fail ? 1 : 0);
  }, 700);
}
