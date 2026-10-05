var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// index.js
var JSON_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "X-Content-Type-Options": "nosniff"
};
var MAX_CHARS = 4e3;
var HARD_MAX_TOKENS = 2048;
var MAX_IMAGE_CHARS = 9e6;
var AI_MODELS = [
  { id: "@cf/qwen/qwen3-30b-a3b-fp8", kind: "llm", label: "qwen3-30b" },
  { id: "@cf/meta/llama-3.1-8b-instruct-fp8-fast", kind: "llm", label: "llama31-8b-fast" },
  { id: "@cf/meta/llama-3.2-3b-instruct", kind: "llm", label: "llama32-3b" },
  { id: "@cf/meta/m2m100-1.2b", kind: "m2m", label: "m2m100" }
];
var OCR_MODELS = [
  { id: "@cf/qwen/qwen3.8-27b", kind: "chat", label: "qwen3.8-27b" },
  { id: "@cf/meta/llama-4-scout-17b-16e-instruct", kind: "chat", label: "llama4-scout" }
];
var OCR_PROMPT = [
  "You are an OCR engine. Extract ALL text visible in this screenshot.",
  "Rules:",
  "1. Output the extracted text ONLY \u2014 no commentary, no markdown fences, no quotes.",
  "2. Preserve the original reading order and line breaks.",
  "3. Reproduce the text exactly as written, in its original language. Do NOT translate.",
  "4. Keep punctuation exactly as it appears. Do NOT rewrite full-width CJK punctuation",
  "   (\uFF0C\u3002\uFF1A\uFF1B\uFF01\uFF1F\u3001\u300C\u300D) into half-width ASCII, and do not do the reverse either.",
  "5. Ignore icons, scrollbars and UI noise that are not text.",
  "6. If there is no readable text, output nothing."
].join("\n");
var LANG_NAME = {
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
  id: "Indonesian"
};
var M2M_LANG = {
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
  id: "indonesian"
};
function json(status, obj) {
  return new Response(JSON.stringify(obj), { status, headers: JSON_HEADERS });
}
__name(json, "json");
function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
__name(safeEqual, "safeEqual");
function langName(code, table) {
  return table && table[code] || code;
}
__name(langName, "langName");
function buildPrompt(target) {
  return [
    "You are a translation engine.",
    `Translate the user's text into ${target}.`,
    "Rules:",
    "1. Output the translation ONLY. No notes, no explanations, no quotation marks around it, no <think> tags.",
    "2. Preserve line breaks, list markers and formatting.",
    "3. Keep proper nouns, code identifiers, numbers, units and formulas exactly as they are.",
    `4. If the text is already in ${target} or is empty of translatable content, echo it back unchanged.`
  ].join("\n");
}
__name(buildPrompt, "buildPrompt");
function maxTokensFor(q) {
  return Math.min(HARD_MAX_TOKENS, Math.max(512, Math.ceil(q.length * 2) + 768));
}
__name(maxTokensFor, "maxTokensFor");
function clean(text) {
  let t = String(text || "").trim();
  if (/<think>/i.test(t)) t = t.replace(/<think>[\s\S]*?(<\/think>|$)/gi, "").trim();
  t = t.replace(/\n?\s*<arg_key:6124c78e>\s*$/i, "").trim();
  t = t.replace(/^(译文|翻译|Translation)\s*[:：]\s*/i, "");
  if (t.length > 1 && (t.startsWith('"') && t.endsWith('"') || t.startsWith("\u201C") && t.endsWith("\u201D"))) {
    const inner = t.slice(1, -1);
    if (!inner.includes('"') && !inner.includes("\u201C")) t = inner;
  }
  return t.trim();
}
__name(clean, "clean");
function pickText(out) {
  if (out == null) return "";
  if (typeof out === "string") return out;
  const choice = Array.isArray(out.choices) ? out.choices[0] : null;
  const msg = choice && (choice.message || choice.delta);
  if (msg) {
    const c = msg.content;
    if (typeof c === "string" && c) return c;
    if (Array.isArray(c)) {
      const joined = c.map((p) => p && (p.text || p.content) || "").join("");
      if (joined) return joined;
    }
  }
  const s = out.response || out.answer || out.result || out.text || out.translated_text || out.description || out.generated_text;
  return typeof s === "string" ? s : "";
}
__name(pickText, "pickText");
async function runModel(env, model, q, sl, tl) {
  if (!env.AI) throw new Error("\u672A\u7ED1\u5B9A Workers AI\uFF08\u53D8\u91CF\u540D\u5FC5\u987B\u662F AI\uFF09");
  const tlCode = tl === "auto" ? "zh-CN" : tl;
  let out;
  if (model.kind === "m2m") {
    out = await env.AI.run(model.id, {
      text: q,
      source_lang: langName(sl === "auto" ? "en" : sl, M2M_LANG),
      target_lang: langName(tlCode, M2M_LANG)
    });
  } else {
    const target = langName(tlCode, LANG_NAME);
    const user = /qwen3/i.test(model.id) ? q + "\n<arg_key:6124c78e>" : q;
    out = await env.AI.run(model.id, {
      messages: [
        { role: "system", content: buildPrompt(target) },
        { role: "user", content: user }
      ],
      max_tokens: maxTokensFor(q),
      temperature: 0.1
    });
  }
  const raw = pickText(out);
  const text = clean(raw);
  if (!text) {
    const e = new Error("\u6A21\u578B\u8FD4\u56DE\u7A7A");
    e.raw = raw.slice(0, 120);
    throw e;
  }
  return { translation: text, detected: sl === "auto" ? "" : sl };
}
__name(runModel, "runModel");
function modelsToUse(env) {
  if (!env.AI_MODEL) return AI_MODELS;
  const id = String(env.AI_MODEL).trim();
  const known = AI_MODELS.find((m) => m.id === id);
  const primary = known || {
    id,
    kind: /m2m100|seamless|nllb/i.test(id) ? "m2m" : "llm",
    label: id.replace(/^@cf\//, "").replace(/^.*\//, "")
  };
  return [primary].concat(AI_MODELS.filter((m) => m.id !== id));
}
__name(modelsToUse, "modelsToUse");
async function translateWithAI(env, q, sl, tl, trace) {
  for (const model of modelsToUse(env)) {
    const t0 = Date.now();
    try {
      const r = await runModel(env, model, q, sl, tl);
      trace.push({ model: model.label, ok: true, ms: Date.now() - t0 });
      return { ...r, engine: model.label };
    } catch (e) {
      const msg = String(e && e.message || e);
      trace.push({ model: model.label, ok: false, ms: Date.now() - t0, error: e && e.raw ? `${msg} raw=${e.raw}` : msg });
    }
  }
  return null;
}
__name(translateWithAI, "translateWithAI");
function ocrModelsToUse(env) {
  if (!env.AI_OCR_MODEL) return OCR_MODELS;
  const id = String(env.AI_OCR_MODEL).trim();
  const known = OCR_MODELS.find((m) => m.id === id);
  const primary = known || { id, kind: "chat", label: id.replace(/^@cf\//, "").replace(/^.*\//, "") };
  return [primary].concat(OCR_MODELS.filter((m) => m.id !== id));
}
__name(ocrModelsToUse, "ocrModelsToUse");
async function runOcrModel(env, model, image) {
  if (!env.AI) throw new Error("\u672A\u7ED1\u5B9A Workers AI\uFF08\u53D8\u91CF\u540D\u5FC5\u987B\u662F AI\uFF09");
  const params = {
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: OCR_PROMPT },
          { type: "image_url", image_url: { url: image } }
        ]
      }
    ],
    max_tokens: 3072,
    // 密排大图留足预算；没用到的额度不额外计费
    temperature: 0
  };
  if (/qwen3/i.test(model.id)) params.chat_template_kwargs = { enable_thinking: false };
  const out = await env.AI.run(model.id, params);
  return clean(pickText(out));
}
__name(runOcrModel, "runOcrModel");
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
      trace.push({ model: model.label, ok: false, ms: Date.now() - t0, error: "\u6CA1\u8BC6\u522B\u5230\u6587\u5B57" });
    } catch (e) {
      trace.push({ model: model.label, ok: false, ms: Date.now() - t0, error: String(e && e.message || e) });
    }
  }
  return sawEmpty ? { text: "", engine: "", empty: true } : null;
}
__name(ocrWithAI, "ocrWithAI");
var index_default = {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: JSON_HEADERS });
    if (url.pathname === "/healthz") return json(200, { ok: true, service: "st-translate-worker" });
    let body = {};
    if (request.method === "POST") {
      try {
        body = await request.json();
      } catch (_) {
        return json(400, { ok: false, error: "\u8BF7\u6C42\u4F53\u4E0D\u662F\u5408\u6CD5 JSON" });
      }
    }
    const token = String(body.token || url.searchParams.get("token") || "");
    if (url.pathname !== "/translate" && url.pathname !== "/debug" && url.pathname !== "/ocr" && url.pathname !== "/dict") {
      return json(404, { ok: false, error: "not found" });
    }
    if (!env.TOKEN) {
      return json(500, { ok: false, error: "\u670D\u52A1\u7AEF\u672A\u914D\u7F6E TOKEN secret\uFF08wrangler secret put TOKEN\uFF09" });
    }
    if (!safeEqual(token, String(env.TOKEN).trim())) {
      return json(401, { ok: false, error: "token \u65E0\u6548" });
    }
    if (url.pathname === "/debug" && url.searchParams.get("compare") === "1" && url.searchParams.get("ocr") !== "1") {
      const q2 = String(body.q || url.searchParams.get("q") || "The quick brown fox jumps over the lazy dog.");
      const results = [];
      for (const model of AI_MODELS) {
        const t0 = Date.now();
        try {
          const r2 = await runModel(env, model, q2, "en", "zh-CN");
          results.push({ model: model.label, id: model.id, ok: true, ms: Date.now() - t0, text: r2.translation });
        } catch (e) {
          results.push({ model: model.label, id: model.id, ok: false, ms: Date.now() - t0, error: String(e && e.message || e) });
        }
      }
      return json(200, { ok: true, q: q2, colo: request.cf && request.cf.colo || null, results });
    }
    if (url.pathname === "/debug") {
      if (url.searchParams.get("ocr") === "1") {
        const image = String(body.image || "");
        if (!/^data:image\/(png|jpe?g);base64,/.test(image)) {
          return json(400, { ok: false, error: "image \u4E3A\u7A7A\u6216\u4E0D\u662F png/jpeg data URI" });
        }
        const results = [];
        for (const model of OCR_MODELS) {
          const t02 = Date.now();
          try {
            const text = await runOcrModel(env, model, image);
            results.push({ model: model.label, id: model.id, ok: true, ms: Date.now() - t02, text });
          } catch (e) {
            results.push({ model: model.label, id: model.id, ok: false, ms: Date.now() - t02, error: String(e && e.message || e) });
          }
        }
        return json(200, { ok: true, colo: request.cf && request.cf.colo || null, results });
      }
      const q2 = String(body.q || url.searchParams.get("q") || "Hello world");
      const trace2 = [];
      const t0 = Date.now();
      const r2 = await translateWithAI(env, q2, "en", "zh-CN", trace2);
      return json(200, {
        ok: !!r2,
        colo: request.cf && request.cf.colo || null,
        ms: Date.now() - t0,
        hasAI: !!env.AI,
        model: env.AI_MODEL || AI_MODELS[0].id,
        result: r2,
        trace: trace2
      });
    }
    if (url.pathname === "/dict") {
      const word = String(url.searchParams.get("q") || body.q || "").trim();
      if (!word) return json(400, { ok: false, error: "q \u4E3A\u7A7A" });
      if (word.length > 64) return json(413, { ok: false, error: "\u5355\u8BCD\u8FC7\u957F" });
      const dicts = String(url.searchParams.get("dicts") || '{"count":99,"dicts":[["ec"]]}');
      const target = "https://dict.youdao.com/jsonapi?jsonversion=2&q=" + encodeURIComponent(word) + "&dicts=" + encodeURIComponent(dicts);
      try {
        const r2 = await fetch(target, {
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
            Referer: "https://dict.youdao.com/",
            Accept: "application/json, text/plain, */*"
          }
        });
        if (!r2.ok) return json(502, { ok: false, error: "\u6709\u9053 HTTP " + r2.status });
        const data = await r2.json();
        return json(200, { ok: true, data });
      } catch (e) {
        return json(502, { ok: false, error: "\u4E0A\u6E38\u5F02\u5E38\uFF1A" + (e && e.message || e) });
      }
    }
    if (request.method !== "POST") return json(405, { ok: false, error: "\u8BF7\u7528 POST" });
    if (url.pathname === "/ocr") {
      const image = String(body.image || "");
      if (!image) return json(400, { ok: false, error: "image \u4E3A\u7A7A" });
      if (!/^data:image\/(png|jpe?g);base64,/.test(image)) {
        return json(400, { ok: false, error: "image \u5FC5\u987B\u662F png/jpeg \u7684 base64 data URI" });
      }
      if (image.length > MAX_IMAGE_CHARS) {
        return json(413, { ok: false, error: `\u56FE\u7247\u8FC7\u5927\uFF08\u4E0A\u9650\u7EA6 ${Math.round(MAX_IMAGE_CHARS / 1.37 / 1024 / 1024)}MB\uFF09` });
      }
      const trace2 = [];
      const r2 = await ocrWithAI(env, image, trace2);
      if (!r2) {
        return json(502, {
          ok: false,
          error: "\u5168\u90E8 OCR \u6A21\u578B\u5931\u8D25\uFF1A" + trace2.map((t) => `${t.model}: ${t.error || ""}`).join(" | "),
          trace: trace2
        });
      }
      return json(200, { ok: true, text: r2.text, engine: r2.engine || "" });
    }
    const q = String(body.q || "").trim();
    const sl = String(body.sl || "auto");
    const tl = String(body.tl || "zh-CN");
    if (!q) return json(400, { ok: false, error: "q \u4E3A\u7A7A" });
    if (q.length > MAX_CHARS) return json(413, { ok: false, error: `\u6587\u672C\u8FC7\u957F\uFF08\u4E0A\u9650 ${MAX_CHARS} \u5B57\u7B26\uFF09` });
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
    } catch (_) {
    }
    const trace = [];
    const r = await translateWithAI(env, q, sl, tl, trace);
    if (!r) {
      return json(502, {
        ok: false,
        error: "\u5168\u90E8\u6A21\u578B\u5931\u8D25\uFF1A" + trace.map((t) => `${t.model}: ${t.error || ""}`).join(" | "),
        trace
      });
    }
    const payload = { translation: r.translation, detected: r.detected, engine: r.engine };
    try {
      const res = new Response(JSON.stringify(payload), { headers: JSON_HEADERS });
      res.headers.set("Cache-Control", "public, max-age=86400");
      ctx.waitUntil(cache.put(cacheKey, res.clone()));
    } catch (_) {
    }
    return json(200, { ok: true, ...payload });
  }
};
export {
  index_default as default
};
//# sourceMappingURL=index.js.map
