# 規劃：UI 改版 ⑤｜動效與微互動

- **級別**：中（擁有者 2026-10-27 決定；只改畫面與動畫，「新勳章」由練習前後的數字算出，不寫任何資料、不改規則、不新增套件）
- **PR**：#18
- **狀態**：規劃中

## 目標
改版 ①～④ 後的自檢顯示「動效與微互動」最弱：換畫面是瞬間切換、高光時刻沒有儀式感。這輪補上四件事（設計稿已經擁有者確認）：

1. **頁面轉場**
   - 切換四個主分頁、教材列表↔詳情↔匯入、句型庫↔句型詳情、今日複習↔句型庫：新畫面淡入＋上浮 8px，200ms，`--ease-out-soft`
   - 做法：共用 `PageEnter` 容器（`key` 改變就重播 `animate-page-in`）；動畫結束值用 `transform: none`，不留下會影響 `position: fixed` 對話框的 transform
   - **卡片輕壓**：教材卡、句型卡、今日複習卡按下時縮到 0.985（`active:`，加 `transition-transform duration-150` 讓手機也看得到）；有刪除鈕的卡片（`MaterialListView`、`LanguageModelListView`）在標題連結加 `data-card-link`，外層用 `has-[[data-card-link]:active]`，按刪除鈕不縮（DeepSeek、Gemini）
   - 第一次開 App 的預設分頁也會淡入一次
   - 動畫期間（200ms）祖先有 transform，裡面的 `position: fixed` 對話框會短暫相對容器定位；只有「進畫面當下立刻開對話框」才會碰到，機率極低，接受（DeepSeek）
2. **高光時刻（本組練習完成）**
   - 新純函式 `sessionHighlights(sentences, groupIndex, startById, afterById)` → `{ newTier: { tier, mastered } | null, groupCompleted }`
     - 練習前精熟句數：有起始值的句子用起始值，其他用目前值；練習後：用這次真的寫入的值（`sessionAfter`），沒有才用目前值
     - `newTier`：這次跨過的最高門檻（10／40／100，`STAGE_THRESHOLDS`）；沒跨過為 null
     - `groupCompleted`：本組 10 句練習後全部 1000、練習前不是
   - `sentences` 是整個句型的 `exampleSentences`（勳章以句型總精熟句數計）；空陣列、缺值、`NaN` 都安全回傳 `{ newTier: null, groupCompleted: false }`（DeepSeek、Nemotron）
   - 其他組沒在這次練習的句子用監聽資料；若監聽較慢可能少算，只影響顯示，接受（DeepSeek）
   - 有 `newTier` 時，在「本組練習完成」標題下方顯示印章卡：印章（**依 `newTier.tier` 顯示可用／熟練／精通**，設計稿上的「熟練」只是範例）「蓋」下（放大旋轉→落定、外圈漣漪、金色光暈）＋「新勳章」＋階段名稱＋「這個句型已精熟 N 句」（Codex 🟠）
   - `groupCompleted` 時在長條下方顯示「第 N 組 10 句全部精熟」（金色、淡入）
   - 只播一次，約 600ms
3. **解鎖新組**（造句練習完成）：既有「已解鎖第 N 組！」卡片彈出（0.9→1.04→1）、鎖環打開、七顆金點散開；文字不變
4. **勳章房進場**：標題→三枚印章（依序縮放浮現，間隔 70ms）→每列間隔 60ms 上浮（延遲上限 480ms，句型多也不會拖太久）；長條從 0 長到目前值（700ms）；印章下的數字從 0 數到目前值（沿用 `countUpValue`，做成獨立小元件，不讓整個列表每幀重繪）（DeepSeek）
   - 只在這次開啟 App 後第一次進入勳章房時播放：模組層級旗標，在第一次 render 用 `useState` 初始值決定、effect 裡標記已播（StrictMode 重掛也不會失效）（Nemotron）
5. **減少動態**：`app.css` 的全域規則**再加上 `animation-delay`、`transition-delay` 歸零**（原本只縮短時間，逐列延遲期間後面的列仍是透明的）；JS 端判斷 `prefersReducedMotion()` 時不加延遲、數字直接顯示終值（Codex 🟠）

## 背景與使用情境
- 原始需求要求從「動效、微互動」自檢並持續優化；①～④ 完成後擁有者選了這四項
- 高光時刻放在使用者剛完成練習的那一刻，正是成就感最強的時候；勳章房只是回顧，所以進場動畫只播一次

## 設計依據
- 設計畫布「Huanux 視覺方向提案」第九列（⑤）：頁面轉場、高光時刻、解鎖新組、列表進場與數字

## 相關檔案
- `src/styles/app.css`
- `src/App.tsx`
- `src/components/MaterialImportMode.tsx`
- `src/components/LanguageModelMode.tsx`
- `src/components/TodayReviewView.tsx`
- `src/components/LanguageModelPracticeView.tsx`
- `src/components/BadgeMode.tsx`
- `src/components/ui/BadgeSeal.tsx`
- `src/utils/groupMastery.ts`
- `src/utils/patternStage.ts`

