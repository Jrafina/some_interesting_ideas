#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
读出Typora 当前实际生效的上传设置（只看，不改）。

    python typora_config.py

Typora 的偏好设置存在 %APPDATA%\\Typora\\user.conf（首次打开偏好设置后才生成）。
本脚本解析它，把「插入图片时的动作」和「上传服务设定」这两项显示出来，
并判断我们配的Custom Command 是否还在。

能干什么：
  - 确认上传服务到底选的是哪一项（很多人「验证成功」但其实选错了服务）
  - 确认命令里引用的python.exe / upload.py 路径是否还存在（换机后必查）
  - 确认主题设置没被影响（上传服务与主题是独立的）
"""

import io
import json
import os
import re
import sys


def roaming_dir():
    """拿 %APPDATA%。

    别只信 os.environ['APPDATA']：在某些 shell 桥（Git Bash / MSYS）下它可能是
    空的或被改成 POSIX 形式，导致拼出C:\\Users\\<你>\\Typora 这种错路径。
    用 LOCALAPPDATA 推算是可靠回退（Roaming 就在 Local 旁边）。
    """
    for k in ("APPDATA", "APPDATA_ROAMING"):
        v = os.environ.get(k)
        if v and "\\" in v and os.path.isdir(v):
            return v
    local = os.environ.get("LOCALAPPDATA")
    if local and os.path.isdir(local):
        cand = os.path.join(os.path.dirname(local), "Roaming")
        if os.path.isdir(cand):
            return cand
    return os.path.join(os.path.expanduser("~"), "AppData", "Roaming")


CONF = os.path.join(roaming_dir(), "Typora", "user.conf")


def main():
    print("Typora 配置文件: %s" % CONF)
    if not os.path.isfile(CONF):
        print()
        print("[XX] 文件不存在。")
        print("     Typora 首次打开「偏好设置」后才会生成这个文件。")
        print("     请先打开 Typora → 文件 → 偏好设置，看一眼「图像」页，保存即可。")
        return 1

    print()
    with io.open(CONF, encoding="utf-8") as f:
        raw = f.read()
    print("[OK] 文件存在，%d 字节" % len(raw))

    # user.conf 是 JSON5 风格（可能有尾逗号、无引号键），容错解析
    data = {}
    try:
        data = json.loads(raw)
    except ValueError:
        try:
            data = json.loads(re.sub(r",\s*([}\]])", r"\1", raw))
        except ValueError:
            # 退化成正则：只挑我们关心的几个键
            print("[--] 完整解析失败（JSON5 语法），改用正则抽取关心的键")
            for k in ("imageUploadInsert", "uploadService", "imageUploader"):
                m = re.search(r'"?%s"?\s*:\s*("(?:[^"]*)"|[^,}\n]+)' % k, raw)
                if m:
                    data[k] = m.group(1).strip().strip('"')
            if not data:
                print("[XX] 连正则都没抽到东西，文件可能不是预期的配置")
                return 1

    # Typora 的键名在不同版本里不一样，尽量都找一遍
    def pick(*names):
        for n in names:
            if n in data and data[n] not in (None, ""):
                return n, data[n]
        return None, None

    print()
    print("-" * 58)
    k, v = pick("imageUploadInsert", "image.insert", "imageInsertAction")
    print("插入图片时的动作: %s = %r" % (k, v) if k else "插入图片时的动作: （未在配置里找到）")
    if v is not None and "upload" not in str(v).lower():
        print("     ⚠️  可能不是「上传图片」。要自动上传，这里必须是 upload 类的值。")

    k, v = pick("uploadService", "imageUploader", "upload.service", "uploader")
    print("上传服务设定:      %s = %r" % (k, v) if k else "上传服务设定:      （未在配置里找到）")
    if v is not None and "custom" not in str(v).lower():
        print("     ⚠️  期望是 Custom Command（自定义命令）。若显示 PicGo 等，改成 Custom。")

    k, v = pick("uploadCommand", "imageUploadCommand", "upload.command", "customCommand")
    print()
    print("上传命令:          %s" % (k or "(键名未知)"))
    if v:
        print("     %s" % v)
        # 解析命令里的两个路径，逐个检查还在不在
        for p in re.findall(r'"([^"]+)"', str(v)):
            print()
            if p.lower().endswith(".exe") or "python" in os.path.basename(p).lower():
                kind = "解释器"
            else:
                kind = "脚本"
            exists = os.path.isfile(p)
            print("     %s %s" % (kind, p))
            print("       %s" % ("存在 ✔" if exists else "不存在 ✘  <- 这就是失效原因"))
    else:
        print("     （配置里没读到命令，可能键名不同，或还没设置过）")

    k, v = pick("theme", "themes", "theme.name")
    print()
    print("主题设置:          %s = %r" % (k, v) if k else "主题设置:          （未读到）")
    print("     ↑ 上传服务与主题是独立配置，改上传服务不会影响主题。")

    print()
    print("-" * 58)
    print("提示：命令里路径务必带双引号；很多机器的用户目录含空格。")
    print("命令行里没引号会被拆成两段，Typora 就会没反应。")
    return 0


if __name__ == "__main__":
    sys.exit(main())
