import { GoogleGenAI } from '@google/genai';
import { isRetryableGeminiError } from './geminiFallback';

const FREE_MODELS = ['gemini-3.6-flash', 'gemini-3.5-flash', 'gemini-3.1-flash-lite', 'gemini-3.5-flash-lite'];
const PAID_MODELS = ['gemini-3.6-flash', 'gemini-3.5-flash'];

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export async function callGeminiFreeThenPaid<T>(
  label: string,
  call: (ai: GoogleGenAI, model: string) => Promise<T>,
  models?: { free: string[]; paid: string[] }
): Promise<T> {
  // 不指定 models 時使用文字模型清單；語音等其他用途可傳入自己的模型清單
  const groups = [
    { tier: '免費', apiKey: process.env.GEMINI_API_KEY, models: models?.free ?? FREE_MODELS },
    { tier: '付費', apiKey: process.env.GEMINI_PAID_API_KEY, models: models?.paid ?? PAID_MODELS }
  ];

  for (const group of groups) {
    if (!group.apiKey) continue;
    const ai = new GoogleGenAI({ apiKey: group.apiKey });
    for (const model of group.models) {
      const startTime = Date.now();
      try {
        const result = await call(ai, model);
        const duration = Date.now() - startTime;
        console.log(`[ai-text] ${label} 成功：${group.tier} ${model} ${duration}ms`);
        return result;
      } catch (err: any) {
        const status = err?.status ?? err?.statusCode ?? err?.code ?? err?.error?.code;
        const msg = String(err?.message || '');
        const isKeyProblem = /API_KEY_INVALID|API key not valid|API key expired|PERMISSION_DENIED|UNAUTHENTICATED/i.test(msg)
          || [401, 403].includes(Number(status));
        if (isKeyProblem) {
          console.warn(`[ai-text] ${label} ${group.tier}金鑰無法使用，改用下一組`, err?.message);
          break;   // 跳出模型迴圈，進入下一組金鑰
        }
        const isNotFound = Number(status) === 404 || String(status) === '404' || /\b404\b|NOT_FOUND/i.test(msg);
        const shouldRetry = isRetryableGeminiError(err) || isNotFound;

        if (shouldRetry) {
          console.warn(`[ai-text] ${label} ${model} 失敗，換下一個`, err?.message);
          await sleep(500);
        } else {
          throw err;
        }
      }
    }
  }

  const error: any = new Error('AI 服務暫時忙碌，請稍後再試');
  error.status = 503;
  throw error;
}