## 驗收條件
1. ✅ `sessionHighlights`：沒跨門檻→null；跨 10／40／100 各自回傳「可用／熟練／精通」與精熟句數；一次跨兩個取最高；起始值與寫入值優先序（寫入值缺時退回目前值）；未通過檢查的句子不算；空資料安全；整組精熟只在「練習前不是、練習後是」時為 true（`tests/sessionHighlights.test.ts`）
2. ✅ 文案：`TodayReviewView` 含「新勳章」「這個句型已精熟 」「 10 句全部精熟」；「已解鎖第 」「 組！」仍在（`tests/uiCopyMotion.test.ts`）
3. ✅ 動畫定義：`app.css` 有 `page-in`、`stamp`、`ripple`、`pop-in`、`unlock`、`burst` keyframes，`page-in` 結束值是 `transform: none`；減少動態的全域規則仍在，且把 `animation-delay`、`transition-delay` 歸零（同上）
3a. ✅ 印章卡依 `newTier.tier` 顯示（不寫死「熟練」）；勳章房逐列延遲有上限、減少動態時不加延遲（同上）
4. ✅ 接線：`App.tsx`、`MaterialImportMode`、`LanguageModelMode` 使用 `PageEnter`；三種卡片有輕壓；`BadgeMode` 有只播一次的旗標與數字跑動（同上）
5. 👀 手機與桌機：切分頁、進出詳情有轉場且不閃；對話框（刪除確認、速覽卡、Firebase 設定）位置正常
6. 👀 本機假資料預覽：本組練習完成跨過門檻時出現印章卡、整組精熟出現金色文字；造句完成出現解鎖動畫；勳章房第一次進入有進場、切走再回來不重播
7. 👀 開啟系統「減少動態」：以上全部直接顯示結果

## 手動試用步驟
1. 預覽網站用 **Email 測試帳號**登入
2. 切換四個分頁；教材列表點進詳情再返回；句型庫點進詳情再返回
3. 今日複習練完一組（若剛好跨過 10／40／100 句會看到印章卡）
4. 勳章房：第一次進入看進場，切到別頁再回來應該不重播
5. 手機開啟「減少動態」再看一次

## 不要做的事
- 不改任何資料、精熟／解鎖規則、AI 呼叫
- 不新增套件（不用動畫函式庫）
- 不改既有文案（只新增上列 3 段）

## 資料相容與備份
- 只讀不寫，不需要備份

## 新增套件
- 無

## 決策紀錄
- 2026-10-27：擁有者選擇做 ⑤ 的頁面轉場、高光時刻、列表進場與數字；核准設計稿、3 段新文案、級別「中」

## 進度紀錄
- 2026-10-27：建立分支 `ai/ui-motion` 與規劃文件，開草稿 PR #18；委員會（Gemini Lite、Nemotron、Poolside、DeepSeek；Grok 未出現）＋Codex 第一輪全部回覆，已整合

## 委員會整合（第一輪）
### 採納
- 印章依實際跨過的門檻顯示，三種各自驗收（Codex 🟠）
- 減少動態要把延遲也歸零，否則逐列延遲期間是透明的（Codex 🟠）
- 逐列延遲設上限 480ms；數字跑動做成獨立小元件；手機輕壓加 transition（DeepSeek）
- `sessionHighlights` 空資料安全、寫入值缺時退回目前值（DeepSeek、Nemotron）
- 只播一次的旗標要能撐過 StrictMode 重掛（Nemotron）
- 有刪除鈕的卡片用 `data-card-link`＋`has-[…:active]`（Gemini、DeepSeek）
### 駁回或不做
- `groupCompleted` 用平均熟練度判斷（Poolside）— 規則是 10 句都滿 1000
- `onAnimationEnd` 強制清 transform、`will-change`、IntersectionObserver 分批（Nemotron、Gemini）— 動畫被打斷即代表元件卸載；只有 transform／opacity，不需要
- 舊瀏覽器 JS 退回方案、裝置測試矩陣（Nemotron）— 專案已是 Tailwind v4 的瀏覽器下限，`has()` 已支援
- 造句練習也做高光時刻（DeepSeek 提問）— 不做，那裡只有解鎖動畫
### 接受的風險
- 轉場 200ms 內立刻開啟的 `position: fixed` 對話框會短暫相對容器定位
- 其他組的監聽資料較慢時，新勳章可能少算（只影響顯示）
- 2026-10-27：擁有者核准規劃；驗收測試 commit `35b5e6c`（`tests/sessionHighlights.test.ts`、`tests/uiCopyMotion.test.ts`），修改前失敗
- 2026-10-27：實作完成：`utils/sessionHighlights.ts`、`ui/PageEnter.tsx`、`app.css` 動畫與減少動態延遲歸零、App／教材／語言模型轉場、三種卡片輕壓、本組練習完成印章卡、解鎖動畫、勳章房進場；`check.sh` 通過
  - 分頁內的畫面第一次出現時不播自己的轉場（`animate={viewMounted}`），避免和外層分頁轉場疊加
  - 自我檢查（本機假資料預覽）：練完 4 句跨過「可用」並整組精熟 → 印章卡與金色文字出現；減少動態時一樣直接出現；句型庫→詳情轉場後刪除確認框置中；勳章房數字跑到 3／2／1；減少動態時所有列立即可見
  - 自檢修正：`page-in` 用 `both` 時 Chrome 結束後留下 identity matrix（仍會讓 fixed 對話框以容器定位）→ 改 `backwards`，結束後 transform 為 none；印章卡光暈太粗 → 6px、22%
