# -*- coding: utf-8 -*-
"""encode_url_path 的边界测试。单独跑，避免 shell 字符串转义干扰。"""
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from upload import encode_url_path as e

CASES = [
    # (输入, 期望, 说明)
    ("https://a.b/file/x.png", "https://a.b/file/x.png", "纯 ASCII 恒等"),
    ("https://a.b/file/1_2-3_4.png", "https://a.b/file/1_2-3_4.png", "常见命名恒等"),
    ("https://a.b/a b.png", "https://a.b/a%20b.png", "空格"),
    ("https://a.b/中文.png", "https://a.b/%E4%B8%AD%E6%96%87.png", "中文"),
    ("https://a.b/（1）.png", "https://a.b/%EF%BC%881%EF%BC%89.png", "全角括号"),
    ("https://a.b/💩.png", "https://a.b/%F0%9F%92%A9.png", "emoji（4字节 UTF-8）"),
    ("https://a.b/p?x=1&y=2", "https://a.b/p?x=1&y=2", "query 不被编码"),
    ("https://a.b/p#f", "https://a.b/p#f", "fragment 不被编码"),
    ("https://a.b/%E4%B8%AD.png", "https://a.b/%E4%B8%AD.png", "已转义不被二次编码"),
    ("https://a.b/100%.png", "https://a.b/100%.png", "孤立百分号按字面量保留"),
]


def main():
    bad = 0
    for src, want, desc in CASES:
        got = e(src)
        ok = (got == want)
        if not ok:
            bad += 1
        print("  %-4s %-34s -> %s" % ("OK" if ok else "FAIL", desc, got))
        if not ok:
            print("       期望: %s" % want)

    # 幂等：已编码的再编码一次必须不变（否则重复调用会把 % 变成 %25）
    idem = all(e(e(s)) == e(s) for s, _, _ in CASES)
    print()
    print("  幂等性(encode 两次 == encode 一次): %s" % ("OK" if idem else "FAIL"))
    if not idem:
        bad += 1

    print()
    if bad:
        print("失败 %d 项" % bad)
        return 1
    print("全部通过 (%d 条)" % len(CASES))
    return 0


if __name__ == "__main__":
    sys.exit(main())
