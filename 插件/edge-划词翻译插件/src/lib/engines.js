/**
 * 翻译引擎集合（运行在 background service worker 中）
 * 支持：Google 免费接口 / OpenAI 兼容接口 / 有道智云
 */

const DEFAULT_AI_PROMPT =
  "You are a professional translation engine. Translate the user's text into Simplified Chinese. Rules: 1) Output the translation ONLY, no explanation, no quotes. 2) Preserve line breaks, bullet points and formatting. 3) If the text is already Chinese, translate it into fluent English. 4) Keep proper nouns, code, numbers and units unchanged.";

export const DEFAULT_SETTINGS = {
  // auto = 中英互译：原文是中文就译成英文，否则译成简体中文
  targetLang: "auto",
  sourceLang: "auto",
  // 回退顺序：前面的失败就自动尝试下一个。
  // 自建代理放最前：它走你的 Workers AI，不用直连 Google（本机直连不通、CF 出口还被限流）。
  order: ["proxy", "openai", "google", "youdao"],
  autoOnDblclick: true, // 双击选中后自动翻译
  autoOnSelect: false, // 松开鼠标选中后自动翻译
  popupReadClipboard: true, // 打开弹窗时自动读取剪贴板（Edge 内置 PDF 阅读器的兜底方案）
  showOriginal: true,
  uiScale: 1, // 设置页界面缩放（1 / 1.15 / 1.3 / 1.5）
  // 自建的翻译代理（Cloudflare Workers，免费；怎么部署见 README 第七节）
  proxy: {
    // 填你自己的代理地址，例如 https://your-worker.example.com/translate（留空则跳过该引擎）
    url: "",
    token: "",
  },
  openai: {
    baseUrl: "", // 例如 https://api.deepseek.com/v1
    apiKey: "",
    model: "", // 例如 deepseek-chat
    prompt: DEFAULT_AI_PROMPT,
  },
  // AI 接口可以配多个账号（不同厂商/不同 key），在这里存，用户在设置页切换
  aiProviders: [],
  activeAiId: "",
  youdao: {
    appKey: "",
    appSecret: "",
  },
};

export const TARGET_AUTO = "auto";

export const LANG_NAME = {
  "zh-CN": "Simplified Chinese",
  "zh-TW": "Traditional Chinese",
  en: "English",
  ja: "Japanese",
  ko: "Korean",
  fr: "French",
  de: "German",
  es: "Spanish",
  ru: "Russian",
  pt: "Portuguese",
  it: "Italian",
  ar: "Arabic",
  th: "Thai",
  vi: "Vietnamese",
  id: "Indonesian",
};

export const LANG_OPTIONS = [
  ["zh-CN", "简体中文"],
  ["zh-TW", "繁体中文"],
  ["en", "英语"],
  ["ja", "日语"],
  ["ko", "韩语"],
  ["fr", "法语"],
  ["de", "德语"],
  ["es", "西班牙语"],
  ["ru", "俄语"],
  ["pt", "葡萄牙语"],
  ["it", "意大利语"],
  ["ar", "阿拉伯语"],
  ["th", "泰语"],
  ["vi", "越南语"],
  ["id", "印尼语"],
];

/** 目标语言下拉里的第一项：中英互译 */
export const TARGET_OPTIONS = [["auto", "自动（中英互译）"]].concat(LANG_OPTIONS);

export function langLabel(code) {
  const hit = LANG_OPTIONS.find(([v]) => v === code);
  return hit ? hit[1] : code;
}

/**
 * 粗略判断原文语种：只看文字本身，够用来决定"中→英"还是"英→中"。
 * 拉丁字母系（英/法/德…）统一当成 en 一侧，具体语种交给引擎检测。
 */
export function detectScript(text) {
  const s = String(text || "");
  if (!s) return null;
  if (/[぀-ヿ]/.test(s)) return "ja";
  const cjk = (s.match(/[㐀-䶿一-鿿]/g) || []).length;
  const letters = (s.replace(/\s/g, "").length) || 1;
  if (cjk / letters > 0.2) return "zh";
  if (/[a-zA-Z]/.test(s) && cjk === 0) return "en";
  return null;
}

