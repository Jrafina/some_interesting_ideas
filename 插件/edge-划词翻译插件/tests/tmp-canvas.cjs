/* 临时探针：PDF 阅读器的 canvas 到底画没画出内容（截图 + 逐 canvas 采样） */
const { spawn } = require("child_process");
const path = require("path");
const os = require("os");
const fs = require("fs");

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const PORT = 9381;
const EXT_DIR = path.resolve(__dirname, "..");
const PDF = path.join(__dirname, "sample.pdf");
const PROFILE = path.join(os.tmpdir(), "st-canvas-" + Date.now());
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
async function evaluate(expr) {
  const r = await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true, userGesture: true });
  if (r.exceptionDetails) throw new Error((r.exceptionDetails.exception || {}).description || r.exceptionDetails.text);
  return r.result.value;
}
const list = async () => await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const findSW = async () => (await list()).find((t) => t.type === "service_worker" && String(t.url).includes("/src/background.js"));

let proc;
// 对照实验：STUB_PANEL=1 时把扩展复制到临时目录，并把 src/ui/panel.js 换成空壳
// （等于把这次新加的词典代码从阅读器加载路径里摘掉），看 canvas 读回是否仍为 0。
const STUB = process.env.STUB_PANEL === "1";
const LOAD_DIR = STUB ? path.join(os.tmpdir(), "st-stub-ext-" + Date.now()) : EXT_DIR;
if (STUB) {
  fs.cpSync(EXT_DIR, LOAD_DIR, {
    recursive: true,
    filter: (p) => !/(\\|\/)(tests|\.workbuddy|node_modules|\.git)(\\|\/|$)/.test(p),
  });
  fs.writeFileSync(
    path.join(LOAD_DIR, "src/ui/panel.js"),
    "export function translateAndShow(){} export function showPanel(){} export function isPanelEvent(){return false} export function close(){}\n"
  );
  console.log("【对照】加载的扩展副本：" + LOAD_DIR + "（panel.js 已换成空壳）");
}
(async () => {
  proc = spawn(EDGE, [
    "--headless=new", "--remote-debugging-port=" + PORT, "--user-data-dir=" + PROFILE,
    "--no-first-run", "--no-default-browser-check", "--disable-gpu",
    "--disable-accelerated-2d-canvas",
    "--disable-features=CanvasOopRasterization",
    // pdf.js 的 render promise 收尾靠 rAF；headless 下页面被当后台节流就永不 resolve。
    "--disable-renderer-backgrounding",
    "--disable-backgrounding-occluded-windows",
    "--disable-background-timer-throttling",
    "--disable-features=CalculateNativeWinOcclusion",
    "--load-extension=" + LOAD_DIR, "--disable-extensions-except=" + LOAD_DIR, "about:blank",
  ], { stdio: "ignore" });

  let sw = null;
  for (let i = 0; i < 120 && !sw; i++) { await sleep(300); sw = await findSW().catch(() => null); }
  if (!sw) { console.log("扩展没起来"); return; }
  const extId = String(sw.url).match(/chrome-extension:\/\/([^/]+)\//)[1];
  const t = (await list()).find((x) => x.type === "page" && x.url === "about:blank") || (await list()).find((x) => x.type === "page");
  ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (!m.id) return;
    const p = pending.get(m.id);
    if (p) { pending.delete(m.id); m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result); }
  };
  await send("Runtime.enable");
  await send("Page.enable");
  await send("DOM.enable");
  // ★ 按 skill 里记的配方：先把 target 激活到前台，hidden 的 target 里 rAF 不跑，
  //   pdf.js 的 render promise 就永远不 resolve（画布看着正常、读回全白）。
  await send("Target.activateTarget", { targetId: t.id }).catch(() => {});
  await send("Page.bringToFront").catch(() => {});
  await sleep(300);
  console.log("【可见性】" + JSON.stringify(await evaluate(
    "({ vis: document.visibilityState, hidden: document.hidden, focused: document.hasFocus() })")));

  // 隔离测试：干净页面上新建 canvas，画红块读回。这跟扩展完全无关，
  // 只为判断"这台 headless Edge 的 canvas 读回是不是全局坏掉"。
  const iso = await evaluate(`(() => {
    const c = document.createElement("canvas");
    c.width = 100; c.height = 100;
    document.body.appendChild(c);
    const ctx = c.getContext("2d");
    ctx.fillStyle = "#ff0000";
    ctx.fillRect(0, 0, 50, 50);
    const d = ctx.getImageData(0, 0, 5, 5).data;
    return { px: [d[0], d[1], d[2], d[3]], urlLen: c.toDataURL().length };
  })()`);
  console.log("【隔离】about:blank 上自绘红块读回：" + JSON.stringify(iso));
  await send("Page.navigate", { url: `chrome-extension://${extId}/src/reader.html` });
  for (let i = 0; i < 60; i++) {
    if (await evaluate('location.href.indexOf("reader.html")>-1 && document.readyState==="complete" && !!document.getElementById("pages")').catch(() => false)) break;
    await sleep(300);
  }
  const doc = await send("DOM.getDocument", { depth: -1 });
  const q = await send("DOM.querySelector", { nodeId: doc.root.nodeId, selector: "#file" });
  await send("DOM.setFileInputFiles", { files: [PDF], nodeId: q.nodeId });
  for (let i = 0; i < 60; i++) {
    if (await evaluate('document.body.classList.contains("loaded")').catch(() => false)) break;
    await sleep(300);
  }
  await sleep(2500);

  const info = await evaluate(`(() => {
    const cs = [...document.querySelectorAll("canvas")];
    return {
      n: cs.length,
      detail: cs.map((c) => {
        const ctx = c.getContext("2d");
        const d = ctx.getImageData(0, 0, c.width, c.height).data;
        let dark = 0, nonWhite = 0;
        for (let i = 0; i < d.length; i += 4) {
          if (d[i] < 160) dark++;
          if (d[i] < 250 || d[i+1] < 250 || d[i+2] < 250) nonWhite++;
        }
        // 行分布：只看前 400 行是有可能漏掉内容的，顺便给出内容出现的行范围
        let firstRow = -1, lastRow = -1;
        for (let y = 0; y < c.height; y++) {
          let hit = 0;
          for (let x = 0; x < c.width; x++) {
            if (d[(y * c.width + x) * 4] < 250) { hit++; if (hit > 3) break; }
          }
          if (hit > 3) { if (firstRow < 0) firstRow = y; lastRow = y; }
        }
        window.__st_canvas_url = (() => { try { return c.toDataURL("image/png"); } catch (e) { return "ERR:" + e.message; } })();
        window.__st_canvas_size = [c.width, c.height];
        return { w: c.width, h: c.height, dark, nonWhite, cls: c.className, parentCls: (c.parentElement||{}).className,
                 firstRow, lastRow,
                 bbox: (() => { const r = c.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; })(),
                 dataUrlLen: (window.__st_canvas_url || "").length };
      }),
      state: window.__stReader && window.__stReader.state ? window.__stReader.state() : null,
    };
  })()`);
  console.log(JSON.stringify(info, null, 1));

  // 时间序列：渲染任务可能还在飞（state.rendered 为空 = 还没 set 进去），
  // 看它到底会不会完成、完成后读回是否就有像素了。
  console.log("时间序列（每 2s 采一次，看渲染任务是否完成 / 读回是否恢复）：");
  // 先试 skill 里记的"手动补一次重渲染"
  const re = await evaluate(`(async () => {
    try { window.__stReader.renderVisible(); } catch (e) { return "err:" + e.message; }
    await new Promise((r) => setTimeout(r, 50));
    return "called";
  })()`).catch((e) => "eval-err:" + e.message);
  console.log("  手动调用 renderVisible(): " + re);
  for (let i = 0; i < 16; i++) {
    const s = await evaluate(`(() => {
      const c = document.querySelector("canvas");
      const st = window.__stReader && window.__stReader.state ? window.__stReader.state() : {};
      let dark = 0;
      if (c) {
        const d = c.getContext("2d").getImageData(0, 0, c.width, Math.min(c.height, 1200)).data;
        for (let k = 0; k < d.length; k += 4) if (d[k] < 160) dark++;
      }
      return { dark, rendered: (st.rendered || []).length, errors: (st.errors || []).length,
               w: c ? c.width : 0, h: c ? c.height : 0 };
    })()`).catch((e) => ({ err: String(e.message) }));
    console.log("  t=" + i * 2 + "s " + JSON.stringify(s));
    if (s && s.dark > 500) break;
    await sleep(2000);
  }

  // 决定性验证：往同一个 canvas 上画一块红，再读回。
  // 读回红 = 读回机制没坏（那 canvas 后背真的空）；读回白 = headless 下 2D 读回本身不可靠。
  const probe = await evaluate(`(() => {
    const c = document.querySelector("canvas");
    const ctx = c.getContext("2d");
    ctx.save();
    ctx.fillStyle = "#ff0000";
    ctx.fillRect(0, 0, 60, 60);
    ctx.restore();
    const d = ctx.getImageData(0, 0, 10, 10).data;
    return { p0: [d[0], d[1], d[2], d[3]] };
  })()`);
  console.log("自绘红块读回：" + JSON.stringify(probe));

  const shot = await send("Page.captureScreenshot", { format: "png" });
  fs.writeFileSync(path.join(__dirname, "tmp-canvas.png"), Buffer.from(shot.data, "base64"));
  // 把 canvas 自己的 toDataURL 也存下来：和 CDP 截图对比，判断是"画布真空白"还是"读回不可靠"
  const url = await evaluate("window.__st_canvas_url || ''");
  if (url.startsWith("data:image/png;base64,")) {
    fs.writeFileSync(path.join(__dirname, "tmp-canvas-dataurl.png"), Buffer.from(url.split(",")[1], "base64"));
    console.log("canvas toDataURL 也已写 tests/tmp-canvas-dataurl.png");
  } else {
    console.log("toDataURL 异常：" + url.slice(0, 120));
  }
  console.log("截图已写 tests/tmp-canvas.png");

  // 决定性判据：把 canvas 藏起来再截一张。文字还在 → 文字来自文本层（不是 canvas）
  await evaluate(`(() => { document.querySelector("canvas").style.display = "none"; return 1; })()`);
  await sleep(600);
  const shot2 = await send("Page.captureScreenshot", { format: "png" });
  fs.writeFileSync(path.join(__dirname, "tmp-canvas-nocanvas.png"), Buffer.from(shot2.data, "base64"));
  console.log("隐藏 canvas 后的截图已写 tests/tmp-canvas-nocanvas.png");
})()
  .catch((e) => console.log("异常：" + ((e && e.stack) || e)))
  .finally(async () => {
    try { ws && ws.close(); } catch (_) {}
    try { proc && proc.kill(); } catch (_) {}
    await sleep(400);
    try { fs.rmSync(PROFILE, { recursive: true, force: true }); } catch (_) {}
    process.exit(0);
  });
