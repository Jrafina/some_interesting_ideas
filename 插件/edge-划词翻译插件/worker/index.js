/**
 * 划词翻译 · 翻译代理（Cloudflare Workers AI 版）
 *
 * 不再走 Google 的免费端点：Cloudflare 的出口 IP 常被 429，不可靠。
 * 直接用 Workers AI 自己翻译。
 *
 * 协议与之前一致，插件侧只认这个：
 *   POST /translate  { q, sl, tl, token }
 *   → { ok:true, translation, detected, engine }   或   { ok:false, error }
 *
 * 截屏翻译（OCR）：
 *   POST /ocr  { image: dataURI(png/jpeg), token }
 *   → { ok:true, text, engine }   或   { ok:false, error }
 *   主模型 @cf/qwen/qwen3.8-27b（vision，中英混排最准），回退 @cf/meta/llama-4-scout-17b。
 *   想换：Variables 里加 AI_OCR_MODEL。横向对比：POST /debug?ocr=1&compare=1 + body{image}
 *
 * 默认模型 @cf/qwen/qwen3-30b-a3b-fp8：Qwen3 的 30B MoE（只激活 3B），
 * neuron 单价和 3B 小模型持平，但中英质量高一个量级。
 * 免费额度 1 万 neuron/天 ≈ 每天几千次划词（见 README 的测算）。
 *
 * 想换模型：在 Worker 的 Settings → Variables 里加 AI_MODEL，
 * 值填 Workers AI 的模型 ID，例如 @cf/meta/llama-3.1-8b-instruct-fp8-fast
 * 想横向对比质量：GET /debug?token=xxx&compare=1
 */

const JSON_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "X-Content-Type-Options": "nosniff",
};

const MAX_CHARS = 4000;
const HARD_MAX_TOKENS = 2048;
// 截屏图片（base64 data URI）长度上限，约 6.5MB 二进制
const MAX_IMAGE_CHARS = 9_000_000;

// 主模型 → 依次回退。前三个是通用 LLM（走 messages），最后一个是专用翻译模型（走 text）
const AI_MODELS = [
  { id: "@cf/qwen/qwen3-30b-a3b-fp8", kind: "llm", label: "qwen3-30b" },
  { id: "@cf/meta/llama-3.1-8b-instruct-fp8-fast", kind: "llm", label: "llama31-8b-fast" },
  { id: "@cf/meta/llama-3.2-3b-instruct", kind: "llm", label: "llama32-3b" },
  { id: "@cf/meta/m2m100-1.2b", kind: "m2m", label: "m2m100" },
];

/* ---------------------- 截屏 OCR（/ocr 端点用） ---------------------- */
// 实测筛选过的两个视觉模型（都用 messages + image_url，返回都在 choices[0].message.content）：
//  - qwen3.8-27b：中英混排截图逐字准，主引擎。关掉思考块后 2.8s / 44.8 neuron
//  - llama-4-scout：2.2s / 34.2 neuron，稍便宜，兜底
// 想换主 OCR 模型：Worker Settings → Variables 加 AI_OCR_MODEL
//
// ⚠️ 踩过的坑，别再换回去：
//  - moondream3.1-9B-A2B：文档齐全，但实测对本机账号恒返回 `{}`（success:true + result 空），
//    换小图 / 换公网 URL / 换 task 都一样 → 会让用户永远看到"没识别到文字"。
//  - llava-1.5-7b：会擅自"翻译"而不是转写（返回 description 字段）。
//  - llama-3.2-11b-vision：需要先在控制台提交 'agree' 同意 Meta 协议，否则 403。
//  - glm-5.3-flash / gemma-4-26b：前者免费版不可用；后者能跑但 11.8s、推理 token 太浪费。
const OCR_MODELS = [
  { id: "@cf/qwen/qwen3.8-27b", kind: "chat", label: "qwen3.8-27b" },
  { id: "@cf/meta/llama-4-scout-17b-16e-instruct", kind: "chat", label: "llama4-scout" },
];

