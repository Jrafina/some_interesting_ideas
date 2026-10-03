import { translate, testEngine, DEFAULT_SETTINGS } from "../src/lib/engines.js";

let pass = 0;
let fail = 0;
function ok(cond, name, extra) {
  if (cond) {
    pass++;
    console.log("  ✓ " + name);
  } else {
    fail++;
    console.log("  ✗ " + name + (extra ? "  → " + JSON.stringify(extra) : ""));
  }
}

const base = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
const calls = [];
let mock;

globalThis.fetch = async (url, opts) => {
  calls.push({ url: String(url), opts });
  return mock(String(url), opts);
};

const json = (obj) => ({
  ok: true,
  status: 200,
  json: async () => obj,
  text: async () => JSON.stringify(obj),
});

console.log("\n[1] Google 引擎：正常解析（多段拼接）");
mock = () =>
  json([
    [
      ["你好，", "Hello, ", null, null, 10],
      ["世界！", "world!", null, null, 3],
    ],
    null,
    "en",
  ]);
let r = await translate("Hello, world!", base);
ok(r.ok && r.translation === "你好，世界！", "译文拼接正确", r);
ok(r.engine === "google", "命中 google 引擎", r);
ok(calls[0].url.includes("client=gtx") && calls[0].url.includes("q=Hello%2C%20world!"), "请求 URL 正确", calls[0].url);

console.log("\n[2] 回退：Google 500 → 自动切到已配置的 AI 引擎");
calls.length = 0;
let first = true;
mock = (url, opts) => {
  if (url.includes("translate.googleapis.com")) {
    return { ok: false, status: 500, json: async () => ({}), text: async () => "" };
  }
  return json({ choices: [{ message: { content: "  你好，世界！  " } }] });
};
const ai = JSON.parse(JSON.stringify(base));
ai.openai = { baseUrl: "https://api.deepseek.com/v1", apiKey: "sk-test", model: "deepseek-chat" };
ai.order = ["google", "openai"];
r = await translate("Hello, world!", ai);
ok(r.ok && r.translation === "你好，世界！", "回退后拿到 AI 译文", r);
ok(r.engine === "openai", "命中 openai 引擎", r);
const postCall = calls.find((c) => c.url.includes("chat/completions"));
ok(!!postCall && postCall.url === "https://api.deepseek.com/v1/chat/completions", "baseURL 自动补 /chat/completions", postCall && postCall.url);
ok(!!postCall && JSON.parse(postCall.opts.body).model === "deepseek-chat", "请求体带 model", postCall && postCall.opts.body);

console.log("\n[3] 未配置的引擎被跳过并给出可读错误");
const noCfg = JSON.parse(JSON.stringify(base));
noCfg.order = ["openai", "youdao"];
r = await translate("Hello", noCfg);
ok(!r.ok && r.errors.length === 2, "两个引擎都报错", r);
ok(r.errors[0].includes("未配置 OpenAI"), "AI 错误信息可读", r.errors);
ok(r.errors[1].includes("未配置有道"), "有道错误信息可读", r.errors);

console.log("\n[4] 有道智云：签名请求 + 解析");
calls.length = 0;
mock = () => json({ errorCode: "0", translation: ["你好"], l: "en2zh-CHS" });
const yd = JSON.parse(JSON.stringify(base));
yd.order = ["youdao"];
yd.youdao = { appKey: "abc", appSecret: "secret" };
r = await translate("Hello", yd);
ok(r.ok && r.translation === "你好", "有道译文解析", r);
ok(r.detected === "en", "检测语言解析", r);
const body = calls[0].opts.body;
ok(calls[0].url === "https://openapi.youdao.com/api", "有道接口地址", calls[0].url);
ok(/sign=[0-9a-f]{64}/.test(body), "签名是 64 位 sha256", body.slice(0, 120));
ok(body.includes("saltt") === false && body.includes("signType=v3"), "signType=v3", body.slice(0, 200));

