#!/usr/bin/env python3
"""
ai_council.py — 多 AI 委員會（在 GitHub Actions 執行；Claude 的工作環境連不到其他 AI 的 API）

各 AI「獨立」產出意見，原文整理成一則留言，交給對話中的 Claude 審查整合。
這支程式不做裁決：裁決由掌握完整討論脈絡的 Claude 負責。

  plan   第一輪：各自謹慎、全面地評估需求與規劃（互相看不到）
  cross  第二輪：看過所有人的第一輪意見後，互相挑錯、補充、修正自己的方案
  review PR 審查：各自找漏洞

設定（repo → Settings → Secrets and variables → Actions）：
  Secret    OPENROUTER_API_KEY
  Variable  AI_COUNCIL  逗號分隔的 OpenRouter 模型 ID（例：Gemini、GPT、Grok）
"""

import argparse
import concurrent.futures as cf
import os
import sys

import requests

API = "https://openrouter.ai/api/v1/chat/completions"
COMMENT_LIMIT = 60_000  # GitHub 留言上限約 65,536 字元，保留餘裕


def read(path, limit=None):
    with open(path, encoding="utf-8", errors="replace") as f:
        s = f.read()
    if limit and len(s) > limit:
        s = s[:limit] + f"\n\n…（已截斷，原長 {len(s)} 字元）"
    return s


def members():
    ms = [m.strip() for m in os.environ.get("AI_COUNCIL", "").split(",") if m.strip()]
    if not ms:
        sys.exit("缺少 repo variable AI_COUNCIL")
    if not os.environ.get("OPENROUTER_API_KEY"):
        sys.exit("缺少 repo secret OPENROUTER_API_KEY")
    return ms


def call(model, prompt):
    r = requests.post(
        API,
        headers={"Authorization": f"Bearer {os.environ['OPENROUTER_API_KEY']}"},
        json={"model": model, "messages": [{"role": "user", "content": prompt}]},
        timeout=900,
    )
    r.raise_for_status()
    return r.json()["choices"][0]["message"]["content"].strip()


def ask_all(prompt_for):
    """平行詢問每位成員。prompt_for(model) 回傳該成員的提示詞。失敗的成員記錄錯誤，不影響其他人。"""
    ms = members()
    out = {}
    with cf.ThreadPoolExecutor(max_workers=len(ms)) as ex:
        futs = {ex.submit(call, m, prompt_for(m)): m for m in ms}
        for f in cf.as_completed(futs):
            m = futs[f]
            try:
                out[m] = f.result()
                print(f"  ✓ {m}")
            except Exception as e:  # noqa: BLE001
                out[m] = f"⚠️ 此成員呼叫失敗：{e}"
                print(f"  ✗ {m}：{e}", file=sys.stderr)
    return {m: out[m] for m in ms}  # 固定順序


def render(marker, title, answers, note=""):
    per = max(4_000, (COMMENT_LIMIT - 2_000) // max(1, len(answers)))
    parts = [f"<!-- {marker} -->", f"## {title}", ""]
    if note:
        parts += [note, ""]
    for m, text in answers.items():
        if len(text) > per:
            text = text[:per] + "\n\n…（超過留言長度上限，已截斷）"
        parts += [f"<details open><summary><b>{m}</b></summary>", "", text, "", "</details>", ""]
    parts.append("<sub>以上為各 AI 獨立意見原文，由對話中的 Claude 審查整合後交給擁有者。</sub>")
    return "\n".join(parts)


# ---------------- 提示詞 ----------------
PLAN = """你是一位非常謹慎、注重細節的資深工程師，正在評估一個需求，評估結果會交給技術主管整合。
其他工程師也在獨立評估同一份需求，你看不到他們的答案。請完全憑自己的判斷，全面、仔細地思考。

請用 Markdown 依序回答以下段落，每段都要具體（指出檔名、函式、資料欄位、使用情境），不要客套：

### 1. 需求理解
用自己的話重述目標；指出需求中模糊、遺漏或互相矛盾的地方。
### 2. 邊界情況與風險
例如：空資料、超長輸入、網路或 AI API 失敗、舊資料相容、手機瀏覽器差異、成本、效能、資料遺失。
### 3. 建議做法
步驟、要修改或新增的檔案、資料結構變更。如果有多種做法，比較優缺點並說明你推薦哪個。
### 4. 驗收條件
每條都寫成「情境 → 預期結果」，並標註能否寫成自動測試（能 / 只能手動驗證）。
### 5. 需要擁有者決定的問題
列出你需要擁有者回答才能確定的問題，並附上你建議的答案。

{brief}"""

CROSS = """你先前針對下面的需求做了獨立評估；其他工程師也各自提出了評估。現在請你看過所有人的意見後進行交叉討論：

### 1. 別人說對、而我漏掉的
### 2. 別人的錯誤或過度設計（指名是誰、哪一點、為什麼錯）
### 3. 我修正後的建議做法與驗收條件
### 4. 仍然存在的分歧或需要擁有者決定的問題

要具體、有理有據，不必客氣，也不要為了附和而改變正確的判斷。

{brief}

## 所有人的第一輪意見（包含你自己：{me}）
{round1}"""

REVIEW = """你是一位嚴格的資深程式審查員。其他審查員也在獨立審查同一個 PR，你看不到他們的答案。
請對照「目標與驗收條件」審查這個 PR 的程式差異，找出真正的問題：
是否達成每一條驗收條件、bug、邊界情況、資料遺失、競態條件、安全性（金鑰外洩、注入）、
手機瀏覽器相容性、與既有功能的相容性、測試是否真的有驗證到該驗證的東西。
不要挑純風格的問題；沒有把握的不要列，或明確標示「不確定」。

用 Markdown 條列，每一點包含：嚴重度（🔴高 / 🟠中 / 🟡低）、檔案與行號或函式、問題、具體修法。
沒有發現問題就只回答「未發現問題」，並簡短說明你檢查了哪些面向。

## 目標與驗收條件
{goal}

## 程式差異
```diff
{diff}
```"""


def main():
    p = argparse.ArgumentParser()
    p.add_argument("mode", choices=["plan", "cross", "review"])
    p.add_argument("--brief", help="需求（issue 內容）檔案")
    p.add_argument("--round1", help="第一輪意見留言檔案（cross 用）")
    p.add_argument("--goal", help="PR 目標檔案（review 用）")
    p.add_argument("--diff", help="PR 差異檔案（review 用）")
    p.add_argument("--out", required=True)
    a = p.parse_args()

    if a.mode == "plan":
        brief = read(a.brief, 60_000)
        answers = ask_all(lambda m: PLAN.format(brief=brief))
        md = render("ai-council:plan", "🧭 AI 委員會：第一輪獨立評估", answers)
    elif a.mode == "cross":
        brief, round1 = read(a.brief, 40_000), read(a.round1, 60_000)
        answers = ask_all(lambda m: CROSS.format(brief=brief, round1=round1, me=m))
        md = render("ai-council:cross", "🔁 AI 委員會：第二輪交叉討論", answers)
    else:
        goal, diff = read(a.goal, 40_000), read(a.diff, 150_000)
        if not diff.strip():
            md = "（沒有程式差異）"
        else:
            answers = ask_all(lambda m: REVIEW.format(goal=goal, diff=diff))
            md = render("ai-council:review-body", "🔍 AI 審查團意見", answers)

    with open(a.out, "w", encoding="utf-8") as f:
        f.write(md)
    print("完成")


if __name__ == "__main__":
    main()
