# 規劃：影子跟讀辨識改善（耳機提醒、錄音時原音調小聲、重疊播放）

- **級別**：大（擁有者 2026-10-28 決定；改到跟讀練習的播放與錄音流程）
- **PR**：#20
- **狀態**：規劃中

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

## 做法
### 音量控制（重點：iPhone）
- iOS Safari 的 `HTMLMediaElement.volume` **唯讀**（設了也是 1），所以：
  - 新純函式 `canSetElementVolume(el)`：設 0.5 後讀回是否為 0.5，再設回 1
  - 可以設 → 直接用 `audio.volume`（Android、桌機）
  - 不能設（iOS）→ 用 Web Audio：`createMediaElementSource(audio) → GainNode → destination`
- Web Audio 的限制與處理：
  - 一個 `<audio>` 只能建立一次 `MediaElementSource`，建立後聲音只從 AudioContext 出來 → 建立一個**專用、跟著元件存活**的播放 AudioContext（在使用者點擊當下建立並 `resume()`），每次播放前確認是 running
  - 跨網域音檔（Firebase Storage 的 `audioUrl`）接 Web Audio 需要 CORS；沒有 CORS 時會**完全沒聲音**。所以只在需要 Web Audio 的平台設 `crossOrigin="anonymous"`；若載入失敗（`error` 事件）→ 拿掉 `crossOrigin` 重新載入，**這台裝置就不調音量**（照舊 100% 播放），不讓練習壞掉
  - 沙盒連不到 Firebase Storage，無法事先確認 CORS；列為手動試用必驗項目
- 新純函式（`src/utils/shadowingAudio.ts`）：
  - `RECORDING_ORIGINAL_VOLUME = 0.5`、`OVERLAY_ORIGINAL_VOLUME = 0.5`
  - `canSetElementVolume(el)`
  - `overlayOffsetMs(recordStartAt, originalPlayingAt)`：原音實際開始播放（`playing` 事件）比錄音開始晚多少毫秒，夾在 0～1500；重疊播放時錄音先播、原音晚這麼多再播，讓兩段對齊
  - `shouldShowHeadphoneTip(storage)`、`dismissHeadphoneTip(storage)`：讀寫 localStorage 鍵 `huanux_headphone_tip_dismissed`，storage 不可用時視為「要提醒、但不擋練習」

### 耳機提醒卡
- 沿用 `ConfirmDialog` 的外觀（底部彈出、`role="dialog"`、`aria-modal`、Esc＝取消、開啟時焦點在「開始跟讀」）
- 「開始跟讀」必須在**同一次點擊**裡呼叫 `handleStart`（iPhone 只允許使用者點擊當下啟動播放與錄音）

### 重疊播放
- 錄音 blob（同網域 blob URL）＋原音（`audioRef` 跳到 `sentence.startTime`、播到 `endTime` 停止）
- 停止、換句、離開、重錄時一律停掉兩邊並清掉計時器（沿用既有 `scoringTokenRef` 過期判斷）

## 驗收條件
1. ✅ `canSetElementVolume`：可設／不可設（模擬 iOS 讀回 1）／設定時丟錯 都正確；結束後音量還原為 1（`tests/shadowingAudio.test.ts`）
2. ✅ `overlayOffsetMs`：正常延遲、負值→0、超過上限→1500、缺值→0（同上）
3. ✅ 耳機提醒：沒設過→要提醒；按不再提醒後→不提醒；storage 讀寫丟錯→要提醒且不丟錯（同上）
4. ✅ 音量常數為 0.5（擁有者決定，守住不被隨手改）（同上）
5. ✅ 文案：新文案存在；既有「請戴上耳機練習。…」「重播我的錄音」「開始跟讀」等仍在（`tests/uiCopyShadowingAudio.test.ts`＋既有 `tests/uiCopy.test.ts`）
6. ✅ 結構：提醒卡 `role="dialog"`、`aria-modal`；`crossOrigin` 只在 Web Audio 路線設定且有載入失敗退回；錄音開始時套用錄音音量、結束時還原（同上）
7. 👀 iPhone（Safari）沒戴耳機：錄音時原音明顯變小聲；結果頁三個按鈕都能播，重疊播放兩段對齊；**原音不會變成完全無聲**（CORS 檢查）
8. 👀 Android 或電腦：同上
9. 👀 第一次跟讀出現提醒卡；勾「不再提醒」後重新整理不再出現；不勾則下次仍出現
10. 👀 辨識改善：同一句、同一支手機、沒戴耳機，改版前後各念 3 次，比較「您實際念的內容」與分數

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

## 進度紀錄
- 2026-10-28：建立分支 `ai/shadowing-audio` 與規劃文件
