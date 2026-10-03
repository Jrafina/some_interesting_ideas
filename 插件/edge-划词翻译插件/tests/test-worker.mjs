/*
 * Worker 逻辑离线测试（node 直跑，不需要 wrangler / 不联网）
 * mock 掉 Workers AI + caches，覆盖：主模型、回退链、m2m 兜底、AI_MODEL 覆盖、输出清洗、鉴权、边界、compare
 */
import worker from "../worker/index.js";

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

let AI_MODE = "ok"; // ok | fail-all | llm-fail | empty
let OCR_MODE = "ok"; // ok | fail | empty（只影响 /ocr 的两个视觉模型）
let aiCalls = [];
let cacheStore = new Map();
let rawResponse = null; // 强制返回原文，用来测清洗逻辑

globalThis.caches = {
  default: {
    match: async (req) => cacheStore.get(String(req.url)) || null,
    put: async (req, res) => cacheStore.set(String(req.url), res.clone()),
  },
};

function makeEnv(extra) {
  return Object.assign(
    {
      TOKEN: "test-token",
      AI: {
        run: async (model, input) => {
          aiCalls.push({ model, input });
          if (AI_MODE === "fail-all") throw new Error("模型不可用");
          if (AI_MODE === "llm-fail" && !String(model).includes("m2m100")) throw new Error("模型不可用");
          if (AI_MODE === "empty") return { response: "   " };
          if (rawResponse) return { response: rawResponse };
          if (String(model).includes("m2m100")) {
            return { translated_text: "【m2m】" + (input.text || "") };
          }
          // 视觉模型的**真实**返回形状是 OpenAI 风格 choices[].message.content。
          // 2026-09-24 实测：@cf/qwen/qwen3.8-27b 与 @cf/meta/llama-4-scout-17b 都是这个形状；
          // moondream3.1 恒返回 {}（success:true 但 result 空），已从回退链里踢掉。
          if (String(model).includes("qwen3.8")) {
            if (OCR_MODE === "fail") throw new Error("视觉模型不可用");
            if (OCR_MODE === "empty") return { choices: [{ message: { content: "   " } }] };
            return { choices: [{ message: { content: "屏幕上的文字" } }] };
          }
          if (String(model).includes("llama-4-scout")) {
            return { choices: [{ message: { content: OCR_MODE === "empty" ? " " : "llama4 文字" } }] };
          }
          return { response: "【译】" + input.messages[input.messages.length - 1].content };
        },
      },
    },
    extra || {}
  );
}
const env = makeEnv();
const ctx = { waitUntil: () => {} };

const call = (path, body, e = env, method = "POST") =>
  worker.fetch(
    new Request("https://example.com" + path, {
      method,
      headers: { "Content-Type": "application/json" },
      body: method === "POST" ? JSON.stringify(body) : undefined,
    }),
    e,
    ctx
  );
const bodyOf = async (res) => ({ status: res.status, json: await res.json() });

console.log("\n[1] 主模型成功（默认 qwen3-30b）");
AI_MODE = "ok";
aiCalls = [];
cacheStore = new Map();
let r = await bodyOf(await call("/translate", { q: "Hello", sl: "en", tl: "zh-CN", token: "test-token" }));
ok(r.json.ok && r.json.translation === "【译】Hello", "译文正确", r.json);
ok(r.json.engine === "qwen3-30b", "engine 标为主模型", r.json.engine);
ok(aiCalls.length === 1 && aiCalls[0].model === "@cf/qwen/qwen3-30b-a3b-fp8", "只调了主模型一次", aiCalls[0] && aiCalls[0].model);
const prompt = aiCalls[0].input.messages[0].content;
ok(/Simplified Chinese/.test(prompt), "prompt 里带目标语言名", prompt.slice(0, 60));
ok(aiCalls[0].input.messages[1].content.startsWith("Hello"), "用户消息就是原文", aiCalls[0].input.messages[1]);
ok(/<arg_key:6124c78e>$/.test(aiCalls[0].input.messages[1].content), "Qwen3 带 <arg_key:6124c78e> 关思考", aiCalls[0].input.messages[1].content);
ok(aiCalls[0].input.max_tokens >= 512 && aiCalls[0].input.temperature <= 0.2, "token 预算给足 + 低温", aiCalls[0].input.max_tokens);

