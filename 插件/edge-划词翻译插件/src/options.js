import {
  DEFAULT_SETTINGS,
  LANG_OPTIONS,
  TARGET_OPTIONS,
  ENGINE_KEYS,
  engineLabel,
  DEFAULT_AI_PROMPT,
} from "./lib/engines.js";
import { getSettings, saveSettings } from "./lib/store.js";

const $ = (id) => document.getElementById(id);

let settings = await getSettings();

/* --------------------------- 迁移与初始化 --------------------------- */
function ensureAccounts() {
  if (!Array.isArray(settings.aiProviders)) settings.aiProviders = [];
  if (!settings.aiProviders.length) {
    const old = settings.openai || {};
    settings.aiProviders = [
      {
        id: "default",
        name: "默认账号",
        baseUrl: old.baseUrl || "",
        apiKey: old.apiKey || "",
        model: old.model || "",
        prompt: old.prompt || DEFAULT_AI_PROMPT,
      },
    ];
  }
  if (!settings.activeAiId || !settings.aiProviders.some((p) => p.id === settings.activeAiId)) {
    settings.activeAiId = settings.aiProviders[0].id;
  }
  return settings.aiProviders;
}

function fillLangs() {
  const t = $("targetLang");
  t.innerHTML = TARGET_OPTIONS.map(([v, l]) => `<option value="${v}">${l}</option>`).join("");
  t.value = settings.targetLang || "auto";
  const s = $("sourceLang");
  s.innerHTML =
    `<option value="auto">自动检测</option>` +
    LANG_OPTIONS.map(([v, l]) => `<option value="${v}">${l}</option>`).join("");
  s.value = settings.sourceLang || "auto";
}

/* ------------------------------ 引擎列表 ------------------------------ */
function renderEngines() {
  const box = $("engineList");
  box.innerHTML = "";
  const enabled = new Set(settings.order || []);
  const all = ENGINE_KEYS.concat(
    (settings.order || []).filter((k) => !ENGINE_KEYS.includes(k))
  );
  const list = all.slice().sort((a, b) => {
    const ea = enabled.has(a) ? (settings.order || []).indexOf(a) : 999;
    const eb = enabled.has(b) ? (settings.order || []).indexOf(b) : 999;
    return ea - eb;
  });

  for (const key of list) {
    const on = enabled.has(key);
    const div = document.createElement("div");
    div.className = "engine" + (on ? " enabled" : "");
    div.dataset.key = key;
    div.innerHTML = `
      <div class="top">
        <input type="checkbox" class="en" ${on ? "checked" : ""} />
        <span class="name">${engineLabel(key)}</span>
        <span class="order">
          <button class="btn mini icon up" title="上移">↑</button>
          <button class="btn mini icon down" title="下移">↓</button>
        </span>
        <button class="btn mini test" ${on ? "" : "disabled"}>测试</button>
      </div>
      <div class="cfg${hasConfigFields(key) ? "" : " bare"}">${engineConfigHtml(key)}</div>
      <div class="engine-tools">
        <span class="test-out"></span>
        <span class="grow"></span>
        ${engineToolsHtml(key)}
      </div>
    `;
    box.appendChild(div);
  }

  box.querySelectorAll(".engine").forEach((el) => {
    const key = el.dataset.key;
    el.querySelector(".en").onchange = (e) => {
      const set = new Set(settings.order || []);
      if (e.target.checked) set.add(key);
      else set.delete(key);
      settings.order = ENGINE_KEYS.filter((k) => set.has(k));
      renderEngines();
    };
    el.querySelector(".up").onclick = () => move(key, -1);
    el.querySelector(".down").onclick = () => move(key, 1);
    if (key === "openai") bindAccounts(el);
    const tb = el.querySelector(".btn.test");
    if (tb) tb.onclick = () => runTest(el, key, tb);
  });
}

async function runTest(el, key, tb) {
  collect();
  await saveSettings(settings);
  tb.disabled = true;
  tb.textContent = "测试中…";
  const out = el.querySelector(".test-out");
  out.textContent = "";
  const r = await chrome.runtime.sendMessage({ type: "test-engine", engine: key });
  out.textContent = r && r.ok ? "✓ " + r.message : "✗ " + ((r && r.message) || "失败");
  out.style.color = r && r.ok ? "#1a7f37" : "#b42318";
  tb.disabled = !el.classList.contains("enabled");
  tb.textContent = "测试";
}

