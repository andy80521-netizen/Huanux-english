# 規劃：英美拼字視為同一個字

- **級別**：中（改動評分比對規則，影響影子跟讀與語言模型練習；不改資料結構、不新增套件）
- **PR**：#24
- **狀態**：完成（等擁有者試用與 Merge）

## 目標
原句用英式拼法（favourite、colour、realise、centre…），語音辨識（Whisper／Gemini）多半輸出美式拼法（favorite、color、realize、center）。兩種拼法**念起來一樣**，現在卻被算成念錯，造成：
- 影子跟讀內容分數被扣
- 語言模型練習「精準背出原句」永遠不會 errors === 0，熟練度無法累加

做完之後：英美拼字差異（以及 alright／all right、okay／OK、e-mail／email）在比對時視為同一個字；**發音不同的字仍然算錯**。

## 背景與使用情境
- PR A（#22）、PR B（#23）處理了錄音時序與轉錄模型；這是辨識結果系統性被判錯的最後一個已知來源
- 教材常見英式拼法；Whisper large-v3 以美式拼法為主

## 相關檔案
- `src/utils/scoring.ts`
- `tests/scoringNormalize.test.ts`
- `tests/scoring.test.ts`
- `tests/scoringRegression.test.ts`
- `docs/plans/scoring-normalize-fix.md`

## 做法
### 1. 新檔 `src/utils/spellingVariants.ts`
- `canonicalSpelling(word: string): string`：一個小寫字 → 一個比對用的標準寫法（美式）；不在表中原樣回傳。**只做一對一**，冪等
- `COMPOUND_SPLITS`（`alright` → `all`、`right`）：合寫字另一張小表，由 `wordTokens` 處理，不放在 `canonicalSpelling`
- 對照表在模組載入時建好一次（`Map`）
- 全部明確列出，**不用通用字尾規則**；檔頭註明「只收英美發音相同的拼法」
- 字族與詞形：
  | 字族 | 字 | 詞形 |
  |---|---|---|
  | -our／-or | colour、favour、flavour、honour、humour、labour、neighbour、behaviour、harbour、rumour、vapour、endeavour、savour、tumour、odour、armour、vigour、rigour、parlour、candour、valour、splendour | 原形、+s、+ed、+ing、+ful、+fully、+less、+able、+ably、+ite、+ites、+hood、+hoods、+al、+ally、+er、+ers、+y、+ism |
  | -ise／-ize（明確動詞清單） | realise、organise、recognise、apologise、criticise、emphasise、memorise、summarise、prioritise、specialise、minimise、maximise、finalise、categorise、customise、familiarise、normalise、optimise、personalise、socialise、standardise、sympathise、utilise、visualise、authorise、modernise、characterise、civilise、globalise、hospitalise、immunise、legalise、mobilise、stabilise、symbolise、fertilise、harmonise、jeopardise、patronise、colonise、scrutinise、energise、agonise | 原形、+s、+d、去 e +ing、+r、+rs、去 e +ation、+ations、+able |
  | -yse／-yze | analyse、paralyse、catalyse | 原形、+d、去 e +ing（不收 analyses：也是 analysis 的複數，發音不同） |
  | -re／-er | centre、theatre、metre、litre、fibre、kilometre、centimetre、millimetre、calibre、sombre、lustre、spectre、meagre | 原形、+s、-red→-ered、-ring→-ering |
  | 雙 l／單 l | travel、cancel、label、model、fuel、signal、level、channel、marvel、quarrel、counsel、total、dial、duel | +led、+ling、+ler、+lers、+lor、+lors |
  | 個別字 | grey(s／ed／ish／ing)→gray、programme(s)→program(s)、programming／programing、cheque(s)→check(s)、tyre(s)→tire(s)、defence→defense、offence→offense、licence→license、pretence→pretense、practise(s／d)、practising→practice、catalogue(s)→catalog(s)、dialogue(s)→dialog(s)、analogue→analog、enrol(s)、enrolment(s)→enroll(s)、enrollment(s)、fulfil(s)、fulfilment→fulfill(s)、fulfillment、skilful(ly)→skillful(ly)、wilful(ly)→willful(ly)、judgement(s)→judgment(s)、ageing→aging、plough(s)→plow(s)、mould(s／y)→mold、doughnut(s)→donut(s)、storey(s)→story／stories、kerb→curb、sceptic(al)→skeptic(al)、manoeuvre(s)→maneuver(s)、cosy→cozy、moustache→mustache、draught→draft、gramme→gram、gaol→jail、okay→ok | 個別列出 |

### 2. `src/utils/scoring.ts` 的 `wordTokens`
1. 切字前：U+2010、U+2011 視為 `-`；`e-mail` 接成 `email`
2. 合寫字（`COMPOUND_SPLITS`）在 `expandWord` 之前拆成多個 token，`src` 都指向同一個原字
3. `expandWord` 產生的每個寫法都經過 `canonicalSpelling`（所有格 `colour's` → `colours` → `colors`）
4. 原句與辨識結果**兩邊用同一套流程**
5. 逐字比對畫面仍顯示原句寫法（`diff.word` 來自原文）

