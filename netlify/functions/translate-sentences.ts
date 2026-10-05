import type { Handler } from '@netlify/functions';
import { GoogleGenAI } from '@google/genai';
import { callWithModelFallback } from '../shared/geminiFallback';

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
        const { sentences } = JSON.parse(event.body || '{}');

        if (!Array.isArray(sentences) || sentences.length === 0 || sentences.length > 30 || !sentences.every(s => typeof s === 'string')) {
            return {
                statusCode: 400,
                headers,
                body: JSON.stringify({ error: 'Invalid input: sentences must be a non-empty array of strings with at most 30 items' })
            };
        }

        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey) {
            console.error('GEMINI_API_KEY is missing');
            return { statusCode: 500, headers, body: JSON.stringify({ error: 'Server misconfiguration: API Key missing' }) };
        }

        const ai = new GoogleGenAI({ apiKey });
        const TEXT_MODELS = ['gemini-3.6-flash', 'gemini-3.5-flash'];

        const prompt = `請將以下英文句子陣列逐句翻譯成繁體中文。
請只回傳 JSON 格式的字串陣列，不要包含任何 markdown 標記、\`\`\`json 標籤或其他文字。
回傳的句數與順序必須與輸入完全一致，不得合併、不得拆分、亦不得改寫。
格式範例：["翻譯 1", "翻譯 2", ...]

輸入英文句子陣列：
${JSON.stringify(sentences, null, 2)}`;

        const response = await callWithModelFallback(TEXT_MODELS, (model) => ai.models.generateContent({
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

        const result = cleanAndParseJSON(response.text);

        if (!Array.isArray(result) || !result.every(item => typeof item === 'string')) {
            throw new Error("Gemini 回傳格式錯誤：回傳內容不是純字串陣列");
        }

        if (result.length !== sentences.length) {
            throw new Error(`翻譯句數不一致：輸入 ${sentences.length} 句，但回傳 ${result.length} 句`);
        }

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({ translations: result })
        };

    } catch (error: any) {
        console.error('Error in translate-sentences function:', error);
        return { statusCode: 500, headers, body: JSON.stringify({ error: error.message || 'Internal Server Error' }) };
    }
};
