#!/usr/bin/env python3
"""离线验证 /search 相关逻辑：建一个临时索引，把 _tg 打桩，不联网、不需要有效 token。

    /opt/tgpool/venv/bin/python test_search_logic.py
"""
import os
import sys
import json
import asyncio
import tempfile
from pathlib import Path

TMP = Path(tempfile.mkdtemp(prefix="tgpool-test-"))
os.environ.update({
    "TG_BOT_TOKEN": "1:TESTTOKEN",
    "TG_CHAT_ID": "8575978784",
    "TG_DB_PATH": str(TMP / "index.db"),
    "TG_JOURNAL": str(TMP / "journal" / "index.jsonl"),
    "TG_TMP_DIR": str(TMP / "tmp"),
    "TG_BOT_OFFSET": str(TMP / "tg_offset.json"),
    "TG_BOT_POLL": "0",
    "TG_BACKUP_DIR": str(TMP / "backup"),
    "TG_AUTH_PASS": "test",
})
sys.path.insert(0, os.environ.get("APP_DIR", "/opt/tgpool/app"))
import app as A  # noqa: E402

PASS = FAIL = 0


def check(label, cond, extra=""):
    global PASS, FAIL
    if cond:
        PASS += 1
        print(f"  [PASS] {label}")
    else:
        FAIL += 1
        print(f"  [FAIL] {label} {extra}")


SENT = []


async def fake_tg(method, **params):
    SENT.append((method, params))
    return {"ok": True, "result": {"message_id": 1}}


A._tg = fake_tg

print("== 准备数据 ==")
A.init_db()
with A.db() as c:
    c.execute("INSERT INTO folders(name,parent_id,created_at) VALUES(?,?,?)", ("工作", None, 1))
    wid = c.execute("SELECT id FROM folders WHERE name='工作'").fetchone()["id"]
    c.execute("INSERT INTO folders(name,parent_id,created_at) VALUES(?,?,?)", ("2026", wid, 1))
    y26 = c.execute("SELECT id FROM folders WHERE name='2026'").fetchone()["id"]

    def add(name, size, fid):
        c.execute(
            "INSERT INTO files(name,size,mime,file_id,message_id,chat_id,folder_id,created_at)"
            " VALUES(?,?,?,?,?,?,?,?)",
            (name, size, "application/pdf", "FID-" + name, 1000 + size, "8575978784", fid, 1),
        )

    add("财务报表.pdf", 2200000, y26)
    add("预算表.xlsx", 550000, y26)
    add("holiday-photo.jpg", 900000, None)
    add("报表模板.docx", 12000, None)
    # 再塞 12 个，验证分页（共 14 条含"报"或不含）
    for i in range(12):
        add(f"归档报表-{i:02d}.txt", 1000 + i, None)

    # /ls 缩略图用例：图片+视频目录、只有一张图的目录、超过 10 项的目录
    def add_dir(name):
        c.execute("INSERT INTO folders(name,parent_id,created_at) VALUES(?,?,?)",
                  (name, None, 1))
        return c.execute("SELECT id FROM folders WHERE name=?", (name,)).fetchone()["id"]

    def add_media(folder_id, name, size, mime, file_id):
        c.execute(
            "INSERT INTO files(name,size,mime,file_id,message_id,chat_id,folder_id,created_at)"
            " VALUES(?,?,?,?,?,?,?,?)",
            (name, size, mime, file_id, 5000 + size, "8575978784", folder_id, 1),
        )

    mix = add_dir("混合")
    add_media(mix, "mix-1.png", 111, "image/png", "FID-mix-1")
    add_media(mix, "mix-2.mp4", 222, "video/mp4", "FID-mix-2")
    add_media(mix, "mix-3.pdf", 333, "application/pdf", "FID-mix-3")   # 不该进相册
    solo = add_dir("单图")
    add_media(solo, "solo.JPG", 444, "image/jpeg", "FID-solo")
    lib = add_dir("图库")
    for i in range(12):
        add_media(lib, f"pic-{i:02d}.jpg", 1000 + i, "image/jpeg", f"FID-pic-{i:02d}")
    # photo-<file_unique[:12]>.jpg 是池子自己给"直接发来的照片"生成的命名（Photo 型），
    # 其余图片都是网页上传进来的 Document 型 —— 用来验证混型目录的分组回退
    alb = add_dir("相册")
    add_media(alb, "photo-Ab3dEf9hJk1l.jpg", 1200, "image/jpeg", "FID-P2")
    add_media(alb, "photo-Zx8cVb2nMq4p.jpg", 1300, "image/jpeg", "FID-P3")
    both = add_dir("混型")
    add_media(both, "photo-Ab3dEf9hJk1l.jpg", 1400, "image/jpeg", "FID-P1")
    add_media(both, "web-shot.jpg", 1500, "image/jpeg", "FID-D1")
    # 12 个视频：验证视频族超过 10 个时会分成多条相册
    vlib = add_dir("视频库")
    for i in range(12):
        add_media(vlib, f"clip-{i:02d}.mp4", 2000 + i, "video/mp4", f"FID-clip-{i:02d}")
    c.commit()
    total = c.execute("SELECT COUNT(*) c FROM files").fetchone()["c"]
print(f"  文件总数 {total}，文件夹 2")

print("== _resolve_path ==")
with A.db() as c:
    fid, err = A._resolve_path(c, "/工作/2026")
    check("解析 /工作/2026 成功", fid is not None and err is None, (fid, err))
    fid2, err2 = A._resolve_path(c, "/工作")
    check("解析 /工作 与 /工作/2026 不同", fid2 != fid, (fid2, fid))
    fid3, err3 = A._resolve_path(c, "")
    check("空路径 -> 根目录 None", fid3 is None and err3 is None, (fid3, err3))
    fid4, err4 = A._resolve_path(c, "/不存在的目录")
    check("不存在路径返回错误信息", fid4 is None and err4, (fid4, err4))

print("== _collect_hits ==")
with A.db() as c:
    hits = A._collect_hits(c, "报表")
    names = [h["name"] for h in hits]
    check("按文件名命中 14 条", len(hits) == 14, len(hits))
    check("含 财务报表.pdf", "财务报表.pdf" in names)
    check("含 归档报表-11.txt", "归档报表-11.txt" in names)
    check("路径带完整目录 /工作/2026",
          any(h["path"] == "/工作/2026" for h in hits),
          [h["path"] for h in hits][:3])

    hits_dir = A._collect_hits(c, "2026")
    check("目录名 '2026' 命中其下 2 个文件", len(hits_dir) == 2, len(hits_dir))
    check("目录名命中项路径正确",
          all(h["path"] == "/工作/2026" for h in hits_dir),
          [h["path"] for h in hits_dir])

    hits_none = A._collect_hits(c, "zzz-不存在-zzz")
    check("无匹配返回空列表", hits_none == [], hits_none)

print("== 搜索：模糊匹配扩展 ==")
with A.db() as c:
    # 追加通配符字面量测试样本
    for nm, sz in (("a_b.txt", 10), ("axb.txt", 11), ("a%b.txt", 12), ("aXb.txt", 13)):
        c.execute(
            "INSERT INTO files(name,size,mime,file_id,message_id,chat_id,folder_id,created_at)"
            " VALUES(?,?,?,?,?,?,?,?)",
            (nm, sz, "application/pdf", "FID-" + nm, 2000 + sz, "8575978784", None, 1),
        )
    c.commit()

    hits = A._collect_hits(c, "26")
    check("路径片段 '26' 命中 /工作/2026 下 2 个文件", len(hits) == 2, len(hits))
    check("路径命中项路径正确",
          all(h["path"] == "/工作/2026" for h in hits), [h["path"] for h in hits])

    hits_w = A._collect_hits(c, "工作")
    check("路径 '工作' 命中其子树 2 个文件", len(hits_w) == 2, len(hits_w))

    names_and = [h["name"] for h in A._collect_hits(c, "报表 11")]
    check("多关键词 AND 命中 归档报表-11.txt", names_and == ["归档报表-11.txt"], names_and)

    names_mix = [h["name"] for h in A._collect_hits(c, "2026 财务")]
    check("关键词分落 文件名/路径 也命中", names_mix == ["财务报表.pdf"], names_mix)

    check("'_' 按字面量匹配", [h["name"] for h in A._collect_hits(c, "a_b")] == ["a_b.txt"],
          [h["name"] for h in A._collect_hits(c, "a_b")])
    check("'%' 按字面量匹配", [h["name"] for h in A._collect_hits(c, "a%b")] == ["a%b.txt"],
          [h["name"] for h in A._collect_hits(c, "a%b")])

    check("英文大小写不敏感",
          [h["name"] for h in A._collect_hits(c, "HOLIDAY")] == ["holiday-photo.jpg"],
          [h["name"] for h in A._collect_hits(c, "HOLIDAY")])

    items, total = A.search_files(c, "报表", limit=500)
    check("search_files 返回命中总数", total == 14, total)
    check("score 值域 0-3", all(it["score"] in (0, 1, 2, 3) for it in items))
    check("按相关性升序排列",
          [it["score"] for it in items] == sorted(it["score"] for it in items),
          [it["score"] for it in items])
    check("网页契约：path 为 [{id,name}] 列表",
          all(isinstance(it["path"], list) for it in items))

    empty, empty_total = A.search_files(c, "   ")
    check("空查询返回空", empty == [] and empty_total == 0, (empty, empty_total))

    items_cut, total_cut = A.search_files(c, "报表", limit=5)
    check("limit 截断且 total 不变", len(items_cut) == 5 and total_cut == 14,
          (len(items_cut), total_cut))

