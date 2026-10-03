/*
 * 端到端：单词多义（词典视图）。
 *
 * 用真实的 Edge + 真实扩展 + 真实 http 页面 + **真实有道接口**（18~27ms，不像翻译引擎需要 token）。
 * 覆盖：
 *   [1] 双击单个单词 → 词典视图（n. 表，手表 / v. 看，注视…），而不是走翻译
 *   [2] 选中两个词 → 不是词典视图，照常走翻译链
 *   [3] 词典没收录的词 → 退回翻译链（不能卡在"查询词典…"）
 *   [4] 在 service worker 里直接量 lookupWord 的冷/热耗时（用户要求"确保响应速度"）
 *
 * 为什么要真网络：这一步的"对不对"全在数据上，mock 出来只能证明我自己的假设。
 * 解析层的形状锁定由 tests/test-dict.mjs（离线、用真实抓下来的 fixture）负责。
 */
const { spawn } = require("child_process");
const http = require("http");
const path = require("path");
const os = require("os");
const fs = require("fs");

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const PORT = 9374;
const WEB_PORT = 8796;
const EXT_DIR = path.resolve(__dirname, "..");
const PROFILE = path.join(os.tmpdir(), "st-e2e-dict-" + Date.now());
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>dict test</title></head>
<body style="font:18px/2.4 sans-serif;padding:40px">
<h1>Dictionary test page</h1>
<p id="t">The quick brown fox jumps over the lazy dog.</p>
<p id="w">I watch the light every evening.</p>
<p id="u">asdfghjkl qqqq zzzz</p>
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

function mkConn() {
  const st = { ws: null, id: 0, pending: new Map() };
  st.send = (method, params) =>
    new Promise((res, rej) => {
      const i = ++st.id;
      st.pending.set(i, { res, rej });
      st.ws.send(JSON.stringify({ id: i, method, params: params || {} }));
      setTimeout(() => {
        if (st.pending.has(i)) {
          st.pending.delete(i);
          rej(new Error("CDP 超时 " + method));
        }
      }, 60000);
    });
  st.attach = async (url) => {
    st.ws = new WebSocket(url);
    await new Promise((res, rej) => {
      st.ws.onopen = res;
      st.ws.onerror = rej;
    });
    st.ws.onmessage = (e) => {
      const m = JSON.parse(e.data);
      if (!m.id) return;
      const p = st.pending.get(m.id);
      if (p) {
        st.pending.delete(m.id);
        m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result);
      }
    };
  };
  st.eval = async (expr) => {
    const r = await st.send("Runtime.evaluate", {
      expression: expr,
      awaitPromise: true,
      returnByValue: true,
      userGesture: true,
    });
    if (r.exceptionDetails)
      throw new Error((r.exceptionDetails.exception || {}).description || r.exceptionDetails.text);
    return r.result.value;
  };
  st.close = () => {
    try {
      st.ws && st.ws.close();
    } catch (_) {}
  };
  return st;
}

const listTargets = async () => await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const findSW = async () =>
  (await listTargets()).find(
    (t) => t.type === "service_worker" && String(t.url).includes("/src/background.js")
  );

const server = http.createServer((req, res) => {
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.end(PAGE);
});

let proc;
const page = mkConn();
const sw = mkConn();
const pageLog = [];

/**
 * 关掉可能还开着的浮窗。不关的话，上一步的浮窗可能压住下一步要双击的词，
 * 鼠标落进浮窗后 content.js 的 isPanelEvent() 会直接 return，新浮窗不出现（偶发失败）。
 */
async function closePanel() {
  const key = { key: "Escape", code: "Escape", windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 };
  await page.send("Input.dispatchKeyEvent", Object.assign({ type: "keyDown" }, key)).catch(() => {});
  await page.send("Input.dispatchKeyEvent", Object.assign({ type: "keyUp" }, key)).catch(() => {});
  const left = async () =>
    page.eval(`document.querySelectorAll('[id="__st_panel_host__"]').length`).catch(() => 0);
  if (await left()) {
    await page.send("Input.dispatchMouseEvent", { type: "mousePressed", x: 4, y: 4, button: "left", clickCount: 1 }).catch(() => {});
    await page.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: 4, y: 4, button: "left", clickCount: 1 }).catch(() => {});
  }
  for (let i = 0; i < 25; i++) {
    if (!(await left())) return true;
    await sleep(80);
  }
  return false;
}

