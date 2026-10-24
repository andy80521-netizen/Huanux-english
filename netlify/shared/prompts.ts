export function buildCheckSentencePrompt(patternText: string, userSentence: string): string {
    return `你是英文母語的語言老師。使用者針對一個英文句型/片語自己造了一句話，這句話之後會成為他反覆練習、背到能脫口而出的固定句子，所以用字必須道地。

目標句型/片語：${patternText}
使用者造的句子：${userSentence}

請檢查：
1) natural：只有「嚴重不自然」（明顯中式直譯、語序不符合母語者習慣、搭配詞明顯用錯）才給 false，其餘給 true。
2) grammar：文法是否正確（句子結構、時態形式、主詞動詞一致等）；搭配詞用錯屬於 natural，不算文法錯。
3) spelling：拼字是否正確。

接著逐項檢查以下四點，只有真的有問題才提出：
- 搭配詞：動詞、名詞、形容詞的組合是不是母語者常用的
- 用字精準度：有沒有意思或語氣更貼切的字
- 時態與情境：時態是否符合最可能的情境；如果不同情境要用不同時態，在說明裡講清楚哪種情境用哪個
- 語域：口語和書面用語是否一致

規則：
- 不要為了換風格而修改：兩種說法同樣自然時（例如 that 可省略也可保留、要不要縮寫），不算問題，不要提出。
- 必須保留目標句型/片語，也盡量保留使用者原本的意思和情境，只做必要的最小修改。
- 使用者的句子不需要跟句型原本的情境相同，只要正確運用句型的核心用法即可。
- 沒有實質改進時，不要提供 suggestedRevision 與 revisionNotes，也不要硬找問題。
- revisionNotes 只寫「改了什麼、為什麼」，每條一句；不要寫「保留了什麼」或「其他部分不變」這類說明。
- comment 用中文寫整體評語；三項都通過且沒有建議時，用一句簡短的肯定即可。

只回傳 JSON，不要有其他文字。有建議時：
{
  "natural": true,
  "grammar": true,
  "spelling": true,
  "comment": "中文整體評語",
  "suggestedRevision": "修改後的完整句子",
  "revisionNotes": ["中文：改了什麼、為什麼（最多 3 條）"]
}

沒有建議時：
{
  "natural": true,
  "grammar": true,
  "spelling": true,
  "comment": "很好，這句話運用得很自然！"
}`;
}

export function buildPracticePromptsPrompt(sentenceText: string, patternText: string): string {
    return `使用者已經造好一句話: "${sentenceText}"，運用了句型/片語: "${patternText}"。
請設計兩種提示，讓使用者之後看到提示時，能夠回想起並念出這句原本的話(不是造新句子，是要引導使用者念出這句固定的話)：
1) qaQuestion: 一個問答式的引導問句，回答這個問句最自然的答案就是 "${sentenceText}" 這句話
2) situationalPrompt: 一段情境任務描述(例如「你正在跟朋友聊到...，請說出你的想法」)，情境要能自然導向使用者說出 "${sentenceText}"

請只回傳 JSON 物件，不要有其他文字。格式範例：
{
  "qaQuestion": "...",
  "situationalPrompt": "..."
}`;
}

export function buildRegenerateSeedsPrompt(
    pattern: { text: string; meaningZh: string; usageContext: string; category: string },
    avoidSentences: string[]
): string {
    const avoidListText = avoidSentences.length > 0
        ? avoidSentences.map(s => `- ${s}`).join('\n')
        : '無';

    return `依下列句型產生 5 個全新的示範例句，並附上自然的中文翻譯。

使用者程度：${LEARNER_PROFILE}

規則：
- 每句都必須明確使用這個句型；方括號 [ ] 是可替換的部分，請代入不同內容
- 5 句要用 5 種不同情境（例如日常生活、職場、新聞時事、澳洲生活、人際對話），讓使用者看出這個句型能用在哪裡
- 自然道地、母語者真的會這樣說；用字符合 B2 以上但不要刻意艱深
- 每句 8～20 個英文字

句型：${pattern.text}
類型：${pattern.category}
語意：${pattern.meaningZh}
使用時機：${pattern.usageContext}
以下句子不可重複，也不可只做小幅改寫：
${avoidListText}
只回傳 JSON 陣列，格式 [{"en": "...", "zh": "..."}]，不要有其他文字。`;
}

