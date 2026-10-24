import { GoogleGenAI } from '@google/genai';
import { isRetryableGeminiError } from './geminiFallback';

// gemini-3.5-flash 的免費額度與 3.6-flash 共用（錯誤訊息顯示同一個額度），所以免費清單不放 3.5-flash
const FREE_MODELS = ['gemini-3.6-flash', 'gemini-3.1-flash-lite', 'gemini-3.5-flash-lite'];
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

// ===== 重視品質的短輸入工作（造句檢查、出題、單句萃取、示範例句、複述回饋）=====
// 順序：Groq gpt-oss-120b（免費）→ Gemini 3.6-flash（免費）→ Gemma 4 31B（免費）→ Gemini 付費
// 不落到 flash-lite（語感判斷較弱）
const QUALITY_GEMINI_MODELS = { free: ['gemini-3.6-flash', 'gemma-4-31b-it'], paid: PAID_MODELS };
const GROQ_MODEL = 'openai/gpt-oss-120b';
const GROQ_MAX_PROMPT_CHARS = 6000;   // Groq 免費方案每分鐘 8K token，太長的提示詞直接跳過 Groq
const GROQ_TIMEOUT_MS = 20000;

async function callGroq(prompt: string, temperature: number, reasoningEffort: 'low' | 'medium' | 'high'): Promise<string> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error('尚未設定 GROQ_API_KEY');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), GROQ_TIMEOUT_MS);
  try {
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: GROQ_MODEL,
        messages: [{ role: 'user', content: prompt }],
        temperature,
        reasoning_effort: reasoningEffort,
        max_completion_tokens: 4096
      }),
      signal: controller.signal
    });
    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Groq ${res.status}: ${errText.slice(0, 200)}`);
    }
    const data = await res.json();
    const text = data?.choices?.[0]?.message?.content;
    if (typeof text !== 'string' || !text.trim()) {
      throw new Error('Groq 沒有回傳內容');
    }
    return text;
  } finally {
    clearTimeout(timer);
  }
}

// reasoningEffort：Groq 的思考強度；萃取用 medium（需要判斷學習價值），其他維持 low 以節省每日 token
export async function callQualityText(label: string, prompt: string, temperature: number, reasoningEffort: 'low' | 'medium' | 'high' = 'low'): Promise<string> {
  if (process.env.GROQ_API_KEY && prompt.length <= GROQ_MAX_PROMPT_CHARS) {
    const startTime = Date.now();
    try {
      const text = await callGroq(prompt, temperature, reasoningEffort);
      console.log(`[ai-text] ${label} 成功：Groq ${GROQ_MODEL} ${Date.now() - startTime}ms`);
      return text;
    } catch (err: any) {
      console.warn(`[ai-text] ${label} Groq 失敗，改用 Gemini`, String(err?.message || err).slice(0, 300));
    }
  }
  const response = await callGeminiFreeThenPaid(label, (ai, model) =>
    ai.models.generateContent({ model, contents: prompt, config: { temperature } }),
    QUALITY_GEMINI_MODELS
  );
  return response.text || '';
}