/** 双击某个 <p> 里的第 n 个词 */
async function dblclickWord(pId, word) {
  await closePanel();
  const pos = await page.eval(`(() => {
    const node = document.getElementById(${JSON.stringify(pId)}).firstChild;
    const i = node.textContent.indexOf(${JSON.stringify(word)});
    const r = document.createRange();
    r.setStart(node, i); r.setEnd(node, i + ${word.length});
    const b = r.getBoundingClientRect();
    return { x: (b.left + b.right) / 2, y: (b.top + b.bottom) / 2 };
  })()`);
  for (const clickCount of [1, 2]) {
    await page.send("Input.dispatchMouseEvent", { type: "mousePressed", x: pos.x, y: pos.y, button: "left", clickCount });
    await page.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: pos.x, y: pos.y, button: "left", clickCount });
    await sleep(60);
  }
}

/** 直接设选区再派发 dblclick —— 用来模拟"选中两个词"，点两次鼠标只会选中一个词 */
async function dblclickRange(pId, from, to) {
  return page.eval(`(() => {
    const node = document.getElementById(${JSON.stringify(pId)}).firstChild;
    const r = document.createRange();
    r.setStart(node, ${from}); r.setEnd(node, ${to});
    const s = getSelection(); s.removeAllRanges(); s.addRange(r);
    document.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    return String(s);
  })()`);
}

/** 等浮窗标题匹配，再读内容 */
async function readPanel(match, timeout = 12000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    const p = await page
      .eval(`(() => {
        const hs = document.querySelectorAll('[id="__st_panel_host__"]');
        const h = hs[hs.length - 1];
        if (!h || !h.shadowRoot) return null;
        const q = (s) => { const e = h.shadowRoot.querySelector(s); return e ? e.textContent.trim() : ""; };
        const rows = [...h.shadowRoot.querySelectorAll(".dict-row")].map((r) => ({
          pos: (r.querySelector(".pos") || {}).textContent?.trim() ?? "",
          defs: (r.querySelector(".defs") || {}).textContent?.trim() ?? "",
        }));
        return {
          title: q(".title"), out: q(".out"), err: q(".err"), meta: q(".meta"),
          word: q(".dict-head .word"), ph: q(".dict-head .ph"),
          rows, nRows: rows.length,
        };
      })()`)
      .catch(() => null);
    if (p && match(p)) return p;
    await sleep(150);
  }
  return null;
}