export const cleanAndParseJSON = (text: string) => {
    const cleaned = String(text || '').replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    // 依序嘗試：原文 → 只取第一個 { 或 [ 到最後一個 } 或 ] → 去掉結尾多出的逗號（部分模型會輸出 {"a": 1,}）
    const candidates: string[] = [cleaned];
    const start = cleaned.search(/[[{]/);
    const end = Math.max(cleaned.lastIndexOf('}'), cleaned.lastIndexOf(']'));
    if (start >= 0 && end > start) candidates.push(cleaned.slice(start, end + 1));
    candidates.slice().forEach(c => candidates.push(c.replace(/,\s*([}\]])/g, '$1')));
    for (const c of candidates) {
        try {
            return JSON.parse(c);
        } catch {
            // 換下一種
        }
    }
    throw new Error("無法解析 AI 回傳的 JSON 格式。請稍後再試。");
};

export const PRIMARY_CATEGORY_GUIDE = `主要情境分類（primaryCategory 只能填以下 13 個大類名稱之一，不要加【】符號；冒號後面的細項只是幫助你判斷歸類的參考，不要填細項）：
- 餐飲消費：餐廳用餐、咖啡/手搖飲料店點餐、超市/雜貨店採購、外送/外帶點餐
- 交通票務：買票(電影/演唱會/車票/機票)、大眾運輸問路搭乘、計程車/共乘叫車、租車/加油站
- 旅遊住宿：機場通關/登機、飯店入住退房、旅遊景點介紹/導覽、觀光諮詢/問路
- 職場工作：辦公室日常溝通(開會/交辦/回報)、倉庫/物流現場作業溝通、求職面試、電話/視訊會議、跟主管同事協調排班或請假、職場衝突/意見不合處理
- 電話客服：電話諮詢/客服申訴、預約掛號(醫療/美容/維修)、銀行/電信/保險客服對話
- 消費購物：商品退換貨、議價/詢問折扣、網路購物客訴/查詢訂單、消費者權益爭議
- 行銷商務：行銷話術/推銷產品、業務開發/陌生開發、簡報/提案表達、商務書信/email往來語氣
- 醫療健康：診所/醫院問診、藥局購買藥品說明症狀、健身房/運動教練溝通
- 政府行政：政府機關辦事(申請文件/簽證/稅務諮詢)、銀行開戶/金融事務
- 社交人際：朋友聚會邀約/婉拒、感謝/道歉/安慰、抱怨/委婉表達不滿、打招呼/寒暄/告別、約會/聯誼
- 時事議題：社會事件說明/新聞轉述、時事評論/表達立場、環保/公共議題討論
- 教育學習：課堂討論/發言、跟老師教授溝通(請假/問問題)、語言交換/學習夥伴對話
- 居家生活：租屋/房東溝通、鄰居互動、居家維修/水電叫工
只有在以上 13 類都明顯不適合時，才可以自訂一個新的大類名稱（4 個字，風格比照上面）。`;

export const normalizePrimaryCategories = (items: any) => {
    if (!Array.isArray(items)) return items;
    return items.map((item: any) => {
        const raw = typeof item?.primaryCategory === 'string' ? item.primaryCategory : '';
        const cleaned = raw.replace(/[【】]/g, '').trim();
        return { ...item, primaryCategory: cleaned || '未分類' };
    });
};

// 萃取規則（單句與整篇共用）：什麼值得萃取、怎麼寫成可重複使用的形式
// 使用者程度：萃取與審核共用；要調整難度只改這裡
const LEARNER_PROFILE = `使用者是中高級英文學習者（約 CEFR B2），母語是中文，住在澳洲。已經會日常基礎搭配（例如 listen to、lead to、respond to、look forward to、make a decision、take a photo），想學更道地、更進階、或中文母語者常用錯的說法。`;

