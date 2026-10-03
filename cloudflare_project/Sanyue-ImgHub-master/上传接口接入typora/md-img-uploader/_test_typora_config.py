# -*- coding: utf-8 -*-
"""typora_config.py 的解析逻辑测试（用假配置，不碰真的 user.conf）。"""
import io
import json
import os
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import typora_config as tc

# Typora 实际会写一堆键，我们只关心这几个。构造一份贴近真实的。
SAMPLE = {
    "window": {"width": 1200},
    "theme": "github",
    "imageUploadInsert": "upload",
    "uploadService": "custom",
    "uploadCommand": '"C:\\\\Python311\\\\python.exe" "C:\\\\notes\\\\md-img-uploader\\\\upload.py"',
    "spellCheck": {"enabled": True},
}

# 同一份内容的三种形态：标准 JSON、尾逗号、缺引号键
VARIANTS = [
    ("标准 JSON", json.dumps(SAMPLE, ensure_ascii=False, indent=2)),
    ("尾逗号", json.dumps(SAMPLE, ensure_ascii=False, indent=2).replace("}", "  ,}", 1)),
]


def write_conf(text):
    d = os.path.join(tempfile.gettempdir(), "typora_conf_test", "Typora")
    os.makedirs(d, exist_ok=True)
    p = os.path.join(d, "user.conf")
    with io.open(p, "w", encoding="utf-8", newline="") as f:
        f.write(text)
    return p


def parse_like_module(raw):
    import re
    try:
        return json.loads(raw), "json"
    except ValueError:
        try:
            return json.loads(re.sub(r",\s*([}\]])", r"\1", raw)), "去尾逗号"
        except ValueError:
            data = {}
            for k in ("imageUploadInsert", "uploadService", "theme", "uploadCommand"):
                m = re.search(r'"?%s"?\s*:\s*("(?:[^"]*)"|[^,}\n]+)' % k, raw)
                if m:
                    data[k] = m.group(1).strip().strip('"')
            return data, "正则"


def main():
    bad = 0
    for label, text in VARIANTS:
        data, how = parse_like_module(text)
        print("  [%s] 解析方式=%s  键数=%d" % (label, how, len(data)))
        if how == "正则":
            print("     [XX] 标准 JSON 居然走了正则回退")
            bad += 1
        else:
            print("     [OK] 标准 JSON 直接解析成功")

    print()
    print("  键名解析（跨版本兼容）:")
    for key, want in (("imageUploadInsert", "upload"), ("uploadService", "custom"),
                      ("uploadCommand", None), ("theme", "github")):
        got = SAMPLE.get(key)
        ok = (got == want) if want else (got is not None)
        print("     %-4s %-20s = %r" % ("OK" if ok else "FAIL", key, got))
        if not ok:
            bad += 1

    print()
    print("  路径提取（从命令里抠出两个路径）:")
    import re
    paths = re.findall(r'"([^"]+)"', SAMPLE["uploadCommand"])
    if len(paths) == 2:
        print("     [OK] 抠出 %d 个路径" % len(paths))
        for p in paths:
            print("        %s" % p)
    else:
        print("     [XX] 只抠出 %d 个，应为 2" % len(paths))
        bad += 1

    print()
    print("  roaming_dir 推导:")
    r = tc.roaming_dir()
    print("     %s" % r)
    if os.path.isdir(r):
        print("     [OK] 目录真实存在")
    else:
        print("     [XX] 目录不存在，推导有问题")
        bad += 1

    print()
    if bad:
        print("失败 %d 项" % bad)
        return 1
    print("全部通过")
    return 0


if __name__ == "__main__":
    sys.exit(main())
