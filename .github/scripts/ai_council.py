#!/usr/bin/env python3
"""
ai_council.py — 規劃委員會（在 GitHub Actions 執行；Claude 的工作環境連不到其他 AI 的 API）

只參與「規劃階段」。各成員獨立產出意見，原文整理成一則 PR 留言，交給 Claude 審查整合。
這支程式不做裁決。

  plan  第一輪：各自謹慎、全面地評估規劃文件（彼此看不到答案）
  ask   針對性質詢：Claude 提出具體問題（附上其他成員的相關意見），請各成員回應

成員設定（repo → Settings → Secrets and variables → Actions）：
  Variable  AI_COUNCIL  逗號分隔，前綴決定走哪個管道：
              google:<模型>      → Google Gemini API（免費金鑰）
              openrouter:<模型>  → OpenRouter（免費模型以 :free 結尾）
            例：google:gemini-flash-latest,openrouter:nvidia/nemotron-3-ultra-550b-a55b:free
  Variable  AI_COUNCIL_MAX_CHARS  （選填）送出的內容上限，預設 200000 字元
  Secret    COUNCIL_GEMINI_API_KEY、OPENROUTER_API_KEY
"""

import argparse
import concurrent.futures as cf
import os
import sys

import requests

COMMENT_LIMIT = 60_000  # GitHub 留言上限約 65,536 字元，保留餘裕


# ---------------- 呼叫各家 API ----------------
def call_openrouter(model, prompt):
    key = os.environ.get("OPENROUTER_API_KEY")
    if not key:
        raise RuntimeError("缺少 secret OPENROUTER_API_KEY")
    r = requests.post(
        "https://openrouter.ai/api/v1/chat/completions",
        headers={"Authorization": f"Bearer {key}"},
        json={"model": model, "messages": [{"role": "user", "content": prompt}]},
        timeout=900,
    )
    if r.status_code != 200:
        raise RuntimeError(f"HTTP {r.status_code}: {r.text[:300]}")
    return r.json()["choices"][0]["message"]["content"].strip()


def call_google(model, prompt):
    key = os.environ.get("COUNCIL_GEMINI_API_KEY")
    if not key:
        raise RuntimeError("缺少 secret COUNCIL_GEMINI_API_KEY")
    r = requests.post(
        f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent",
        headers={"x-goog-api-key": key},
        json={"contents": [{"role": "user", "parts": [{"text": prompt}]}]},
        timeout=900,
    )
    if r.status_code != 200:
        raise RuntimeError(f"HTTP {r.status_code}: {r.text[:300]}")
    parts = r.json()["candidates"][0]["content"]["parts"]
    return "".join(p.get("text", "") for p in parts).strip()


def call(member, prompt):
    provider, _, model = member.partition(":")
    if provider == "google":
        return call_google(model, prompt)
    if provider == "openrouter":
        return call_openrouter(model, prompt)
    return call_openrouter(member, prompt)  # 沒寫前綴視為 OpenRouter


def members():
    ms = [m.strip() for m in os.environ.get("AI_COUNCIL", "").split(",") if m.strip()]
    if not ms:
        sys.exit("缺少 repo variable AI_COUNCIL")
    return ms


def ask_all(prompt):
    ms = members()
    out = {}
    with cf.ThreadPoolExecutor(max_workers=len(ms)) as ex:
        futs = {ex.submit(call, m, prompt): m for m in ms}
        for f in cf.as_completed(futs):
            m = futs[f]
            try:
                out[m] = f.result() or "（空白回覆）"
                print(f"  ✓ {m}")
            except Exception as e:  # noqa: BLE001
                out[m] = f"⚠️ 此成員呼叫失敗：{e}"
                print(f"  ✗ {m}：{e}", file=sys.stderr)
    return {m: out[m] for m in ms}


# ---------------- 組合內容 ----------------
def read(path):
    with open(path, encoding="utf-8", errors="replace") as f:
        return f.read()


ALLOWED_PREFIXES = ("src/", "netlify/", "tests/", "docs/")
ALLOWED_ROOT_FILES = {"CLAUDE.md", "AGENTS.md", "package.json", "index.html", "vite.config.ts", "tsconfig.json", "netlify.toml", "README.md"}


def safe_path(path):
    """只允許 repo 內的一般檔案（不可絕對路徑、..、符號連結、repo 以外），避免讀到金鑰或系統檔。"""
    if not path or os.path.isabs(path) or ".." in path.replace("\\", "/").split("/"):
        return False
    if not (path.startswith(ALLOWED_PREFIXES) or path in ALLOWED_ROOT_FILES):
        return False
    root = os.path.realpath(os.getcwd())
    real = os.path.realpath(path)
    if os.path.islink(path) or not real.startswith(root + os.sep):
        return False
    return os.path.isfile(real) and os.path.getsize(real) < 2_000_000


