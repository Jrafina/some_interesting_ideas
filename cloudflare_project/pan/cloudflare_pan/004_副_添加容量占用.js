// ========== 副账号 Worker：R2 代理 API（支持大文件分块上传，修正 uploadPart 调用） ==========

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

// ========== 搜索索引缓存（减少 R2 Class A 操作） ==========
const INDEX_FILE = '.r2index.json';
const INDEX_TTL = 60;

async function getSearchIndex(r2) {
  try {
    const obj = await r2.get(INDEX_FILE);
    if (obj) {
      const data = await obj.json();
      if (data.built && (Date.now() - data.built) / 1000 < INDEX_TTL) return data.entries || [];
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

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    // CORS 预检
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': 'https://pan2.ppig.eu.cc',
          'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, X-Auth-Token, X-Admin-Password, X-Upload-Id, X-Part-Number, X-Target-Bucket',
          'Access-Control-Max-Age': '86400',
        },
      });
    }

    const corsHeaders = {
      'Access-Control-Allow-Origin': 'https://pan2.ppig.eu.cc',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, X-Auth-Token, X-Admin-Password, X-Upload-Id, X-Part-Number, X-Target-Bucket',
    };

    const token = env.AUTH_TOKEN;
    const checkAuth = (req) => {
      if (token && req.headers.get('X-Auth-Token') !== token) return false;
      return true;
    };

    // ---------- 列出文件 / 搜索 ----------
    if (path === '/api/list') {
      const prefix = url.searchParams.get('prefix') || '';
      const q = url.searchParams.get('q') || '';
      try {
        if (q.trim()) {
          const lower = q.trim().toLowerCase();
          // 使用索引缓存搜索，避免每次全量扫描 R2
          const entries = await getSearchIndex(env.MY_BUCKET);
          const folders = new Map();
          const files = [];
          for (const entry of entries) {
            const parts = entry.key.split('/');
            if (entry.type === 'folder') {
              if (entry.name.toLowerCase().includes(lower)) folders.set(entry.key, { name: entry.name, path: entry.key, type: 'folder' });
            } else {
              if (entry.name.toLowerCase().includes(lower)) files.push({ name: entry.name, path: entry.key, type: 'file', size: entry.size, uploaded: entry.uploaded });
              let cur = '';
              for (let i = 0; i < parts.length - 1; i++) {
                cur += parts[i] + '/';
                if (parts[i].toLowerCase().includes(lower)) folders.set(cur, { name: parts[i], path: cur, type: 'folder' });
              }
            }
          }
          const sf = [...folders.values()].filter(f => !f.name.startsWith('.'));
          const ff = files.filter(f => !f.name.startsWith('.'));
          return Response.json({ folders: sf, files: ff }, { headers: corsHeaders });
        } else {
          const list = await env.MY_BUCKET.list({ delimiter: '/', prefix });
          const folders = list.delimitedPrefixes.map(p => ({
            name: p.replace(prefix, '').replace('/', ''),
            path: p,
            type: 'folder'
          }));
          const files = list.objects
            .filter(o => o.key !== prefix)
            .map(o => ({
              name: o.key.replace(prefix, ''),
              path: o.key,
              type: 'file',
              size: o.size,
              uploaded: o.uploaded
            }));
          const sf2 = folders.filter(f => !f.name.startsWith('.'));
          const ff2 = files.filter(f => !f.name.startsWith('.'));
          return Response.json({ folders: sf2, files: ff2 }, { headers: corsHeaders });
        }
      } catch (err) {
        return Response.json({ error: err.message }, { status: 500, headers: corsHeaders });
      }
    }

    // ---------- 下载 / 预览 ----------
    if (path.startsWith('/api/raw/')) {
      const key = decodeURIComponent(path.slice('/api/raw/'.length));

      // 🔒 禁止访问隐藏文件（. 开头），防止 .r2index.json 等内部文件泄露
      const filename = key.split('/').pop();
      if (filename && filename.startsWith('.')) {
        return new Response('Forbidden', { status: 403, headers: corsHeaders });
      }

      const obj = await env.MY_BUCKET.get(key);
      if (!obj) return new Response('Not found', { status: 404, headers: corsHeaders });
      const headers = new Headers(corsHeaders);
      obj.writeHttpMetadata(headers);
      headers.set('etag', obj.httpEtag);
      if (url.searchParams.has('download')) {
        const filename = key.split('/').pop();
        headers.set('Content-Disposition', "attachment; filename*=UTF-8''" + encodeURIComponent(filename));
      }
      return new Response(obj.body, { headers });
    }

    // ---------- 普通上传 ----------
    if (path === '/api/upload') {
      if (!checkAuth(request)) return new Response('Unauthorized', { status: 401, headers: corsHeaders });
      try {
        const formData = await request.formData();
        const file = formData.get('file');
        const prefix = formData.get('prefix') || '';
        const customFilename = formData.get('filename');
        if (!file) return new Response('没有文件', { status: 400, headers: corsHeaders });
        const addTs = request.headers.get('X-Add-Timestamp');
        const key = prefix + (addTs === 'false' ? (customFilename || file.name) : addTimestamp(customFilename || file.name));
        await env.MY_BUCKET.put(key, file.stream(), {
          httpMetadata: { contentType: file.type || 'application/octet-stream' }
        });
        invalidateIndex(env.MY_BUCKET);
        return Response.json({ success: true }, { headers: corsHeaders });
      } catch (err) {
        return Response.json({ error: err.message }, { status: 500, headers: corsHeaders });
      }
    }

    // ========== 分块上传接口（修正后） ==========

    // 初始化
    if (path === '/api/multipart/initiate' && request.method === 'POST') {
      if (!checkAuth(request)) return new Response('Unauthorized', { status: 401, headers: corsHeaders });
      try {
        const { key: rawKey } = await request.json();
        const addTs = request.headers.get('X-Add-Timestamp');
        const key = addTs === 'false' ? rawKey : addTimestamp(rawKey);
        const mpu = await env.MY_BUCKET.createMultipartUpload(key);
        return Response.json({ uploadId: mpu.uploadId, key: mpu.key }, { headers: corsHeaders });
      } catch (err) {
        return Response.json({ error: err.message }, { status: 500, headers: corsHeaders });
      }
    }

    // 上传分块（修正：使用 resumeMultipartUpload）
    if (path === '/api/multipart/upload-part' && request.method === 'PUT') {
      if (!checkAuth(request)) return new Response('Unauthorized', { status: 401, headers: corsHeaders });
      try {
        const uploadId = request.headers.get('X-Upload-Id');
        const partNumber = parseInt(request.headers.get('X-Part-Number') || '1');
        const key = url.searchParams.get('key');
        if (!uploadId || !key) return new Response('缺少参数', { status: 400, headers: corsHeaders });
        // 🔧 修正：恢复 MultipartUpload 对象，再上传分块
        const mpu = env.MY_BUCKET.resumeMultipartUpload(key, uploadId);
        const part = await mpu.uploadPart(partNumber, request.body);
        return Response.json({ partNumber, etag: part.etag }, { headers: corsHeaders });
      } catch (err) {
        return Response.json({ error: err.message }, { status: 500, headers: corsHeaders });
      }
    }

    // 完成上传（修正：使用 complete 方法）
    if (path === '/api/multipart/complete' && request.method === 'POST') {
      if (!checkAuth(request)) return new Response('Unauthorized', { status: 401, headers: corsHeaders });
      try {
        const { key, uploadId, parts } = await request.json();
        const mpu = env.MY_BUCKET.resumeMultipartUpload(key, uploadId);
        await mpu.complete(parts);
        invalidateIndex(env.MY_BUCKET);
        return Response.json({ success: true }, { headers: corsHeaders });
      } catch (err) {
        return Response.json({ error: err.message }, { status: 500, headers: corsHeaders });
      }
    }

    // 取消上传（修正：使用 abort 方法）
    if (path === '/api/multipart/abort' && request.method === 'POST') {
      if (!checkAuth(request)) return new Response('Unauthorized', { status: 401, headers: corsHeaders });
      try {
        const { key, uploadId } = await request.json();
        const mpu = env.MY_BUCKET.resumeMultipartUpload(key, uploadId);
        await mpu.abort();
        return Response.json({ success: true }, { headers: corsHeaders });
      } catch (err) {
        return Response.json({ error: err.message }, { status: 500, headers: corsHeaders });
      }
    }

    // ---------- 新建文件夹 ----------
    if (path === '/api/mkdir') {
      if (!checkAuth(request)) return new Response('Unauthorized', { status: 401, headers: corsHeaders });
      try {
        const { prefix, name } = await request.json();
        await env.MY_BUCKET.put(prefix + name + '/', '');
        invalidateIndex(env.MY_BUCKET);
        return Response.json({ success: true }, { headers: corsHeaders });
      } catch (err) {
        return Response.json({ error: err.message }, { status: 500, headers: corsHeaders });
      }
    }

    // ---------- 删除 ----------
    if (path === '/api/delete') {
      if (!checkAuth(request)) return new Response('Unauthorized', { status: 401, headers: corsHeaders });
      try {
        const { path: delPath, type } = await request.json();
        if (type === 'file') {
          await env.MY_BUCKET.delete(delPath);
        } else {
          let list = await env.MY_BUCKET.list({ prefix: delPath });
          while (list.objects.length) {
            await Promise.all(list.objects.map(o => env.MY_BUCKET.delete(o.key)));
            if (list.truncated) list = await env.MY_BUCKET.list({ prefix: delPath, cursor: list.cursor });
            else break;
          }
        }
        invalidateIndex(env.MY_BUCKET);
        return Response.json({ success: true }, { headers: corsHeaders });
      } catch (err) {
        return Response.json({ error: err.message }, { status: 500, headers: corsHeaders });
      }
    }

    // ---------- 移动（桶内复制+删除） ----------
    if (path === '/api/move') {
      if (!checkAuth(request)) return new Response('Unauthorized', { status: 401, headers: corsHeaders });
      try {
        const { items, targetPrefix } = await request.json();
        for (const item of items) {
          if (item.type === 'file') {
            const obj = await env.MY_BUCKET.get(item.path);
            if (!obj) continue;
            const newKey = targetPrefix + item.path.split('/').pop();
            await env.MY_BUCKET.put(newKey, obj.body, { httpMetadata: obj.httpMetadata });
            await env.MY_BUCKET.delete(item.path);
          } else if (item.type === 'folder') {
            const folderName = item.path.split('/').filter(Boolean).pop() + '/';
            const newFolderPrefix = targetPrefix + folderName;
            let list = await env.MY_BUCKET.list({ prefix: item.path });
            while (true) {
              for (const o of list.objects) {
                const remainder = o.key.slice(item.path.length);
                const newKey = newFolderPrefix + remainder;
                const obj = await env.MY_BUCKET.get(o.key);
                if (obj) {
                  await env.MY_BUCKET.put(newKey, obj.body, { httpMetadata: obj.httpMetadata });
                  await env.MY_BUCKET.delete(o.key);
                }
              }
              if (list.truncated) list = await env.MY_BUCKET.list({ prefix: item.path, cursor: list.cursor });
              else break;
            }
          }
        }
        invalidateIndex(env.MY_BUCKET);
        return Response.json({ success: true }, { headers: corsHeaders });
      } catch (err) {
        return Response.json({ error: err.message }, { status: 500, headers: corsHeaders });
      }
    }

    // ---------- 存储容量统计（供主 Worker 聚合显示：每个桶 10G 可用） ----------
    if (path === '/api/storage-usage') {
      if (!checkAuth(request)) return new Response('Unauthorized', { status: 401, headers: corsHeaders });
      try {
        const entries = await getSearchIndex(env.MY_BUCKET);
        let used = 0, files = 0;
        for (const entry of entries) {
          if (entry.type !== 'file') continue;
          // 排除内部隐藏文件（如 .r2index.json）
          if (entry.key.split('/').some(p => p.startsWith('.'))) continue;
          used += entry.size;
          files++;
        }
        return Response.json({ used, files }, { headers: corsHeaders });
      } catch (err) {
        return Response.json({ error: err.message }, { status: 500, headers: corsHeaders });
      }
    }

    return new Response('Not found', { status: 404, headers: corsHeaders });
  }
};