const EXTRACTION_RULES = `■ 使用者程度
${LEARNER_PROFILE}
- B2 學習者已經會的基礎用法不要萃取

■ 什麼值得萃取（至少符合一項）：
- 中文母語者自己不容易寫出來的搭配（例如 make a mistake、trigger a bushfire、heavy rain）
- 意思不能從字面推出來的固定說法（片語動詞、慣用語，例如 run out of、on the verge of）
- 可以套用到很多情境的句子骨架（例如 What [someone] is about to [verb] is...、the [hottest] [day] since [year]）

■ 不要萃取
- 字面意思相加、一看就懂的普通組合（例如 early spring、big house、very happy）
- 單一個字、專有名詞、人名地名、數字與日期
- 只是把原句整段照抄、換個情境就用不上的長片段

■ 寫法（text 欄位）
- 動詞用原形（trigger，不是 triggered）
- 去掉原句裡碰巧出現、不屬於核心用法的修飾語（例如 several、very）
- 可替換的部分用英文方括號標示：[someone]、[something]、[verb]、[time]、[place]、[number] 等
- 空格只標真正可以替換的部分；必須保留讓句型成立的固定字，不要把大半句子都換成空格（例如不要寫成 Here's what's [verb] [noun]）
- 保留真正固定、不能替換的字

■ 三種分類
- structural（結構句型）：英文裡常見、有固定功能的句型框架，學的是句子怎麼組（例如 What [someone] is about to [verb] is…、the [hottest] [day] since [year]、It's not that…, it's that…）
  · 檢驗：把空格拿掉後，剩下的固定字如果只有 the、a、is、are、in、to、has 這類基本文法字，就不是結構句型，不要萃取
  · 不要把原句的名詞、數字、地點全部挖空當成句型；空格最多 3 個
  · 句子裡沒有這種框架時，不要硬湊結構句型
- phrase（片語）：固定、不可拆的說法，學的是整個說法（片語動詞、慣用語）
- collocation（語組）：哪個字跟哪個字搭配才是學習重點（動詞＋名詞、形容詞＋名詞等）

■ 同一次萃取的項目不能互相涵蓋
- 例如已經有 trigger [something]，就不要再給包含 trigger 的結構句型；只保留學習價值最高的那個寫法

■ 學習重點 learningPoint（必填）
- 用一句中文說明：中文母語者在這裡容易用錯、或自己想不到的是什麼（例如「中文說『引發火災』時常直覺用 cause，母語者描述突發事件更常用 trigger 或 spark」）
- 寫不出具體的學習重點，就代表不值得萃取，不要列出

■ 示範例句 seedExamples
- 至少 5 句，由你新寫，不可摘錄原句
- 必須使用 text 一般化後的寫法，套在不同的情境裡（日常、職場、新聞等），讓使用者看出它能用在哪些地方`;

