// ==================== Cloudflare Worker 入口 ====================
export default {
  async fetch(request, env, ctx) {
    try {
      const url = new URL(request.url);
      const path = url.pathname;

      // ----- 静态页面 -----
      if (path === '/') {
        return new Response(getHTML(), {
          headers: { 'Content-Type': 'text/html;charset=UTF-8' },
        });
      }

      // ----- 用户注册 -----
      if (path === '/api/register' && request.method === 'POST') {
        if (!env.KV) {
          return json({ error: '服务器未配置 KV 存储，请检查 Workers 变量绑定，绑定名必须为 "KV"' }, 500);
        }

        const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
        if (!await rateLimit(env, `reg-${ip}`, 3, 30)) {
          return json({ error: '请求过于频繁，请稍后再试' }, 429);
        }

        try {
          const { email, password } = await request.json();
          if (!email || !password) return json({ error: '邮箱和密码不能为空' }, 400);
          const emailLower = email.toLowerCase();
          const key = `user:${emailLower}`;
          const existing = await env.KV.get(key);
          if (existing) return json({ error: '该邮箱已注册' }, 409);
          const hash = await hashPassword(password, env);
          const userData = { passwordHash: hash, totps: [] };
          await env.KV.put(key, JSON.stringify(userData));
          return json({ ok: true });
        } catch (e) {
          return json({ error: e.message || '注册失败' }, 500);
        }
      }

      // ----- 服务器时间（前端用来检测本机时钟偏差）-----
      if (path === '/api/time') {
        return json({ now: Math.floor(Date.now() / 1000), iso: new Date().toISOString() });
      }

      // ----- 用户登录 -----
      if (path === '/api/login' && request.method === 'POST') {
        if (!env.KV) {
          return json({ error: '服务器未配置 KV 存储，请检查 Workers 变量绑定，绑定名必须为 "KV"' }, 500);
        }

        try {
          const { email, password } = await request.json();
          if (!email || !password) return json({ error: '邮箱和密码不能为空' }, 400);
          const emailLower = email.toLowerCase();
          const key = `user:${emailLower}`;
          const raw = await env.KV.get(key);
          if (!raw) return json({ error: '邮箱未注册' }, 401);
          const userData = JSON.parse(raw);
          const valid = await verifyPassword(password, userData.passwordHash, env);
          if (!valid) return json({ error: '密码错误' }, 401);
          const token = crypto.randomUUID();
          await env.KV.put(`session:${token}`, emailLower, { expirationTtl: 7 * 86400 });
          return json({ token }, 200, {
            'Set-Cookie': `token=${token}; HttpOnly; Path=/; Max-Age=604800; SameSite=Strict; Secure`,
          });
        } catch (e) {
          return json({ error: e.message || '登录失败' }, 500);
        }
      }

      // ----- 用户登出 -----
      if (path === '/api/logout') {
        const token = getCookie(request, 'token');
        if (token && env.KV) await env.KV.delete(`session:${token}`);
        return json({ ok: true }, 200, {
          'Set-Cookie': 'token=; HttpOnly; Path=/; Max-Age=0; SameSite=Strict; Secure',
        });
      }

      // ----- 获取当前用户信息 -----
      if (path === '/api/user') {
        const email = await authenticate(request, env);
        if (!email) return json({ error: '未登录' }, 401);
        return json({ email });
      }

      // ----- 获取当前用户的 TOTP 列表，并自动补全元数据 -----
      if (path === '/api/list') {
        const email = await authenticate(request, env);
        if (!email) return json({ error: '未登录' }, 401);
        const key = `user:${email}`;
        const raw = await env.KV.get(key);
        if (!raw) {
          const token = getCookie(request, 'token');
          if (token) await env.KV.delete(`session:${token}`);
          return json({ error: '用户数据不存在，请重新注册' }, 401);
        }
        const userData = JSON.parse(raw);
        const totps = userData.totps || [];

        // 统一密钥写法（去空格 / 去 = 补位 / 转大写），并给老数据补上缺省参数
        let changed = false;
        for (const item of totps) {
          const canonical = canonicalSecret(item.secret);
          if (canonical !== item.secret) {
            item.secret = canonical;
            changed = true;
          }
          if (item.algorithm !== normalizeAlgorithm(item.algorithm)) {
            item.algorithm = normalizeAlgorithm(item.algorithm);
            changed = true;
          }
          if (item.digits !== normalizeDigits(item.digits)) {
            item.digits = normalizeDigits(item.digits);
            changed = true;
          }
          if (item.period !== normalizePeriod(item.period)) {
            item.period = normalizePeriod(item.period);
            changed = true;
          }
        }

        // 自动补全缺失/过期的元数据（单条目页面靠它拿参数）
        for (const item of totps) {
          const metaKey = `totpmeta:${item.secret}`;
          const meta = JSON.stringify({
            label: item.label,
            issuer: item.issuer || '',
            algorithm: item.algorithm,
            digits: item.digits,
            period: item.period,
          });
          if (await env.KV.get(metaKey) !== meta) await env.KV.put(metaKey, meta);
        }

        if (changed) await env.KV.put(key, JSON.stringify(userData));

        return json(totps);
      }

      // ----- 添加 TOTP -----
      if (path === '/api/add' && request.method === 'POST') {
        const email = await authenticate(request, env);
        if (!email) return json({ error: '未登录' }, 401);
        try {
          const body = await request.json();
          const label = String(body.label || '').trim();
          const issuer = String(body.issuer || '').trim();
          const algorithm = normalizeAlgorithm(body.algorithm);
          const digits = normalizeDigits(body.digits);
          const period = normalizePeriod(body.period);
          const secret = canonicalSecret(body.secret);

          if (!secret || !label) return json({ error: '密钥和名称不能为空' }, 400);
          if (!isValidSecret(secret)) {
            return json({ error: '密钥格式不正确：Base32 只允许 A-Z 和 2-7，请检查是否混进了数字 0/1、连字符或其他字符（Google 验证器同样会拒收这种密钥）' }, 400);
          }
          if (secret.length < 16) {
            return json({ error: '密钥太短：Base32 密钥一般至少 16 个字符（80 位）' }, 400);
          }

          const userKey = `user:${email}`;
          const raw = await env.KV.get(userKey);
          if (!raw) return json({ error: '用户数据不存在，请重新登录' }, 401);
          const userData = JSON.parse(raw);

          // 同一密钥重复添加时覆盖参数，避免同一账号在列表里出现两条
          const dup = (userData.totps || []).find(t => canonicalSecret(t.secret) === secret);
          if (dup) {
            dup.secret = secret;
            dup.label = label;
            dup.issuer = issuer;
            dup.algorithm = algorithm;
            dup.digits = digits;
            dup.period = period;
            await env.KV.put(userKey, JSON.stringify(userData));
            await env.KV.put(`totpmeta:${secret}`, JSON.stringify({ label, issuer, algorithm, digits, period }));
            return json({ id: dup.id, updated: true });
          }

          const newItem = {
            id: crypto.randomUUID(),
            secret,
            label,
            issuer,
            algorithm,
            digits,
            period,
          };
          userData.totps.push(newItem);
          await env.KV.put(userKey, JSON.stringify(userData));

          // 存储密钥到元数据的映射，供单条目页面使用
          await env.KV.put(`totpmeta:${secret}`, JSON.stringify({ label, issuer, algorithm, digits, period }));

          return json({ id: newItem.id });
        } catch (e) {
          return json({ error: e.message || '添加失败' }, 500);
        }
      }

      // ----- 删除 TOTP -----
      if (path === '/api/delete' && request.method === 'DELETE') {
        const email = await authenticate(request, env);
        if (!email) return json({ error: '未登录' }, 401);
        const id = url.searchParams.get('id');
        if (!id) return json({ error: '缺少 id' }, 400);
        const userKey = `user:${email}`;
        const raw = await env.KV.get(userKey);
        if (!raw) return json({ error: '用户数据不存在，请重新登录' }, 401);
        const userData = JSON.parse(raw);
        const removed = userData.totps.find(item => item.id === id);
        if (removed) {
          userData.totps = userData.totps.filter(item => item.id !== id);
          await env.KV.put(userKey, JSON.stringify(userData));

          // 同步删除元数据映射
          await env.KV.delete(`totpmeta:${removed.secret}`);
        }
        return json({ ok: true });
      }

      // ----- 生成分享链接 -----
      if (path === '/api/share' && request.method === 'POST') {
        const email = await authenticate(request, env);
        if (!email) return json({ error: '未登录' }, 401);
        try {
          const { ids } = await request.json();
          if (!Array.isArray(ids) || ids.length === 0) {
            return json({ error: '请选择至少一个账户' }, 400);
          }
          const userKey = `user:${email}`;
          const raw = await env.KV.get(userKey);
          if (!raw) return json({ error: '用户数据不存在，请重新登录' }, 401);
          const userData = JSON.parse(raw);
          const selected = userData.totps.filter(t => ids.includes(t.id));
          if (selected.length === 0) return json({ error: '未找到所选账户' }, 400);

          // 生成 32 位随机密钥（16 字节十六进制）
          const bytes = crypto.getRandomValues(new Uint8Array(16));
          const shareKey = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');

          await env.KV.put(`share:${shareKey}`, JSON.stringify(
            selected.map(t => ({
              label: t.label,
              issuer: t.issuer || '',
              secret: canonicalSecret(t.secret),
              algorithm: normalizeAlgorithm(t.algorithm),
              digits: normalizeDigits(t.digits),
              period: normalizePeriod(t.period),
            }))
          ), { expirationTtl: 7 * 86400 });

          return json({ url: `${url.origin}/s/${shareKey}` });
        } catch (e) {
          return json({ error: e.message || '生成失败' }, 500);
        }
      }

      // ----- 分享链接页面（无需登录）-----
      const shareMatch = path.match(/^\/s\/([a-f0-9]{32})\/?$/i);
      if (shareMatch) {
        const shareKey = shareMatch[1].toLowerCase();
        const raw = await env.KV.get(`share:${shareKey}`);
        if (!raw) {
          return new Response(getShareErrorHTML(), {
            headers: { 'Content-Type': 'text/html;charset=UTF-8' },
          });
        }
        let shareAccounts = [];
        try {
          shareAccounts = JSON.parse(raw);
        } catch (e) {
          shareAccounts = [];
        }
        return new Response(getShareHTML(shareAccounts), {
          headers: { 'Content-Type': 'text/html;charset=UTF-8' },
        });
      }

      // ----- 单条目 TOTP 验证码页面（无需登录）-----
      const secretMatch = path.match(/^\/([A-Z2-7]{16,64}=*)\/?$/i);
      if (secretMatch) {
        const secret = canonicalSecret(secretMatch[1]);

        // 从 KV 中获取密钥对应的账号与参数（也允许用 ?algorithm=&digits=&period= 临时覆盖）
        let label = '';
        let issuer = '';
        let algorithm = '';
        let digits = '';
        let period = '';
        try {
          const metaRaw = await env.KV.get(`totpmeta:${secret}`);
          if (metaRaw) {
            const meta = JSON.parse(metaRaw);
            label = meta.label || '';
            issuer = meta.issuer || '';
            algorithm = meta.algorithm || '';
            digits = meta.digits || '';
            period = meta.period || '';
          }
        } catch (e) {
          // 忽略解析错误，使用默认空值
        }
        algorithm = url.searchParams.get('algorithm') || algorithm;
        digits = url.searchParams.get('digits') || digits;
        period = url.searchParams.get('period') || period;

        return new Response(getSingleHTML(secret, label, issuer, algorithm, digits, period), {
          headers: { 'Content-Type': 'text/html;charset=UTF-8' },
        });
      }

      return new Response('Not Found', { status: 404 });

    } catch (error) {
      console.error('Worker exception:', error.stack || error.message);
      return json({ error: `服务器内部错误: ${error.message || '未知错误'}` }, 500);
    }
  },
};

