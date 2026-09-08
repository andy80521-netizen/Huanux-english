import type { Handler } from '@netlify/functions';
import { GoogleGenAI } from '@google/genai';

const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

const cleanAndParseJSON = (text: string) => {
    try {
        const cleaned = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
        return JSON.parse(cleaned);
    } catch (e) {
        throw new Error("無法解析 Gemini 回傳的 JSON 格式。請稍後再試。");
    }
};

export const handler: Handler = async (event, context) => {
    // CORS preflight
    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 204, headers, body: '' };
    }

    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method Not Allowed' }) };
    }

    try {
        const { sourceText } = JSON.parse(event.body || '{}');

        if (!sourceText) {
            return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing sourceText' }) };
        }

        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey) {
             console.error('GEMINI_API_KEY is missing');
             return { statusCode: 500, headers, body: JSON.stringify({ error: 'Server misconfiguration: API Key missing' }) };
        }

        const ai = new GoogleGenAI({ apiKey });
        const TEXT_MODEL = 'gemini-3.6-flash';

        const prompt = `請將以下英文文本逐句斷句，並提供每一句的繁體中文翻譯。
請只回傳 JSON 格式的陣列，不要包含任何 markdown 標記、\`\`\`json 標籤或其他文字。
text 欄位必須是原文逐字內容，絕對不可改寫、不可濃縮摘要。
格式範例：[{ "text": "Sentence 1.", "translation": "翻譯 1。" }, ...]

原文內容：
${sourceText}`;

        const response = await ai.models.generateContent({
            model: TEXT_MODEL,
            contents: prompt,
            config: {
                temperature: 0.1,
                responseMimeType: "application/json",
            }
        });

        if (!response.text) {
            throw new Error("Gemini API 回傳空內容");
        }

        const result = cleanAndParseJSON(response.text);

        return { statusCode: 200, headers, body: JSON.stringify(result) };

    } catch (error: any) {
        console.error('Error in split-text function:', error);
        return { statusCode: 500, headers, body: JSON.stringify({ error: error.message || 'Internal Server Error' }) };
    }
};