export function buildExtractFromSentencePrompt(sentenceText: string, sentenceTranslation: string, existingPatterns: string[] = []): string {
    const existingBlock = existingPatterns.length > 0
        ? `
■ 這句已經萃取過以下句型（使用者正在練習）：
${existingPatterns.map(t => `- ${t}`).join('\n')}
不要再萃取上面這些句型，也不要萃取它們的改寫版本、或只是多套一點內容的版本（例如已有 Here's what's [verb-ing]，就不要再給 Here's what's [verb-ing] this [time]）。只找不同的新學習點；沒有就回傳 []。
`
        : '';
    return `這是使用者既有的雙語分析框架（結構句型 Structural Patterns / 片語 Phrases / 語組 Collocations 三分類）。
輸入是一句英文和它的中文翻譯。請從這句話找出值得學習的句型、片語、語組，**最多 3 個**，依學習價值由高到低排列。一句話裡可能同時有一個結構句型和一個語組，都要各自拆出來；**如果沒有值得學的，就回傳空陣列 []，不要硬找**。

${EXTRACTION_RULES}
${existingBlock}
每個項目要包含：
- category（三選一："structural"、"phrase"、"collocation"）
- text（依上方寫法規則寫成的英文）
- meaningZh（中文語意說明）
- learningPoint（學習重點，見上方說明）
- usageContext（使用時機說明）
- primaryCategory（主要情境大類，依下方「主要情境分類」規則填寫）
- situationTags（情緒／溝通功能標籤陣列，例如 ["劃清界線", "委婉拒絕"]）
- seedExamples（格式 {en: string, zh: string} 陣列）

${PRIMARY_CATEGORY_GUIDE}

請只回傳 JSON 陣列，不要有其他文字。格式範例：
[
  {
    "category": "collocation",
    "text": "trigger [something]",
    "meaningZh": "引發、觸發（某事件或反應）",
    "learningPoint": "中文說「引發」時常直覺用 cause，但災害、警報、反應這類突發事件，母語者更常用 trigger",
    "usageContext": "描述某件事導致災害、警報、情緒或連鎖反應發生，新聞與日常都常用",
    "primaryCategory": "...",
    "situationTags": ["..."],
    "seedExamples": [{"en": "...", "zh": "..."}]
  }
]

輸入句子：
英文: ${sentenceText}
中文: ${sentenceTranslation}
`;
}

export function buildExtractFromTextPrompt(sourceText: string): string {
    return `這是使用者既有的雙語分析框架（結構句型 Structural Patterns / 片語 Phrases / 語組 Collocations 三分類）。
輸入為一段完整的英文段落。請從這段文字找出值得學習的句型、片語、語組，**最多 12 個**，依學習價值由高到低排列。請考慮跨句子的語境關聯，不要逐句機械式拆解；**同一個用法只列一次**；**如果沒有值得學的，就回傳空陣列 []，不要硬找**。

${EXTRACTION_RULES}

每個項目要包含：
- category（三選一："structural"、"phrase"、"collocation"）
- text（依上方寫法規則寫成的英文）
- meaningZh（中文語意說明）
- learningPoint（學習重點，見上方說明）
- usageContext（使用時機說明）
- primaryCategory（主要情境大類，依下方「主要情境分類」規則填寫）
- situationTags（情緒／溝通功能標籤陣列，例如 ["強調", "轉折"]）
- seedExamples（格式 {en: string, zh: string} 陣列）

${PRIMARY_CATEGORY_GUIDE}

請只回傳 JSON 陣列，不要有其他文字。格式範例：
[
  {
    "category": "structural",
    "text": "the [hottest] [day] since [year]",
    "meaningZh": "自某年以來最……的一天",
    "learningPoint": "中文說「X 年來最熱」容易直譯成 in X years，母語者更常用「最高級＋since＋年份」",
    "usageContext": "描述紀錄、比較歷史高低點，常見於新聞與天氣報導",
    "primaryCategory": "...",
    "situationTags": ["..."],
    "seedExamples": [{"en": "...", "zh": "..."}]
  }
]

輸入文字：
${sourceText}
`;
}

