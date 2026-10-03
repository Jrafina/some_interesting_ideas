#!/usr/bin/env python3
"""真机探针：池子里已有的 file_id，到底能被当成哪种类型发送？

为什么需要它：/ls 的缩略图相册要拿池子里**已入库**的 file_id 当 photo/video/document 发。
Bot API 对 file_id 的类型有校验（不匹配就整组 400），而池子里的文件大多是网页上传
（走 sendDocument）进来的，所以"哪种类型能发"必须实测。

2026-09-20 在真机上的实测结论（就是这样定下 /ls 的分组回退策略的）：

    同一个 file_id，分别按三种类型单发：
      视频型（消息是 video）  sendPhoto   ✗ can't use file of type Video as Photo
                              sendVideo   ✓        sendDocument ✓
      文档型（消息是 document）sendPhoto   ✗ can't use file of type Document as Photo
                              sendVideo   ✓（能过，但会当成"视频"渲染，别用）
                              sendDocument ✓
    相册（sendMediaGroup）：
      纯 video ✗2 项           ✓
      纯 document ×2           ✓
      photo + document 混着    ✗ MEDIA_INVALID / can't use file of type Document as Photo
      → 结论：一个相册里 document 不能与 photo/video 混，只能同族。
    缩略图本身：每个原消息都带 thumbnail（几百 B ~ 13KB），但
      sendPhoto(thumbnail 的 file_id) ✗ can't use file of type Thumbnail as Photo
      → 缩略图拿不出来单独发；/ls 只能复用原文件的 file_id 重新挂一条消息。

只读索引，只在 Telegram 侧发临时探针消息（静音），跑完全部删掉。
服务器是 Python 3.10：f-string 里不要跨行写表达式（会 SyntaxError）。

    /opt/tgpool/venv/bin/python probe_file_id_type.py            # 默认读 /opt/tgpool/tgpool.env
    TG_ENV=/别的/路径 TG_LIMIT=4 /opt/tgpool/venv/bin/python probe_file_id_type.py
"""
import json
import os
import sqlite3
import sys

import httpx

ENV_PATH = os.environ.get("TG_ENV", "/opt/tgpool/tgpool.env")
LIMIT = int(os.environ.get("TG_LIMIT", "3"))


def load_env(path):
    out = {}
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            out[k.strip()] = v.strip().strip('"').strip("'")
    return out


E = load_env(ENV_PATH)
TOKEN = E.get("TG_BOT_TOKEN", "")
CHAT = E.get("TG_CHAT_ID", "")
DB = E.get("TG_DB_PATH", "/opt/tgpool/index.db")
API = f"{(E.get('TG_API_BASE') or 'http://127.0.0.1:8081').rstrip('/')}/bot{TOKEN}"

IMG_EXT = (".jpg", ".jpeg", ".png", ".webp", ".gif", ".bmp", ".heic")
VID_EXT = (".mp4", ".mov", ".mkv", ".webm", ".avi", ".m4v", ".3gp")

c = httpx.Client(timeout=120.0)


def call(method, **params):
    data = {}
    for k, v in params.items():
        if v is None:
            continue
        data[k] = json.dumps(v, ensure_ascii=False) if isinstance(v, (dict, list)) else str(v)
    r = c.post(f"{API}/{method}", data=data)
    try:
        return r.json()
    except Exception:                                     # noqa: BLE001
        return {"ok": False, "description": f"HTTP {r.status_code}"}


CREATED = []


def send(method, **params):
    """发一条探针消息（静音），记下 message_id 以便最后删干净。"""
    r = call(method, **params)
    if r.get("ok"):
        for m in (r["result"] if isinstance(r["result"], list) else [r["result"]]):
            if isinstance(m, dict) and m.get("message_id"):
                CREATED.append(m["message_id"])
    return r


def verdict(r):
    return "OK" if r.get("ok") else f"FAIL: {str(r.get('description'))[:90]}"


def kind_of(name, mime):
    n, m = (name or "").lower(), (mime or "").lower()
    if m.startswith("image/") or n.endswith(IMG_EXT):
        return "image"
    if m.startswith("video/") or n.endswith(VID_EXT):
        return "video"
    return None


conn = sqlite3.connect(f"file:{DB}?mode=ro", uri=True)
conn.row_factory = sqlite3.Row
rows = [dict(r) for r in conn.execute(
    "SELECT id,name,mime,file_id,message_id,chat_id,size FROM files ORDER BY id DESC")]
conn.close()

picks, seen = [], {"image": 0, "video": 0}
for r in rows:
    k = kind_of(r["name"], r["mime"])
    if k and seen[k] < LIMIT and r["file_id"] and r["message_id"]:
        seen[k] += 1
        picks.append((k, r))
print(f"索引里 {len(rows)} 个文件，挑出图片 {seen['image']} / 视频 {seen['video']} 个做探针\n")

print("== 单发：同一个 file_id 分别按 photo / video / document 发 ==")
for k, r in picks:
    print(f"#{r['id']} {r['name']}  ({k}, {r['size']} B, mime={r['mime']})")
    for t in ("photo", "video", "document"):
        method = {"photo": "sendPhoto", "video": "sendVideo", "document": "sendDocument"}[t]
        res = send(method, chat_id=CHAT, caption=f"PROBE {t} #{r['id']}",
                   disable_notification=True, **{t: r["file_id"]})
        print(f"    send{t:<9} {verdict(res)}")

print("\n== 原消息里有没有 thumbnail（决定 document 相册看不看得见预览）==")
for k, r in picks:
    res = call("forwardMessage", chat_id=CHAT, from_chat_id=r["chat_id"],
               message_id=r["message_id"], disable_notification=True)
    if not res.get("ok"):
        print(f"#{r['id']} forwardMessage 失败：{res.get('description')}")
        continue
    msg = res["result"]
    CREATED.append(msg.get("message_id"))
    key = next((x for x in ("document", "video", "photo", "animation", "audio",
                            "video_note") if x in msg), None)
    obj = msg.get(key) if key else {}
    if isinstance(obj, list):
        obj = obj[-1] if obj else {}
    th = (obj or {}).get("thumbnail") or (obj or {}).get("thumb")
    print(f"#{r['id']} 消息类型={key}  thumbnail={'有 ' + str(th.get('file_id'))[:40] if th else '无'}"
          f"  size={th.get('file_size') if th else '-'}")

imgs = [r["file_id"] for k, r in picks if k == "image"]
vids = [r["file_id"] for k, r in picks if k == "video"]
if len(imgs) + len(vids) >= 2:
    print("\n== 相册：所有项按真身类型（图片 photo / 视频 video）==")
    media = ([{"type": "photo", "media": f, "caption": "PROBE album photo"} for f in imgs]
             + [{"type": "video", "media": f, "caption": "PROBE album video"} for f in vids])
    res = send("sendMediaGroup", chat_id=CHAT, media=media, disable_notification=True)
    print("   ", verdict(res))

    print("\n== 相册：所有项退回 document ==")
    media2 = [{"type": "document", "media": f, "caption": "PROBE album doc"}
              for f in imgs + vids]
    res2 = send("sendMediaGroup", chat_id=CHAT, media=media2, disable_notification=True)
    print("   ", verdict(res2))
else:
    print("\n（媒体样本不足 2 个，跳过相册测试）")

for mid in CREATED:
    call("deleteMessage", chat_id=CHAT, message_id=mid)
print(f"\n已清理 {len(CREATED)} 条探针消息")
sys.exit(0)
