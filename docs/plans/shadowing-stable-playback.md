# 規劃：跟讀播放穩定（原音就位才錄音、起點確認不誤判、絕不超過句尾、時間一致）

- **級別**：中（改到跟讀核心流程；擁有者 2026-11-10 選擇中級、先開委員會）
- **PR**：#43
- **狀態**：完成，等擁有者 iPhone 試用與 Merge

## 目標
iPhone 上跟讀「按一次就正常」：原音一定從這一句的開頭播、一定停在句尾，範圍和「調整時間」完全一致。

## 背景與使用情境（擁有者 2026-11-10 回報，PR #42 合併後的正式版、iPhone Chrome）
1. 一點進去按「開始跟讀」馬上就結束，試到第三次才成功，很不穩定
2. 第二句跟讀，原音完全沒停在「調整時間」的範圍內（一路播下去）
3. 要讓「調整時間」的播放範圍和跟讀一致

## 原因分析（Claude，對照程式；iPhone 實機無法在沙盒驗證）
- PR #42 的 `guardSegmentStart`（`src/utils/segmentEnd.ts`）在原音 `play()` 的同一刻就開始判斷：`!paused && !seeking && currentTime < start - 0.5` 就補跳，補跳 2 次後判定失敗。
  - 推測 iPhone 在音檔載入初期會有一段「currentTime 回報 0、seeking 為 false」的空窗，之後才套用起點 → 空窗期被誤判。
- 跟讀（`ShadowingPracticeView.handleStart`）判定失敗時：中止錄音並把 `useStartFragmentRef` 設為 true，提示「請再按一次」。
  - 之後**每一次**按跟讀（包含第二句、第三句…）都執行 `org.src = 網址#t=起點` → 整份 22MB 重新下載 → 又遇到空窗 → 又誤判。
  - 對應問題 1：第 1 次誤判；第 2 次換網址又誤判；第 3 次碰巧已載好才成功。
- 判定失敗會 `abortRecording()`（取消句尾監看 `endWatchRef`、停錄音），再對原音 `pause()`。
  - 但當下 `play()` 可能還在等載入；推測 iPhone 載入完成後仍會開始播放。這時已經沒有任何句尾監看，`handleTimeUpdate` 也只在 `practiceState === 'recording'` 時才停 → 一路播下去（問題 2）。
- 起點偏移（問題 3）：
  - 按下當下的靜音解鎖 `org.play().then(pause)` 如果比 `seekSegmentStart` 第二次設定晚結束，原音會先往前走一小段，開頭被吃掉。
  - 另外，「調整時間」沒按儲存就去跟讀時，跟讀用的是已儲存的舊時間，畫面沒有提示。

## 相關檔案
- `src/components/ShadowingPracticeView.tsx`
- `src/utils/segmentEnd.ts`
- `src/utils/shadowingPlayback.ts`
- `src/utils/recordingTiming.ts`
- `src/components/MaterialDetailView.tsx`
- `src/components/SentenceTimeEditor.tsx`
- `src/components/MaterialReviewPanel.tsx`
- `tests/iosSeekGuard.test.ts`
- `tests/segmentEnd.test.ts`
- `docs/plans/ios-seek-fix.md`

## 做法（草案，待委員會評估）
### A. 跟讀改成「原音先就位，才開始錄音」
新增 `prepareSegmentStart(media, start, { timeoutMs, isCancelled })`（`segmentEnd.ts`），回傳 Promise<'ready' | 'timeout' | 'cancelled'>：
- **就位條件**：`readyState >= 2`、`!seeking`、`|currentTime - start| <= 0.25`
- **監聽事件**：loadedmetadata／loadeddata／canplay／seeked／timeupdate／pause；不在起點就再設定一次（補跳期間等 seeked 才判斷）
- **流程**（`handleStart`）：
  1. 點擊當下：設定起點 → 靜音解鎖 `play()`
  2. 等麥克風，同時等解鎖結束（解鎖 promise 結束後立刻暫停，最多等 N 秒）→ 重新設定起點 → `await prepareSegmentStart`
  3. ready → 開始 MediaRecorder → 等麥克風真的收音＋300ms → 套用語速 → 正式 `play()`
  4. timeout → 還沒錄音，可以安全地用 `網址#t=起點` 重新載入一次再等；仍不行就顯示「原音載入失敗，請檢查網路後再試」，不開始錄音
- **拿掉**：`useStartFragmentRef`、每次按跟讀都換網址、「請再按一次」的流程

### B. 起點確認（guardSegmentStart）改成不誤判；所有播放入口共用
- 只在 `readyState >= 2 && !seeking && !paused`，而且**播放位置確實在前進**（和上一次 timeupdate 比有增加）時判斷
- 補跳後要等 seeked（或位置前進）才算一次結果；連續確認不對才算失敗
- 跟讀錄音中失敗：中止並顯示診斷（不改網址）

### C. 原音絕不超過句尾（跟讀畫面的安全網）
- 跟讀畫面的 `timeupdate`：不論 practiceState（錄音中、倒數中、中止後、聽聽看），只要原音在播而且 `currentTime >= endTime` 就暫停
- 中止時若 `play()` 還在等：在它的 then／下一次 playing 時立刻暫停（中止旗標）

### D. 時間一致
- 跟讀畫面顯示「播放範圍 12.40s ～ 15.80s」
- 調整時間有未儲存的修改，要按「跟讀」、開另一句的調整時間或離開詳情頁時，跳出提醒：儲存／不儲存（擁有者 2026-11-10 決定）
  - 「取消」按鈕本身就是放棄修改，不提醒
- 調整時間的播放片段／聽句尾與跟讀共用 seekSegmentStart → guard → watchSegmentEnd