print("== _human ==")
check("0 -> 0 B", A._human(0) == "0 B", A._human(0))
check("999 -> 999 B", A._human(999) == "999 B", A._human(999))
check("1024 -> 1.0 KB", A._human(1024) == "1.0 KB", A._human(1024))
check("2200000 -> 2.1 MB", A._human(2200000) == "2.1 MB", A._human(2200000))
check("5GiB -> 5.0 GB", A._human(5 * 1024 ** 3) == "5.0 GB", A._human(5 * 1024 ** 3))

print("== _reply_search 排版与键盘 ==")
SENT.clear()
asyncio.run(A._reply_search(8575978784, "报表", page=0))
methods = [m for m, _ in SENT]
check("发出一条 sendMessage", methods == ["sendMessage"], methods)
_, p = SENT[0]
text, kb = p.get("text", ""), (p.get("reply_markup") or {}).get("inline_keyboard", [])
check("标题含命中数与页码", "命中 14 个文件" in text and "第 1/2 页" in text, text.splitlines()[0])
check("正文列出 8 条（PAGE_SIZE）", text.count("\n") >= 16, text.count("\n"))
num_btns = [b for row in kb for b in row if b["callback_data"].startswith("g:")]
check("8 个取文件按钮", len(num_btns) == 8, len(num_btns))
nav = [b for row in kb for b in row if b["callback_data"].startswith("p:")]
check("有下一页按钮", any("下一页" in b["text"] for b in nav), nav)
check("第一页无上一页", not any("上一页" in b["text"] for b in nav), nav)
check("callback_data 均 < 64 字节",
      all(len(b["callback_data"]) < 64 for row in kb for b in row),
      [b["callback_data"] for row in kb for b in row])

token = nav[0]["callback_data"].split(":")[1]
SENT.clear()
asyncio.run(A._reply_search(8575978784, "报表", page=1, token=token,
                            edit_msg=(8575978784, 55)))
check("翻页用 editMessageText 原地改写",
      [m for m, _ in SENT] == ["editMessageText"], [m for m, _ in SENT])
_, p2 = SENT[0]
t2 = p2.get("text", "")
check("第 2 页标题正确", "第 2/2 页" in t2, t2.splitlines()[0])
check("第 2 页剩 6 条", t2.count(" · #") == 6, t2.count(" · #"))
kb2 = (p2.get("reply_markup") or {}).get("inline_keyboard", [])
check("第 2 页有上一页、无下一页",
      any("上一页" in b["text"] for row in kb2 for b in row)
      and not any("下一页" in b["text"] for row in kb2 for b in row))

print("== 无结果时的提示 ==")
SENT.clear()
asyncio.run(A._reply_search(8575978784, "绝对没有这个关键词"))
_, p3 = SENT[0]
check("提示未命中且无键盘", "没有命中任何文件" in p3.get("text", "")
      and p3.get("reply_markup") is None, p3.get("reply_markup"))

print("== _reply_ls ==")
SENT.clear()
asyncio.run(A._reply_ls(8575978784, "/"))
_, p4 = SENT[0]
t4 = p4.get("text", "")
check("根目录列出 工作/", "工作/" in t4, t4)
check("根目录列出 18 个文件", "文件（18）" in t4, t4)
SENT.clear()
asyncio.run(A._reply_ls(8575978784, "/工作/2026"))
t5 = SENT[0][1].get("text", "")
check("子目录路径显示正确", "目录 /工作/2026" in t5, t5.splitlines()[0])
check("子目录列出 2 个文件", "文件（2）" in t5, t5)
rows5 = [l for l in t5.splitlines() if l.split(".", 1)[0].isdigit()]
check("文件行带行首序号（1. / 2.）",
      len(rows5) == 2 and rows5[0].startswith("1. ") and rows5[1].startswith("2. "), rows5)
check("序号与行尾 #编号并存（序号是给人数的，不拿来 /get）",
      all("· #" in l for l in rows5), rows5)
check("底部提示写明用 #编号取文件", "/get #编号" in t5, t5.splitlines()[-2:])
# 子目录行不加序号：进目录用 /ls 完整路径，序号在那没有意义
sub_lines = [l for l in t4.splitlines() if l.startswith("  ")]
check("根目录的子目录行不加序号",
      bool(sub_lines) and all(not l.split(".", 1)[0].strip().isdigit()
                              for l in sub_lines), sub_lines[:3])

SENT.clear()
asyncio.run(A._reply_ls(8575978784, "/图库"))
t_lib0 = SENT[0][1].get("text", "")
nums = [l.split(".", 1)[0] for l in t_lib0.splitlines() if l.split(".", 1)[0].isdigit()]
check("12 个文件序号从 1 连续编到 12",
      nums == [str(i) for i in range(1, 13)], nums)

SENT.clear()
asyncio.run(A._reply_ls(8575978784, "/nope"))
check("坏路径给出错误提示", "路径不存在" in SENT[0][1].get("text", ""))

# 把「文件」当目录传给 /ls：以前回「路径不存在」，让人以为文件丢了（2026-09-20 用户实际踩到）
SENT.clear()
asyncio.run(A._reply_ls(8575978784, "/工作/2026/财务报表.pdf"))
t_f = SENT[0][1].get("text", "")
check("/ls 打到文件路径时不再说「路径不存在」", "路径不存在" not in t_f, t_f)
check("明确说这是文件、/ls 只能列目录", "是文件" in t_f and "只能列目录" in t_f, t_f)
check("顺手给出 /get 该怎么写", "/get /工作/2026/财务报表.pdf" in t_f, t_f)
check("也提示父目录怎么列", "/ls /工作/2026" in t_f, t_f)
check("只发一条消息（不再跟相册）", [m for m, _ in SENT] == ["sendMessage"],
      [m for m, _ in SENT])

SENT.clear()
asyncio.run(A._reply_ls(8575978784, "/工作/2026/查无此文件.bin"))
check("文件确实不存在时仍回「路径不存在」",
      "路径不存在" in SENT[0][1].get("text", ""), SENT[0][1].get("text", ""))

print("== /ls 缩略图（视频一族、图片一族，各一条；超 10 个分多条）==")
check("_media_kind：按 mime 判图片", A._media_kind("x.bin", "image/png") == "image")
check("_media_kind：按 mime 判视频", A._media_kind("x.bin", "video/mp4") == "video")
check("_media_kind：mime 缺失时看扩展名",
      A._media_kind("x.JPG", None) == "image" and A._media_kind("y.MKV", "") == "video")
check("_media_kind：非媒体返回 None",
      A._media_kind("x.pdf", "application/pdf") is None
      and A._media_kind("noext", None) is None)
check("_album_chunks：<=10 一片",
      [len(x) for x in A._album_chunks(list(range(12)))] == [10, 2],
      [len(x) for x in A._album_chunks(list(range(12)))])

# 目录里只有 1 个媒体文件：相册要 2 项起，退回单张媒体消息
SENT.clear()
asyncio.run(A._reply_ls(8575978784, "/单图"))
check("单图目录：文字 + 单张 sendPhoto",
      [m for m, _ in SENT] == ["sendMessage", "sendPhoto"], [m for m, _ in SENT])
check("单张用原 file_id，说明里带文件名与编号",
      SENT[1][1].get("photo") == "FID-solo"
      and "solo.JPG" in SENT[1][1].get("caption", "")
      and "· #" in SENT[1][1].get("caption", ""), SENT[1][1])

# 图片 + 视频：**分两条**（视频一条、图片一条），不再混装
SENT.clear()
asyncio.run(A._reply_ls(8575978784, "/混合"))
check("混合目录：文字 + 视频一条 + 图片一条（各 1 项就单发）",
      [m for m, _ in SENT] == ["sendMessage", "sendVideo", "sendPhoto"],
      [m for m, _ in SENT])
check("视频那条发的是视频项、用的是池子里的 file_id",
      SENT[1][1].get("video") == "FID-mix-2" and "mix-2.mp4" in SENT[1][1].get("caption", ""),
      SENT[1][1])
check("图片那条发的是图片项", SENT[2][1].get("photo") == "FID-mix-1", SENT[2][1])
check("pdf 不进缩略图",
      all("pdf" not in str(p.get("caption", "")) for _, p in SENT[1:]), SENT)

# 12 张图 > 10：自动分 2 条相册（10 + 2）
SENT.clear()
asyncio.run(A._reply_ls(8575978784, "/图库"))
check("图库（12 张图）：文字 + 两条相册",
      [m for m, _ in SENT] == ["sendMessage", "sendMediaGroup", "sendMediaGroup"],
      [m for m, _ in SENT])
libg1 = SENT[1][1].get("media") or []
libg2 = SENT[2][1].get("media") or []
check("第一条 10 项、第二条 2 项（Telegram 硬上限 10）",
      len(libg1) == 10 and len(libg2) == 2, (len(libg1), len(libg2)))
