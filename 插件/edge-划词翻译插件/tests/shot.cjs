/* 临时：给扩展页面截图，用来肉眼检查 UI（node tests/shot.cjs options 1440 900） */
const { spawn } = require("child_process");
const path = require("path");
const os = require("os");
const fs = require("fs");

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const PORT = 9351;
const EXT_DIR = path.resolve(__dirname, "..");
const PROFILE = path.join(os.tmpdir(), "st-shot-" + Date.now());
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const file = process.argv[2] || "options.html";
const W = Number(process.argv[3] || 1440);
const H = Number(process.argv[4] || 900);
const out = process.argv[5] || path.join(os.tmpdir(), "shot-" + file.replace(".html", "") + ".png");

let ws, id = 0;
const pending = new Map();
function send(method, params) {
  return new Promise((res, rej) => {
    const i = ++id;
    pending.set(i, { res, rej });
    ws.send(JSON.stringify({ id: i, method, params: params || {} }));
    setTimeout(() => { if (pending.has(i)) { pending.delete(i); rej(new Error("CDP 超时 " + method)); } }, 60000);
  });
}

let proc;
(async () => {
  proc = spawn(EDGE, [
    "--headless=new",
    "--remote-debugging-port=" + PORT,
    "--user-data-dir=" + PROFILE,
    "--no-first-run", "--no-default-browser-check", "--disable-gpu",
    "--load-extension=" + EXT_DIR,
    "--disable-extensions-except=" + EXT_DIR,
    "about:blank",
  ], { stdio: "ignore" });

  let extId = null;
  for (let i = 0; i < 120 && !extId; i++) {
    await sleep(300);
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      const sw = list.find((t) => t.type === "service_worker" && String(t.url).includes("/src/background.js"));
      if (sw) extId = String(sw.url).match(/chrome-extension:\/\/([^/]+)\//)[1];
    } catch (e) {}
  }
  if (!extId) throw new Error("扩展没加载起来");

  const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
  const page = list.find((t) => t.type === "page");
  ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id) { const p = pending.get(m.id); if (p) { pending.delete(m.id); m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result); } }
  };
  await send("Runtime.enable");
  await send("Page.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: W, height: H, deviceScaleFactor: 1, mobile: false });
  await send("Page.navigate", { url: `chrome-extension://${extId}/src/${file}` });
  await sleep(1500);
  const shot = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true });
  fs.writeFileSync(out, Buffer.from(shot.data, "base64"));
  console.log("已截图： " + out + "  (" + W + "x" + H + ")");
})().catch((e) => console.log("失败： " + (e && e.message))).finally(async () => {
  try { ws && ws.close(); } catch (_) {}
  try { proc && proc.kill(); } catch (_) {}
  await sleep(400);
  try { fs.rmSync(PROFILE, { recursive: true, force: true }); } catch (_) {}
  process.exit(0);
});