/** targetLang=auto 时按原文语种决定目标：中文 → 英文，其余 → 简体中文 */
export function resolveTargetLang(text, settings) {
  const t = (settings && settings.targetLang) || "zh-CN";
  if (t !== TARGET_AUTO) return t;
  const src = detectScript(text);
  if (src === "zh" || src === "ja" || src === "ko") return "en";
  return "zh-CN";
}

/* ---------------------- AI 接口多账号 ---------------------- */
/** 账号列表；旧版本只有单个 openai 配置时自动包装成一个 */
export function aiProfiles(settings) {
  const list = (settings && Array.isArray(settings.aiProviders) ? settings.aiProviders : []).filter(
    (p) => p && typeof p === "object"
  );
  if (list.length) return list;
  const old = (settings && settings.openai) || {};
  if (old.baseUrl || old.apiKey || old.model) {
    return [
      {
        id: "default",
        name: "默认",
        baseUrl: old.baseUrl || "",
        apiKey: old.apiKey || "",
        model: old.model || "",
        prompt: old.prompt || DEFAULT_AI_PROMPT,
      },
    ];
  }
  return [];
}

/** 当前生效的账号：按 activeAiId 找，找不到就用第一个 */
export function activeAi(settings) {
  const list = aiProfiles(settings);
  if (!list.length) return null;
  const id = settings && settings.activeAiId;
  return list.find((p) => p.id === id) || list[0];
}

export { DEFAULT_AI_PROMPT };

const GOOGLE_MAX = 1500;
const TIMEOUT_GOOGLE = 8000;
const TIMEOUT_AI = 30000;
const TIMEOUT_YOUDAO = 10000;
const TIMEOUT_PROXY = 25000; // Workers AI 冷启动 + 回退链可能到十几秒，留足
const PROXY_MAX = 4000; // 服务端上限 4000，别超

/** 带超时的 fetch —— 网络不通时快速失败，才能及时回退到下一个引擎 */
async function fetchWithTimeout(url, opts, ms) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), ms);
  try {
    return await fetch(url, Object.assign({}, opts, { signal: ctl.signal }));
  } catch (e) {
    if (ctl.signal.aborted) throw new Error("请求超时（" + Math.round(ms / 1000) + "s 无响应）");
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

function splitText(text, max) {
  const out = [];
  let buf = "";
  for (const line of text.split("\n")) {
    if (buf.length + line.length + 1 > max && buf) {
      out.push(buf);
      buf = line;
    } else {
      buf = buf ? buf + "\n" + line : line;
    }
    if (buf.length > max) {
      // 超长单行，硬切
      while (buf.length > max) {
        out.push(buf.slice(0, max));
        buf = buf.slice(max);
      }
    }
  }
  if (buf) out.push(buf);
  return out.length ? out : [text];
}

/* ------------------------- 自建代理（Workers AI） ------------------------- */
async function translateProxy(text, settings) {
  const cfg = settings.proxy || {};
  if (!cfg.url) throw new Error("未配置翻译代理地址");
  if (!cfg.token) throw new Error("未配置翻译代理 token");
  const chunks = splitText(text, PROXY_MAX);
  const parts = [];
  let detected = "";
  let upstream = "";
  for (const chunk of chunks) {
    const res = await fetchWithTimeout(
      cfg.url,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          q: chunk,
          sl: settings.sourceLang || "auto",
          tl: settings.targetLang || "zh-CN",
          token: cfg.token,
        }),
      },
      TIMEOUT_PROXY
    );
    let data = null;
    try {
      data = await res.json();
    } catch (_) {
      throw new Error("代理返回非 JSON 内容（HTTP " + res.status + "）");
    }
    if (!res.ok || !data || data.ok !== true) {
      throw new Error((data && data.error) || "代理 HTTP " + res.status);
    }
    parts.push(data.translation || "");
    if (!detected) detected = data.detected || "";
    if (!upstream) upstream = data.engine || ""; // 服务端实际用的模型（qwen3-30b / m2m100 ...）
  }
  return { translation: parts.join("\n"), detected, upstream };
}

/* ---------------------- 自建代理 · 截屏 OCR ---------------------- */
const TIMEOUT_OCR = 45000; // 视觉模型 + 冷启动都慢，OCR 比翻译放宽