function move(key, dir) {
  if (!settings.order.includes(key)) return;
  const arr = settings.order.slice();
  const i = arr.indexOf(key);
  const j = i + dir;
  if (j < 0 || j >= arr.length) return;
  [arr[i], arr[j]] = [arr[j], arr[i]];
  settings.order = arr;
  renderEngines();
}

/* --------------------------- AI 多账号 --------------------------- */
function accountHtml(p, active) {
  return `
    <div class="account ${p.id === active ? "active" : ""}" data-id="${esc(p.id)}">
      <div class="head">
        <span class="nm">${esc(p.name || "未命名")}</span>
        <span class="grow"></span>
        ${p.id === active ? "" : '<button class="btn mini use">设为当前</button>'}
        <button class="btn mini del danger">删除</button>
      </div>
      <div class="rows">
        <div class="field"><label>名称</label><input type="text" class="a-name" value="${esc(p.name)}" placeholder="例如 DeepSeek / 通义" /></div>
        <div class="field"><label>Base URL</label><input type="text" class="a-base" value="${esc(p.baseUrl)}" placeholder="https://api.deepseek.com/v1" /></div>
        <div class="field"><label>API Key</label><input type="password" class="a-key" value="${esc(p.apiKey)}" placeholder="sk-xxxx" /></div>
        <div class="field"><label>模型</label><input type="text" class="a-model" value="${esc(p.model)}" placeholder="deepseek-chat" /></div>
      </div>
    </div>
  `;
}

function renderAccounts(container) {
  container.innerHTML = settings.aiProviders.map((p) => accountHtml(p, settings.activeAiId)).join("");
  container.querySelectorAll(".account").forEach((el) => {
    const id = el.dataset.id;
    const useBtn = el.querySelector(".use");
    if (useBtn) {
      useBtn.onclick = () => {
        collect();
        settings.activeAiId = id;
        renderEngines();
        syncOpenaiFromActive();
      };
    }
    el.querySelector(".del").onclick = () => {
      collect();
      if (settings.aiProviders.length <= 1) {
        alert("至少保留一个账号");
        return;
      }
      settings.aiProviders = settings.aiProviders.filter((p) => p.id !== id);
      if (settings.activeAiId === id) settings.activeAiId = settings.aiProviders[0].id;
      renderEngines();
    };
  });
}

function bindAccounts(engineEl) {
  const container = engineEl.querySelector(".accounts");
  if (!container) return;
  renderAccounts(container);
  const add = engineEl.querySelector(".add-ai");
  if (add) {
    add.onclick = () => {
      collect();
      settings.aiProviders.push({
        id: "ai-" + Date.now().toString(36),
        name: "账号 " + (settings.aiProviders.length + 1),
        baseUrl: "",
        apiKey: "",
        model: "",
        prompt: DEFAULT_AI_PROMPT,
      });
      renderEngines();
    };
  }
}

/** 把当前账号同步回 settings.openai（旧字段），保证其它地方读到的是同一份 */
function syncOpenaiFromActive() {
  const p = settings.aiProviders.find((x) => x.id === settings.activeAiId) || settings.aiProviders[0];
  settings.openai = {
    baseUrl: (p && p.baseUrl) || "",
    apiKey: (p && p.apiKey) || "",
    model: (p && p.model) || "",
    prompt: (p && p.prompt) || DEFAULT_AI_PROMPT,
  };
}

/** 卡片正文：只有字段和说明 */
function engineConfigHtml(key) {
  if (key === "proxy") {
    const c = settings.proxy || {};
    return `
      <div class="field"><label>代理地址</label><input type="text" class="px-url" placeholder="https://your.host/translate" value="${esc(c.url)}" /></div>
      <div class="field"><label>Token</label><input type="password" class="px-token" placeholder="部署代理时生成的 token" value="${esc(c.token)}" /></div>
      <p class="tip">Cloudflare Workers 上跑 <code>worker/index.js</code>，直接用 Workers AI 翻译（不走 Google，不会被限流）。</p>
    `;
  }
  if (key === "google") {
    return `<p class="tip">免费、无需配置。若你的网络无法访问 Google，请启用下面的 AI 接口。</p>`;
  }
  if (key === "openai") {
    return `
      <div class="accounts"></div>
      <p class="tip">可以配多个账号（不同厂商或不同 key），点「设为当前」切换，翻译时只用当前那个。
      Base URL 填到 <code>/v1</code> 即可，例如 <code>https://api.deepseek.com/v1</code>、<code>https://dashscope.aliyuncs.com/compatible-mode/v1</code>。</p>
    `;
  }
  if (key === "youdao") {
    const c = settings.youdao || {};
    return `
      <div class="field"><label>应用ID</label><input type="text" class="yd-key" value="${esc(c.appKey)}" /></div>
      <div class="field"><label>应用密钥</label><input type="password" class="yd-secret" value="${esc(c.appSecret)}" /></div>
    `;
  }
  return "";
}

