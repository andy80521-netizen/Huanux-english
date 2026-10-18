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