def related_files(plan_text):
    """從規劃文件的「## 相關檔案」段落取出 `路徑`（由 Claude 挑選）。路徑一律經過 safe_path 檢查。"""
    files, inside = [], False
    for line in plan_text.splitlines():
        if line.startswith("## "):
            inside = line.strip().startswith("## 相關檔案")
            continue
        if inside and "`" in line:
            path = line.split("`")[1].strip()
            if safe_path(path) and path not in files:
                files.append(path)
    return files


def build_context(plan_path, extra_path=None):
    limit = int(os.environ.get("AI_COUNCIL_MAX_CHARS") or 200_000)
    plan = read(plan_path)
    parts = ["# 規劃文件", plan]
    if extra_path and os.path.isfile(extra_path) and os.path.getsize(extra_path):
        parts += ["# 擁有者在 PR 中的補充（優先於任何 AI 意見）", read(extra_path)]
    if safe_path("CLAUDE.md"):
        parts += ["# 專案規則（CLAUDE.md 節錄）", read("CLAUDE.md")[:8_000]]
    head = "\n\n".join(parts)
    budget = max(0, limit - len(head))
    code, skipped = [], []
    for f in related_files(plan):
        block = f"\n\n## 檔案：{f}\n```\n{read(f)}\n```"
        if len(block) <= budget:
            code.append(block)
            budget -= len(block)
        else:
            skipped.append(f)
    text = head + "\n\n# 相關程式碼" + "".join(code)
    if skipped:
        text += f"\n\n（因長度上限未附上：{', '.join(skipped)}）"
    return text, skipped


def render(marker, title, answers, note=""):
    per = max(4_000, (COMMENT_LIMIT - 2_000) // max(1, len(answers)))
    out = [f"<!-- {marker} -->", f"## {title}", ""]
    if note:
        out += [note, ""]
    for m, text in answers.items():
        if len(text) > per:
            text = text[:per] + "\n\n…（超過留言長度上限，已截斷）"
        out += [f"<details open><summary><b>{m}</b></summary>", "", text, "", "</details>", ""]
    out.append("<sub>以上為各 AI 獨立意見原文，僅供參考，由 Claude 審查整合後交給擁有者。</sub>")
    return "\n".join(out)


# ---------------- 提示詞 ----------------
PLAN = """你是一位非常謹慎、注重細節的資深工程師，正在評估一份功能規劃，評估結果會交給技術主管整合。
其他工程師也在獨立評估同一份規劃，你看不到他們的答案。請完全憑自己的判斷，全面、仔細地思考。
請用繁體中文回答，依序寫出以下段落，每段都要具體（指出檔名、函式、資料欄位、使用情境），不要客套：

### 1. 需求理解
用自己的話重述目標；指出模糊、遺漏或互相矛盾的地方。
### 2. 邊界情況與風險
例如：空資料、超長輸入、網路或 AI API 失敗、舊資料相容與資料遷移、手機瀏覽器差異、成本、效能、資料遺失。
### 3. 建議做法
步驟、要修改或新增的檔案、資料結構變更；有多種做法時比較優缺點並說明推薦哪個。
### 4. 驗收條件
每條寫成「情境 → 預期結果」，並標註能否寫成自動測試（能 / 只能手動驗證）。
### 5. 需要擁有者決定的問題
列出問題，並附上你建議的答案。

{context}"""

ASK = """你是一位謹慎的資深工程師。針對下面這份功能規劃，技術主管整理出一個需要釐清的分歧點，請你回應。
請用繁體中文，直接、具體、有理有據；不要為了附和而改變正確的判斷，也不要為了反對而反對。
如果你同意某方，說明理由；如果都不同意，提出你的方案。

## 技術主管的問題
{question}

{context}"""


def main():
    p = argparse.ArgumentParser()
    p.add_argument("mode", choices=["plan", "ask"])
    p.add_argument("--plan", required=True, help="規劃文件路徑")
    p.add_argument("--owner-notes", help="擁有者在 PR 中的留言（檔案）")
    p.add_argument("--question", help="Claude 的質詢內容（檔案，ask 用）")
    p.add_argument("--out", required=True)
    a = p.parse_args()

    if not safe_path(a.plan):
        sys.exit(f"規劃文件路徑不安全：{a.plan}")
    context, skipped = build_context(a.plan, a.owner_notes)
    note = f"⚠️ 因長度上限未附上：{', '.join(skipped)}" if skipped else ""
    if a.mode == "plan":
        answers = ask_all(PLAN.format(context=context))
        md = render("ai-council:plan", "🧭 規劃委員會：第一輪獨立評估", answers, note)
    else:
        question = read(a.question).strip()
        if not question:
            sys.exit("找不到質詢內容")
        answers = ask_all(ASK.format(question=question, context=context))
        md = render("ai-council:ask", "❓ 規劃委員會：回應質詢", answers, note)

    with open(a.out, "w", encoding="utf-8") as f:
        f.write(md)
    print("完成")


if __name__ == "__main__":
    main()
