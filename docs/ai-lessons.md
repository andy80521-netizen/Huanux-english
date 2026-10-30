# AI 協作經驗紀錄

Claude 每完成一個功能就更新這份文件；開工前先讀。累積約 5 個功能後，依「委員表現」調整委員名單。

## 專案地雷
<!-- 容易出錯的地方、隱藏的相依關係、環境差異 -->
- 預覽網站（Netlify deploy preview）連的是**正式 Firebase**（`src/firebase.ts` 寫死專案），試用一律用測試帳號
- 預覽網站的 Netlify functions 使用正式的 Gemini／OpenAI 金鑰，試用會產生 API 費用
- 預覽網站**無法用 Google 登入**（2026-10-30 起取代 GitHub 登入；每個 PR 網址不同，不在 Firebase 授權網域）；手動試用一律用 **Email 測試帳號**
- Firebase 專案 `huanux-english` 的帳號系統與 CasHu（Google 登入、另一個具名 Firestore 資料庫）共用：未驗證的 Gmail 帳號第一次用 Google 登入時，Firebase 會**移除原本的密碼登入**（UID 不變、資料還在），用「忘記密碼？」或主控台重設密碼即可恢復（2026-10-30 擁有者遇到）
- push 後幾秒內就轉正式審查，PR 驗證與防作弊檢查可能都變成 skipped；`gh_ai.py wait` 會自動偵測並關閉再重開 PR 重新觸發
- Gemini Flash 免費版經常 HTTP 503（過載，PR #2、#4 都發生）；委員會與 Gemini 審查會自動重試，仍失敗時依序改用其他 Gemini 模型（可用 variable `AI_GEMINI_FALLBACK` 調整），審查最後才改用 DeepSeek
- 2026-10-27 起 Gemini 指定 `gemini-3.8-flash`（免費版最新 Flash），不用 `gemini-flash-latest` 別名（依 Google 更新紀錄，別名當時指向 3.5 Flash，該模型 10/8 起被導向 3.6 Flash）；回覆會附上 Google 回報的實際模型。Pro／Argon 只能付費
- Gemini 免費版（Default Gemini Project）額度：3.8 Flash 每分鐘 5 次、每日很少（2026-10-27 兩次審查加重試就用滿）；3.5 Flash Lite 每分鐘 15 次。Gemini 429 不重試、直接換 Flash Lite。付費專案 huanux-paid（Tier 1）有 Gemini 4 Argon／3.8 Flash 大額度，需要時可改用該專案的金鑰
- main 已設保護規則（必須透過 PR）：2026-10-27 有工作階段在 repo 剛加入、尚未讀到 CLAUDE.md 時直接推送到 main（ceb931e）
- Codex 審查偶爾卡在「Running」超過 30 分鐘（PR #3）；超過 15 分鐘就推送新版本或再留言 `@codex review` 一次
- 只改 `docs/` 的推送不會重建預覽網站（`netlify.toml`），所以預覽網址可能停在上一個程式版本，這是正常的
- 2026-10-27 起 Tailwind 為 v4 建置（`src/styles/app.css`），不再用 CDN。v4 與舊 v3 同名但大小不同：`shadow-sm`、`blur-sm`、`backdrop-blur-sm`、`outline-none` 要用 `-xs`／`outline-hidden`；`flex-shrink-*`、`flex-grow-*` 已移除（改 `shrink-*`、`grow-*`）。官方 `@tailwindcss/upgrade` 在沒有 v3 設定檔時不會做這些改名，要自己處理並對照 build 出來的 CSS
- `indigo`／`slate` 色階已改成 A「靜讀」的玉綠／帶綠中性灰（靜態、不隨深色模式變），新程式優先用語意色 `bg-ground`、`text-ink`、`bg-accent` 等
- `ShadowingPracticeView` 的「Cleanup on unmount」effect 依賴 `recordedBlobUrl`，**每次錄音結束都會重跑**，不是只在離開時跑；要在離開時才做的事（例如換句計數）必須放在 `[]` 依賴的 effect
- 會讓使用者在非同步流程中途換畫面的功能（例如跳句），要逐一檢查每個 `await`（`getUserMedia`、`audioCtx.resume`、轉錄、寫入）回來後是否已過期
- 畫面自檢可用本機假資料預覽：另建 vite 設定，把 `../firebase`、`firebase/firestore`、`firebase/storage`、`services/gemini` 換成模擬模組，Chromium 加 `--use-fake-device-for-media-stream` 可跑完整錄音流程；Tailwind 要用 `@source` 指到 repo 的 `src`
- 本機 build 沒有 `GEMINI_API_KEY` 時整頁空白（Gemini SDK 載入時就拋錯），本機截圖要用 `GEMINI_API_KEY=placeholder… npx vite build`；沙盒連不到 Google Fonts 與 Firebase，截圖會是備援字體＋未登入畫面

