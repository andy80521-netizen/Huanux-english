# 規劃：影子跟讀辨識改善（耳機提醒、錄音時原音調小聲、重疊播放）

- **級別**：大（擁有者 2026-10-28 決定；改到跟讀練習的播放與錄音流程）
- **PR**：#20
- **狀態**：完成，待擁有者實機試用與 Merge

## 目標
使用者反應：影子跟讀辨識不到、分數很低；語言模型複習辨識很準。

### 原因分析（Claude 對照程式碼）
- 兩邊用**同一套**語音轉文字（`transcribeRecording`：Gemini → Whisper 備援，同一個 `TRANSCRIBE_PROMPT`），麥克風設定也一樣（`getUserMedia({ audio: true })`，瀏覽器預設開回音消除、降噪）
- 差別：**跟讀是邊播原音邊錄音**（`ShadowingPracticeView.handleStart` 同時 `mediaRecorder.start()` 與 `audio.play()`）；語言模型複習錄音時不播任何聲音
- 反應的使用者是**手機、沒戴耳機**：喇叭的原音被麥克風收進去，回音消除在「雙方同時講話」時常連使用者的聲音一起壓低 → 錄到的人聲斷斷續續 → 轉錄缺字 → 內容分數低

### 擁有者選擇（方案 A：保留邊播邊錄）並加上三項緩解
1. **第一次開始跟讀前的耳機提醒**：從下方彈出說明卡，按「開始跟讀」直接開始；勾「不再提醒」之後這台裝置不再出現（存瀏覽器 localStorage，讀寫都包 try/catch；不寫 Firestore）。原本按鈕旁的耳機提示文字保留
2. **錄音時原音調小聲**：錄音期間原音音量 50%（擁有者同意先用 50%，試用後再調）；錄音中多一行小字「錄音時原音會調小聲，讓你的聲音更清楚」；錄音結束、試聽原音時恢復 100%
3. **結果頁「聽聽看」**：三個按鈕「我的錄音」「原音」「重疊播放」
   - 重疊播放＝你的錄音（100%）＋原音這一句（50%）同時開始；兩條波形動畫（減少動態時靜止）
   - 播放中再按一次＝停止；按另一個按鈕＝先停掉正在播的再播新的
   - 評分完成後仍自動播放「我的錄音」（維持現狀）
   - 「我的錄音」按鈕的 `aria-label` 用既有文案「重播我的錄音」（守門測試要求保留，且可見文字包含在名稱裡）

### 不會改的
- 語音轉文字、評分公式、通過門檻、熟練度規則
- 不把原句交給轉錄 AI 當提示（會讓分數灌水）
- 不關閉回音消除（沒戴耳機時原音會整段錄進去）

## 背景與使用情境
- 使用者多半用手機、沒戴耳機練跟讀
- 這三項是「減輕」而不是保證解決：沒戴耳機時原音仍會進麥克風，效果要在實機確認

## 設計依據
- 設計畫布「Huanux 視覺方向提案」：「跟讀辨識改善」那一列（耳機提醒、錄音中、結果頁聽聽看）

## 相關檔案
- `src/components/ShadowingPracticeView.tsx`
- `src/components/MaterialDetailView.tsx`
- `src/utils/mediaRecorder.ts`
- `src/services/gemini.ts`
- `src/utils/scoring.ts`
- `src/components/ui/Button.tsx`
- `src/components/ConfirmDialog.tsx`
- `tests/uiCopy.test.ts`

## 做法（委員會第一輪後修訂）
> **2026-10-28 擁有者決定先不設定 Firebase Storage 的 CORS** → 本 PR **不實作 Web Audio 路線**：不能設定 `audio.volume` 的裝置（iPhone／iPad）不調音量、改顯示「建議戴耳機，讓收音更清楚」。下方 Web Audio／CORS 相關段落保留作為日後設定 CORS 後的做法參考，本 PR 不做；`<audio>` 不加 `crossOrigin`，因此不會有「原音變無聲」的風險（Codex 🔴 的情境不會發生）。