// ==================== 辅助函数 ====================
function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json;charset=UTF-8', ...extraHeaders },
  });
}

function getCookie(request, name) {
  const cookies = request.headers.get('Cookie') || '';
  const match = cookies.match(new RegExp(`(?:^|;)\\s*${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

async function authenticate(request, env) {
  const token = getCookie(request, 'token');
  if (!token) return null;
  const email = await env.KV.get(`session:${token}`);
  return email ? email.toLowerCase() : null;
}

async function rateLimit(env, key, max, windowSeconds) {
  const now = Math.floor(Date.now() / 1000);
  try {
    const record = await env.KV.get(`rate:${key}`);
    if (record) {
      let parsed;
      try {
        parsed = JSON.parse(record);
      } catch (e) {
        await env.KV.put(`rate:${key}`, JSON.stringify({ count: 1, reset: now + windowSeconds }), { expirationTtl: windowSeconds });
        return true;
      }
      const { count, reset } = parsed;
      if (now < reset) {
        if (count >= max) return false;
        await env.KV.put(`rate:${key}`, JSON.stringify({ count: count + 1, reset }), { expirationTtl: windowSeconds });
        return true;
      }
    }
    await env.KV.put(`rate:${key}`, JSON.stringify({ count: 1, reset: now + windowSeconds }), { expirationTtl: windowSeconds });
    return true;
  } catch (e) {
    console.error('Rate limit error:', e);
    return true;
  }
}

async function hashPassword(password, env) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const saltHex = Array.from(salt, b => b.toString(16).padStart(2, '0')).join('');
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw', encoder.encode(password),
    { name: 'PBKDF2' }, false, ['deriveBits']
  );
  const derivedBits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: encoder.encode(saltHex), iterations: 100000, hash: 'SHA-256' },
    keyMaterial, 256
  );
  const hashHex = Array.from(new Uint8Array(derivedBits), b => b.toString(16).padStart(2, '0')).join('');
  return `${saltHex}:${hashHex}`;
}

async function verifyPassword(password, storedHash, env) {
  const [saltHex, originalHash] = storedHash.split(':');
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw', encoder.encode(password),
    { name: 'PBKDF2' }, false, ['deriveBits']
  );
  const derivedBits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: encoder.encode(saltHex), iterations: 100000, hash: 'SHA-256' },
    keyMaterial, 256
  );
  const hashHex = Array.from(new Uint8Array(derivedBits), b => b.toString(16).padStart(2, '0')).join('');
  return hashHex === originalHash;
}

// 后端 HTML 转义函数
function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'})[m]);
}

// ==================== TOTP 参数规范化 ====================
// 密钥统一写法：去空格、去 Base32 的 = 补位、统一大写。
// Google 验证器、oathtool、RFC 6238 都是按这个形态处理密钥的。
function canonicalSecret(raw) {
  return String(raw == null ? '' : raw).replace(/\s/g, '').replace(/=+$/, '').toUpperCase();
}

// 算法：只认 SHA1 / SHA256 / SHA512，其余（含未提供）一律按 SHA-1（Google 验证器默认值）
function normalizeAlgorithm(a) {
  const s = String(a == null ? '' : a).toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (s === 'SHA256') return 'SHA-256';
  if (s === 'SHA512') return 'SHA-512';
  return 'SHA-1';
}

// 位数：只认 6 / 8
function normalizeDigits(d) {
  return Number(d) === 8 ? 8 : 6;
}

// 周期：5~300 秒，缺省或非法都按 30
function normalizePeriod(p) {
  const n = Math.floor(Number(p));
  return (Number.isFinite(n) && n >= 5 && n <= 300) ? n : 30;
}

// Base32 合法性检查：只允许 A-Z 和 2-7
function isValidSecret(secret) {
  return /^[A-Z2-7]+$/.test(secret);
}

// ==================== 下发到浏览器的 TOTP 核心 ====================
// 三个页面（列表 / 单条目 / 分享）共用同一份，避免各写一遍走样。
// 与 Google 验证器一致：支持 SHA-1 / SHA-256 / SHA-512，6 位或 8 位，可配周期。
const TOTP_CORE_JS = `
function normalizeAlgorithm(a) {
  var s = String(a == null ? '' : a).toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (s === 'SHA256') return 'SHA-256';
  if (s === 'SHA512') return 'SHA-512';
  return 'SHA-1';
}
function normalizeDigits(d) { return Number(d) === 8 ? 8 : 6; }
function normalizePeriod(p) { var n = Math.floor(Number(p)); return (isFinite(n) && n >= 5 && n <= 300) ? n : 30; }
function base32ToBuffer(base32) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  base32 = String(base32 == null ? '' : base32).replace(/\\s/g, '').replace(/=+$/, '').toUpperCase();
  for (let i = 0; i < base32.length; i++) {
    const val = alphabet.indexOf(base32[i]);
    if (val === -1) continue;
    bits += val.toString(2).padStart(5, '0');
  }
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    bytes.push(parseInt(bits.substring(i, i + 8), 2));
  }
  return new Uint8Array(bytes);
}
async function generateHOTP(keyBuffer, counter, algorithm, digits) {
  const counterBuffer = new ArrayBuffer(8);
  new DataView(counterBuffer).setBigUint64(0, BigInt(counter), false);
  const cryptoKey = await crypto.subtle.importKey(
    'raw', keyBuffer,
    { name: 'HMAC', hash: normalizeAlgorithm(algorithm) },
    false, ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', cryptoKey, counterBuffer);
  const hmac = new Uint8Array(signature);
  const offset = hmac[hmac.length - 1] & 0xf;
  const binCode = ((hmac[offset] & 0x7f) << 24) |
                  (hmac[offset + 1] << 16) |
                  (hmac[offset + 2] << 8) |
                  hmac[offset + 3];
  const d = normalizeDigits(digits);
  return String(binCode % Math.pow(10, d)).padStart(d, '0');
}
// 取"此刻"的验证码：永远基于当前时间计算，不会给出过期时间片的码
async function totpNow(secret, algorithm, digits, period) {
  const p = normalizePeriod(period);
  const now = Math.floor(Date.now() / 1000);
  return {
    code: await generateHOTP(base32ToBuffer(secret), Math.floor(now / p), algorithm, digits),
    remain: p - (now % p),
    period: p,
  };
}
`;

// ==================== 前端 HTML ====================
function getHTML() {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>自建 TOTP 验证器</title>
  <style>
    :root { --bg: #0f0f1a; --card: #1a1a2e; --accent: #2a2a4a; --text: #e0e0e0; --green: #00ff88; --red: #ff5555; --blue: #4a90ff; --gray: #888; }
    * { margin:0; padding:0; box-sizing:border-box; }
    body { background:var(--bg); color:var(--text); font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; min-height:100vh; display:flex; justify-content:center; padding:30px 20px; }
    .container { width:100%; max-width:520px; }
    h1 { text-align:center; margin-bottom:30px; font-weight:400; letter-spacing:2px; font-size:1.8rem; }
    .card { background:var(--card); border-radius:16px; padding:24px; margin-bottom:20px; box-shadow:0 8px 24px rgba(0,0,0,0.4); }
    .flex-row { display:flex; justify-content:space-between; align-items:center; margin-bottom:16px; }
    .flex-row span { font-size:1.2rem; font-weight:500; }
    a { color:var(--green); text-decoration:none; font-size:0.95rem; }
    a:hover { text-decoration:underline; }
    input { width:100%; padding:12px 14px; margin-bottom:14px; border:1px solid #333; border-radius:8px; background:#12121f; color:#fff; font-size:1rem; transition: border-color 0.2s; }
    input:focus { border-color:var(--green); outline:none; }
    button { width:100%; padding:12px; border:none; border-radius:8px; font-size:1rem; font-weight:600; cursor:pointer; transition: all 0.2s; }
    .btn-primary { background:var(--green); color:#000; }
    .btn-primary:hover { filter: brightness(1.1); }
    .btn-danger { background:var(--red); color:#fff; }
    .btn-danger:hover { filter: brightness(1.1); }
    .btn-small { width:auto; padding:6px 14px; font-size:0.9rem; }
    .hidden { display:none !important; }
    .error-msg { color:var(--red); font-size:0.9rem; margin-top:4px; white-space: pre-wrap; }
    .add-btn { background: var(--green); color: #000; font-weight:bold; margin-bottom:20px; }
    .share-bar { display:flex; align-items:center; margin-bottom:20px; }
    .share-bar .btn-primary { width:auto; padding:10px 18px; margin:0; }
    .share-bar span { color:var(--gray); font-size:0.9rem; margin-left:10px; }
    input.acc-check { width:20px !important; height:20px; padding:0; margin:6px 12px 0 0; accent-color:var(--green); cursor:pointer; flex-shrink:0; }
    .account { background: var(--card); border-radius:16px; padding:18px; margin-bottom:16px; box-shadow:0 4px 12px rgba(0,0,0,0.3); display: flex; align-items: flex-start; justify-content: space-between; transition: transform 0.2s; }
    .account:hover { transform: translateY(-2px); }
    .info { flex: 1; min-width: 0; }
    .issuer { font-size:0.85rem; color: var(--gray); text-transform: uppercase; letter-spacing:1px; margin-bottom:4px; }
    .label { font-size:1.2rem; font-weight:500; margin-bottom:6px; word-break: break-all; color: #fff; }
    .link-row { display: flex; align-items: center; gap: 8px; margin: 6px 0; font-size:0.85rem; }
    .link-row .link-text { flex: 1; color: var(--gray); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; user-select: all; }
    .copy-link-btn { background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.15); border-radius: 6px; color: var(--gray); cursor: pointer; padding: 4px 8px; font-size:0.9rem; transition: all 0.2s; }
    .copy-link-btn:hover { background: rgba(255,255,255,0.12); color: #fff; border-color: var(--green); }
    .copy-link-btn.copied { background: rgba(0,255,136,0.15); color: var(--green); border-color: var(--green); }
    .code-row { display: flex; align-items: center; gap: 10px; margin: 10px 0 6px; }
    .code { font-size: 2.4rem; font-weight: 700; letter-spacing: 6px; color: var(--green); font-family: 'Courier New', monospace; line-height: 1; }
    .copy-btn { width: auto; padding: 6px 12px; font-size: 1.1rem; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.15); border-radius: 8px; color: var(--gray); cursor: pointer; transition: all 0.2s; display: flex; align-items: center; justify-content: center; min-width: 44px; }
    .copy-btn:hover { background: rgba(255,255,255,0.12); color: #fff; border-color: var(--green); }
    .copy-btn.copied { background: rgba(0,255,136,0.15); color: var(--green); border-color: var(--green); }
    .timer { font-size:0.85rem; color: var(--gray); margin-top:4px; }
    .params { font-size:0.8rem; color: var(--blue); margin-bottom:6px; }
    .skew { text-align:center; font-size:0.85rem; color: var(--gray); margin:-16px 0 18px; }
    .skew.warn { color:#ffb86b; }
    .skew.bad { color: var(--red); font-weight:600; }
    .param-row { display:flex; gap:8px; }
    .progress { height:4px; background: var(--accent); border-radius:2px; margin-top:8px; overflow:hidden; }
    .progress-bar { height:100%; background: var(--green); transition: width 1s linear; border-radius:2px; }
    .delete-btn { width: auto; padding: 6px 10px; background: none; border: none; color: #f55; font-size: 1.4rem; cursor: pointer; margin-left: 12px; opacity: 0.7; }
    .delete-btn:hover { opacity: 1; }
    .modal { display:none; position:fixed; top:0; left:0; right:0; bottom:0; background:rgba(0,0,0,0.7); align-items:center; justify-content:center; z-index:10; }
    .modal.active { display:flex; }
    .modal-content { background:var(--card); padding:24px; border-radius:16px; width:90%; max-width:420px; }
    .tabs { display:flex; margin-bottom:20px; border-bottom:1px solid #333; }
    .tab { flex:1; text-align:center; padding:10px; cursor:pointer; color:var(--gray); font-weight:500; transition:0.2s; }
    .tab.active { color:#fff; border-bottom:2px solid var(--green); }
    #qr-video { width:100%; border-radius:8px; }
    #qr-result { margin-top:8px; color:var(--green); font-size:0.9rem; }
  </style>
</head>
<body>
<div class="container">
  <h1>🔐 自建 TOTP</h1>
  <div id="clock-skew" class="skew hidden"></div>

  <!-- 登录表单 -->
  <div id="login-box" class="card hidden">
    <div class="flex-row">
      <span>登录</span>
      <a href="javascript:void(0)" onclick="showRegister()">注册新账号</a>
    </div>
    <input type="email" id="login-email" placeholder="邮箱" autocomplete="email">
    <input type="password" id="login-password" placeholder="密码" autocomplete="current-password">
    <button class="btn-primary" onclick="login()">登录</button>
    <div id="login-error" class="error-msg"></div>
  </div>

  <!-- 注册表单 -->
  <div id="register-box" class="card hidden">
    <div class="flex-row">
      <span>注册</span>
      <a href="javascript:void(0)" onclick="showLogin()">已有账号？登录</a>
    </div>
    <input type="email" id="reg-email" placeholder="邮箱" autocomplete="email">
    <input type="password" id="reg-password" placeholder="密码" autocomplete="new-password">
    <input type="password" id="reg-password2" placeholder="确认密码" autocomplete="new-password">
    <button class="btn-primary" onclick="register()">注册</button>
    <div id="reg-error" class="error-msg"></div>
  </div>

  <!-- 已登录区域 -->
  <div id="main-box" class="hidden">
    <div class="flex-row">
      <span id="user-email"></span>
      <button class="btn-small btn-danger" onclick="logout()">退出登录</button>
    </div>
    <button class="btn-primary add-btn" onclick="openModal()">＋ 添加账户</button>
    <div class="share-bar">
      <button class="btn-primary" onclick="generateShareLink()">🔗 生成分享链接</button>
      <span id="share-count">未选择账户</span>
    </div>
    <div id="share-result" class="card hidden">
      <div class="flex-row" style="margin-bottom:10px;">
        <span style="font-size:1rem;">分享链接（7 天内有效，打开即可查看验证码）</span>
        <button class="btn-small" style="background:var(--green); color:#000;" onclick="copyShareLink()">📋 复制</button>
      </div>
      <div class="link-row">
        <span class="link-text" id="share-link"></span>
      </div>
    </div>
    <div id="accounts"></div>
  </div>
</div>

<!-- 添加账户弹窗 -->
<div class="modal" id="modal">
  <div class="modal-content">
    <div class="tabs">
      <div class="tab active" onclick="switchTab('scan')">📷 扫码</div>
      <div class="tab" onclick="switchTab('manual')">⌨️ 手动</div>
    </div>
    <div id="scan-tab">
      <p style="color:var(--gray); font-size:0.9rem;">对准二维码，或上传截图</p>
      <video id="qr-video" autoplay playsinline class="hidden"></video>
      <canvas id="qr-canvas" class="hidden"></canvas>
      <input type="file" accept="image/*" id="qr-file" onchange="parseQRFile()" style="margin-top:10px;">
      <div id="qr-result"></div>
    </div>
    <div id="manual-tab" class="hidden">
      <input type="text" id="man-label" placeholder="账户名（如 you@gmail.com）">
      <input type="text" id="man-issuer" placeholder="发行者（如 Google，可留空）">
      <input type="text" id="man-secret" placeholder="密钥（Base32 字符串）">
      <div class="param-row">
        <input type="text" id="man-algo" placeholder="算法 SHA1" value="SHA1">
        <input type="text" id="man-digits" placeholder="位数 6" value="6">
        <input type="text" id="man-period" placeholder="周期秒 30" value="30">
      </div>
      <p style="color:var(--gray); font-size:0.85rem; margin-top:-8px; margin-bottom:12px;">或粘贴 otpauth 链接（会自动填好上面的算法/位数/周期）</p>
      <input type="text" id="man-uri" placeholder="otpauth://totp/...">
    </div>
    <button class="btn-primary" style="margin-top:12px;" onclick="addAccount()">保存</button>
    <button style="background:#3a3a5a; border:none; color:#fff; padding:10px; border-radius:8px; width:100%; margin-top:8px;" onclick="closeModal()">取消</button>
  </div>
</div>

<script src="https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.min.js"></script>
<script>
// ==================== 全局状态 ====================
let accounts = [];
let currentUser = null;
let videoStream = null;
let currentTab = 'scan';

async function init() {
  const res = await fetch('/api/user');
  if (res.ok) {
    currentUser = await res.json();
    document.getElementById('user-email').textContent = currentUser.email;
    document.getElementById('main-box').classList.remove('hidden');
    document.getElementById('login-box').classList.add('hidden');
    document.getElementById('register-box').classList.add('hidden');
    loadAccounts();
  } else {
    showLogin();
  }
}
init();
checkClockSkew();
setInterval(checkClockSkew, 60000);

function showLogin() {
  document.getElementById('login-box').classList.remove('hidden');
  document.getElementById('register-box').classList.add('hidden');
  document.getElementById('main-box').classList.add('hidden');
  document.getElementById('login-error').textContent = '';
}
function showRegister() {
  document.getElementById('register-box').classList.remove('hidden');
  document.getElementById('login-box').classList.add('hidden');
  document.getElementById('main-box').classList.add('hidden');
  document.getElementById('reg-error').textContent = '';
}

// 通用请求函数
async function apiFetch(url, options) {
  let res;
  try {
    res = await fetch(url, options);
  } catch (e) {
    throw new Error('网络请求失败: ' + e.message);
  }

  let data;
  const contentType = res.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    try {
      data = await res.json();
    } catch (e) {
      throw new Error('响应解析失败: ' + e.message);
    }
  } else {
    const text = await res.text();
    data = { error: text || ('HTTP ' + res.status) };
  }

  if (!res.ok) {
    throw new Error(data.error || ('请求失败 (HTTP ' + res.status + ')'));
  }
  return data;
}

async function login() {
  const email = document.getElementById('login-email').value.trim();
  const password = document.getElementById('login-password').value;
  const errEl = document.getElementById('login-error');
  if (!email || !password) {
    errEl.textContent = '请填写邮箱和密码';
    return;
  }
  try {
    await apiFetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    errEl.textContent = '';
    location.reload();
  } catch (e) {
    errEl.textContent = e.message;
  }
}

async function register() {
  const email = document.getElementById('reg-email').value.trim();
  const password = document.getElementById('reg-password').value;
  const password2 = document.getElementById('reg-password2').value;
  const regBtn = document.querySelector('#register-box .btn-primary');
  const errEl = document.getElementById('reg-error');

  if (!email || !password) {
    errEl.textContent = '请填写邮箱和密码';
    return;
  }
  if (password !== password2) {
    errEl.textContent = '两次密码不一致';
    return;
  }

  regBtn.disabled = true;
  regBtn.textContent = '注册中...';

  try {
    await apiFetch('/api/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    errEl.textContent = '';
    await loginHelper(email, password);
  } catch (e) {
    errEl.textContent = e.message;
  } finally {
    regBtn.disabled = false;
    regBtn.textContent = '注册';
  }
}

async function loginHelper(email, password) {
  try {
    await apiFetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    location.reload();
  } catch (e) {
    showLogin();
    document.getElementById('login-error').textContent = '注册成功但自动登录失败，请手动登录';
  }
}

async function logout() {
  try {
    await apiFetch('/api/logout', { method: 'POST' });
  } catch (e) {}
  location.reload();
}

async function loadAccounts() {
  try {
    const data = await apiFetch('/api/list');
    accounts = data;
    render();
  } catch (e) {
    alert('加载失败: ' + e.message);
    location.reload();
  }
}

let updateInterval;
let totpCache = new Map();

async function refreshTOTP(a) {
  const r = await totpNow(a.secret, a.algorithm, a.digits, a.period);
  totpCache.set(a.id, r);
}

async function render() {
  const container = document.getElementById('accounts');
  if (accounts.length === 0) {
    container.innerHTML = '<p style="color:var(--gray); text-align:center; padding:30px;">暂无账户，点击上方按钮添加</p>';
    updateShareCount();
    return;
  }
  await Promise.all(accounts.map(a => refreshTOTP(a)));
  container.innerHTML = accounts.map(a => {
    const data = totpCache.get(a.id);
    const singleLink = window.location.origin + '/' + a.secret;
    const algo = normalizeAlgorithm(a.algorithm);
    const dig = normalizeDigits(a.digits);
    const per = normalizePeriod(a.period);
    const isDefault = (algo === 'SHA-1' && dig === 6 && per === 30);
    const paramLine = isDefault ? '' : '<div class="params">参数：' + algo + ' / ' + dig + ' 位 / ' + per + ' 秒</div>';
    return \`
      <div class="account" id="acc-\${a.id}">
        <input type="checkbox" class="acc-check" data-id="\${a.id}" onchange="updateShareCount()" title="勾选后生成分享链接">
        <div class="info">
          <div class="issuer">\${escapeHtml(a.issuer) || '未分类'}</div>
          <div class="label">\${escapeHtml(a.label)}</div>
          \${paramLine}
          <div class="link-row">
            <span class="link-text" id="link-\${a.id}" title="\${singleLink}">\${singleLink}</span>
            <button class="copy-link-btn" onclick="copyLink(this, 'link-\${a.id}')">📋 复制链接</button>
          </div>
          <div class="code-row">
            <span class="code" id="code-\${a.id}">\${data.code}</span>
            <button class="copy-btn" data-code-id="code-\${a.id}" onclick="copyCode(this, 'code-\${a.id}')">📋</button>
          </div>
          <div class="timer">⏳ 剩余 <span id="remain-\${a.id}">\${data.remain}</span> 秒</div>
          <div class="progress"><div class="progress-bar" id="bar-\${a.id}" style="width:\${(data.remain/data.period)*100}%"></div></div>
        </div>
        <button class="delete-btn" onclick="deleteAccount('\${a.id}')" title="删除">✕</button>
      </div>
    \`;
  }).join('');
  updateShareCount();
  scheduleUpdates();
}

async function copyCode(btn, codeId) {
  const codeEl = document.getElementById(codeId);
  if (!codeEl) return;
  const code = codeEl.textContent;
  try {
    await navigator.clipboard.writeText(code);
    btn.classList.add('copied');
    btn.textContent = '✅';
    setTimeout(() => {
      btn.classList.remove('copied');
      btn.textContent = '📋';
    }, 1500);
  } catch (err) {
    const textarea = document.createElement('textarea');
    textarea.value = code;
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand('copy');
    document.body.removeChild(textarea);
    alert('已复制到剪贴板');
  }
}

async function copyLink(btn, linkId) {
  const linkEl = document.getElementById(linkId);
  if (!linkEl) return;
  const link = linkEl.textContent;
  try {
    await navigator.clipboard.writeText(link);
    btn.classList.add('copied');
    btn.textContent = '✅ 已复制';
    setTimeout(() => {
      btn.classList.remove('copied');
      btn.textContent = '📋 复制链接';
    }, 1500);
  } catch (err) {
    const textarea = document.createElement('textarea');
    textarea.value = link;
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand('copy');
    document.body.removeChild(textarea);
    alert('已复制到剪贴板');
  }
}

function scheduleUpdates() {
  clearInterval(updateInterval);
  // 每秒都用「当前时间」重算一次：和 Google 验证器一样，界面上永远是当前时间片的码，
  // 不会出现「时间片翻了、界面还停在上一个码」这种被服务端拒绝的情况。
  const paint = async () => {
    for (const a of accounts) {
      const r = await totpNow(a.secret, a.algorithm, a.digits, a.period);
      totpCache.set(a.id, r);
      const codeEl = document.getElementById('code-' + a.id);
      const remainEl = document.getElementById('remain-' + a.id);
      const barEl = document.getElementById('bar-' + a.id);
      if (codeEl) codeEl.textContent = r.code;
      if (remainEl) remainEl.textContent = r.remain;
      if (barEl) barEl.style.width = (r.remain / r.period) * 100 + '%';
    }
  };
  updateInterval = setInterval(paint, 1000);
  if (!scheduleUpdates.bound) {
    scheduleUpdates.bound = true;
    // 浏览器会节流后台标签的定时器；切回前台时立刻重算，避免读到过期验证码
    document.addEventListener('visibilitychange', () => { if (!document.hidden) paint(); });
    window.addEventListener('focus', () => paint());
  }
}

// 本机时钟与服务器时间的偏差：差 30 秒以上就会算到别的时间片上，验证码必然不被接受
async function checkClockSkew() {
  const el = document.getElementById('clock-skew');
  if (!el) return;
  try {
    const data = await apiFetch('/api/time');
    const skew = data.now - Math.floor(Date.now() / 1000);
    el.classList.remove('hidden');
    if (Math.abs(skew) >= 30) {
      el.className = 'skew bad';
      el.textContent = '⚠️ 本机时钟比服务器' + (skew > 0 ? '慢' : '快') + ' ' + Math.abs(skew) + ' 秒，验证码会算到错误的时间片，请先校准系统时间';
    } else if (Math.abs(skew) >= 5) {
      el.className = 'skew warn';
      el.textContent = '本机时钟与服务器相差 ' + skew + ' 秒，建议校准（超过 30 秒会导致验证码被拒）';
    } else {
      el.className = 'skew';
      el.textContent = '时钟正常：与服务器相差 ' + skew + ' 秒';
    }
  } catch (e) {
    el.classList.add('hidden');
  }
}

async function deleteAccount(id) {
  if (!confirm('确定删除这个账户吗？')) return;
  try {
    await apiFetch(\`/api/delete?id=\${id}\`, { method: 'DELETE' });
    accounts = accounts.filter(a => a.id !== id);
    render();
  } catch (e) {
    alert('删除失败: ' + e.message);
  }
}

function updateShareCount() {
  const count = document.querySelectorAll('.acc-check:checked').length;
  document.getElementById('share-count').textContent = count > 0 ? '已选择 ' + count + ' 个账户' : '未选择账户';
}

async function generateShareLink() {
  const ids = [...document.querySelectorAll('.acc-check:checked')].map(cb => cb.dataset.id);
  if (ids.length === 0) {
    alert('请先勾选至少一个账户');
    return;
  }
  try {
    const data = await apiFetch('/api/share', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids }),
    });
    document.getElementById('share-link').textContent = data.url;
    document.getElementById('share-result').classList.remove('hidden');
    document.getElementById('share-result').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  } catch (e) {
    alert('生成失败: ' + e.message);
  }
}

async function copyShareLink() {
  const link = document.getElementById('share-link').textContent;
  if (!link) return;
  try {
    await navigator.clipboard.writeText(link);
    alert('链接已复制');
  } catch (err) {
    const textarea = document.createElement('textarea');
    textarea.value = link;
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand('copy');
    document.body.removeChild(textarea);
    alert('链接已复制');
  }
}

function openModal() { document.getElementById('modal').classList.add('active'); switchTab('scan'); stopCamera(); }
function closeModal() { document.getElementById('modal').classList.remove('active'); stopCamera(); }
function switchTab(tab) {
  currentTab = tab;
  document.querySelectorAll('.tab').forEach((el,i) => el.classList.toggle('active', (i===0&&tab==='scan')||(i===1&&tab==='manual')));
  document.getElementById('scan-tab').classList.toggle('hidden', tab!=='scan');
  document.getElementById('manual-tab').classList.toggle('hidden', tab!=='manual');
  if (tab === 'scan') startCamera();
  else stopCamera();
}
async function startCamera() {
  const video = document.getElementById('qr-video');
  const canvas = document.getElementById('qr-canvas');
  if (videoStream) return;
  try {
    videoStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
    video.srcObject = videoStream;
    video.classList.remove('hidden');
    canvas.classList.remove('hidden');
    video.play();
    scanLoop(video, canvas);
  } catch (e) {
    document.getElementById('qr-result').textContent = '摄像头错误：' + e.message;
  }
}
function stopCamera() {
  if (videoStream) {
    videoStream.getTracks().forEach(t => t.stop());
    videoStream = null;
  }
  document.getElementById('qr-video').classList.add('hidden');
  document.getElementById('qr-canvas').classList.add('hidden');
}
function scanLoop(video, canvas) {
  if (!videoStream) return;
  if (video.readyState === video.HAVE_ENOUGH_DATA) {
    const ctx = canvas.getContext('2d');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const code = jsQR(imageData.data, canvas.width, canvas.height);
    if (code) {
      document.getElementById('qr-result').textContent = '✅ 识别成功';
      handleOTPUrl(code.data);
      stopCamera();
      return;
    }
  }
  requestAnimationFrame(() => scanLoop(video, canvas));
}
function parseQRFile() {
  const file = document.getElementById('qr-file').files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = function(e) {
    const img = new Image();
    img.onload = function() {
      const canvas = document.getElementById('qr-canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0);
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const code = jsQR(imageData.data, canvas.width, canvas.height);
      if (code) {
        document.getElementById('qr-result').textContent = '✅ 识别成功';
        handleOTPUrl(code.data);
      } else {
        document.getElementById('qr-result').textContent = '❌ 未识别二维码';
      }
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}
function handleOTPUrl(uri) {
  try {
    const url = new URL(uri);
    if (url.protocol !== 'otpauth:') throw new Error('非 otpauth 协议');
    const params = new URLSearchParams(url.search);
    const secret = (params.get('secret') || '').replace(/\\s/g, '').replace(/=+$/, '').toUpperCase();
    if (!secret) throw new Error('缺少 secret');
    if (!/^[A-Z2-7]+$/.test(secret)) throw new Error('密钥含非法字符（Base32 只允许 A-Z 和 2-7），二维码可能没识别准，请重扫或改手动输入');
    let label = decodeURIComponent(url.pathname.substring(url.pathname.indexOf(':') + 1));
    if (label.startsWith('/')) label = label.substring(1);
    const issuer = params.get('issuer') || url.hostname || '';
    const algo = params.get('algorithm') || 'SHA1';
    const digits = params.get('digits') || '6';
    const period = params.get('period') || '30';
    switchTab('manual');
    document.getElementById('man-label').value = label;
    document.getElementById('man-issuer').value = issuer;
    document.getElementById('man-secret').value = secret;
    document.getElementById('man-algo').value = algo;
    document.getElementById('man-digits').value = digits;
    document.getElementById('man-period').value = period;
    closeModal();
    if (confirm(\`识别到：\${issuer ? issuer + ' - ' : ''}\${label}\n密钥：\${secret}\n参数：\${algo} / \${digits} 位 / \${period} 秒\n（请与 Google 验证器里的密钥核对，一致再保存）\n\n现在保存吗？\`)) {
      addAccount();
    } else {
      openModal();
    }
  } catch (e) {
    alert('二维码解析失败：' + e.message);
  }
}
async function addAccount() {
  let secret, label, issuer, algorithm, digits, period;
  if (currentTab === 'manual') {
    label = document.getElementById('man-label').value.trim();
    issuer = document.getElementById('man-issuer').value.trim();
    secret = document.getElementById('man-secret').value.trim();
    algorithm = document.getElementById('man-algo').value.trim();
    digits = document.getElementById('man-digits').value.trim();
    period = document.getElementById('man-period').value.trim();
    const uri = document.getElementById('man-uri').value.trim();
    if (!secret && uri) {
      try {
        const url = new URL(uri);
        if (url.protocol === 'otpauth:') {
          const params = new URLSearchParams(url.search);
          secret = params.get('secret');
          if (!label) label = decodeURIComponent(url.pathname.split(':')[1] || '');
          if (!issuer) issuer = params.get('issuer') || '';
          algorithm = params.get('algorithm') || algorithm;
          digits = params.get('digits') || digits;
          period = params.get('period') || period;
        }
      } catch {}
    }
    if (!secret || !label) {
      alert('请至少填写账户名和密钥');
      return;
    }
    secret = secret.replace(/\\s/g, '').replace(/=+$/, '').toUpperCase();
    if (!/^[A-Z2-7]+$/.test(secret)) {
      alert('密钥格式不正确：Base32 只允许 A-Z 和 2-7。请检查是否混进了数字 0/1 或其他字符（Google 验证器同样会拒收这种密钥）。');
      return;
    }
  } else {
    alert('请先扫描二维码或手动输入');
    return;
  }
  try {
    await apiFetch('/api/add', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ secret, label, issuer, algorithm, digits, period })
    });
    closeModal();
    loadAccounts();
    ['man-label','man-issuer','man-secret','man-uri'].forEach(id => document.getElementById(id).value = '');
    document.getElementById('man-algo').value = 'SHA1';
    document.getElementById('man-digits').value = '6';
    document.getElementById('man-period').value = '30';
    document.getElementById('qr-result').textContent = '';
  } catch (e) {
    alert('添加失败: ' + e.message);
  }
}

${TOTP_CORE_JS}
function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'})[m]);
}
</script>
</body>
</html>`;
}

// ==================== 单条目 TOTP 页面 ====================
function getSingleHTML(secret, label, issuer, algorithm, digits, period) {
  const safeLabel = label ? escapeHtml(label) : '';
  const safeIssuer = issuer ? escapeHtml(issuer) : '';
  const displayTitle = safeLabel ? `${safeIssuer ? safeIssuer + ' - ' : ''}${safeLabel}` : '单条目验证码';

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${displayTitle} TOTP</title>
  <style>
    :root {
      --bg: #0f0f1a;
      --card: #1a1a2e;
      --accent: #2a2a4a;
      --text: #e0e0e0;
      --green: #00ff88;
      --gray: #888;
    }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      background: var(--bg);
      color: var(--text);
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      min-height: 100vh;
      display: flex;
      justify-content: center;
      align-items: center;
      padding: 20px;
    }
    .container { width: 100%; max-width: 400px; }
    .card {
      background: var(--card);
      border-radius: 16px;
      padding: 30px 24px;
      box-shadow: 0 8px 24px rgba(0,0,0,0.4);
      text-align: left;
    }
    .info-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 12px;
      font-size: 1rem;
    }
    .info-row .label-text {
      color: var(--gray);
      min-width: 60px;
    }
    .info-row .value-text {
      color: #fff;
      word-break: break-all;
      flex: 1;
      text-align: right;
    }
    .code-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin: 12px 0;
      background: rgba(0,0,0,0.2);
      padding: 12px;
      border-radius: 8px;
    }
    .code {
      font-size: 2.8rem;
      font-weight: 700;
      letter-spacing: 6px;
      color: var(--green);
      font-family: 'Courier New', monospace;
      line-height: 1;
    }
    .copy-btn {
      width: 48px;
      height: 48px;
      font-size: 1.4rem;
      background: rgba(255,255,255,0.05);
      border: 1px solid rgba(255,255,255,0.15);
      border-radius: 10px;
      color: var(--gray);
      cursor: pointer;
      transition: all 0.2s;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .copy-btn:hover {
      background: rgba(255,255,255,0.12);
      color: #fff;
      border-color: var(--green);
    }
    .copy-btn.copied {
      background: rgba(0,255,136,0.15);
      color: var(--green);
      border-color: var(--green);
    }
    .timer { font-size: 0.85rem; color: var(--gray); margin-top: 8px; }
    .progress {
      height: 4px;
      background: var(--accent);
      border-radius: 2px;
      margin: 16px 0 8px;
      overflow: hidden;
    }
    .progress-bar {
      height: 100%;
      background: var(--green);
      transition: width 1s linear;
      border-radius: 2px;
    }
    .secret-hint {
      font-size: 0.75rem;
      color: var(--gray);
      margin-top: 16px;
      word-break: break-all;
      opacity: 0.7;
    }
  </style>
</head>
<body>
<div class="container">
  <div class="card">
    <div class="info-row">
      <span class="label-text">账号：</span>
      <span class="value-text">${safeLabel || '未设置'}</span>
    </div>
    <div class="info-row">
      <span class="label-text">发行者：</span>
      <span class="value-text">${safeIssuer || '未设置'}</span>
    </div>
    <div class="code-row">
      <span class="code" id="code">------</span>
      <button class="copy-btn" id="copyBtn" onclick="copyCode()">📋</button>
    </div>
    <div class="info-row" style="margin-top: 8px;">
      <span class="label-text">参数：</span>
      <span class="value-text" id="params" style="color: var(--gray); font-size: 0.9rem;">---</span>
    </div>
    <div class="timer">⏳ 剩余 <span id="remain">30</span> 秒</div>
    <div class="progress"><div class="progress-bar" id="bar" style="width:100%"></div></div>
    <div class="secret-hint">密钥：${secret.slice(0, 4)}****${secret.slice(-4)}</div>
  </div>
</div>

<script>
const secret = ${JSON.stringify(secret)};
const PARAMS = ${JSON.stringify({ algorithm: normalizeAlgorithm(algorithm), digits: normalizeDigits(digits), period: normalizePeriod(period) })};

${TOTP_CORE_JS}
async function update() {
  const r = await totpNow(secret, PARAMS.algorithm, PARAMS.digits, PARAMS.period);
  document.getElementById('code').textContent = r.code;
  const paramsEl = document.getElementById('params');
  if (paramsEl) {
    const isDefault = (normalizeAlgorithm(PARAMS.algorithm) === 'SHA-1' && normalizeDigits(PARAMS.digits) === 6 && normalizePeriod(PARAMS.period) === 30);
    paramsEl.textContent = normalizeAlgorithm(PARAMS.algorithm) + ' / ' + normalizeDigits(PARAMS.digits) + ' 位 / ' + normalizePeriod(PARAMS.period) + ' 秒' + (isDefault ? '（Google 验证器默认）' : '');
  }
  document.getElementById('remain').textContent = r.remain;
  document.getElementById('bar').style.width = (r.remain / r.period * 100) + '%';
}

async function copyCode() {
  const code = document.getElementById('code').textContent;
  try {
    await navigator.clipboard.writeText(code);
    const btn = document.getElementById('copyBtn');
    btn.classList.add('copied');
    btn.textContent = '✅';
    setTimeout(() => {
      btn.classList.remove('copied');
      btn.textContent = '📋';
    }, 1500);
  } catch (err) {
    const textarea = document.createElement('textarea');
    textarea.value = code;
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand('copy');
    document.body.removeChild(textarea);
    alert('已复制');
  }
}

update();
setInterval(update, 1000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) update(); });
window.addEventListener('focus', update);
</script>
</body>
</html>`;
}

// ==================== 分享链接页面 ====================
function getShareHTML(accounts) {
  const cards = accounts.map((a, i) => `
    <div class="card">
      <div class="info-row">
        <span class="label-text">账号：</span>
        <span class="value-text">${a.label ? escapeHtml(a.label) : '未设置'}</span>
      </div>
      <div class="info-row">
        <span class="label-text">发行者：</span>
        <span class="value-text">${a.issuer ? escapeHtml(a.issuer) : '未设置'}</span>
      </div>
      <div class="info-row">
        <span class="label-text">参数：</span>
        <span class="value-text">${a.algorithm || 'SHA-1'} / ${a.digits || 6} 位 / ${a.period || 30} 秒</span>
      </div>
      <div class="code-row">
        <span class="code" id="code-${i}">------</span>
        <button class="copy-btn" id="copyBtn-${i}" onclick="copyCode(${i})">📋</button>
      </div>
      <div class="timer">⏳ 剩余 <span id="remain-${i}">30</span> 秒</div>
      <div class="progress"><div class="progress-bar" id="bar-${i}" style="width:100%"></div></div>
    </div>`).join('');

  const accountsJson = JSON.stringify(accounts.map(a => ({
    secret: canonicalSecret(a.secret),
    algorithm: normalizeAlgorithm(a.algorithm),
    digits: normalizeDigits(a.digits),
    period: normalizePeriod(a.period),
  })));

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>分享的 TOTP 验证码</title>
  <style>
    :root { --bg:#0f0f1a; --card:#1a1a2e; --accent:#2a2a4a; --text:#e0e0e0; --green:#00ff88; --gray:#888; }
    * { margin:0; padding:0; box-sizing:border-box; }
    body { background:var(--bg); color:var(--text); font-family:-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; min-height:100vh; display:flex; justify-content:center; padding:20px; }
    .container { width:100%; max-width:400px; }
    .title { text-align:center; margin-bottom:20px; font-size:1.3rem; letter-spacing:1px; }
    .hint { text-align:center; color:var(--gray); font-size:0.8rem; margin-bottom:16px; }
    .card { background:var(--card); border-radius:16px; padding:20px 20px 14px; margin-bottom:16px; box-shadow:0 8px 24px rgba(0,0,0,0.4); }
    .info-row { display:flex; justify-content:space-between; align-items:center; margin-bottom:8px; font-size:0.95rem; }
    .info-row .label-text { color:var(--gray); min-width:60px; }
    .info-row .value-text { color:#fff; word-break:break-all; flex:1; text-align:right; }
    .code-row { display:flex; align-items:center; justify-content:space-between; margin:12px 0; background:rgba(0,0,0,0.2); padding:12px; border-radius:8px; }
    .code { font-size:2.2rem; font-weight:700; letter-spacing:5px; color:var(--green); font-family:'Courier New', monospace; line-height:1; }
    .copy-btn { width:44px; height:44px; font-size:1.3rem; background:rgba(255,255,255,0.05); border:1px solid rgba(255,255,255,0.15); border-radius:10px; color:var(--gray); cursor:pointer; display:flex; align-items:center; justify-content:center; transition:all 0.2s; }
    .copy-btn:hover { background:rgba(255,255,255,0.12); color:#fff; border-color:var(--green); }
    .copy-btn.copied { background:rgba(0,255,136,0.15); color:var(--green); border-color:var(--green); }
    .timer { font-size:0.85rem; color:var(--gray); margin-top:6px; }
    .progress { height:4px; background:var(--accent); border-radius:2px; margin:10px 0 6px; overflow:hidden; }
    .progress-bar { height:100%; background:var(--green); transition:width 1s linear; border-radius:2px; }
  </style>
</head>
<body>
<div class="container">
  <div class="title">🔐 分享的 TOTP 验证码</div>
  <div class="hint">链接 7 天内有效，请勿转发给他人</div>
  ${cards || '<div class="card" style="text-align:center; color:var(--gray);">链接无效或已过期</div>'}
</div>
<script>
const accounts = ${accountsJson};

${TOTP_CORE_JS}
async function update() {
  for (let i = 0; i < accounts.length; i++) {
    const a = accounts[i];
    const r = await totpNow(a.secret, a.algorithm, a.digits, a.period);
    const codeEl = document.getElementById('code-' + i);
    const remainEl = document.getElementById('remain-' + i);
    const barEl = document.getElementById('bar-' + i);
    if (codeEl) codeEl.textContent = r.code;
    if (remainEl) remainEl.textContent = r.remain;
    if (barEl) barEl.style.width = (r.remain / r.period * 100) + '%';
  }
}

async function copyCode(i) {
  const codeEl = document.getElementById('code-' + i);
  if (!codeEl) return;
  const code = codeEl.textContent;
  try {
    await navigator.clipboard.writeText(code);
    const btn = document.getElementById('copyBtn-' + i);
    btn.classList.add('copied');
    btn.textContent = '✅';
    setTimeout(() => {
      btn.classList.remove('copied');
      btn.textContent = '📋';
    }, 1500);
  } catch (err) {
    const textarea = document.createElement('textarea');
    textarea.value = code;
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand('copy');
    document.body.removeChild(textarea);
    alert('已复制');
  }
}

update();
setInterval(update, 1000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) update(); });
window.addEventListener('focus', update);
</script>
</body>
</html>`;
}

function getShareErrorHTML() {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>链接无效</title>
  <style>
    body { background:#0f0f1a; color:#e0e0e0; font-family:-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; min-height:100vh; display:flex; align-items:center; justify-content:center; padding:20px; margin:0; }
    .box { background:#1a1a2e; border-radius:16px; padding:30px 40px; text-align:center; box-shadow:0 8px 24px rgba(0,0,0,0.4); }
    .box h2 { color:#ff5555; font-weight:400; margin-bottom:10px; }
    .box p { color:#888; font-size:0.9rem; }
  </style>
</head>
<body>
  <div class="box">
    <h2>❌ 链接不存在或已过期</h2>
    <p>请回到主页重新生成分享链接</p>
  </div>
</body>
</html>`;
}