- 桌機驗收不能只看 1280px：App 有 232px 側欄，1024px 時三欄卡片內寬只剩約 165px（PR #12 按鈕溢出）。窄卡片內的排版用 container query（`@container`＋`@[16rem]:flex-row`），不要只靠視窗斷點
- 匯入頁、複述頁都是「頁面內」捲動容器：新內容出現在下方（解析結果、複述回饋）時使用者看不到，要 `scrollIntoView`；切換到另一個畫面（進入校對）時要把捲動位置歸零
- 本機假資料預覽要模擬匯入流程時，`doc()` 模擬必須回傳 `id`，否則存檔會走到沒有 materialId 的舊分支，看起來像程式錯誤

- 熟練度寫入用 `updatePatternSentences`（Firestore 交易）：更新函式可能重試，外部變數要在函式開頭清空，並以回傳值（null＝沒寫入）判斷是否真的提交（PR #13）
- 「練習後」的畫面不要只靠 `onSnapshot` 的最新資料：監聽可能晚到，完成畫面會先顯示 +0。練習期間自己記一份「真的寫入的結果」（PR #13 的 `onMasteryUpdated`）
- 同一個元件放在不同寬度的頁面（例如練習畫面同時出現在 1200px 與 768px 的頁面）時，雙欄用 container query（`@container`＋`@[60rem]:`），不要用 `lg:`
- 本機假資料預覽要測寫入流程時，Firestore 模擬要支援 `runTransaction` 的 `get`／`update` 並重新通知監聽；錄音用 `--use-file-for-fake-audio-capture=<靜音 wav>`，靜音偵測才會自動停止
- `Button` 元件的基本 class 有 `inline-flex`，直接加 `hidden lg:inline-flex` 不會隱藏（PR #14 手機出現兩個刪除鈕）；要在外面包 `<span className="hidden lg:block">`
- React 19＋TS：檔案內的區域函式元件被傳 `key` 會型別錯誤，宣告成 `React.FC<Props>`
- iPhone／iPad 的 `audio.volume` 唯讀（設了讀回仍是 1）；要調音量只能走 Web Audio，而跨網域音檔（Firebase Storage）接 Web Audio 需要 CORS，沒有時依規範輸出靜音且元素拆不回來。2026-10-28 擁有者決定先不設 Storage CORS（PR #20）
- 跟讀是「邊播原音邊錄音」：手機沒戴耳機時原音進麥克風、回音消除會連人聲一起壓 → 辨識差。語言模型複習錄音時不播聲音，所以辨識好（兩邊用同一套轉錄）
- 語言模型複習舊版從按下錄音就算 1.5 秒靜音：回想句子或中途停頓會被切斷 → 開口前 5 秒、開口後 2.5 秒（PR #22）；評分時長仍用「最後出聲 + 1.5 秒」，避免同樣的朗讀分數變低
- 跟讀改成先錄音、錄音真正開始後 300ms 才播原音；原音在 await 之後才播放，iPhone 要在點擊當下先靜音 play/pause 解鎖（PR #22）
- 語音轉文字主力 2026-10-30 起是 Groq `whisper-large-v3`（`netlify/shared/transcribe.ts`）→ OpenAI `whisper-1` → Gemini（只用 Flash，不用 flash-lite）。Netlify 函式整條鏈 9 秒內完成；空字串是合法結果（沒有人聲），與服務失敗分開（PR #23）
- Gemini SDK 的 `response.text` 在沒有文字時是 undefined：要看 `finishReason` 分辨「正常的空白」與「被擋下」（PR #23）
- 驗收測試只比對原始碼字串時，抽掉關鍵的 await 也會通過；時序類需求要抽成函式、用假計時器測行為（PR #22，Codex）
- 播放「一句」的保險計時不要從 play() 起算就硬停：網路緩衝會截斷句尾；到期時看 currentTime 有沒有前進（PR #20）
- 讀取狀態的「已有資料」要看實際筆數：空集合的 snapshot 之後監聽失敗，若當成已有資料就會停在空狀態、沒有重試（PR #16）
- 同一份規格跨 PR 會互相牽動：③a 的測試鎖住了 `WIDE_TABS`，④ 拿掉時要先問擁有者改測試；規劃時就先 `grep tests` 找出會被影響的舊斷言
- 轉場動畫的 `animation-fill-mode` 不要用 `both`／`forwards`：Chrome 會把結束值 `transform: none` 留成 identity matrix，祖先仍是 `position: fixed` 的定位容器；用 `backwards`（PR #18）
- 全域「減少動態」規則只縮短時間不夠，`animation-delay`／`transition-delay` 也要歸零，否則逐列延遲期間元素是透明的（PR #18）
- `onSnapshot` 一定要處理錯誤回呼：Firestore 出錯後會結束該監聽，只印 console 會讓畫面永遠停在「載入中」；文件監聽也要處理 `exists()` 為 false。重試用 `retryKey` 放進 effect 依賴重新訂閱（PR #15）
- 用正則檢查原始碼的驗收測試，`[\s\S]*?` 可能跨到別處的程式而誤判通過；寫完要確認修改前真的會失敗（PR #15 有一條原本誤判通過，推送前已收緊）
- 文案守門測試用正則抓屬性時，`onChange={(e) => …}` 裡的 `=>` 會讓 `[^>]*` 提早結束；className 放在事件屬性前面
- 評分比對的英美拼字對照在 `src/utils/spellingVariants.ts`：只收發音相同的拼法、全部明確列出；不要加 `-our→-or`、`-ise→-ize` 通用規則（會誤改 hour、rise、promise），也不要做「相鄰兩字合併」（now here／nowhere 會被算對）（PR #24）
- 個人頁同步狀態由 `App.tsx` 的 `createConnectionWatcher`（`src/utils/syncStatus.ts`）決定；只偵測網路與恢復連線後的上傳、以及 `syncError`，有網路時單筆寫入被拒絕不會反映在這裡（PR #26）
- `tests/uiCopyBadgesProfile.test.ts` 規定 `animate-pulse` 一定要加 `motion-safe:`（減少動態時不閃）

