/* 新 UI 端到端冒烟：翻译窗口 / 设置页 AI 多账号 / 阅读器中央大框可点击 */
const { spawn } = require("child_process");
const path = require("path");
const os = require("os");

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const PORT = 9347;
const EXT_DIR = path.resolve(__dirname, "..");
const PROFILE = path.join(os.tmpdir(), "st-e2e-ui-" + Date.now());
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
  if (r.exceptionDetails)
    throw new Error((r.exceptionDetails.exception || {}).description || r.exceptionDetails.text);
  return r.result.value;
}
async function waitFor(expr, timeout = 30000) {
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
  const page = list.find((t) => t.type === "page") ;
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

  const goto = async (file) => {
    await send("Page.navigate", { url: `chrome-extension://${extId}/src/${file}` });
    await sleep(600);
    await waitFor('document.readyState === "complete"');
  };

  /* ---------- 0. 设置页必须是独立标签页，不能是扩展页里的小对话框 ---------- */
  console.log("\n[0] 设置页的打开方式");
  const mf = JSON.parse(require("fs").readFileSync(path.join(EXT_DIR, "manifest.json"), "utf8"));
  ok(
    !!(mf.options_ui && mf.options_ui.open_in_tab === true),
    "manifest 里 options_ui.open_in_tab = true（写成 open_in_new_tab 会被忽略，设置就变成小窗口）",
    mf.options_ui
  );

  /* ---------- 1. 独立翻译窗口 ---------- */
  console.log("\n[1] 翻译窗口 window.html");
  await goto("window.html");
  const win = await evaluate(`(() => {
    const has = (s) => !!document.querySelector(s);
    return {
      input: has("#input"),
      out: has("#out"),
      langOptions: (document.getElementById("targetLang") || {}).options
        ? document.getElementById("targetLang").options.length : 0,
      langFirst: (document.getElementById("targetLang") || {}).value,
      buttons: ["newWindow", "openReader", "openOptions", "translateBtn", "copyBtn"].filter((i) => has("#" + i)),
      glass: !!document.querySelector(".pane.glass"),
    };
  })()`);
  ok(win.input && win.out, "窗口页渲染出输入区与译文区", win);
  ok(win.langOptions >= 10 && win.langFirst === "auto", "语言下拉已填充且默认自动中英对译", {
    n: win.langOptions,
    first: win.langFirst,
  });
  ok(win.buttons.length === 5, "顶部多窗按钮齐全", win.buttons);
  ok(win.glass, "毛玻璃容器在", win.glass);

  await evaluate(`document.getElementById("input").value = "Hello world"`);
  await evaluate(`document.getElementById("translateBtn").click()`);
  const got = await waitFor(
    `(() => { const t = document.getElementById("out").textContent; return t && !/翻译中/.test(t); })()`,
    40000
  );
  const outText = await evaluate(`document.getElementById("out").textContent.slice(0, 60)`);
  ok(got, "点翻译后出结果（或明确报错）", outText);
  ok(/[一-鿿]/.test(outText) || /失败/.test(outText), "译文是中文或给出可读失败原因", outText);

  /* ---------- 2. 设置页 AI 多账号 ---------- */
  console.log("\n[2] 设置页：AI 多账号");
  await goto("options.html");
  const before = await evaluate(`document.querySelectorAll(".account").length`);
  ok(before >= 1, "默认至少有一个 AI 账号", before);
  await evaluate(`document.querySelector(".add-ai").click()`);
  await sleep(400);
  const after = await evaluate(`document.querySelectorAll(".account").length`);
  ok(after === before + 1, "新增账号按钮能加一个", { before, after });
  await evaluate(`document.querySelectorAll(".account")[1].querySelector(".use").click()`);
  await sleep(400);
  const activeIdx = await evaluate(
    `Array.from(document.querySelectorAll(".account")).findIndex((e) => e.classList.contains("active"))`
  );
  ok(activeIdx === 1, "设为当前后高亮切换", activeIdx);
  const targetOpt = await evaluate(`document.getElementById("targetLang").value`);
  ok(targetOpt === "auto", "目标语言默认自动（中英互译）", targetOpt);

  /* ---------- 2b. 布局对齐（防回归） ---------- */
  console.log("\n[2b] 设置页布局对齐");
  const align = await evaluate(`(() => {
    const rights = (sel) => Array.from(new Set(
      Array.from(document.querySelectorAll(sel)).map((e) => Math.round(e.getBoundingClientRect().right))
    ));
    const card = document.querySelector(".card");
    const cs = getComputedStyle(card);
    const inner = Math.round(card.getBoundingClientRect().right - parseFloat(cs.paddingRight));
    return {
      engineInputs: rights(".engine .cfg > .field input"),
      langFieldWidths: Array.from(document.querySelectorAll(".grid > .field")).map((e) =>
        Math.round(e.getBoundingClientRect().width)
      ),
      lastSelectRight: Math.round(document.getElementById("sourceLang").getBoundingClientRect().right),
      cardInnerRight: inner,
      savePos: getComputedStyle(document.querySelector(".actions")).position,
      testBtns: document.querySelectorAll(".engine .top .btn.test").length,
      engines: document.querySelectorAll(".engine").length,
    };
  })()`);
  ok(align.engineInputs.length === 1, "不同引擎的输入框右边界一致", align.engineInputs);
  ok(
    new Set(align.langFieldWidths).size === 1,
    "语言区两列等宽",
    align.langFieldWidths
  );
  ok(
    Math.abs(align.lastSelectRight - align.cardInnerRight) <= 1,
    "最右侧控件贴齐卡片内边界（不留参差空白）",
    { right: align.lastSelectRight, card: align.cardInnerRight }
  );
  ok(
    align.testBtns === align.engines,
    "每个引擎卡片的「测试」按钮都在头部同一位置",
    { btns: align.testBtns, engines: align.engines }
  );
  ok(align.savePos !== "sticky" && align.savePos !== "fixed", "底部保存条不吸底（不会遮住卡片）", align.savePos);

  await evaluate(`(() => {
    const s = document.getElementById("uiScale");
    s.value = "1.3";
    s.dispatchEvent(new Event("change"));
  })()`);
  await sleep(300);
  const zoomed = await evaluate(`document.documentElement.style.zoom`);
  const zoomLabel = await evaluate(`document.getElementById("uiScale").value`);
  ok(zoomed === "1.3", "界面缩放能立即生效", { zoom: zoomed, select: zoomLabel });
  await evaluate(`(() => {
    const s = document.getElementById("uiScale");
    s.value = "1";
    s.dispatchEvent(new Event("change"));
  })()`);
  await sleep(300);
  ok((await evaluate(`document.documentElement.style.zoom`)) === "", "100% 时不残留 zoom 样式");

  /* ---------- 3. 阅读器中央大框可点击 ---------- */
  console.log("\n[3] 阅读器：中央大框可点击打开 PDF");
  await goto("reader.html");
  const empty = await evaluate(`(() => {
    const e = document.getElementById("empty");
    return { exists: !!e, cursor: e ? getComputedStyle(e).cursor : "", text: e ? e.textContent.slice(0, 20) : "" };
  })()`);
  ok(empty.exists && empty.cursor === "pointer", "中央大框存在且是可点击的手型", empty);
  await evaluate(`document.getElementById("empty").click()`); // 会触发隐藏的 file input
  await sleep(300);
  const fileInput = await evaluate(`!!document.getElementById("file")`);
  ok(fileInput, "点击后走的是本地文件选择（未报错）", fileInput);

  ok(jsErrors.length === 0, "无未捕获异常 / console.error", jsErrors.slice(0, 3));
  return cleanup();
})().catch(async (e) => {
  console.log("  ✗ 运行异常： " + (e && e.message));
  fail++;
  return cleanup();
});

async function cleanup() {
  console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
  try {
    ws && ws.close();
  } catch (_) {}
  try {
    proc && proc.kill();
  } catch (_) {}
  await sleep(500);
  try {
    require("fs").rmSync(PROFILE, { recursive: true, force: true });
  } catch (_) {}
  process.exit(fail ? 1 : 0);
}
