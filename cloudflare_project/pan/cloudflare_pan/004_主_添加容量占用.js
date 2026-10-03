// ========== 002 主 Worker：D1 数据库操作日志 + 多账号 R2 聚合管理（含 Turnstile 验证 + 文件预览） ==========

// 给文件名添加五位时间戳（当天秒数 00000-86399），格式：原名_时间戳.后缀
// 若文件名已包含时间戳则不再重复添加
function addTimestamp(filename) {
  const tsPattern = /_\d{5}(\.[^.]*)?$/;
  if (tsPattern.test(filename)) return filename;
  const now = new Date();
  const secondsSinceMidnight = now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds();
  const ts = String(secondsSinceMidnight).padStart(5, '0');
  const lastDot = filename.lastIndexOf('.');
  if (lastDot <= 0) return filename + '_' + ts;
  return filename.slice(0, lastDot) + '_' + ts + filename.slice(lastDot);
}

// ========== D1 操作日志 ==========
// 记录网盘文件操作到 D1 数据库
// db: D1 数据库绑定对象 (env.D1_DB)
// ip: 客户端 IP 地址
// operation: 操作类型（下载/预览/上传/删除/新建目录/移动）
// filename: 操作的文件名或路径
// bucket: 所在桶名称
// details: 额外详情（如文件大小等）
async function logOperation(db, ip, operation, filename, bucket, details = '') {
  if (!db) return; // 未绑定 D1 则静默跳过
  try {
    const time = new Date().toISOString();
    await db.prepare(
      'INSERT INTO operation_logs (time, ip, operation, filename, bucket, details) VALUES (?, ?, ?, ?, ?, ?)'
    ).bind(time, ip, operation, filename || '', bucket || '', details || '').run();
  } catch (err) {
    // 日志记录失败不应中断主业务
    console.error('D1 日志记录失败:', err.message);
  }
}

// ========== 下载令牌（防 Referer 伪造 / 盗链） ==========
async function generateDownloadToken(secret) {
  const expiry = Math.floor(Date.now() / 1000) + 600;
  const data = new TextEncoder().encode(`${expiry}`);
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, data);
  const sigHex = Array.from(new Uint8Array(sig))
    .map(b => b.toString(16).padStart(2, '0')).join('');
  return `${expiry}:${sigHex.slice(0, 16)}`;
}