### 音量控制（重點：iPhone）
- iOS／iPadOS（Safari 與 iOS 上的 Chrome）的 `HTMLMediaElement.volume` **唯讀**（設了也是 1）
- `canSetElementVolume()`：**只在一個暫時建立、沒有載入任何音檔的 `new Audio()` 上偵測一次並快取**（設 0.5 讀回、丟錯視為 false），不碰正在用的原音元素（Grok、DeepSeek）
- 可以設 → 直接用 `audio.volume`（Android、桌機，含桌機 Safari）
- 不能設（iOS）→ Web Audio：`createMediaElementSource(audio) → GainNode → destination`
- **CORS 是 iOS 這條路的前提**（Codex 🔴、DeepSeek、Grok、Nemotron）：
  - 跨網域音檔接 Web Audio 必須有 CORS；沒有時依規範輸出**靜音**，而且一個元素一旦建立 `MediaElementSource` 就拆不掉
  - 所以：需要 Web Audio 的平台在**元件掛載時**就以 `crossOrigin="anonymous"` 載入（`crossOrigin` 必須在 `src` 之前生效）；**只有在這個元素成功載入（`canplay`）之後才建立 `MediaElementSource`**
  - 載入失敗（`error`）→ 用新的 React `key` 換掉 `<audio>`，產生一個**從未接過 Web Audio、沒有 `crossOrigin`** 的新元素，照舊 100% 播放；這台裝置本次不調音量，畫面改顯示替代說明（見下）
  - Firebase Storage 是否已設 CORS 無法從沙盒確認（連不到），需擁有者決定（見「需要擁有者決定」）
- 播放用 AudioContext 與麥克風分析用的 `audioContextRef` **分開**（`playbackCtxRef`），只在元件卸載時 close；每次播放前 `resume()`；開麥後再確認一次是 running（iOS 開麥可能把它暫停）（DeepSeek、Grok）
- StrictMode 重掛：`MediaElementSource` 以元素為鍵快取，不重複建立（Grok）
- **音量一定會還原**：集中在一個 `restoreOriginalVolume()`，由 `onstop`、`abortRecording`、`handleRetry`、換句 effect、`onBack`、卸載、`play()` 失敗、評分失敗都呼叫（DeepSeek、Grok）

### 錄音中的說明文字（依裝置能力）
- 能調小聲：「錄音時原音會調小聲，讓你的聲音更清楚」
- 不能調（CORS 失敗或 Web Audio 不可用）：「建議戴耳機，讓收音更清楚」（新文案，需擁有者核准）
- 放在既有 `aria-live="polite"` 的狀態區裡（Grok）

### 耳機提醒卡
- 外觀沿用 `ConfirmDialog`（底部彈出、`role="dialog"`、`aria-modal`、Esc＝取消、開啟時焦點在「開始跟讀」）
- 卡上「開始跟讀」在**同一個 click handler 裡同步呼叫 `handleStart`**（不經 setState＋effect），點卡上按鈕本身就是使用者手勢，iPhone 的播放／錄音權限不受影響（Gemini 的疑慮已處理）
- localStorage 鍵 `huanux_headphone_tip_dismissed_v1`（帶版本，日後改文案可再提醒一次）（Grok）；取得 `window.localStorage` 本身也包 try/catch（DeepSeek）
- 「不再提醒」本次不做重設入口；清除瀏覽器資料即可恢復

### 結果頁「聽聽看」
- 抽成可測試的播放控制器 `src/utils/shadowingPlayback.ts`（`createListenPlayer`）：注入「錄音元素」「原音元素」「設定原音音量的函式」「時鐘／計時器」，不直接碰 DOM，Vitest 用替身元素與 `vi.useFakeTimers()` 驗行為（Codex 🟠；不新增套件）
- 「原音」與重疊播放只播**這一句**（`startTime`～`endTime`）；`endTime` 無效（≤ startTime 或 0）時改用錄音長度當上限，不會播到整份教材結尾（DeepSeek、Grok）
- 句尾停止由控制器自己的計時／`timeupdate` 判斷，不依賴目前只在 `recording` 狀態運作的 `handleTimeUpdate`（Codex）
- 重疊播放：錄音先播，原音延後 `overlayOffsetMs` 再播（原音 50%）；原音播完、錄音繼續到結束（DeepSeek）
- 對齊基準：錄音起點用 `MediaRecorder` 的 `start` 事件時間，原音起點用 `play()` 前掛上的 `playing` 事件時間；延遲上限 3000ms，只用來擋壞掉的時間戳（Grok）
- 互斥：按另一個按鈕＝先停兩路再播；播放中再按同一個＝停止；三個按鈕用 `aria-pressed` 反映狀態；自動播放「我的錄音」也同步成播放中狀態（Grok）
- 控制器有自己的世代號：停止、換句、重錄、離開都會讓延遲中的回呼失效（`scoringTokenRef` 在重錄時不會變，不能只靠它）（Grok）
- 波形是裝飾動畫（`aria-hidden`，減少動態時靜止），不分析音訊（DeepSeek、Grok）