// 萃取審核：萃取完後再逐項檢查一次（一次只做一件事，比在萃取提示詞裡塞更多規則可靠）
export function buildReviewExtractionPrompt(
    sentenceText: string,
    candidates: { index: number; category: string; text: string; meaningZh: string; learningPoint: string }[]
): string {
    const list = candidates.map(c =>
        `${c.index}. [${c.category}] ${c.text}\n   中文：${c.meaningZh}\n   學習重點：${c.learningPoint}`
    ).join('\n');
    return `你是嚴格的英文教材審核員。下面是從一句英文萃取出來、準備讓中文母語者反覆練習的句型。請逐項用檢核清單檢查，決定保留、修正或刪除。

原句：${sentenceText}

萃取結果（前面的數字是 index）：
${list}

使用者程度：${LEARNER_PROFILE}

檢核清單：
0. 這是 B2 學習者已經會的基礎用法嗎？（例如 listen to、lead to、[number] minutes each）是就刪除
1. 動詞是否為原形？（例如 recorded → record）不是就修正寫法
2. 是否含有原句碰巧出現、不屬於核心用法的字？（例如 actually、several、more of、具體的月份或地名）有就修正，拿掉這些字或改成方括號空格
3. 是否與同一批其他項目重疊或互相涵蓋？有就刪除學習價值較低的那個
4. 學習重點是否具體指出「中文母語者在這裡會用錯或想不到什麼」？只是空泛描述（例如「英文常用這個句型」「讓句子更有說服力」）就刪除
5. 是否只是字面一看就懂的組合、或單字等級的名詞（例如 daily news podcast、show notes）？是就刪除
6. 結構句型拿掉方括號空格後，剩下的字是否只是把原句挖空？是就刪除

規則：
- 「修正」只能改寫法（text），必須仍是同一個學習點，不可變成另一個句型
- 寧可刪除，也不要保留可疑的項目
- 每一項都要回傳

只回傳 JSON，不要有其他文字：
{
  "results": [
    { "index": 0, "action": "keep" },
    { "index": 1, "action": "fix", "text": "修正後的寫法", "reason": "中文簡短原因" },
    { "index": 2, "action": "drop", "reason": "中文簡短原因" }
  ]
}`;
}

export const TRANSCRIBE_PROMPT = "請把這段音檔裡使用者說的英文內容逐字轉錄出來,只回傳轉錄後的純文字,不要有任何其他說明文字、不要有引號、不要有markdown格式";

export function buildClassifyPatternsPrompt(
    candidates: { text: string; meaningZh: string }[],
    existing: { id: string; text: string; meaningZh: string }[]
): string {
    const candidateList = candidates.map((c, i) => `${i}. ${c.text}（${c.meaningZh}）`).join('\n');
    const existingList = existing.length > 0
        ? existing.map(e => `[${e.id}] ${e.text}（${e.meaningZh}）`).join('\n')
        : '無';

    return `你是英文句型庫的整理助手。請判斷每個「候選句型」和「既有句型」的關係，並檢查候選句型之間是否互相重複。

關係定義：
- duplicate（重複）：同一個句型，只是寫法、符號、佔位詞或大小寫不同。例如「be about to do」與「be about to + V」
- variant（變體）：核心句型相同，但套上了不同的句型框架或固定搭配。例如「be about to」與「What [someone] is about to [verb] is...」
- synonym（近義）：不同的說法但意思相近、學習時值得互相比較。例如「be about to」與「be on the verge of」
- new（新的）：與既有句型都沒有上述關係

判斷原則：
- 只有非常確定是同一個句型時才標 duplicate；不確定時寧可標 variant 或 new
- duplicate 優先與既有句型比對，填 matchId；若只與排在它前面的候選句型重複，填 matchCandidateIndex
- variant 與 synonym 只跟既有句型比對，必須填 matchId
- 有多個符合時，選最接近的一個

既有句型（方括號內是 id）：
${existingList}

候選句型（前面的數字是 index）：
${candidateList}

請只回傳 JSON 物件，不要有其他文字。每個候選句型都要有一筆結果。格式範例：
{
  "results": [
    { "index": 0, "relation": "new" },
    { "index": 1, "relation": "duplicate", "matchId": "既有句型的 id" },
    { "index": 2, "relation": "duplicate", "matchCandidateIndex": 0 },
    { "index": 3, "relation": "variant", "matchId": "既有句型的 id" },
    { "index": 4, "relation": "synonym", "matchId": "既有句型的 id" }
  ]
}`;
}

