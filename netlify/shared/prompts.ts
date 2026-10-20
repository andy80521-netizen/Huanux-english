export function buildCheckSentencePrompt(patternText: string, userSentence: string): string {
    return `這是使用者針對某個英文句型/片語自己造的一句話，請檢查這句話：
1) natural (自然度): 只有在「嚴重不自然」時(例如明顯的中式直譯、語序完全不符合英文母語者的表達方式)才給 false。正常範圍內自然度的高低差異不算「不自然」，應該給 true。
2) grammar (文法): 文法對不對。
3) spelling (拼字): 拼字對不對。

注意：使用者造的句子不需要跟原本的句型有完全一樣的情境或字面意思，只需要有實際運用到這個句型/片語的核心用法即可，請基於這個前提判斷，不要因為使用者換了完全不同的情境就誤判為不相關。

目標句型/片語：${patternText}
使用者造的句子：${userSentence}

請只回傳 JSON 物件，不要有其他文字。
- comment 欄位請用中文說明哪裡不自然/文法錯在哪/拼字錯在哪。如果三者都通過 (皆為 true)，comment 可以是簡短的肯定文字(例如「很好，這句話運用得很自然！」)。
- 不論 natural 是 true 或 false，只要你認為有更道地/更好的說法，就提供 suggestedRevision (完整句子版本) 以及 suggestedRevisionScope ('whole' 或 'partial')。
- 如果是部分片段需要調整，suggestedRevision 仍然提供「完整句子」，方便直接替換使用，但 suggestedRevisionScope 標記為 'partial' 讓使用者知道問題只在小部分。如果是整句重寫則標記為 'whole'。
- 如果句子已經很好、沒有更好的建議，suggestedRevision 和 suggestedRevisionScope 可以省略。

格式範例 (有建議時)：
{
  "natural": true,
  "grammar": true,
  "spelling": true,
  "comment": "句子結構很好，但有個小地方可以更道地。",
  "suggestedRevision": "The revised full sentence.",
  "suggestedRevisionScope": "partial"
}

格式範例 (沒建議時)：
{
  "natural": true,
  "grammar": true,
  "spelling": true,
  "comment": "很好，這句話運用得很自然！"
}
`;
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

    return `依下列句型產生 5 個全新的示範例句，自然道地、貼近日常生活或職場情境，每句 8～20 個英文字，每句都必須明確使用這個句型，並附上自然的中文翻譯。
句型：${pattern.text}
類型：${pattern.category}
語意：${pattern.meaningZh}
使用時機：${pattern.usageContext}
以下句子不可重複，也不可只做小幅改寫：
${avoidListText}
只回傳 JSON 陣列，格式 [{"en": "...", "zh": "..."}]，不要有其他文字。`;
}

export const cleanAndParseJSON = (text: string) => {
    try {
        const cleaned = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
        return JSON.parse(cleaned);
    } catch (e) {
        throw new Error("無法解析 Gemini 回傳的 JSON 格式。請稍後再試。");
    }
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

export function buildExtractFromSentencePrompt(sentenceText: string, sentenceTranslation: string): string {
    return `這是使用者既有的雙語分析框架(結構句型Structural Patterns / 片語Phrases / 語組Collocations三分類)。
輸入只有這一句英文+中文翻譯,請從這句話裡拆解出可能不只一個的句型/片語/語組(例如一句話裡可能同時有一個結構句型跟一個片語,都要各自拆出來)。
每個萃取出來的項目要包含:
- category (三選一: "structural", "phrase", "collocation")
- text (句型/片語本身，英文)
- meaningZh (中文語意說明)
- usageContext (使用時機說明)
- primaryCategory (主要情境大類，依下方「主要情境分類」規則填寫)
- situationTags (情緒/溝通功能標籤陣列，例如 ["劃清界線", "委婉拒絕"])
- seedExamples (至少5個, 明確由你生成的示範例句，不是從原句摘錄，格式 {en: string, zh: string} 陣列)

${PRIMARY_CATEGORY_GUIDE}

請只回傳 JSON 陣列，不要有其他文字。
格式範例：
[
  {
    "category": "structural",
    "text": "...",
    "meaningZh": "...",
    "usageContext": "...",
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
    return `這是使用者既有的雙語分析框架(結構句型Structural Patterns / 片語Phrases / 語組Collocations三分類)。
輸入為一段完整的英文段落, 請從這段文字裡找出所有值得萃取的句型/片語/語組。請考慮跨句子的語境關聯, 不要逐句機械式拆解。
每個萃取出來的項目要包含:
- category (三選一: "structural", "phrase", "collocation")
- text (句型/片語本身，英文)
- meaningZh (中文語意說明)
- usageContext (使用時機說明)
- primaryCategory (主要情境大類，依下方「主要情境分類」規則填寫)
- situationTags (情緒/溝通功能標籤陣列，例如 ["強調", "轉折"])
- seedExamples (至少5個, 明確由你生成的示範例句，格式 {en: string, zh: string} 陣列)

${PRIMARY_CATEGORY_GUIDE}

請只回傳 JSON 陣列，不要有其他文字。
格式範例：
[
  {
    "category": "structural",
    "text": "...",
    "meaningZh": "...",
    "usageContext": "...",
    "primaryCategory": "...",
    "situationTags": ["..."],
    "seedExamples": [{"en": "...", "zh": "..."}]
  }
]

輸入文字：
${sourceText}
`;
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