check("文字里说明缩略图分 2 条消息发",
      "缩略图分 2 条消息发" in SENT[0][1].get("text", ""),
      SENT[0][1].get("text", "").splitlines()[-5:])
check("全部 12 张都发到了（不再只发最新 10 个）",
      len(libg1) + len(libg2) == 12, (len(libg1), len(libg2)))
check("相册每项都带 file_id 与说明",
      all(i.get("media", "").startswith("FID-") and "#" in i.get("caption", "")
          for i in libg1 + libg2), (libg1[:1], libg2[:1]))
caps = " | ".join(i.get("caption", "") for i in libg1 + libg2)
check("相册说明里能看到文件名（便于对上 /get 编号）",
      "pic-00.jpg" in caps and "pic-11.jpg" in caps, caps[:120])

# 12 个视频 > 10：同样分 2 条
SENT.clear()
asyncio.run(A._reply_ls(8575978784, "/视频库"))
check("视频库（12 个视频）：文字 + 两条相册",
      [m for m, _ in SENT] == ["sendMessage", "sendMediaGroup", "sendMediaGroup"],
      [m for m, _ in SENT])
vg1 = SENT[1][1].get("media") or []
vg2 = SENT[2][1].get("media") or []
check("视频相册两片 10 + 2，且每项都按 video",
      [len(vg1), len(vg2)] == [10, 2]
      and all(i.get("type") == "video" for i in vg1 + vg2),
      ([len(vg1), len(vg2)], [i.get("type") for i in vg1 + vg2]))

# 没有图片/视频的目录：行为与改造前完全一致
SENT.clear()
asyncio.run(A._reply_ls(8575978784, "/工作/2026"))
check("无媒体目录只发一条文字",
      [m for m, _ in SENT] == ["sendMessage"], [m for m, _ in SENT])

# ---- 照真机规则打桩：file_id 有"底层类型"，相册里 document 不能与 photo/video 混 ----
# 2026-09-20 真机实测：
#   sendPhoto(document 型) -> "can't use file of type Document as Photo"
#   sendMediaGroup(视频型项按 document) -> MEDIA_INVALID
REAL_TYPE = {"FID-P1": "photo", "FID-P2": "photo", "FID-P3": "photo",
             "FID-mix-2": "video"}
REAL_TYPE.update({f"FID-clip-{i:02d}": "video" for i in range(12)})
REAL_DEFAULT = "document"          # 网页上传进来的都是 document 型


async def typed_tg(method, **params):
    SENT.append((method, params))
    if method == "sendMediaGroup":
        declared = [i["type"] for i in params["media"]]
        reals = [REAL_TYPE.get(i["media"], REAL_DEFAULT) for i in params["media"]]
        if len(set(reals)) > 1 and "document" in reals:
            return {"ok": False, "description": "Bad Request: MEDIA_INVALID"}
        if set(reals) != set(declared):
            return {"ok": False,
                    "description": "Bad Request: can't use file of type %s as %s"
                                   % (reals[0], declared[0])}
        return {"ok": True, "result": [{"message_id": 1} for _ in params["media"]]}
    if method in ("sendPhoto", "sendVideo", "sendDocument"):
        key = {"sendPhoto": "photo", "sendVideo": "video", "sendDocument": "document"}[method]
        real = REAL_TYPE.get(params.get(key), REAL_DEFAULT)
        if real != key:
            return {"ok": False,
                    "description": "Bad Request: can't use file of type %s as %s" % (real, key)}
        return {"ok": True, "result": {"message_id": 1}}
    return {"ok": True, "result": {"message_id": 1}}


A._tg = typed_tg

# 12 张图全是 document 型（网页上传）：先按 photo 试 → 整组被拒 → 退回 document
SENT.clear()
asyncio.run(A._reply_ls(8575978784, "/图库"))
check("document 型图库：每片都 photo 先试、被拒后退回 document",
      [m for m, _ in SENT] == ["sendMessage"] + ["sendMediaGroup"] * 4,
      [m for m, _ in SENT])
check("两次被拒后退回的那条全是 document",
      {i["type"] for i in SENT[-1][1]["media"]} == {"document"},
      [i["type"] for i in SENT[-1][1]["media"]])

# 12 个视频全是 video 型：一次就过，两片各一条
SENT.clear()
asyncio.run(A._reply_ls(8575978784, "/视频库"))
check("video 型视频库：两片各一条、一次就过",
      [m for m, _ in SENT] == ["sendMessage", "sendMediaGroup", "sendMediaGroup"],
      [m for m, _ in SENT])
check("视频片不需要回退，全是 video",
      all(i["type"] == "video" for _, p in SENT[1:] for i in p["media"]),
      [[i["type"] for i in p["media"]] for _, p in SENT[1:]])

SENT.clear()
asyncio.run(A._reply_ls(8575978784, "/相册"))
check("自己发来的照片（photo 型）：一次就过",
      [m for m, _ in SENT] == ["sendMessage", "sendMediaGroup"], [m for m, _ in SENT])
check("photo 型目录按 photo 发",
      {i["type"] for i in SENT[-1][1]["media"]} == {"photo"},
      [i["type"] for i in SENT[-1][1]["media"]])

# 混型图片（photo 型 + document 型）必须整条退回 document，而不是拆成多条
SENT.clear()
asyncio.run(A._reply_ls(8575978784, "/混型"))
check("混型图片：不拆条，整条退回 document（保住'所有图片一条'）",
      [m for m, _ in SENT] == ["sendMessage", "sendMediaGroup", "sendMediaGroup"],
      [m for m, _ in SENT])
check("退回后两条都含全部 2 张图",
      all(len(p["media"]) == 2 for _, p in SENT[1:]),
      [len(p["media"]) for _, p in SENT[1:]])

# 视频 + 图片：视频走 video 成功，图片退回 document，两条互不影响
SENT.clear()
asyncio.run(A._reply_ls(8575978784, "/混合"))
check("视频族按 video 发、图片族退回 document",
      [m for m, _ in SENT] == ["sendMessage", "sendVideo", "sendPhoto", "sendDocument"],
      [m for m, _ in SENT])
check("视频那条用的是真视频型 file_id",
      SENT[1][1].get("video") == "FID-mix-2", SENT[1][1])
check("图片那条退回后发的是 document 型的图片",
      SENT[-1][1].get("document") == "FID-mix-1", SENT[-1][1])

SENT.clear()
asyncio.run(A._reply_ls(8575978784, "/单图"))
check("document 型单图：sendPhoto 被拒后退回 sendDocument",
      [m for m, _ in SENT] == ["sendMessage", "sendPhoto", "sendDocument"],
      [m for m, _ in SENT])
A._tg = fake_tg


async def reject_groups(method, **params):
    """模拟 Telegram 以「类型不符」整组拒收相册（单发仍然能过）。"""
    SENT.append((method, params))
    if method == "sendMediaGroup":
        return {"ok": False,
                "description": "Bad Request: wrong file identifier/HTTP URL specified"}
    return {"ok": True, "result": {"message_id": 1}}


A._tg = reject_groups
SENT.clear()
asyncio.run(A._reply_ls(8575978784, "/图库"))
check("相册整组被拒：每片试完 photo/document 才放弃，文字照发",
      [m for m, _ in SENT] == ["sendMessage"] + ["sendMediaGroup"] * 4,
      [m for m, _ in SENT])

SENT.clear()
asyncio.run(A._reply_ls(8575978784, "/混合"))
check("相册拒收不影响单发（各 1 项，video / photo 各自一条就过）",
      [m for m, _ in SENT] == ["sendMessage", "sendVideo", "sendPhoto"],
      [m for m, _ in SENT])


async def reject_all_media(method, **params):
    """连 document 都发不出去（file_id 失效之类）——必须安静退化。"""
    SENT.append((method, params))
    if method in ("sendMediaGroup", "sendPhoto", "sendVideo", "sendDocument"):
        return {"ok": False, "description": "Bad Request: nope"}
    return {"ok": True, "result": {"message_id": 1}}


A._tg = reject_all_media
SENT.clear()
asyncio.run(A._reply_ls(8575978784, "/图库"))
check("全失败：只剩文字、不抛异常",
      [m for m, _ in SENT] == ["sendMessage"] + ["sendMediaGroup"] * 4,
      [m for m, _ in SENT])
SENT.clear()
asyncio.run(A._reply_ls(8575978784, "/单图"))
check("单张图失败：只发文字",
      [m for m, _ in SENT] == ["sendMessage", "sendPhoto", "sendDocument"],
      [m for m, _ in SENT])
SENT.clear()
asyncio.run(A._reply_ls(8575978784, "/视频库"))
check("视频全失败也不影响文字清单",
      SENT and SENT[0][0] == "sendMessage" and "目录 /视频库" in SENT[0][1].get("text", ""),
      [m for m, _ in SENT][:3])
A._tg = fake_tg

print("== _send_file 投递策略 ==")
SENT.clear()
ok = asyncio.run(A._send_file(8575978784, 1))
check("有 message_id 时走 copyMessage",
      [m for m, _ in SENT] == ["copyMessage"] and ok, [m for m, _ in SENT])