### 3. 不改的地方
- `canAccumulatePattern`（errors === 0）、內容分數公式、流暢度、門檻都不動
- 不改 Firestore、不改轉錄提示詞、不改 `normalizeForCompare`

### 已知副作用
- 原句的 `alright` 會從 1 個 token 變 2 個，含這個字的句子內容分數比例會有極小變動（預期行為）
- 過去因拼字被判錯而沒累加的熟練度**不回溯**，只影響之後的練習

## 驗收條件
1. 英式原句、美式辨識 → 0 錯、內容 100：`My favourite colour is grey` vs `My favorite color is gray`（✅）
2. 反方向（美式原句、英式辨識）→ 0 錯（✅）
3. 詞形變化都算對：realised、organisation、travelled、traveller、centres、centred、theatre、programme、programmes、practising、analysed、judgement、enrolment、colourful、neighbours、coloured、behavioural、favourites、cancelling、totalled（✅）
4. 大小寫、標點、所有格不影響：`Colour,` vs `color`、`the centre's` vs `the center's`（✅）
5. 合寫：`alright` vs `all right`（雙向）、`OK` vs `okay`、`e-mail` vs `email`、`e‑mail`（U+2011）vs `email` → 0 錯（✅）
6. 不放寬：`mum`／`mom`、`learnt`／`learned`、`towards`／`toward`、`colour`／`collar`、`hour`／`hor`、`rise`／`rize`、`surprise`／`surprize`、`now here`／`nowhere`、`every day`／`everyday`、`maybe`／`may be` → errors ≥ 1（✅）
7. 語言模型練習：`I realised it` vs `I realized it` → `canAccumulatePattern` 為 true（✅）
8. 逐字比對顯示原句寫法：原句 `favourite` 在 diff 中顯示為 `favourite`、type ok（✅）
9. 影子跟讀：英式原句＋美式辨識 → content 100 且 `isShadowingPass` 為 true（✅）
10. `canonicalSpelling` 冪等，且不在表中的字原樣回傳（✅）
11. 既有評分測試全部通過（✅）
12. 👀 跟讀含英式拼字的教材句子，結果頁不再把該字標成念錯

## 手動試用步驟
1. 用 Email 測試帳號登入預覽網站
2. 「啟蒙的開始」找一句含英式拼字（如 favourite、colour、centre）的句子 → 跟讀
3. 結果頁逐字比對：該字不應標成念錯
4. 語言模型：若有含英式拼字的句子，念出來練習 → 念對時熟練度應有增加

## 不要做的事
- 不用通用字尾規則（會誤改 hour、rise、wise 等）
- 不做「兩個相鄰字接起來＝一個字」的通用比對（會讓 now here／nowhere 算對）
- 不把發音不同的字視為同字（mum／mom、learnt／learned、towards／toward、jewellery／jewelry、pyjamas／pajamas）
- 不把 everyday／every day、anymore、anytime、maybe／may be 視為同字
- 不改評分門檻、不放寬相似度、不回溯熟練度

## 資料相容與備份（改到 Firestore 資料結構時必填）
- 新程式能否讀取舊格式資料：不涉及
- 是否改寫既有資料：否（只影響之後的評分）
- Merge 前的備份方式：不需要

## 新增套件（若有，需擁有者核准）
無

## 決策紀錄
- 2026-10-30：擁有者同意英美拼字視為同一個字（PR C，中級）
- 2026-10-30：委員會第一輪（Gemini、Nemotron、Laguna、DeepSeek、Codex）後擁有者核准：
  - 合寫／分寫**只做** alright、okay、e-mail；everyday、anymore、anytime、maybe **不納入**（擁有者選建議）
  - practise／practice 視為同字（擁有者選建議）
  - 駁回「相鄰兩字通用合併」（Codex 🔴：now here／nowhere 會被算對）
  - 採納：單字轉換與合寫拆字分開（Gemini、DeepSeek）；e-mail 在切字前處理（Gemini、Nemotron）；補齊缺字（DeepSeek）；jewellery、pyjamas 因發音不同不納入
  - 不做：IPA lint、NFC 正規化、超長輸入保護（超出範圍）

## 進度紀錄
- 2026-10-30：建立規劃文件，開草稿 PR #24，委員會與 Codex 第一輪完成，擁有者核准
- 2026-10-30：驗收測試 `ec70084`（修改前因 spellingVariants 不存在而失敗）；實作完成，check.sh 通過（823 測試）
- 2026-10-30：審查第 1 輪 Codex、Gemini Flash 皆無意見；verify／guard 通過
- 下一步：擁有者試用後 Merge
