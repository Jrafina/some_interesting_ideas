/*
 * 诊断工具：渲染一段中英混排的"网页文字"，截成 PNG 并导出成 data URI。
 * 用途：给 /ocr 端点做真实输入（比手搓 base64 靠谱，也更接近用户实际框选的画面）。
 *
 *   node worker/tmp/mkimg.cjs [输出json] [宽] [高]
 * 产出 worker/tmp/ocr-sample.json → { "image": "data:image/png;base64,..." }
 */
const { spawn } = require("child_process");
const path = require("path");
const os = require("os");
const fs = require("fs");

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const PORT = 9361;
const PROFILE = path.join(os.tmpdir(), "st-mkimg-" + Date.now());
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const out = process.argv[2] || path.join(__dirname, "ocr-sample.json");
const W = Number(process.argv[3] || 900);
const H = Number(process.argv[4] || 360);

// 故意做成"网页正文"的样子：标题 + 编号列表 + 中英混排 + 邮箱/URL，
// 这些都是划词翻译最常见的框选对象。
const PAGE = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<style>
  body{margin:0;background:#fff;color:#111;
       font:15px/1.75 "Microsoft YaHei","Segoe UI",sans-serif}
  .card{padding:22px 26px}
  h1{font-size:20px;margin:0 0 12px;color:#1a3d8f}
  ol{margin:0;padding-left:22px}
  .note{margin-top:12px;color:#444}
  b{color:#b3261e}
</style></head><body><div class="card">
  <h1>Quick Start Guide 使用说明</h1>
  <ol>
    <li>双击或选中任意单词，即可弹出翻译浮窗。</li>
    <li>按 Alt+S 框选屏幕区域，可以翻译图片里的文字。</li>
    <li>The screenshot OCR runs on Cloudflare Workers AI, so no local model is needed.</li>
  </ol>
  <div class="note">提示：扫描版 PDF 没有文字层，请改用截屏翻译。<br>
  联系人：Zhang San &nbsp; 邮箱：someone@example.com</div>
</div></body></html>`;

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
    "about:blank",
  ], { stdio: "ignore" });

  let page = null;
  for (let i = 0; i < 60 && !page; i++) {
    await sleep(300);
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      page = list.find((t) => t.type === "page");
    } catch (e) {}
  }
  if (!page) throw new Error("Edge 没起来");

  ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id) { const p = pending.get(m.id); if (p) { pending.delete(m.id); m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result); } }
  };
  await send("Page.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: W, height: H, deviceScaleFactor: 1, mobile: false });
  await send("Page.navigate", { url: "data:text/html;base64," + Buffer.from(PAGE, "utf8").toString("base64") });
  await sleep(1200);
  const shot = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true });
  const buf = Buffer.from(shot.data, "base64");
  const pngPath = out.replace(/\.json$/, "") + ".png";
  fs.writeFileSync(pngPath, buf);
  fs.writeFileSync(out, JSON.stringify({ image: "data:image/png;base64," + shot.data }));
  console.log(`已生成 ${pngPath} (${W}x${H}, ${buf.length} bytes)`);
  console.log(`data URI 已写入 ${out} (${shot.data.length} chars)`);
})().catch((e) => console.log("失败： " + (e && e.message))).finally(async () => {
  try { ws && ws.close(); } catch (_) {}
  try { proc && proc.kill(); } catch (_) {}
  await sleep(400);
  try { fs.rmSync(PROFILE, { recursive: true, force: true }); } catch (_) {}
  process.exit(0);
});
