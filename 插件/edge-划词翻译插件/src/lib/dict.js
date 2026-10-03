/**
 * 单词多义查询（"词典"视图的数据源）
 *
 * 为什么不用 AI：实测（worker/tmp/probe-dict*.cjs）让 Workers AI 生成词性+释义，
 * 快的小模型（llama-3.2-3b / llama-3.1-8b-fast，440~1300ms）会把 watch 的名词义
 * 给成"视频/时钟/电视"，就是给不出"表"；准的 qwen3-30b 要 4.6~8s，还经常把
 * token 全烧在思考块上返回空。而**真词典数据 18~27ms 就有**，且不会编。
 *
 * 数据源：有道词典的公开 jsonapi（非官方接口，但只是一个 GET，个人插件里很常见）。
 * 关键优化：带 `dicts={"count":99,"dicts":[["ec"]]}` 只要英汉词典 ——
 *   不带：130~590 KB / 47~184ms；带上：**1.2~1.5 KB / 18~27ms**，结构一样完整。
 *
 * ★ 真实响应形状（worker/tmp/probe-ec.mjs 实测，别再照文档猜）：
 *   ec.word[0].trs[].tr[].l.i = ["v. 看，注视；观看（电视节目、比赛等）；关注；…"]
 *   —— `i` 里是**一条字符串**（不是 [词性, 义项1, 义项2] 数组！），
 *      词性在最前面，后面用 `；` 分隔义项。
 *   无词性前缀的条目就是 `【名】（Light）莱特（人名）` 这种人名条，按前缀规则直接丢。
 *   查不到的词（asdfghjkl）、中文词 → **整个 `ec` 字段不存在**，返回 null 让调用方退回翻译。
 *
 * 拿不到数据时返回 null，调用方退回普通翻译，不要报错——查不到词不是错误。
 */

const ENDPOINT = "https://dict.youdao.com/jsonapi";
const EC_ONLY = JSON.stringify({ count: 99, dicts: [["ec"]] });
const TIMEOUT_DICT = 6000;

const MAX_POS = 4; // 最多展示几个词性（light 有 n./adj./v./adv./【名】 五个）
const MAX_DEFS = 3; // 每个词性最多几个义项
const MAX_DEF_LEN = 16; // 单个义项最长字符数

const CACHE_MAX = 300; // 词义基本不变，缓存整个会话；够用就行
const cache = new Map();

/**
 * 是否"查词"而不是"翻译句子"：只认单个拉丁词。
 * 多词短语、含标点的句子一律交给普通翻译，避免把句子渲染成词典。
 */
export function isDictCandidate(text) {
  const t = String(text || "").trim();
  if (!t || t.length > 24) return false;
  if (/\s/.test(t)) return false;
  return /^[A-Za-z][A-Za-z'’\-]*$/.test(t);
}

/**
 * 去噪：<史> <非正式> 这类语体标注、半角括号补充说明、以及开头的全角括号说明都没必要看。
 * 中间的**全角**括号留着（"观看（电视节目、比赛等）"是有用信息）。
 */
function stripNoise(s) {
  return String(s || "")
    .replace(/<[^>]*>/g, "")
    .replace(/\([^)]*\)/g, "")
    .replace(/^（[^）]*）/, "")
    .replace(/[\s\u00a0]+/g, " ")
    .replace(/^[,，、;；:：.。\s]+/, "")
    .replace(/[,，、;；:：.。\s]+$/, "")
    .trim();
}

function oneDef(raw, max) {
  const limit = max || MAX_DEF_LEN;
  const t = stripNoise(raw);
  if (!t) return "";
  if (t.length <= limit) return t;
  let cut = t.slice(0, limit);
  const i = cut.lastIndexOf("，");
  if (i >= 5) cut = cut.slice(0, i);
  // 别留半截括号："…搜索（某人、某事物" → "…搜索"
  const open = cut.lastIndexOf("（");
  if (open >= 0 && cut.indexOf("）", open) < 0) cut = cut.slice(0, open);
  cut = cut.replace(/[，,、；;:：.\s]+$/, "");
  return (cut || t.slice(0, limit)) + "…";
}

/**
 * 按 `；` 切义项，但**括号里的 `；` 不切**。
 * 实测坑：well 的 int. 是 "嗯，好；唔，嗯，哦（表示对要说的话不确定）；…"，
 * 直接 split("；") 会把括号切开 → 生成 "哦（表示对要说的话不确定" 这种残条。
 */
