/* 网页路径端到端：真实 Edge + 真实扩展 + 真实 http 页面 → 双击划词 → 浮窗 */
const { spawn } = require("child_process");
const http = require("http");
const path = require("path");
const os = require("os");
const fs = require("fs");

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const PORT = 9345;
const WEB_PORT = 8791;
const EXT_DIR = path.resolve(__dirname, "..");
const PROFILE = path.join(os.tmpdir(), "st-e2e-web-" + Date.now());
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>test</title>
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

let ws,
  id = 0;
const pending = new Map();
const jsErrors = [];
function send(method, params) {
  return new Promise((res, rej) => {
    const i = ++id;
    pending.set(i, { res, rej });
    ws.send(JSON.stringify({ id: i, method, params: params || {} }));
    setTimeout(() => {
      if (pending.has(i)) {
        pending.delete(i);
        rej(new Error("CDP 超时 " + method));
      }
    }, 120000);
  });
}
async function evaluate(expr) {
  const r = await send("Runtime.evaluate", {
    expression: expr,
    awaitPromise: true,
    returnByValue: true,
    userGesture: true,
  });
  if (r.exceptionDetails) throw new Error((r.exceptionDetails.exception || {}).description || r.exceptionDetails.text);
  return r.result.value;
}
async function waitFor(expr, timeout = 40000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    try {
      if (await evaluate(expr)) return true;
    } catch (e) {}
    await sleep(200);
  }
  return false;
}

const server = http.createServer((req, res) => {
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.end(PAGE);
});