const OCR_PROMPT = [
  "You are an OCR engine. Extract ALL text visible in this screenshot.",
  "Rules:",
  "1. Output the extracted text ONLY — no commentary, no markdown fences, no quotes.",
  "2. Preserve the original reading order and line breaks.",
  "3. Reproduce the text exactly as written, in its original language. Do NOT translate.",
  "4. Keep punctuation exactly as it appears. Do NOT rewrite full-width CJK punctuation",
  "   (，。：；！？、「」) into half-width ASCII, and do not do the reverse either.",
  "5. Ignore icons, scrollbars and UI noise that are not text.",
  "6. If there is no readable text, output nothing.",
].join("\n");

const LANG_NAME = {
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
  hi: "Hindi",
  th: "Thai",
  vi: "Vietnamese",
  id: "Indonesian",
};

// m2m100 用的是小写英文名
const M2M_LANG = {
  "zh-CN": "chinese",
  "zh-TW": "chinese",
  en: "english",
  ja: "japanese",
  ko: "korean",
  fr: "french",
  de: "german",
  es: "spanish",
  ru: "russian",
  pt: "portuguese",
  it: "italian",
  ar: "arabic",
  hi: "hindi",
  th: "thai",
  vi: "vietnamese",
  id: "indonesian",
};

function json(status, obj) {
  return new Response(JSON.stringify(obj), { status, headers: JSON_HEADERS });
}

function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function langName(code, table) {
  // 表里没有就原样用 code，别偷偷回退到 English（会让小语种请求翻错方向）
  return (table && table[code]) || code;
}

function buildPrompt(target) {
  return [
    "You are a translation engine.",
    `Translate the user's text into ${target}.`,
    "Rules:",
    "1. Output the translation ONLY. No notes, no explanations, no quotation marks around it, no <think> tags.",
    "2. Preserve line breaks, list markers and formatting.",
    "3. Keep proper nouns, code identifiers, numbers, units and formulas exactly as they are.",
    `4. If the text is already in ${target} or is empty of translatable content, echo it back unchanged.`,
  ].join("\n");
}

/**
 * 输入字符数 → 输出上限。
 * 预算必须给足：Qwen3 这类推理模型会先吐一长串 <think>，预算不够的话
 * 译文根本轮不到输出就被截断（实测 253 token 时 5 次里 4 次空手而归）。
 */
function maxTokensFor(q) {
  return Math.min(HARD_MAX_TOKENS, Math.max(512, Math.ceil(q.length * 2) + 768));
}

/** 去掉模型偶尔加的“译文：”前缀或外层引号 */
function clean(text) {
  let t = String(text || "").trim();
  // Qwen3 这类推理模型有时会把 <think>…</think> 一起吐出来，整段剥掉（含没闭合的情况）
  if (/<think>/i.test(t)) t = t.replace(/<think>[\s\S]*?(<\/think>|$)/gi, "").trim();
  t = t.replace(/\n?\s*<arg_key:6124c78e>\s*$/i, "").trim(); // 模型偶尔把软开关回显出来
  t = t.replace(/^(译文|翻译|Translation)\s*[:：]\s*/i, "");
  if (t.length > 1 && ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("“") && t.endsWith("”")))) {
    const inner = t.slice(1, -1);
    if (!inner.includes('"') && !inner.includes("“")) t = inner;
  }
  return t.trim();
}

/**
 * 从模型返回里抠出文本。**不同模型的返回形状完全不一样，别只认一个字段名**——
 * 之前就是写死 out.response / out.result，结果 qwen3.8（返回 choices[].message.content）
 * 和 moondream（返回 answer）全都解析成空串，表现为"永远识别不到文字"。
 *
 * 实测遇到过的形状：
 *   { choices: [ { message: { content } } ] }   ← qwen3.8 / llama-4-scout / gemma（OpenAI 风格）
 *   { response }                                ← 老式 text-generation（qwen3-30b / llama-3.x），
 *                                                  llama-4-scout 也同时带这个字段
 *   { answer }                                  ← moondream 的 query 任务
 *   { translated_text }                         ← m2m100
 *   { description }                             ← llava
 */
