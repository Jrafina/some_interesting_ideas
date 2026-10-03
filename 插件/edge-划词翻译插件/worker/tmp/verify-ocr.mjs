/*
 * 真·端到端验证：import 真实 worker/index.js，把 env.AI.run 接到真实 Workers AI，
 * 跑完整的 /ocr 与 /debug?ocr=1 路由。验证的是线上那份代码，不是复刻的逻辑。
 *
 *   node worker/tmp/verify-ocr.mjs [图片dataURI json]
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import worker from "../index.js";

const ACCOUNT = process.env.CF_ACCOUNT_ID;
if (!ACCOUNT) {
  console.log("请先设置环境变量 CF_ACCOUNT_ID（Cloudflare 后台的账号 ID）");
  process.exit(1);
}
const API = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/ai/run/`;
const imgJson = process.argv[2] || path.join(import.meta.dirname, "ocr-sample.json");
const image = JSON.parse(fs.readFileSync(imgJson, "utf8")).image;
const cfg = fs.readFileSync(path.join(os.homedir(), ".wrangler", "config", "default.toml"), "utf8");
const token = cfg.match(/oauth_token\s*=\s*"([^"]+)"/)[1];

const env = {
  TOKEN: "t",
  AI: {
    run: async (id, body) => {
      const t0 = Date.now();
      const r = await fetch(API + id, {
        method: "POST",
        headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const j = await r.json();
      if (j.success === false) throw new Error(JSON.stringify(j.errors).slice(0, 160));
      const p = j.result;
      const u = (p && p.usage) || {};
      console.log(`    [AI] ${id.split("/").pop()}  ${Date.now() - t0}ms  neurons=${u.neurons ?? "?"}`);
      return p;
    },
  },
};

async function call(pathname, payload) {
  const req = new Request("https://example.com" + pathname, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  const res = await worker.fetch(req, env, { waitUntil() {} });
  return { status: res.status, body: await res.json() };
}

const expect = `Quick Start Guide 使用说明
1. 双击或选中任意单词，即可弹出翻译浮窗。
2. 按 Alt+S 框选屏幕区域，可以翻译图片里的文字。
3. The screenshot OCR runs on Cloudflare Workers AI, so no local model is needed.
提示：扫描版 PDF 没有文字层，请改用截屏翻译。
联系人：Zhang San  邮箱：someone@example.com`;

(async () => {
  console.log("\n=== 1) POST /ocr（走完整回退链）===");
  const r = await call("/ocr", { token: "t", image });
  console.log("  HTTP " + r.status);
  console.log("  ok=" + r.body.ok + "  engine=" + JSON.stringify(r.body.engine));
  console.log("  text 长度=" + String(r.body.text || "").length);
  console.log("  ---- 识别结果 ----");
  console.log(String(r.body.text || "(空)").split("\n").map((l) => "  | " + l).join("\n"));
  if (r.body.trace) console.log("  trace=" + JSON.stringify(r.body.trace));

  console.log("\n=== 2) 与期望文本逐行比对 ===");
  const got = String(r.body.text || "").replace(/\s+/g, "");
  const want = expect.replace(/\s+/g, "");
  let hit = 0;
  for (const ch of want) if (got.includes(ch)) hit++;
  console.log(`  逐字命中 ${hit}/${want.length} = ${((hit / want.length) * 100).toFixed(1)}%`);
  console.log("  完全一致（忽略空白）: " + (got === want));

  console.log("\n=== 3) POST /debug?ocr=1&compare=1（两个模型各自表现）===");
  const d = await call("/debug?ocr=1&compare=1", { token: "t", image });
  for (const x of d.body.results || []) {
    console.log(`  ${x.ok ? "✓" : "✗"} ${x.model} ${x.ms}ms  ${x.ok ? "len=" + String(x.text).length : x.error}`);
  }

  console.log("\n=== 4) 非图片入参应被拒 ===");
  const bad = await call("/ocr", { token: "t", image: "not-an-image" });
  console.log(`  HTTP ${bad.status}  ${JSON.stringify(bad.body)}`);
})().catch((e) => console.log("运行失败: " + (e && e.stack || e)));
