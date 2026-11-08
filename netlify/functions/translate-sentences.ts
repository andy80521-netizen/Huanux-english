import type { Handler } from '@netlify/functions';
import { verifyRealUserToken } from '../shared/auth';
import { buildTranslatePrompt, parseTranslations, callTranslateModel } from '../shared/translate';

const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

export const handler: Handler = async (event, context) => {
    // CORS preflight
    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 204, headers, body: '' };
    }

    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method Not Allowed' }) };
    }

    const authHeader = event.headers.authorization || event.headers.Authorization || '';
    const idToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
    if (!idToken) {
        return { statusCode: 401, headers, body: JSON.stringify({ error: '未登入' }) };
    }
    const authResult = await verifyRealUserToken(idToken);
    if ('error' in authResult) {
        return { statusCode: authResult.status, headers, body: JSON.stringify({ error: authResult.error }) };
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

        // 提示詞與檢查在 netlify/shared/translate.ts，與背景存檔（save-material）共用
        const text = await callTranslateModel(buildTranslatePrompt(sentences));
        const result = parseTranslations(text, sentences.length);

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
