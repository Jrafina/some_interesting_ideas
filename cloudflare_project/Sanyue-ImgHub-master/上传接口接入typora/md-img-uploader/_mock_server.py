#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""本地 mock 图床：验证 upload.py 的请求构造与响应解析，不需要真图床。"""
import json
import sys
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer

SEEN = {}


class H(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def do_POST(self):
        n = int(self.headers.get("Content-Length") or 0)
        body = self.rfile.read(n)
        SEEN["path"] = self.path
        SEEN["ctype"] = self.headers.get("Content-Type", "")
        SEEN["auth"] = self.headers.get("Authorization", "")
        SEEN["len"] = n
        SEEN["has_file_field"] = b'name="file"' in body
        SEEN["body_head"] = body[:200].decode("latin1")
        # 模拟「没设默认URL前缀，只返回 src」的老配置
        payload = [{"src": "/file/mock123_probe.png"}]
        data = json.dumps(payload).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        data = json.dumps(SEEN, ensure_ascii=False, indent=2).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8971
    srv = HTTPServer(("127.0.0.1", port), H)
    print("mock on %d" % port, flush=True)
    srv.serve_forever()
