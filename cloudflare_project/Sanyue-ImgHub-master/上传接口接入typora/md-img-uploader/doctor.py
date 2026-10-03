#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
一键体检：部署前后都能跑，回答「这套东西现在到底是不是好的」。

    python doctor.py

检查项：
  1. Python 解释器可用
  2. 脚本文件齐全
  3. config.json 合法、域名/凭证已填
  4. 连通性：GET /能返回
  5. 认证：token / authCode 至少有一个
  6. 真上传一张2x2 测试图，验证外链可下载（--no-upload 可跳过）

退出码 0 = 全通；非 0 = 有问题，看输出。
"""

import argparse
import io
import json
import os
import ssl
import struct
import sys
import tempfile
import urllib.error
import urllib.request
import zlib

HERE = os.path.dirname(os.path.abspath(__file__))
CONFIG_PATH = os.path.join(HERE, "config.json")
PLACEHOLDER = "你的图床域名"

OK, WARN, BAD = "  [OK]  ", "  [--]  ", "  [XX]  "
_fails = 0


def say(level, msg):
    global _fails
    print(level + msg)
    if level == BAD:
        _fails += 1


def make_png(w=2, h=2):
    raw = b"".join(b"\x00" + bytes([255, 90, 90] * w) for _ in range(h))

    def chunk(t, d):
        c = t + d
        return struct.pack(">I", len(d)) + c + struct.pack(">I", zlib.crc32(c) & 0xFFFFFFFF)

    return (b"\x89PNG\r\n\x1a\n"
            + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(raw))
            + chunk(b"IEND", b""))


def make_png_named(name):
    """同图不同名：专门验中文 / 全角 / emoji 文件名能否正确落链。"""
    tmp = os.path.join(tempfile.gettempdir(), name)
    with open(tmp, "wb") as f:
        f.write(make_png())
    return tmp


def fetch(url, headers=None, timeout=30, data=None):
    req = urllib.request.Request(url, headers=headers or {}, data=data)
    return urllib.request.urlopen(req, timeout=timeout, context=ssl.create_default_context())


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--no-upload", action="store_true", help="跳过真实上传（只做静态检查）")
    args = ap.parse_args()

    print("=" * 62)
    print("Typora 图床自动上传 · 体检")
    print("=" * 62)
    print("目录: %s\n" % HERE)

    # 1 解释器
    say(OK, "Python: %s (%s)" % (sys.executable, sys.version.split()[0]))

    # 2 文件
    for f in ("upload.py", "config.json", "install.py"):
        p = os.path.join(HERE, f)
        say(OK if os.path.isfile(p) else BAD, "文件 %s%s" % (f, "" if os.path.isfile(p) else " 缺失"))

    # 3 配置
    if not os.path.isfile(CONFIG_PATH):
        say(BAD, "读不到 config.json")
        return 1
    try:
        cfg = json.load(io.open(CONFIG_PATH, encoding="utf-8-sig"))
    except ValueError as e:
        say(BAD, "config.json 不是合法 JSON: %s" % e)
        return 1
    say(OK, "config.json 解析成功")

    domain = (cfg.get("domain") or "").strip().rstrip("/")
    if not domain:
        say(BAD, "domain 没填")
        return 1
    if PLACEHOLDER in domain:
        say(BAD, "domain 还是占位符，没改成真实图床地址")
        return 1
    if not domain.startswith("http"):
        domain = "https://" + domain
    say(OK, "图床域名: %s" % domain)

    # 4 连通
    try:
        r = fetch(domain + "/", headers={"User-Agent": "Mozilla/5.0"}, timeout=20)
        say(OK, "站点可达 (HTTP %s, %s)" % (r.status, r.headers.get("content-type")))
    except urllib.error.HTTPError as e:
        say(WARN, "站点返回 HTTP %s（可能正常，首页也可能需要认证）" % e.code)
    except Exception as e:
        say(BAD, "连不上图床: %s" % e)
        return 1

    # 5 认证
    token = (cfg.get("token") or "").strip()
    auth = (cfg.get("authCode") or "").strip()
    if token or auth:
        say(OK, "认证: %s" % ("API Token" if token else "authCode"))
    else:
        say(BAD, "token 和 authCode 都是空的 —— 上传必然 401")
        return 1

    if args.no_upload:
        say(WARN, "已跳过真实上传 (--no-upload)")
    else:
        # 6 真上传（ASCII 文件名）
        tmp = os.path.join(tempfile.gettempdir(), "imgbed_doctor.png")
        with open(tmp, "wb") as f:
            f.write(make_png())
        try:
            out = subprocess_upload(tmp, cfg, domain)
            say(OK, "上传成功 -> %s" % out)
            try:
                d = fetch(out, headers={"User-Agent": "Mozilla/5.0"}, timeout=30).read()
                say(OK, "外链可下载 (%d 字节)" % len(d))
            except Exception as e:
                say(BAD, "外链下载失败: %s" % e)
        except SystemExit as e:
            say(BAD, "上传失败: %s" % e)
        finally:
            if os.path.isfile(tmp):
                os.remove(tmp)

        # 7 中文/emoji 文件名（曾经踩过：返回URL 未编码 → 浏览器 404）
        cn = make_png_named("图床体检_（1）.png")
        try:
            out_cn = subprocess_upload(cn, cfg, domain)
            # URL 的 path 段里若还留着裸中文/全角字符，浏览器请求时就取不到
            path_part = out_cn.split("://", 1)[-1].split("/", 1)[-1]
            has_bare_cjk = any("一" <= ch <= "鿿" or "　" <= ch <= "〿"
                               for ch in path_part)
            has_pct = "%" in path_part
            try:
                fetch(out_cn, headers={"User-Agent": "Mozilla/5.0"}, timeout=30).read()
                say(OK, "中文/全角文件名 -> 外链可下载")
            except Exception as e:
                say(BAD, "中文/全角文件名外链取不到: %s" % e)
            if has_bare_cjk or not has_pct:
                say(BAD, "URL 里的中文没做百分号编码，浏览器会 404（upload.py 被改坏了？）")
            else:
                say(OK, "中文/全角文件名已百分号编码")
        except SystemExit as e:
            say(BAD, "中文/全角文件名上传失败: %s" % e)
        finally:
            if os.path.isfile(cn):
                os.remove(cn)

    print()
    if _fails:
        print("结果: %d 项有问题，见上面 [XX]" % _fails)
        return 1
    print("结果: 全部通过")
    if not args.no_upload:
        print("\n接下来只剩一步 —— 在 Typora 里填命令：")
        print("  偏好设置 → 图像 → 上传服务 → Custom Command → 粘贴：")
        print('  "%s" "%s"' % (sys.executable, os.path.join(HERE, "upload.py")))
    return 0


def subprocess_upload(path, cfg, domain):
    """直接复用 upload.py，避免把上传逻辑抄两份走样。"""
    import subprocess
    cmd = [sys.executable, os.path.join(HERE, "upload.py"), path]
    p = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace")
    if p.returncode != 0:
        last = [l for l in (p.stderr or "").strip().splitlines() if l.strip()]
        raise SystemExit(last[-1] if last else "exit=%d" % p.returncode)
    return (p.stdout or "").strip().splitlines()[-1]


if __name__ == "__main__":
    sys.exit(main())