let proc;
(async () => {
  await new Promise((r) => server.listen(WEB_PORT, "127.0.0.1", r));
  console.log("  测试页面： http://127.0.0.1:" + WEB_PORT + "/");

  proc = spawn(
    EDGE,
    [
      "--headless=new",
      "--remote-debugging-port=" + PORT,
      "--user-data-dir=" + PROFILE,
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-gpu",
      "--load-extension=" + EXT_DIR,
      "--disable-extensions-except=" + EXT_DIR,
      "about:blank",
    ],
    { stdio: "ignore" }
  );

  let extId = null;
  for (let i = 0; i < 120 && !extId; i++) {
    await sleep(300);
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      const sw = list.find((t) => t.type === "service_worker" && String(t.url).includes("/src/background.js"));
      if (sw) extId = String(sw.url).match(/chrome-extension:\/\/([^/]+)\//)[1];
    } catch (e) {}
  }
  ok(!!extId, "扩展加载成功", extId);
  if (!extId) return cleanup();

  const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
  const page = list.find((t) => t.type === "page" && t.url === "about:blank") || list.find((t) => t.type === "page");
  ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    ws.onopen = res;
    ws.onerror = rej;
  });
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id) {
      const p = pending.get(m.id);
      if (p) {
        pending.delete(m.id);
        m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result);
      }
      return;
    }
    if (m.method === "Runtime.exceptionThrown")
      jsErrors.push((m.params.exceptionDetails.exception || {}).description || m.params.exceptionDetails.text);
    if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error")
      jsErrors.push((m.params.args || []).map((a) => a.value || a.description).join(" "));
  };
  await send("Runtime.enable");
  await send("Page.enable");
  await send("Page.bringToFront").catch(() => {});

  await send("Page.navigate", { url: "http://127.0.0.1:" + WEB_PORT + "/" });
  ok(
    await waitFor('!!document.getElementById("t") && document.readyState === "complete"', 30000),
    "测试网页加载"
  );

  // 注意：content script 工作在隔离世界，页面世界看不到它的全局变量，
  // 只能通过“浮窗确实出现”来证明注入成功。

  // 定位 "quick" 这个词并双击
  const pos = await evaluate(`(() => {
    const p = document.getElementById("t");
    const node = p.firstChild;
    const text = node.textContent;
    const i = text.indexOf("quick");
    const r = document.createRange();
    r.setStart(node, i); r.setEnd(node, i + 5);
    const b = r.getBoundingClientRect();
    return { x: (b.left + b.right) / 2, y: (b.top + b.bottom) / 2 };
  })()`);
  for (const clickCount of [1, 2]) {
    await send("Input.dispatchMouseEvent", { type: "mousePressed", x: pos.x, y: pos.y, button: "left", clickCount });
    await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: pos.x, y: pos.y, button: "left", clickCount });
    await sleep(60);
  }
  const selected = await evaluate("String(getSelection())");
  ok(/quick/i.test(selected), "双击选中了网页单词", selected);

  ok(await waitFor('!!document.getElementById("__st_panel_host__")', 15000), "浮窗出现（content script 链路通）");
  const panel = await evaluate(`(() => {
    const h = document.getElementById("__st_panel_host__");
    if (!h || !h.shadowRoot) return null;
    const q = (s) => { const e = h.shadowRoot.querySelector(s); return e ? e.textContent.trim() : ""; };
    return { title: q(".title"), out: q(".out"), err: q(".err"), meta: q(".meta"),
             dict: h.shadowRoot.querySelectorAll(".dict-row").length };
  })()`);
  ok(!!panel && /quick/i.test(panel.title), "浮窗标题为选中词", panel && panel.title);
  // "quick" 是单个单词 → 走词典视图（一词多义），所以 .dict-row 也算流程走通。
  // 词典视图的严格校验在 tests/e2e-dict.cjs（那边要求必须查到词性+释义）
  const gotContent = await waitFor(
    `(() => {const h=document.getElementById("__st_panel_host__"); return !!(h&&h.shadowRoot&&h.shadowRoot.querySelector(".out, .err, .dict-row"));})()`,
    45000
  );
  ok(gotContent, "浮窗完成流程（译文 / 报错 / 词典视图）", panel);

  // 关闭按钮 & 点击外部关闭
  // 面板在这中间可能已经消失（真实网络慢、外部事件等原因），先确认在，不在就重新唤起一次
  let hostThere = await evaluate('!!document.getElementById("__st_panel_host__")');
  if (!hostThere) {
    for (const clickCount of [1, 2]) {
      await send("Input.dispatchMouseEvent", { type: "mousePressed", x: pos.x, y: pos.y, button: "left", clickCount });
      await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: pos.x, y: pos.y, button: "left", clickCount });
      await sleep(60);
    }
    hostThere = await waitFor('!!document.getElementById("__st_panel_host__")', 15000);
  }
  ok(hostThere, "浮窗在关闭测试前仍然在");
  if (hostThere) {
    await evaluate(`(() => {
      const h = document.getElementById("__st_panel_host__");
      h.shadowRoot.querySelector('button[data-act="close"]').click();
    })()`);
  }
  ok(!(await evaluate('!!document.getElementById("__st_panel_host__")')), "关闭按钮能关掉浮窗");

  // popup 页面也能正常打开
  await send("Page.navigate", { url: `chrome-extension://${extId}/src/popup.html` });
  ok(await waitFor('!!document.getElementById("input") && !!document.getElementById("translateBtn")', 20000), "popup.html 正常渲染");
  ok(
    await evaluate('document.getElementById("openReader") && document.getElementById("pasteBtn") ? true : false'),
    "popup 关键按钮齐全"
  );

  // options 页面
  await send("Page.navigate", { url: `chrome-extension://${extId}/src/options.html` });
  ok(
    await waitFor('document.querySelectorAll("#engineList .engine").length >= 4', 20000),
    "options.html 渲染出全部引擎配置项"
  );
  const langs = await evaluate('Array.from(document.querySelectorAll("#targetLang option")).map(o=>o.value)');
  ok(Array.isArray(langs) && langs.includes("zh-CN"), "目标语言下拉已填充", langs);

  ok(jsErrors.length === 0, "无未捕获异常 / console.error", jsErrors.slice(0, 5));

  console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
  cleanup();
})().catch((e) => {
  console.error("测试脚本异常：", e);
  fail++;
  cleanup();
});

function cleanup() {
  try {
    ws && ws.close();
  } catch (e) {}
  try {
    proc && proc.kill();
  } catch (e) {}
  try {
    server.close();
  } catch (e) {}
  setTimeout(() => {
    try {
      fs.rmSync(PROFILE, { recursive: true, force: true });
    } catch (e) {}
    process.exit(fail ? 1 : 0);
  }, 700);
}