_, cp = SENT[0]
check("copyMessage 参数完整",
      cp.get("from_chat_id") == "8575978784" and cp.get("message_id"), cp)

SENT.clear()
A._tg = fake_tg
with A.db() as c:
    c.execute("UPDATE files SET message_id=NULL WHERE id=2")
    c.commit()
ok2 = asyncio.run(A._send_file(8575978784, 2))
check("无 message_id 时退回 sendDocument(file_id)",
      [m for m, _ in SENT] == ["sendDocument"] and ok2, [m for m, _ in SENT])

async def fail_copy_tg(method, **params):
    """只让 copyMessage 失败，验证回退到 sendDocument(file_id)。"""
    SENT.append((method, params))
    if method == "copyMessage":
        return {"ok": False, "description": "Bad Request: message to copy not found"}
    return {"ok": True, "result": {"message_id": 1}}


A._tg = fail_copy_tg
SENT.clear()
ok3 = asyncio.run(A._send_file(8575978784, 1))
check("copyMessage 失败自动回退 sendDocument",
      [m for m, _ in SENT] == ["copyMessage", "sendDocument"] and ok3,
      [m for m, _ in SENT])

SENT.clear()
A._tg = fake_tg
ok4 = asyncio.run(A._send_file(8575978784, 99999))
check("不存在的编号返回 False", ok4 is False)

print("== 鉴权 ==")
check("CHAT_ID 自身放行", A._allowed(8575978784, 8575978784))
check("陌生会话拒绝", not A._allowed(123456789, 987654321))
check("字符串形式 chat_id 放行", A._allowed("8575978784", 1))

print("== 命令分发（打桩 _tg）==")
SENT.clear()
asyncio.run(A._handle_message({"chat": {"id": 8575978784}, "from": {"id": 8575978784},
                               "text": "/search 报表"}))
check("/search 触发一次发送", len(SENT) == 1 and SENT[0][0] == "sendMessage", SENT)
SENT.clear()
asyncio.run(A._handle_message({"chat": {"id": 999999}, "from": {"id": 999999},
                               "text": "/search 报表"}))
check("未授权会话不发任何消息", SENT == [], SENT)
SENT.clear()
asyncio.run(A._handle_message({"chat": {"id": 8575978784}, "from": {"id": 8575978784},
                               "text": "报表"}))
check("普通文本不触发搜索", SENT == [], SENT)
SENT.clear()
asyncio.run(A._handle_message({"chat": {"id": 8575978784}, "from": {"id": 8575978784},
                               "text": "/stats"}))
with A.db() as c:
    n_all = c.execute("SELECT COUNT(*) c FROM files").fetchone()["c"]
check("/stats 返回统计", f"文件 {n_all} 个" in SENT[0][1].get("text", ""),
      SENT[0][1].get("text"))
SENT.clear()
asyncio.run(A._handle_message({"chat": {"id": 8575978784}, "from": {"id": 8575978784},
                               "text": "/get"}))
check("/get 无参数给出用法", "用法" in SENT[0][1].get("text", ""))
SENT.clear()
asyncio.run(A._handle_message({"chat": {"id": 8575978784}, "from": {"id": 8575978784},
                               "text": "/search@my_bot 报表"}))
check("带 @botname 后缀的命令可识别",
      len(SENT) == 1 and "命中" in SENT[0][1].get("text", ""), SENT)

print("== offset 持久化 ==")
A._save_offset(4242)
check("offset 正确读写", A._load_offset() == 4242, A._load_offset())


def journal_events():
    if not A.JOURNAL.exists():
        return []
    txt = A.JOURNAL.read_text(encoding="utf-8")
    return [json.loads(l) for l in txt.splitlines() if l.strip()]


print("== _incoming_file 类型识别 ==")
d = A._incoming_file({"document": {"file_id": "F1", "file_unique_id": "U1",
                                   "file_name": "教程.pdf", "file_size": 123,
                                   "mime_type": "application/pdf"}})
check("document 取到原文件名", d and d["name"] == "教程.pdf" and d["size"] == 123, d)
p = A._incoming_file({"photo": [{"file_id": "P1", "file_unique_id": "PU1", "file_size": 100},
                                {"file_id": "P2", "file_unique_id": "PU2", "file_size": 900}]})
check("photo 取最大尺寸那份", p and p["file_id"] == "P2", p)
check("photo 生成 .jpg 名", bool(p and p["name"].endswith(".jpg")), p)
v = A._incoming_file({"voice": {"file_id": "V1", "file_unique_id": "VU1", "file_size": 10}})
check("voice 生成 .ogg 名", bool(v and v["name"].endswith(".ogg")), v)
au = A._incoming_file({"audio": {"file_id": "A1", "file_unique_id": "AU1",
                                 "file_size": 5, "title": "夜曲"}})
check("audio 用标题命名", au and au["name"] == "夜曲.mp3", au)
vn = A._incoming_file({"video_note": {"file_id": "N1", "file_unique_id": "NU1"}})
check("video_note 生成 .mp4 名", bool(vn and vn["name"].endswith(".mp4")), vn)
check("纯文本不算文件", A._incoming_file({"text": "hi"}) is None)
check("sticker 不收录", A._incoming_file({"sticker": {"file_id": "S1"}}) is None)
check("空消息不算文件", A._incoming_file({}) is None)

print("== 反向上传：发文件给 bot 自动入库 ==")
A._tg = fake_tg
SENT.clear()
DOC_MSG = {"chat": {"id": 8575978784}, "from": {"id": 8575978784}, "message_id": 900,
           "document": {"file_id": "NEW1", "file_unique_id": "NEWU1",
                        "file_name": "手机拍的合同.pdf", "file_size": 4567,
                        "mime_type": "application/pdf"}}
asyncio.run(A._handle_message(DOC_MSG))
with A.db() as c:
    row = c.execute("SELECT * FROM files WHERE file_unique='NEWU1'").fetchone()
    inbox = c.execute("SELECT id FROM folders WHERE name=?", (A.INBOX_NAME,)).fetchone()
check("文件已入库", row is not None, row)
check("默认落在收件箱",
      row is not None and inbox is not None and row["folder_id"] == inbox["id"],
      row["folder_id"] if row else None)
check("message_id 被记录（取回要用）", bool(row is not None and row["message_id"] == 900), row["message_id"] if row else None)
check("回复了收录确认",
      any(m == "sendMessage" and "已收录" in (p.get("text") or "") for m, p in SENT),
      [m for m, _ in SENT])
check("无说明时补 TGPOOL caption",
      any(m == "editMessageCaption" and (p.get("caption") or "").startswith("TGPOOL ")
          for m, p in SENT), [(m, p.get("caption")) for m, p in SENT])
ev = [e for e in journal_events() if e.get("t") == "add" and e.get("tg_unique") == "NEWU1"]
check("写入了 journal add 事件（灾备依赖）", len(ev) == 1, ev)
check("journal 的 add 带 path",
      bool(ev) and ev[0]["path"] == "/" + A.INBOX_NAME, ev)
check("journal 的 add 字段与网页上传一致",
      bool(ev) and {"id", "name", "size", "mime", "tg_file_id", "tg_unique",
                    "message_id", "chat_id", "path", "created_at"} <= set(ev[0].keys()),
      sorted(ev[0].keys()) if ev else None)

SENT.clear()
asyncio.run(A._handle_message(DOC_MSG))
with A.db() as c:
    n = c.execute("SELECT COUNT(*) c FROM files WHERE file_unique='NEWU1'").fetchone()["c"]
check("重复文件不重复收录", n == 1, n)
check("重复时给出提示",
      any("已经在池子里" in (p.get("text") or "") for m, p in SENT),
      [p.get("text") for m, p in SENT])

SENT.clear()
CAP_MSG = {"chat": {"id": 8575978784}, "from": {"id": 8575978784}, "message_id": 901,
           "caption": "/票据/2026",
           "document": {"file_id": "NEW2", "file_unique_id": "NEWU2",
                        "file_name": "发票.pdf", "file_size": 100,
                        "mime_type": "application/pdf"}}
asyncio.run(A._handle_message(CAP_MSG))
with A.db() as c:
    r2 = c.execute("SELECT folder_id FROM files WHERE file_unique='NEWU2'").fetchone()
    path2 = A.path_of(c, r2["folder_id"])
    names = {r["name"] for r in c.execute("SELECT name FROM folders").fetchall()}
check("说明写路径 -> 入对应目录", path2 == "/票据/2026", path2)
check("缺失的目录层级自动创建", {"票据", "2026"} <= names, sorted(names))
check("有说明时不覆盖原说明", not any(m == "editMessageCaption" for m, _ in SENT),
      [m for m, _ in SENT])
check("journal 记录每级 mkdir",
      any(e.get("t") == "mkdir" and e.get("path") == "/票据" for e in journal_events())
      and any(e.get("t") == "mkdir" and e.get("path") == "/票据/2026"
              for e in journal_events()))

SENT.clear()
asyncio.run(A._handle_message({"chat": {"id": 999999}, "from": {"id": 999999},
                               "message_id": 902,
                               "document": {"file_id": "X", "file_unique_id": "XU",
                                            "file_name": "x.pdf", "file_size": 1}}))