function splitDefs(s) {
  const out = [];
  let buf = "";
  let depth = 0;
  for (const ch of String(s || "")) {
    if (ch === "（" || ch === "(") depth++;
    else if (ch === "）" || ch === ")") depth = Math.max(0, depth - 1);
    if (depth === 0 && (ch === "；" || ch === ";")) {
      out.push(buf);
      buf = "";
      continue;
    }
    buf += ch;
  }
  out.push(buf);
  return out;
}

// "（Farrell）法雷尔（人名）" 这种人名义项对翻译没价值
const NAME_DEF = /（[^）]*(人名|姓氏|女子名|男子名)[^）]*）/;

const POS_RE = /^([a-z]{1,8})\.\s*/i;

/**
 * 把有道的 ec 压成 { phonetic, entries:[{pos,defs}] }。
 * 同一词性出现多次时合并义项（去重、保序）。
 */
export function parseDict(json) {
  const w = json && json.ec && json.ec.word && json.ec.word[0];
  if (!w) return null;
  const phonetic = String(w.usphone || w.ukphone || "").trim().replace(/^\/|\/$/g, "");
  const entries = [];
  const byPos = new Map();
  const loose = []; // 没有词性前缀的释义，仅当严格解析颗粒无收时启用
  for (const group of w.trs || []) {
    for (const item of group.tr || []) {
      for (const raw of (item.l && item.l.i) || []) {
        const text = String(raw || "");
        const line = stripNoise(text);
        if (!line) continue;
        const m = line.match(POS_RE);
        if (!m) {
          // 没词性前缀：带【名】标记的是人名条，丢掉；
          // 其余先备着 —— 实测 WHO → "世界卫生组织，世卫组织（World Health Organization）"
          // 整条就没有词性（abbr 也没给），退回机器翻译会得到"谁"，比留着差得多。
          if (!/^\s*【/.test(text)) {
            const d = oneDef(line, 40);
            if (d && !NAME_DEF.test(d)) loose.push(d);
          }
          continue;
        }
        const pos = m[1].toLowerCase() + ".";
        let e = byPos.get(pos);
        if (!e) {
          e = { pos, defs: [] };
          byPos.set(pos, e);
          entries.push(e);
        }
        if (e.defs.length >= MAX_DEFS) continue;
        for (const piece of splitDefs(line.slice(m[0].length))) {
          const d = oneDef(piece);
          if (!d || NAME_DEF.test(d) || e.defs.includes(d)) continue;
          e.defs.push(d);
          if (e.defs.length >= MAX_DEFS) break;
        }
      }
    }
  }
  let out = entries.filter((e) => e.defs.length).slice(0, MAX_POS);
  if (!out.length && loose.length) out = [{ pos: "", defs: loose.slice(0, MAX_DEFS) }];
  return out.length ? { phonetic, entries: out } : null;
}

async function getJson(url, timeout) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeout);
  try {
    const res = await fetch(url, { method: "GET", signal: ac.signal });
    if (!res.ok) throw new Error("HTTP " + res.status);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 查词前的规范化：**全大写要保留**（US → abbr. 美国；转成 us 就成"我们"了），
 * 其余统一小写好命中词库、也让缓存不区分 Watch/watch。
 */
function normalize(word) {
  const w = String(word || "").trim();
  return w.length >= 2 && /^[A-Z][A-Z0-9.'-]*$/.test(w) ? w : w.toLowerCase();
}

/**
 * 查一个单词的多义。查不到（不在词库 / 网络问题）返回 null，由调用方退回翻译。
 * ★ 只在扩展侧（background）调用：content script 里的 fetch 受宿主页 CORS 约束，
 *   走 background 才能稳定拿到 dict.youdao.com 的数据。
 */
export async function lookupWord(word) {
  const q = normalize(word);
  if (!q) return null;
  if (cache.has(q)) return cache.get(q);
  let out = null;
  try {
    const url = ENDPOINT + "?q=" + encodeURIComponent(q) + "&dicts=" + encodeURIComponent(EC_ONLY);
    const r = parseDict(await getJson(url, TIMEOUT_DICT));
    if (r) out = Object.assign({ engine: "dict", engineLabel: "有道词典" }, r);
  } catch (_) {
    out = null; // 网络问题也一样：退回翻译，不打扰用户
  }
  if (cache.size >= CACHE_MAX) cache.clear();
  cache.set(q, out); // 连"查不到"也缓存，避免反复打接口
  return out;
}

/** 词典视图 → 纯文本（供「复制」按钮用） */
export function formatDict(word, dict) {
  if (!dict) return String(word || "");
  const lines = [dict.phonetic ? word + " /" + dict.phonetic + "/" : word];
  for (const e of dict.entries) lines.push(e.pos + " " + e.defs.join("；"));
  return lines.join("\n");
}