console.log("\n[1b] 非推理模型不该被塞 <arg_key:6124c78e>");
aiCalls = [];
const envLlama = makeEnv({ AI_MODEL: "@cf/meta/llama-3.2-3b-instruct" });
await bodyOf(await call("/translate", { q: "Hi", token: "test-token" }, envLlama));
ok(aiCalls[0].input.messages[1].content === "Hi", "llama 的用户消息就是原文", aiCalls[0].input.messages[1].content);

console.log("\n[2] 同一词第二次走缓存（不重复烧 neuron）");
aiCalls = [];
r = await bodyOf(await call("/translate", { q: "Hello", sl: "en", tl: "zh-CN", token: "test-token" }));
ok(r.json.cached === true && aiCalls.length === 0, "命中缓存且没调模型", { cached: r.json.cached, calls: aiCalls.length });

console.log("\n[3] 主模型挂了 → 回退下一个 LLM");
AI_MODE = "llm-fail";
aiCalls = [];
cacheStore = new Map();
r = await bodyOf(await call("/translate", { q: "Hi", token: "test-token" }));
ok(r.json.ok && r.json.engine === "m2m100", "LLM 全挂时落到 m2m100 兜底", r.json);
ok(r.json.translation === "【m2m】Hi", "m2m 用的是 text/text_lang 入参", r.json.translation);
const m2mCall = aiCalls.find((c) => String(c.model).includes("m2m100"));
ok(!!m2mCall && m2mCall.input.source_lang === "english" && m2mCall.input.target_lang === "chinese",
   "m2m 语种映射正确（english→chinese）", m2mCall && m2mCall.input);

console.log("\n[4] 全部模型失败 → 502 且 trace 可读");
AI_MODE = "fail-all";
cacheStore = new Map();
r = await bodyOf(await call("/translate", { q: "Hi", token: "test-token" }));
ok(r.status === 502 && !r.json.ok, "返回 502", r.json.error && r.json.error.slice(0, 60));
ok(Array.isArray(r.json.trace) && r.json.trace.length === 4, "trace 覆盖 4 个候选模型", r.json.trace && r.json.trace.length);

console.log("\n[4b] 空结果的 trace 里带原始输出，方便远程排查");
AI_MODE = "ok";
rawResponse = "<think>先想想这句话该怎么翻";
cacheStore = new Map();
r = await bodyOf(await call("/translate", { q: "Hi", token: "test-token" }));
const t0 = (r.json.trace || [])[0] || {};
ok(/模型返回空/.test(String(t0.error)) && /raw=/.test(String(t0.error)), "trace 里带了 raw 片段", t0.error);
rawResponse = null;

console.log("\n[5] AI_MODEL 可覆盖，且原模型仍在回退链里");
AI_MODE = "ok";
aiCalls = [];
cacheStore = new Map();
const envCustom = makeEnv({ AI_MODEL: "@cf/meta/llama-3.1-8b-instruct-fp8-fast" });
r = await bodyOf(await call("/translate", { q: "Hi", token: "test-token" }, envCustom));
ok(r.json.engine === "llama31-8b-fast", "用的是自定义模型", r.json.engine);
ok(aiCalls[0].model === "@cf/meta/llama-3.1-8b-instruct-fp8-fast", "请求打到自定义模型", aiCalls[0].model);

console.log("\n[6] 模型输出被清洗（多余前缀 / 外层引号）");
rawResponse = "译文：【译】Hi";
cacheStore = new Map();
r = await bodyOf(await call("/translate", { q: "Hi", token: "test-token" }));
ok(r.json.translation === "【译】Hi", "去掉了“译文：”前缀", r.json.translation);
rawResponse = '"【译】Hi"';
cacheStore = new Map();
r = await bodyOf(await call("/translate", { q: "Hi", token: "test-token" }));
ok(r.json.translation === "【译】Hi", "去掉了外层引号", r.json.translation);
rawResponse = "<think>先想一下这句话的意思</think>【译】Hi";
cacheStore = new Map();
r = await bodyOf(await call("/translate", { q: "Hi", token: "test-token" }));
ok(r.json.translation === "【译】Hi", "剥掉了 <think> 推理块", r.json.translation);
rawResponse = "<think>没闭合的思考";
cacheStore = new Map();
r = await bodyOf(await call("/translate", { q: "Hi", token: "test-token" }));
ok(r.status === 502, "只剩 <think> 时算失败并回退", { status: r.status, json: r.json });
rawResponse = null;