function pickText(out) {
  if (out == null) return "";
  if (typeof out === "string") return out;
  const choice = Array.isArray(out.choices) ? out.choices[0] : null;
  const msg = choice && (choice.message || choice.delta);
  if (msg) {
    const c = msg.content;
    if (typeof c === "string" && c) return c;
    if (Array.isArray(c)) {
      const joined = c.map((p) => (p && (p.text || p.content)) || "").join("");
      if (joined) return joined;
    }
  }
  const s = out.response || out.answer || out.result || out.text || out.translated_text || out.description || out.generated_text;
  return typeof s === "string" ? s : "";
}

async function runModel(env, model, q, sl, tl) {
  if (!env.AI) throw new Error("未绑定 Workers AI（变量名必须是 AI）");
  // 插件侧通常会先解析好 auto，万一直接传过来就按"译成中文"处理
  const tlCode = tl === "auto" ? "zh-CN" : tl;
  let out;
  if (model.kind === "m2m") {
    out = await env.AI.run(model.id, {
      text: q,
      source_lang: langName(sl === "auto" ? "en" : sl, M2M_LANG),
      target_lang: langName(tlCode, M2M_LANG),
    });
  } else {
    const target = langName(tlCode, LANG_NAME);
    // Qwen3 支持 <arg_key:6124c78e> 软开关：放在用户消息末尾可以让它关掉思考块，
    // 省下 token 也省时间。别的模型不吃这个，别乱加。
    const user = /qwen3/i.test(model.id) ? q + "\n<arg_key:6124c78e>" : q;
    out = await env.AI.run(model.id, {
      messages: [
        { role: "system", content: buildPrompt(target) },
        { role: "user", content: user },
      ],
      max_tokens: maxTokensFor(q),
      temperature: 0.1,
    });
  }
  // 老模型返回 {response}，新模型（qwen3.8 等）返回 {choices:[{message:{content}}]}，
  // 统一走 pickText，别再写死字段名
  const raw = pickText(out);
  const text = clean(raw);
  if (!text) {
    const e = new Error("模型返回空");
    e.raw = raw.slice(0, 120); // 排查用：到底吐了什么（多半是未闭合的 <think>）
    throw e;
  }
  return { translation: text, detected: sl === "auto" ? "" : sl };
}

function modelsToUse(env) {
  if (!env.AI_MODEL) return AI_MODELS;
  const id = String(env.AI_MODEL).trim();
  // 命中内置清单就用内置的好看名字，否则退化为模型 ID 的最后一段
  const known = AI_MODELS.find((m) => m.id === id);
  const primary = known || {
    id,
    kind: /m2m100|seamless|nllb/i.test(id) ? "m2m" : "llm",
    label: id.replace(/^@cf\//, "").replace(/^.*\//, ""),
  };
  return [primary].concat(AI_MODELS.filter((m) => m.id !== id));
}

async function translateWithAI(env, q, sl, tl, trace) {
  for (const model of modelsToUse(env)) {
    const t0 = Date.now();
    try {
      const r = await runModel(env, model, q, sl, tl);
      trace.push({ model: model.label, ok: true, ms: Date.now() - t0 });
      return { ...r, engine: model.label };
    } catch (e) {
      const msg = String((e && e.message) || e);
      trace.push({ model: model.label, ok: false, ms: Date.now() - t0, error: e && e.raw ? `${msg} raw=${e.raw}` : msg });
    }
  }
  return null;
}

/* ---------------------- 截屏 OCR ---------------------- */
function ocrModelsToUse(env) {
  if (!env.AI_OCR_MODEL) return OCR_MODELS;
  const id = String(env.AI_OCR_MODEL).trim();
  const known = OCR_MODELS.find((m) => m.id === id);
  const primary = known || { id, kind: "chat", label: id.replace(/^@cf\//, "").replace(/^.*\//, "") };
  return [primary].concat(OCR_MODELS.filter((m) => m.id !== id));
}

async function runOcrModel(env, model, image) {
  if (!env.AI) throw new Error("未绑定 Workers AI（变量名必须是 AI）");
  // 视觉 chat 模型：多模态 messages，图片走 image_url（data URI）
  const params = {
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: OCR_PROMPT },
          { type: "image_url", image_url: { url: image } },
        ],
      },
    ],
    max_tokens: 3072, // 密排大图留足预算；没用到的额度不额外计费
    temperature: 0,
  };
  // qwen3 系列默认先吐一段思考（实测同一张图 4.1s/54.8 neuron → 关掉后 2.8s/44.8 neuron，
  // 识别结果一字不差）。别的模型不吃这个参数，别乱传。
  if (/qwen3/i.test(model.id)) params.chat_template_kwargs = { enable_thinking: false };
  const out = await env.AI.run(model.id, params);
  // 返回形状见 pickText 的注释：这批模型都在 choices[0].message.content
  return clean(pickText(out));
}