console.log("\n[5] 边界：空文本 / 超长文本 / 单引擎测试");
r = await translate("   ", base);
ok(!r.ok, "空文本被拒", r);
r = await translate("a".repeat(9000), base);
ok(!r.ok && r.errors[0].includes("过长"), "超长文本被拒", r);
mock = () => json([[["测试", "Hello", null, null, 1]], null, "zh-CN"]);
r = await translate("Hello", base);
ok(r.ok && r.translation === "测试", "普通翻译正常", r);

console.log("\n[7] Google 返回格式异常 → 报错而不是拼出乱码");
mock = () => json([["测试", "test", null, null, 1], null, "zh-CN"]);
r = await translate("Hello", base);
ok(!r.ok && r.errors.some((e) => e.includes("格式异常")), "格式异常被识别", r);
mock = () => json({ choices: [{ message: { content: "Hello, world" } }] });
const t = await testEngine("openai", ai);
ok(t.ok && t.message === "Hello, world", "testEngine 可用", t);

console.log("\n[8] 自建代理（Workers AI）");
calls.length = 0;
const px = JSON.parse(JSON.stringify(base));
px.order = ["proxy"];
px.proxy = { url: "https://proxy.example.com/translate", token: "T0KEN" };
mock = () => json({ ok: true, translation: "你好，世界", detected: "en" });
r = await translate("Hello world", px);
ok(r.ok && r.translation === "你好，世界" && r.detected === "en", "代理译文与语种解析", r);
ok(calls[0].url === "https://proxy.example.com/translate", "请求打到代理地址", calls[0].url);
const pbody = JSON.parse(calls[0].opts.body);
ok(pbody.q === "Hello world" && pbody.token === "T0KEN" && pbody.tl === "zh-CN", "请求体带 q/token/tl", pbody);

console.log("\n[9] 代理侧的错误要原样透出（token 无效 / 限流 / 上游失败）");
mock = () => json({ ok: false, error: "token 无效" });
r = await translate("Hello", px);
ok(!r.ok && r.errors[0].includes("token 无效"), "透出服务端错误信息", r);
mock = () => ({ ok: false, status: 502, json: async () => ({ ok: false, error: "上游失败" }) });
r = await translate("Hello", px);
ok(!r.ok && r.errors[0].includes("上游失败"), "HTTP 502 也能透出", r);

console.log("\n[10] 代理未配 token / 超长文本分块");
const pxNoToken = JSON.parse(JSON.stringify(base));
pxNoToken.order = ["proxy"];
// 显式给地址、不给 token：这样测的是「缺 token」分支，不依赖默认设置里有没有预填地址
pxNoToken.proxy = { url: "https://proxy.example.com/translate", token: "" };
r = await translate("Hello", pxNoToken);
ok(!r.ok && r.errors[0].includes("未配置翻译代理 token"), "缺 token 时给出明确报错", r);
calls.length = 0;
mock = () => json({ ok: true, translation: "块", detected: "en" });
r = await translate("word ".repeat(1200), px); // 6000 字符 > 4000 上限
ok(r.ok && calls.length === 2, "超长文本按 4000 字符分块请求", { chunks: calls.length });

console.log("\n[6] 长文本自动分块（>1500 字符）");
calls.length = 0;
mock = () => json([[["块", "chunk", null, null, 1]], null, "en"]);
r = await translate("line\n".repeat(500).trim(), base);
ok(r.ok && calls.length >= 2, "被拆成多块请求", { chunks: calls.length });
ok(r.translation.split("\n").length === calls.length, "译文按块数合并", r.translation);

console.log("\n[11] 自动中英对译（targetLang=auto）");
const auto = JSON.parse(JSON.stringify(base));
auto.targetLang = "auto";
auto.order = ["proxy"];
auto.proxy = { url: "https://x/translate", token: "T" };
mock = () => json({ ok: true, translation: "X", detected: "" });
calls.length = 0;
await translate("Hello world", auto);
ok(JSON.parse(calls[0].opts.body).tl === "zh-CN", "英文原文 → 译成中文", JSON.parse(calls[0].opts.body).tl);
calls.length = 0;
await translate("这是一段中文，需要翻译成英文", auto);
ok(JSON.parse(calls[0].opts.body).tl === "en", "中文原文 → 译成英文", JSON.parse(calls[0].opts.body).tl);
calls.length = 0;
await translate("これは日本語です", auto);
ok(JSON.parse(calls[0].opts.body).tl === "en", "日文原文 → 也译成英文", JSON.parse(calls[0].opts.body).tl);
const fixed = JSON.parse(JSON.stringify(auto));
fixed.targetLang = "ja";
calls.length = 0;
await translate("Hello world", fixed);
ok(JSON.parse(calls[0].opts.body).tl === "ja", "指定了目标语言就以它为准", JSON.parse(calls[0].opts.body).tl);