### 新純函式（`src/utils/shadowingAudio.ts`）
- `RECORDING_ORIGINAL_VOLUME = 0.5`、`OVERLAY_ORIGINAL_VOLUME = 0.5`
- `canSetElementVolume(probe)`
- `overlayOffsetMs(recordStartAt, originalPlayingAt)`：夾在 0～3000，缺值為 0
- `sentenceSegment(startTime, endTime, recordingSec)`：回傳要播的起訖秒數（`endTime` 無效時用錄音長度）
- `shouldShowHeadphoneTip(getStorage)`、`dismissHeadphoneTip(getStorage)`

## 驗收條件
1. ✅ `canSetElementVolume`：可設／不可設（模擬 iOS 讀回 1）／設定時丟錯 都正確；結束後音量還原為 1（`tests/shadowingAudio.test.ts`）
2. ✅ `overlayOffsetMs`：正常延遲、負值→0、超過上限→3000、缺值→0；`sentenceSegment`：正常、`endTime` 為 0 或小於開始時用錄音長度（同上）
3. ✅ 耳機提醒：沒設過→要提醒；按不再提醒後→不提醒；取得 storage 或讀寫丟錯→要提醒且不丟錯（同上）
3a. ✅ 播放控制器（`tests/shadowingPlayback.test.ts`，替身元素＋假計時器）：原音播到句尾自動停；`endTime` 無效時以錄音長度停；重疊播放錄音先播、原音延後 offset 再播且音量 0.5；按另一個按鈕先停兩路；同一個再按＝停止；停止／換句後延遲中的回呼不會再啟動播放；結束後原音音量還原 1
4. ✅ 音量常數為 0.5（擁有者決定，守住不被隨手改）（同上）
5. ✅ 文案：新文案存在；既有「請戴上耳機練習。…」「重播我的錄音」「開始跟讀」等仍在（`tests/uiCopyShadowingAudio.test.ts`＋既有 `tests/uiCopy.test.ts`）
6. ✅ 結構：提醒卡 `role="dialog"`、`aria-modal`；元件使用 `createListenPlayer`、`restoreOriginalVolume` 在換句／重錄／卸載路徑都有呼叫；**原音 `<audio>` 不設 `crossOrigin`、不使用 `createMediaElementSource`**（本 PR 不做 Web Audio）（同上，原始碼守門只做輔助，行為以 3a 為準）
7. 👀 iPhone（Safari）沒戴耳機：錄音時原音明顯變小聲；結果頁三個按鈕都能播，重疊播放兩段對齊；**原音不會變成完全無聲**（CORS 檢查）
8. 👀 Android 或電腦：同上
9. 👀 第一次跟讀出現提醒卡；勾「不再提醒」後重新整理不再出現；不勾則下次仍出現
10. 👀 辨識改善：同一句、同一支手機、沒戴耳機，改版前後各念 3 次，比較「您實際念的內容」與分數（樣本小，只看「斷斷續續」有沒有改善，不當成統計結論）
11. 👀 **靜音對照**：按開始跟讀後完全不出聲，看分數是否很低；若分數不低，代表模型把喇叭漏進來的原音當成你念的（Grok）
12. 👀 iPhone：原音維持原本音量且正常有聲，錄音中說明文字是「建議戴耳機，讓收音更清楚」

## 手動試用步驟
1. 預覽網站用 **Email 測試帳號**登入（手機 Safari）
2. 進一份有原音的教材 → 點一句「跟讀」→ 按「開始跟讀」：應出現提醒卡；按卡上「開始跟讀」
3. 錄音中注意原音是否變小聲、小字說明是否出現
4. 結果頁按「我的錄音」「原音」「重疊播放」各一次；重疊播放中再按一次應停止
5. 「再念一次」→ 不應再出現提醒卡（除非沒勾不再提醒）
6. 用正式網站（改版前）同一句念 3 次記下分數，再用預覽網站念 3 次比較

## 不要做的事
- 不改語音轉文字、提示詞、評分、通過門檻、熟練度
- 不新增套件
- 不改其他頁面的播放（教材詳情、複述）

