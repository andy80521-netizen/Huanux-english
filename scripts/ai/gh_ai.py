#!/usr/bin/env python3
"""
gh_ai.py — Claude 在 Huanux 工作流程中與 GitHub 溝通的工具（只用 REST API）

Claude 的工作環境限制：不支援 GitHub GraphQL 與 Actions API、單一指令最多執行 10 分鐘。
這支工具把所有 GitHub 互動集中在一起，並內建安全規則：
  - Claude 發的留言一律加上「🤖 Claude：」與 <!-- by-claude --> 標記（Claude 使用擁有者的帳號）
  - 讀取時只採信白名單作者：擁有者、github-actions、Codex、Gemini Code Assist、Netlify
  - 等待一次最多 9 分鐘，回傳目前狀態，由 Claude 決定是否繼續等

用法：
  python3 scripts/ai/gh_ai.py comment <編號> <檔案> [--ask|--trigger]
                                  以 Claude 身分留言（--ask：委員會質詢；--trigger：呼叫 @codex 或 /gemini，
                                  指令放最前面。每則只呼叫一位）
  python3 scripts/ai/gh_ai.py label <編號> <標籤>             貼標籤（ai-plan / ai-ask）
  python3 scripts/ai/gh_ai.py feed <編號> [--since ISO時間]     列出白名單作者的留言、審查與行內意見
  python3 scripts/ai/gh_ai.py wait <編號> --need verify,guard,codex,gemini [--sha SHA] [--since ISO時間] [--max-min 9]
                                  等待指定訊號；全部到齊 exit 0，逾時 exit 3（印出缺哪些）
  python3 scripts/ai/gh_ai.py foreign-commits <分支>          列出分支上不是 Claude 寫的 commit（有就 exit 1）
  python3 scripts/ai/gh_ai.py preview <SHA>                    取得 Netlify 預覽網址
  python3 scripts/ai/gh_ai.py now                              印出目前 UTC 時間（給 --since 用）

訊號（--need）：
  verify   PR 驗證留言（<!-- ai-pr:sha=SHA -->）
  guard    防作弊檢查留言（<!-- ai-guard:sha=SHA -->）
  codex    Codex 在 --since 之後的審查或留言
  gemini   Gemini Code Assist 在 --since 之後的審查或留言
  council  規劃委員會在 --since 之後的結果（plan / ask / error）

⚠️ AI 不得修改此檔（見 CLAUDE.md）。
"""

import argparse
import json
import os
import subprocess
import sys
import time
from datetime import datetime, timezone

REPO = os.environ.get("GITHUB_REPO", "andy80521-netizen/huanux-english")
OWNER = REPO.split("/")[0]
CLAUDE_MARK = "<!-- by-claude -->"
ASK_MARK = "<!-- claude:ask -->"
CLAUDE_EMAIL = "noreply@anthropic.com"
POLL_SEC = 30


# ---------------- GitHub REST ----------------
def api(path, method="GET", fields=None):
    cmd = ["gh", "api", "-X", method, f"repos/{REPO}/{path}"]
    for k, v in (fields or {}).items():
        cmd += ["-f", f"{k}={v}"]
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0:
        raise RuntimeError(f"gh api {path} 失敗：{r.stderr.strip()[:300]}")
    return json.loads(r.stdout) if r.stdout.strip() else None


def api_all(path):
    out, page = [], 1
    sep = "&" if "?" in path else "?"
    while True:
        batch = api(f"{path}{sep}per_page=100&page={page}")
        out += batch
        if len(batch) < 100:
            return out
        page += 1


def now_iso():
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


# ---------------- 作者分類（白名單） ----------------
def who(user, body=""):
    login, kind = user.get("login", ""), user.get("type", "")
    low = login.lower()
    if login == OWNER:
        return "Claude" if CLAUDE_MARK in (body or "") else "擁有者"
    if kind == "Bot":
        if low == "github-actions[bot]":
            return "Actions"
        if "codex" in low:
            return "Codex"
        if "gemini" in low:
            return "Gemini"
        if "netlify" in low:
            return "Netlify"
    return None  # 不在白名單：忽略


def collect(n, since="1970-01-01T00:00:00Z"):
    """回傳 (items, ignored)。items 依時間排序；PR 的審查與行內意見一併收集。"""
    items, ignored = [], set()

    def add(kind, user, body, at, extra=None):
        w = who(user, body)
        if not w:
            ignored.add(user.get("login", "?"))
            return
        if at and at >= since:
            items.append({"kind": kind, "who": w, "login": user.get("login"), "at": at,
                          "body": body or "", **(extra or {})})

    for c in api_all(f"issues/{n}/comments"):
        add("留言", c["user"], c["body"], c["created_at"])
    try:
        for r in api_all(f"pulls/{n}/reviews"):
            add("審查", r["user"], r.get("body"), r.get("submitted_at"),
                {"state": r.get("state"), "sha": r.get("commit_id")})
        for c in api_all(f"pulls/{n}/comments"):
            add("行內", c["user"], c["body"], c["created_at"],
                {"path": c.get("path"), "line": c.get("line") or c.get("original_line"), "sha": c.get("commit_id")})
    except RuntimeError:
        pass  # 不是 PR（是 issue）
    items.sort(key=lambda x: x["at"])
    return items, ignored


