# 規劃：錄音開頭不再被吃掉（麥克風暖機）

- **級別**：中（錄音流程，三個畫面；不改資料、不加套件）
- **PR**：#（開 PR 後補上）
- **狀態**：規劃中

## 目標
錄音檔一定包含使用者說的第一個字。影子跟讀時，原音一定在麥克風**真的開始收音之後**才播放；語言模型練習與複述，等麥克風真的開始收音才提示開始說、才開始計時。

## 背景與證據（2026-11-06 擁有者螢幕錄影，影子跟讀第 9 句「我的錄音」）
- 錄音開頭約 0.33 秒的音量約 **-90 dBFS**（幾乎是數位零），但講完後的房間背景是 **-70 dBFS**：開頭比房間還安靜 → 麥克風那段時間還沒真正收音
- 接著 10 毫秒內從 -90 跳到 -8 dBFS，中間沒有任何房間背景聲 → 麥克風開始收音時使用者已在講話
- Whisper 結果整個少了句首「Elsewhere the」
- 現行流程（`ShadowingPracticeView.handleStart`）：每次按「開始跟讀」都重新 `getUserMedia` → `MediaRecorder.start()` → 等 `start` 事件（或 800ms）→ 再等 300ms → 播原音（`playAfterRecordingStarts`）。**iPhone 的 `start` 事件不代表麥克風已有聲音**，暖機期間錄到的是零
- 語言模型練習（`PatternPracticeSessionView.startRecording`）、複述（`RetellView`）同樣每次重開麥克風、`start()` 後立刻開始計時

## 擁有者決定（2026-11-06）
- 修正級別：中
- **同一個練習頁面只開一次麥克風**，換句、重錄時沿用；離開頁面才關（iPhone 錄音橘點在練習頁會一直亮）

## 相關檔案
- `src/components/ShadowingPracticeView.tsx`
- `src/components/PatternPracticeSessionView.tsx`
- `src/components/RetellView.tsx`
- `src/utils/recordingTiming.ts`
- `src/utils/silenceDetection.ts`
- `tests/recordingTiming.test.ts`

## 做法（草案）
### 1. 新模組 `src/utils/micSession.ts`
- `createMicSession(deps)`：注入 `getUserMedia`、`createAudioContext`（可測試）
  - `acquire()`：已有且軌道 `readyState === 'live'`、AudioContext 未關閉 → 直接沿用；否則重新取得麥克風、建立 AudioContext 與 AnalyserNode（`MediaStreamSource → Analyser`，不接到喇叭）；每次都 `resume()` AudioContext（iPhone 可能被暫停）
  - `release()`：停止軌道、關閉 AudioContext；元件卸載時呼叫
  - 同時只會有一個取得中的請求（重複按不會開兩次）
- `levelDb(analyser)`：用 `getFloatTimeDomainData` 算 RMS（dBFS）；現有音量偵測用的 byte 資料解析度不夠判斷 -80 dB
- `waitForMicLive({ readLevelDb, floorDb = -80, stableMs = 60, timeoutMs = 1500, now, sleep, isCancelled })`：輪詢音量，**連續 60ms 高於 -80 dBFS**（有房間背景聲或說話聲）就視為麥克風已收音；最多等 1.5 秒，逾時照樣繼續（回傳 `{ live: false }`，記 log），取消時回傳 `cancelled`

### 2. 影子跟讀
- `handleStart`：`acquire()`（沿用或新開）→ `MediaRecorder.start()` → **同時等「`start` 事件」與「`waitForMicLive`」都完成** → 再等 300ms（`PLAYBACK_LEAD_MS`）→ 播原音
- `playAfterRecordingStarts` 新增選填 `waitLive`；不傳時行為不變
- 停止錄音、換句、重錄：只停 MediaRecorder 與音量偵測迴圈，**不關麥克風**；`cleanupAudio` 拆成「停止這次錄音」與「釋放麥克風（卸載時）」
- 點擊當下的 iPhone 播放解鎖（靜音 play／pause）維持在任何 await 之前

### 3. 語言模型練習
- `startRecording`：`acquire()` → `start()` → `waitForMicLive` 完成後才設定 `recordingStartTimeRef`、開始靜音偵測（開口前 5 秒、開口後 2.5 秒照舊）；等待期間按鈕顯示「準備中…」
- 錄音結束只停 MediaRecorder，麥克風沿用到離開練習（`PatternPracticeSessionView` 卸載）

### 4. 複述
- 同上：麥克風真的收音後才開始計時（3 分鐘上限從那時起算），顯示「準備中…」→ 錄音中

### 5. 診斷
- console 記錄每次「按下 → 麥克風收音」的毫秒數與是否逾時（不記音訊內容）

## 風險（請委員評估）
- **iPhone 麥克風開著時，播放音量與輸出路徑可能改變**（錄音／播放共用的音訊模式）：練習頁的原音試聽、「聽聽看」、題目與答案語音，可能比現在小聲或改從聽筒出聲。現在只在錄音期間開麥克風，所以沒遇過。整頁共用麥克風後，這會變成整個練習頁的常態 → 列為 👀 手動試用必測項目；若確認變小聲，備案是「評分結果畫面播放前暫停麥克風軌道（`track.enabled = false`）」或改回每次重開（只保留 `waitForMicLive`）
- 麥克風開著時，切到背景／鎖螢幕：iOS 可能停止軌道 → `acquire()` 發現軌道不是 `live` 就重開
- 藍牙耳機：開麥克風可能切到 HFP（音質變差）；現在錄音期間本來就會，整頁共用會延長
- 原音在麥克風收音前就被播放的路徑都要排除（`waitLive` 逾時 1.5 秒仍會播，避免卡住）

## 驗收條件（初稿）
1. `waitForMicLive`：一開始是 -90 dB、0.4 秒後變 -60 dB → 在 -60 dB 持續 60ms 後才回傳 live；一直 -90 dB → 1.5 秒後回傳逾時；取消 → 回傳 cancelled（✅）
2. `playAfterRecordingStarts` 帶 `waitLive`：start 事件先到、麥克風還沒收音 → 不播；兩者都完成再過 300ms 才播（✅）
3. `createMicSession`：第二次 `acquire()` 沿用同一個 stream，不再呼叫 `getUserMedia`；軌道已結束 → 重新取得；同時呼叫兩次只取得一次；`release()` 停止軌道並關閉 AudioContext（✅）
4. 三個畫面錄音結束時不關閉麥克風、卸載時釋放（✅ 原始碼檢查）
5. 語言模型練習與複述的計時從麥克風收音後開始（✅）
6. 既有錄音、評分、靜音偵測測試全部通過（✅）
7. 👀 iPhone：影子跟讀第一句，用「我的錄音」聽，句首第一個字完整
8. 👀 iPhone：麥克風開著時，原音試聽、「聽聽看」、題目語音的音量和現在一樣

## 手動試用步驟
（定案後補上）

## 不要做的事
- 不改評分規則（屬 PR 2）、不改播放速度（屬 PR 3）
- 不把麥克風聲音接到喇叭

## 資料相容與備份（改到 Firestore 資料結構時必填）
- 不涉及資料

## 新增套件（若有，需擁有者核准）
無

## 決策紀錄
- 2026-11-06：擁有者核准中級、整頁共用麥克風

## 進度紀錄
- 2026-11-06：建立規劃文件，開草稿 PR，送委員會與 Codex 第一輪
