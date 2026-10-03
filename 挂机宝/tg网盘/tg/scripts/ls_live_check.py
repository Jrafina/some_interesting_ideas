#!/usr/bin/env python3
"""真机验收 /ls：直接 import 部署好的 app、调 `_reply_ls`，走**真实** Telegram API。

逻辑测试只能证明"代码照假设走"，证明不了"Telegram 真的接受"。这个脚本补上后半截：
日志会打出每条 API 的调用与结果（哪族成功、哪族退回了 document）。

跑完把自己发出去的消息**全部删掉**，不在用户对话里留痕迹。

    ssh_put.py scripts/ls_live_check.py /opt/tgpool/_ls_live.py
    ssh_run.py "cd /opt/tgpool && set -a && . ./tgpool.env && set +a && \
      TG_BOT_POLL=0 APP_DIR=/opt/tgpool/app /opt/tgpool/venv/bin/python _ls_live.py /收件箱 /鹿岛初雪"
    ssh_run.py "rm -f /opt/tgpool/_ls_live.py; rm -rf /opt/tgpool/__pycache__ /opt/tgpool/app/__pycache__ /opt/tgpool/tools/__pycache__"

⚠️ 坑：**多个路径要在同一个事件循环里跑完**。每调一次 `asyncio.run()` 就会关掉
app 里那个模块级 httpx client 绑定的 loop，第二次起会报
`RuntimeError: Event loop is closed` —— 这不是 app 的 bug，是脚本写法问题。
"""
import asyncio
import os
import sys

sys.path.insert(0, os.environ.get("APP_DIR", "/opt/tgpool/app"))
os.environ["TG_BOT_POLL"] = "0"
import app as A      # noqa: E402

PATHS = sys.argv[1:] or ["/"]
CHAT = int(A.CHAT_ID)
REAL = A._tg
CREATED = []


async def spy(method, **params):
    r = await REAL(method, **params)
    ok = r.get("ok")
    detail = ""
    if ok:
        res = r["result"]
        for m in (res if isinstance(res, list) else [res]):
            if isinstance(m, dict) and m.get("message_id"):
                CREATED.append(m["message_id"])
        if method == "sendMediaGroup":
            detail = "  " + str([i["type"] for i in params["media"]])
        elif method == "sendMessage":                      # 把清单原文打出来方便肉眼对
            detail = "\n" + "\n".join("      | " + x for x in params.get("text", "").splitlines())
    else:
        detail = "  " + str(r.get("description"))[:110]
    print(f"    {method:<16} {'OK' if ok else 'FAIL'}{detail}")
    return r


async def main():
    A._tg = spy
    for path in PATHS:
        print(f"=== /ls {path} ===")
        await A._reply_ls(CHAT, path)
        print()
    print(f"清理 {len(CREATED)} 条消息 ...")
    for mid in CREATED:
        await REAL("deleteMessage", chat_id=CHAT, message_id=mid)
    print("done")


asyncio.run(main())
