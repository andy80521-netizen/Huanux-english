import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  isLikelyNoSpeech, cleanWhisperText, extensionFor, runTranscribeChain,
  TOTAL_BUDGET_MS, GROQ_TIMEOUT_MS, MIN_FALLBACK_MS, MIN_AUDIO_BYTES,
} from '../netlify/shared/transcribe';

// PR B：Groq Whisper large-v3 為主力的轉錄鏈（擁有者 2026-10-30 核准）

const seg = (no_speech_prob: number, avg_logprob: number) => ({ no_speech_prob, avg_logprob });

describe('空白錄音防呆', () => {
  it('沒有片段資訊或缺欄位 → 視為有人聲（不誤刪）', () => {
    expect(isLikelyNoSpeech(undefined)).toBe(false);
    expect(isLikelyNoSpeech([])).toBe(false);
    expect(isLikelyNoSpeech([{ no_speech_prob: 0.9 } as any])).toBe(false);
  });
  it('每一段都 no_speech ≥ 0.6 且 avg_logprob ≤ -1 → 沒有人聲', () => {
    expect(isLikelyNoSpeech([seg(0.9, -1.2), seg(0.6, -1)])).toBe(true);
  });
  it('只要有一段像人聲 → 有人聲', () => {
    expect(isLikelyNoSpeech([seg(0.9, -1.2), seg(0.1, -0.3)])).toBe(false);
    expect(isLikelyNoSpeech([seg(0.59, -1.5)])).toBe(false);
    expect(isLikelyNoSpeech([seg(0.9, -0.5)])).toBe(false);
  });
  it('「Thank you.」：沒有人聲時清掉，有人聲時保留', () => {
    expect(cleanWhisperText(' Thank you. ', [seg(0.95, -1.4)])).toBe('');
    expect(cleanWhisperText(' Thank you. ', [seg(0.05, -0.2)])).toBe('Thank you.');
    expect(cleanWhisperText(' I used to walk. ', undefined)).toBe('I used to walk.');
  });
});

describe('副檔名', () => {
  it('只看 MIME 主類型', () => {
    expect(extensionFor('audio/webm;codecs=opus')).toBe('webm');
    expect(extensionFor('audio/mp4')).toBe('mp4');
    expect(extensionFor('audio/mp4;codecs=mp4a.40.2')).toBe('mp4');
    expect(extensionFor('audio/ogg')).toBe('ogg');
    expect(extensionFor('audio/aac')).toBe('m4a');
  });
});