## 防作弊機制的已知限制（2026-10-25 多輪攻擊測試後）
- 「把斷言改弱」「mock 掉被測程式」「程式偵測測試環境」只能列為 ⚠️ 注意事項，無法自動判定是否作弊，要靠審查者與完成報告說明
- Claude 若繞過 `gh_ai.py` 直接用 `gh api` 留言，留言會被當成擁有者的發言（Claude 使用擁有者帳號）；只能靠規則遵守

## 常見誤判
<!-- 審查者反覆提出、但其實不成立的意見，以及原因 -->
- Gemini 審查偏寬鬆：PR #2 把未達成的驗收條件判為達成、PR #6 漏掉 3 項真問題；以 Codex 與 Claude 實測為準

## 委員表現
<!-- 每個功能一行：功能｜成員｜提出真問題數／誤判數｜備註 -->
| 功能 | 成員 | 真問題 | 誤判 | 備註 |
|---|---|---|---|---|
| 流程修正（PR #3） | Codex | 1 | 0 | 重試總耗時超過 job 上限（🟠）；第一次審查卡住 30 分鐘 |
| 評分正規化修正（PR #6，規劃） | Codex | 3 | 0 | 口頭禪兩邊都有會誤判、數字正則不支援無逗號、可選 and 需編輯距離支援 |
| 評分正規化修正（PR #6，規劃） | Nemotron／DeepSeek／Poolside | 4 | 0 | Unicode 負號、輸入上限、How'd＝did、既有測試相容 |
| 評分正規化修正（PR #6，審查） | Codex | 3 | 0 | 英數混合字放水（🔴）、constructor 撞內建屬性、複合縮寫 |
| 評分正規化修正（PR #6，審查） | Gemini（Flash Lite 備援） | 0 | 0 | 兩輪都說沒問題，漏掉 Codex 抓到的 3 項 |
| UI 改版①（PR #7，規劃） | Codex | 5 | 0 | warn 對比不足、既有色階配對要測、首屏底色與惰性初始化、v4 outline 語意、瀏覽器下限 |
| UI 改版①（PR #7，規劃） | Grok | 6 | 0 | 色階靜態、主題值勿用 JSON 存、桌機頁首去留、viewport-fit、字重、減少動態留載入圖示 |
| UI 改版①（PR #7，規劃） | DeepSeek | 3 | 0 | warn 對比、字重不足、v3/v4 取捨 |
| UI 改版①（PR #7，規劃） | Nemotron／Poolside／Gemini Lite | 2 | 2 | color-scheme、鍵盤操作；誤判：@custom-variant 不支援（Poolside）、要沿用舊 isDarkMode（Gemini） |
| UI 改版①（PR #7，審查） | Codex／Gemini Lite | 0 | 0 | 第 1 輪皆無意見 |
| UI 改版②a（PR #8，規劃） | Codex | 4 | 0 | 評分中跳句覆蓋（🔴）、跳句原音不停、gain 定義錯、按鈕巢狀 |
| UI 改版②a（PR #8，規劃） | Grok | 8 | 0 | 文案變更沒列清單、寬度分層、中文 fallback、舊熟練度來源、RetellSection 雙框、JS 動畫要另判減少動態等 |
| UI 改版②a（PR #8，規劃） | DeepSeek／Nemotron／Poolside／Gemini | 2 | 1 | RetellSection 雙框、色階遺漏；誤判：objectURL 未釋放（Gemini，現行已釋放） |
| UI 改版②a（PR #8，審查） | Codex | 1 | 0 | 等待麥克風權限期間跳句會啟動舊錄音（🔴） |
| UI 改版②a（PR #8，審查） | Gemini Lite | 0 | 0 | 兩輪皆無意見，漏掉 Codex 的 🔴 |
| UI 改版②b（PR #12，規劃） | Codex | 3 | 0 | 舊題庫沒有分析步驟、底部動作列的捲動容器與鍵盤行為、萃取預覽 Esc 有副作用 |
| UI 改版②b（PR #12，規劃） | Grok | 9 | 1 | 校對中隱藏選項卡、沿用原提示文字、實心警告色對比、文案清單補齊等；駁回：改用 fixed（會蓋到分頁列） |
| UI 改版②b（PR #12，規劃） | Gemini／Nemotron／Poolside／DeepSeek | 1 | 1 | 底部動作列要實機驗收；誤判：max-w-3xl 在 RetellView 內（Poolside） |
| UI 改版②b（PR #12，審查） | Codex | 1 | 0 | 1024px 桌機文字卡按鈕溢出（🟠） |
| UI 改版②b（PR #12，審查） | Gemini Lite | 0 | 0 | 兩輪皆無意見，漏掉 Codex 的 🟠 |
| UI 改版③a（PR #13，規劃） | Codex | 4 | 0 | 起始值鍵名不一致（gain 永遠 0）、交易重試殘留 outcome、完成畫面監聽競態、共用元件接線驗收 |
| UI 改版③a（PR #13，規劃） | Grok | 9 | 0 | 金色語意衝突、+0 不顯示、容器斷點 960px、1024px 不硬塞三欄、錄音鈕固定底部、守門補動態句 |
| UI 改版③a（PR #13，規劃） | DeepSeek／Gemini Lite | 3 | 1 | 鍵名轉換、button 內排版、空格與 0 分格要分得出來；誤判：要加頁首標題（DeepSeek，設計稿沒有） |
| UI 改版③a（PR #13，規劃） | Nemotron／Poolside | 0 | 3 | 誤判：SegmentedControl 不存在、熟練度樂觀更新；超出範圍：重試上限 |
| UI 改版③a（PR #13，審查） | Codex／Gemini Lite | 0 | 0 | 第 1 輪皆無意見（規劃階段已處理主要風險） |
| UI 改版③b（PR #14，規劃） | Codex | 2 | 0 | 拿掉暫時寬度會改到 ③a 練習畫面、卡片點擊與鍵盤契約 |
| UI 改版③b（PR #14，規劃） | Grok | 9 | 0 | 共用顯示元件、數字口徑不變、早退畫面要有切換、16px 輸入框、長字換行、速覽卡無障礙、精熟分支換樣式、載入中卡住（另開 PR） |
| UI 改版③b（PR #14，規劃） | DeepSeek／Nemotron／Gemini Lite／Poolside | 3 | 4 | 16px、長字、aria-modal；誤判：token 不存在（Gemini、Poolside）、地圖要橫捲（Gemini）、另掃一次資料（DeepSeek）；超出範圍：hover、重試上限 |
| UI 改版③b（PR #14，審查） | Codex／Gemini Lite | 0 | 0 | 第 1 輪皆無意見 |
| 載入中卡住修正（PR #15，審查） | Codex／Gemini Flash | 0 | 0 | 第 1 輪皆無意見 |
| UI 改版④（PR #16，規劃） | Codex | 1 | 0 | 重試要能驗行為、需允許重建訂閱 |
| UI 改版④（PR #16，規劃） | DeepSeek | 7 | 0 | 提醒色 orange 在禁令內、同步錯誤條 max-w-3xl、側欄 active 深淺色、排序固定語系、換帳號清空、手機不自動聚焦輸入框、列階段不能用 getPatternStage |
| UI 改版④（PR #16，規劃） | Nemotron／Poolside／Gemini Lite | 3 | 3 | ConfirmDialog 是 alertdialog 不能直接套用、motion-safe、左欄 sticky；誤判：App 其他分頁也有舊色（Poolside）、印章放符號、移除閃爍；Grok 本輪未出現 |
| UI 改版④（PR #16，審查） | Codex | 1 | 0 | 空集合後監聽失敗會卡在空狀態（🟠） |
| UI 改版④（PR #16，審查） | Gemini Flash／Lite | 0 | 0 | 兩輪皆無意見，漏掉 Codex 的 🟠 |
| 刪除舊單字庫（PR #17，審查） | Codex／Gemini Lite | 0 | 0 | 第 1 輪皆無意見 |
| UI 改版⑤（PR #18，規劃） | Codex | 2 | 0 | 印章名稱要依實際門檻、減少動態要連延遲歸零 |
| UI 改版⑤（PR #18，規劃） | DeepSeek | 4 | 0 | 逐列延遲上限、數字跑動獨立元件、手機輕壓 transition、fixed 對話框風險 |
| UI 改版⑤（PR #18，規劃） | Nemotron／Gemini Lite／Poolside | 3 | 3 | StrictMode 旗標、空資料、data-card-link；誤判：整組精熟用平均值（Poolside）、要 will-change／分批（Nemotron、Gemini）；Grok 未出現 |
| UI 改版⑤（PR #18，審查） | Codex／Gemini Lite | 0 | 0 | 第 1 輪皆無意見 |
| 跟讀辨識改善（PR #20，規劃） | Codex | 2 | 0 | iOS CORS 退回不能沿用已接 Web Audio 的元素（🔴）、播放流程要有行為測試 |
| 跟讀辨識改善（PR #20，規劃） | Grok／DeepSeek | 9 | 0 | 偵測音量用暫時元素、AudioContext 分開、音量在所有中斷路徑還原、endTime 為 0、對齊基準、aria、localStorage 帶版本、靜音對照 |
| 跟讀辨識改善（PR #20，規劃） | Nemotron／Poolside／Gemini Lite | 2 | 2 | CORS 風險、資源清理；誤判：提醒卡會破壞 iPhone 手勢（Gemini）、不再提醒後隱藏既有提示（Poolside） |
| 跟讀辨識改善（PR #20，審查） | Codex／Gemini Flash | 2 | 0 | 保險計時在緩衝延後時截斷句尾（兩者都抓到）、自動播放被擋仍顯示播放中（Gemini）；第 2 輪 Codex 卡住 18 分鐘，重新留言後完成 |
| 辨識快速修正（PR #22，審查） | Codex | 2 | 0 | 時序驗收只檢查原始碼（🔴，改成行為測試）、靜音等待變長會拉低流暢度 |
| 辨識快速修正（PR #22，審查） | Gemini Flash | 0 | 0 | 兩輪皆無意見，漏掉 Codex 兩項 |
| Groq Whisper（PR #23，規劃） | Codex | 4 | 0 | 備援鏈總時間預算、OpenAI 也要空白防呆、空字串與失敗分開、複述頁接模型 |
| Groq Whisper（PR #23，規劃） | Grok／Gemini／Nemotron | 7 | 2 | Gemini 不用 flash-lite、缺欄位不誤刪、太短不送、413 不重試、64 kbps、日誌不記文字；駁回：whisper-1 改名（Grok）、前端限流（Nemotron） |
| Groq Whisper（PR #23，審查） | Codex | 1 | 0 | Gemini 缺少文字的回應被當成「沒有人聲」 |
| Groq Whisper（PR #23，審查） | Gemini Flash | 0 | 0 | 兩輪皆無意見 |
| 英美拼字（PR #24，規劃） | Codex | 1 | 0 | 通用相鄰字合併會讓 now here／nowhere 算對（🔴） |
| 英美拼字（PR #24，規劃） | Gemini／Nemotron／Poolside／DeepSeek | 5 | 3 | 單字轉換與合寫拆字分開、e-mail 在切字前已被拆開、所有格順序、補齊缺字；駁回：IPA lint、NFC、超長輸入（超出範圍）；DeepSeek 建議納入 maybe 等合寫，擁有者選不納入 |
| 英美拼字（PR #24，審查） | Codex／Gemini Flash | 0 | 0 | 第 1 輪皆無意見 |
| 刪除 enableBackgroundAudioHack（PR #25，審查） | Codex／Gemini Flash | 0 | 0 | 小級刪除死碼，第 1 輪皆無意見 |
| 個人頁同步狀態（PR #26，審查） | Codex／Gemini Flash | 0 | 0 | 小級，第 1 輪皆無意見 |