async function validateDownloadToken(token, secret) {
  try {
    const [expiryStr, sigHex] = token.split(':');
    const expiry = parseInt(expiryStr);
    if (Date.now() / 1000 > expiry) return false;
    const data = new TextEncoder().encode(`${expiry}`);
    const key = await crypto.subtle.importKey(
      'raw', new TextEncoder().encode(secret),
      { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
    );
    const sig = await crypto.subtle.sign('HMAC', key, data);
    const expectedHex = Array.from(new Uint8Array(sig))
      .map(b => b.toString(16).padStart(2, '0')).join('');
    return expectedHex.slice(0, 16) === sigHex;
  } catch { return false; }
}

// ========== 搜索索引缓存（减少 R2 Class A 操作） ==========
const INDEX_FILE = '.r2index.json';
const INDEX_TTL = 60;

async function getSearchIndex(r2) {
  try {
    const obj = await r2.get(INDEX_FILE);
    if (obj) {
      const data = await obj.json();
      if (data.built && (Date.now() - data.built) / 1000 < INDEX_TTL) {
        return data.entries || [];
      }
    }
  } catch (_) {}
  return await buildSearchIndex(r2);
}

async function buildSearchIndex(r2) {
  const entries = [];
  let cursor;
  do {
    const listed = await r2.list(cursor ? { cursor } : {});
    for (const o of listed.objects) {
      const parts = o.key.split('/');
      if (o.key.endsWith('/')) {
        entries.push({ key: o.key, name: parts[parts.length - 2] || o.key, type: 'folder', size: 0, uploaded: '' });
      } else {
        entries.push({ key: o.key, name: parts[parts.length - 1], type: 'file', size: o.size, uploaded: o.uploaded ? o.uploaded.toISOString() : '' });
      }
    }
    cursor = listed.truncated ? listed.cursor : null;
  } while (cursor);

  const index = { built: Date.now(), entries };
  await r2.put(INDEX_FILE, JSON.stringify(index), { httpMetadata: { contentType: 'application/json' } });
  return entries;
}

async function invalidateIndex(r2) {
  try { await r2.delete(INDEX_FILE); } catch (_) {}
}

const makeFileObjFromIndex = (entry, bucket) => ({
  name: entry.name,
  path: entry.key,
  type: 'file',
  size: entry.size,
  uploaded: entry.uploaded,
  bucket: bucket.name,
  bucketBinding: bucket.binding || null,
  remoteEndpoint: bucket.endpoint || null,
  remoteToken: bucket.token || null
});

// ========== 存储容量统计辅助 ==========
// 每个存储桶默认可用容量：10 GB
const BUCKET_LIMIT = 10 * 1024 * 1024 * 1024;

// 统计本地 R2 桶已用容量（复用搜索索引缓存，避免频繁全量扫描）
async function computeBucketUsage(r2) {
  const entries = await getSearchIndex(r2);
  let used = 0, files = 0;
  for (const entry of entries) {
    if (entry.type !== 'file') continue;
    // 排除内部隐藏文件（如 .r2index.json）
    if (entry.key.split('/').some(p => p.startsWith('.'))) continue;
    used += entry.size;
    files++;
  }
  return { used, files };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    // 获取客户端真实 IP（Cloudflare 特有头部）
    const clientIP = request.headers.get('CF-Connecting-IP') ||
                     request.headers.get('X-Forwarded-For')?.split(',')[0]?.trim() ||
                     request.headers.get('X-Real-IP') ||
                     '未知';

    // D1 数据库绑定
    const d1db = env.D1_DB || null;

    const turnstileSiteKey = env.TURNSTILE_SITE_KEY || '';
    const turnstileSecretKey = env.TURNSTILE_SECRET_KEY || '';

    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': 'https://pan2.ppig.eu.cc',
          'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, X-Admin-Password, X-Target-Bucket, X-Upload-Id, X-Part-Number',
          'Access-Control-Max-Age': '86400',
        },
      });
    }

    const corsHeaders = {
      'Access-Control-Allow-Origin': 'https://pan2.ppig.eu.cc',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, X-Admin-Password, X-Target-Bucket, X-Upload-Id, X-Part-Number',
    };

    const adminPath = `/${env.ADMIN || 'admin'}`;
    const password = env.PASSWORD || 'admin123';
    const bgUrl = env.BG_URL || 'https://haowallpaper.com/link//common/file/previewFileImg/18193731367128448';

    let buckets = [];
    try {
      buckets = JSON.parse(env.BUCKETS || '[{"binding":"MY_BUCKET","name":"主存储"}]');
    } catch {
      buckets = [{ binding: 'MY_BUCKET', name: '默认存储' }];
    }

    const isAuthorized = (req) => req.headers.get('X-Admin-Password') === password;

    const getBucketClient = (bucket) => {
      if (bucket.binding) return { type: 'local', binding: env[bucket.binding] };
      if (bucket.endpoint) return { type: 'remote', endpoint: bucket.endpoint, token: bucket.token };
      throw new Error('无效桶配置');
    };

    const setFolder = (map, path, name, bucket) => {
      if (!map.has(path)) {
        map.set(path, {
          name, path, type: 'folder',
          bucket: bucket.name,
          bucketBinding: bucket.binding || null,
          remoteEndpoint: bucket.endpoint || null,
          remoteToken: bucket.token || null
        });
      }
    };

    const makeFileObj = (obj, bucket) => ({
      name: obj.key.split('/').pop(),
      path: obj.key,
      type: 'file',
      size: obj.size,
      uploaded: obj.uploaded,
      bucket: bucket.name,
      bucketBinding: bucket.binding || null,
      remoteEndpoint: bucket.endpoint || null,
      remoteToken: bucket.token || null
    });

    // ---------- API 路由 ----------

    // 1. 列表/搜索
    if (path === '/api/list') {
      try {
        const prefix = url.searchParams.get('prefix') || '';
        const q = url.searchParams.get('q') || '';
        const mergedFolders = new Map();
        const mergedFiles = [];

        for (const bucket of buckets) {
          const client = getBucketClient(bucket);
          if (client.type === 'local') {
            const r2 = client.binding;
            if (!r2) continue;
            if (q.trim()) {
              const lower = q.trim().toLowerCase();
              const entries = await getSearchIndex(r2);
              for (const entry of entries) {
                const parts = entry.key.split('/');
                if (entry.type === 'folder') {
                  if (entry.name.toLowerCase().includes(lower)) setFolder(mergedFolders, entry.key, entry.name, bucket);
                } else {
                  if (entry.name.toLowerCase().includes(lower)) mergedFiles.push(makeFileObjFromIndex(entry, bucket));
                  let cur = '';
                  for (let i = 0; i < parts.length - 1; i++) {
                    cur += parts[i] + '/';
                    if (parts[i].toLowerCase().includes(lower)) setFolder(mergedFolders, cur, parts[i], bucket);
                  }
                }
              }
            } else {
              const list = await r2.list({ delimiter: '/', prefix });
              for (const p of list.delimitedPrefixes) {
                const name = p.replace(prefix, '').replace('/', '');
                setFolder(mergedFolders, p, name, bucket);
              }
              for (const o of list.objects) {
                if (o.key !== prefix) mergedFiles.push(makeFileObj(o, bucket));
              }
            }
          } else if (client.type === 'remote') {
            const params = new URLSearchParams({ prefix });
            if (q) params.set('q', q);
            const remoteUrl = `${client.endpoint}/api/list?${params}`;
            const headers = {};
            if (client.token) headers['X-Auth-Token'] = client.token;
            try {
              const res = await fetch(remoteUrl, { headers });
              if (!res.ok) continue;
              const data = await res.json();
              for (const f of data.folders || []) setFolder(mergedFolders, f.path, f.name, bucket);
              for (const f of data.files || []) {
                mergedFiles.push({
                  ...f,
                  bucket: bucket.name,
                  bucketBinding: null,
                  remoteEndpoint: client.endpoint,
                  remoteToken: client.token
                });
              }
            } catch (e) { console.error(`远程桶 ${bucket.name} 请求失败: ${e.message}`); }
          }
        }
        const result = { folders: [...mergedFolders.values()], files: mergedFiles };
        if (!isAuthorized(request)) {
          result.folders = result.folders
            .filter(f => !f.name.startsWith('.'))
            .map(({ remoteToken, ...rest }) => rest);
          result.files = result.files
            .filter(f => !f.name.startsWith('.'))
            .map(({ remoteToken, ...rest }) => rest);
        }
        return Response.json(result, { headers: corsHeaders });
      } catch (err) {
        return Response.json({ error: err.message }, { status: 500, headers: corsHeaders });
      }
    }

    // 2. 下载/预览（含防滥用保护 + D1 日志记录）
    if (path.startsWith('/api/raw/')) {
      const key = decodeURIComponent(path.slice('/api/raw/'.length));
      const bucketParam = url.searchParams.get('bucket');
      const isDownload = url.searchParams.has('download');
      const dlToken = url.searchParams.get('token') || '';
      const isPreview = url.searchParams.has('preview');

      const filename = key.split('/').pop();
      if (filename && filename.startsWith('.')) {
        return new Response('Forbidden', { status: 403, headers: corsHeaders });
      }

      if (!isAuthorized(request)) {
        if (!dlToken || !(await validateDownloadToken(dlToken, password))) {
          return new Response('无效或过期的下载令牌，请刷新页面后重试', { status: 403, headers: corsHeaders });
        }
      }

      let bucketCfg = bucketParam ? buckets.find(b => b.binding === bucketParam || b.endpoint === bucketParam) : null;
      if (!bucketCfg) {
        for (const b of buckets) {
          if (b.binding && env[b.binding]) {
            const obj = await env[b.binding].get(key);
            if (obj) { bucketCfg = b; break; }
          }
        }
      }
      if (!bucketCfg) return new Response('文件不存在', { status: 404, headers: corsHeaders });

      // 记录操作日志
      const operation = isDownload ? '下载' : (isPreview ? '预览' : '下载');
      await logOperation(d1db, clientIP, operation, filename, bucketCfg.name, `路径: ${key}`);

      const responseHeaders = new Headers(corsHeaders);
      if (isPreview) {
        responseHeaders.set('Access-Control-Allow-Origin', '*');
      }

      if (bucketCfg.binding) {
        const obj = await env[bucketCfg.binding].get(key);
        if (!obj) return new Response('文件不存在', { status: 404, headers: responseHeaders });
        obj.writeHttpMetadata(responseHeaders);
        responseHeaders.set('etag', obj.httpEtag);
        if (isDownload) {
          const filename = key.split('/').pop();
          responseHeaders.set('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`);
        }
        return new Response(obj.body, { headers: responseHeaders });
      } else if (bucketCfg.endpoint) {
        let remoteUrl = `${bucketCfg.endpoint}/api/raw/${encodeURIComponent(key)}`;
        if (isDownload) remoteUrl += '?download=1';
        const reqHeaders = {};
        if (bucketCfg.token) reqHeaders['X-Auth-Token'] = bucketCfg.token;
        const res = await fetch(remoteUrl, { headers: reqHeaders });
        if (!res.ok) return new Response('远程文件不存在', { status: 404, headers: responseHeaders });
        const mergedHeaders = new Headers(res.headers);
        for (const [k, v] of responseHeaders) mergedHeaders.set(k, v);
        return new Response(res.body, { headers: mergedHeaders });
      }
      return new Response('未知桶类型', { status: 500, headers: corsHeaders });
    }

    // 3. 管理员验证（含 Turnstile）
    if (path === '/api/verify' && request.method === 'POST') {
      try {
        const { password: pwd, token } = await request.json();

        if (turnstileSecretKey && turnstileSiteKey) {
          if (!token) {
            return Response.json({ error: '缺少人机验证令牌' }, { status: 400, headers: corsHeaders });
          }
          const verifyRes = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ secret: turnstileSecretKey, response: token })
          });
          const verifyData = await verifyRes.json();
          if (!verifyData.success) {
            return Response.json({ error: '人机验证失败，请重试' }, { status: 403, headers: corsHeaders });
          }
        }

        if (pwd === password) {
          return Response.json({ success: true }, { headers: corsHeaders });
        } else {
          return Response.json({ error: '密码错误' }, { status: 401, headers: corsHeaders });
        }
      } catch (err) {
        return Response.json({ error: err.message }, { status: 500, headers: corsHeaders });
      }
    }

    // 3b. 获取下载令牌
    if (path === '/api/download-token') {
      const token = await generateDownloadToken(password);
      return Response.json({ token }, { headers: corsHeaders });
    }

    // 4. 普通上传（含 D1 日志记录）
    if (path === '/api/upload') {
      if (!isAuthorized(request)) return new Response('Unauthorized', { status: 401, headers: corsHeaders });
      try {
        let targetBucketParam = request.headers.get('X-Target-Bucket');
        if (!targetBucketParam) {
          const cloned = request.clone();
          const formData = await cloned.formData();
          targetBucketParam = formData.get('bucket') || buckets[0].binding;
        }

        const bucketCfg = buckets.find(b => b.binding === targetBucketParam || b.endpoint === targetBucketParam);
        if (!bucketCfg) return new Response('目标桶无效', { status: 400, headers: corsHeaders });

        if (bucketCfg.binding) {
          const formData = await request.formData();
          const file = formData.get('file');
          const prefix = formData.get('prefix') || '';
          const customFilename = formData.get('filename');
          if (!file) return new Response('没有文件', { status: 400, headers: corsHeaders });
          const key = prefix + (customFilename || file.name);
          await env[bucketCfg.binding].put(key, file.stream(), {
            httpMetadata: { contentType: file.type || 'application/octet-stream' }
          });
          invalidateIndex(env[bucketCfg.binding]);

          // 记录上传日志
          const uploadFilename = customFilename || file.name;
          await logOperation(d1db, clientIP, '上传', uploadFilename, bucketCfg.name, `大小: ${formatSize(file.size)}`);

          return Response.json({ success: true }, { headers: corsHeaders });
        } else if (bucketCfg.endpoint) {
          const remoteUrl = `${bucketCfg.endpoint}/api/upload`;
          const reqHeaders = new Headers(request.headers);
          reqHeaders.set('X-Auth-Token', bucketCfg.token || '');
          reqHeaders.delete('X-Admin-Password');
          const res = await fetch(remoteUrl, {
            method: 'POST',
            headers: reqHeaders,
            body: request.body,
          });
          if (!res.ok) {
            const err = await res.json().catch(() => ({ error: '上传失败' }));
            return Response.json({ error: err.error || '上传失败' }, { status: 500, headers: corsHeaders });
          }
          // 记录远程桶上传日志
          await logOperation(d1db, clientIP, '上传', '远程文件', bucketCfg.name, `目标: ${bucketCfg.endpoint}`);

          const resHeaders = new Headers(res.headers);
          Object.entries(corsHeaders).forEach(([k, v]) => resHeaders.set(k, v));
          return new Response(res.body, { headers: resHeaders });
        }
      } catch (err) {
        return Response.json({ error: err.message }, { status: 500, headers: corsHeaders });
      }
    }

    // ========== 分块上传接口（大文件支持） ==========

    if (path === '/api/multipart/initiate' && request.method === 'POST') {
      if (!isAuthorized(request)) return new Response('Unauthorized', { status: 401, headers: corsHeaders });
      try {
        const { key, bucket: targetBucketParam } = await request.json();
        const bucketCfg = buckets.find(b => b.binding === targetBucketParam || b.endpoint === targetBucketParam);
        if (!bucketCfg) return new Response('目标桶无效', { status: 400, headers: corsHeaders });

        if (bucketCfg.binding) {
          const r2 = env[bucketCfg.binding];
          const mpu = await r2.createMultipartUpload(key);
          return Response.json({ uploadId: mpu.uploadId, key: mpu.key }, { headers: corsHeaders });
        } else if (bucketCfg.endpoint) {
          const remoteUrl = `${bucketCfg.endpoint}/api/multipart/initiate`;
          const addTs = request.headers.get('X-Add-Timestamp') || 'true';
          const res = await fetch(remoteUrl, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-Auth-Token': bucketCfg.token || '',
              'X-Admin-Password': password,
              'X-Add-Timestamp': addTs,
            },
            body: JSON.stringify({ key }),
          });
          if (!res.ok) {
            const err = await res.json().catch(() => ({ error: '远程初始化失败' }));
            return Response.json({ error: err.error || '远程初始化失败' }, { status: 500, headers: corsHeaders });
          }
          const data = await res.json();
          return Response.json(data, { headers: corsHeaders });
        }
      } catch (err) {
        return Response.json({ error: err.message }, { status: 500, headers: corsHeaders });
      }
    }

    if (path === '/api/multipart/upload-part' && request.method === 'PUT') {
      if (!isAuthorized(request)) return new Response('Unauthorized', { status: 401, headers: corsHeaders });
      try {
        const uploadId = request.headers.get('X-Upload-Id');
        const partNumber = parseInt(request.headers.get('X-Part-Number') || '1');
        const targetBucketParam = request.headers.get('X-Target-Bucket');
        const key = url.searchParams.get('key');
        if (!uploadId || !key || !targetBucketParam) return new Response('缺少参数', { status: 400, headers: corsHeaders });

        const bucketCfg = buckets.find(b => b.binding === targetBucketParam || b.endpoint === targetBucketParam);
        if (!bucketCfg) return new Response('目标桶无效', { status: 400, headers: corsHeaders });

        if (bucketCfg.binding) {
          const r2 = env[bucketCfg.binding];
          const mpu = r2.resumeMultipartUpload(key, uploadId);
          const part = await mpu.uploadPart(partNumber, request.body);
          return Response.json({ partNumber, etag: part.etag }, { headers: corsHeaders });
        } else if (bucketCfg.endpoint) {
          const remoteUrl = `${bucketCfg.endpoint}/api/multipart/upload-part?key=${encodeURIComponent(key)}`;
          const res = await fetch(remoteUrl, {
            method: 'PUT',
            headers: {
              'X-Upload-Id': uploadId,
              'X-Part-Number': partNumber,
              'X-Target-Bucket': targetBucketParam,
              'X-Auth-Token': bucketCfg.token || '',
              'X-Admin-Password': password,
              'Content-Type': request.headers.get('Content-Type') || 'application/octet-stream',
            },
            body: request.body,
          });
          if (!res.ok) {
            const err = await res.json().catch(() => ({ error: '上传分块失败' }));
            return Response.json({ error: err.error || '上传分块失败' }, { status: 500, headers: corsHeaders });
          }
          const data = await res.json();
          return Response.json(data, { headers: corsHeaders });
        }
      } catch (err) {
        return Response.json({ error: err.message }, { status: 500, headers: corsHeaders });
      }
    }

    if (path === '/api/multipart/complete' && request.method === 'POST') {
      if (!isAuthorized(request)) return new Response('Unauthorized', { status: 401, headers: corsHeaders });
      try {
        const { key, uploadId, parts, bucket: targetBucketParam } = await request.json();
        const bucketCfg = buckets.find(b => b.binding === targetBucketParam || b.endpoint === targetBucketParam);
        if (!bucketCfg) return new Response('目标桶无效', { status: 400, headers: corsHeaders });

        if (bucketCfg.binding) {
          const r2 = env[bucketCfg.binding];
          const mpu = r2.resumeMultipartUpload(key, uploadId);
          await mpu.complete(parts);
          invalidateIndex(r2);

          // 记录分块上传完成日志
          const uploadFilename = key.split('/').pop();
          await logOperation(d1db, clientIP, '上传(分块)', uploadFilename, bucketCfg.name, `分块数: ${parts.length}, 路径: ${key}`);

          return Response.json({ success: true }, { headers: corsHeaders });
        } else if (bucketCfg.endpoint) {
          const remoteUrl = `${bucketCfg.endpoint}/api/multipart/complete`;
          const res = await fetch(remoteUrl, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-Auth-Token': bucketCfg.token || '',
              'X-Admin-Password': password,
            },
            body: JSON.stringify({ key, uploadId, parts }),
          });
          if (!res.ok) {
            const err = await res.json().catch(() => ({ error: '远程完成失败' }));
            return Response.json({ error: err.error || '远程完成失败' }, { status: 500, headers: corsHeaders });
          }

          await logOperation(d1db, clientIP, '上传(分块)', key.split('/').pop(), bucketCfg.name, `远程; 分块数: ${parts.length}`);

          return Response.json({ success: true }, { headers: corsHeaders });
        }
      } catch (err) {
        return Response.json({ error: err.message }, { status: 500, headers: corsHeaders });
      }
    }

    if (path === '/api/multipart/abort' && request.method === 'POST') {
      if (!isAuthorized(request)) return new Response('Unauthorized', { status: 401, headers: corsHeaders });
      try {
        const { key, uploadId, bucket: targetBucketParam } = await request.json();
        const bucketCfg = buckets.find(b => b.binding === targetBucketParam || b.endpoint === targetBucketParam);
        if (!bucketCfg) return new Response('目标桶无效', { status: 400, headers: corsHeaders });

        if (bucketCfg.binding) {
          const r2 = env[bucketCfg.binding];
          const mpu = r2.resumeMultipartUpload(key, uploadId);
          await mpu.abort();
        } else if (bucketCfg.endpoint) {
          const remoteUrl = `${bucketCfg.endpoint}/api/multipart/abort`;
          await fetch(remoteUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Auth-Token': bucketCfg.token || '', 'X-Admin-Password': password },
            body: JSON.stringify({ key, uploadId }),
          });
        }
        return Response.json({ success: true }, { headers: corsHeaders });
      } catch (err) {
        return Response.json({ error: err.message }, { status: 500, headers: corsHeaders });
      }
    }

    // 5. 新建文件夹（含 D1 日志记录）
    if (path === '/api/mkdir') {
      if (!isAuthorized(request)) return new Response('Unauthorized', { status: 401, headers: corsHeaders });
      try {
        const { prefix, name, bucket: targetBucketParam } = await request.json();
        const bucketCfg = buckets.find(b => b.binding === targetBucketParam || b.endpoint === targetBucketParam);
        if (!bucketCfg) return new Response('无效的桶', { status: 400, headers: corsHeaders });

        if (bucketCfg.binding) {
          await env[bucketCfg.binding].put(prefix + name + '/', '');
          invalidateIndex(env[bucketCfg.binding]);

          await logOperation(d1db, clientIP, '新建目录', name, bucketCfg.name, `路径: ${prefix}${name}/`);

          return Response.json({ success: true }, { headers: corsHeaders });
        } else if (bucketCfg.endpoint) {
          const remoteUrl = `${bucketCfg.endpoint}/api/mkdir`;
          const res = await fetch(remoteUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Auth-Token': bucketCfg.token || '' },
            body: JSON.stringify({ prefix, name })
          });
          if (!res.ok) {
            const err = await res.json().catch(() => ({ error: '创建失败' }));
            return Response.json({ error: err.error || '创建失败' }, { status: 500, headers: corsHeaders });
          }
          return Response.json({ success: true }, { headers: corsHeaders });
        }
      } catch (err) {
        return Response.json({ error: err.message }, { status: 500, headers: corsHeaders });
      }
    }

    // 6. 删除（含 D1 日志记录）
    if (path === '/api/delete') {
      if (!isAuthorized(request)) return new Response('Unauthorized', { status: 401, headers: corsHeaders });
      try {
        const { path: delPath, type, bucket: targetBucketParam } = await request.json();
        const bucketCfg = buckets.find(b => b.binding === targetBucketParam || b.endpoint === targetBucketParam);
        if (!bucketCfg) return new Response('无效的桶', { status: 400, headers: corsHeaders });

        if (bucketCfg.binding) {
          if (type === 'file') {
            await env[bucketCfg.binding].delete(delPath);
          } else {
            let list = await env[bucketCfg.binding].list({ prefix: delPath });
            while (list.objects.length) {
              await Promise.all(list.objects.map(o => env[bucketCfg.binding].delete(o.key)));
              if (list.truncated) list = await env[bucketCfg.binding].list({ prefix: delPath, cursor: list.cursor });
              else break;
            }
          }
          invalidateIndex(env[bucketCfg.binding]);

          // 记录删除日志
          const delName = delPath.split('/').filter(Boolean).pop() || delPath;
          await logOperation(d1db, clientIP, '删除', delName, bucketCfg.name, `类型: ${type}, 路径: ${delPath}`);

          return Response.json({ success: true }, { headers: corsHeaders });
        } else if (bucketCfg.endpoint) {
          const remoteUrl = `${bucketCfg.endpoint}/api/delete`;
          const res = await fetch(remoteUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Auth-Token': bucketCfg.token || '' },
            body: JSON.stringify({ path: delPath, type })
          });
          if (!res.ok) {
            const err = await res.json().catch(() => ({ error: '删除失败' }));
            return Response.json({ error: err.error || '删除失败' }, { status: 500, headers: corsHeaders });
          }

          const delName = delPath.split('/').filter(Boolean).pop() || delPath;
          await logOperation(d1db, clientIP, '删除', delName, bucketCfg.name, `类型: ${type}, 远程`);

          return Response.json({ success: true }, { headers: corsHeaders });
        }
      } catch (err) {
        return Response.json({ error: err.message }, { status: 500, headers: corsHeaders });
      }
    }

    // 7. 移动
    if (path === '/api/move') {
      if (!isAuthorized(request)) return new Response('Unauthorized', { status: 401, headers: corsHeaders });
      try {
        const { items, targetPrefix, targetBucket } = await request.json();
        const tBucket = targetBucket || buckets[0].binding;
        const tCfg = buckets.find(b => b.binding === tBucket || b.endpoint === tBucket);
        if (!tCfg) return new Response('目标桶无效', { status: 400, headers: corsHeaders });

        const dirtyBindings = new Set();
        if (tCfg.binding) dirtyBindings.add(tCfg.binding);

        for (const item of items) {
          if (item.bucketBinding) {
            const sCfg = buckets.find(b => b.binding === item.bucketBinding);
            if (!sCfg || !sCfg.binding) continue;
            dirtyBindings.add(sCfg.binding);
            const srcR2 = env[sCfg.binding];

            if (tCfg.binding) {
              const dstR2 = env[tCfg.binding];
              if (item.type === 'file') {
                const obj = await srcR2.get(item.path);
                if (!obj) continue;
                const newKey = targetPrefix + item.path.split('/').pop();
                await dstR2.put(newKey, obj.body, { httpMetadata: obj.httpMetadata });
                await srcR2.delete(item.path);
              } else if (item.type === 'folder') {
                const folderName = item.path.split('/').filter(Boolean).pop() + '/';
                const newFolderPrefix = targetPrefix + folderName;
                let list = await srcR2.list({ prefix: item.path });
                while (true) {
                  for (const o of list.objects) {
                    const remainder = o.key.slice(item.path.length);
                    const newKey = newFolderPrefix + remainder;
                    const obj = await srcR2.get(o.key);
                    if (obj) {
                      await dstR2.put(newKey, obj.body, { httpMetadata: obj.httpMetadata });
                      await srcR2.delete(o.key);
                    }
                  }
                  if (list.truncated) list = await srcR2.list({ prefix: item.path, cursor: list.cursor });
                  else break;
                }
              }
            } else if (tCfg.endpoint) {
              const remoteTarget = tCfg.endpoint;
              const remoteToken = tCfg.token || '';
              if (item.type === 'file') {
                const obj = await srcR2.get(item.path);
                if (!obj) continue;
                const newKey = targetPrefix + item.path.split('/').pop();
                const buf = await obj.arrayBuffer();
                const fd = new FormData();
                fd.append('file', new File([buf], item.path.split('/').pop(), { type: obj.httpMetadata?.contentType || 'application/octet-stream' }));
                fd.append('prefix', targetPrefix);
                fd.append('filename', item.path.split('/').pop());
                const upRes = await fetch(remoteTarget + '/api/upload', {
                  method: 'POST', headers: { 'X-Auth-Token': remoteToken }, body: fd,
                });
                if (!upRes.ok) { const e = await upRes.text(); throw new Error('远程上传失败: ' + e); }
                await srcR2.delete(item.path);
              } else if (item.type === 'folder') {
                const folderName = item.path.split('/').filter(Boolean).pop() + '/';
                const newFolderPrefix = targetPrefix + folderName;
                await fetch(remoteTarget + '/api/mkdir', {
                  method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Auth-Token': remoteToken },
                  body: JSON.stringify({ prefix: targetPrefix, name: item.path.split('/').filter(Boolean).pop() }),
                });
                let list = await srcR2.list({ prefix: item.path });
                while (true) {
                  for (const o of list.objects) {
                    const remainder = o.key.slice(item.path.length);
                    const newKey = newFolderPrefix + remainder;
                    const obj = await srcR2.get(o.key);
                    if (obj) {
                      const buf = await obj.arrayBuffer();
                      const fd = new FormData();
                      fd.append('file', new File([buf], remainder, { type: obj.httpMetadata?.contentType || 'application/octet-stream' }));
                      fd.append('prefix', newFolderPrefix);
                      fd.append('filename', remainder);
                      await fetch(remoteTarget + '/api/upload', {
                        method: 'POST', headers: { 'X-Auth-Token': remoteToken }, body: fd,
                      });
                      await srcR2.delete(o.key);
                    }
                  }
                  if (list.truncated) list = await srcR2.list({ prefix: item.path, cursor: list.cursor });
                  else break;
                }
              }
            }
          } else if (item.remoteEndpoint) {
            const remoteSrc = item.remoteEndpoint;
            const remoteToken = item.remoteToken || '';

            if (tCfg.endpoint && tCfg.endpoint === remoteSrc) {
              const moveRes = await fetch(remoteSrc + '/api/move', {
                method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Auth-Token': remoteToken },
                body: JSON.stringify({ items: [{ path: item.path, type: item.type }], targetPrefix }),
              });
              if (!moveRes.ok) {
                const errText = await moveRes.text();
                throw new Error('远程桶内移动失败: ' + errText);
              }
              continue;
            }

            if (item.type === 'file') {
              const dlRes = await fetch(remoteSrc + '/api/raw/' + encodeURIComponent(item.path), {
                headers: remoteToken ? { 'X-Auth-Token': remoteToken } : {},
              });
              if (!dlRes.ok) { console.error('远程下载失败: ' + item.path); continue; }
              const fileBuf = await dlRes.arrayBuffer();
              const ct = dlRes.headers.get('Content-Type') || 'application/octet-stream';
              const newKey = targetPrefix + item.path.split('/').pop();

              if (tCfg.binding) {
                await env[tCfg.binding].put(newKey, fileBuf, { httpMetadata: { contentType: ct } });
              } else if (tCfg.endpoint) {
                const fd = new FormData();
                fd.append('file', new File([fileBuf], item.path.split('/').pop(), { type: ct }));
                fd.append('prefix', targetPrefix);
                fd.append('filename', item.path.split('/').pop());
                await fetch(tCfg.endpoint + '/api/upload', {
                  method: 'POST', headers: { 'X-Auth-Token': tCfg.token || '' }, body: fd,
                });
              }

              await fetch(remoteSrc + '/api/delete', {
                method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Auth-Token': remoteToken },
                body: JSON.stringify({ path: item.path, type: 'file' }),
              });
            } else if (item.type === 'folder') {
              const listRes = await fetch(remoteSrc + '/api/list?prefix=' + encodeURIComponent(item.path), {
                headers: remoteToken ? { 'X-Auth-Token': remoteToken } : {},
              });
              if (!listRes.ok) continue;
              const listData = await listRes.json();
              const folderName = item.path.split('/').filter(Boolean).pop() + '/';
              const newFolderPrefix = targetPrefix + folderName;

              const allObjects = [...(listData.files || []), ...(listData.folders || [])];

              for (const obj of allObjects) {
                const srcKey = obj.path;
                const remainder = srcKey.slice(item.path.length);
                if (!remainder) continue;
                const newKey = newFolderPrefix + remainder;

                if (obj.type === 'file') {
                  const dlRes2 = await fetch(remoteSrc + '/api/raw/' + encodeURIComponent(srcKey), {
                    headers: remoteToken ? { 'X-Auth-Token': remoteToken } : {},
                  });
                  if (!dlRes2.ok) continue;
                  const fileBuf = await dlRes2.arrayBuffer();
                  const ct = dlRes2.headers.get('Content-Type') || 'application/octet-stream';
                  if (tCfg.binding) {
                    await env[tCfg.binding].put(newKey, fileBuf, { httpMetadata: { contentType: ct } });
                  } else if (tCfg.endpoint) {
                    const fd = new FormData();
                    fd.append('file', new File([fileBuf], remainder, { type: ct }));
                    fd.append('prefix', newFolderPrefix);
                    fd.append('filename', remainder);
                    await fetch(tCfg.endpoint + '/api/upload', {
                      method: 'POST', headers: { 'X-Auth-Token': tCfg.token || '' }, body: fd,
                    });
                  }
                } else if (obj.type === 'folder') {
                  if (tCfg.binding) {
                    await env[tCfg.binding].put(newKey, '');
                  } else if (tCfg.endpoint) {
                    const parentPrefix = newKey.substring(0, newKey.slice(0, -1).lastIndexOf('/') + 1);
                    const dirName = remainder.replace('/', '');
                    await fetch(tCfg.endpoint + '/api/mkdir', {
                      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Auth-Token': tCfg.token || '' },
                      body: JSON.stringify({ prefix: parentPrefix, name: dirName }),
                    });
                  }
                }

                await fetch(remoteSrc + '/api/delete', {
                  method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Auth-Token': remoteToken },
                  body: JSON.stringify({ path: srcKey, type: obj.type }),
                });
              }
            }
          }
        }

        // 记录移动日志
        const movedNames = items.map(i => i.path.split('/').filter(Boolean).pop() || i.path).join(', ');
        await logOperation(d1db, clientIP, '移动', movedNames, tCfg.name, `目标: ${targetPrefix}, 项目数: ${items.length}`);

        for (const binding of dirtyBindings) invalidateIndex(env[binding]);
        return Response.json({ success: true }, { headers: corsHeaders });
      } catch (err) {
        return Response.json({ error: err.message }, { status: 500, headers: corsHeaders });
      }
    }

    // ========== 8. D1 操作日志查询（管理员专用） ==========
    if (path === '/api/logs') {
      if (!isAuthorized(request)) return new Response('Unauthorized', { status: 401, headers: corsHeaders });
      if (!d1db) return Response.json({ error: 'D1 数据库未配置' }, { status: 500, headers: corsHeaders });

      try {
        const page = parseInt(url.searchParams.get('page') || '1');
        const pageSize = parseInt(url.searchParams.get('pageSize') || '50');
        const operation = url.searchParams.get('operation') || ''; // 筛选操作类型
        const searchFilename = url.searchParams.get('filename') || ''; // 文件名搜索
        const offset = (page - 1) * pageSize;

        let whereClause = '';
        const conditions = [];
        const bindValues = [];

        if (operation) {
          conditions.push('operation = ?');
          bindValues.push(operation);
        }
        if (searchFilename) {
          conditions.push('filename LIKE ?');
          bindValues.push(`%${searchFilename}%`);
        }
        if (conditions.length > 0) {
          whereClause = 'WHERE ' + conditions.join(' AND ');
        }

        // 查询总数
        const countSql = `SELECT COUNT(*) as total FROM operation_logs ${whereClause}`;
        const countStmt = d1db.prepare(countSql);
        const countBound = bindValues.length > 0 ? countStmt.bind(...bindValues) : countStmt;
        const countResult = await countBound.first();
        const total = countResult ? countResult.total : 0;

        // 查询分页数据（按序号降序，即最新在前）
        const dataSql = `SELECT * FROM operation_logs ${whereClause} ORDER BY id DESC LIMIT ? OFFSET ?`;
        const dataBindValues = [...bindValues, pageSize, offset];
        const dataStmt = d1db.prepare(dataSql);
        const dataBound = dataStmt.bind(...dataBindValues);
        const { results } = await dataBound.all();

        return Response.json({
          logs: results || [],
          total,
          page,
          pageSize,
          totalPages: Math.ceil(total / pageSize)
        }, { headers: corsHeaders });
      } catch (err) {
        return Response.json({ error: '查询日志失败: ' + err.message }, { status: 500, headers: corsHeaders });
      }
    }

    // ========== 8b. 存储容量统计（管理员专用：每个存储桶 10G 可用容量） ==========
    if (path === '/api/storage-usage') {
      if (!isAuthorized(request)) return new Response('Unauthorized', { status: 401, headers: corsHeaders });
      try {
        const results = [];
        for (const bucket of buckets) {
          const item = {
            id: bucket.binding || bucket.endpoint,
            name: bucket.name,
            limit: BUCKET_LIMIT,
            used: 0,
            files: 0,
            error: ''
          };
          const client = getBucketClient(bucket);
          try {
            if (client.type === 'local') {
              if (!client.binding) throw new Error('未绑定 R2');
              const usage = await computeBucketUsage(client.binding);
              item.used = usage.used;
              item.files = usage.files;
            } else {
              // 远程桶：调用副 Worker 的统计接口
              const res = await fetch(`${client.endpoint}/api/storage-usage`, {
                headers: client.token ? { 'X-Auth-Token': client.token } : {}
              });
              if (!res.ok) throw new Error('远程统计失败 (' + res.status + ')');
              const data = await res.json();
              item.used = data.used || 0;
              item.files = data.files || 0;
            }
          } catch (err) {
            item.error = err.message;
          }
          results.push(item);
        }
        return Response.json({ buckets: results, limit: BUCKET_LIMIT }, { headers: corsHeaders });
      } catch (err) {
        return Response.json({ error: err.message }, { status: 500, headers: corsHeaders });
      }
    }

    // ========== 9. D1 数据库初始化（管理员专用） ==========
    if (path === '/api/init-db' && request.method === 'POST') {
      if (!isAuthorized(request)) return new Response('Unauthorized', { status: 401, headers: corsHeaders });
      if (!d1db) return Response.json({ error: 'D1 数据库未配置，请先在 Cloudflare Dashboard 中创建 D1 数据库并绑定到 Worker' }, { status: 500, headers: corsHeaders });

      try {
        // 创建操作日志表
        await d1db.exec(`
          CREATE TABLE IF NOT EXISTS operation_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            time TEXT NOT NULL,
            ip TEXT NOT NULL,
            operation TEXT NOT NULL,
            filename TEXT DEFAULT '',
            bucket TEXT DEFAULT '',
            details TEXT DEFAULT ''
          )
        `);

        // 创建索引加速查询
        await d1db.exec(`CREATE INDEX IF NOT EXISTS idx_operation ON operation_logs(operation)`);
        await d1db.exec(`CREATE INDEX IF NOT EXISTS idx_time ON operation_logs(time)`);
        await d1db.exec(`CREATE INDEX IF NOT EXISTS idx_filename ON operation_logs(filename)`);

        return Response.json({ success: true, message: 'D1 数据库表初始化成功' }, { headers: corsHeaders });
      } catch (err) {
        return Response.json({ error: '数据库初始化失败: ' + err.message }, { status: 500, headers: corsHeaders });
      }
    }

    // ========== 10. 背景图片代理（解决防盗链 403 问题） ==========
    if (path === '/api/bg-image') {
      try {
        // 缓存后台图片 1 小时，减少重复请求
        const cache = caches.default;
        const cacheKey = new Request(url.origin + '/_cached_bg_img', request);
        const cached = await cache.match(cacheKey);
        if (cached) return cached;

        // 服务端请求不受防盗链限制（无 Referer 头）
        const imageUrl = bgUrl;
        const fetchHeaders = new Headers();
        fetchHeaders.set('User-Agent', 'Cloudflare-Worker/1.0');

        const imageRes = await fetch(imageUrl, { headers: fetchHeaders });
        if (!imageRes.ok) {
          return new Response('背景图片加载失败', { status: 502, headers: corsHeaders });
        }

        const contentType = imageRes.headers.get('Content-Type') || 'image/jpeg';
        const cacheControl = imageRes.headers.get('Cache-Control') || 'public, max-age=3600';

        const respHeaders = new Headers({
          'Content-Type': contentType,
          'Cache-Control': cacheControl,
          'Access-Control-Allow-Origin': '*',
          'CDN-Cache-Control': 'public, max-age=3600',
        });

        const response = new Response(imageRes.body, { headers: respHeaders });

        // 写入 Cache API（Worker 级别缓存）
        try {
          const putCache = response.clone();
          putCache.headers.set('Cache-Control', 'public, max-age=3600');
          await cache.put(cacheKey, putCache);
        } catch (_) {}

        return response;
      } catch (err) {
        // 代理失败时返回一个纯色渐变作为降级背景
        const svgFallback = `<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080">
          <defs><linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" style="stop-color:#667eea"/>
            <stop offset="100%" style="stop-color:#764ba2"/>
          </linearGradient></defs>
          <rect width="100%" height="100%" fill="url(#g)"/>
        </svg>`;
        return new Response(svgFallback, {
          headers: {
            'Content-Type': 'image/svg+xml',
            'Cache-Control': 'public, max-age=3600',
            'Access-Control-Allow-Origin': '*',
          }
        });
      }
    }

    // ========== 11. 初始化 D1 后重定向回首页 ==========
    if (path === '/api/init-db-redirect') {
      if (!isAuthorized(request)) return new Response('Unauthorized', { status: 401, headers: corsHeaders });
      if (!d1db) {
        return new Response('D1 数据库未配置，请先在 Cloudflare Dashboard → Workers & Pages → D1 中创建数据库，并绑定到此 Worker（变量名: D1_DB）', {
          status: 500,
          headers: { 'Content-Type': 'text/plain;charset=UTF-8', ...corsHeaders }
        });
      }
      try {
        await d1db.exec(`CREATE TABLE IF NOT EXISTS operation_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, time TEXT NOT NULL, ip TEXT NOT NULL, operation TEXT NOT NULL, filename TEXT DEFAULT '', bucket TEXT DEFAULT '', details TEXT DEFAULT '')`);
        await d1db.exec(`CREATE INDEX IF NOT EXISTS idx_operation ON operation_logs(operation)`);
        await d1db.exec(`CREATE INDEX IF NOT EXISTS idx_time ON operation_logs(time)`);
        return Response.redirect(adminPath + '#logs', 302);
      } catch (err) {
        return new Response('数据库初始化失败: ' + err.message, {
          status: 500,
          headers: { 'Content-Type': 'text/plain;charset=UTF-8', ...corsHeaders }
        });
      }
    }

    // 前端页面渲染
    if (path === '/' || path === adminPath) {
      const safeBuckets = buckets.map(({ token, ...rest }) => rest);
      const bucketsJson = JSON.stringify(safeBuckets);
      // 告知前端 D1 是否已配置
      const d1Enabled = !!d1db;
      return new Response(htmlTemplate(adminPath, d1Enabled, bucketsJson, turnstileSiteKey), {
        headers: { 'Content-Type': 'text/html;charset=UTF-8', ...corsHeaders }
      });
    }

    return new Response('页面未找到', { status: 404, headers: corsHeaders });
  }
};