// ── 轉錄鏈 ──
const GROQ = { name: 'Groq', url: 'https://groq.test/transcriptions', model: 'whisper-large-v3', key: 'g' };
const OPENAI = { name: 'OpenAI', url: 'https://openai.test/transcriptions', model: 'whisper-1', key: 'o' };
const audio = new Uint8Array(5000);
const ok = (body: unknown) => Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
const status = (n: number, body = 'err') => Promise.resolve(new Response(body, { status: n }));
/** 永遠不回應，直到被取消 */
const hang = (init?: RequestInit) => new Promise<Response>((_, reject) => {
  init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
});
const formOf = (init?: RequestInit) => init?.body as FormData;

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe('runTranscribeChain', () => {
  it('時間預算：總共 9 秒、Groq 最多 6 秒、剩不到 3 秒不試 OpenAI；太短的錄音門檻 2000 bytes', () => {
    expect(TOTAL_BUDGET_MS).toBe(9000);
    expect(GROQ_TIMEOUT_MS).toBe(6000);
    expect(MIN_FALLBACK_MS).toBe(3000);
    expect(MIN_AUDIO_BYTES).toBe(2000);
  });

  it('Groq 成功就不打 OpenAI；參數正確且不含 prompt', async () => {
    const fetchImpl = vi.fn((url: string, init?: RequestInit) => ok({ text: ' Hello there. ', segments: [seg(0.02, -0.2)] }));
    const r = await runTranscribeChain({ audio, mimeType: 'audio/webm;codecs=opus', providers: [GROQ, OPENAI], fetchImpl, now: () => Date.now() });
    expect(r).toEqual({ ok: true, text: 'Hello there.', model: 'whisper-large-v3' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe(GROQ.url);
    const f = formOf(init);
    expect(f.get('model')).toBe('whisper-large-v3');
    expect(f.get('language')).toBe('en');
    expect(f.get('temperature')).toBe('0');
    expect(f.get('response_format')).toBe('verbose_json');
    expect(f.has('prompt')).toBe(false);
    expect((f.get('file') as File).name).toBe('recording.webm');
    expect((init!.headers as Record<string, string>).Authorization).toBe('Bearer g');
  });

  it('Groq 429／5xx／非 JSON → 改 OpenAI，OpenAI 也用 verbose_json 並套用空白防呆', async () => {
    for (const bad of [() => status(429), () => status(503), () => Promise.resolve(new Response('<html>', { status: 200 }))]) {
      const fetchImpl = vi.fn((url: string, _init?: RequestInit) => (url === GROQ.url ? bad() : ok({ text: 'Thank you.', segments: [seg(0.9, -1.3)] })));
      const r = await runTranscribeChain({ audio, mimeType: 'audio/mp4', providers: [GROQ, OPENAI], fetchImpl, now: () => Date.now() });
      expect(r).toEqual({ ok: true, text: '', model: 'whisper-1' });
      expect(formOf(fetchImpl.mock.calls[1][1]).get('response_format')).toBe('verbose_json');
      expect(formOf(fetchImpl.mock.calls[1][1]).has('prompt')).toBe(false);
    }
  });

  it('沒有 Groq 金鑰 → 直接用 OpenAI', async () => {
    const fetchImpl = vi.fn(() => ok({ text: 'Hi.', segments: [] }));
    const r = await runTranscribeChain({ audio, mimeType: 'audio/webm', providers: [{ ...GROQ, key: undefined }, OPENAI], fetchImpl, now: () => Date.now() });
    expect(r).toEqual({ ok: true, text: 'Hi.', model: 'whisper-1' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('Groq 逾時 6 秒後 OpenAI 也卡住 → 9 秒內回 502（不等到平台中斷）', async () => {
    const fetchImpl = vi.fn((_url: string, init?: RequestInit) => hang(init));
    let settled: any = null;
    runTranscribeChain({ audio, mimeType: 'audio/webm', providers: [GROQ, OPENAI], fetchImpl, now: () => Date.now() }).then((r) => { settled = r; });
    await vi.advanceTimersByTimeAsync(6000);
    expect(fetchImpl).toHaveBeenCalledTimes(2); // Groq 逾時後改試 OpenAI
    await vi.advanceTimersByTimeAsync(2999);
    expect(settled).toBeNull();
    await vi.advanceTimersByTimeAsync(1);
    expect(settled).toMatchObject({ ok: false, status: 502 });
  });

  it('剩餘時間不到 3 秒 → 不試 OpenAI，直接 502', async () => {
    let t = 0;
    const fetchImpl = vi.fn((url: string) => { t = 6500; return status(500); });
    const r = await runTranscribeChain({ audio, mimeType: 'audio/webm', providers: [GROQ, OPENAI], fetchImpl, now: () => t, startedAt: 0 });
    expect(r).toMatchObject({ ok: false, status: 502 });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('太短的錄音不打外部服務，回傳空字串', async () => {
    const fetchImpl = vi.fn();
    const r = await runTranscribeChain({ audio: new Uint8Array(1000), mimeType: 'audio/webm', providers: [GROQ, OPENAI], fetchImpl, now: () => Date.now() });
    expect(r).toEqual({ ok: true, text: '', model: '' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

// 審查第 1 輪（Codex）：Gemini 缺少文字的異常回應不可當成「沒有人聲」
import { transcriptFromGeminiResponse } from '../netlify/shared/transcribe';
describe('transcriptFromGeminiResponse', () => {
  it('有文字（含空字串）→ 回傳', () => {
    expect(transcriptFromGeminiResponse({ text: ' I used to walk. ' })).toBe('I used to walk.');
    expect(transcriptFromGeminiResponse({ text: '' })).toBe('');
  });
  it('沒有文字但正常結束 → 視為沒有人聲', () => {
    expect(transcriptFromGeminiResponse({ candidates: [{ finishReason: 'STOP' }] })).toBe('');
  });
  it('被擋下、截斷、沒有回應 → null（當成失敗）', () => {
    expect(transcriptFromGeminiResponse({ candidates: [{ finishReason: 'SAFETY' }] })).toBeNull();
    expect(transcriptFromGeminiResponse({ candidates: [] })).toBeNull();
    expect(transcriptFromGeminiResponse({})).toBeNull();
    expect(transcriptFromGeminiResponse(null)).toBeNull();
  });
});