console.log("\n[7] 模型返回空 → 继续回退而不是返回空译文");
AI_MODE = "empty";
cacheStore = new Map();
r = await bodyOf(await call("/translate", { q: "Hi", token: "test-token" }));
ok(r.status === 502, "空结果被当作失败并回退到底", r.status);
AI_MODE = "ok";

console.log("\n[8] 鉴权与边界");
cacheStore = new Map();
r = await bodyOf(await call("/translate", { q: "x", token: "wrong" }));
ok(r.status === 401 && r.json.error === "token 无效", "错误 token → 401", r.json);
r = await bodyOf(await call("/translate", { q: "   ", token: "test-token" }));
ok(r.status === 400 && r.json.error === "q 为空", "空文本 → 400", r.json);
r = await bodyOf(await call("/translate", { q: "a".repeat(5000), token: "test-token" }));
ok(r.status === 413, "超长 → 413", r.json);
r = await bodyOf(await call("/nope", { q: "x", token: "test-token" }));
ok(r.status === 404, "未知路径 → 404", r.json);
let res = await worker.fetch(new Request("https://example.com/translate", { method: "OPTIONS" }), env, ctx);
ok(res.status === 204 && res.headers.get("Access-Control-Allow-Origin") === "*", "OPTIONS 预检 + CORS", res.status);
res = await worker.fetch(new Request("https://example.com/healthz"), env, ctx);
ok(res.status === 200, "healthz", res.status);

console.log("\n[9] 没绑 AI 时给出能照着改的提示");
const envNoAI = { TOKEN: "test-token" };
r = await bodyOf(await call("/translate", { q: "Hi", token: "test-token" }, envNoAI));
ok(r.status === 502 && /未绑定 Workers AI/.test(r.json.error), "提示变量名必须是 AI", r.json.error);

console.log("\n[10] /debug 与 ?compare=1 横向对比");
cacheStore = new Map();
aiCalls = [];
r = await bodyOf(await call("/debug", { token: "test-token" }));
ok(r.status === 200 && Array.isArray(r.json.trace), "/debug 返回 trace", r.json.trace && r.json.trace.length);
ok(r.json.hasAI === true && !!r.json.model, "报告 AI 与当前主模型", { hasAI: r.json.hasAI, model: r.json.model });
aiCalls = [];
r = await bodyOf(await call("/debug?compare=1", { token: "test-token", q: "Hello" }));
ok(Array.isArray(r.json.results) && r.json.results.length === 4, "compare 跑遍 4 个模型", r.json.results && r.json.results.length);
ok(r.json.results.every((x) => typeof x.ms === "number"), "每个模型带耗时", r.json.results.map((x) => [x.model, x.ms]));

console.log("\n[11] /ocr 截屏识别（主模型 qwen3.8-27b）");
const IMG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==";
aiCalls = [];
r = await bodyOf(await call("/ocr", { image: IMG, token: "test-token" }));
ok(r.json.ok && r.json.text === "屏幕上的文字" && r.json.engine === "qwen3.8-27b", "主 OCR 模型成功", r.json);
ok(aiCalls.length === 1 && aiCalls[0].model === "@cf/qwen/qwen3.8-27b", "只调了主 OCR 模型", aiCalls[0] && aiCalls[0].model);
const ocrMsg = aiCalls[0].input.messages[0].content;
ok(Array.isArray(ocrMsg) && ocrMsg[1].type === "image_url" && ocrMsg[1].image_url.url === IMG,
   "图片以 image_url(dataURI) 传入", ocrMsg && ocrMsg[1]);
ok(/Do NOT translate/.test(ocrMsg[0].text), "OCR prompt 要求原样提取不翻译", ocrMsg && ocrMsg[0]);

console.log("\n[11b] 主 OCR 模型挂了 → llama-4-scout 兜底");
OCR_MODE = "fail";
aiCalls = [];
r = await bodyOf(await call("/ocr", { image: IMG, token: "test-token" }));
ok(r.json.ok && r.json.engine === "llama4-scout", "落到 llama-4-scout", r.json);
const md = aiCalls.find((c) => String(c.model).includes("llama-4-scout"));
ok(!!md && Array.isArray(md.input.messages) && md.input.messages[0].content[1].type === "image_url",
   "兜底模型同样走多模态 messages", md && md.input);
OCR_MODE = "ok";