export function buildDetectSightingsPrompt(
    sentences: string[],
    patterns: { id: string; text: string; meaningZh: string }[]
): string {
    const patternList = patterns.map(p => `[${p.id}] ${p.text}（${p.meaningZh}）`).join('\n');
    const sentenceList = sentences.map((s, i) => `${i}. ${s}`).join('\n');

    return `你是英文句型偵測助手。下面有一份英文教材的句子，以及使用者已經學過的句型清單。
請找出每個句子「實際使用到」哪些已學句型。

判斷原則：
- 句子必須真的用到該句型的結構或固定搭配，只出現相同的單字不算
- 句型中的佔位詞（例如 [someone]、[verb]、sb、sth、V）可以代入任何合適的詞
- 時態、人稱、單複數的變化都算有用到（例如 be about to → is about to、was about to）
- 不確定時不要標
- 一個句子可以用到多個句型，也可以一個都沒有

已學句型（方括號內是 id）：
${patternList}

教材句子（前面的數字是 index）：
${sentenceList}

請只回傳 JSON 物件，不要有其他文字。只列出有用到已學句型的句子，patternIds 只能填上面清單裡的 id：
{
  "results": [
    { "index": 0, "patternIds": ["句型 id"] }
  ]
}`;
}

export function buildSegmentMaterialPrompt(sentences: string[]): string {
    const sentenceList = sentences.map((s, i) => `${i}. ${s}`).join('\n');
    const lastIndex = sentences.length - 1;

    return `你是英文教材的編輯。下面是一份英文教材的句子（依序編號）。請依「主題或話題的轉換」把它切成連續的段落，方便學習者一次複述一段。

規則：
- 每段約 5～12 句；主題很短時可以少於 5 句，但不要少於 3 句（全文不到 3 句時整份就是一段）
- 段落必須連續、依序、不重疊，並涵蓋全部句子：第一段從 0 開始，最後一段結束在 ${lastIndex}
- 每段給一個簡短的繁體中文標題（10 個字以內），說明這段在講什麼

句子：
${sentenceList}

請只回傳 JSON 物件，不要有其他文字。格式範例：
{
  "segments": [
    { "title": "段落標題", "start": 0, "end": 6 }
  ]
}`;
}

export function buildReviewRetellPrompt(
    segmentText: string,
    transcript: string,
    targetPatterns: { id: string; text: string; meaningZh: string }[]
): string {
    const patternList = targetPatterns.length > 0
        ? targetPatterns.map(p => `[${p.id}] ${p.text}（${p.meaningZh}）`).join('\n')
        : '無';

    return `你是英文口說教練。學習者剛聽完一段英文教材，接著用自己的話、以英文口說複述內容。下面是原文、學習者複述的語音辨識結果，以及系統建議學習者使用的句型。
請用繁體中文給回饋（英文的原句與改寫保持英文）。

原文：
${segmentText}

學習者的複述（語音辨識結果，可能有少量辨識錯誤；明顯的辨識錯誤不要當成學習者的錯）：
${transcript}

建議使用的句型（方括號內是 id）：
${patternList}

請評估：
1. coverage：covered 列出學習者有講到的重點（中文，每點一句）；missed 列出原文中重要但沒講到的重點（最多 4 點）
2. corrections：挑出 2～5 個最值得改進的地方。original 是學習者的原話片段，better 是更自然道地的說法，note 用中文簡短說明原因；學習者講得很好時可以少於 2 個
3. patternUsage：每個建議句型各一筆。status 為 correct（自然且正確地用到）、incorrect（有嘗試但用錯）或 unused（沒有用到）；note 用中文簡短說明
4. modelAnswer：用英文寫一段示範複述，80 個字以內，口語自然，盡量自然地用上建議句型
5. comment：中文整體評語 2～3 句，先肯定做得好的地方，再指出最重要的改進方向
6. contentScore：內容涵蓋分數 0～100；languageScore：語言自然度與正確性分數 0～100

請只回傳 JSON 物件，不要有其他文字。格式：
{
  "coverage": { "covered": ["..."], "missed": ["..."] },
  "corrections": [ { "original": "...", "better": "...", "note": "..." } ],
  "patternUsage": [ { "id": "句型 id", "status": "unused", "note": "..." } ],
  "modelAnswer": "...",
  "comment": "...",
  "contentScore": 0,
  "languageScore": 0
}`;
}