with A.db() as c:
    n2 = c.execute("SELECT COUNT(*) c FROM files WHERE file_unique='XU'").fetchone()["c"]
check("未授权会话发文件不入库且不回复", n2 == 0 and SENT == [], (n2, SENT))

print("== 收录后能被搜到、也能取回 ==")
SENT.clear()
asyncio.run(A._reply_search(8575978784, "合同"))
_, p6 = SENT[0]
check("新收录的文件可被 /search 搜到", "手机拍的合同.pdf" in (p6.get("text") or ""),
      p6.get("text"))
fid6 = [b for row in (p6.get("reply_markup") or {}).get("inline_keyboard", [])
        for b in row if b["callback_data"].startswith("g:")][0]["callback_data"][2:]
SENT.clear()
asyncio.run(A._handle_callback({"id": "CB1", "from": {"id": 8575978784},
                                "data": "g:" + fid6,
                                "message": {"message_id": 903,
                                            "chat": {"id": 8575978784}}}))
check("点按钮后 copyMessage 投递",
      any(m == "copyMessage" for m, _ in SENT), [m for m, _ in SENT])

print("== /backups：云端备份包列出与取回 ==")
bk = TMP / "backup"
bk.mkdir(parents=True, exist_ok=True)
recs = [
    {"ts": 1, "at": "2026-09-11 03:30:01", "name": "tgpool-backup-20260911-033000.tar.gz",
     "size": 156000, "file_id": "BK1", "message_id": 551, "sha256": "a"},
    {"ts": 2, "at": "2026-09-12 03:30:01", "name": "tgpool-backup-20260912-033000.tar.gz",
     "size": 157500, "file_id": "BK2", "message_id": 552, "sha256": "b"},
    {"ts": 3, "at": "2026-09-12 09:00:00", "name": "tgpool-deploy-记录缺msgid.tar.gz",
     "size": 10, "file_id": "BK3", "message_id": None, "sha256": "c"},
]
with open(A.REMOTE_LOG, "w", encoding="utf-8") as f:
    for r in recs:
        f.write(json.dumps(r, ensure_ascii=False) + "\n")

SENT.clear()
asyncio.run(A._reply_backups(8575978784))
_, pb = SENT[0]
check("列出全部 3 份备份", "共 3 份" in pb.get("text", ""), pb.get("text"))
check("含最新备份文件名", "tgpool-backup-20260912-033000.tar.gz" in pb.get("text", ""))
bts = [b for row in (pb.get("reply_markup") or {}).get("inline_keyboard", [])
       for b in row if b["callback_data"].startswith("b:")]
check("缺 message_id 的记录不生成按钮", sorted(b["callback_data"] for b in bts) == ["b:551", "b:552"],
      [b["callback_data"] for b in bts])

SENT.clear()
asyncio.run(A._handle_callback({"id": "CB2", "from": {"id": 8575978784},
                                "data": "b:552",
                                "message": {"message_id": 904,
                                            "chat": {"id": 8575978784}}}))
cm = [p for m, p in SENT if m == "copyMessage"]
check("点备份按钮 copyMessage 原消息",
      len(cm) == 1 and cm[0].get("message_id") == 552
      and str(cm[0].get("from_chat_id")) == "8575978784", cm)

# 空注册表：友好提示而非报错
_orig_log = A.REMOTE_LOG
A.REMOTE_LOG = TMP / "backup" / "no-such-remote.jsonl"
SENT.clear()
asyncio.run(A._reply_backups(8575978784))
check("无备份记录给出提示", "还没有云端备份记录" in SENT[0][1].get("text", ""),
      SENT[0][1].get("text"))
A.REMOTE_LOG = _orig_log

# ============================================================================
#  v1.5 新增：/rm · /move · /pass（以及它们依赖的路径解析与批量删除）
# ============================================================================
import rebuild_index as R      # 与测试脚本同目录；用来验证 journal 仍能完整重放


def TXT(text):
    return {"chat": {"id": 8575978784}, "from": {"id": 8575978784}, "text": text}


_UID = [8100]


def send_doc(name, cap, size=100):
    """走 bot 收录路径造样本（它写 journal add，重放时才对得上账）。"""
    _UID[0] += 1
    msg = {"chat": {"id": 8575978784}, "from": {"id": 8575978784}, "message_id": _UID[0],
           "document": {"file_id": "MV%d" % _UID[0], "file_unique_id": "MVU%d" % _UID[0],
                        "file_name": name, "file_size": size, "mime_type": "text/plain"}}
    if cap:
        msg["caption"] = cap
    asyncio.run(A._handle_message(msg))
    return _UID[0]


def file_id_of(name):
    with A.db() as c:
        r = c.execute("SELECT id FROM files WHERE name=?", (name,)).fetchone()
    return r["id"] if r else None


def folder_exists(path):
    with A.db() as c:
        return A._resolve_path(c, path)[1] is None


def last_text():
    return SENT[-1][1].get("text", "")


print("== _norm_path / _split_args ==")
check("多斜杠与尾斜杠归一化", A._norm_path("//a//b/") == "/a/b", A._norm_path("//a//b/"))
check("空串归一化为根", A._norm_path("") == "/")
check("根仍是根", A._norm_path("/") == "/")
check("单引号包住含空格的路径",
      A._split_args("'/工作/我的 报告' /归档") == ["/工作/我的 报告", "/归档"],
      A._split_args("'/工作/我的 报告' /归档"))
check("双引号与中文引号混用",
      A._split_args('"/a b" “/c d”') == ["/a b", "/c d"], A._split_args('"/a b" “/c d”'))
check("无引号按空白切", A._split_args("/a/b    /c") == ["/a/b", "/c"])
check("多个空格与首尾空白不产生空参数", A._split_args("  /a/b  ") == ["/a/b"])
check("空输入得到空列表", A._split_args("") == [])

print("== _resolve_node（同时认出文件与目录）==")
with A.db() as c:
    k, i, e = A._resolve_node(c, "/工作/2026")
    check("目录 -> folder", k == "folder" and e is None and i is not None, (k, i, e))
    k, i, e = A._resolve_node(c, "/工作/2026/财务报表.pdf")
    check("文件 -> file", k == "file" and e is None and i is not None, (k, i, e))
    k, i, e = A._resolve_node(c, "/工作/2026/财务报表.pdf", "folder")
    check("-dir 时不认文件", k is None and bool(e), (k, e))
    k, i, e = A._resolve_node(c, "/工作/2026", "file")
    check("-file 时不认目录", k is None and bool(e), (k, e))
    k, i, e = A._resolve_node(c, "/")
    check("根 -> folder/None", k == "folder" and i is None and e is None, (k, i, e))
    k, i, e = A._resolve_node(c, "/查无此路径")
    check("不存在 -> 带错误信息", k is None and bool(e), (k, e))

print("== /move：移动目录 ==")
send_doc("m1.txt", "/移动源")
send_doc("m2.txt", "/移动源/子")
check("样本目录建好", folder_exists("/移动源/子"))

SENT.clear()
asyncio.run(A._handle_message(TXT("/move /移动源 /归档区")))
check("回复里给出新旧路径", "已移动文件夹" in last_text() and "/归档区/移动源" in last_text(),
      last_text())
check("目录真的挪了", folder_exists("/归档区/移动源/子"))
check("原路径已消失", not folder_exists("/移动源"))
check("目标目录不存在时自动创建并写 journal",
      any(e.get("t") == "mkdir" and e.get("path") == "/归档区" for e in journal_events()))
mv = [e for e in journal_events() if e.get("t") == "mvd" and e.get("path") == "/移动源"]
check("写了 mvd 事件（灾备依赖）", len(mv) == 1 and mv[0]["new"] == "/归档区/移动源", mv)
with A.db() as c:
    check("目录树整体跟着走（子目录还在）", A._resolve_path(c, "/归档区/移动源/子")[1] is None)

SENT.clear()
asyncio.run(A._handle_message(TXT("/move /归档区 /归档区/移动源")))
check("拒绝把目录挪进它自己的子目录", "不能" in last_text(), last_text())

SENT.clear()
asyncio.run(A._handle_message(TXT("/move /移动源 /归档区")))
check("源不存在时给出明确提示", "路径不存在" in last_text(), last_text())

print("== /move：移动文件（含带空格的路径）==")
send_doc("带空格 文件.txt", "/含 空格")
SENT.clear()
asyncio.run(A._handle_message(TXT('/move "/含 空格/带空格 文件.txt" /归档区')))
check("引号路径能被正确切分", "已移动文件" in last_text() and "/归档区/带空格 文件.txt" in last_text(),
      last_text())
mvf = [e for e in journal_events() if e.get("t") == "mv" and e.get("path") == "/归档区"]
check("写了 mv 事件（灾备依赖）", len(mvf) >= 1, mvf)

SENT.clear()
asyncio.run(A._handle_message(TXT('/move "/归档区/带空格 文件.txt"')))
check("只写源路径 = 挪到根目录", "已移动文件" in last_text() and "→  /带空格 文件.txt" in last_text(),
      last_text())

with A.db() as c:
    check("文件确实落在根目录", A.path_of(c, c.execute(
        "SELECT folder_id FROM files WHERE name='带空格 文件.txt'").fetchone()["folder_id"]) == "/")

