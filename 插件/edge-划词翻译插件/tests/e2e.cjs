/* 真实 Edge 加载扩展 → 打开内置 PDF 阅读器 → 塞入 PDF → 双击划词 → 断言浮窗 */
const { spawn } = require("child_process");
const path = require("path");
const os = require("os");
const fs = require("fs");
const { pathToFileURL } = require("url");

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const PORT = 9341;
const EXT_DIR = path.resolve(__dirname, "..");
const PDF = path.join(__dirname, "sample.pdf");
const PROFILE = path.join(os.tmpdir(), "st-e2e-" + Date.now());
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let pass = 0;
let fail = 0;
function ok(cond, name, extra) {
  if (cond) {
    pass++;
    console.log("  ✓ " + name);
  } else {
    fail++;
    console.log("  ✗ " + name + (extra !== undefined ? "  → " + JSON.stringify(extra) : ""));
  }
}

let ws, id = 0;
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

function attachWs(url, label) {
  const sock = new WebSocket(url);
  sock.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id) {
      const p = pending.get(m.id);
      if (p) {
        pending.delete(m.id);
        m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result);
      }
      return;
    }
    if (m.method === "Runtime.exceptionThrown") {
      jsErrors.push(label + ": " + ((m.params.exceptionDetails.exception || {}).description || m.params.exceptionDetails.text));
    }
    if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") {
      jsErrors.push(label + " console.error: " + (m.params.args || []).map((a) => a.value || a.description).join(" "));
    }
  };
  return sock;
}

