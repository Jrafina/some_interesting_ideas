/*
 * 单词多义（词典视图）的离线单测。
 *
 * fixture 是**真实抓下来的**有道响应（tests/fixtures/dict/*.json），不是手写的假结构 ——
 * 血泪教训：之前照"文档上应该是 [词性, 义项1, ...] 数组"写成解析器，真实返回其实是
 * `i: ["v. 看，注视；观看…"]` 一条字符串，字段形状对不上就全解析成空。
 * 所以这里必须用真响应锁住形状。
 */
import { isDictCandidate, parseDict, lookupWord, formatDict } from "../src/lib/dict.js";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const fixture = (name) => JSON.parse(readFileSync(path.join(HERE, "fixtures", "dict", name + ".json"), "utf8"));

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

const calls = [];
let mock;
globalThis.fetch = async (url, opts) => {
  calls.push({ url: String(url), opts });
  return mock(String(url), opts);
};
const json = (obj) => ({ ok: true, status: 200, json: async () => obj });
const http500 = () => ({ ok: false, status: 500, json: async () => ({}) });
// 注意：lookupWord 内部有缓存，不同用例之间要换词或先清缓存
const lookupFresh = async (w) => lookupWord(w);

console.log("\n[1] 谁该进词典（isDictCandidate）");
ok(isDictCandidate("watch"), "单个英文单词 → 查词典");
ok(isDictCandidate("Watch"), "首字母大写也算（句首的大写词）");
ok(isDictCandidate("don't"), "带撇号的缩写算");
ok(isDictCandidate("well-known"), "带连字符的算");
ok(isDictCandidate("US"), "全大写缩略词算");
ok(!isDictCandidate("take off"), "两个词（有空格）→ 交给翻译");
ok(!isDictCandidate("Hello, world!"), "带标点的句子 → 交给翻译");
ok(!isDictCandidate("中国"), "中文 → 交给翻译");
ok(!isDictCandidate(""), "空串不算");
ok(!isDictCandidate("   "), "纯空白不算");
ok(!isDictCandidate("a".repeat(25)), "超长（>24）不算，避免拿整段当词查");
ok(!isDictCandidate("12345"), "纯数字不算");

console.log("\n[2] 解析真实响应：watch（v./n. 两个词性，括号内分号不能切坏）");
const watch = parseDict(fixture("watch"));
ok(!!watch, "解析出结果");
ok(watch.phonetic === "wɑːtʃ", "音标取自 usphone", watch && watch.phonetic);
ok(watch.entries.length === 2, "两个词性（v. / n.）", watch && watch.entries.map((e) => e.pos));
const wv = watch.entries.find((e) => e.pos === "v.");
const wn = watch.entries.find((e) => e.pos === "n.");
ok(!!wv && wv.defs[0] === "看，注视", "v. 第一条 = 看，注视", wv && wv.defs);
ok(!!wn && wn.defs[0] === "表，手表", "n. 第一条 = 表，手表（用户要的就是这个）", wn && wn.defs);
ok(!!wv && wv.defs.some((d) => d.startsWith("观看")), "v. 含「观看」", wv && wv.defs);
ok(watch.entries.every((e) => e.defs.length <= 3), "每个词性最多 3 条义项", watch.entries.map((e) => e.defs.length));
ok(watch.entries.every((e) => e.defs.every((d) => d.length <= 17)), "单条义项不超长（16 + 省略号）");

console.log("\n[3] 解析真实响应：light（4 个词性 + 【名】人名条要被丢掉）");
const light = parseDict(fixture("light"));
ok(!!light, "解析出结果");
ok(light.entries.length === 4, "四个词性 n./adj./v./adv.", light && light.entries.map((e) => e.pos));
ok(!JSON.stringify(light).includes("莱特"), "【名】人名条被过滤掉", light && JSON.stringify(light).slice(0, 80));
ok(light.entries.map((e) => e.pos).join(",") === "n.,adj.,v.,adv.", "词性顺序与词典一致", light && light.entries.map((e) => e.pos));
ok(light.entries[3].defs[0] === "轻装地", "adv. 义项解析正确（开头括号说明被剥掉）", light.entries[3].defs);

console.log("\n[4] 解析真实响应：WHO（整条没有词性前缀 → 宽松兜底，别退化成机器翻译的「谁」）");
const who = parseDict(fixture("WHO"));
ok(!!who, "解析出结果（没有词性前缀也认）", who);
ok(who.entries.length === 1 && who.entries[0].pos === "", "落到无语性兜底条目", who && who.entries);
ok(/世界卫生组织/.test(who.entries[0].defs.join()), "释义含「世界卫生组织」", who && who.entries[0].defs);

