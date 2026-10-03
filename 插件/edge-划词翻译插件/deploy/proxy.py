#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Google 翻译代理 —— 仅供「划词翻译」浏览器插件使用。

- 只监听 127.0.0.1:8099，公网访问必须经 nginx（https://<你的域名>/translate）
- 必须带 token，否则 401
- 转发到 translate.googleapis.com 的 /translate_a/single（POST 方式；该 IP 上 GET 会被 429）
- 带 LRU 缓存与按 IP 的分钟级限流，降低被 Google 限流的概率
"""
import json
import os
import time
import threading
import urllib.parse
import urllib.request
from collections import OrderedDict
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

PORT = 8099
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
TOKEN_FILE = os.path.join(BASE_DIR, "token.txt")
GOOGLE_URL = "https://translate.googleapis.com/translate_a/single"
MAX_CHARS = 5000
UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36")

_token = ""
try:
    with open(TOKEN_FILE, encoding="utf-8") as f:
        _token = f.read().strip()
except OSError:
    pass

_lock = threading.Lock()
_cache = OrderedDict()          # LRU: (q, sl, tl) -> (translation, detected)
CACHE_MAX = 800
_rate = {}                      # (ip, minute) -> count
RATE_PER_MIN = 120


def log(msg):
    print("[%s] %s" % (time.strftime("%Y-%m-%d %H:%M:%S"), msg), flush=True)


def rate_ok(ip):
    minute = int(time.time() // 60)
    with _lock:
        if len(_rate) > 5000:
            old = minute - 2
            for k in [k for k in _rate if k[1] < old]:
                _rate.pop(k, None)
        n = _rate.get((ip, minute), 0)
        if n >= RATE_PER_MIN:
            return False
        _rate[(ip, minute)] = n + 1
    return True


def cache_get(key):
    with _lock:
        if key in _cache:
            _cache.move_to_end(key)
            return _cache[key]
    return None


def cache_put(key, val):
    with _lock:
        _cache[key] = val
        _cache.move_to_end(key)
        while len(_cache) > CACHE_MAX:
            _cache.popitem(last=False)


def call_google(q, sl, tl):
    body = urllib.parse.urlencode(
        {"client": "gtx", "sl": sl, "tl": tl, "dt": "t", "q": q}
    ).encode("utf-8")
    req = urllib.request.Request(
        GOOGLE_URL,
        data=body,
        headers={
            "User-Agent": UA,
            "Content-Type": "application/x-www-form-urlencoded",
            "Accept": "application/json,text/plain,*/*",
        },
        method="POST",
    )
    last = None
    for attempt in range(2):  # 失败重试一次
        try:
            with urllib.request.urlopen(req, timeout=12) as resp:
                raw = resp.read().decode("utf-8", "replace")
            data = json.loads(raw)
            segs = [s for s in (data[0] or [])
                    if isinstance(s, list) and s and isinstance(s[0], str)]
            if not segs:
                raise ValueError("Google 返回格式异常")
            return "".join(s[0] for s in segs), (data[2] or "" if len(data) > 2 else "")
        except Exception as e:  # noqa: BLE001
            last = e
            time.sleep(0.4)
    raise last


class Handler(BaseHTTPRequestHandler):
    server_version = "gtranslate/1.0"

    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")

    def _json(self, code, obj):
        raw = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(raw)))
        self._cors()
        self.end_headers()
        self.wfile.write(raw)

    def do_OPTIONS(self):  # noqa: N802
        self.send_response(204)
        self._cors()
        self.send_header("Content-Length", "0")
        self.end_headers()

    def do_GET(self):  # noqa: N802
        if self.path.rstrip("/") == "/healthz":
            self._json(200, {"ok": True, "service": "gtranslate"})
        else:
            self._json(404, {"ok": False, "error": "not found"})

    def do_POST(self):  # noqa: N802
        if self.path.rstrip("/") != "/translate":
            self._json(404, {"ok": False, "error": "not found"})
            return

        ip = self.headers.get("X-Real-IP") or self.client_address[0]
        if not rate_ok(ip):
            log("429 限流 %s" % ip)
            self._json(429, {"ok": False, "error": "请求过于频繁"})
            return

        try:
            length = int(self.headers.get("Content-Length") or 0)
            payload = json.loads(self.rfile.read(length).decode("utf-8") or "{}")
        except Exception as e:  # noqa: BLE001
            self._json(400, {"ok": False, "error": "请求体解析失败：%s" % e})
            return

        token = str(payload.get("token") or "")
        if not _token or token != _token:
            log("401 token 不符 from %s" % ip)
            self._json(401, {"ok": False, "error": "token 无效"})
            return

        q = str(payload.get("q") or "").strip()
        sl = str(payload.get("sl") or "auto")
        tl = str(payload.get("tl") or "zh-CN")
        if not q:
            self._json(400, {"ok": False, "error": "q 为空"})
            return
        if len(q) > MAX_CHARS:
            self._json(413, {"ok": False, "error": "文本过长（上限 %d 字符）" % MAX_CHARS})
            return

        key = (q, sl, tl)
        hit = cache_get(key)
        if hit:
            self._json(200, {"ok": True, "translation": hit[0], "detected": hit[1], "cached": True})
            return

        t0 = time.time()
        try:
            translation, detected = call_google(q, sl, tl)
        except Exception as e:  # noqa: BLE001
            log("翻译失败 %s：%s" % (type(e).__name__, e))
            self._json(502, {"ok": False, "error": "上游失败：%s" % e})
            return
        cache_put(key, (translation, detected))
        log("%s %s→%s %d字 %.2fs" % (ip, sl, tl, len(q), time.time() - t0))
        self._json(200, {"ok": True, "translation": translation, "detected": detected})

    def log_message(self, fmt, *args):  # 静音默认访问日志，避免刷屏
        pass


if __name__ == "__main__":
    if not _token:
        log("警告：未找到 token.txt，所有请求都会被拒绝")
    log("启动 gtranslate proxy 127.0.0.1:%d" % PORT)
    ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
