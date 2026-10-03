/*
 * 真实链路端到端：Edge 加载扩展 → 网页双击划词 → 自建代理 → 浮窗显示中文译文
 *
 * 代理地址与真 token 都不入库，用环境变量传：
 *   ST_PROXY_URL=https://你的域名/translate ST_PROXY_TOKEN=xxxx node tests/e2e-proxy.cjs
 * 未设置 token 时脚本会跳过真实翻译，只验证"未配 token 时的报错路径"。
 */
const { spawn } = require("child_process");
const http = require("http");
const path = require("path");
const os = require("os");
const fs = require("fs");

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const PORT = 9347;
const WEB_PORT = 8792;
const PROXY_URL = (process.env.ST_PROXY_URL || "https://your-proxy.example.com/translate").trim();
const SRC_DIR = path.resolve(__dirname, "..");
// headless 下 chrome.permissions.request 会弹对话框卡死（无人点允许），
// 所以复制一份扩展、把代理域名直接写进 host_permissions —— 等价于"用户已点允许"。
const EXT_DIR = path.join(os.tmpdir(), "st-ext-proxy-" + Date.now());
fs.cpSync(SRC_DIR, EXT_DIR, {
  recursive: true,
  filter: (p) => !/(\\|\/)(tests|\.workbuddy|node_modules|\.git)(\\|\/|$)/.test(p),
});
const mfPath = path.join(EXT_DIR, "manifest.json");
const mf = JSON.parse(fs.readFileSync(mfPath, "utf-8"));
mf.host_permissions = (mf.host_permissions || []).concat([new URL(PROXY_URL).origin + "/*"]);
fs.writeFileSync(mfPath, JSON.stringify(mf, null, 2));
const TOKEN = (process.env.ST_PROXY_TOKEN || "").trim();
const PROFILE = path.join(os.tmpdir(), "st-e2e-proxy-" + Date.now());
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>t</title>
<style>body{font:18px/2 sans-serif;padding:40px;max-width:640px}</style></head><body>
<p id="t">The quick brown fox jumps over the lazy dog.</p></body></html>`;

let pass = 0, fail = 0;
function ok(cond, name, extra) {
  if (cond) { pass++; console.log("  ✓ " + name); }
  else { fail++; console.log("  ✗ " + name + (extra !== undefined ? "  → " + JSON.stringify(extra) : "")); }
}

let ws, id = 0;
const pending = new Map();
const jsErrors = [];
function send(method, params) {
  return new Promise((res, rej) => {
    const i = ++id;
    pending.set(i, { res, rej });
    ws.send(JSON.stringify({ id: i, method, params: params || {} }));
    setTimeout(() => { if (pending.has(i)) { pending.delete(i); rej(new Error("CDP 超时 " + method)); } }, 120000);
  });
}
async function evaluate(expr) {
  const r = await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true, userGesture: true });
  if (r.exceptionDetails) throw new Error((r.exceptionDetails.exception || {}).description || r.exceptionDetails.text);
  return r.result.value;
}
async function waitFor(expr, timeout = 45000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    try { if (await evaluate(expr)) return true; } catch (e) {}
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
  console.log(TOKEN ? "  带 token 运行，将验证真实翻译链路" : "  未设置 ST_PROXY_TOKEN，只验证报错路径");

  proc = spawn(EDGE, ["--headless=new", "--remote-debugging-port=" + PORT,
    "--user-data-dir=" + PROFILE, "--no-first-run", "--no-default-browser-check", "--disable-gpu",
    "--load-extension=" + EXT_DIR, "--disable-extensions-except=" + EXT_DIR, "about:blank"],
    { stdio: "ignore" });

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
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id) {
      const p = pending.get(m.id);
      if (p) { pending.delete(m.id); m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result); }
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

  // 1) 在扩展页面里写设置 + 申请该域名权限
  await send("Page.navigate", { url: `chrome-extension://${extId}/src/options.html` });
  await waitFor('!!document.getElementById("engineList")', 30000);

  if (TOKEN) {
    const saved = await evaluate(
      `chrome.storage.sync.set({settings:{proxy:{url:${JSON.stringify(PROXY_URL)},token:${JSON.stringify(TOKEN)}},order:["proxy","openai","google","youdao"]}}).then(()=>true)`
    );
    ok(saved === true, "设置写入成功", saved);

    // 2) 网页双击 → 真实翻译
    await send("Page.navigate", { url: "http://127.0.0.1:" + WEB_PORT + "/" });
    await waitFor('!!document.getElementById("t") && document.readyState === "complete"', 30000);
    // 这里验的是「代理翻译链路」，所以必须选**多词短语** ——
    // 单个词会走词典视图（一词多义），压根不经过翻译引擎，.out 永远不会出现。
    // 真实鼠标双击只能选中一个词，所以程序设选区 + 派发 dblclick（content script 不检查 isTrusted）。
    const sel = await evaluate(`(() => {
      const PHRASE = "quick brown fox";
      const n = document.getElementById("t").firstChild;
      const i = n.textContent.indexOf(PHRASE);
      const r = document.createRange(); r.setStart(n, i); r.setEnd(n, i + PHRASE.length);
      const s = getSelection(); s.removeAllRanges(); s.addRange(r);
      document.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
      return String(s);
    })()`);
    ok(sel === "quick brown fox", "选中短语（多词 → 走翻译引擎）", sel);
    ok(await waitFor('!!document.getElementById("__st_panel_host__")', 15000), "浮窗出现");
    const got = await waitFor(
      `(() => {const h=document.getElementById("__st_panel_host__"); if(!h||!h.shadowRoot) return false;
        const o=h.shadowRoot.querySelector(".out"); return !!(o && o.textContent.trim());})()`,
      45000
    );
    const panel = await evaluate(`(() => {
      const h = document.getElementById("__st_panel_host__"); if (!h || !h.shadowRoot) return null;
      const q = (s) => { const e = h.shadowRoot.querySelector(s); return e ? e.textContent.trim() : ""; };
      return { title: q(".title"), out: q(".out"), orig: q(".orig"), err: q(".err"), meta: q(".meta") };
    })()`);
    ok(got, "浮窗拿到译文（真实网络 + 真实代理）", panel);
    ok(!!panel && /[一-龥]/.test(panel.out), "译文确实是中文", panel && panel.out);
    ok(!!panel && panel.meta.includes("自建代理"), "浮窗标注来源为自建代理", panel && panel.meta);
    console.log("  [译文] " + JSON.stringify(panel).slice(0, 200));
  } else {
    // 无 token：确认会给出可读报错而不是卡死
    await send("Page.navigate", { url: "http://127.0.0.1:" + WEB_PORT + "/" });
    await waitFor('!!document.getElementById("t")', 30000);
    await sleep(1200); // 等 document_idle 的 content script 注入完，否则派发的事件没人听
    // 同样要选多词短语，否则会命中词典视图（那属于"成功"，测不到报错路径）
    await evaluate(`(() => {
      const PHRASE = "quick brown fox";
      const n = document.getElementById("t").firstChild;
      const i = n.textContent.indexOf(PHRASE);
      const r = document.createRange(); r.setStart(n, i); r.setEnd(n, i + PHRASE.length);
      const s = getSelection(); s.removeAllRanges(); s.addRange(r);
      document.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
      return String(s);
    })()`);
    const got = await waitFor(
      `(() => {const h=document.getElementById("__st_panel_host__"); if(!h||!h.shadowRoot) return false;
        return !!h.shadowRoot.querySelector(".out, .err");})()`, 60000);
    const panel = await evaluate(`(() => {
      const h = document.getElementById("__st_panel_host__"); if (!h || !h.shadowRoot) return null;
      const q = (s) => { const e = h.shadowRoot.querySelector(s); return e ? e.textContent.trim() : ""; };
      return { err: q(".err"), out: q(".out") };
    })()`);
    ok(got, "未配 token 时给出明确报错而不是一直转圈", panel);
  }

  ok(jsErrors.length === 0, "无未捕获异常 / console.error", jsErrors.slice(0, 4));
  console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
  cleanup();
})().catch((e) => { console.error("脚本异常：", e); fail++; cleanup(); });

function cleanup() {
  try { ws && ws.close(); } catch (e) {}
  try { proc && proc.kill(); } catch (e) {}
  try { server.close(); } catch (e) {}
  setTimeout(() => {
    try { fs.rmSync(PROFILE, { recursive: true, force: true }); } catch (e) {}
    try { fs.rmSync(EXT_DIR, { recursive: true, force: true }); } catch (e) {}
    process.exit(fail ? 1 : 0);
  }, 700);
}