/** 把截图发给自建代理的 /ocr 端点识别文字。代理地址复用 settings.proxy（去掉 /translate 拼 /ocr） */
export async function ocrViaProxy(imageDataUrl, settings) {
  const cfg = settings.proxy || {};
  if (!cfg.url) throw new Error("未配置翻译代理地址（截屏翻译依赖自建代理）");
  if (!cfg.token) throw new Error("未配置翻译代理 token");
  const base = cfg.url.trim().replace(/\/translate\/?$/, "");
  const res = await fetchWithTimeout(
    base + "/ocr",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ image: imageDataUrl, token: cfg.token }),
    },
    TIMEOUT_OCR
  );
  let data = null;
  try {
    data = await res.json();
  } catch (_) {
    throw new Error("代理返回非 JSON 内容（HTTP " + res.status + "）");
  }
  if (!res.ok || !data || data.ok !== true) {
    throw new Error((data && data.error) || "代理 HTTP " + res.status);
  }
  return { text: data.text || "", engine: data.engine || "" };
}

/* ------------------------------ Google ------------------------------ */
async function translateGoogle(text, settings) {
  const tl = settings.targetLang || "zh-CN";
  const sl = settings.sourceLang || "auto";
  const chunks = splitText(text, GOOGLE_MAX);
  const parts = [];
  let detected = "";
  for (const chunk of chunks) {
    const url =
      "https://translate.googleapis.com/translate_a/single?client=gtx&sl=" +
      encodeURIComponent(sl) +
      "&tl=" +
      encodeURIComponent(tl) +
      "&dt=t&q=" +
      encodeURIComponent(chunk);
    const res = await fetchWithTimeout(url, { method: "GET" }, TIMEOUT_GOOGLE);
    if (!res.ok) throw new Error("Google HTTP " + res.status);
    const data = await res.json();
    // 正常格式：data[0] = [[译文, 原文, ...], ...]，严格只取数组段，避免格式变化时拼出乱码
    if (!Array.isArray(data) || !Array.isArray(data[0])) {
      throw new Error("Google 返回格式异常");
    }
    const segs = data[0].filter((seg) => Array.isArray(seg) && typeof seg[0] === "string");
    if (!segs.length) throw new Error("Google 返回格式异常");
    parts.push(segs.map((seg) => seg[0]).join(""));
    if (!detected) detected = data[2] || "";
  }
  return { translation: parts.join("\n"), detected };
}

/* --------------------------- OpenAI 兼容 --------------------------- */
async function translateOpenAI(text, settings) {
  const cfg = settings.openai || {};
  if (!cfg.baseUrl || !cfg.apiKey || !cfg.model) {
    throw new Error("未配置 OpenAI 兼容接口");
  }
  let base = cfg.baseUrl.trim().replace(/\/+$/, "");
  if (!/\/chat\/completions$/.test(base)) {
    base += "/chat/completions";
  }
  const targetName = LANG_NAME[settings.targetLang] || settings.targetLang;
  const systemPrompt = (cfg.prompt || DEFAULT_SETTINGS.openai.prompt).replace(
    "Simplified Chinese",
    targetName
  );
  const res = await fetchWithTimeout(base, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer " + cfg.apiKey,
    },
    body: JSON.stringify({
      model: cfg.model,
      temperature: 0.2,
      stream: false,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: text },
      ],
    }),
  }, TIMEOUT_AI);
  if (!res.ok) {
    let detail = "";
    try {
      const j = await res.json();
      detail = (j.error && (j.error.message || j.error.code)) || "";
    } catch (_) {}
    throw new Error("AI HTTP " + res.status + (detail ? " · " + detail : ""));
  }
  const data = await res.json();
  const out =
    (data.choices && data.choices[0] && data.choices[0].message &&
      data.choices[0].message.content) ||
    (data.choices && data.choices[0] && data.choices[0].text) ||
    "";
  if (!out) throw new Error("AI 接口返回空内容");
  return { translation: String(out).trim(), detected: "" };
}

