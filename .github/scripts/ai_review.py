#!/usr/bin/env python3
"""
ai_review.py — Gemini 程式審查（取代已停止的 Gemini Code Assist GitHub App）

由 .github/workflows/ai-review.yml 在擁有者（含 Claude 代發）留言「/gemini review」時執行。
一律執行 main 上的可信任版本；PR 的修改只透過 GitHub API 當成「資料」讀取，不會被執行。

  /gemini review                         審查整個 PR（相對 base 的全部修改）
  /gemini review <舊SHA>..<新SHA>        只審查這段範圍的修改（後續輪次用）

審查規則取自 main 上的 AGENTS.md（Code Review Rules）。
模型依序嘗試 repo variable AI_REVIEW_MODELS（預設 google:gemini-flash-latest,openrouter:deepseek/deepseek-v4.1-flash），
第一個成功的就採用，留言中會標明實際使用的模型。
結果留言第一行是 <!-- ai-gemini-review:sha=<審查的 head SHA> -->，gh_ai.py 以此判斷「gemini-review」到齊。
"""

import argparse
import os
import re
import sys

import requests

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from ai_council import call  # noqa: E402  共用 API 呼叫與重試

API = "https://api.github.com"
DEFAULT_MODELS = "google:gemini-flash-latest,openrouter:deepseek/deepseek-v4.1-flash"
SKIP_FULL = re.compile(r"(^|/)(package-lock\.json|dist/|.*\.(png|jpe?g|gif|webp|mp3|wav|ico|svg|pdf|woff2?))$")
RANGE_RE = re.compile(r"\b([0-9a-f]{7,40})\.\.\.?([0-9a-f]{7,40})\b")


def gh(path, accept="application/vnd.github+json"):
    r = requests.get(f"{API}/repos/{os.environ['GITHUB_REPOSITORY']}/{path}",
                     headers={"Authorization": f"Bearer {os.environ['GH_TOKEN']}", "Accept": accept}, timeout=60)
    r.raise_for_status()
    return r.json() if accept.endswith("json") else r.text


def gh_all(path):
    out, page = [], 1
    while True:
        batch = gh(f"{path}?per_page=100&page={page}")
        out += batch
        if len(batch) < 100:
            return out
        page += 1


def build(pr, comment, limit):
    """回傳 (prompt, head_sha, 範圍說明)。"""
    info = gh(f"pulls/{pr}")
    head = info["head"]["sha"]
    m = RANGE_RE.search(comment or "")
    if m:
        diff = gh(f"compare/{m.group(1)}...{m.group(2)}", "application/vnd.github.diff")
        scope = f"只審查 `{m.group(1)[:7]}..{m.group(2)[:7]}` 的修改"
    else:
        diff = gh(f"pulls/{pr}", "application/vnd.github.diff")
        scope = f"整個 PR（相對 `{info['base']['ref']}`）"

    rules = open("AGENTS.md", encoding="utf-8").read() if os.path.isfile("AGENTS.md") else ""
    files = [f for f in gh_all(f"pulls/{pr}/files") if f["status"] != "removed"]
    plans = [f["filename"] for f in files
             if f["filename"].startswith("docs/plans/") and f["filename"].endswith(".md") and "_template" not in f["filename"]]

    head_parts = [
        "# 專案審查規則（AGENTS.md，main 上的版本）", rules,
        f"# PR #{pr}：{info['title']}", info.get("body") or "（無說明）",
    ]
    for p in plans:
        head_parts += [f"# 規劃文件：{p}", gh(f"contents/{p}?ref={head}", "application/vnd.github.raw")]
    head_parts += [f"# 本次審查範圍：{scope}", "```diff", diff[: limit // 2], "```"]
    if len(diff) > limit // 2:
        head_parts.append("（diff 過長，已截斷）")
    text = "\n\n".join(head_parts)

    budget = limit - len(text)
    skipped = []
    for f in files:
        name = f["filename"]
        if name in plans or name.startswith("docs/") or SKIP_FULL.search(name):
            continue
        try:
            body = gh(f"contents/{name}?ref={head}", "application/vnd.github.raw")
        except requests.HTTPError:
            continue
        block = f"\n\n## 修改後的完整檔案：{name}\n```\n{body}\n```"
        if len(block) <= budget:
            text += block
            budget -= len(block)
        else:
            skipped.append(name)
    if skipped:
        text += f"\n\n（因長度上限未附上完整內容：{', '.join(skipped)}）"
    return PROMPT.format(context=text), head, scope


PROMPT = """你是一位非常謹慎的資深程式審查者，負責審查一個 Pull Request。請依照下面 AGENTS.md 的「Code Review Rules」審查。
請用繁體中文回答，只回報真正的問題，不要客套，不要回報純風格問題。

輸出格式：
- 每個問題一段：`🔴 高`／`🟠 中`／`🟡 低` ＋ `檔案:行號` ＋ 問題 ＋ 會出錯的具體情境 ＋ 具體修法
- 依嚴重度由高到低排列；沒有把握的推測請標示「不確定」
- 另外逐條對照規劃文件的驗收條件，說明是否達成（達成／未達成／無法從程式判斷）
- 如果沒有發現問題，第一行寫「✅ 沒有發現問題」，再列出驗收條件對照

{context}"""


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--pr", type=int, required=True)
    p.add_argument("--comment", default="", help="觸發留言內容（用來讀取審查範圍）")
    p.add_argument("--out", required=True)
    p.add_argument("--dry-run", action="store_true", help="只組出內容，不呼叫模型")
    a = p.parse_args()

    limit = int(os.environ.get("AI_REVIEW_MAX_CHARS") or 200_000)
    prompt, head, scope = build(a.pr, a.comment, limit)
    models = [m.strip() for m in (os.environ.get("AI_REVIEW_MODELS") or DEFAULT_MODELS).split(",") if m.strip()]

    if a.dry_run:
        print(f"head={head} scope={scope} prompt={len(prompt)} 字元 models={models}")
        with open(a.out, "w", encoding="utf-8") as f:
            f.write(prompt)
        return

    used, result, errors = None, None, []
    for m in models:
        try:
            result, used = call(m, prompt), m
            break
        except Exception as e:  # noqa: BLE001
            errors.append(f"- `{m}`：{str(e)[:300]}")
            print(f"✗ {m}：{e}", file=sys.stderr)

    out = [f"<!-- ai-gemini-review:sha={head} -->", f"## 🔍 Gemini 程式審查（`{head[:7]}`）",
           f"<sub>範圍：{scope}｜模型：{used or '全部失敗'}</sub>", ""]
    if result:
        if used != models[0]:
            out += [f"⚠️ 主要模型 `{models[0]}` 失敗，改用 `{used}`：", *errors, ""]
        out.append(result[:60_000])
    else:
        out += ["⚠️ 審查失敗：所有模型都呼叫失敗（這不是審查結果）", *errors]
    out += ["", "<sub>以上為 AI 審查意見，僅供參考，由 Claude 逐條裁決。</sub>"]
    with open(a.out, "w", encoding="utf-8") as f:
        f.write("\n".join(out))
    print("完成")


if __name__ == "__main__":
    main()