def show(items, ignored):
    for it in items:
        head = f"── [{it['at']}] {it['who']}（{it['kind']}"
        if it.get("state"):
            head += f"／{it['state']}"
        if it.get("path"):
            head += f"／{it['path']}:{it.get('line')}"
        if it.get("sha"):
            head += f"／{it['sha'][:7]}"
        print(head + "）")
        print(it["body"].strip() or "（無內文）")
        print()
    if ignored:
        print(f"（已忽略非白名單作者：{', '.join(sorted(ignored))}。若其中有審查機器人，請回報擁有者。）")


# ---------------- 指令 ----------------
def cmd_comment(a):
    text = open(a.file, encoding="utf-8").read().strip()
    marks = CLAUDE_MARK + (ASK_MARK if a.ask else "")
    if a.trigger:
        # 呼叫 @codex、/gemini 時，指令必須在留言最前面；簽名與標記放最後
        body = f"{text}\n\n<sub>🤖 由 Claude 代發</sub>\n{marks}"
    else:
        body = f"{marks}\n🤖 **Claude：**\n\n{text}"
    r = api(f"issues/{a.n}/comments", "POST", {"body": body})
    print(r["html_url"])


def cmd_label(a):
    api(f"issues/{a.n}/labels", "POST", {"labels[]": a.label})
    print(f"已貼上標籤 {a.label}")


def cmd_feed(a):
    show(*collect(a.n, a.since))


def found(signal, items, sha):
    def by(w):
        return [i for i in items if i["who"] == w]
    if signal == "verify":
        return [i for i in by("Actions") if f"<!-- ai-pr:sha={sha} -->" in i["body"]]
    if signal == "guard":
        return [i for i in by("Actions") if f"<!-- ai-guard:sha={sha} -->" in i["body"]]
    if signal == "council":
        return [i for i in by("Actions") if "<!-- ai-council:" in i["body"]]
    if signal in ("codex", "gemini"):
        return by(signal.capitalize())
    raise SystemExit(f"未知的訊號：{signal}")


def cmd_wait(a):
    need = [s.strip() for s in a.need.split(",") if s.strip()]
    if {"verify", "guard"} & set(need) and not a.sha:
        sys.exit("等待 verify / guard 需要 --sha")
    deadline = time.time() + min(a.max_min, 9) * 60
    while True:
        items, ignored = collect(a.n, a.since)
        status = {s: found(s, items, a.sha) for s in need}
        missing = [s for s, v in status.items() if not v]
        if not missing or time.time() >= deadline:
            break
        time.sleep(POLL_SEC)
    print("=== 狀態：" + "、".join(f"{s}{'✅' if status[s] else '⏳'}" for s in need))
    print()
    show([i for s in need for i in status[s]], ignored)
    if missing:
        print(f"尚未到齊：{', '.join(missing)}（本次已等 {min(a.max_min, 9)} 分鐘，可再執行一次繼續等）")
        sys.exit(3)


def cmd_foreign(a):
    subprocess.run(["git", "fetch", "-q", "origin", f"+refs/heads/{a.branch}:refs/remotes/origin/{a.branch}",
                    "+refs/heads/main:refs/remotes/origin/main"], check=True)
    r = subprocess.run(["git", "log", "--format=%h%x09%ae%x09%an%x09%s", f"origin/main..origin/{a.branch}"],
                       capture_output=True, text=True, check=True)
    foreign = [l for l in r.stdout.splitlines() if l.split("\t")[1] != CLAUDE_EMAIL]
    if foreign:
        print("⚠️ 分支上有不是 Claude 寫的 commit，請停下來回報擁有者，不要覆蓋：")
        for l in foreign:
            h, email, name, subj = l.split("\t", 3)
            print(f"  {h}  {name} <{email}>  {subj}")
        sys.exit(1)
    print("✅ 分支上的 commit 都是 Claude 寫的")


def cmd_preview(a):
    st = api(f"commits/{a.sha}/status")
    urls = [s["target_url"] for s in st.get("statuses", []) if "deploy-preview" in s.get("context", "")]
    print(urls[0] if urls else "（還沒有預覽網址，Netlify 可能仍在部署）")


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest="cmd", required=True)
    c = sub.add_parser("comment"); c.add_argument("n", type=int); c.add_argument("file"); c.add_argument("--ask", action="store_true")
    c.add_argument("--trigger", action="store_true", help="呼叫 @codex 或 /gemini：指令放最前面")
    l = sub.add_parser("label"); l.add_argument("n", type=int); l.add_argument("label")
    f = sub.add_parser("feed"); f.add_argument("n", type=int); f.add_argument("--since", default="1970-01-01T00:00:00Z")
    w = sub.add_parser("wait"); w.add_argument("n", type=int); w.add_argument("--need", required=True)
    w.add_argument("--sha"); w.add_argument("--since", default="1970-01-01T00:00:00Z"); w.add_argument("--max-min", type=int, default=9)
    fc = sub.add_parser("foreign-commits"); fc.add_argument("branch")
    pv = sub.add_parser("preview"); pv.add_argument("sha")
    sub.add_parser("now")
    a = p.parse_args()
    {"comment": cmd_comment, "label": cmd_label, "feed": cmd_feed, "wait": cmd_wait,
     "foreign-commits": cmd_foreign, "preview": cmd_preview, "now": lambda _: print(now_iso())}[a.cmd](a)


if __name__ == "__main__":
    main()