(async () => {
  await new Promise((r) => server.listen(WEB_PORT, "127.0.0.1", r));

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

  let sw0 = null;
  for (let i = 0; i < 120 && !sw0; i++) {
    await sleep(300);
    sw0 = await findSW().catch(() => null);
  }
  ok(!!sw0, "扩展加载成功", sw0 && sw0.url);
  if (!sw0) return;

  const t = (await listTargets()).find((x) => x.type === "page" && x.url === "about:blank") ||
    (await listTargets()).find((x) => x.type === "page");
  await page.attach(t.webSocketDebuggerUrl);
  await page.send("Runtime.enable");
  await page.send("Page.enable");
  page.ws.addEventListener("message", (e) => {
    const m = JSON.parse(e.data);
    if (m.method === "Runtime.exceptionThrown")
      pageLog.push((m.params.exceptionDetails.exception || {}).description || m.params.exceptionDetails.text);
  });
  await page.send("Page.navigate", { url: "http://127.0.0.1:" + WEB_PORT + "/" });
  for (let i = 0; i < 60; i++) {
    if (await page.eval('document.readyState === "complete" && !!document.getElementById("t")').catch(() => false)) break;
    await sleep(200);
  }
  await sleep(900);

  console.log("\n[1] 双击单个单词 watch → 词典视图（多义）");
  await dblclickWord("w", "watch");
  let p = await readPanel((x) => /^watch$/i.test(x.title) && (x.nRows > 0 || x.err || x.out));
  ok(!!p, "浮窗出现且标题是 watch", p && p.title);
  ok(!!p && p.nRows >= 2, "渲染出词性分组（多义）", p && p.rows);
  ok(!!p && p.rows.some((r) => r.pos === "n." && /表/.test(r.defs)), "名词义里有「表」", p && p.rows);
  ok(!!p && p.rows.some((r) => r.pos === "v." && /看|注视/.test(r.defs)), "动词义里有「看/注视」", p && p.rows);
  ok(!!p && /wɑːtʃ/.test(p.ph), "显示音标", p && p.ph);
  ok(!!p && /有道词典/.test(p.meta), "状态栏标注词典来源", p && p.meta);
  ok(!!p && !p.out && !p.err, "没有走翻译链（没有译文/报错区）", p && { out: p.out, err: p.err, meta: p.meta });

  // 留一张实际截图：既是交付证据，也是以后改 UI 的视觉参照
  const wrapRect = await page.eval(`(() => {
    const h = [...document.querySelectorAll('[id="__st_panel_host__"]')].pop();
    const w = h && h.shadowRoot && h.shadowRoot.querySelector(".wrap");
    if (!w) return null;
    const r = w.getBoundingClientRect();
    return { x: Math.round(r.left), y: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height) };
  })()`);
  if (wrapRect) {
    const shot = await page.send("Page.captureScreenshot", {
      format: "png",
      clip: Object.assign({ scale: 2 }, wrapRect), // 2x 方便看细节
    });
    fs.writeFileSync(path.join(__dirname, "shot-dict.png"), Buffer.from(shot.data, "base64"));
    console.log("  [截图] 词典视图已存 tests/shot-dict.png");
  }

  console.log("\n[2] 选中两个词 quick brown → 不是词典视图，照常走翻译链");
  const sel = await dblclickRange("t", 4, 15);
  ok(sel === "quick brown", "选区是两个词", sel);
  p = await readPanel((x) => /quick brown/.test(x.title) && (x.out || x.err));
  ok(!!p, "浮窗出现", p && p.title);
  ok(!!p && p.nRows === 0, "没有渲染成词典视图", p && p.rows);
  ok(!!p && !!(p.out || p.err), "走的是翻译链（本环境无引擎 → 明确的错误提示）", p && (p.out || p.err).slice(0, 80));

  console.log("\n[3] 词库没有的词 asdfghjkl → 退回翻译链，不能卡在「查询词典…」");
  await dblclickWord("u", "asdfghjkl");
  p = await readPanel((x) => /asdfghjkl/.test(x.title) && (x.out || x.err || x.nRows));
  ok(!!p, "浮窗出现", p && p.title);
  ok(!!p && !/查询词典/.test(p.title + p.meta), "没有卡在加载态", p && p.meta);
  ok(!!p && p.nRows === 0 && !!(p.out || p.err), "词典未命中 → 落回翻译链", p && { rows: p.nRows, out: !!p.out, err: !!p.err });

  console.log("\n[4] 端到端延迟：双击 → 词典渲染完成（用户真正感知的那段）");
  // 注：想在 SW 里 import() 直接量 lookupWord 是不行的 ——
  // "import() is disallowed on ServiceWorkerGlobalScope by the HTML specification"（实测）。
  // 所以从页面侧打点：t0 = 派发双击前，终点 = 浮窗里出现 .dict-row。
  const timeDict = async (pId, word) => {
    // 先让旧浮窗退场（点空白处 → panel 的全局 mousedown 会关掉它），否则会读到上一个浮窗
    await page.eval(`(() => { document.dispatchEvent(new MouseEvent("mousedown", { bubbles: true })); return 1; })()`);
    for (let i = 0; i < 40; i++) {
      const n = await page.eval(`document.querySelectorAll('[id="__st_panel_host__"]').length`);
      if (n === 0) break;
      await sleep(50);
    }
    const pos = await page.eval(`(() => {
      const node = document.getElementById(${JSON.stringify(pId)}).firstChild;
      const i = node.textContent.indexOf(${JSON.stringify(word)});
      const r = document.createRange();
      r.setStart(node, i); r.setEnd(node, i + ${word.length});
      const b = r.getBoundingClientRect();
      return { x: (b.left + b.right) / 2, y: (b.top + b.bottom) / 2 };
    })()`);
    // 第 1 下点完再打点：t0 必须紧贴真正触发 dblclick 的那次按下，
    // 否则把测试自己 60ms 的间隔也算进去了（冷/热会看不出差别）
    await page.send("Input.dispatchMouseEvent", { type: "mousePressed", x: pos.x, y: pos.y, button: "left", clickCount: 1 });
    await page.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: pos.x, y: pos.y, button: "left", clickCount: 1 });
    await sleep(60);
    await page.eval("window.__st_t0 = performance.now()");
    await page.send("Input.dispatchMouseEvent", { type: "mousePressed", x: pos.x, y: pos.y, button: "left", clickCount: 2 });
    await page.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: pos.x, y: pos.y, button: "left", clickCount: 2 });
    return page.eval(`(async () => {
      const t0 = window.__st_t0;
      for (let i = 0; i < 500; i++) {
        const hs = document.querySelectorAll('[id="__st_panel_host__"]');
        const h = hs[hs.length - 1];
        if (h && h.shadowRoot && h.shadowRoot.querySelector(".dict-row"))
          return Math.round(performance.now() - t0);
        await new Promise((r) => setTimeout(r, 10));
      }
      return -1;
    })()`);
  };

  const cold = await timeDict("t", "jumps"); // 这个页面段落里 jumps 还没被查过 → 真打网络
  const warm = await timeDict("t", "jumps"); // 同一词 → 命中 background 里的缓存
  console.log("  [耗时] 首次（含 DNS/TLS 建连 + SW 冷启动）" + cold + "ms / 缓存命中 " + warm + "ms");
  // 首次实测 266ms~1051ms：新建连（DNS+TLS）本身就要几十~上千 ms，别把阈值卡死
  ok(cold > 0 && cold < 2500, "首次词典查询 < 2.5s（含建连与 SW 冷启动）", cold);
  ok(warm > 0 && warm < 300, "缓存命中后 < 300ms（实测 5~7ms）", warm);

  console.log("\n[5] 右键菜单那条路（background 查好词典 → show-translation）也要出词典视图");
  await sw.attach(sw0.webSocketDebuggerUrl);
  await sw.send("Runtime.enable");
  const sent = await sw
    .eval(`(async () => {
      // 右键菜单点不了（chrome.contextMenus.onClicked 无法程序触发），
      // 但可以照原样发 deliverToTab 那条消息：消息体形状与 background 里组装的一致。
      const msg = {
        type: "show-translation",
        text: "light",
        result: {
          ok: true, engine: "dict", engineLabel: "有道词典",
          translation: "light /laɪt/\\nn. 光，光线\\nv. 照亮",
          dict: { phonetic: "laɪt", entries: [{ pos: "n.", defs: ["光，光线"] }, { pos: "v.", defs: ["照亮"] }] },
        },
      };
      const tabs = await chrome.tabs.query({});
      let n = 0;
      for (const t of tabs) {
        try { await chrome.tabs.sendMessage(t.id, msg); n++; } catch (_) {}
      }
      return n ? "sent:" + n : "none";
    })()`)
    .catch((e) => "err: " + e.message);
  ok(/^sent:/.test(String(sent)), "从 background 发出带词典结果的 show-translation", sent);
  p = await readPanel((x) => /^light$/i.test(x.title) && (x.nRows > 0 || x.err || x.out));
  ok(!!p && p.nRows === 2, "浮窗把 result.dict 画成词典视图（2 个词性）", p && p.rows);
  ok(!!p && p.rows.some((r) => r.pos === "n." && /光/.test(r.defs)), "词性/义项内容正确", p && p.rows);
  ok(!!p && /有道词典/.test(p.meta), "来源标注词典", p && p.meta);

  const unexpected = pageLog.filter((x) => !/context invalidated/i.test(x));
  ok(unexpected.length === 0, "页面无未捕获异常", unexpected.slice(0, 2));

  console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
})()
  .catch((e) => console.log("失败： " + ((e && e.stack) || e)))
  .finally(async () => {
    page.close();
    sw.close();
    try {
      proc && proc.kill();
    } catch (_) {}
    try {
      server.close();
    } catch (_) {}
    await sleep(500);
    try {
      fs.rmSync(PROFILE, { recursive: true, force: true });
    } catch (_) {}
    process.exit(fail ? 1 : 0);
  });