console.log("\n[12] AI 多账号：切换当前账号");
const multi = JSON.parse(JSON.stringify(base));
multi.order = ["openai"];
multi.aiProviders = [
  { id: "a", name: "DeepSeek", baseUrl: "https://api.deepseek.com/v1", apiKey: "sk-a", model: "deepseek-chat" },
  { id: "b", name: "通义", baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1", apiKey: "sk-b", model: "qwen-plus" },
];
multi.activeAiId = "b";
mock = () => json({ choices: [{ message: { content: "译文B" } }] });
calls.length = 0;
r = await translate("Hello", multi);
ok(r.ok && r.account === "通义", "用的是 activeAiId 指向的账号", r.account);
ok(calls[0].url.startsWith("https://dashscope.aliyuncs.com/"), "请求打到该账号的 Base URL", calls[0].url);
multi.activeAiId = "a";
calls.length = 0;
r = await translate("Hello", multi);
ok(r.ok && r.account === "DeepSeek" && calls[0].url.startsWith("https://api.deepseek.com/"), "切换后改用另一个账号", r.account);
const legacy = JSON.parse(JSON.stringify(base));
legacy.order = ["openai"];
legacy.openai = { baseUrl: "https://api.deepseek.com/v1", apiKey: "sk-old", model: "deepseek-chat" };
calls.length = 0;
r = await translate("Hello", legacy);
ok(r.ok && r.account === "默认", "旧版单账号配置自动包装成一个账号", r.account);

console.log("\n[13] 截屏 OCR（ocrViaProxy）");
import { ocrViaProxy } from "../src/lib/engines.js";
const oc = JSON.parse(JSON.stringify(base));
oc.proxy = { url: "https://translate.example.com/translate", token: "T0KEN" };
calls.length = 0;
mock = () => json({ ok: true, text: "屏幕上的文字", engine: "qwen3.8-27b" });
let o = await ocrViaProxy("data:image/png;base64,iVBOR", oc);
ok(o.text === "屏幕上的文字" && o.engine === "qwen3.8-27b", "OCR 结果解析", o);
ok(calls[0].url === "https://translate.example.com/ocr", "地址从 /translate 换算成 /ocr", calls[0].url);
const obody = JSON.parse(calls[0].opts.body);
ok(obody.image === "data:image/png;base64,iVBOR" && obody.token === "T0KEN", "请求体带 image/token", obody);
ok(calls[0].opts.method === "POST", "用 POST", calls[0].opts.method);
// 带尾斜杠 / 不带 /translate 的地址也能换算
calls.length = 0;
const oc2 = JSON.parse(JSON.stringify(oc));
oc2.proxy = { url: "https://translate.example.com/translate/", token: "T" };
await ocrViaProxy("data:image/png;base64,X", oc2).catch(() => {});
ok(calls[0].url === "https://translate.example.com/ocr", "尾斜杠被处理", calls[0].url);
// 服务端错误透出
mock = () => json({ ok: false, error: "全部 OCR 模型失败" });
let threw = "";
try { await ocrViaProxy("data:image/png;base64,X", oc); } catch (e) { threw = e.message; }
ok(threw.includes("全部 OCR 模型失败"), "OCR 失败信息透出", threw);
// 未配置
const ocNo = JSON.parse(JSON.stringify(base));
threw = "";
try { await ocrViaProxy("data:image/png;base64,X", ocNo); } catch (e) { threw = e.message; }
ok(threw.includes("未配置翻译代理"), "缺配置给出明确报错", threw);

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