async function evaluate(expr) {
  const r = await send("Runtime.evaluate", {
    expression: expr,
    awaitPromise: true,
    returnByValue: true,
    userGesture: true,
  });
  if (r.exceptionDetails) {
    throw new Error((r.exceptionDetails.exception || {}).description || r.exceptionDetails.text);
  }
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

let proc;
(async () => {
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

  // 1. 等浏览器起来，找扩展的 service worker target
  let extId = null;
  for (let i = 0; i < 120 && !extId; i++) {
    await sleep(300);
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      const sw = list.find(
        (t) => t.type === "service_worker" && String(t.url).includes("/src/background.js")
      );
      if (sw) {
        extId = String(sw.url).match(/chrome-extension:\/\/([^/]+)\//)[1];
      }
    } catch (e) {}
  }
  ok(!!extId, "扩展被浏览器加载（拿到扩展 ID）", extId);

  if (!extId) {
    cleanup();
    return;
  }

  const readerUrl = `chrome-extension://${extId}/src/reader.html`;
  const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
  let page = list.find((t) => t.type === "page" && t.url === "about:blank") || list.find((t) => t.type === "page");
  ws = attachWs(page.webSocketDebuggerUrl, "reader");
  await new Promise((res, rej) => {
    ws.onopen = res;
    ws.onerror = rej;
  });
  await send("Runtime.enable");
  await send("Page.enable");
  await send("DOM.enable");

  await send("Target.activateTarget", { targetId: page.id }).catch(() => {});
  await send("Page.bringToFront").catch(() => {});
  await send("Page.navigate", { url: readerUrl });
  const navOk = await waitFor(
    'location.href.indexOf("reader.html") > -1 && document.readyState === "complete" && !!document.getElementById("pages")',
    40000
  );
  console.log(
    "  [诊断] url=" + (await evaluate("location.href")) + " readyState=" + (await evaluate("document.readyState"))
  );
  ok(navOk, "reader.html 能打开");
  ok(await evaluate('document.body.classList.contains("loaded") === false'), "初始为空状态（未加载文档）");

  // 3. 塞入本地 PDF（等价于用户选文件）
  const doc = await send("DOM.getDocument", { depth: -1 });
  const q = await send("DOM.querySelector", { nodeId: doc.root.nodeId, selector: "#file" });
  await send("DOM.setFileInputFiles", { files: [PDF], nodeId: q.nodeId });

  ok(await waitFor('document.body.classList.contains("loaded")', 30000), "PDF 解析完成（进入阅读状态）");
  const pageCount = await evaluate('document.querySelectorAll("#pages .page").length');
  ok(pageCount === 2, "两页都建立了占位容器", pageCount);
  const textLayerOk = await waitFor('document.querySelectorAll(".text-layer > span").length > 0', 30000);
  ok(textLayerOk, "文本层已渲染（可划选）");
  if (!textLayerOk) {
    console.log("  [诊断] jsErrors:", JSON.stringify(jsErrors.slice(0, 6)));
    console.log(
      "  [诊断] viewer:",
      JSON.stringify(
        await evaluate(
          '(()=>{const v=document.getElementById("viewer");return {w:v.clientWidth,h:v.clientHeight,top:v.scrollTop,pages:document.querySelectorAll("#pages .page").length,firstInner:(document.querySelector("#pages .page")||{innerHTML:""}).innerHTML.slice(0,200)};})()'
        )
      )
    );
    console.log("  [诊断] reader state:", JSON.stringify(await evaluate("window.__stReader.state()")));
  }

  // ★ 画布"读回全白"的真凶是 target 被抢走了前台，不是读回机制坏、更不是阅读器的问题：
  //   pdf.js 的渲染是 rAF 驱动的（InternalRenderTask._scheduleNext），而 `--headless=new` 里
  //   **一旦这个标签不是前台，document.visibilityState 就是 "hidden"，rAF 不再跑** →
  //   page.render().promise 永不 resolve（window.__stReader.state().rendered 一直空，
  //   25s 后触发阅读器自己的"画布渲染超时"），此时 canvas 尺寸正常、画面也看着是好的，
  //   但 getImageData / toDataURL 读回全白。
  //   本机最常见的触发源：`onInstalled` 里 chrome.tabs.create() 开的设置欢迎页抢走了前台。
  //   所以——**断言前必须重新把这个 target 拉回前台，并轮询等像素出现**，不能读一次就下结论。
  //   （诊断脚本：tests/tmp-canvas.cjs；把 page 换成空壳 panel 的对照实验也确认过与本项目代码无关）
  await send("Target.activateTarget", { targetId: page.id }).catch(() => {});
  await send("Page.bringToFront").catch(() => {});
  let vis = "";
  for (let i = 0; i < 40; i++) {
    vis = await evaluate("document.visibilityState").catch(() => "?");
    if (vis === "visible") break;
    await sleep(250);
  }
  const countDark = `(() => {
    const c = document.querySelector(".page canvas");
    if (!c) return -1;
    const ctx = c.getContext("2d");
    const d = ctx.getImageData(0, 0, c.width, Math.min(c.height, 1200)).data;
    let dark = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i] < 160) dark++;
    return dark;
  })()`;
  let dark = 0;
  for (let i = 0; i < 50; i++) {
    dark = await evaluate(countDark).catch(() => -1);
    if (dark > 500) break;
    await evaluate("window.__stReader && window.__stReader.renderVisible()").catch(() => {});
    await sleep(250);
  }

  const textInfo = await evaluate(`(() => {
    const spans = Array.from(document.querySelectorAll(".text-layer > span")).map(s => s.textContent);
    const c = document.querySelector(".page canvas");
    return { spans, canvasW: c ? c.width : 0, canvasH: c ? c.height : 0 };
  })()`);
  ok(textInfo.spans.some((s) => s.includes("Hello world")), "PDF 文本被正确提取", textInfo.spans.slice(0, 4));
  ok(textInfo.canvasW > 300 && textInfo.canvasH > 300, "canvas 尺寸合理", [textInfo.canvasW, textInfo.canvasH]);
  console.log("  [诊断] visibilityState=" + vis + " dark=" + dark);
  ok(dark > 500, "canvas 真的画出了内容（黑色像素数）", { dark, vis });

  // 4. 双击划词 → 浮窗
  await evaluate(`(() => {
    const s = Array.from(document.querySelectorAll(".text-layer > span")).find(x => x.textContent.includes("Hello"));
    s.scrollIntoView({ block: "center" });
    window.__pt = (() => { const r = s.getBoundingClientRect(); return { x: r.left + 10, y: r.top + r.height / 2 }; })();
    return true;
  })()`);
  await sleep(400);

  // 用 mock 掉 runtime.sendMessage 的方式单独验证 UI 链路（不影响真实引擎测量）
  const realTranslate = await evaluate(`chrome.runtime.sendMessage({type:"translate", text:"Hello world"}).then(r => r)`);

  const pt = await evaluate("window.__pt");
  for (const clickCount of [1, 2]) {
    await send("Input.dispatchMouseEvent", { type: "mousePressed", x: pt.x, y: pt.y, button: "left", clickCount });
    await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: pt.x, y: pt.y, button: "left", clickCount });
    await sleep(60);
  }
  const selected = await evaluate("String(window.getSelection())");
  ok(selected.trim().length > 0, "双击选中了文本", selected);

  ok(await waitFor('!!document.getElementById("__st_panel_host__")', 15000), "翻译浮窗出现");

  const readPanel = `(() => {
    const h = document.getElementById("__st_panel_host__");
    if (!h || !h.shadowRoot) return null;
    const q = (s) => { const e = h.shadowRoot.querySelector(s); return e ? e.textContent.trim() : ""; };
    return { title: q(".title"), out: q(".out"), orig: q(".orig"), err: q(".err"), meta: q(".meta"),
             dict: h.shadowRoot.querySelectorAll(".dict-row").length };
  })()`;
  // 双击一个单词时走的是**词典视图**（一词多义），没有 .out/.err，所以三种内容都算"链路通"
  const contentOk = await waitFor(
    `(() => {const h=document.getElementById("__st_panel_host__"); if(!h||!h.shadowRoot) return false; return !!h.shadowRoot.querySelector(".out, .err, .dict-row");})()`,
    45000
  );
  const panel = await evaluate(readPanel);
  ok(contentOk && !!panel && (panel.out || panel.err || panel.dict), "浮窗渲染出结果或错误（UI 链路通）", panel);
  ok(!!panel && panel.title.includes(selected.trim().slice(0, 6)), "浮窗标题是选中的词", panel && panel.title);

  console.log("  [浮窗内容·真实引擎] " + JSON.stringify(panel).slice(0, 260));
  console.log("  [真实引擎调用] " + JSON.stringify(realTranslate).slice(0, 260));

  // 第二步：把 runtime.sendMessage 换成假的，验证“拿到译文后的渲染”这一段
  // lookup-word 也一并接管并返回 null —— 让单词落到翻译分支，才测得到译文的渲染
  const mocked = await evaluate(`(() => {
    try {
      const real = chrome.runtime.sendMessage.bind(chrome.runtime);
      chrome.runtime.sendMessage = async (m) =>
        (m && m.type === "lookup-word")
          ? { ok: true, dict: null }
          : (m && m.type === "translate")
          ? { ok: true, translation: "【模拟译文】你好，世界", engine: "google", detected: "en" }
          : real(m);
      return typeof chrome.runtime.sendMessage === "function";
    } catch (e) { return "ERR:" + e.message; }
  })()`);
  if (mocked === true) {
    for (const clickCount of [1, 2]) {
      await send("Input.dispatchMouseEvent", { type: "mousePressed", x: pt.x, y: pt.y, button: "left", clickCount });
      await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: pt.x, y: pt.y, button: "left", clickCount });
      await sleep(60);
    }
    const okMock = await waitFor(
      `(() => {const h=document.getElementById("__st_panel_host__"); if(!h||!h.shadowRoot) return false; const o=h.shadowRoot.querySelector(".out"); return !!o && o.textContent.includes("模拟译文");})()`,
      15000
    );
    const panel2 = await evaluate(readPanel);
    ok(okMock, "拿到译文后浮窗正确渲染译文 + 原文", panel2);
    ok(!!panel2 && panel2.orig.includes("Hello"), "浮窗显示原文", panel2 && panel2.orig);
    ok(!!panel2 && panel2.meta.includes("google"), "浮窗标注来源引擎", panel2 && panel2.meta);
  } else {
    console.log("  [跳过] 无法覆盖 runtime.sendMessage：" + mocked);
  }

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
  setTimeout(() => {
    try {
      fs.rmSync(PROFILE, { recursive: true, force: true });
    } catch (e) {}
    process.exit(fail ? 1 : 0);
  }, 700);
}
