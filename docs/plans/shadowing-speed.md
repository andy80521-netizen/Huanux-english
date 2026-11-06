# 規劃：影子跟讀調整原音語速

- **級別**：中（跟讀播放與流暢度計算；不改資料、不加套件）
- **PR**：#32
- **狀態**：完成（等擁有者試用與 Merge）

## 目標
影子跟讀可以把原音放慢，跟得上再慢慢加快，讓練習不那麼挫折。

## 擁有者決定（2026-11-06）
- 只用在**影子跟讀的原音**
- 選項 **0.75、0.85、1.0**，設定會記住（預設 1.0）
- 放慢時熟練度**照常累加**（以跟得上「放慢後的原音」為準）

## 相關檔案
- `src/components/ShadowingPracticeView.tsx`
- `src/utils/shadowingPlayback.ts`
- `src/utils/shadowingAudio.ts`
- `src/utils/scoring.ts`
- `src/components/ui/SegmentedControl.tsx`
- `tests/shadowingPlayback.test.ts`

## 做法（定案；委員會第一輪後修訂，沒有新的擁有者決定事項）
### 1. 新模組 `src/utils/shadowingSpeed.ts`
- `SHADOWING_SPEEDS = [0.75, 0.85, 1] as const`、`DEFAULT_SPEED = 1`
- localStorage `huanux_shadowing_speed_v1`；`loadSpeed(getStorage)`：讀不到、不是選項之一、localStorage 丟錯 → 1；`saveSpeed`
- `effectiveOriginalSec(originalSec, speed)` ＝ `originalSec / speed`
- `applyPlaybackSpeed(el, speed)`：設定 `playbackRate`，並開啟 `preservesPitch`（含 `webkitPreservesPitch`），放慢不變低沉

### 2. 跟讀畫面
- 待錄音區（熟練度下方）加一列「原音速度」分段選擇（`SegmentedControl`：0.75×／0.85×／1×），只在待錄音時可改；「原音 X 秒」顯示放慢後的秒數
- 按「開始跟讀」：記下這次的速度（`recordSpeedRef`），播原音前 `applyPlaybackSpeed`
- 點擊當下的 iPhone 解鎖預播放（靜音 play／pause）也先套用速度（Poolside）
- 原音播到 `endTime` 才停（用 `currentTime` 判斷，不受速度影響）；緩衝 6 秒等邏輯不變
- **速度快照**（Codex）：每次錄音的資料存成 `ShadowingAttempt { blob, speechSec, speed }`，評分、重試評分、聽聽看都讀這次錄音的快照，不讀目前的設定；評分抽成純函式 `scoreShadowingAttempt(text, sentence, attempt)`
- **流暢度**：`calculateShadowingScores(…, speechSec, effectiveOriginalSec(originalSec, 這次的速度))`，放慢時用放慢後的原音長度比較；「重試評分」用同一次的速度（存在 `lastRecordingRef`）
- 熟練度照常累加（門檻不變：內容 ≥## 驗收條件
1. `loadSpeed`：沒有設定、不合法值、localStorage 丟錯 → 1；合法值照讀；`saveSpeed` 寫入（✅）
2. `effectiveOriginalSec`：3 秒 × 0.75 → 4 秒（✅）
3. `applyPlaybackSpeed`：設定 `playbackRate`、`preservesPitch`、`webkitPreservesPitch`（✅）
4. `scoreShadowingAttempt`：0.75 倍速錄音講 4 秒（原音 3 秒）→ 流暢度 100；同樣 4 秒在 1 倍速 → 不是 100；重試評分用同一個快照（✅ 行為測試）
5. `createListenPlayer` 帶 `rate`：「原音」「重疊播放」用錄音時速度；保險計時依速度延長，0.75 倍速不提早停；停止後原音速度回 1；錄音不改速度；下一次錄音改 1 倍時用 1 倍（✅ 行為測試）
6. 跟讀畫面：有速度選擇、記住設定、播原音前（含解鎖預播放）套用速度、評分與聽聽看讀錄音快照（✅ 原始碼檢查）
7. 👀 iPhone：0.75 倍速原音聲音自然（不變低沉）、跟讀後「重疊播放」對得齊

## 手動試用步驟
1. 用 Email 測試帳號登入預覽網站，進入跟讀
2. 「原音速度」選 0.75×，按開始跟讀：原音變慢、聲音不變低沉
3. 跟讀完看分數：照著放慢的原音念，流暢度應該正常（不會因為念得慢被扣分）
4. 聽聽看「重疊播放」：原音和錄音對得齊
5. 離開再回來：速度仍是 0.75×

 1；合法值照讀；`saveSpeed` 寫入（✅）
2. `effectiveOriginalSec`：3 秒 × 0.75 → 4 秒（✅）
3. 流暢度：0.75 倍速時講 4 秒（原音 3 秒）→ 流暢度 100；同樣 4 秒在 1 倍速 → 不是 100（✅）
4. `createListenPlayer` 帶 `rate`：播原音前設定 `playbackRate`；保險計時依速度延長，0.75 倍速時不提早停（✅）
5. 跟讀畫面：有速度選擇、記住設定、播原音前套用速度、評分用放慢後長度（✅ 原始碼檢查）
6. 👀 iPhone：0.75 倍速原音聲音自然（不變低沉）、跟讀後「重疊播放」對得齊

## 手動試用步驟
（定案後補上）

## 不要做的事
- 不改語言模型題目與答案語音、複述原音的速度（擁有者只要跟讀原音）
- 不改熟練度門檻

## 資料相容與備份（改到 Firestore 資料結構時必填）
- 不涉及資料（速度只存在這台裝置的 localStorage）

## 新增套件（若有，需擁有者核准）
無

## 決策紀錄
- 2026-11-06：擁有者決定只用在跟讀原音、0.75／0.85／1.0、放慢照常累加

## 進度紀錄
- 2026-11-07：建立規劃文件，開草稿 PR，送委員會與 Codex 第一輪；採納：速度快照與行為測試（Codex）、解鎖預播放也套用、MediaLike 加 playbackRate（Poolside）、停止時速度還原（Nemotron）；委員提出的待決問題都與擁有者已定的決定一致（記住設定、流暢度門檻不變），不需另外決定
- 2026-11-07：驗收測試 `2b66475`；實作完成，check.sh 通過（961 測試）
- 2026-11-07：審查第 1 輪 Codex、Gemini 皆無意見；verify／guard 通過
- 下一步：擁有者 iPhone 試用後 Merge
