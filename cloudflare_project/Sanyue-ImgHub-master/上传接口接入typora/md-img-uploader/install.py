#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
部署 / 重装 Typora 图床自动上传。

    python install.py            # 体检 + 打印要粘的命令（不改任何东西）
    python install.py --print     # 同上
    python install.py --test      # 顺便真传一张图验证

它做什么：确认这套东西能用，并生成 Typora Custom Command 那行命令。
它不做什么：不碰 Typora 的配置文件（那个只能在GUI 里点，且配置文件
`%APPDATA%\\Typora\\user.conf` 首次打开偏好设置后才生成）。

—— 为什么不能全自动改Typora 配置：
   1. user.conf 是 JSON5-ish，Typora 用自己的解析器读，写坏了容易整份丢设置；
   2. 上传命令要在 GUI 下拉框里选「Custom Command」才生效，纯改文件不一定会被识别；
   3. 这一步只做一次，30 秒的事，省这个自动化不划算。
     真要省，也建议你自己在 GUI 里点一次 —— 万一填错了当场就能发现。
"""

import io
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
SELF = os.path.join(HERE, "upload.py")


def check_files():
    missing = [f for f in ("upload.py", "config.json", "doctor.py")
               if not os.path.isfile(os.path.join(HERE, f))]
    if missing:
        print("[XX] 缺文件: %s" % ", ".join(missing))
        print("     当前目录 %s 看起来不是完整交付目录。" % HERE)
        return False
    return True


def show_command():
    """打印要粘进 Typora 的命令，并顺带做语法自检。

    命令用 `sys.executable` —— 也就是当前跑本脚本的解释器。换机器后
    解释器路径会变，所以别硬编码，每次都重新生成。
    """
    cmd = '"%s" "%s"' % (sys.executable, SELF)
    print()
    print("=" * 66)
    print("  在 Typora 里填这一行")
    print("=" * 66)
    print()
    print("  位置：文件 → 偏好设置 → 图像 → 上传服务 → 下拉选 Custom Command")
    print("  然后把下面整行粘到「命令」输入框：")
    print()
    print("  " + cmd)
    print()
    print("  解释器：%s" % sys.executable)
    print("  上传脚本：%s" % SELF)
    print()
    print("  注意：命令末尾不要加参数，Typora 会自己追加图片路径。")
    print("  路径务必带双引号，很多机器的用户目录含空格。")
    print("  填完点「验证图片上传选项」。")
    print()

    # 语法自检：别等填进 Typora 才发现脚本有语法错
    import py_compile
    try:
        py_compile.compile(SELF, doraise=True)
        print("  [OK] upload.py 语法检查通过")
    except py_compile.PyCompileError as e:
        print("  [XX] upload.py 有语法错误: %s" % e)
        return None
    print()
    return cmd


def warn_config():
    p = os.path.join(HERE, "config.json")
    try:
        cfg = __import__("json").load(io.open(p, encoding="utf-8-sig"))
    except Exception:
        print("[XX] config.json 读不出来，先修好它")
        return False
    problems = []
    if not (cfg.get("domain") or "").strip():
        problems.append("domain 没填")
    elif "你的图床域名" in cfg["domain"]:
        problems.append("domain 还是占位符")
    if not (cfg.get("token") or "").strip() and not (cfg.get("authCode") or "").strip():
        problems.append("token 和 authCode 都是空的（会上传 401）")
    if problems:
        print("[XX] config.json 还没填好: %s" % "; ".join(problems))
        return False
    return True


def main(argv):
    print("Typora 图床自动上传 · 部署检查")
    print("目录: %s" % HERE)
    print()

    if not check_files():
        return 1
    print("[OK] 文件齐全")
    if not warn_config():
        return 1
    print("[OK] config.json 已配置")

    if "--test" in argv:
        print()
        print("→ 真实上传测试...")
        import subprocess
        p = subprocess.run([sys.executable, os.path.join(HERE, "doctor.py")],
                           capture_output=True, text=True, encoding="utf-8", errors="replace")
        sys.stdout.write(p.stdout or "")
        if p.returncode != 0:
            sys.stderr.write(p.stderr or "")
            return p.returncode

    show_command()
    print("更详细的恢复/换机说明见同目录的 部署说明.md")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