SENT.clear()
asyncio.run(A._handle_message(TXT('/move "/带空格 文件.txt" /深层/一级/二级')))
check("多级目标目录会逐级自动创建",
      folder_exists("/深层/一级/二级") and "/深层/一级/二级/带空格 文件.txt" in last_text(),
      last_text())
check("自动创建时每级都写 mkdir（重建才不丢目录）",
      all(any(e.get("t") == "mkdir" and e.get("path") == p for e in journal_events())
          for p in ("/深层", "/深层/一级", "/深层/一级/二级")))
check("回复里说明了自动创建的目录", "自动创建" in last_text(), last_text())

SENT.clear()
asyncio.run(A._handle_message(TXT("/move")))
check("/move 缺参数给出用法", "用法" in last_text(), last_text())
SENT.clear()
asyncio.run(A._handle_message(TXT("/move /a /b /c")))
check("/move 参数过多给出用法", "用法" in last_text(), last_text())

print("== /rename：改名（只动索引，不动 Telegram 消息）==")
send_doc("旧名字.txt", "/改名区")
send_doc("子文件.txt", "/改名区/旧目录")
fid_rn = file_id_of("旧名字.txt")

SENT.clear()
asyncio.run(A._handle_message(TXT("/rename /改名区/旧名字.txt 新名字.txt")))
check("回复了已重命名文件", "已重命名文件" in last_text(), last_text())
check("索引里的名字变了",
      file_id_of("新名字.txt") is not None and file_id_of("旧名字.txt") is None)
check("只发了文字：没往 Telegram 侧发/删任何东西",
      [m for m, _ in SENT] == ["sendMessage"], [m for m, _ in SENT])
with A.db() as c:
    r = c.execute("SELECT folder_id FROM files WHERE id=?", (fid_rn,)).fetchone()
    check("位置没动（还在 /改名区）", A.path_of(c, r["folder_id"]) == "/改名区",
          A.path_of(c, r["folder_id"]))
ren = [e for e in journal_events() if e.get("t") == "ren" and e.get("id") == fid_rn]
check("写了 ren 事件（灾备依赖）",
      len(ren) == 1 and ren[0]["name"] == "新名字.txt" and ren[0]["path"] == "/改名区", ren)

SENT.clear()
ok_rn = asyncio.run(A._send_file(8575978784, fid_rn))
check("改名后照样能按编号取回（message_id 没丢）",
      ok_rn and [m for m, _ in SENT] == ["copyMessage"], [m for m, _ in SENT])

SENT.clear()
asyncio.run(A._handle_message(TXT("/rename /改名区 改名后")))
check("回复了已重命名目录",
      "已重命名目录" in last_text() and "/改名区  →  /改名后" in last_text(), last_text())
check("目录真的改名了", folder_exists("/改名后") and not folder_exists("/改名区"))
with A.db() as c:
    check("子目录路径跟着变", A._resolve_path(c, "/改名后/旧目录")[1] is None)
    r2 = c.execute("SELECT folder_id FROM files WHERE id=?", (fid_rn,)).fetchone()
    check("文件的新路径也算得出来", A.path_of(c, r2["folder_id"]) == "/改名后",
          A.path_of(c, r2["folder_id"]))
mvz = [e for e in journal_events() if e.get("by") == "bot:rename"]
check("目录改名写 mvd（path=旧全路径, new=新全路径，重放器天然支持）",
      len(mvz) == 1 and mvz[0]["path"] == "/改名区" and mvz[0]["new"] == "/改名后", mvz)

# 保护性检查
send_doc("a.txt", "/重名区/甲")
send_doc("b.txt", "/重名区/乙")
SENT.clear()
asyncio.run(A._handle_message(TXT("/rename /重名区/甲 乙")))
check("同层目录重名被拒绝", "已经有目录" in last_text(), last_text())

send_doc("f1.txt", "/重名区")
send_doc("f2.txt", "/重名区")
SENT.clear()
asyncio.run(A._handle_message(TXT("/rename /重名区/f1.txt f2.txt")))
check("同层文件重名被拒绝", "已经有文件" in last_text(), last_text())

SENT.clear()
asyncio.run(A._handle_message(TXT("/rename /重名区/f1.txt 带/斜杠")))
check("新名字带 / 被拒绝", "不带 /" in last_text(), last_text())

SENT.clear()
asyncio.run(A._handle_message(TXT("/rename /重名区/f1.txt f1.txt")))
check("名字没变时什么都不做", "本来就是" in last_text(), last_text())
check("没变的改名不写 journal",
      not any(e.get("t") == "ren" and e.get("name") == "f1.txt"
              for e in journal_events()))

SENT.clear()
asyncio.run(A._handle_message(TXT("/rename / 根改名")))
check("根目录不能改名", "根目录不能改名" in last_text(), last_text())

SENT.clear()
asyncio.run(A._handle_message(TXT("/rename /只有一个参数")))
check("/rename 缺参数给出用法", "用法" in last_text(), last_text())
SENT.clear()
asyncio.run(A._handle_message(TXT("/rename /a /b /c")))
check("/rename 参数过多给出用法", "用法" in last_text(), last_text())
SENT.clear()
asyncio.run(A._handle_message(TXT("/rename /查无此路径 新名")))
check("/rename 路径不存在给出提示", "路径不存在" in last_text(), last_text())

SENT.clear()
asyncio.run(A._handle_message(TXT("/ren /重名区/f1.txt 别名生效.txt")))
check("/ren 是 /rename 的别名",
      "已重命名文件" in last_text() and file_id_of("别名生效.txt") is not None, last_text())

SENT.clear()
asyncio.run(A._handle_message(TXT("/rename -file /重名区/f2.txt f2改过.txt")))
check("-file 指明改文件", "已重命名文件" in last_text(), last_text())
SENT.clear()
asyncio.run(A._handle_message(TXT("/rename -dir /重名区/f1.txt 硬要当目录")))
check("-dir 时不认文件", "目录不存在" in last_text(), last_text())

print("== /rm：删文件 ==")
fid1 = file_id_of("m1.txt")
SENT.clear()
asyncio.run(A._handle_message(TXT("/rm /归档区/移动源/m1.txt")))
check("回复已删除文件", "已删除文件" in last_text() and "无法找回" in last_text(), last_text())
check("真的从 Telegram 侧删了消息",
      any(m == "deleteMessages" for m, _ in SENT), [m for m, _ in SENT])
check("索引里也没有了", file_id_of("m1.txt") is None)
check("写了 del 事件", any(e.get("t") == "del" and e.get("id") == fid1
                          for e in journal_events()))

m2id = file_id_of("m2.txt")
SENT.clear()
asyncio.run(A._handle_message(TXT("/rm #%d" % m2id)))
check("/rm #编号 也能删", "已删除文件" in last_text() and file_id_of("m2.txt") is None, last_text())
SENT.clear()
asyncio.run(A._handle_message(TXT("/rm #999999")))
check("编号不存在给出提示", "不存在" in last_text(), last_text())

print("== /rm：删目录（先确认，再动手）==")
SENT.clear()
asyncio.run(A._handle_message(TXT("/rm /归档区/移动源")))
t = last_text()
kb = (SENT[-1][1].get("reply_markup") or {}).get("inline_keyboard", [])
btns = {b["callback_data"]: b["text"] for row in kb for b in row}
check("先要确认，且给出内容清单",
      "要删除整个文件夹吗" in t and "个子目录" in t and len(btns) == 2, (t, btns))
check("确认前什么都还没删", folder_exists("/归档区/移动源") and len(A.RM_PENDING) == 1,
      len(A.RM_PENDING))

tok = [k for k in btns if k.startswith("r:")][0].split(":")[1]
SENT.clear()
asyncio.run(A._handle_callback({"id": "RC1", "from": {"id": 8575978784},
                                "data": "r:%s:n" % tok,
                                "message": {"message_id": 777, "chat": {"id": 8575978784}}}))
check("点取消后目录还在", folder_exists("/归档区/移动源"))
check("点取消后有反馈", any(m in ("editMessageText", "sendMessage") for m, _ in SENT),
      [m for m, _ in SENT])
check("取消后确认记录被清掉", A.RM_PENDING == {}, A.RM_PENDING)

SENT.clear()
asyncio.run(A._handle_message(TXT("/rm /归档区/移动源")))
tok = list(A.RM_PENDING)[0]
SENT.clear()
asyncio.run(A._handle_callback({"id": "RC2", "from": {"id": 8575978784},
                                "data": "r:%s:y" % tok,
                                "message": {"message_id": 778, "chat": {"id": 8575978784}}}))
check("确认后目录没了", not folder_exists("/归档区/移动源"))
check("就地改写那条确认消息（不再多发一条）",
      [m for m, _ in SENT if m in ("editMessageText", "sendMessage")][-1] == "editMessageText",
      [m for m, _ in SENT])
check("写了 rmd 事件（灾备依赖）",
      any(e.get("t") == "rmd" and e.get("path") == "/归档区/移动源" for e in journal_events()))
check("确认按钮一次性（不能重复删）", A.RM_PENDING == {}, A.RM_PENDING)

SENT.clear()
asyncio.run(A._handle_callback({"id": "RC3", "from": {"id": 8575978784},
                                "data": "r:deadbeef:y",
                                "message": {"message_id": 779, "chat": {"id": 8575978784}}}))