## 資料相容與備份
- 不改 Firestore；提醒只存瀏覽器 localStorage
- 不需要備份

## 新增套件
- 無

## 決策紀錄
- 2026-10-28：擁有者確認使用者情境為「手機、沒戴耳機」；選方案 A（保留邊播邊錄）＋錄音時原音調小聲、重疊播放、練習前耳機提醒；不做「辨識失敗不算分」；級別「大」
- 2026-10-28：擁有者核准設計稿與文案；錄音時原音先用 50%
- 2026-10-28：擁有者同意 iPhone 提醒卡文字「沒有耳機也可以練，但這台裝置無法自動調小原音。」
- 2026-10-28：擁有者核准整合後規劃；**先不設定 Storage CORS**（iPhone 不調音量）；不能調音量時的說明文字「建議戴耳機，讓收音更清楚」；有戴耳機也一律 50%

## 進度紀錄
- 2026-10-28：建立分支 `ai/shadowing-audio` 與規劃文件，開草稿 PR #20；委員會（Gemini Lite、Nemotron、Poolside、DeepSeek、Grok）＋Codex 第一輪全部回覆，已整合

## 委員會整合（第一輪）
### 採納
- iOS 的 CORS 退回不能沿用已接 Web Audio 的元素：只在 `canplay` 後才建立 source，失敗就換新元素（Codex 🔴、DeepSeek、Grok、Nemotron）
- 播放流程要有行為測試：抽出播放控制器，用替身元素與假計時器測（Codex 🟠）
- 偵測音量能力用暫時元素、只偵測一次（Grok、DeepSeek）
- 播放與麥克風分析的 AudioContext 分開；音量在所有中斷路徑都還原（DeepSeek、Grok）
- 「原音」只播這一句、`endTime` 無效的處理；對齊用 MediaRecorder start 與 playing 事件、上限 3000ms（DeepSeek、Grok）
- 說明文字依裝置能力切換、放進 aria-live 區；按鈕 aria-pressed（DeepSeek、Grok）
- localStorage 鍵帶版本；靜音對照列入手動試用（Grok）
### 駁回或不做
- 改掉提醒卡、只在按鈕旁放勾選框（Gemini）— 點卡上的按鈕本身就是使用者手勢，只要同步呼叫 `handleStart` 就不會被 iPhone 擋；設計稿已核准
- 「不再提醒」後不顯示原本的耳機提示文字（Poolside）— 守門測試要求保留，且不提醒卡≠不提示
- 用真實波形（Grok 提問）— 會再搶一次 MediaElementSource、增加負擔
- 支援 LINE 等 App 內建瀏覽器（DeepSeek、Grok）— 本次不處理，麥克風與自動播放原本就不可靠
- 2026-10-28：驗收測試 commit `baa3101`（`tests/shadowingAudio.test.ts`、`tests/shadowingPlayback.test.ts`、`tests/uiCopyShadowingAudio.test.ts`），修改前失敗
- 2026-10-28：實作完成：`utils/shadowingAudio.ts`、`utils/shadowingPlayback.ts`、`ShadowingPracticeView`（耳機提醒卡、錄音時原音 50%、依裝置切換說明、結果頁聽聽看）、`app.css` 波形動畫；`check.sh` 通過（734 測試）
  - 自我檢查（本機假資料預覽，含模擬 iPhone 音量唯讀）：提醒卡出現、焦點在「開始跟讀」、勾不再提醒後不再出現；錄音中原音 0.5（模擬 iPhone 維持 1 並顯示「建議戴耳機…」）；評分後音量還原 1；自動播放時「我的錄音」為按下狀態；重疊播放按下／再按停止
  - 提醒卡第二段在不能調音量的裝置改為「沒有耳機也可以練，但這台裝置無法自動調小原音。」（避免顯示不實的「會自動調小聲」；待擁有者確認文字）
- 2026-10-28：審查第 1 輪（`5ebef8b`）：Codex 🟠、Gemini 🟠 保險計時會在緩衝延後時截斷句尾 → 到期時原音有前進就繼續檢查、沒前進才停，補 2 條測試（只新增）；Gemini 🟡 自動播放被擋時仍顯示播放中 → play() 成功後才同步狀態
- 2026-10-28：審查第 2 輪（`a0b970b`）：Codex、Gemini 皆無意見；合入最新 main，完成