// 辅助函数: 文件大小格式化
function formatSize(bytes) {
  if (!bytes || bytes === 0) return '0 B';
  const k = 1024, sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// ========== 前端 HTML 模板（集成 Turnstile + 文件预览 + D1 操作日志查看器） ==========
function htmlTemplate(adminPath, d1Enabled, bucketsJson, turnstileSiteKey) {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <!-- 防盗链修复: 禁止发送 Referer 头部 -->
  <meta name="referrer" content="no-referrer">
  <title>跨账号 R2 云盘</title>
  <script src="https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4"></script>
  <script src="https://unpkg.com/vue@3/dist/vue.global.js"></script>
  <style>
    body {
      /* 背景图通过 Worker 代理获取，绕过防盗链 */
      background-image: url('/api/bg-image');
      background-size: cover; background-position: center; background-attachment: fixed;
    }
    .glass { background: rgba(255,255,255,0.65); backdrop-filter: blur(16px); -webkit-backdrop-filter: blur(16px); border: 1px solid rgba(255,255,255,0.4); }
    .glass-btn { background: rgba(255,255,255,0.7); backdrop-filter: blur(4px); border: 1px solid rgba(255,255,255,0.5); transition: all 0.2s; }
    .glass-btn:hover { background: rgba(255,255,255,0.9); transform: translateY(-1px); }
    .prose table { border-collapse: collapse; width: 100%; }
    .prose th, .prose td { border: 1px solid #cbd5e1; padding: 4px 8px; }
    .prose pre { background: #f1f5f9; padding: 12px; border-radius: 8px; white-space: pre-wrap; }
    /* 日志表格样式 */
    .log-table { width: 100%; border-collapse: collapse; font-size: 13px; }
    .log-table th { background: rgba(59,130,246,0.1); padding: 10px 12px; text-align: left; font-weight: 600; color: #1e40af; border-bottom: 2px solid rgba(59,130,246,0.2); white-space: nowrap; }
    .log-table td { padding: 8px 12px; border-bottom: 1px solid rgba(0,0,0,0.05); }
    .log-table tr:hover td { background: rgba(59,130,246,0.04); }
    .log-badge { display: inline-block; padding: 2px 8px; border-radius: 10px; font-size: 11px; font-weight: 600; }
    .log-badge-download { background: #dbeafe; color: #1d4ed8; }
    .log-badge-preview { background: #e0e7ff; color: #4338ca; }
    .log-badge-upload { background: #d1fae5; color: #047857; }
    .log-badge-delete { background: #fee2e2; color: #b91c1c; }
    .log-badge-mkdir { background: #fef3c7; color: #92400e; }
    .log-badge-move { background: #f3e8ff; color: #7c3aed; }
    .tab-btn { padding: 8px 16px; border-radius: 10px 10px 0 0; font-size: 14px; font-weight: 500; cursor: pointer; transition: all 0.2s; }
    .tab-btn.active { background: rgba(255,255,255,0.85); color: #2563eb; }
    .tab-btn:not(.active) { background: rgba(255,255,255,0.35); color: #64748b; }
    .tab-btn:not(.active):hover { background: rgba(255,255,255,0.55); color: #475569; }
  </style>
</head>
<body class="min-h-screen text-slate-800 antialiased font-sans selection:bg-blue-200">
  <div id="app" class="container mx-auto max-w-5xl p-4 sm:p-6 md:p-8 min-h-screen flex flex-col justify-start">
    <header class="glass rounded-2xl p-4 mb-6 flex justify-between items-center shadow-sm">
      <div class="flex items-center space-x-3 cursor-pointer" @click="resetPath">
        <div class="bg-blue-500 text-white p-2 rounded-xl shadow-md">
          <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 15a4 4 0 004 4h9a5 5 0 10-.1-9.999 5.002 5.002 0 10-9.78 2.096A4.001 4.001 0 003 15z" /></svg>
        </div>
        <h1 class="text-xl font-bold tracking-wide bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent">跨账号 R2 管理</h1>
      </div>
      <div class="flex items-center space-x-2">
        <!-- D1 状态指示 -->
        <span v-if="d1Configured" class="text-xs px-2.5 py-1 rounded-full font-medium bg-green-100 text-green-700 border border-green-200">D1 日志</span>
        <span v-else class="text-xs px-2.5 py-1 rounded-full font-medium bg-gray-100 text-gray-500 border border-gray-200">无日志</span>
        <span v-if="isAdmin" class="bg-amber-100 text-amber-800 text-xs px-3 py-1.5 rounded-full font-medium shadow-sm border border-amber-200">管理员</span>
        <span v-else class="bg-blue-100 text-blue-800 text-xs px-3 py-1.5 rounded-full font-medium shadow-sm border border-blue-200">分享门户</span>
      </div>
    </header>

    <div v-if="isAdmin && !isAuthenticated" class="w-full max-w-md mx-auto my-auto glass rounded-2xl p-6 shadow-xl border">
      <h3 class="text-lg font-bold mb-4 text-center">管理员验证</h3>
      <input type="password" v-model="inputPassword" placeholder="管理员密码" class="w-full px-4 py-2.5 rounded-xl border border-white/60 bg-white/50 focus:outline-none focus:ring-2 focus:ring-blue-400 text-center mb-4">
      <div id="turnstile-widget" class="flex justify-center mb-4"></div>
      <button @click="verifyPassword" class="w-full bg-blue-500 hover:bg-blue-600 text-white font-medium py-2.5 rounded-xl transition shadow-md">解锁后台</button>
    </div>

    <main v-else class="glass rounded-2xl shadow-xl flex-1 flex flex-col overflow-hidden">
      <!-- 标签切换栏 -->
      <div v-if="isAdmin" class="flex px-4 pt-3 space-x-1 bg-white/20 border-b border-white/10">
        <button @click="activeTab = 'files'" :class="['tab-btn', activeTab === 'files' ? 'active' : '']">
          📁 文件管理
        </button>
        <button v-if="d1Configured" @click="activeTab = 'logs'; loadLogs()" :class="['tab-btn', activeTab === 'logs' ? 'active' : '']">
          📋 操作日志
        </button>
        <button v-if="isAdmin" @click="activeTab = 'capacity'; loadStorageUsage()" :class="['tab-btn', activeTab === 'capacity' ? 'active' : '']">
          📊 容量统计
        </button>
      </div>

      <!-- 文件管理面板 -->
      <template v-if="activeTab === 'files' || !isAdmin">
      <div class="p-4 bg-white/30 border-b border-white/30 flex flex-col gap-3">
        <div class="flex items-center gap-3">
          <div class="flex items-center space-x-1 text-sm font-medium overflow-x-auto whitespace-nowrap py-1 flex-1 min-w-0">
            <span class="text-blue-600 cursor-pointer hover:underline shrink-0" @click="jumpToPath(-1)">全部文件</span>
            <template v-for="(folder, index) in breadcrumbs" :key="index">
              <span class="text-slate-400 shrink-0">/</span>
              <span class="text-blue-600 cursor-pointer hover:underline truncate max-w-[200px]" @click="jumpToPath(index)">{{ folder }}</span>
            </template>
          </div>
          <div class="relative w-48 sm:w-56 md:w-64 shrink-0">
            <span class="absolute inset-y-0 left-0 flex items-center pl-3 pointer-events-none text-slate-400">
              <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
            </span>
            <input type="text" v-model="searchQuery" @keyup.enter="handleSearch" placeholder="搜索..." class="w-full pl-9 pr-8 py-1.5 bg-white/50 border border-slate-200/80 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 transition-all">
            <button v-if="searchQuery || isSearching" @click="clearSearch" class="absolute inset-y-0 right-0 flex items-center pr-2.5 text-slate-400 hover:text-slate-600 cursor-pointer">
              <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" /></svg>
            </button>
          </div>
        </div>
        <div v-if="isAdmin" class="flex flex-wrap items-center gap-2">
          <select v-model="currentBucket" class="text-sm rounded-xl border border-white/60 bg-white/50 px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-400">
            <option value="">选择操作桶</option>
            <option v-for="b in allBuckets" :key="b.id" :value="b.id">{{ b.name }}</option>
          </select>
          <label class="inline-flex items-center text-xs text-slate-600 cursor-pointer hover:text-amber-600 transition-colors select-none whitespace-nowrap bg-white/40 rounded-lg px-2.5 py-1.5" :class="enableTimestamp ? 'text-amber-700 bg-amber-100/60 font-semibold' : ''">
            <input type="checkbox" v-model="enableTimestamp" class="accent-amber-500 w-3.5 h-3.5 mr-1.5 cursor-pointer">
            <span>时间戳</span>
          </label>
          <button @click="triggerFileUpload" class="glass-btn text-blue-600 text-sm font-medium px-3 py-2 rounded-xl flex items-center shadow-xs cursor-pointer">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 mr-1.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v1m-4-8l-4-4m0 0L8 8m4-4v12" /></svg>上传文件
          </button>
          <button @click="triggerFolderUpload" class="glass-btn text-indigo-600 text-sm font-medium px-3 py-2 rounded-xl flex items-center shadow-xs cursor-pointer">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 mr-1.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 19a2 2 0 01-2-2V7a2 2 0 012-2h4l2 2h4a2 2 0 012 2v1M5 19h14a2 2 0 002-2v-5M5 19v-2a2 2 0 002-2h2a2 2 0 002 2v2M9 5h6m1 5h1m-1 3h1" /></svg>上传文件夹
          </button>
          <button @click="promptMkdir" class="glass-btn text-emerald-600 text-sm font-medium px-3 py-2 rounded-xl flex items-center shadow-xs cursor-pointer">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 mr-1.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 13h6m-3-3v6m-9 1V7a2 2 0 012-2h6l2 2h6a2 2 0 012 2v8a2 2 0 012 2H5a2 2 0 01-2-2z" /></svg>新建目录
          </button>
          <input type="file" id="fileInput" multiple class="hidden" @change="handleFilesSelected">
          <input type="file" id="folderInput" webkitdirectory class="hidden" @change="handleFolderSelected">
        </div>
      </div>

      <div v-if="isSearching" class="px-4 py-2 bg-blue-50/50 border-b border-white/20 flex items-center justify-between text-xs text-blue-700 font-medium shrink-0">
        <div class="flex items-center space-x-1.5">
          <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5 text-blue-500 animate-pulse" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
          <span>全局搜索结果："{{ searchQuery }}" ({{ folders.length + files.length }} 项)</span>
        </div>
        <button @click="clearSearch" class="text-blue-600 hover:text-blue-800 underline cursor-pointer font-semibold">清除搜索</button>
      </div>

      <div v-if="isAdmin && (folders.length > 0 || files.length > 0) && !loading" class="px-4 py-2 bg-white/40 border-b border-white/10 flex items-center justify-between text-xs font-semibold text-slate-500">
        <div class="flex items-center space-x-2">
          <input type="checkbox" :checked="isAllSelected" @change="toggleSelectAll" class="accent-blue-600 rounded border-slate-300 w-4 h-4 cursor-pointer">
          <span>全选 <span v-if="selectedItems.length > 0" class="text-blue-600 font-bold">(已选 {{ selectedItems.length }})</span></span>
        </div>
        <div v-if="selectedItems.length > 0" class="flex items-center space-x-2">
          <button @click="triggerMoveBatch" class="px-3 py-1 bg-blue-500 hover:bg-blue-600 text-white font-medium rounded-lg shadow-sm transition flex items-center cursor-pointer">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" /></svg>批量移动
          </button>
          <button @click="deleteSelectedItems" class="px-3 py-1 bg-rose-500 hover:bg-rose-600 text-white font-medium rounded-lg shadow-sm transition flex items-center cursor-pointer">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>批量删除
          </button>
        </div>
      </div>

      <div class="flex-1 overflow-y-auto min-h-[400px]">
        <div v-if="loading" class="flex justify-center items-center h-64">
          <div class="animate-spin rounded-full h-8 w-8 border-4 border-blue-500 border-t-transparent"></div>
        </div>
        <div v-else-if="folders.length === 0 && files.length === 0" class="flex flex-col justify-center items-center h-64 text-slate-400">
          <svg xmlns="http://www.w3.org/2000/svg" class="h-16 w-16 mb-2 stroke-1" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0a2 2 0 01-2 2H6a2 2 0 01-2-2m16 0V9a2 2 0 00-2-2H6a2 2 0 00-2 2v4.5m16 0h-1.5M12 14v3m0 0l2-2m-2 2l-2-2" /></svg>
          <p class="text-sm">这里空空如也~</p>
        </div>
        <div v-else class="divide-y divide-white/20">
          <div v-for="folder in folders" :key="folder.path" class="p-4 flex items-center justify-between hover:bg-white/30 transition-all duration-150">
            <div class="flex items-center space-x-3 cursor-pointer flex-1 min-w-0" @click="enterFolder(folder)">
              <input v-if="isAdmin" type="checkbox" :value="folder" v-model="selectedItems" @click.stop class="accent-blue-600 rounded border-slate-300 w-4 h-4 cursor-pointer shrink-0">
              <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6 text-amber-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" /></svg>
              <span class="font-medium truncate text-sm sm:text-base">{{ folder.name }}</span>
              <span v-if="isAdmin" class="text-[10px] bg-slate-100 px-1.5 py-0.5 rounded border border-slate-300 text-slate-500 ml-1.5 shrink-0">{{ folder.bucket }}</span>
            </div>
            <div class="flex items-center space-x-2 shrink-0 ml-4">
              <button v-if="isAdmin" @click="triggerMoveSingle(folder)" class="p-1.5 text-blue-600 hover:bg-blue-100 rounded-lg transition cursor-pointer" title="移动">
                <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" /></svg>
              </button>
              <button v-if="isAdmin" @click="deleteItem(folder)" class="p-1.5 text-rose-500 hover:bg-rose-100 rounded-lg transition cursor-pointer" title="删除">
                <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
              </button>
            </div>
          </div>
          <div v-for="file in files" :key="file.path" class="p-4 flex items-center justify-between hover:bg-white/30 transition-all duration-150">
            <div class="flex items-center space-x-3 min-w-0 flex-1">
              <input v-if="isAdmin" type="checkbox" :value="file" v-model="selectedItems" class="accent-blue-600 rounded border-slate-300 w-4 h-4 cursor-pointer shrink-0">
              <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6 text-blue-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" /></svg>
              <div class="min-w-0 flex-1">
                <div class="flex items-center">
                  <p class="font-medium truncate text-sm sm:text-base text-slate-800">{{ file.name }}</p>
                  <span v-if="isAdmin" class="text-[10px] bg-slate-100 px-1.5 py-0.5 rounded border border-slate-300 text-slate-500 ml-1.5 shrink-0">{{ file.bucket }}</span>
                </div>
                <p class="text-xs text-slate-400 mt-0.5">{{ formatSize(file.size) }} · {{ formatTime(file.uploaded) }}</p>
              </div>
            </div>
            <div class="flex items-center space-x-1 sm:space-x-2 shrink-0 ml-4">
              <button v-if="isPreviewable(file.name)" @click="previewFile(file)" class="px-2.5 py-1.5 text-xs font-medium text-sky-600 glass-btn rounded-lg shadow-2xs cursor-pointer" title="预览">
                <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 inline mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>预览
              </button>
              <button @click="copyLink(file)" class="px-2.5 py-1.5 text-xs font-medium text-indigo-600 glass-btn rounded-lg shadow-2xs cursor-pointer">复制链接</button>
              <button @click="downloadFile(file)" class="px-2.5 py-1.5 text-xs font-medium text-white bg-blue-500 hover:bg-blue-600 rounded-lg shadow-sm cursor-pointer">下载</button>
              <button v-if="isAdmin" @click="triggerMoveSingle(file)" class="p-1.5 text-blue-600 hover:bg-blue-100 rounded-lg transition cursor-pointer" title="移动">
                <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" /></svg>
              </button>
              <button v-if="isAdmin" @click="deleteItem(file)" class="p-1.5 text-rose-500 hover:bg-rose-100 rounded-lg transition cursor-pointer" title="删除">
                <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
              </button>
            </div>
          </div>
        </div>
      </div>
      </template>

      <!-- 操作日志面板（管理员专用） -->
      <template v-if="isAdmin && d1Configured && activeTab === 'logs'">
        <div class="p-4 bg-white/30 border-b border-white/30 flex flex-wrap items-center gap-3">
          <span class="text-sm font-semibold text-slate-700">操作日志</span>
          <select v-model="logFilter" @change="loadLogs" class="text-xs rounded-lg border border-white/60 bg-white/50 px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-400">
            <option value="">全部操作</option>
            <option value="下载">下载</option>
            <option value="预览">预览</option>
            <option value="上传">上传</option>
            <option value="上传(分块)">上传(分块)</option>
            <option value="删除">删除</option>
            <option value="新建目录">新建目录</option>
            <option value="移动">移动</option>
          </select>
          <input type="text" v-model="logSearchFilename" @keyup.enter="loadLogs" placeholder="搜索文件名..." class="text-xs rounded-lg border border-white/60 bg-white/50 px-3 py-1.5 w-40 focus:outline-none focus:ring-2 focus:ring-blue-400">
          <button @click="loadLogs" class="text-xs bg-blue-500 hover:bg-blue-600 text-white px-3 py-1.5 rounded-lg shadow-sm cursor-pointer">查询</button>
          <button @click="initD1Database" class="text-xs bg-emerald-500 hover:bg-emerald-600 text-white px-3 py-1.5 rounded-lg shadow-sm cursor-pointer" title="初始化/重建数据库表">初始化数据库</button>
          <span class="text-xs text-slate-400 ml-auto">共 {{ logTotal }} 条记录</span>
        </div>
        <div class="flex-1 overflow-auto min-h-[400px]">
          <div v-if="logLoading" class="flex justify-center items-center h-64">
            <div class="animate-spin rounded-full h-8 w-8 border-4 border-blue-500 border-t-transparent"></div>
          </div>
          <div v-else-if="logs.length === 0" class="flex flex-col justify-center items-center h-64 text-slate-400">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-16 w-16 mb-3 stroke-1" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
            <p class="text-sm">暂无操作记录</p>
            <p class="text-xs mt-1">上传、下载、删除等操作会自动记录在此</p>
          </div>
          <table v-else class="log-table">
            <thead>
              <tr>
                <th>序号</th>
                <th>时间</th>
                <th>IP 地址</th>
                <th>操作</th>
                <th>文件名</th>
                <th>存储桶</th>
                <th>详情</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="log in logs" :key="log.id">
                <td class="text-xs text-slate-500 font-mono">{{ log.id }}</td>
                <td class="text-xs text-slate-600 whitespace-nowrap">{{ formatLogTime(log.time) }}</td>
                <td class="text-xs font-mono text-slate-500">{{ log.ip }}</td>
                <td><span :class="['log-badge', logBadgeClass(log.operation)]">{{ log.operation }}</span></td>
                <td class="text-sm font-medium text-slate-700 max-w-[180px] truncate" :title="log.filename">{{ log.filename || '-' }}</td>
                <td class="text-xs text-slate-500">{{ log.bucket || '-' }}</td>
                <td class="text-xs text-slate-400 max-w-[200px] truncate" :title="log.details">{{ log.details || '-' }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <!-- 分页 -->
        <div v-if="logTotalPages > 1" class="p-3 bg-white/20 border-t border-white/20 flex justify-center items-center space-x-2">
          <button @click="logPage = 1; loadLogs()" :disabled="logPage === 1" class="px-2 py-1 text-xs rounded-lg bg-white/50 disabled:opacity-30 cursor-pointer">首页</button>
          <button @click="logPage--; loadLogs()" :disabled="logPage === 1" class="px-2 py-1 text-xs rounded-lg bg-white/50 disabled:opacity-30 cursor-pointer">上页</button>
          <span class="text-xs text-slate-600 px-2">第 {{ logPage }} / {{ logTotalPages }} 页</span>
          <button @click="logPage++; loadLogs()" :disabled="logPage >= logTotalPages" class="px-2 py-1 text-xs rounded-lg bg-white/50 disabled:opacity-30 cursor-pointer">下页</button>
          <button @click="logPage = logTotalPages; loadLogs()" :disabled="logPage >= logTotalPages" class="px-2 py-1 text-xs rounded-lg bg-white/50 disabled:opacity-30 cursor-pointer">末页</button>
        </div>
      </template>

      <!-- 容量统计面板（管理员专用：圆形图展示每个桶的容量占用） -->
      <template v-if="isAdmin && activeTab === 'capacity'">
        <div class="p-4 bg-white/30 border-b border-white/30 flex flex-wrap items-center gap-3">
          <span class="text-sm font-semibold text-slate-700">容量统计</span>
          <span class="text-xs text-slate-400">每个存储桶可用 {{ formatSize(capacityLimit) }}</span>
          <button @click="loadStorageUsage" class="text-xs bg-blue-500 hover:bg-blue-600 text-white px-3 py-1.5 rounded-lg shadow-sm cursor-pointer">🔄 刷新</button>
          <span v-if="capacityLoading" class="text-xs text-blue-600">统计中，文件较多时可能需要几秒...</span>
        </div>
        <div class="flex-1 overflow-auto min-h-[400px] p-6">
          <div v-if="capacityLoading && capacityBuckets.length === 0" class="flex justify-center items-center h-64">
            <div class="animate-spin rounded-full h-8 w-8 border-4 border-blue-500 border-t-transparent"></div>
          </div>
          <div v-else-if="capacityBuckets.length === 0" class="flex flex-col justify-center items-center h-64 text-slate-400">
            <p class="text-sm">暂无存储桶数据</p>
          </div>
          <div v-else class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            <div v-for="b in capacityBuckets" :key="b.id" class="bg-white/60 rounded-2xl p-5 flex flex-col items-center border border-white/60 shadow-sm">
              <div class="relative w-32 h-32 mb-3">
                <svg viewBox="0 0 120 120" class="w-full h-full -rotate-90">
                  <circle cx="60" cy="60" r="50" fill="none" stroke="#e2e8f0" stroke-width="10"/>
                  <circle cx="60" cy="60" r="50" fill="none" :stroke="capacityColor(b.percent)" stroke-width="10" stroke-linecap="round"
                    :stroke-dasharray="capacityArc(b.percent)" :class="b.error ? 'opacity-30' : ''"/>
                </svg>
                <div class="absolute inset-0 flex flex-col items-center justify-center">
                  <span class="text-xl font-bold" :style="{ color: capacityColor(b.percent) }">{{ b.error ? '!' : b.percent }}<span v-if="!b.error" class="text-sm">%</span></span>
                  <span class="text-[10px] text-slate-400">{{ b.error ? '统计失败' : '已使用' }}</span>
                </div>
              </div>
              <p class="font-semibold text-slate-800 text-sm truncate max-w-full">{{ b.name }}</p>
              <p class="text-xs text-slate-500 mt-1">{{ formatSize(b.used) }} / {{ formatSize(b.limit) }}</p>
              <p class="text-xs text-slate-400 mt-0.5">{{ b.files }} 个文件</p>
              <p v-if="b.error" class="text-[11px] text-rose-500 mt-1 text-center">{{ b.error }}</p>
            </div>
          </div>
        </div>
      </template>
    </main>

    <!-- 移动对话框 -->
    <div v-if="moveModalActive" class="fixed inset-0 bg-black/40 backdrop-blur-xs flex items-center justify-center z-50 p-4">
      <div class="glass rounded-2xl p-6 max-w-md w-full shadow-2xl border border-white/60 flex flex-col max-h-[80vh]">
        <h3 class="text-lg font-bold mb-2 shrink-0 flex items-center text-slate-800">
          <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 mr-1.5 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" /></svg>选择目标文件夹
        </h3>
        <div class="mb-3">
          <label class="text-xs font-medium text-slate-600">目标桶</label>
          <select v-model="pickerTargetBucket" class="w-full mt-1 text-sm rounded-xl border border-white/60 bg-white/50 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-400">
            <option v-for="b in allBuckets" :key="b.id" :value="b.id">{{ b.name }}</option>
          </select>
        </div>
        <div class="flex items-center space-x-1 text-xs font-semibold overflow-x-auto whitespace-nowrap bg-white/40 p-2.5 rounded-xl mb-3 border border-white/30 shrink-0">
          <span class="text-blue-600 cursor-pointer hover:underline" @click="jumpPickerPath(-1)">根目录</span>
          <template v-for="(f, idx) in pickerBreadcrumbs" :key="idx">
            <span class="text-slate-400">/</span>
            <span class="text-blue-600 cursor-pointer hover:underline" @click="jumpPickerPath(idx)">{{ f }}</span>
          </template>
        </div>
        <div class="flex-1 overflow-y-auto border border-slate-200/50 rounded-xl bg-white/30 min-h-[220px] mb-4 divide-y divide-white/20">
          <div v-if="pickerLoading" class="flex justify-center items-center h-32">
            <div class="animate-spin rounded-full h-6 w-6 border-2 border-blue-500 border-t-transparent"></div>
          </div>
          <template v-else>
            <div v-if="pickerCurrentPrefix" @click="navPickerUp" class="p-3 flex items-center space-x-2.5 hover:bg-white/50 cursor-pointer transition text-slate-600 text-sm font-medium">
              <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 15l-3-3m0 0l3-3m-3 3h8M3 12a9 9 0 1118 0 9 9 0 01-18 0z" /></svg>
              <span>返回上一级</span>
            </div>
            <div v-if="pickerFolders.length === 0" class="p-8 text-center text-xs text-slate-400 flex flex-col items-center justify-center space-y-1">
              <svg xmlns="http://www.w3.org/2000/svg" class="h-8 w-8 text-slate-300" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 19a2 2 0 01-2-2V7a2 2 0 012-2h4l2 2h4a2 2 0 012 2v1M5 19h14a2 2 0 002-2v-5" /></svg>
              <span>此目录下无子文件夹</span>
            </div>
            <div v-for="f in pickerFolders" :key="f.path" @click="enterPickerFolder(f.name)" class="p-3 flex items-center justify-between hover:bg-white/50 cursor-pointer transition group text-sm">
              <div class="flex items-center space-x-2.5 min-w-0">
                <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 text-amber-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" /></svg>
              <span class="font-medium truncate text-slate-700 group-hover:text-blue-600">{{ f.name }}</span>
            </div>
            <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 text-slate-300 group-hover:text-blue-400 transition transform group-hover:translate-x-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" /></svg>
          </template>
        </div>
        <div class="text-xs text-slate-500 bg-white/30 p-2.5 rounded-xl border border-white/20 mb-4 shrink-0">
          📂 目标路径：<span class="font-bold text-blue-600 break-all">{{ pickerTargetBucket }}/{{ pickerCurrentPrefix || '根' }}</span>
        </div>
        <div class="flex justify-end space-x-2 shrink-0">
          <button @click="moveModalActive = false" class="px-4 py-2 border border-slate-300 rounded-xl text-sm font-medium hover:bg-slate-50 cursor-pointer">取消</button>
          <button @click="executeMove" class="px-5 py-2 bg-blue-500 text-white rounded-xl text-sm font-medium hover:bg-blue-600 shadow-md cursor-pointer">确认移动</button>
        </div>
      </div>
    </div>

    <!-- 预览对话框 -->
    <div v-if="previewActive" class="fixed inset-0 bg-black/40 backdrop-blur-xs flex items-center justify-center z-50 p-4" @click.self="closePreview">
      <div class="glass rounded-2xl max-w-4xl w-full max-h-[90vh] flex flex-col shadow-2xl border border-white/60 overflow-hidden">
        <div class="p-4 bg-white/40 border-b border-white/20 flex items-center justify-between shrink-0">
          <h3 class="text-lg font-bold truncate">{{ previewFileName }}</h3>
          <button @click="closePreview" class="p-1.5 hover:bg-white/50 rounded-lg transition text-slate-500 cursor-pointer text-xl leading-none">&times;</button>
        </div>
        <div class="flex-1 overflow-auto p-4 bg-white/60">
          <div v-if="previewLoading" class="flex justify-center items-center h-64">
            <div class="animate-spin rounded-full h-8 w-8 border-4 border-blue-500 border-t-transparent"></div>
          </div>
          <div v-else-if="previewError" class="text-red-500 text-center p-8">{{ previewError }}</div>
          <img v-else-if="previewType === 'image'" :src="previewUrl" class="max-w-full max-h-[80vh] object-contain mx-auto" />
          <iframe v-else-if="previewType === 'pdf' || previewType === 'office'" :src="previewUrl" class="w-full h-[80vh] border-0" frameborder="0"></iframe>
          <div v-else-if="previewType === 'html'" v-html="previewContent" class="prose max-w-none"></div>
          <div v-else class="text-center text-slate-500 p-8">暂不支持预览此文件类型</div>
        </div>
      </div>
    </div>

    <!-- 上传进度面板 -->
    <div v-if="uploadActive" class="fixed bottom-6 right-6 w-[350px] max-w-[calc(100vw-2rem)] glass rounded-2xl shadow-2xl border border-white/50 z-50 overflow-hidden transition-all duration-300">
      <div @click="isMinimized = !isMinimized" class="p-4 bg-white/40 border-b border-white/20 flex items-center justify-between cursor-pointer select-none">
        <div class="flex items-center space-x-2 min-w-0">
          <div class="animate-spin rounded-full h-4 w-4 border-2 border-blue-500 border-t-transparent shrink-0"></div>
          <span class="font-bold text-sm text-slate-800 truncate">{{ uploadHeaderTitle }}</span>
        </div>
        <div class="flex items-center space-x-1 shrink-0 ml-2">
          <button class="p-1 hover:bg-white/40 rounded-lg transition text-slate-500">
            <svg v-if="!isMinimized" xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" /></svg>
            <svg v-else xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 15l7-7 7 7" /></svg>
          </button>
        </div>
      </div>
      <div v-show="!isMinimized" class="p-4 bg-white/10">
        <div class="flex items-center justify-between mb-1 text-xs font-medium text-slate-500">
          <span class="truncate pr-4 max-w-[70%]" :title="uploadStatusText">当前: {{ uploadStatusText }}</span>
          <span class="text-blue-600 font-bold bg-blue-50 px-1.5 py-0.5 rounded-sm shrink-0">{{ uploadSpeedText }}</span>
        </div>
        <div class="w-full bg-slate-200/80 rounded-full h-2.5 overflow-hidden mb-2 border border-slate-300/20">
          <div class="h-full transition-all duration-150 rounded-full" :style="{ width: uploadProgress + '%', background: 'linear-gradient(to right, #3b82f6, #4f46e5)' }"></div>
        </div>
        <div class="flex justify-between items-center text-[11px] text-slate-400">
          <span>总进度</span>
          <span class="font-bold text-slate-600">{{ uploadProgress }}%</span>
        </div>
      </div>
    </div>
  </div>

  <script>
    const { createApp, ref, computed, onMounted, nextTick } = Vue;
    const CHUNK_SIZE = 95 * 1024 * 1024;

    createApp({
      setup() {
        const adminRoute = '${adminPath}';
        const isAdmin = computed(() => window.location.pathname === adminRoute);
        const rawBuckets = ${bucketsJson};
        const allBuckets = ref(rawBuckets.map(b => ({ ...b, id: b.binding || b.endpoint })));
        const localBuckets = computed(() => allBuckets.value.filter(b => b.binding));

        // D1 是否已配置
        const d1Configured = ref(${d1Enabled});

        const inputPassword = ref('');
        const isAuthenticated = ref(false);
        const currentPrefix = ref('');
        const folders = ref([]);
        const files = ref([]);
        const loading = ref(false);
        const searchQuery = ref('');
        const isSearching = ref(false);
        const selectedItems = ref([]);
        const currentBucket = ref(allBuckets.value[0]?.id || '');

        const moveModalActive = ref(false);
        const pickerCurrentPrefix = ref('');
        const pickerFolders = ref([]);
        const pickerLoading = ref(false);
        const pickerTargetBucket = ref(localBuckets.value[0]?.id || '');

        const downloadToken = ref('');
        const enableTimestamp = ref(false);
        const uploadActive = ref(false);
        const uploadProgress = ref(0);
        const uploadStatusText = ref('');
        const uploadSpeedText = ref('0 B/s');
        const isMinimized = ref(false);
        const currentUploadIndex = ref(0);
        const totalUploadCount = ref(0);

        // 预览相关
        const previewActive = ref(false);
        const previewFileName = ref('');
        const previewType = ref('');
        const previewUrl = ref('');
        const previewContent = ref('');
        const previewLoading = ref(false);
        const previewError = ref('');

        // 标签切换
        const activeTab = ref('files');

        // 操作日志
        const logs = ref([]);
        const logLoading = ref(false);
        const logTotal = ref(0);
        const logTotalPages = ref(1);
        const logPage = ref(1);
        const logFilter = ref('');
        const logSearchFilename = ref('');

        const turnstileSiteKey = '${turnstileSiteKey}';
        const turnstileWidgetId = ref(null);
        const turnstileLoaded = ref(false);

        const breadcrumbs = computed(() => currentPrefix.value ? currentPrefix.value.split('/').filter(p => p) : []);
        const pickerBreadcrumbs = computed(() => pickerCurrentPrefix.value ? pickerCurrentPrefix.value.split('/').filter(p => p) : []);
        const isAllSelected = computed(() => {
          const total = folders.value.length + files.value.length;
          return total > 0 && selectedItems.value.length === total;
        });
        const uploadHeaderTitle = computed(() => {
          if (isMinimized.value) return \`上传中 (\${uploadProgress.value}%) · 剩 \${totalUploadCount.value - currentUploadIndex.value} 个\`;
          return \`上传任务 (\${currentUploadIndex.value + 1}/\${totalUploadCount.value})\`;
        });

        const getExtension = (name) => {
          if (!name) return '';
          const dot = name.lastIndexOf('.');
          return dot > -1 ? name.slice(dot + 1).toLowerCase() : '';
        };
        const PREVIEW_EXTS = new Set(['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp', 'pdf', 'txt', 'md', 'csv', 'docx', 'xlsx', 'pptx', 'doc', 'ppt', 'xls']);
        const isPreviewable = (name) => PREVIEW_EXTS.has(getExtension(name));

        const loadedScripts = {};
        const loadScript = (src) => {
          return new Promise((resolve, reject) => {
            if (loadedScripts[src]) return resolve();
            const script = document.createElement('script');
            script.src = src;
            script.onload = () => { loadedScripts[src] = true; resolve(); };
            script.onerror = reject;
            document.head.appendChild(script);
          });
        };

        const escapeHtml = (str) => {
          return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
        };

        const getSavedPassword = () => localStorage.getItem('r2_admin_pwd') || '';

        const loadItems = async () => {
          loading.value = true;
          selectedItems.value = [];
          try {
            let url = \`/api/list?prefix=\${encodeURIComponent(currentPrefix.value)}\`;
            if (isSearching.value && searchQuery.value.trim()) url += \`&q=\${encodeURIComponent(searchQuery.value.trim())}\`;
            const headers = {};
            const pwd = getSavedPassword();
            if (isAdmin.value && pwd) headers['X-Admin-Password'] = pwd;
            const res = await fetch(url, { headers });
            const data = await res.json();
            folders.value = data.folders || [];
            files.value = data.files || [];
          } catch (err) { alert('获取失败: ' + err.message); }
          finally { loading.value = false; }
        };

        const handleSearch = () => { if (!searchQuery.value.trim()) { clearSearch(); return; } isSearching.value = true; loadItems(); };
        const clearSearch = () => { searchQuery.value = ''; isSearching.value = false; loadItems(); };

        const loadPickerFolders = async () => {
          pickerLoading.value = true;
          try {
            const headers = {};
            const pwd = getSavedPassword();
            if (isAdmin.value && pwd) headers['X-Admin-Password'] = pwd;
            const res = await fetch(\`/api/list?prefix=\${encodeURIComponent(pickerCurrentPrefix.value)}\`, { headers });
            const data = await res.json();
            pickerFolders.value = data.folders || [];
          } catch (err) { alert('获取目录失败: ' + err.message); }
          finally { pickerLoading.value = false; }
        };

        // 加载操作日志
        const loadLogs = async () => {
          logLoading.value = true;
          try {
            const params = new URLSearchParams();
            params.set('page', logPage.value);
            params.set('pageSize', '50');
            if (logFilter.value) params.set('operation', logFilter.value);
            if (logSearchFilename.value) params.set('filename', logSearchFilename.value);
            const res = await fetch('/api/logs?' + params.toString(), {
              headers: { 'X-Admin-Password': getSavedPassword() }
            });
            if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error(err.error || '查询失败'); }
            const data = await res.json();
            logs.value = data.logs || [];
            logTotal.value = data.total || 0;
            logTotalPages.value = data.totalPages || 1;
          } catch (err) { alert('获取日志失败: ' + err.message); }
          finally { logLoading.value = false; }
        };

        // 容量统计
        const capacityBuckets = ref([]);
        const capacityLoading = ref(false);
        const capacityLimit = ref(10 * 1024 * 1024 * 1024); // 默认 10GB，加载后以接口返回为准

        const loadStorageUsage = async () => {
          capacityLoading.value = true;
          try {
            const res = await fetch('/api/storage-usage', {
              headers: { 'X-Admin-Password': getSavedPassword() }
            });
            if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error(err.error || '查询失败'); }
            const data = await res.json();
            capacityLimit.value = data.limit || capacityLimit.value;
            capacityBuckets.value = (data.buckets || []).map(b => ({
              ...b,
              percent: b.limit ? Math.round((b.used / b.limit) * 100) : 0
            }));
          } catch (err) { alert('获取容量统计失败: ' + err.message); }
          finally { capacityLoading.value = false; }
        };

        // 圆形图辅助（SVG 圆环）：返回 stroke-dasharray，周长 = 2π × 50
        const CAPACITY_CIRCUMFERENCE = (2 * Math.PI * 50).toFixed(2);
        const capacityArc = (percent) => {
          const pct = Math.max(0, Math.min(100, percent || 0));
          const arc = ((pct / 100) * (2 * Math.PI * 50)).toFixed(2);
          return arc + ' ' + CAPACITY_CIRCUMFERENCE;
        };
        const capacityColor = (percent) => {
          if (percent >= 90) return '#ef4444'; // 红色：即将满
          if (percent >= 70) return '#f59e0b'; // 橙色：较多
          return '#3b82f6';                    // 蓝色：正常
        };

        // 初始化 D1 数据库
        const initD1Database = async () => {
          if (!confirm('初始化 D1 数据库将创建 operation_logs 表（如果不存在）。继续？')) return;
          try {
            const res = await fetch('/api/init-db', {
              method: 'POST',
              headers: { 'X-Admin-Password': getSavedPassword() }
            });
            const data = await res.json();
            if (res.ok) {
              alert('✅ ' + data.message);
              loadLogs();
            } else {
              alert('❌ ' + (data.error || '初始化失败'));
            }
          } catch (err) { alert('请求出错: ' + err.message); }
        };

        // 日志辅助
        const logBadgeClass = (op) => {
          const map = {
            '下载': 'log-badge-download', '预览': 'log-badge-preview',
            '上传': 'log-badge-upload', '上传(分块)': 'log-badge-upload',
            '删除': 'log-badge-delete', '新建目录': 'log-badge-mkdir',
            '移动': 'log-badge-move'
          };
          return map[op] || '';
        };
        const formatLogTime = (iso) => {
          if (!iso) return '-';
          try {
            return new Date(iso).toLocaleString('zh-CN', { hour12: false });
          } catch { return iso; }
        };

        const toggleSelectAll = (e) => {
          if (e.target.checked) selectedItems.value = [...folders.value, ...files.value];
          else selectedItems.value = [];
        };

        const verifyPassword = async () => {
          const pwd = inputPassword.value;
          let token = null;

          if (turnstileSiteKey && turnstileWidgetId.value) {
            token = turnstile.getResponse(turnstileWidgetId.value);
            if (!token) {
              alert('请完成人机验证');
              turnstile.execute(turnstileWidgetId.value);
              return;
            }
          }

          try {
            const res = await fetch('/api/verify', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ password: pwd, token: token || undefined })
            });
            if (res.ok) {
              localStorage.setItem('r2_admin_pwd', pwd);
              isAuthenticated.value = true;
              // 检查 URL hash 决定打开哪个标签
              if (window.location.hash === '#logs' && d1Configured.value) {
                activeTab.value = 'logs';
                loadLogs();
              } else {
                loadItems();
              }
            } else {
              const data = await res.json();
              alert(data.error || '验证失败');
              if (turnstileSiteKey && turnstileWidgetId.value) {
                turnstile.reset(turnstileWidgetId.value);
              }
            }
          } catch (err) {
            alert('请求出错: ' + err.message);
            if (turnstileSiteKey && turnstileWidgetId.value) {
              turnstile.reset(turnstileWidgetId.value);
            }
          }
        };

        const enterFolder = (folder) => {
          if (isSearching.value) { currentPrefix.value = folder.path; isSearching.value = false; searchQuery.value = ''; }
          else currentPrefix.value += folder.name + '/';
          loadItems();
        };

        const enterPickerFolder = (name) => { pickerCurrentPrefix.value += name + '/'; loadPickerFolders(); };
        const navPickerUp = () => {
          const parts = pickerBreadcrumbs.value;
          pickerCurrentPrefix.value = parts.length <= 1 ? '' : parts.slice(0, -1).join('/') + '/';
          loadPickerFolders();
        };
        const jumpPickerPath = (idx) => {
          pickerCurrentPrefix.value = idx === -1 ? '' : pickerBreadcrumbs.value.slice(0, idx + 1).join('/') + '/';
          loadPickerFolders();
        };
        const jumpToPath = (idx) => {
          currentPrefix.value = idx === -1 ? '' : breadcrumbs.value.slice(0, idx + 1).join('/') + '/';
          isSearching.value = false; searchQuery.value = '';
          loadItems();
        };
        const resetPath = () => {
          activeTab.value = 'files';
          currentPrefix.value = ''; isSearching.value = false; searchQuery.value = ''; loadItems();
        };

        const downloadFile = (file) => {
          const bucketId = file.bucketBinding || file.remoteEndpoint;
          const tokenParam = downloadToken.value ? \`&token=\${encodeURIComponent(downloadToken.value)}\` : '';
          const url = \`/api/raw/\${encodeURIComponent(file.path)}?download=1&bucket=\${encodeURIComponent(bucketId)}\${tokenParam}\`;
          const a = document.createElement('a'); a.href = url; a.style.display = 'none'; document.body.appendChild(a); a.click(); document.body.removeChild(a);
        };

        const copyLink = (file) => {
          const bucketId = file.bucketBinding || file.remoteEndpoint;
          const tokenParam = downloadToken.value ? \`&token=\${encodeURIComponent(downloadToken.value)}\` : '';
          const url = \`\${window.location.origin}/api/raw/\${encodeURIComponent(file.path)}?bucket=\${encodeURIComponent(bucketId)}\${tokenParam}\`;
          navigator.clipboard.writeText(url).then(() => alert('链接已复制（10分钟内有效）')).catch(() => alert('复制失败，手动复制：' + url));
        };

        // 预览文件
        const previewFile = async (file) => {
          const bucketId = file.bucketBinding || file.remoteEndpoint;
          const tokenParam = downloadToken.value ? \`&token=\${encodeURIComponent(downloadToken.value)}\` : '';
          const rawUrl = \`/api/raw/\${encodeURIComponent(file.path)}?preview=1&bucket=\${encodeURIComponent(bucketId)}\${tokenParam}\`;
          const ext = getExtension(file.name);

          previewFileName.value = file.name;
          previewActive.value = true;
          previewLoading.value = true;
          previewError.value = '';
          previewType.value = '';
          previewUrl.value = '';
          previewContent.value = '';

          try {
            if (['jpg','jpeg','png','gif','bmp','webp'].includes(ext)) {
              previewUrl.value = rawUrl;
              previewType.value = 'image';
            } else if (ext === 'pdf') {
              const res = await fetch(rawUrl);
              if (!res.ok) throw new Error('文件加载失败');
              const blob = await res.blob();
              previewUrl.value = URL.createObjectURL(blob);
              previewType.value = 'pdf';
            } else if (ext === 'txt') {
              const res = await fetch(rawUrl);
              const text = await res.text();
              previewContent.value = '<pre>' + escapeHtml(text) + '</pre>';
              previewType.value = 'html';
            } else if (ext === 'md') {
              await loadScript('https://cdn.jsdelivr.net/npm/marked/marked.min.js');
              const res = await fetch(rawUrl);
              const text = await res.text();
              const html = marked.parse(text);
              previewContent.value = html;
              previewType.value = 'html';
            } else if (ext === 'csv') {
              const res = await fetch(rawUrl);
              const text = await res.text();
              const lines = text.split('\\n').filter(line => line.trim());
              if (lines.length === 0) {
                previewContent.value = '<p class="text-slate-400">空文件</p>';
              } else {
                const tableRows = lines.map(line => {
                  const cells = line.split(',').map(c => escapeHtml(c.trim()));
                  return '<tr>' + cells.map(c => '<td class="border border-slate-300 px-2 py-1">' + c + '</td>').join('') + '</tr>';
                }).join('');
                previewContent.value = '<table class="min-w-full border-collapse">' + tableRows + '</table>';
              }
              previewType.value = 'html';
            } else if (ext === 'docx') {
              await loadScript('https://cdn.jsdelivr.net/npm/mammoth@1.9.0/mammoth.browser.min.js');
              if (typeof mammoth === 'undefined') throw new Error('预览组件加载失败，请刷新后重试');
              const res = await fetch(rawUrl);
              if (!res.ok) throw new Error('文件下载失败');
              const arrayBuffer = await res.arrayBuffer();
              try {
                const result = await mammoth.convertToHtml({ arrayBuffer });
                previewContent.value = result.value;
                previewType.value = 'html';
              } catch (convertErr) {
                console.warn('Mammoth 转换失败，尝试 Office Online 预览', convertErr);
                const officeUrl = rawUrl + '&preview=1';
                previewUrl.value = \`https://view.officeapps.live.com/op/embed.aspx?src=\${encodeURIComponent(window.location.origin + officeUrl)}\`;
                previewType.value = 'office';
              }
            } else if (ext === 'xlsx') {
              await loadScript('https://cdn.sheetjs.com/xlsx-0.20.1/package/dist/xlsx.full.min.js');
              if (typeof XLSX === 'undefined') throw new Error('预览组件加载失败，请刷新后重试');
              const res = await fetch(rawUrl);
              if (!res.ok) throw new Error('文件下载失败');
              const arrayBuffer = await res.arrayBuffer();
              try {
                const wb = XLSX.read(arrayBuffer, { type: 'array' });
                const sheetName = wb.SheetNames[0];
                if (!sheetName) throw new Error('工作簿中没有工作表');
                const sheet = wb.Sheets[sheetName];
                const html = XLSX.utils.sheet_to_html(sheet, { editable: false });
                previewContent.value = html;
                previewType.value = 'html';
              } catch (sheetErr) {
                console.warn('SheetJS 转换失败，尝试 Office Online 预览', sheetErr);
                const officeUrl = rawUrl + '&preview=1';
                previewUrl.value = \`https://view.officeapps.live.com/op/embed.aspx?src=\${encodeURIComponent(window.location.origin + officeUrl)}\`;
                previewType.value = 'office';
              }
            } else if (['doc','ppt','pptx','xls'].includes(ext)) {
              const officeUrl = rawUrl + '&preview=1';
              previewUrl.value = \`https://view.officeapps.live.com/op/embed.aspx?src=\${encodeURIComponent(window.location.origin + officeUrl)}\`;
              previewType.value = 'office';
            } else {
              throw new Error('不支持的文件类型');
            }
          } catch (err) {
            previewError.value = '预览失败：' + (err.message || '未知错误');
          } finally {
            previewLoading.value = false;
          }
        };

        const closePreview = () => {
          if (previewUrl.value && previewUrl.value.startsWith('blob:')) {
            URL.revokeObjectURL(previewUrl.value);
          }
          previewActive.value = false;
          previewFileName.value = '';
          previewType.value = '';
          previewUrl.value = '';
          previewContent.value = '';
          previewError.value = '';
        };

        const triggerMoveSingle = (item) => {
          selectedItems.value = [item];
          pickerCurrentPrefix.value = '';
          pickerTargetBucket.value = item.bucketBinding || item.remoteEndpoint || allBuckets.value[0]?.id || '';
          loadPickerFolders();
          moveModalActive.value = true;
        };
        const triggerMoveBatch = () => {
          if (selectedItems.value.length === 0) { alert('没有选中任何项目'); return; }
          pickerCurrentPrefix.value = '';
          pickerTargetBucket.value = localBuckets.value.length > 0 ? localBuckets.value[0].id : allBuckets.value[0]?.id || '';
          loadPickerFolders();
          moveModalActive.value = true;
        };

        const executeMove = async () => {
          if (selectedItems.value.length === 0) return;
          for (const item of selectedItems.value) {
            const srcBucketId = item.bucketBinding || item.remoteEndpoint;
            if (item.type === 'folder' && pickerTargetBucket.value === srcBucketId && pickerCurrentPrefix.value.startsWith(item.path)) {
              alert(\`不能将文件夹 "\${item.name}" 移动到自身内部\`);
              return;
            }
          }
          loading.value = true; moveModalActive.value = false;
          try {
            const res = await fetch('/api/move', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'X-Admin-Password': getSavedPassword() },
              body: JSON.stringify({
                items: selectedItems.value.map(i => ({
                  path: i.path,
                  type: i.type,
                  bucketBinding: i.bucketBinding,
                  remoteEndpoint: i.remoteEndpoint,
                  remoteToken: i.remoteToken
                })),
                targetPrefix: pickerCurrentPrefix.value,
                targetBucket: pickerTargetBucket.value
              })
            });
            if (res.ok) { selectedItems.value = []; loadItems(); }
            else { const err = await res.json(); alert('移动失败: ' + (err.error || '')); loadItems(); }
          } catch (err) { alert('请求出错: ' + err.message); loadItems(); }
        };

        const triggerFileUpload = () => {
          if (!currentBucket.value) { alert('请选择目标桶'); return; }
          const el = document.getElementById('fileInput');
          if (el) el.click();
        };
        const triggerFolderUpload = () => {
          if (!currentBucket.value) { alert('请选择目标桶'); return; }
          const el = document.getElementById('folderInput');
          if (el) el.click();
        };

        const handleFilesSelected = (e) => {
          const files = Array.from(e.target.files);
          if (files.length) executeUploadQueue(files, false);
          e.target.value = '';
        };
        const handleFolderSelected = (e) => {
          const files = Array.from(e.target.files);
          if (files.length) executeUploadQueue(files, true);
          e.target.value = '';
        };

        const executeUploadQueue = async (filesArray, isFolder) => {
          const uploadPrefix = currentPrefix.value;
          const bucket = currentBucket.value;
          uploadActive.value = true; isMinimized.value = false; uploadProgress.value = 0; uploadSpeedText.value = '0 B/s';
          totalUploadCount.value = filesArray.length;

          for (let i = 0; i < filesArray.length; i++) {
            currentUploadIndex.value = i;
            const file = filesArray[i];
            const rawFilename = isFolder ? file.webkitRelativePath : file.name;
            const filename = enableTimestamp.value
              ? (isFolder
                  ? (() => {
                      const parts = rawFilename.split('/');
                      parts[parts.length - 1] = addTimestampToFilename(parts[parts.length - 1]);
                      return parts.join('/');
                    })()
                  : addTimestampToFilename(rawFilename))
              : rawFilename;
            const finalKey = uploadPrefix + filename;
            uploadStatusText.value = file.name;
            const addTsHeader = enableTimestamp.value ? 'true' : 'false';

            try {
              if (file.size > CHUNK_SIZE) {
                await multipartUpload(file, finalKey, bucket, (progress, speed) => {
                  const totalProgress = ((i / filesArray.length) * 100) + (progress / filesArray.length);
                  uploadProgress.value = Math.min(99, Math.round(totalProgress));
                  uploadSpeedText.value = speed;
                });
              } else {
                await new Promise((resolve, reject) => {
                  const xhr = new XMLHttpRequest();
                  xhr.open('POST', '/api/upload');
                  xhr.setRequestHeader('X-Admin-Password', getSavedPassword());
                  xhr.setRequestHeader('X-Target-Bucket', bucket);
                  xhr.setRequestHeader('X-Add-Timestamp', addTsHeader);
                  let lastTime = Date.now(), lastLoaded = 0;
                  xhr.upload.addEventListener('progress', (event) => {
                    if (event.lengthComputable) {
                      const now = Date.now(), diff = (now - lastTime) / 1000;
                      if (diff >= 0.4) {
                        const loadedDiff = event.loaded - lastLoaded;
                        uploadSpeedText.value = formatSpeed(loadedDiff / diff);
                        lastTime = now; lastLoaded = event.loaded;
                      }
                      const fileProgress = (event.loaded / event.total) * 100;
                      const totalProgress = ((i / filesArray.length) * 100) + (fileProgress / filesArray.length);
                      uploadProgress.value = Math.round(totalProgress);
                    }
                  });
                  xhr.onload = () => xhr.status === 200 ? resolve() : reject(new Error('上传失败'));
                  xhr.onerror = () => reject(new Error('连接中断'));
                  const fd = new FormData();
                  fd.append('file', file);
                  fd.append('prefix', uploadPrefix);
                  fd.append('filename', filename);
                  xhr.send(fd);
                });
              }
            } catch (err) {
              alert(\`上传 \${file.name} 失败: \${err.message}\`);
              break;
            }
          }
          uploadActive.value = false;
          if (currentPrefix.value === uploadPrefix) loadItems();
        };

        const multipartUpload = async (file, key, bucket, onProgress) => {
          const totalChunks = Math.ceil(file.size / CHUNK_SIZE);
          let uploadId = null;
          const parts = [];

          try {
            const initRes = await fetch('/api/multipart/initiate', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'X-Admin-Password': getSavedPassword(),
                'X-Add-Timestamp': enableTimestamp.value ? 'true' : 'false',
              },
              body: JSON.stringify({ key, bucket }),
            });
            if (!initRes.ok) throw new Error('初始化上传失败');
            const initData = await initRes.json();
            uploadId = initData.uploadId;

            let lastTime = Date.now();
            let lastLoaded = 0;

            for (let partNum = 1; partNum <= totalChunks; partNum++) {
              const start = (partNum - 1) * CHUNK_SIZE;
              const end = Math.min(start + CHUNK_SIZE, file.size);
              const chunk = file.slice(start, end);

              await new Promise((resolve, reject) => {
                const xhr = new XMLHttpRequest();
                xhr.open('PUT', \`/api/multipart/upload-part?key=\${encodeURIComponent(key)}\`);
                xhr.setRequestHeader('X-Admin-Password', getSavedPassword());
                xhr.setRequestHeader('X-Target-Bucket', bucket);
                xhr.setRequestHeader('X-Upload-Id', uploadId);
                xhr.setRequestHeader('X-Part-Number', partNum);
                xhr.setRequestHeader('X-Add-Timestamp', enableTimestamp.value ? 'true' : 'false');
                xhr.setRequestHeader('Content-Type', 'application/octet-stream');

                xhr.upload.addEventListener('progress', (event) => {
                  if (event.lengthComputable) {
                    const now = Date.now();
                    const diff = (now - lastTime) / 1000;
                    if (diff >= 0.5) {
                      const loadedDiff = (start + event.loaded) - lastLoaded;
                      const speed = formatSpeed(loadedDiff / diff);
                      const overallCompleted = (partNum - 1) * CHUNK_SIZE + event.loaded;
                      const progress = (overallCompleted / file.size) * 100;
                      onProgress(progress, speed);
                      lastTime = now;
                      lastLoaded = start + event.loaded;
                    }
                  }
                });

                xhr.onload = () => {
                  if (xhr.status === 200) {
                    const { etag } = JSON.parse(xhr.responseText);
                    parts.push({ partNumber: partNum, etag });
                    resolve();
                  } else {
                    try {
                      const err = JSON.parse(xhr.responseText);
                      reject(new Error(err.error || '上传分块失败'));
                    } catch { reject(new Error('上传分块失败')); }
                  }
                };
                xhr.onerror = () => reject(new Error('网络错误'));
                xhr.send(chunk);
              });
            }

            const completeRes = await fetch('/api/multipart/complete', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'X-Admin-Password': getSavedPassword(),
                'X-Add-Timestamp': enableTimestamp.value ? 'true' : 'false',
              },
              body: JSON.stringify({ key, uploadId, parts, bucket }),
            });
            if (!completeRes.ok) {
              const err = await completeRes.json().catch(() => ({ error: '完成上传失败' }));
              throw new Error(err.error || '完成上传失败');
            }
          } catch (err) {
            if (uploadId) {
              await fetch('/api/multipart/abort', {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'X-Admin-Password': getSavedPassword(),
                  'X-Add-Timestamp': enableTimestamp.value ? 'true' : 'false',
                },
                body: JSON.stringify({ key, uploadId, bucket }),
              }).catch(() => {});
            }
            throw err;
          }
        };

        const promptMkdir = async () => {
          if (!currentBucket.value) { alert('请选择目标桶'); return; }
          const name = prompt('输入新目录名称:');
          if (!name || !name.trim()) return;
          try {
            const res = await fetch('/api/mkdir', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'X-Admin-Password': getSavedPassword() },
              body: JSON.stringify({ prefix: currentPrefix.value, name: name.trim(), bucket: currentBucket.value })
            });
            if (res.ok) loadItems(); else alert('新建失败');
          } catch (err) { alert('请求出错: ' + err.message); }
        };

        const deleteItem = async (item) => {
          const bucketId = item.bucketBinding || item.remoteEndpoint;
          if (!bucketId) { alert('无法确定桶标识'); return; }
          const msg = item.type === 'folder' ? \`确定删除目录 "\${item.name}" 及其全部内容？\` : \`确定删除文件 "\${item.name}"？\`;
          if (!confirm(msg)) return;
          try {
            const res = await fetch('/api/delete', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'X-Admin-Password': getSavedPassword() },
              body: JSON.stringify({ path: item.path, type: item.type, bucket: bucketId })
            });
            if (res.ok) loadItems(); else alert('删除失败');
          } catch (err) { alert('请求出错: ' + err.message); }
        };

        const deleteSelectedItems = async () => {
          if (selectedItems.value.length === 0) return;
          if (!confirm(\`确定批量删除选中的 \${selectedItems.value.length} 项？\`)) return;
          loading.value = true;
          try {
            const tasks = selectedItems.value.map(item => {
              const bucketId = item.bucketBinding || item.remoteEndpoint;
              return fetch('/api/delete', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-Admin-Password': getSavedPassword() },
                body: JSON.stringify({ path: item.path, type: item.type, bucket: bucketId })
              });
            });
            await Promise.all(tasks);
            selectedItems.value = [];
            loadItems();
          } catch (err) { alert('批量删除出错: ' + err.message); loadItems(); }
        };

        const addTimestampToFilename = (name) => {
          const tsPattern = /_\\d{5}(\\.[^.]*)?$/;
          if (tsPattern.test(name)) return name;
          const now = new Date();
          const secondsSinceMidnight = now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds();
          const ts = String(secondsSinceMidnight).padStart(5, '0');
          const lastDot = name.lastIndexOf('.');
          if (lastDot <= 0) return name + '_' + ts;
          return name.slice(0, lastDot) + '_' + ts + name.slice(lastDot);
        };

        const formatSpeed = (bps) => {
          if (!bps || isNaN(bps)) return '0 B/s';
          const k = 1024, sizes = ['B/s', 'KB/s', 'MB/s', 'GB/s'];
          const i = Math.floor(Math.log(bps) / Math.log(k));
          return parseFloat((bps / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
        };
        const formatSize = (bytes) => {
          if (bytes === 0) return '0 B';
          const k = 1024, sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
          const i = Math.floor(Math.log(bytes) / Math.log(k));
          return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
        };
        const formatTime = (iso) => {
          if (!iso) return '-';
          return new Date(iso).toLocaleString('zh-CN', { hour12: false });
        };

        onMounted(async () => {
          try {
            const tokenRes = await fetch('/api/download-token');
            if (tokenRes.ok) {
              const tokenData = await tokenRes.json();
              downloadToken.value = tokenData.token;
            }
          } catch (_) {}

          if (isAdmin.value) {
            const savedPwd = getSavedPassword();
            if (savedPwd && !turnstileSiteKey) {
              const res = await fetch('/api/verify', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ password: savedPwd })
              });
              if (res.ok) {
                isAuthenticated.value = true;
                // 检查 URL hash 决定初始标签
                if (window.location.hash === '#logs' && d1Configured.value) {
                  activeTab.value = 'logs';
                  loadLogs();
                } else {
                  loadItems();
                }
                return;
              }
            }
            if (turnstileSiteKey) {
              const script = document.createElement('script');
              script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
              script.onload = () => {
                if (window.turnstile) {
                  turnstileWidgetId.value = window.turnstile.render('#turnstile-widget', {
                    sitekey: turnstileSiteKey,
                  });
                  turnstileLoaded.value = true;
                }
              };
              document.head.appendChild(script);
            }
          } else {
            loadItems();
          }
        });

        return {
          isAdmin, d1Configured, inputPassword, isAuthenticated, currentPrefix, folders, files, loading, breadcrumbs,
          allBuckets, localBuckets, currentBucket,
          searchQuery, isSearching, handleSearch, clearSearch,
          selectedItems, isAllSelected, toggleSelectAll, deleteSelectedItems,
          verifyPassword, enterFolder, jumpToPath, resetPath,
          downloadFile, copyLink,
          triggerFileUpload, triggerFolderUpload, handleFilesSelected, handleFolderSelected,
          promptMkdir, deleteItem,
          moveModalActive, pickerCurrentPrefix, pickerFolders, pickerLoading, pickerBreadcrumbs,
          pickerTargetBucket, enterPickerFolder, navPickerUp, jumpPickerPath,
          triggerMoveSingle, triggerMoveBatch, executeMove,
          uploadActive, uploadProgress, uploadStatusText, uploadSpeedText, isMinimized, uploadHeaderTitle,
          enableTimestamp,
          formatSize, formatTime,
          previewActive, previewFileName, previewType, previewUrl, previewContent, previewLoading, previewError,
          isPreviewable, previewFile, closePreview,
          activeTab, logs, logLoading, logTotal, logTotalPages, logPage, logFilter, logSearchFilename,
          loadLogs, initD1Database, logBadgeClass, formatLogTime,
          capacityBuckets, capacityLoading, capacityLimit, loadStorageUsage, capacityArc, capacityColor
        };
      }
    }).mount('#app');
  </script>
</body>
</html>`;
}
