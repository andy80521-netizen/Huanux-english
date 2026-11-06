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

async function callProvider(p: TranscribeProvider, audio: Uint8Array, mimeType: string, fetchImpl: FetchLike, timeoutMs: number, prompt?: string) {
  const form = new FormData();
  form.append('file', new Blob([audio], { type: (mimeType || 'audio/webm').split(';')[0] }), `recording.${extensionFor(mimeType)}`);
  form.append('model', p.model);
  form.append('language', 'en');
  form.append('temperature', '0');
  form.append('response_format', 'verbose_json');
  // 參考原句（docs/plans/whisper-reference.md）：只有呼叫端明確傳入才帶；另一條不帶原句的轉錄用來防「補了沒念的字」
  if (prompt) form.append('prompt', prompt);
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
  /** 參考原句（Whisper prompt）；不傳＝不帶 */
  prompt?: string;
}): Promise<TranscribeResult> {
  const { audio, mimeType, providers, fetchImpl, now, prompt } = opts;
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
      const text = await callProvider(p, audio, mimeType, fetchImpl, timeout, prompt);
      console.log(`[transcribe] 成功：${p.model}${prompt ? '（參考原句）' : ''} ${now() - t0}ms`);
      return { ok: true, text, model: p.model };
    } catch (err: any) {
      // 只記錯誤摘要，不記轉錄文字或音檔
      console.warn(`[transcribe] ${p.name} 失敗，換下一個`, String(err?.message || err).slice(0, 120));
    }
  }
  return { ok: false, status: 502, error: '語音轉文字暫時失敗' };
}

// ── 參考原句（docs/plans/whisper-reference.md，擁有者 2026-11-07 核准）──

/** 原句長度上限（字元）：Whisper 的 prompt 約 224 token，超過時保留尾端 */
export const REFERENCE_MAX_CHARS = 600;
/** 不帶原句那次的字數低於帶原句那次的這個比例 → 判定帶原句那次「補了沒念的字」 */
export const PADDED_WORD_RATIO = 0.6;

export function normalizeReference(ref: unknown): string {
  if (typeof ref !== 'string') return '';
  const t = ref.trim();
  if (!t) return '';
  if (t.length <= REFERENCE_MAX_CHARS) return t;
  const tail = t.slice(-REFERENCE_MAX_CHARS);
  const sp = tail.indexOf(' ');
  return (sp > 0 && sp < 40 ? tail.slice(sp + 1) : tail).trim();
}

const wordCount = (t: string) => t.split(/\s+/).filter(Boolean).length;

/** 帶原句那次的字數低於不帶原句那次的這個比例 → 判定帶原句那次漏字或亂寫（Bug 2026-11-07） */
export const SHORT_WORD_RATIO = 0.6;
/** 轉錄文字中出現在原句的比例低於這個 → 疑似幻覺（例：「In the following video…」約 0.13） */
export const SUSPECT_OVERLAP_RATIO = 0.3;
/** 少於這個字數的轉錄不判定幻覺（短回答本來就可能跟原句不同） */
const SUSPECT_MIN_WORDS = 3;