/**
 * 依次试 OCR 模型。返回 {text} 或 null（全挂）。
 * 模型正常返回但没识别到文字（text 为空）不算挂——记在 trace 里继续试下一个，
 * 全空时返回 { text: "", empty: true }，让前端提示"没识别到文字"。
 */
async function ocrWithAI(env, image, trace) {
  let sawEmpty = false;
  for (const model of ocrModelsToUse(env)) {
    const t0 = Date.now();
    try {
      const text = await runOcrModel(env, model, image);
      if (text) {
        trace.push({ model: model.label, ok: true, ms: Date.now() - t0 });
        return { text, engine: model.label };
      }
      sawEmpty = true;
      trace.push({ model: model.label, ok: false, ms: Date.now() - t0, error: "没识别到文字" });
    } catch (e) {
      trace.push({ model: model.label, ok: false, ms: Date.now() - t0, error: String((e && e.message) || e) });
    }
  }
  return sawEmpty ? { text: "", engine: "", empty: true } : null;
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: JSON_HEADERS });
    if (url.pathname === "/healthz") return json(200, { ok: true, service: "st-translate-worker" });

    let body = {};
    if (request.method === "POST") {
      try {
        body = await request.json();
      } catch (_) {
        return json(400, { ok: false, error: "请求体不是合法 JSON" });
      }
    }
    const token = String(body.token || url.searchParams.get("token") || "");
    if (url.pathname !== "/translate" && url.pathname !== "/debug" && url.pathname !== "/ocr") {
      return json(404, { ok: false, error: "not found" });
    }
    if (!env.TOKEN || !safeEqual(token, env.TOKEN)) {
      return json(401, { ok: false, error: "token 无效" });
    }

    // 横向对比：同一句话跑遍所有候选模型，用来挑最顺眼的那个
    // （ocr=1 时走下面的 OCR 对比，这里让路）
    if (url.pathname === "/debug" && url.searchParams.get("compare") === "1" && url.searchParams.get("ocr") !== "1") {
      const q = String(body.q || url.searchParams.get("q") || "The quick brown fox jumps over the lazy dog.");
      const results = [];
      for (const model of AI_MODELS) {
        const t0 = Date.now();
        try {
          const r = await runModel(env, model, q, "en", "zh-CN");
          results.push({ model: model.label, id: model.id, ok: true, ms: Date.now() - t0, text: r.translation });
        } catch (e) {
          results.push({ model: model.label, id: model.id, ok: false, ms: Date.now() - t0, error: String((e && e.message) || e) });
        }
      }
      return json(200, { ok: true, q, colo: (request.cf && request.cf.colo) || null, results });
    }

    if (url.pathname === "/debug") {
      // OCR 模型横向对比：POST /debug?ocr=1&compare=1 + body {image: dataURI}
      if (url.searchParams.get("ocr") === "1") {
        const image = String(body.image || "");
        if (!/^data:image\/(png|jpe?g);base64,/.test(image)) {
          return json(400, { ok: false, error: "image 为空或不是 png/jpeg data URI" });
        }
        const results = [];
        for (const model of OCR_MODELS) {
          const t0 = Date.now();
          try {
            const text = await runOcrModel(env, model, image);
            results.push({ model: model.label, id: model.id, ok: true, ms: Date.now() - t0, text });
          } catch (e) {
            results.push({ model: model.label, id: model.id, ok: false, ms: Date.now() - t0, error: String((e && e.message) || e) });
          }
        }
        return json(200, { ok: true, colo: (request.cf && request.cf.colo) || null, results });
      }
      const q = String(body.q || url.searchParams.get("q") || "Hello world");
      const trace = [];
      const t0 = Date.now();
      const r = await translateWithAI(env, q, "en", "zh-CN", trace);
      return json(200, {
        ok: !!r,
        colo: (request.cf && request.cf.colo) || null,
        ms: Date.now() - t0,
        hasAI: !!env.AI,
        model: env.AI_MODEL || AI_MODELS[0].id,
        result: r,
        trace,
      });
    }

    if (request.method !== "POST") return json(405, { ok: false, error: "请用 POST" });

    /* ---------------------- 截屏 OCR ----------------------
     * 协议：POST /ocr { image: dataURI, token } → { ok, text, engine }
     * 图片不缓存（同一区域反复框选的收益太小，不值得存 base64）
     */
    if (url.pathname === "/ocr") {
      const image = String(body.image || "");
      if (!image) return json(400, { ok: false, error: "image 为空" });
      if (!/^data:image\/(png|jpe?g);base64,/.test(image)) {
        return json(400, { ok: false, error: "image 必须是 png/jpeg 的 base64 data URI" });
      }
      if (image.length > MAX_IMAGE_CHARS) {
        return json(413, { ok: false, error: `图片过大（上限约 ${Math.round(MAX_IMAGE_CHARS / 1.37 / 1024 / 1024)}MB）` });
      }
      const trace = [];
      const r = await ocrWithAI(env, image, trace);
      if (!r) {
        return json(502, {
          ok: false,
          error: "全部 OCR 模型失败：" + trace.map((t) => `${t.model}: ${t.error || ""}`).join(" | "),
          trace,
        });
      }
      return json(200, { ok: true, text: r.text, engine: r.engine || "" });
    }

    const q = String(body.q || "").trim();
    const sl = String(body.sl || "auto");
    const tl = String(body.tl || "zh-CN");
    if (!q) return json(400, { ok: false, error: "q 为空" });
    if (q.length > MAX_CHARS) return json(413, { ok: false, error: `文本过长（上限 ${MAX_CHARS} 字符）` });

    // 边缘缓存 24h：同一个词重复划不重复烧 neuron
    const cacheKey = new Request(
      `https://st-translate.cache/${encodeURIComponent(sl)}/${encodeURIComponent(tl)}/${encodeURIComponent(q)}`
    );
    const cache = caches.default;
    try {
      const hit = await cache.match(cacheKey);
      if (hit) {
        const c = await hit.json();
        return json(200, { ok: true, ...c, cached: true });
      }
    } catch (_) {}

    const trace = [];
    const r = await translateWithAI(env, q, sl, tl, trace);
    if (!r) {
      return json(502, {
        ok: false,
        error: "全部模型失败：" + trace.map((t) => `${t.model}: ${t.error || ""}`).join(" | "),
        trace,
      });
    }

    const payload = { translation: r.translation, detected: r.detected, engine: r.engine };
    try {
      const res = new Response(JSON.stringify(payload), { headers: JSON_HEADERS });
      res.headers.set("Cache-Control", "public, max-age=86400");
      ctx.waitUntil(cache.put(cacheKey, res.clone()));
    } catch (_) {}
    return json(200, { ok: true, ...payload });
  },
};