console.log("\n[11c] 全挂 → 502；都识别为空 → ok 且 text 为空");
AI_MODE = "fail-all";
r = await bodyOf(await call("/ocr", { image: IMG, token: "test-token" }));
ok(r.status === 502 && !r.json.ok, "全挂 502 且带 trace", r.json);
AI_MODE = "ok";
OCR_MODE = "empty";
r = await bodyOf(await call("/ocr", { image: IMG, token: "test-token" }));
ok(r.json.ok === true && r.json.text === "", "空识别不算失败（前端提示没识别到）", r.json);
OCR_MODE = "ok";

console.log("\n[11d] /ocr 鉴权与边界");
r = await bodyOf(await call("/ocr", { image: IMG, token: "wrong" }));
ok(r.status === 401, "错误 token → 401", r.json);
r = await bodyOf(await call("/ocr", { image: "hello", token: "test-token" }));
ok(r.status === 400, "非 png/jpeg data URI → 400", r.json);
r = await bodyOf(await call("/ocr", { image: "data:image/png;base64," + "A".repeat(10_000_000), token: "test-token" }));
ok(r.status === 413, "超大图 → 413", r.json);

console.log("\n[11e] AI_OCR_MODEL 覆盖 + /debug?ocr=1&compare=1 对比");
const envOcrCustom = makeEnv({ AI_OCR_MODEL: "@cf/meta/llama-4-scout-17b-16e-instruct" });
aiCalls = [];
r = await bodyOf(await call("/ocr", { image: IMG, token: "test-token" }, envOcrCustom));
ok(r.json.ok && r.json.engine === "llama4-scout" && aiCalls[0].model.includes("llama-4-scout"),
   "AI_OCR_MODEL 指定的模型先跑", r.json);
r = await bodyOf(await call("/debug?ocr=1&compare=1", { image: IMG, token: "test-token" }));
ok(Array.isArray(r.json.results) && r.json.results.length === 2, "OCR compare 跑遍 2 个视觉模型", r.json.results);
ok(r.json.results.every((x) => typeof x.ms === "number"), "每个模型带耗时", r.json.results.map((x) => [x.model, x.ms]));

console.log("\n[11f] 返回字段形状回归（曾经的 bug：写死 out.response → 永远识别不到）");
// 老式 text-generation 形状 {response}：llama-3.x / qwen3-30b 这条线
const envShapeOld = makeEnv({
  AI: { run: async (model, input) => (String(model).includes("m2m100") ? { translated_text: "m2m" } : { response: "老形状文字" }) },
});
r = await bodyOf(await call("/ocr", { image: IMG, token: "test-token" }, envShapeOld));
ok(r.json.ok && r.json.text === "老形状文字", "OCR 侧能解析老式 {response}", r.json);
// OpenAI 形状：新模型（qwen3.8 / llama-4-scout / gemma）
const envShapeNew = makeEnv({
  AI: { run: async () => ({ choices: [{ message: { content: "新形状文字" } }] }) },
});
r = await bodyOf(await call("/ocr", { image: IMG, token: "test-token" }, envShapeNew));
ok(r.json.ok && r.json.text === "新形状文字", "OCR 侧能解析 OpenAI 形状 choices[].message.content", r.json);
// moondream 的 {answer}——虽然它在这账号上返回空，但字段兼容不能丢
const envShapeAnswer = makeEnv({ AI: { run: async () => ({ answer: "answer 字段文字" }) } });
r = await bodyOf(await call("/ocr", { image: IMG, token: "test-token" }, envShapeAnswer));
ok(r.json.ok && r.json.text === "answer 字段文字", "OCR 侧能解析 {answer}（moondream 形状）", r.json);
// 翻译侧同样不能只认 {response}（q=ShapeProbe 避开前面测试写进缓存的那条）
const envShapeNewTr = makeEnv({
  AI: { run: async (model) => (String(model).includes("m2m100") ? { translated_text: "m2m" } : { choices: [{ message: { content: "新形状译文" } }] }) },
});
r = await bodyOf(await call("/translate", { q: "ShapeProbe", sl: "en", tl: "zh-CN", token: "test-token" }, envShapeNewTr));
ok(r.json.ok && r.json.translation === "新形状译文", "翻译侧能解析 OpenAI 形状", r.json);
// 模型全空时不能伪装成功（前端要能区分"没识别到"和"识别失败"）
const envAllBlank = makeEnv({ AI: { run: async () => ({ choices: [{ message: { content: "  \n " } }] }) } });
r = await bodyOf(await call("/ocr", { image: IMG, token: "test-token" }, envAllBlank));
ok(r.json.ok === true && r.json.text === "", "全空结果 → ok 但 text 为空", r.json);

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