const tokens = (t: string) => t.toLowerCase().replace(/[\u2018\u2019]/g, "'").replace(/[^a-z0-9']+/g, ' ').split(' ').filter(Boolean);

/** 轉錄文字有幾個字出現在原句（每個原句字只能配對一次） */
function matchedCount(text: string, reference: string): number {
  const bag = new Map<string, number>();
  for (const w of tokens(reference)) bag.set(w, (bag.get(w) || 0) + 1);
  let n = 0;
  for (const w of tokens(text)) {
    const c = bag.get(w) || 0;
    if (c > 0) { n++; bag.set(w, c - 1); }
  }
  return n;
}

/** 轉錄文字中出現在原句的比例（0～1） */
export function referenceOverlap(text: string, reference: string): number {
  const total = tokens(text).length;
  return total === 0 ? 0 : matchedCount(text, reference) / total;
}

const looksHallucinated = (text: string, reference: string) =>
  !!reference && tokens(text).length >= SUSPECT_MIN_WORDS && referenceOverlap(text, reference) < SUSPECT_OVERLAP_RATIO;

export type ReferencedResult =
  | { ok: true; text: string; model: string; referenced: boolean; check: 'ok' | 'padded' | 'short' | 'worse' | 'unchecked' | 'plain' }
  | { ok: false; status: number; error: string };

/**
 * 兩條轉錄的結果 → 要用哪一個評分。帶原句只是幫 Whisper 認字，任何跡象顯示它反而出錯就改用不帶原句的結果：
 * - padded：不帶原句的字數 < 帶原句的 60%（帶原句補了沒念的字）
 * - short：帶原句的字數 < 不帶原句的 60%（帶原句漏字或吐出無關的句子）
 * - worse：帶原句的結果跟原句對上的字比不帶原句還少（原句沒幫上忙，反而帶偏）
 * - 只有帶原句成功且疑似幻覺 → 失敗，前端改用 Gemini（不帶原句）
 */
export function chooseReferencedTranscript(withRef: TranscribeResult, plain: TranscribeResult, reference = ''): ReferencedResult {
  if (withRef.ok && plain.ok) {
    const a = wordCount(withRef.text);
    const b = wordCount(plain.text);
    const usePlain = (check: 'padded' | 'short' | 'worse') => ({ ok: true as const, text: plain.text, model: plain.model, referenced: false, check });
    if (a > 0 && b < a * PADDED_WORD_RATIO) return usePlain('padded');
    if (b > 0 && a < b * SHORT_WORD_RATIO) return usePlain('short');
    if (reference && matchedCount(withRef.text, reference) < matchedCount(plain.text, reference)) return usePlain('worse');
    return { ok: true, text: withRef.text, model: withRef.model, referenced: true, check: 'ok' };
  }
  if (withRef.ok) {
    if (looksHallucinated(withRef.text, reference)) return { ok: false, status: 502, error: '語音轉文字結果異常' };
    return { ok: true, text: withRef.text, model: withRef.model, referenced: true, check: 'unchecked' };
  }
  if (plain.ok) return { ok: true, text: plain.text, model: plain.model, referenced: false, check: 'plain' };
  return withRef.ok === false ? { ok: false, status: withRef.status, error: withRef.error } : { ok: false, status: 502, error: '語音轉文字暫時失敗' };
}

/** 同一段錄音同時跑兩條轉錄鏈（帶原句／不帶），共用時間預算，再依 chooseReferencedTranscript 決定結果 */
export async function runReferencedTranscribe(opts: {
  audio: Uint8Array;
  mimeType: string;
  providers: TranscribeProvider[];
  fetchImpl: FetchLike;
  now: () => number;
  startedAt?: number;
  reference: string;
}): Promise<ReferencedResult> {
  const { reference, ...base } = opts;
  const startedAt = opts.startedAt ?? opts.now();
  const [withRef, plain] = await Promise.all([
    runTranscribeChain({ ...base, startedAt, prompt: reference }),
    runTranscribeChain({ ...base, startedAt }),
  ]);
  const r = chooseReferencedTranscript(withRef, plain, reference);
  if (!r.ok || r.check !== 'ok') console.warn(`[transcribe] 參考原句檢查：${r.ok ? r.check : '疑似幻覺或失敗'}`);
  return r;
}

/**
 * Gemini 備援的回應 → 轉錄文字（PR B 審查第 1 輪，Codex）：
 * 有文字（含空字串）→ 回傳；沒有文字但模型正常結束（finishReason 為 STOP）→ 視為沒有人聲，回傳 ''；
 * 其他（被安全機制擋下、截斷、格式異常）→ null，呼叫端當成失敗，不可把供應商異常當成「使用者沒說話」
 */
export function transcriptFromGeminiResponse(resp: unknown): string | null {
  const r = resp as { text?: unknown; candidates?: Array<{ finishReason?: string }> } | null | undefined;
  if (!r) return null;
  if (typeof r.text === 'string') return r.text.trim();
  if (r.text === undefined && Array.isArray(r.candidates) && r.candidates[0]?.finishReason === 'STOP') return '';
  return null;
}