/* ------------------------------ 有道 ------------------------------ */
async function sha256(str) {
  const buf = new TextEncoder().encode(str);
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function youdaoLang(code) {
  if (code === "zh-CN") return "zh-CHS";
  if (code === "zh-TW") return "zh-CHT";
  return code === "auto" ? "auto" : code;
}

async function translateYoudao(text, settings) {
  const cfg = settings.youdao || {};
  if (!cfg.appKey || !cfg.appSecret) throw new Error("未配置有道智云密钥");
  const q = text.length > 5000 ? text.slice(0, 5000) : text;
  const salt = crypto.randomUUID();
  const curtime = Math.round(Date.now() / 1000).toString();
  const input =
    q.length <= 20 ? q : q.slice(0, 10) + q.length + q.slice(q.length - 10);
  const sign = await sha256(cfg.appKey + input + salt + curtime + cfg.appSecret);
  const body = new URLSearchParams({
    q,
    from: youdaoLang(settings.sourceLang || "auto"),
    to: youdaoLang(settings.targetLang || "zh-CN"),
    appKey: cfg.appKey,
    salt,
    sign,
    signType: "v3",
    curtime,
  });
  const res = await fetchWithTimeout(
    "https://openapi.youdao.com/api",
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    },
    TIMEOUT_YOUDAO
  );
  if (!res.ok) throw new Error("有道 HTTP " + res.status);
  const data = await res.json();
  if (data.errorCode && data.errorCode !== "0") {
    throw new Error("有道错误码 " + data.errorCode);
  }
  const translation = (data.translation || []).join("\n");
  if (!translation) throw new Error("有道返回空内容");
  return { translation, detected: data.l ? data.l.split("2")[0] : "" };
}

const ENGINES = {
  proxy: { label: "自建代理（Workers AI）", fn: translateProxy },
  google: { label: "Google 翻译（直连）", fn: translateGoogle },
  openai: { label: "AI 接口（OpenAI 兼容）", fn: translateOpenAI },
  youdao: { label: "有道智云", fn: translateYoudao },
};

export const ENGINE_KEYS = Object.keys(ENGINES);

export function engineLabel(key) {
  return (ENGINES[key] && ENGINES[key].label) || key;
}

/**
 * 按配置顺序依次尝试，第一个成功的即为结果
 * @returns {{ok:boolean, translation?:string, detected?:string, engine?:string, errors?:string[]}}
 */
export async function translate(text, settings) {
  const clean = String(text || "").trim();
  if (!clean) return { ok: false, errors: ["文本为空"] };
  if (clean.length > 8000) {
    return { ok: false, errors: ["文本过长（上限 8000 字符）"] };
  }
  const target = resolveTargetLang(clean, settings);
  const prof = activeAi(settings);
  // 各引擎只读 settings.targetLang / settings.openai，这里算好一次再透传
  const s = Object.assign({}, settings, { targetLang: target });
  if (prof) {
    s.openai = {
      baseUrl: prof.baseUrl || "",
      apiKey: prof.apiKey || "",
      model: prof.model || "",
      prompt: prof.prompt || DEFAULT_AI_PROMPT,
    };
  }
  const order = (settings.order && settings.order.length
    ? settings.order
    : DEFAULT_SETTINGS.order
  ).filter((k) => ENGINES[k]);
  const errors = [];
  for (const key of order) {
    try {
      const r = await ENGINES[key].fn(clean, s);
      if (r && r.translation) {
        return {
          ok: true,
          translation: r.translation,
          detected: r.detected || "",
          engine: key,
          upstream: r.upstream || "",
          target,
          account: prof && prof.name ? prof.name : "",
        };
      }
      errors.push(engineLabel(key) + "：返回空");
    } catch (e) {
      errors.push(engineLabel(key) + "：" + (e && e.message ? e.message : e));
    }
  }
  return { ok: false, errors, target };
}

/** 只测单个引擎，用于设置页的“测试连接” */
export async function testEngine(key, settings) {
  const text = resolveTargetLang("Hello, world", settings) === "en" ? "你好，世界" : "Hello, world";
  const target = resolveTargetLang(text, settings);
  const prof = activeAi(settings);
  const s = Object.assign({}, settings, { targetLang: target });
  if (prof) {
    s.openai = {
      baseUrl: prof.baseUrl || "",
      apiKey: prof.apiKey || "",
      model: prof.model || "",
      prompt: prof.prompt || DEFAULT_AI_PROMPT,
    };
  }
  try {
    const r = await ENGINES[key].fn(text, s);
    return { ok: !!r.translation, message: r.translation || "返回空" };
  } catch (e) {
    return { ok: false, message: (e && e.message) || String(e) };
  }
}