### 預判的細節
- 網路慢：準備中顯示載入狀態；換句、離開、鎖屏時取消準備並拆監聽
- 重新載入會把 playbackRate 重設成 1 → 就位後才套用語速
- iPhone 播放權限：點擊當下解鎖過，之後的 `play()` 仍允許
- 解鎖被拒絕：沿用「無法播放教材音訊」
- 聽聽看共用同一個 `<audio>`：同樣套用 B、C
- 連按、評分中換句：沿用 `startingRef`／`scoringTokenRef`

## 驗收條件
1. 模擬 iPhone：載入初期 currentTime 回報 0、seeking false，之後才跳到起點 → 不判定失敗、不中止錄音 ✅
2. 解鎖播放比較晚結束（原音先往前走）→ 錄音開始前拉回起點 ✅
3. 原音沒就位前不開始 MediaRecorder ✅
4. 就位逾時 → 用 `#t=` 重新載入一次（錄音前）；仍失敗 → 顯示訊息、不錄音 ✅
5. 跟讀的程式不再有「每次按跟讀都換 src」✅
6. 中止時 play() 還在等 → 開始播放時立刻暫停 ✅
7. 原音在任何狀態播過句尾都暫停 ✅
8. 跟讀畫面顯示播放範圍；調整時間未儲存時跳提醒 ✅（原始碼）＋ 👀
9. 聽句尾維持句尾後多播 0.5 秒 ✅
10. 👀 iPhone 正式版：新舊教材各 3 句（含第二句、後段句），每句第一次按就從句首播、停在句尾；和調整時間的播放片段範圍一致

## 手動試用步驟
1. iPhone 開啟教材詳情頁，選一句按「調整時間」→ 播放片段，記下範圍；改一點時間不儲存，直接按跟讀 → 應跳提醒
2. 儲存後按跟讀：第一次就要從句首播、停在句尾，畫面顯示的範圍與調整時間一致
3. 按下一句連續跟讀 3 句；每句都一次成功、都停在句尾
4. 換一份舊教材重複 2～3

## 不要做的事
- 不改評分規則、不改資料結構、不改聽句尾的 0.5 秒

## 資料相容與備份
- 不改 Firestore 結構；調整時間沿用既有的儲存（交易）

## 新增套件
無

## 定案（委員會＋Codex 第一輪後，擁有者 2026-11-10 核准）
- 原因分析目前是**推測**（Codex：依規範，未載入時讀 currentTime 應回傳預設起點，pause 也會取消等待中的 play）→ 加「播放診斷紀錄」，在 iPhone 上找真正的原因
- A：點擊當下設定起點 → 靜音解鎖（一開始播就暫停）→ 等麥克風與解鎖（最多等 `UNLOCK_WAIT_MS = 1500`；還在載入就讓它靜音繼續載入，避免 iPhone 暫停後不再載入）→ `prepareSegmentStart`（`PREPARE_TIMEOUT_MS = 6000`）→ 暫停、取消靜音、拉回句首 → 才開始錄音
  - 就位：`readyState >= 1`、`!seeking`、`|currentTime - 起點| <= 0.25`（DeepSeek：iPhone 暫停時 readyState 可能停在 1，不要求 2）
  - 逾時：**不重新載入**（Gemini：換 src 可能讓 iPhone 播放權限失效，又要整份重新下載）→「原音載入失敗，請檢查網路後再試」，不錄音
  - 取消：換句、離開（isCancelled）、頁面隱藏
- B：guardSegmentStart 只在 `!paused && !seeking && readyState >= 2` 且**連續兩次看到位置前進**後才判斷；補跳後重新取樣。跟讀錄音中失敗 → 停止並請使用者複製診斷紀錄
- C：原音每次 `playing` 都掛上精準句尾監看（Codex：只靠 timeupdate 會多播約 0.25 秒）；另有 timeupdate 安全網，任何狀態播過句尾都暫停。誤差上限：句尾後 0.1 秒（擁有者）
- D：跟讀畫面顯示「播放範圍 12.40s ～ 15.80s」；調整時間未儲存 → 按跟讀、開另一句調整時間、返回時提醒「儲存／不儲存」（另有「取消」留在原處）；按儲存後等教材資料更新成新時間才繼續
- 播放診斷紀錄：跟讀畫面「複製診斷紀錄」按鈕（問題解決後拿掉，擁有者）
- 測試：擁有者同意把 PR #42 `tests/iosSeekGuard.test.ts` 中「一播放就判斷」的斷言改成「位置前進後才判斷」，並拿掉「改用 #t= 載入」的接線斷言

## 決策紀錄
- 2026-11-10 擁有者：等待就位 6 秒；加「複製診斷紀錄」（問題解決後拿掉）；句尾誤差上限 0.1 秒；同意修改 PR #42 的起點確認測試
- 2026-11-10 擁有者：中級、先開委員會；調整時間未儲存 → 跳提醒「儲存／不儲存」；聽句尾 0.5 秒維持（2026-11-09）

## 進度紀錄
- 2026-11-10 審查第 1 輪：Codex、Gemini 皆無意見；verify／guard 通過（guard 注意：iosSeekGuard 4 行斷言依擁有者同意改寫、armEndWatch 的 effect 加 exhaustive-deps 註解）
- 2026-11-10 驗收測試 commit `0971f11`；實作完成，check.sh 通過；Chromium 實測（preload=none 新播放器，起點 45.3／300／500 秒）：就位成功、起點確認沒有誤判、句尾超出 0.004～0.012 秒
- 2026-11-10 建立規劃；委員會（Gemini、Nemotron、DeepSeek；Poolside 已下架）＋Codex 第一輪完成；擁有者核准（等待 6 秒、診斷紀錄問題解決後拿掉、句尾誤差 0.1 秒、同意修改 #42 測試）