check("过期/伪造的确认不会删东西",
      any(m == "answerCallbackQuery" and "失效" in (p.get("text") or "") for m, p in SENT),
      [(m, p.get("text")) for m, p in SENT])

print("== /rm：-f 与路径里的空格 ==")
SENT.clear()
asyncio.run(A._handle_message(TXT("/rm /含 空格")))
check("含空格的路径不加引号会被当两个参数（给用法提示）",
      "用法" in last_text() and folder_exists("/含 空格"), last_text())
SENT.clear()
asyncio.run(A._handle_message(TXT('/rm -f "/含 空格"')))
check("-f 加引号直接删掉，不再确认",
      "已删除文件夹" in last_text() and not folder_exists("/含 空格") and A.RM_PENDING == {},
      last_text())

print("== /rm：根目录保护与同名文件/目录 ==")
SENT.clear()
asyncio.run(A._handle_message(TXT("/rm /")))
check("根目录拒绝删除", "根目录不能删" in last_text(), last_text())

send_doc("同名", "/")                       # 根目录下一个叫「同名」的文件
with A.db() as c:
    A._ensure_folder_path(c, "/同名")        # 再来一个同名目录
SENT.clear()
asyncio.run(A._handle_message(TXT("/rm /同名")))
check("同名时默认当目录处理，并提示清楚",
      "要删除整个文件夹吗" in last_text() and "同名文件" in last_text(), last_text())
SENT.clear()
asyncio.run(A._handle_message(TXT("/rm -file /同名")))
check("-file 只删文件", "已删除文件" in last_text() and file_id_of("同名") is None, last_text())
check("同名目录没被连坐", folder_exists("/同名"))
SENT.clear()
asyncio.run(A._handle_message(TXT("/rm -f -dir /同名")))
check("-dir 删掉剩下的空目录", "已删除文件夹" in last_text() and not folder_exists("/同名"),
      last_text())

SENT.clear()
asyncio.run(A._handle_message(TXT("/rm")))
check("/rm 缺参数给出用法", "用法" in last_text(), last_text())
SENT.clear()
asyncio.run(A._handle_message(TXT("/rm /查无此路径")))
check("/rm 路径不存在给出提示", "路径不存在" in last_text(), last_text())

print("== /pass：忘记密码时把账号密码捞回来 ==")
SENT.clear()
asyncio.run(A._handle_message(TXT("/pass")))
t = last_text()
kb = (SENT[-1][1].get("reply_markup") or {}).get("inline_keyboard", [])
check("回复里有账号", "admin" in t, t)
check("回复里有密码（TG_AUTH_PASS=test）", "test" in t, t)
check("带上网页地址与端口", "https://" in t and ":8443" in t, t)
check("告诉用户在服务器上怎么查", "show_password.py" in t, t)
check("带一键删除按钮", any(b.get("callback_data") == "q" for row in kb for b in row), kb)
SENT.clear()
asyncio.run(A._handle_callback({"id": "RCQ", "from": {"id": 8575978784}, "data": "q",
                                "message": {"message_id": 780, "chat": {"id": 8575978784}}}))
check("点按钮能删掉这条含密码的消息",
      any(m == "deleteMessage" and p.get("message_id") == 780 for m, p in SENT),
      [(m, p) for m, p in SENT])

A.SHOW_PASS = False
SENT.clear()
asyncio.run(A._handle_message(TXT("/pass")))
check("TG_BOT_SHOW_PASS=0 时不回密码", "TG_BOT_SHOW_PASS" in last_text(), last_text())
A.SHOW_PASS = True

SENT.clear()
asyncio.run(A._handle_message({"chat": {"id": 999999}, "from": {"id": 999999},
                               "text": "/pass"}))
check("未授权会话连密码也问不到", SENT == [], SENT)

print("== 批量删除消息 ==")
SENT.clear()
n = asyncio.run(A._tg_delete_messages(8575978784, list(range(1, 251))))
calls = [p for m, p in SENT if m == "deleteMessages"]
check("250 条拆成 100/100/50 三批",
      [len(c["message_ids"]) for c in calls] == [100, 100, 50],
      [len(c["message_ids"]) for c in calls])
check("返回确认删除的条数", n == 250, n)
SENT.clear()
n0 = asyncio.run(A._tg_delete_messages(8575978784, [None, 0, ""]))
check("空 message_id 不发请求", SENT == [] and n0 == 0, (SENT, n0))


async def no_batch(method, **params):
    SENT.append((method, params))
    if method == "deleteMessages":
        return {"ok": False, "description": "Bad Request: method not found"}
    return {"ok": True, "result": True}


A._tg = no_batch
SENT.clear()
n2 = asyncio.run(A._tg_delete_messages(1, [11, 12]))
check("批量接口不可用时退回逐条 deleteMessage",
      [m for m, _ in SENT] == ["deleteMessages", "deleteMessage", "deleteMessage"] and n2 == 2,
      [m for m, _ in SENT])
A._tg = fake_tg

print("== 命令分发：/rm /move /pass ==")
for t in ("/rm", "/move", "/pass"):
    SENT.clear()
    asyncio.run(A._handle_message(TXT(t + "@tgpool_bot")))
    check("%s@botname 能识别" % t, len(SENT) == 1, SENT)
SENT.clear()
asyncio.run(A._handle_message(TXT("/mv /归档区 /归档区2")))
check("/mv 是 /move 的别名", "已移动文件夹" in last_text(), last_text())
SENT.clear()
asyncio.run(A._handle_message(TXT("/help")))
check("帮助里列出了新命令",
      all(x in last_text() for x in ("/rm", "/move", "/pass", "/rename")),
      last_text()[:200])

print("== journal 重放：/rm · /move · /rename 写的事件必须能被完整重放 ==")
folders_r, files_r, stat_r = R.replay(A.JOURNAL)
cur_folders, cur_files = R.read_db(A.DB_PATH)
check("journal 没有解析不了的行", stat_r["bad"] == 0, stat_r)
check("journal 没有未知事件", stat_r["unknown"] == 0, stat_r)
check("事件类型齐全（mkdir/add/mv/mvd/del/rmd/ren）",
      {"mkdir", "add", "mv", "mvd", "del", "rmd", "ren"} <= set(stat_r["kinds"]),
      stat_r["kinds"])
check("重放出的目录都存在于现库", set(folders_r) <= set(cur_folders),
      sorted(set(folders_r) - set(cur_folders))[:8])
bad = []
for i, r in files_r.items():
    lv = cur_files.get(i)
    if not lv or (lv["name"], lv["_path"]) != (r["name"], r["_path"]):
        bad.append((i, r["_path"], lv and lv["_path"]))
check("重放出的文件路径与现库逐条一致（删掉/挪走的都对得上）", not bad, bad[:5])
check("已删除的文件不在重放结果里",
      not any(r["name"] == "m1.txt" for r in files_r.values()),
      [r["name"] for r in files_r.values() if r["name"] == "m1.txt"])
check("带空格的文件重放后落在最后一次移动的目录",
      any(r["name"] == "带空格 文件.txt" and r["_path"] == "/深层/一级/二级"
          for r in files_r.values()),
      [(r["name"], r["_path"]) for r in files_r.values() if "带空格" in r["name"]])

print("== tools/show_password.py：服务器上找回密码 ==")
import re
import subprocess

SCRIPT = Path(__file__).resolve().parent / "show_password.py"
envdir = TMP / "envtest"
envdir.mkdir(parents=True, exist_ok=True)
envfile = envdir / "tgpool.env"
envfile.write_text("TG_AUTH_USER=admin\nTG_AUTH_PASS=S3cret-Pass-42\n"
                   "TG_NGINX_PORT=8443\nTG_BOT_TOKEN=999:ZZZ\n", encoding="utf-8")


def run_script(*args):
    p = subprocess.run([sys.executable, str(SCRIPT), "--env-file", str(envfile), *args],
                       capture_output=True, text=True, encoding="utf-8", errors="replace")
    return p.returncode, (p.stdout or "") + (p.stderr or "")


rc, out = run_script()
check("脚本存在且能正常退出", SCRIPT.is_file() and rc == 0, (SCRIPT, rc, out[:200]))
check("打印出账号", "admin" in out, out[:200])
check("打印出密码", "S3cret-Pass-42" in out, out[:200])
check("默认不打印 bot token", "999:ZZZ" not in out, out[:200])

rc, out = run_script("--token")
check("--token 才打印 token", "999:ZZZ" in out, out[:200])

rc, out = run_script("--json")
data = json.loads(out)
check("--json 可解析且账号密码正确",
      data["user"] == "admin" and data["password"] == "S3cret-Pass-42", data)
check("--json 带出网页地址", data["url"].startswith("https://") and ":8443" in data["url"], data)

rc, out = run_script("--port", "9999")
check("--port 能覆盖端口", ":9999" in out, out[:200])

rc, out = run_script("--reset")
check("--reset 不带 --yes 时只提示、不改文件",
      "S3cret-Pass-42" in envfile.read_text(encoding="utf-8"), rc)
