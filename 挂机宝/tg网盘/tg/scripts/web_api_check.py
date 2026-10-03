#!/usr/bin/env python3
"""真机验证网页端改名接口（PATCH /api/files/{id}）。

不新增/删除任何文件：改名后一律改回原名。
用法：cd /opt/tgpool && set -a && . ./tgpool.env && set +a && python3 _webtest.py
"""
import json
import os
import base64
import urllib.request
from collections import defaultdict

BASE = "http://127.0.0.1:8080"
AUTH = base64.b64encode(
    f"{os.environ.get('TG_AUTH_USER')}:{os.environ.get('TG_AUTH_PASS')}".encode()
).decode()


def req(method, path, body=None):
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(BASE + path, data=data, method=method)
    r.add_header("Authorization", "Basic " + AUTH)
    if data:
        r.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(r, timeout=20) as resp:
            return resp.status, json.loads(resp.read().decode() or "{}")
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read().decode() or "{}")
        except Exception:
            return e.code, {}


ok = bad = 0


def chk(label, cond, extra=""):
    global ok, bad
    if cond:
        ok += 1
        print(f"  [PASS] {label}")
    else:
        bad += 1
        print(f"  [FAIL] {label} {extra}")


st, data = req("GET", "/api/list")
files = data.get("files") or []
print(f"根目录文件数 {len(files)}")
if not files:
    raise SystemExit("根目录没有文件，无法测")

f = files[0]
fid, old = f["id"], f["name"]
print(f"目标文件 #{fid}  原名: {old}")

TMP = "_webtest_改名验证.tmp"
try:
    st, j = req("PATCH", f"/api/files/{fid}", {"name": TMP})
    chk("改名返回 200 且回新名", st == 200 and j.get("name") == TMP, (st, j))
    st, d = req("GET", "/api/list")
    now = [x for x in (d.get("files") or []) if x["id"] == fid]
    chk("列表里名字已变", now and now[0]["name"] == TMP, now)

    st, j = req("PATCH", f"/api/files/{fid}", {"name": "   "})
    chk("空名被拒 400", st == 400, (st, j))

    st, j = req("PATCH", f"/api/files/{fid}", {"name": "a/b.tmp"})
    chk("名字里的 / 被替换成 _", st == 200 and j.get("name") == "a_b.tmp", (st, j))

    # 同层重名：找同一目录下有两个文件的情况
    by_dir = defaultdict(list)
    for x in (d.get("files") or []):
        by_dir[x.get("folder_id")].append(x)
    dup = next(((v, k) for k, v in by_dir.items() if len(v) >= 2 and v[0]["id"] == fid), None)
    if dup:
        other = [x for x in dup[0] if x["id"] != fid][0]
        st, j = req("PATCH", f"/api/files/{fid}", {"name": other["name"]})
        chk("同层重名被拒 409", st == 409, (st, j))
    else:
        print("  [SKIP] 该文件所在目录没有第二个文件，跳过 409 用例")

    st, j = req("PATCH", "/api/files/999999", {"name": "x.tmp"})
    chk("改不存在的文件 404", st == 404, (st, j))
finally:
    st, j = req("PATCH", f"/api/files/{fid}", {"name": old})
    chk("已改回原名", st == 200 and j.get("name") == old, (st, j))

print(f"\n真机结果：PASS {ok} / FAIL {bad}")
