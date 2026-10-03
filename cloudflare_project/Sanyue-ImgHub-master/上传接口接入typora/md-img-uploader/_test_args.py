# -*- coding: utf-8 -*-
"""参数解析的边界测试（--folder 与图片路径的消歧）。

单独跑： python _test_args.py
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import upload


def main():
    bad = 0

    # --- 目录值不含分隔符/扩展名：必须被当作目录 ---
    for folder in ("note", "drafts", "临时"):
        if upload.looks_like_path(folder):
            print("  FAIL 目录 %r 被误判成文件" % folder)
            bad += 1
        else:
            print("  OK   目录 %-10r 被正确识别为目录" % folder)

    # --- 带分隔符 / 带点 的目录：也必须能当目录用（不再有NOTE）---
    for folder in ("note/2026", "a/b", "笔记/随笔", "v1.0", "note/{yyyy}"):
        if upload.looks_like_path(folder):
            print("  FAIL 目录 %r 被误判成文件（应能作为 --folder 的值）" % folder)
            bad += 1
        else:
            print("  OK   目录 %-14r 可用作--folder 的值" % folder)

    # --- 关键消歧：真存在但名字长得像目录，必须判为文件 ---
    # （新逻辑只看 os.path.isfile，所以"建出来"才能测；这正是真实场景：
    #   用户有个文件叫 --folder，于是 --folder 后面那个值该当文件）
    here = os.path.dirname(os.path.abspath(__file__))
    tricky = os.path.join(here, "笔记")          # 名字像目录、扩展名像文件
    with open(tricky, "wb") as fh:
        fh.write(b"x")
    for label, s in (("无扩展名", tricky),
                     ("带点", os.path.join(here, "v1.0")),
                     ("带斜杠的真实文件", os.path.join(here, "sub", "x.png"))):
        if label == "带点":
            with open(s, "wb") as fh:
                fh.write(b"x")
        if label == "带斜杠的真实文件":
            os.makedirs(os.path.dirname(s), exist_ok=True)
            with open(s, "wb") as fh:
                fh.write(b"x")
        if not upload.looks_like_path(s):
            print("  FAIL %s %r 被误判成目录" % (label, s))
            bad += 1
        else:
            print("  OK   %-16s 的真实文件被识别为文件" % label)

    # 不存在的同名目录值 -> 判为目录（正常路径）
    if upload.looks_like_path(os.path.join(here, "不存在的目录")):
        print("  FAIL 不存在的路径被误判成文件")
        bad += 1
    else:
        print("  OK   不存在的路径被当作目录值")

    for p in (tricky, os.path.join(here, "v1.0"), os.path.join(here, "sub", "x.png")):
        if os.path.isfile(p):
            os.remove(p)
    sub = os.path.join(here, "sub")
    if os.path.isdir(sub):
        os.rmdir(sub)

    # --- 占位符展开 ---
    cases = [("note/{yyyy}/{mm}", "note/2026/10"), ("{yyyymm}", "202610"),
             ("a/{}", "a/"), ("", "")]
    import datetime
    now = datetime.datetime.now()
    for src, want_prefix in cases:
        got = upload.resolve_folder({"uploadFolder": src}, None)
        exp = (src.replace("{yyyymm}", now.strftime("%Y%m"))
                  .replace("{yyyy}", now.strftime("%Y"))
                  .replace("{yy}", now.strftime("%y"))
                  .replace("{mm}", now.strftime("%m"))
                  .replace("{dd}", now.strftime("%d")).strip("/"))
        ok = got == exp
        if not ok:
            bad += 1
        print("  %-4s 占位符 %-18r -> %r" % ("OK" if ok else "FAIL", src, got))

    # --- 优先级：--folder > 环境变量 > config ---
    os.environ["IMGBED_FOLDER"] = "from_env"
    r = upload.resolve_folder({"uploadFolder": "from_cfg"}, "from_argv")
    print("  %-4s 优先级(--folder > env > config) -> %r" % ("OK" if r == "from_argv" else "FAIL", r))
    if r != "from_argv":
        bad += 1
    r2 = upload.resolve_folder({"uploadFolder": "from_cfg"}, None)
    print("  %-4s 无 --folder 时 env 覆盖 config -> %r" % ("OK" if r2 == "from_env" else "FAIL", r2))
    if r2 != "from_env":
        bad += 1
    del os.environ["IMGBED_FOLDER"]
    r3 = upload.resolve_folder({"uploadFolder": "from_cfg"}, None)
    print("  %-4s 都不给时用 config -> %r" % ("OK" if r3 == "from_cfg" else "FAIL", r3))
    if r3 != "from_cfg":
        bad += 1

    print()
    if bad:
        print("失败 %d 项" % bad)
        return 1
    print("关键项全部通过")
    return 0


if __name__ == "__main__":
    sys.exit(main())