/** 没有输入项的引擎（如 Google）不画那条分隔虚线，免得空一块 */
function hasConfigFields(key) {
  return key !== "google";
}

/** 卡片底部工具行右侧的按钮 */
function engineToolsHtml(key) {
  if (key === "openai") return `<button class="btn mini add-ai">＋ 新增账号</button>`;
  return "";
}

function esc(s) {
  return String(s || "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[c]);
}

function collect() {
  settings.targetLang = $("targetLang").value;
  settings.sourceLang = $("sourceLang").value;
  settings.autoOnDblclick = $("autoOnDblclick").checked;
  settings.autoOnSelect = $("autoOnSelect").checked;
  settings.popupReadClipboard = $("popupReadClipboard").checked;

  const box = $("engineList");
  box.querySelectorAll(".engine").forEach((el) => {
    const key = el.dataset.key;
    if (key === "proxy") {
      settings.proxy = {
        url: (el.querySelector(".px-url") || {}).value || "",
        token: (el.querySelector(".px-token") || {}).value || "",
      };
    }
    if (key === "youdao") {
      settings.youdao = {
        appKey: (el.querySelector(".yd-key") || {}).value || "",
        appSecret: (el.querySelector(".yd-secret") || {}).value || "",
      };
    }
    if (key === "openai") {
      const list = [];
      el.querySelectorAll(".account").forEach((acc) => {
        list.push({
          id: acc.dataset.id,
          name: (acc.querySelector(".a-name") || {}).value || "",
          baseUrl: (acc.querySelector(".a-base") || {}).value || "",
          apiKey: (acc.querySelector(".a-key") || {}).value || "",
          model: (acc.querySelector(".a-model") || {}).value || "",
          prompt: DEFAULT_AI_PROMPT,
        });
      });
      if (list.length) {
        settings.aiProviders = list;
        if (!list.some((p) => p.id === settings.activeAiId)) settings.activeAiId = list[0].id;
      }
    }
  });
  syncOpenaiFromActive();
}

async function ensureHostPermission(baseUrl) {
  if (!baseUrl) return true;
  try {
    const u = new URL(baseUrl);
    const origin = u.origin + "/*";
    const has = await chrome.permissions.contains({ origins: [origin] });
    if (has) return true;
    return await chrome.permissions.request({ origins: [origin] });
  } catch (_) {
    return false;
  }
}

/** 界面缩放：直接作用在 <html> 上，立即生效并记住 */
function applyScale(v) {
  const n = Number(v) || 1;
  document.documentElement.style.zoom = n === 1 ? "" : String(n);
}
$("uiScale").onchange = async (e) => {
  const v = Number(e.target.value) || 1;
  applyScale(v);
  settings.uiScale = v;
  const s = await getSettings();
  s.uiScale = v;
  await saveSettings(s); // 只写缩放，不动表单里还没保存的改动
};

$("openWindow").onclick = () =>
  chrome.tabs.create({ url: chrome.runtime.getURL("src/window.html") });
$("openReader").onclick = () =>
  chrome.tabs.create({ url: chrome.runtime.getURL("src/reader.html") });

$("save").onclick = async () => {
  collect();
  const btn = $("save");
  btn.disabled = true;
  let granted = await ensureHostPermission(settings.proxy && settings.proxy.url);
  for (const p of settings.aiProviders || []) {
    if (granted) granted = await ensureHostPermission(p.baseUrl);
    else await ensureHostPermission(p.baseUrl);
  }
  await saveSettings(settings);
  const st = $("status");
  if (granted) {
    st.className = "";
    st.textContent = "已保存";
  } else {
    st.className = "err";
    st.textContent = "已保存，但自定义接口域名未获授权，调用可能失败";
  }
  btn.disabled = false;
  setTimeout(() => (st.textContent = ""), 4000);
};

ensureAccounts();
fillLangs();
$("uiScale").value = String(settings.uiScale || 1);
applyScale(settings.uiScale || 1);
$("autoOnDblclick").checked = !!settings.autoOnDblclick;
$("autoOnSelect").checked = !!settings.autoOnSelect;
$("popupReadClipboard").checked = settings.popupReadClipboard !== false;
renderEngines();
