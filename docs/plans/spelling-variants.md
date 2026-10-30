# 規劃：英美拼字視為同一個字

- **級別**：中（改動評分比對規則，影響影子跟讀與語言模型練習；不改資料結構、不新增套件）
- **PR**：#（開 PR 後補上）
- **狀態**：規劃中

## 目標
原句用英式拼法（favourite、colour、realise、centre…），語音辨識（Whisper／Gemini）多半輸出美式拼法（favorite、color、realize、center）。兩種拼法**念起來一樣**，現在卻被算成念錯，造成：
- 影子跟讀內容分數被扣
- 語言模型練習「精準背出原句」永遠不會 errors === 0，熟練度無法累加

做完之後：英美拼字差異（以及少數「同音、只差合寫或分寫」的寫法）在比對時視為同一個字；**發音不同的字仍然算錯**。

## 背景與使用情境
- PR A（#22）、PR B（#23）處理了錄音時序與轉錄模型；這是辨識結果系統性被判錯的最後一個已知來源
- 擁有者 2026-10-30 同意：英美拼字視為同一個字（不算放寬「精準背出原句」，因為發音相同）
- 教材常見英式拼法；Whisper large-v3 以美式拼法為主

## 相關檔案
- `src/utils/scoring.ts`
- `tests/scoringNormalize.test.ts`
- `tests/scoring.test.ts`
- `tests/scoringRegression.test.ts`
- `docs/plans/scoring-normalize-fix.md`

## 做法
### 1. 新檔 `src/utils/spellingVariants.ts`
匯出 `canonicalSpelling(word: string): string[]`：輸入一個小寫字，回傳比對用的「標準寫法」token（通常 1 個；合寫字回傳 2 個）。不在表中的字原樣回傳。

對照表**全部明確列出**（不用 `-our → -or`、`-ise → -ize` 這種通用規則，避免 hour、rise、wise、precise、advertise 被誤改）。依字族產生詞形變化：
| 字族 | 例 | 產生的詞形 |
|---|---|---|
| -our／-or | colour、favour(ite)、flavour、honour、humour、labour、neighbour、behaviour、harbour、rumour、vapour、endeavour、savour | 原形、+s、+ed、+ing、+ful、+fully、+less、+able、+ite、+ites、+hood |
| -ise／-ize（明確動詞清單） | realise、organise、recognise、apologise、criticise、emphasise、memorise、summarise、prioritise、specialise、minimise、maximise、finalise、categorise、customise、familiarise、normalise、optimise、personalise、socialise、standardise、sympathise、utilise、visualise、authorise、modernise、characterise、civilise | 原形、+s、+d、去 e +ing、+r、+rs、去 e +ation、+ations |
| -yse／-yze | analyse、paralyse、catalyse | 原形、+s、+d、去 e +ing |
| -re／-er | centre、theatre、metre、litre、fibre、kilometre、centimetre、millimetre、calibre、sombre | 原形、+s、+d→-ered、去 e +ing→-ering |
| 雙 l／單 l | travel、cancel、label、model、fuel、signal、level、channel、marvel、quarrel、counsel | +led、+ling、+ler、+lers、+lor、+lors |
| 個別字 | grey→gray、programme→program、cheque→check、tyre→tire、defence→defense、offence→offense、licence→license、practise→practice、catalogue→catalog、dialogue→dialog、analogue→analog、enrol(ment)→enroll(ment)、fulfil(ment)→fulfill(ment)、skilful→skillful、wilful→willful、judgement→judgment、ageing→aging、plough→plow、mould→mold、doughnut→donut、storey→story、kerb→curb、sceptical→skeptical、manoeuvre→maneuver、okay→ok | 個別列出需要的詞形 |
| 合寫／分寫（同音） | alright＝all right、e-mail＝email | 合寫字拆成多個 token，或連字號字先接起來 |

### 2. `src/utils/scoring.ts` 的 `wordTokens`
- 每個展開後的寫法都經過 `canonicalSpelling`；原句與辨識結果**兩邊用同一個函式**，所以只要同一字族就會相同
- 合寫字（alright）在 `expandWord` 之前拆成 `all`、`right` 兩個 token，`src` 都指向同一個原字
- 逐字比對畫面仍顯示**原句寫法**（`diff.word` 來自原文，不受影響）

### 待委員會評估的問題
- 合寫／分寫要不要擴大到 everyday＝every day、anymore＝any more、anytime＝any time、maybe＝may be？（同音但有時意思不同；Whisper 依上下文決定寫法）。另一個做法是比對時通用允許「兩個相鄰字接起來＝一個字」，但會讓動態規劃與逐字顯示變複雜
- learnt／learned、spelt／spelled、dreamt／dreamed、burnt／burned：多數口音發音不同，暫定**不**視為同字

### 3. 不改的地方
- `canAccumulatePattern`（errors === 0）、內容分數公式、流暢度、門檻都不動
- 不改 Firestore、不改轉錄提示詞

## 驗收條件
1. 英式原句、美式辨識 → 0 錯：`My favourite colour is grey` vs `My favorite color is gray`（✅ 自動測試）
2. 反方向（美式原句、英式辨識）→ 0 錯（✅）
3. 詞形變化都算對：realised／realized、organisation／organization、travelled／traveled、traveller／traveler、centres／centers、centred／centered、theatre／theater、programme／program、practising／practicing、analysed／analyzed、judgement／judgment、enrolment／enrollment、colourful／colorful、neighbours／neighbors（✅）
4. 大小寫、標點不影響：`Colour,` vs `color`（✅）
5. 合寫／分寫：`alright` vs `all right`、`OK` vs `okay`、`e-mail` vs `email` → 0 錯（✅）
6. 不放寬：發音不同或不在表中的仍算錯——`mum` vs `mom`、`learnt` vs `learned`、`towards` vs `toward`、`colour` vs `collar`、`hour` vs `hor`、`rise` vs `rize`（✅，errors ≥ 1）
7. 語言模型練習：`I realised it` vs 辨識 `I realized it` → `canAccumulatePattern` 為 true（✅）
8. 逐字比對顯示原句寫法：原句 `favourite` 在 diff 中顯示為 `favourite`、type ok（✅）
9. 影子跟讀：英式原句＋美式辨識 → contentScore 100（✅）
10. 既有評分測試全部通過（✅）
11. 👀 手動：用一句含英式拼字的教材句子跟讀，結果頁不再把該字標成念錯

## 手動試用步驟
1. 用 Email 測試帳號登入預覽網站
2. 「啟蒙的開始」找一句含英式拼字（如 favourite、colour、centre）的句子 → 跟讀
3. 結果頁逐字比對：該字不應標成 warn 色（念錯）
4. 語言模型：若有含英式拼字的句子，念出來練習 → 念對時熟練度應有增加

## 不要做的事
- 不用通用字尾規則（會誤改 hour、rise、wise 等）
- 不把發音不同的字視為同字（mum／mom、learnt／learned、towards／toward、dreamt／dreamed）
- 不改評分門檻、不放寬相似度

## 資料相容與備份（改到 Firestore 資料結構時必填）
- 新程式能否讀取舊格式資料：不涉及
- 是否改寫既有資料：否（只影響之後的評分）
- Merge 前的備份方式：不需要

## 新增套件（若有，需擁有者核准）
無

## 決策紀錄
- 2026-10-30：擁有者同意英美拼字視為同一個字（PR C，中級）

## 進度紀錄
- 2026-10-30：建立規劃文件，開草稿 PR，送委員會與 Codex 第一輪
