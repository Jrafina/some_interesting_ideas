#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
CloudFlare ImgBed -> Typora / 任意 Markdown 编辑器的图片上传桥。

用法（Typora 「上传服务设定」= Custom Command 时，Typora 会把图片路径追加到命令后面）：
    "<python.exe>" "<本脚本绝对路径>"
脚本会读同目录下的 config.json，把图片 POST 到图床，**只把外链 URL 打到 stdout**，
其余所有日志都走 stderr —— 因为 Typora 只认 stdout 的内容。

只用标准库，不需要 pip install 任何东西。
"""

import datetime
import io
import json
import mimetypes
import os
import ssl
import sys
import uuid
import urllib.error
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
CONFIG_PATH = os.path.join(HERE, "config.json")
PLACEHOLDER = "你的图床域名"

DEFAULTS = {
    "domain": "",
    "authCode": "",
    "token": "",
    "uploadChannel": "",
    "channelName": "",
    "uploadNameType": "default",
    "returnFormat": "full",
    "uploadFolder": "",
    "serverCompress": True,
    "autoRetry": True,
    "timeout": 90,
}


def log(msg):
    sys.stderr.write(str(msg) + "\n")


def load_config():
    cfg = dict(DEFAULTS)
    if os.path.exists(CONFIG_PATH):
        with io.open(CONFIG_PATH, encoding="utf-8-sig") as f:
            raw = f.read().strip()
        if raw:
            # 容错：允许用户直接粘一段 JSON 片段，或整个文件被 BOM / 多余逗号影响
            try:
                user = json.loads(raw)
            except ValueError:
                fixed = raw.replace("﻿", "").replace(",\n}", "\n}")
                user = json.loads(fixed)
            if isinstance(user, dict):
                cfg.update(user)
    return cfg


def build_url(cfg):
    domain = (cfg.get("domain") or "").strip().rstrip("/")
    if not domain:
        raise SystemExit("config.json 里的 domain 没填")
    if PLACEHOLDER in domain:
        raise SystemExit(
            "config.json 里的 domain 还是占位符「%s」——\n"
            "请改成你自己部署的图床域名（只填域名，不要带 /upload 之类的路径）。\n"
            "顺带说明：CloudFlare ImgBed 的官方文档站是 https://cfbed.sanyue.de，\n"
            "那不是图床实例，不能拿来上传。" % PLACEHOLDER
        )
    if not domain.startswith("http"):
        domain = "https://" + domain

    q = [("returnFormat", cfg.get("returnFormat") or "full")]
    if cfg.get("authCode"):
        q.append(("authCode", cfg["authCode"]))
    if cfg.get("uploadChannel"):
        q.append(("uploadChannel", cfg["uploadChannel"]))
    if cfg.get("channelName"):
        q.append(("channelName", cfg["channelName"]))
    if cfg.get("uploadNameType"):
        q.append(("uploadNameType", cfg["uploadNameType"]))
    if cfg.get("uploadFolder"):
        q.append(("uploadFolder", cfg["uploadFolder"]))
    if cfg.get("uploadChannel") == "telegram":
        q.append(("serverCompress", "true" if cfg.get("serverCompress", True) else "false"))
    q.append(("autoRetry", "true" if cfg.get("autoRetry", True) else "false"))

    from urllib.parse import urlencode
    return domain + "/upload?" + urlencode(q)


def multipart_body(path, boundary):
    filename = os.path.basename(path)
    ctype = mimetypes.guess_type(filename)[0] or "application/octet-stream"
    with open(path, "rb") as f:
        data = f.read()
    head = (
        "--%s\r\n"
        'Content-Disposition: form-data; name="file"; filename="%s"\r\n'
        "Content-Type: %s\r\n\r\n" % (boundary, filename, ctype)
    ).encode("utf-8")
    tail = ("\r\n--%s--\r\n" % boundary).encode("utf-8")
    return head + data + tail, len(data), ctype


def encode_url_path(url):
    """把 URL 里的路径部分做百分号编码，query/fragment 保持原样。

    为什么必须做：上传接口返回的 src 里如果带中文/全角/emoji，
    Typora 会原样写进 Markdown，浏览器请求时**不会**替你编码这段路径
    （这些字符不是合法 URL 字符），于是请求打到服务端对不上文件名 → 404。
    实测：/file/xxx_测试中文.png 原样访问失败，编码后同一个文件HTTP 200。
    编码对纯 ASCII 是恒等变换，所以无脑全编码不会破坏已有行为。
    """
    from urllib.parse import urlsplit, urlunsplit, quote
    parts = urlsplit(url)
    path = quote(parts.path, safe="/%:@!$&'()*+,;=~-._")
    return urlunsplit((parts.scheme, parts.netloc, path, parts.query, parts.fragment))


def pick_url(payload, domain):
    """从响应里挑出可用的完整外链。返回 (url, note)。"""
    # 正常形态：数组 [{"src": "/file/xxx", "publicUrl": "https://..."}]
    if isinstance(payload, list):
        if not payload:
            raise ValueError("响应是空数组")
        item = payload[0]
    elif isinstance(payload, dict):
        if payload.get("success") is False:
            raise ValueError(payload.get("message") or "服务端返回 success=false")
        item = payload
    else:
        raise ValueError("无法识别的响应类型: %r" % type(payload))

    if isinstance(item, dict):
        url = (item.get("publicUrl") or "").strip()
        src = (item.get("src") or "").strip()
        if url:
            return encode_url_path(url), "publicUrl"
        if src:
            if src.startswith("http"):
                return encode_url_path(src), "src(已是完整链接)"
            joined = domain + ("" if src.startswith("/") else "/") + src
            return encode_url_path(joined), "src(补全域名)"
        for k in ("url", "fileUrl"):
            v = (item.get(k) or "").strip()
            if v:
                return encode_url_path(v), k
    raise ValueError("响应里没找到 URL 字段: %r" % (item,))



def upload_one(path, cfg, domain):
    url = build_url(cfg)
    boundary = "----wb" + uuid.uuid4().hex
    body, size, ctype = multipart_body(path, boundary)

    headers = {
        "Content-Type": "multipart/form-data; boundary=" + boundary,
        "User-Agent": "TyporaImgBedUploader/1.0",
        "Accept": "application/json, text/plain, */*",
    }
    token = (cfg.get("token") or "").strip()
    if token:
        headers["Authorization"] = "Bearer " + token

    req = urllib.request.Request(url, data=body, headers=headers, method="POST")
    ctx = ssl.create_default_context()
    log("→ POST %s  (%s, %d bytes)" % (url, ctype, size))

    try:
        with urllib.request.urlopen(req, timeout=float(cfg.get("timeout") or 90), context=ctx) as resp:
            raw = resp.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", "replace")[:400]
        # 不把服务端原文整段抛给用户，只提示排查方向
        raise SystemExit("上传失败 HTTP %s\n%s" % (e.code, detail))
    except urllib.error.URLError as e:
        raise SystemExit("上传失败：连不上图床 (%s)" % (e.reason,))

    try:
        payload = json.loads(raw)
    except ValueError:
        raise SystemExit("上传失败：响应不是 JSON，前 300 字符 = %r" % raw[:300])

    public, field = pick_url(payload, domain)
    log("← %s: %s" % (field, public))
    return public


def resolve_folder(cfg, override):
    """决定上传目录。优先级：命令行 --folder > 环境变量 > config.json。

    目录里可以用这些占位符（按日期归档）：
        {yyyy} 四位年   {yy} 两位年   {mm} 两位月   {dd} 两位日   {yyyymm} 六位年月
    例：uploadFolder = "note/{yyyy}/{mm}"  ->  note/2026/10

    **故意不提供 {doc}（文档名）占位符**：
    Typora 会先把粘贴的图片存到 %TEMP%\\typora-user-images\\<日期>\\ 下，
    脚本拿到的路径属于这个暂存目录，拿不到你正在编辑的文档名。
    实测（jrafina 的真实暂存目录就是 typora-user-images\\2026-10-03\\）。
    所以按文档归类只能靠 --folder 或改config.json，别指望占位符。
    """
    folder = override or os.environ.get("IMGBED_FOLDER") or cfg.get("uploadFolder") or ""
    folder = str(folder).strip().strip("/")
    if not folder:
        return ""

    now = datetime.datetime.now()
    folder = (folder
              .replace("{yyyymm}", now.strftime("%Y%m"))
              .replace("{yyyy}", now.strftime("%Y"))
              .replace("{yy}", now.strftime("%y"))
              .replace("{mm}", now.strftime("%m"))
              .replace("{dd}", now.strftime("%d")))
    return folder.strip("/")


def looks_like_path(s):
    """判断一个参数更像「待上传的文件路径」还是「--folder 的目录值」。

    只有在**它确实不存在**时才算目录值。存在的文件一律当文件 —— 这样
    嵌套目录（note/2026）和带扩展名的目录（v1.0）都能正常传，
    而真有个文件叫 `--folder` 时也不会被误吞（那种情况 s 存在，判为文件）。
    """
    return os.path.isfile(s)



def main(argv):
    # 先剥掉我们自己加的选项，剩下的才是 Typora 追加的图片路径。
    # 歧义消解见 looks_like_path()：只有当参数不是已存在的文件时，
    # 才把 --folder 后的值当目录。所以嵌套目录、含扩展名的目录都能正常传。
    folder_override = None
    files = []
    i = 1
    while i < len(argv):
        a = argv[i]
        nxt = argv[i + 1] if i + 1 < len(argv) else None
        if a == "--folder" and nxt and not looks_like_path(nxt):
            folder_override = nxt
            i += 2
        elif a.startswith("--folder=") and not looks_like_path(a):
            folder_override = a.split("=", 1)[1]
            i += 1
        else:
            files.append(a)
            i += 1

    args = [a for a in files if a.strip()]
    if not args:
        raise SystemExit("用法: upload.py [--folder 目录] <图片路径> [更多图片路径...]")



    cfg = load_config()
    domain = (cfg.get("domain") or "").strip().rstrip("/")
    if domain and not domain.startswith("http"):
        domain = "https://" + domain

    folder = resolve_folder(cfg, folder_override)
    if folder:
        cfg["uploadFolder"] = folder
        log("→ 上传目录: %s" % folder)

    out = []
    for p in args:
        p = os.path.abspath(p)
        if not os.path.isfile(p):
            raise SystemExit("找不到文件: %s" % p)
        out.append(upload_one(p, cfg, domain))

    # Typora 只读 stdout，一行一个
    sys.stdout.write("\n".join(out) + "\n")
    sys.stdout.flush()
    return 0



if __name__ == "__main__":
    try:
        sys.exit(main(sys.argv))
    except SystemExit:
        raise
    except Exception as exc:
        # 兜底：Typora 只会把 stderr 弹成一个小框，甩 traceback 进去没人看得懂
        log("上传失败：内部错误 %s: %s" % (type(exc).__name__, exc))
        log("如果域名里带了中文/空格，去掉再试；或直接在命令行跑 upload.py 看完整报错。")
        sys.exit(1)