rc, out = run_script("--reset", "--yes")
newenv = envfile.read_text(encoding="utf-8")
m = re.search(r"^TG_AUTH_PASS=(\S+)$", newenv, re.M)
baks = list(envdir.glob("tgpool.env.bak-*"))
check("--reset --yes 换成新的 16 位密码",
      rc == 0 and bool(m) and m.group(1) != "S3cret-Pass-42" and len(m.group(1)) == 16,
      (rc, m and m.group(1)))
check("改之前自动备份了原文件",
      bool(baks) and "S3cret-Pass-42" in baks[0].read_text(encoding="utf-8"), baks)
check("reset 不动别的配置项", "TG_BOT_TOKEN=999:ZZZ" in newenv, newenv)

print("== 网页端删除接口（delete_messages 改造后回归）==")
from fastapi.testclient import TestClient

AUTH = ("admin", "test")
A._tg = fake_tg
with TestClient(A.app) as cl:
    r = cl.get("/api/stats")
    check("未带凭据一律 401", r.status_code == 401, r.status_code)
    r = cl.get("/api/stats", auth=AUTH)
    check("带凭据可读统计",
          r.status_code == 200 and "count" in r.json(), (r.status_code, r.text[:120]))

    r = cl.post("/api/folders", json={"name": "网页删", "parent_id": None}, auth=AUTH)
    check("新建目录成功", r.status_code == 200, (r.status_code, r.text[:120]))
    wid = r.json()["id"]
    r = cl.post("/api/folders", json={"name": "子", "parent_id": wid}, auth=AUTH)
    sub = r.json()["id"]
    with A.db() as c:
        c.execute("INSERT INTO files(name,size,mime,file_id,message_id,chat_id,folder_id,"
                  "created_at) VALUES(?,?,?,?,?,?,?,?)",
                  ("web-del.txt", 10, "text/plain", "WF1", 4321, "8575978784", sub, 1))
        c.commit()
        wfid = c.execute("SELECT id FROM files WHERE file_id='WF1'").fetchone()["id"]

    r = cl.delete("/api/folders/%d" % wid, auth=AUTH)
    check("非空目录默认拒绝（需 force）", r.status_code == 409, (r.status_code, r.text[:120]))

    SENT.clear()
    r = cl.delete("/api/folders/%d?force=true" % wid, auth=AUTH)
    check("force 递归删除成功",
          r.status_code == 200 and r.json()["deleted_files"] == 1, (r.status_code, r.text[:160]))
    check("网页删除也走批量 deleteMessages",
          any(m == "deleteMessages" for m, _ in SENT), [m for m, _ in SENT])
    check("网页删除写了 journal rmd",
          any(e.get("t") == "rmd" and e.get("path") == "/网页删" for e in journal_events()))

    with A.db() as c:
        c.execute("INSERT INTO files(name,size,mime,file_id,message_id,chat_id,folder_id,"
                  "created_at) VALUES(?,?,?,?,?,?,?,?)",
                  ("web-del2.txt", 11, "text/plain", "WF2", 4322, "8575978784", None, 1))
        c.commit()
        wfid2 = c.execute("SELECT MAX(id) m FROM files").fetchone()["m"]
    SENT.clear()
    r = cl.delete("/api/files/%d" % wfid2, auth=AUTH)
    check("删单个文件成功", r.status_code == 200, (r.status_code, r.text[:120]))
    check("单文件也删了 Telegram 侧消息",
          any(m == "deleteMessages" and p.get("message_ids") == [4322] for m, p in SENT),
          [(m, p.get("message_ids")) for m, p in SENT])
    check("单文件删除也写了 journal del",
          any(e.get("t") == "del" and e.get("id") == wfid2 for e in journal_events()))

print("== 网页端重命名接口（PATCH /api/files · /api/folders）==")
with TestClient(A.app) as cl:
    r = cl.post("/api/folders", json={"name": "网页改名", "parent_id": None}, auth=AUTH)
    check("建目录用于改名", r.status_code == 200, (r.status_code, r.text[:120]))
    wid2 = r.json()["id"]
    with A.db() as c:
        for n, f in (("wr-旧.txt", "WR1"), ("wr-占位.txt", "WR2")):
            c.execute("INSERT INTO files(name,size,mime,file_id,message_id,chat_id,folder_id,"
                      "created_at) VALUES(?,?,?,?,?,?,?,?)",
                      (n, 10, "text/plain", f, 4400, "8575978784", wid2, 1))
        c.commit()
        r1 = c.execute("SELECT id FROM files WHERE file_id='WR1'").fetchone()["id"]

    r = cl.patch("/api/files/%d" % r1, json={"name": "wr-新.txt"}, auth=AUTH)
    check("网页改文件名返回 200 且带新名",
          r.status_code == 200 and r.json()["name"] == "wr-新.txt", (r.status_code, r.text[:160]))
    with A.db() as c:
        check("索引里的名字确实变了",
              c.execute("SELECT name FROM files WHERE id=?", (r1,)).fetchone()["name"]
              == "wr-新.txt")
    wren = [e for e in journal_events() if e.get("t") == "ren" and e.get("id") == r1]
    check("网页改名写了 journal ren（灾备依赖）",
          len(wren) == 1 and wren[0]["name"] == "wr-新.txt"
          and wren[0]["path"] == "/网页改名", wren)

    n_ren = len([e for e in journal_events() if e.get("t") == "ren"])
    r = cl.patch("/api/files/%d" % r1, json={"name": "wr-新.txt"}, auth=AUTH)
    check("名字没变也返回 200", r.status_code == 200, (r.status_code, r.text[:120]))
    check("名字没变不写新 journal",
          len([e for e in journal_events() if e.get("t") == "ren"]) == n_ren)

    r = cl.patch("/api/files/%d" % r1, json={"name": "   "}, auth=AUTH)
    check("空名字被拒 400", r.status_code == 400, (r.status_code, r.text[:120]))

    r = cl.patch("/api/files/%d" % r1, json={"name": "wr-占位.txt"}, auth=AUTH)
    check("同层重名被拒 409", r.status_code == 409, (r.status_code, r.text[:160]))
    with A.db() as c:
        check("被拒后名字没被改",
              c.execute("SELECT name FROM files WHERE id=?", (r1,)).fetchone()["name"]
              == "wr-新.txt")

    r = cl.patch("/api/files/%d" % r1, json={"name": "a/b\\c.txt"}, auth=AUTH)
    check("名字里的 / 和 \\ 被替换成 _",
          r.status_code == 200 and r.json()["name"] == "a_b_c.txt", (r.status_code, r.text[:160]))

    r = cl.patch("/api/files/%d" % r1, json={"folder_id": None}, auth=AUTH)
    check("网页移动（folder_id）仍可用",
          r.status_code == 200 and r.json()["folder_id"] is None, (r.status_code, r.text[:160]))
    check("移动写了 journal mv（灾备依赖）",
          any(e.get("t") == "mv" and e.get("id") == r1 for e in journal_events()))

    with A.db() as c:
        row_now = c.execute("SELECT folder_id FROM files WHERE id=?", (r1,)).fetchone()
        check("文件真的挪到了根目录",
              row_now["folder_id"] is None and A.path_of(c, row_now["folder_id"]) == "/",
              row_now and row_now["folder_id"])

    r = cl.patch("/api/files/%d" % r1,
                 json={"name": "wr-合体.txt", "folder_id": wid2}, auth=AUTH)
    check("改名+移动一次完成",
          r.status_code == 200 and r.json()["name"] == "wr-合体.txt"
          and r.json()["folder_id"] == wid2, (r.status_code, r.text[:160]))

    r = cl.patch("/api/files/999999", json={"name": "x.txt"}, auth=AUTH)
    check("改不存在的文件返回 404", r.status_code == 404, (r.status_code, r.text[:120]))
    r = cl.patch("/api/files/%d" % r1, json={"folder_id": 999999}, auth=AUTH)
    check("移到不存在的目录返回 404", r.status_code == 404, (r.status_code, r.text[:120]))

    r = cl.patch("/api/folders/%d" % wid2, json={"name": "网页改名2"}, auth=AUTH)
    check("目录改名（原有功能）仍可用",
          r.status_code == 200 and folder_exists("/网页改名2"), (r.status_code, r.text[:160]))
    r = cl.patch("/api/folders/999999", json={"name": "x"}, auth=AUTH)
    check("改不存在的目录返回 404", r.status_code == 404, (r.status_code, r.text[:120]))

print("== 重放复核：加入网页端改名/移动后，journal 仍能完整重建 ==")
folders_r2, files_r2, stat_r2 = R.replay(A.JOURNAL)
cur_folders2, cur_files2 = R.read_db(A.DB_PATH)
check("加了网页端事件后 0 坏行 0 未知事件",
      stat_r2["bad"] == 0 and stat_r2["unknown"] == 0, stat_r2)
bad2 = []
for i, rr in files_r2.items():
    lv = cur_files2.get(i)
    if not lv or (lv["name"], lv["_path"]) != (rr["name"], rr["_path"]):
        bad2.append((i, rr["_path"], lv and lv["_path"]))
check("网页端改名后的重放结果与现库逐条一致", not bad2, bad2[:5])

print(f"\n结果：PASS {PASS} / FAIL {FAIL}")
sys.exit(1 if FAIL else 0)