console.log("\n[5] 解析真实响应：asdfghjkl（词库里没有 → null，交给翻译）");
ok(parseDict(fixture("asdfghjkl")) === null, "词库查不到 → null");

console.log("\n[6] 结构异常时不能抛（宁可返回 null 走翻译）");
ok(parseDict(null) === null, "null → null");
ok(parseDict({}) === null, "空对象 → null");
ok(parseDict({ ec: {} }) === null, "ec 里没 word → null");
ok(parseDict({ ec: { word: [{ trs: [] }] } }) === null, "trs 空 → null");
ok(parseDict({ ec: { word: [{ trs: [{ tr: [{ l: { i: ["（Farrell）法雷尔（人名）"] } }] }] }] } }) === null, "只有人名条 → null");

console.log("\n[7] 解析容错：括号里的分号不能把义项切坏");
// 用短括号，避免触发 16 字截断，才能精确看到"分号有没有被切开"
const paren = parseDict({
  ec: {
    word: [
      {
        usphone: "x",
        trs: [{ tr: [{ l: { i: ["int. 嗯，好；唔（表示不确定；别的）；好吧"] } }] }],
      },
    ],
  },
});
ok(!!paren && paren.entries[0].defs.length === 3, "仍切成 3 条（括号内分号没多切出一条）", paren && paren.entries[0].defs);
ok(!!paren && paren.entries[0].defs[1] === "唔（表示不确定；别的）", "括号内的分号原样保留", paren && paren.entries[0].defs);
// 超长义项要截断得不难看：不留半截括号
const long = parseDict({
  ec: { word: [{ trs: [{ tr: [{ l: { i: ["v. 用谷歌搜索引擎搜索（某人、某事物等）的情况"] } }] }] }] },
});
ok(!!long && long.entries[0].defs[0] === "用谷歌搜索引擎搜索…", "超长义项在括号前截断、不留半截括号", long && long.entries[0].defs);

console.log("\n[8] lookupWord：请求 URL / 缓存 / 大小写 / 失败兜底");
calls.length = 0;
mock = () => json(fixture("watch"));
let r = await lookupWord("watch");
ok(!!r && r.engine === "dict" && r.engineLabel === "有道词典", "返回带引擎标记", r && r.engineLabel);
const u = decodeURIComponent(calls[0].url);
ok(calls[0].url.startsWith("https://dict.youdao.com/jsonapi?q=watch"), "请求打到有道 jsonapi", calls[0].url.slice(0, 60));
ok(u.includes('"dicts":[["ec"]]'), "只要 ec 词典（体积 1.4KB 而不是几百 KB）", u.slice(u.indexOf("dicts=")));
ok(calls[0].opts && calls[0].opts.signal, "带 AbortController 超时信号");

calls.length = 0;
await lookupWord("watch");
ok(calls.length === 0, "同一个词第二次不再请求（命中缓存）");

calls.length = 0;
await lookupWord("watch ");
ok(calls.length === 0, "首尾空格归一化后同样命中缓存");

calls.length = 0;
mock = () => json(fixture("watch"));
await lookupWord("Watch");
ok(calls.length === 0, "Watch 走小写缓存键（不再请求）");

calls.length = 0;
mock = () => json(fixture("WHO"));
const who2 = await lookupFresh("WHO");
ok(calls.length === 1 && decodeURIComponent(calls[0].url).includes("q=WHO"), "全大写保留原样查询（US/WHO 是缩略词）", calls[0].url);
ok(!!who2 && /世界卫生组织/.test(who2.entries[0].defs.join()), "WHO 查到的是世卫组织");

calls.length = 0;
mock = () => json({ ec: { word: [{ usphone: "", trs: [] }] } });
ok((await lookupFresh("zzzz")) === null, "词库没有 → null");

calls.length = 0;
mock = () => http500();
ok((await lookupFresh("qqqq")) === null, "HTTP 500 → null（不抛，交给翻译）");

calls.length = 0;
mock = () => {
  throw new Error("network down");
};
ok((await lookupFresh("wwww")) === null, "网络异常 → null（不抛，交给翻译）");

calls.length = 0;
mock = () => ({ ok: true, status: 200, json: async () => { throw new Error("bad json"); } });
ok((await lookupFresh("eeee")) === null, "响应不是 JSON → null");

console.log("\n[9] formatDict：复制按钮拿到的文本");
const txt = formatDict("watch", watch);
ok(txt.split("\n")[0] === "watch /wɑːtʃ/", "第一行是 词 + 音标", txt.split("\n")[0]);
ok(txt.split("\n")[1] === "v. 看，注视；观看（电视节目、比赛等）；关注", "词性 + 义项成行", txt.split("\n")[1]);
ok(formatDict("x", null) === "x", "没有词典结果时退回原文");

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
