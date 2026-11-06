# 規劃：錄音開頭不再被吃掉（麥克風暖機）

- **級別**：中（錄音流程，三個畫面；不改資料、不加套件）
- **PR**：#30
- **狀態**：審查中

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

## 做法（定案，2026-11-06 擁有者核准）
### 1. 新模組 `src/utils/micSession.ts`
- `KEEP_MIC_OPEN = true`：整頁共用麥克風。iPhone 實測若播放變小聲／改從聽筒出聲，改為 `false`（每次錄完就關、下次重開，保留收音確認）——擁有者已同意這個備案
- `createMicSession({ getUserMedia, createAudioContext })`
  - `acquire()`：已有可用的（軌道 `live`、`enabled`、沒有 `muted`，AudioContext 沒關閉）→ 沿用；否則取得麥克風並建立 AudioContext＋AnalyserNode（`fftSize 256`，只接 Analyser、不接喇叭）。同時多次呼叫只取得一次
  - `release()`：停止軌道、關閉 AudioContext；**取得中途呼叫 `release()` → 那次請求作廢，晚到的 stream 立刻停止、不建立 AudioContext，`acquire()` 拋出 `MicReleasedError`**（Codex）
  - `resume()`：同步呼叫 `ctx.resume()`；**畫面在點擊當下、任何 await 之前呼叫**（Gemini：iPhone 不在使用者手勢內可能擋下）
- `sampleMic(handle)`：用 `getFloatTimeDomainData` 算 RMS（dBFS），並回傳 AudioContext 的 `state` 與 `currentTime`
- `waitForMicLive({ sample, floorDb = -80, stableMs = 60, timeoutMs = 1500, pollMs = 20, now, sleep, isCancelled })` → `'live' | 'timeout' | 'cancelled'`
  - 只有 **AudioContext 在 running、`currentTime` 有前進（新的音訊資料）且音量高於門檻**的取樣才累積；暫停、舊資料、低於門檻都會把累積歸零（Codex：暫停時 Analyser 會一直回傳同一份舊資料）
  - 以 **AudioContext 的時間**累積滿 60ms 才算收音
  - 逾時 1.5 秒：**照常開始**（擁有者決定），console 記錄

### 2. 進頁面就預先暖機（擁有者決定）
- 三個畫面掛載時就 `acquire()`（iPhone 會在這時詢問權限、橘點亮起）；權限被拒或失敗只記 log，按開始時再試一次並顯示原本的錯誤訊息
- 卸載時 `release()`

### 3. 影子跟讀（`ShadowingPracticeView`）
- `handleStart`：點擊當下（await 前）`mic.resume()`；防連按（`startingRef`）；畫面顯示「準備麥克風…」直到原音開始播
- `acquire()` → `MediaRecorder.start()` → **同時等 `start` 事件與 `waitForMicLive`** → 再等 300ms → 播原音
- `playAfterRecordingStarts` 新增選填 `waitLive`；不傳時行為不變
- `cleanupAudio` 只停音量偵測迴圈；`KEEP_MIC_OPEN` 為 true 時不停軌道、不關 AudioContext、不拆 Analyser

### 4. 語言模型練習（`PatternPracticeSessionView`）
- 點擊當下 `mic.resume()`；`acquire()` → `start()` → `waitForMicLive` 完成後才設定 `recordingStartTimeRef`、開始靜音偵測（5 秒／2.5 秒照舊）；等待期間按鈕顯示「準備中…」並停用

### 5. 複述（`RetellView`）
- 同上：收音確認後才開始計時（3 分鐘上限從那時起算），等待期間顯示「準備中…」

### 6. 診斷
- console 記錄「按下 → 收音」毫秒數與結果（live／timeout），不記音訊內容

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
- 2026-11-06：委員會（Gemini、Nemotron、Poolside、DeepSeek）與 Codex 第一輪後擁有者決定：進頁面就預先暖機；1.5 秒等不到收音照常開始；iPhone 播放變小聲時改為每次錄完就關麥克風（備案）
  - 採納：收音判定要求 AudioContext running 且資料是新的（Codex）；取得中途離開要作廢（Codex）；點擊當下 resume（Gemini）；準備中狀態與防連按（Poolside）
  - 駁回／延後：把現有音量偵測改成 dBFS（Poolside，會牽動靜音停止門檻）；複述加靜音停止（超出範圍）；`track.enabled=false` 當播放備案（Codex 指出未驗證，改用每次重開）

## 進度紀錄
- 2026-11-06：建立規劃文件，開草稿 PR，送委員會與 Codex 第一輪；擁有者核准
- 2026-11-06：驗收測試 `f408a16`（修改前因 micSession 不存在而失敗）；實作完成，check.sh 通過（919 測試）；Chromium 假麥克風實測：預先暖機後按錄音 158ms 確認收音
- 下一步：Codex／Gemini 審查
