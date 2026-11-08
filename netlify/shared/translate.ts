// 逐句翻譯（translate-sentences 與 save-material 共用；提示詞一字不改）
// 規劃：docs/plans/background-material-save.md
import { callGeminiFreeThenPaid } from './aiKeys';

export const TRANSLATE_BATCH_SIZE = 30;

export function buildTranslatePrompt(sentences: string[]): string {
    return `請將以下英文句子陣列逐句翻譯成繁體中文。
請只回傳 JSON 格式的字串陣列，不要包含任何 markdown 標記、\`\`\`json 標籤或其他文字。
回傳的句數與順序必須與輸入完全一致，不得合併、不得拆分、亦不得改寫。
格式範例：["翻譯 1", "翻譯 2", ...]

輸入英文句子陣列：
${JSON.stringify(sentences, null, 2)}`;
}

const cleanAndParseJSON = (text: string) => {
    try {
        const cleaned = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
        return JSON.parse(cleaned);
    } catch (e) {
        throw new Error("無法解析 Gemini 回傳的 JSON 格式。請稍後再試。");
    }
};

/** 解析模型回傳；不是字串陣列或句數不符 → 丟錯 */
export function parseTranslations(text: string, expected: number): string[] {
    const result = cleanAndParseJSON(text);
    if (!Array.isArray(result) || !result.every(item => typeof item === 'string')) {
        throw new Error("Gemini 回傳格式錯誤：回傳內容不是純字串陣列");
    }
    if (result.length !== expected) {
        throw new Error(`翻譯句數不一致：輸入 ${expected} 句，但回傳 ${result.length} 句`);
    }
    return result;
}

/** 呼叫模型（免費金鑰優先、付費備援），回傳原始文字 */
export async function callTranslateModel(prompt: string): Promise<string> {
    const response = await callGeminiFreeThenPaid('translateSentences', (ai, model) => ai.models.generateContent({
        model,
        contents: prompt,
        config: {
            temperature: 0.1,
            responseMimeType: "application/json",
        }
    }));
    if (!response.text) {
        throw new Error("Gemini API 回傳空內容");
    }
    return response.text;
}

/** 翻譯一批（≤ 30 句） */
export async function translateBatch(sentences: string[]): Promise<string[]> {
    return parseTranslations(await callTranslateModel(buildTranslatePrompt(sentences)), sentences.length);
}
