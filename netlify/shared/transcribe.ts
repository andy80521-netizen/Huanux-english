// 語音轉文字（PR B，2026-10-30）：Groq Whisper large-v3 → OpenAI whisper-1 的伺服器端轉錄鏈
// 純邏輯放這裡（注入 fetch 與時鐘），方便用替身測試；Netlify 函式只負責驗證登入與組裝供應商

export const GROQ_TRANSCRIBE_MODEL = 'whisper-large-v3';
export const GROQ_TRANSCRIBE_URL = 'https://api.groq.com/openai/v1/audio/transcriptions';
export const OPENAI_TRANSCRIBE_URL = 'https://api.openai.com/v1/audio/transcriptions';

/** 整條鏈的時間預算：Netlify 同步函式舊預設 10 秒，留 1 秒給驗證與回應 */
export const TOTAL_BUDGET_MS = 9000;
/** Groq 最多等多久（正常 1～2 秒） */
export const GROQ_TIMEOUT_MS = 6000;
/** 剩餘時間少於這個就不試下一家，直接讓前端改用 Gemini */
export const MIN_FALLBACK_MS = 3000;
/** 小於這個大小的錄音幾乎不可能有內容，不送外部服務 */
export const MIN_AUDIO_BYTES = 2000;

export interface WhisperSegment {
  no_speech_prob?: number;
  avg_logprob?: number;
}

const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** 每一段都「很可能沒有人聲」才算沒有人聲；沒有片段或缺欄位時視為有人聲（不誤刪） */
export function isLikelyNoSpeech(segments: WhisperSegment[] | undefined | null): boolean {
  if (!Array.isArray(segments) || segments.length === 0) return false;
  return segments.every((s) => num(s?.no_speech_prob) && num(s?.avg_logprob) && s.no_speech_prob >= 0.6 && s.avg_logprob <= -1);
}

/** Whisper 遇到空白錄音常輸出「Thank you.」等幻覺句：判斷為沒有人聲時回傳空字串 */
export function cleanWhisperText(text: string, segments: WhisperSegment[] | undefined | null): string {
  if (isLikelyNoSpeech(segments)) return '';
  return (text || '').trim();
}

/** Groq 與 OpenAI 都依副檔名判斷格式；只看 MIME 主類型（去掉 ;codecs=…） */
export function extensionFor(mimeType: string): string {
  const base = (mimeType || '').split(';')[0].trim().toLowerCase();
  if (base.includes('mp4')) return 'mp4';
  if (base.includes('ogg')) return 'ogg';
  if (base.includes('aac') || base.includes('m4a')) return 'm4a';
  if (base.includes('mpeg') || base.includes('mp3')) return 'mp3';
  if (base.includes('wav')) return 'wav';
  return 'webm';
}

export interface TranscribeProvider {
  name: string;
  url: string;
  model: string;
  key: string | undefined;
}

export type TranscribeResult =
  | { ok: true; text: string; model: string }
  | { ok: false; status: number; error: string };

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

async function callProvider(p: TranscribeProvider, audio: Uint8Array, mimeType: string, fetchImpl: FetchLike, timeoutMs: number) {
  const form = new FormData();
  form.append('file', new Blob([audio], { type: (mimeType || 'audio/webm').split(';')[0] }), `recording.${extensionFor(mimeType)}`);
  form.append('model', p.model);
  form.append('language', 'en');
  form.append('temperature', '0');
  form.append('response_format', 'verbose_json');
  // 刻意不傳 prompt：不把原句交給轉錄模型，避免分數灌水
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(0, timeoutMs));
  try {
    const res = await fetchImpl(p.url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${p.key}` },
      body: form,
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`${p.name} ${res.status}`);
    const data = await res.json();
    if (typeof data?.text !== 'string') throw new Error(`${p.name} 回傳格式錯誤`);
    return cleanWhisperText(data.text, data.segments);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 依序嘗試各供應商；每一家各自 try/catch（429、5xx、非 JSON、逾時、沒金鑰都換下一家）。
 * 整條鏈不超過 TOTAL_BUDGET_MS；剩餘時間不足 MIN_FALLBACK_MS 就不再試，回 502 讓前端改用 Gemini。
 */
export async function runTranscribeChain(opts: {
  audio: Uint8Array;
  mimeType: string;
  providers: TranscribeProvider[];
  fetchImpl: FetchLike;
  now: () => number;
  startedAt?: number;
}): Promise<TranscribeResult> {
  const { audio, mimeType, providers, fetchImpl, now } = opts;
  if (audio.length < MIN_AUDIO_BYTES) return { ok: true, text: '', model: '' };
  const deadline = (opts.startedAt ?? now()) + TOTAL_BUDGET_MS;

  for (let i = 0; i < providers.length; i++) {
    const p = providers[i];
    if (!p.key) continue;
    const remaining = deadline - now();
    if (i > 0 && remaining < MIN_FALLBACK_MS) break;
    const timeout = i === 0 ? Math.min(GROQ_TIMEOUT_MS, remaining) : remaining;
    const t0 = now();
    try {
      const text = await callProvider(p, audio, mimeType, fetchImpl, timeout);
      console.log(`[transcribe] 成功：${p.model} ${now() - t0}ms`);
      return { ok: true, text, model: p.model };
    } catch (err: any) {
      // 只記錯誤摘要，不記轉錄文字或音檔
      console.warn(`[transcribe] ${p.name} 失敗，換下一個`, String(err?.message || err).slice(0, 120));
    }
  }
  return { ok: false, status: 502, error: '語音轉文字暫時失敗' };
}
