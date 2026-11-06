# 規劃：影子跟讀調整原音語速

- **級別**：中（跟讀播放與流暢度計算；不改資料、不加套件）
- **PR**：#32
- **狀態**：規劃中

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

## 做法（草案）
### 1. 新模組 `src/utils/shadowingSpeed.ts`
- `SHADOWING_SPEEDS = [0.75, 0.85, 1] as const`、`DEFAULT_SPEED = 1`
- localStorage `huanux_shadowing_speed_v1`；`loadSpeed(getStorage)`：讀不到、不是選項之一、localStorage 丟錯 → 1；`saveSpeed`
- `effectiveOriginalSec(originalSec, speed)` ＝ `originalSec / speed`
- `applyPlaybackSpeed(el, speed)`：設定 `playbackRate`，並開啟 `preservesPitch`（含 `webkitPreservesPitch`），放慢不變低沉

### 2. 跟讀畫面
- 待錄音區（熟練度下方）加一列「原音速度」分段選擇（`SegmentedControl`：0.75×／0.85×／1×），只在待錄音時可改；「原音 X 秒」顯示放慢後的秒數
- 按「開始跟讀」：記下這次的速度（`recordSpeedRef`），播原音前 `applyPlaybackSpeed`
- 原音播到 `endTime` 才停（用 `currentTime` 判斷，不受速度影響）；緩衝 6 秒等邏輯不變
- **流暢度**：`calculateShadowingScores(…, speechSec, effectiveOriginalSec(originalSec, 這次的速度))`，放慢時用放慢後的原音長度比較；「重試評分」用同一次的速度（存在 `lastRecordingRef`）
- 熟練度照常累加（門檻不變：內容 ≥ 70 且總分 ≥ 70）

### 3. 結果頁「聽聽看」
- 「原音」「重疊播放」用**這次錄音時的速度**播放，重疊時才對得齊
- `createListenPlayer` 新增選填 `rate: () => number`：播原音前設定速度；保險計時改為 `(end − start) ÷ rate × 1000 + 500`，避免放慢時提早截斷句尾

### 4. 其他使用原音的地方
- 只有跟讀畫面；每次播放前都明確設定速度（不依賴元素上一次的狀態）

## 驗收條件（初稿）
1. `loadSpeed`：沒有設定、不合法值、localStorage 丟錯 → 1；合法值照讀；`saveSpeed` 寫入（✅）
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
- 2026-11-07：建立規劃文件，開草稿 PR，送委員會與 Codex 第一輪
