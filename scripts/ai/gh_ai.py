#!/usr/bin/env python3
"""
gh_ai.py — Claude 在 Huanux 工作流程中與 GitHub 溝通的工具（只用 REST API）

Claude 的工作環境限制：不支援 GitHub GraphQL 與 Actions API、單一指令最多執行 10 分鐘。
這支工具把所有 GitHub 互動集中在一起，並內建安全規則：
  - Claude 發的留言一律加上「🤖 Claude：」與 <!-- by-claude --> 標記（Claude 使用擁有者的帳號）
  - 讀取時只採信白名單作者：擁有者、github-actions、Codex、Gemini、Netlify
  - 等待一次最多 9 分鐘，回傳目前狀態，由 Claude 決定是否繼續等
  - 等待 verify／guard 時，若發現兩者都被跳過（push 後太快轉正式審查的競態），自動關閉再重開 PR 重新觸發一次

用法：
  python3 scripts/ai/gh_ai.py comment <編號> <檔案> [--ask|--trigger]
                                  以 Claude 身分留言（--ask：委員會質詢；--trigger：呼叫 @codex 或 /gemini review，
                                  指令放最前面。每則只呼叫一位）
  python3 scripts/ai/gh_ai.py label <編號> <標籤>             貼標籤（ai-plan / ai-ask）
  python3 scripts/ai/gh_ai.py feed <編號> [--since ISO時間]     列出白名單作者的留言、審查與行內意見
  python3 scripts/ai/gh_ai.py wait <編號> --need verify,guard,codex,gemini [--sha SHA] [--since ISO時間] [--max-min 9]
                                  等待指定訊號；全部到齊 exit 0，逾時 exit 3（印出缺哪些）
  python3 scripts/ai/gh_ai.py foreign-commits <分支>          列出分支上不是 Claude 寫的 commit（有就 exit 1）
  python3 scripts/ai/gh_ai.py preview <SHA>                    取得 Netlify 預覽網址
  python3 scripts/ai/gh_ai.py now                              印出目前 UTC 時間（給 --since 用）

訊號（--need）：
  verify          PR 驗證留言（<!-- ai-pr:sha=SHA -->），需要 --sha
  guard           防作弊檢查留言（<!-- ai-guard:sha=SHA -->），需要 --sha
  codex-review    Codex 對 --sha 這個版本提交的「正式審查」（階段二用）
  gemini-review   Gemini 程式審查（ai-review.yml，留言第一行 <!-- ai-gemini-review:sha=SHA -->）（階段二用）
  codex           Codex 在 --since 之後的任何留言或審查（規劃階段用）
  gemini          （舊）Gemini 機器人的留言；Gemini Code Assist 已停止，規劃階段改由委員會中的 Gemini Flash 負責
  council         規劃委員會在 --since 之後的結果（plan / ask / error）
  「到齊」只代表有回覆，仍必須讀內容確認不是錯誤訊息（例如額度用完）。
  同一版本的 verify／guard 回報結果互相矛盾（有 ✅ 也有 ❌）時視為可能被偽造：exit 4，必須停下來回報擁有者。

⚠️ AI 不得修改此檔（見 CLAUDE.md）。
"""

import argparse
import json
import os
import subprocess
import sys
import time
from datetime import datetime, timedelta, timezone

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
    # 往前推 2 分鐘，避免本機與 GitHub 時鐘誤差漏掉剛好落在邊界的回覆
    return (datetime.now(timezone.utc) - timedelta(minutes=2)).strftime("%Y-%m-%dT%H:%M:%SZ")


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
        # 機器人對 Claude 留言的表情回應（例如 Codex 的 👀 表示已開始、👍 表示沒問題）
        if c["user"].get("login") == OWNER and CLAUDE_MARK in (c.get("body") or "") and c.get("reactions", {}).get("total_count"):
            for r in api_all(f"issues/comments/{c['id']}/reactions"):
                w = who(r["user"])
                if w in ("Codex", "Gemini") and r["created_at"] >= since:
                    items.append({"kind": "表情", "who": w, "login": r["user"]["login"], "at": r["created_at"],
                                  "body": f"對 Claude 的留言按了 {r['content']}（{c['body'].strip().splitlines()[0][:40]}…）"})
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
    # 標記必須在留言第一行（測試輸出、AI 回覆中出現的標記不算，避免被偽造）
    def first(i):
        return i["body"].lstrip().split("\n", 1)[0]
    if signal == "verify":
        return [i for i in by("Actions") if first(i) == f"<!-- ai-pr:sha={sha} -->"]
    if signal == "guard":
        return [i for i in by("Actions") if first(i) == f"<!-- ai-guard:sha={sha} -->"]
    if signal == "council":
        return [i for i in by("Actions") if first(i).startswith("<!-- ai-council:")]
    if signal in ("codex", "gemini"):
        return by(signal.capitalize())
    if signal == "gemini-review":
        return [i for i in by("Actions") if first(i) == f"<!-- ai-gemini-review:sha={sha} -->"]
    if signal == "codex-review":
        # Codex 沒發現問題時可能只留一般留言而不送正式審查，所以兩者都接受（仍須讀內容確認）
        return [i for i in by("Codex") if (i["kind"] == "審查" and i.get("sha") == sha) or i["kind"] == "留言"]
    raise SystemExit(f"未知的訊號：{signal}")


