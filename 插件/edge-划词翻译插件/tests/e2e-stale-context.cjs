/*
 * 端到端：扩展被重新加载后，**已打开网页**里的旧 content script 变成孤儿，
 * 双击划词会报 `Extension context invalidated`（用户报障：PDF 阅读器能用、普通网站不能）。
 *
 * 本测试同时锁死三个结论（都是实测出来的，别凭感觉改）：
 *   1. 重新加载扩展后，没刷新的页面必现这个错
 *   2. 想从 background 重新注入 content.js 去救 → 做不到（只有 activeTab，没有站点 host 权限）
 *   3. 刷新页面（F5）→ 立即恢复；所以浮窗提示必须直说"刷新"，不能甩"检查翻译引擎配置"
 *
 * 判定标记：浮窗 .title 必须等于本轮新选中的词，否则说明读到的还是旧内容。
 */
const { spawn } = require("child_process");
const http = require("http");
const path = require("path");
const os = require("os");
const fs = require("fs");

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const PORT = 9373;
const WEB_PORT = 8795;
const EXT_DIR = path.resolve(__dirname, "..");
const PROFILE = path.join(os.tmpdir(), "st-stale-" + Date.now());
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>stale test</title></head>
<body style="font:18px/2 sans-serif;padding:40px"><h1>Reading test page</h1>
<p id="t">The quick brown fox jumps over the lazy dog.</p></body></html>`;

let pass = 0, fail = 0;
function ok(cond, name, extra) {
  if (cond) {
    pass++;
    console.log("  ✓ " + name);
  } else {
    fail++;
    console.log("  ✗ " + name + (extra !== undefined ? "  → " + JSON.stringify(extra) : ""));
  }
}

function mkConn() {
  const st = { ws: null, id: 0, pending: new Map() };
  st.send = (method, params) =>
    new Promise((res, rej) => {
      const i = ++st.id;
      st.pending.set(i, { res, rej });
      st.ws.send(JSON.stringify({ id: i, method, params: params || {} }));
      setTimeout(() => {
        if (st.pending.has(i)) { st.pending.delete(i); rej(new Error("CDP 超时 " + method)); }
      }, 60000);
    });
  st.attach = async (url) => {
    st.ws = new WebSocket(url);
    await new Promise((res, rej) => { st.ws.onopen = res; st.ws.onerror = rej; });
    st.ws.onmessage = (e) => {
      const m = JSON.parse(e.data);
      if (!m.id) return;
      const p = st.pending.get(m.id);
      if (p) { st.pending.delete(m.id); m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result); }
    };
  };
  st.eval = async (expr) => {
    const r = await st.send("Runtime.evaluate", {
      expression: expr, awaitPromise: true, returnByValue: true, userGesture: true,
    });
    if (r.exceptionDetails) throw new Error((r.exceptionDetails.exception || {}).description || r.exceptionDetails.text);
    return r.result.value;
  };
  return st;
}

const listTargets = async () => (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json());
const findSW = async () =>
  (await listTargets()).find((t) => t.type === "service_worker" && String(t.url).includes("/src/background.js"));

const server = http.createServer((req, res) => {
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.end(PAGE);
});

let proc;
const pageConn = mkConn();
const swConn = mkConn();
const pageLog = [];

/**
 * 关掉可能还开着的浮窗 —— 必须做，否则下一步的双击可能落在**上一个浮窗里面**：
 * 实测踩过：上一步的词典浮窗（比原来的报错浮窗高）压住了下一个词的位置，
 * 鼠标点到浮窗文字上，content.js 的 isPanelEvent() 会直接 return，新浮窗永远不出现，
 * 表现为偶发失败。浮窗自己的 Esc / 点击外部监听会 close()，这里模拟按 Esc。
 */
async function closePanel() {
  const key = { key: "Escape", code: "Escape", windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 };
  await pageConn.send("Input.dispatchKeyEvent", Object.assign({ type: "keyDown" }, key)).catch(() => {});
  await pageConn.send("Input.dispatchKeyEvent", Object.assign({ type: "keyUp" }, key)).catch(() => {});
  const left = async () => pageConn.eval(`document.querySelectorAll('[id="__st_panel_host__"]').length`).catch(() => 0);
  if (await left()) {
    // Esc 没生效（比如页面没拿到焦点）→ 点一下左上角空白，走"点击外部关闭"
    await pageConn.send("Input.dispatchMouseEvent", { type: "mousePressed", x: 4, y: 4, button: "left", clickCount: 1 }).catch(() => {});
    await pageConn.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: 4, y: 4, button: "left", clickCount: 1 }).catch(() => {});
  }
  for (let i = 0; i < 25; i++) {
    if (!(await left())) return true;
    await sleep(80);
  }
  return false;
}

async function dblclickWord(word) {
  await closePanel();
  const pos = await pageConn.eval(`(() => {
    const node = document.getElementById("t").firstChild;
    const i = node.textContent.indexOf(${JSON.stringify(word)});
    const r = document.createRange();
    r.setStart(node, i); r.setEnd(node, i + ${word.length});
    const b = r.getBoundingClientRect();
    return { x: (b.left + b.right) / 2, y: (b.top + b.bottom) / 2 };
  })()`);
  for (const clickCount of [1, 2]) {
    await pageConn.send("Input.dispatchMouseEvent", { type: "mousePressed", x: pos.x, y: pos.y, button: "left", clickCount });
    await pageConn.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: pos.x, y: pos.y, button: "left", clickCount });
    await sleep(60);
  }
}

/** 等浮窗 .title 变成本轮选中的词，再读内容 */
async function readPanel(word, timeout = 9000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    const p = await pageConn.eval(`(() => {
      const hs = document.querySelectorAll('[id="__st_panel_host__"]');
      const h = hs[hs.length - 1];
      if (!h || !h.shadowRoot) return null;
      const q = (s) => { const e = h.shadowRoot.querySelector(s); return e ? e.textContent.trim() : ""; };
      return { title: q(".title"), out: q(".out"), err: q(".err"), meta: q(".meta"), hosts: hs.length };
    })()`).catch(() => null);
    if (p && p.title === word) return p;
    await sleep(200);
  }
  return null;
}

(async () => {
  await new Promise((r) => server.listen(WEB_PORT, "127.0.0.1", r));

  proc = spawn(EDGE, [
    "--headless=new", "--remote-debugging-port=" + PORT, "--user-data-dir=" + PROFILE,
    "--no-first-run", "--no-default-browser-check", "--disable-gpu",
    "--load-extension=" + EXT_DIR, "--disable-extensions-except=" + EXT_DIR, "about:blank",
  ], { stdio: "ignore" });

  let sw0 = null;
  for (let i = 0; i < 120 && !sw0; i++) { await sleep(300); sw0 = await findSW().catch(() => null); }
  ok(!!sw0, "扩展加载成功", sw0 && sw0.url);
  if (!sw0) return;
  const extId = String(sw0.url).match(/chrome-extension:\/\/([^/]+)\//)[1];

  const page = (await listTargets()).find((t) => t.type === "page" && t.url === "about:blank")
    || (await listTargets()).find((t) => t.type === "page");
  await pageConn.attach(page.webSocketDebuggerUrl);
  await pageConn.send("Runtime.enable");
  await pageConn.send("Page.enable");
  pageConn.ws.addEventListener("message", (e) => {
    const m = JSON.parse(e.data);
    if (m.method === "Runtime.exceptionThrown") {
      pageLog.push((m.params.exceptionDetails.exception || {}).description || m.params.exceptionDetails.text);
    }
  });
  await pageConn.send("Page.navigate", { url: "http://127.0.0.1:" + WEB_PORT + "/" });
  for (let i = 0; i < 60; i++) {
    if (await pageConn.eval('document.readyState === "complete" && !!document.getElementById("t")').catch(() => false)) break;
    await sleep(200);
  }
  await sleep(900);

  console.log("\n[1] 正常情况下双击划词");
  await dblclickWord("quick");
  let p = await readPanel("quick");
  ok(!!p, "浮窗出现（content script 链路通）", p);
  ok(!!p && !/context invalidated/i.test(p.err), "不报上下文失效", p && p.err.slice(0, 120));

  console.log("\n[2] 重新加载扩展（模拟开发时点「重新加载」/ 扩展自动更新）");
  await swConn.attach(sw0.webSocketDebuggerUrl);
  await swConn.send("Runtime.enable");
  await swConn.eval("chrome.runtime.reload(), 'ok'").catch(() => {});
  await sleep(2500);
  let sw1 = await findSW().catch(() => null);
  if (!sw1) {
    // SW 可能处于休眠，开个扩展页把它唤醒
    await fetch(`http://127.0.0.1:${PORT}/json/new?url=chrome-extension://${extId}/src/options.html`, { method: "PUT" }).catch(() => {});
    for (let i = 0; i < 40 && !sw1; i++) { await sleep(500); sw1 = await findSW().catch(() => null); }
  }
  ok(!!sw1, "扩展已重新加载", sw1 && sw1.url);

  console.log("\n[3] 未刷新的页面再双击 → 复现用户报的错");
  await dblclickWord("brown");
  p = await readPanel("brown");
  if (!p) {
    console.log(
      "  [诊断] 浮窗状态: " +
        JSON.stringify(
          await pageConn.eval(`(() => {
        const hs = document.querySelectorAll('[id="__st_panel_host__"]');
        const h = hs[hs.length - 1];
        const q = (s) => { const e = h && h.shadowRoot && h.shadowRoot.querySelector(s); return e ? e.textContent.trim() : null; };
        const wrap = h && h.shadowRoot && h.shadowRoot.querySelector(".wrap");
        const wr = wrap ? wrap.getBoundingClientRect() : null;
        const node = document.getElementById("t").firstChild;
        const i = node.textContent.indexOf("brown");
        const rr = document.createRange(); rr.setStart(node, i); rr.setEnd(node, i + 5);
        const br = rr.getBoundingClientRect();
        return {
          hosts: hs.length, title: q(".title"), meta: q(".meta"), sel: String(getSelection()),
          inner: [innerWidth, innerHeight],
          brownRect: [Math.round(br.left), Math.round(br.top), Math.round(br.right), Math.round(br.bottom)],
          wrapRect: wr ? [Math.round(wr.left), Math.round(wr.top), Math.round(wr.right), Math.round(wr.bottom)] : null,
        };
      })()`).catch((e) => "eval-err: " + e.message)
        )
    );
  }
  ok(!!p, "浮窗仍弹出（孤儿脚本还能跑 DOM）", p);
  ok(!!p && /脚本已失效/.test(p.err), "标题明确说是「脚本已失效」", p && p.err.slice(0, 120));
  ok(!!p && /刷新/.test(p.err), "提示里明确要求刷新页面", p && p.err.slice(0, 200));
  ok(!!p && !/检查翻译引擎配置/.test(p.err), "不再误导为「检查翻译引擎配置」", p && p.err.slice(0, 200));
  ok(!!p && p.meta === "需刷新页面", "状态栏显示「需刷新页面」", p && p.meta);

  console.log("\n[4] 验证「后台自动重新注入」这条路走不通（决定只能靠刷新）");
  const inj = await swConn
    .attach(sw1.webSocketDebuggerUrl)
    .then(() => swConn.send("Runtime.enable"))
    .then(() => swConn.eval(`(async () => {
      const tabs = await chrome.tabs.query({});
      // 没有 tabs 权限时 tab.url 被遮蔽成 null，只能按"非扩展页"挑
      const web = tabs.filter((x) => !String(x.url || "").startsWith("chrome-extension://"));
      const t = web[0];
      if (!t) return "no-tab";
      try {
        await chrome.scripting.executeScript({ target: { tabId: t.id }, files: ["src/content.js"] });
        return "injected";
      } catch (e) { return "err: " + e.message; }
    })()`))
    .catch((e) => "eval-err: " + e.message);
  ok(/Cannot access contents|no-tab/.test(inj), "确认无法从后台自动重新注入（缺站点 host 权限）", String(inj).slice(0, 200));

  console.log("\n[5] 刷新页面后双击 → 恢复");
  await pageConn.send("Page.reload", {});
  await sleep(1500);
  for (let i = 0; i < 40; i++) {
    if (await pageConn.eval('document.readyState === "complete" && !!document.getElementById("t")').catch(() => false)) break;
    await sleep(200);
  }
  await sleep(1000);
  await dblclickWord("jumps");
  p = await readPanel("jumps");
  ok(!!p, "浮窗出现", p);
  ok(!!p && !/脚本已失效/.test(p.err) && !/context invalidated/i.test(p.err), "刷新后恢复正常", p && p.err.slice(0, 160));

  // 孤儿脚本失效时 sendMessage 抛错属于预期，不该算"页面有未捕获异常"
  const unexpected = pageLog.filter((x) => !/context invalidated/i.test(x));
  ok(unexpected.length === 0, "页面无其它未捕获异常", unexpected.slice(0, 2));

  console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
})().catch((e) => console.log("失败： " + ((e && e.stack) || e))).finally(async () => {
  try { pageConn.ws && pageConn.ws.close(); } catch (_) {}
  try { swConn.ws && swConn.ws.close(); } catch (_) {}
  try { proc && proc.kill(); } catch (_) {}
  try { server.close(); } catch (_) {}
  await sleep(500);
  try { fs.rmSync(PROFILE, { recursive: true, force: true }); } catch (_) {}
  process.exit(fail ? 1 : 0);
});