def verdict(body):
    """回報留言的結果：fail（含 ❌）／pass（含 ✅）／unknown"""
    if "❌" in body:
        return "fail"
    return "pass" if "✅" in body else "unknown"


CHECK_JOBS = {"verify": "verify", "guard": "guard"}  # 訊號 → Actions job 名稱
RETRIGGER_AFTER_SEC = 90


def skipped_checks(n, sha, missing):
    """PR 不是草稿、但 verify／guard 這個版本的執行全部是 skipped／cancelled（沒有執行中或成功的）→ 回傳被跳過的訊號。"""
    names = {CHECK_JOBS[s] for s in missing if s in CHECK_JOBS}
    if not names:
        return []
    runs = api(f"commits/{sha}/check-runs?filter=all&per_page=100").get("check_runs", [])
    out = []
    for s in missing:
        job = CHECK_JOBS.get(s)
        mine = [r for r in runs if r["name"] == job]
        if mine and all(r["status"] == "completed" and r["conclusion"] in ("skipped", "cancelled") for r in mine):
            out.append(s)
    return out


def retrigger(n):
    """關閉再重開 PR（reopened 事件會重新觸發 PR 驗證與防作弊檢查；不需要新的 commit）。"""
    api(f"pulls/{n}", "PATCH", {"state": "closed"})
    time.sleep(3)
    api(f"pulls/{n}", "PATCH", {"state": "open"})


def cmd_wait(a):
    need = [s.strip() for s in a.need.split(",") if s.strip()]
    if {"verify", "guard", "codex-review", "gemini-review"} & set(need) and not a.sha:
        sys.exit("等待 verify / guard / *-review 需要 --sha")
    if {"verify", "guard"} & set(need):
        pr = api(f"pulls/{a.n}")
        if pr.get("draft"):
            print("⛔ PR 仍是草稿：PR 驗證與防作弊檢查只在正式審查狀態執行。請先轉正式審查再等待。")
            sys.exit(3)
        if pr["head"]["sha"] != a.sha:
            print(f"⚠️ PR 目前的版本是 {pr['head']['sha'][:7]}，不是 --sha {a.sha[:7]}；只會等到這個版本的結果。")
    start = time.time()
    deadline = start + min(a.max_min, 9) * 60
    retriggered = False
    while True:
        items, ignored = collect(a.n, a.since)
        status = {s: found(s, items, a.sha) for s in need}
        missing = [s for s, v in status.items() if not v]
        if not missing or time.time() >= deadline:
            break
        if not retriggered and time.time() - start >= RETRIGGER_AFTER_SEC:
            skipped = skipped_checks(a.n, a.sha, missing)
            if skipped:
                print(f"🔁 {', '.join(skipped)} 這個版本被跳過（推送後太快轉正式審查的競態），關閉再重開 PR 重新觸發")
                retrigger(a.n)
                retriggered = True
        time.sleep(POLL_SEC)
    print("=== 狀態：" + "、".join(f"{s}{'✅' if status[s] else '⏳'}" for s in need))
    print()
    show([i for s in need for i in status[s]], ignored)
    # 同一版本有多則回報（例如重跑、草稿切換）本身不奇怪；但結果互相矛盾（有 ✅ 也有 ❌）就可能被偽造
    conflict = []
    for s in ("verify", "guard"):
        res = {verdict(i["body"]) for i in status.get(s, [])}
        if len(status.get(s, [])) > 1 and {"pass", "fail"} <= res:
            conflict.append(s)
    if conflict:
        print(f"⛔ 同一版本的 {', '.join(conflict)} 回報結果互相矛盾，可能被偽造。停止流程並回報擁有者，不要採信任何一則。")
        sys.exit(4)
    if missing:
        print(f"尚未到齊：{', '.join(missing)}（本次已等 {min(a.max_min, 9)} 分鐘，可再執行一次繼續等）")
        sys.exit(3)


def cmd_foreign(a):
    subprocess.run(["git", "fetch", "-q", "origin", "+refs/heads/main:refs/remotes/origin/main"], check=True)
    remote = subprocess.run(["git", "ls-remote", "--heads", "origin", a.branch], capture_output=True, text=True, check=True)
    if remote.stdout.strip():
        subprocess.run(["git", "fetch", "-q", "origin", f"+refs/heads/{a.branch}:refs/remotes/origin/{a.branch}"], check=True)
        ref = f"origin/{a.branch}"
    else:
        print(f"（遠端還沒有分支 {a.branch}，這是第一次推送：檢查本機的 commit）")
        ref = a.branch
    r = subprocess.run(["git", "log", "--format=%h%x09%ae%x09%an%x09%s", f"origin/main..{ref}"],
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
    c.add_argument("--trigger", action="store_true", help="呼叫 @codex 或 /gemini review：指令放最前面")
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
