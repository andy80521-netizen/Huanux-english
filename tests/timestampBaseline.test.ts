import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// 規劃：docs/plans/timestamp-baseline.md（擁有者 2026-11-12 核准）
const read = (f: string) => readFileSync(resolve(__dirname, '..', f), 'utf8');
const load = async (p: string) => (await import(/* @vite-ignore */ p)) as any;

// ── 1. 切句搬到共用模組，行為完全不變 ─────────────────────────────
// 合成文字（不含真實教材內容）；預期輸出是搬移前的 whisper-transcribe.ts 實際跑出的結果
const SEGMENTS = [
  { text: ' Welcome to the show.', start: 0.0, end: 1.84 },
  { text: ' Today Dr.', start: 1.84, end: 2.5 },
  { text: ' Smith joins us', start: 2.5, end: 3.4 },
  { text: ' to talk about prices.', start: 3.4, end: 5.06 },
  { text: ' and then', start: 5.06, end: 5.9 },
  { text: ' it went', start: 5.9, end: 6.7 },
  { text: ' on and on', start: 6.7, end: 7.5 },
  { text: ' without stopping', start: 7.5, end: 8.33 },
  { text: ' until the end.', start: 8.33, end: 9.1 },
  { text: ' Music.', start: 10.0, end: 10.5 },
  { text: ' Hey', start: 10.5, end: 11.0 },
  { text: ' This took a very long time.', start: 11.0, end: 21.0 },
  { text: ' "Is it over?"', start: 21.2, end: 22.777 },
  { text: ' Mr', start: 23.0, end: 23.3 },
  { text: ' Last words', start: 23.3, end: 24.1049 },
];
const EXPECTED = [
  { text: 'Welcome to the show.', startTime: 0, endTime: 1.84 },
  { text: 'Today Dr.', startTime: 1.74, endTime: 2.5 },
  { text: 'Smith joins us to talk about prices.', startTime: 2.4, endTime: 5.06 },
  { text: 'and then it went on and on without stopping', startTime: 4.96, endTime: 8.33, lowConfidence: true },
  { text: 'until the end. Music. Hey This took a very long time.', startTime: 10.4, endTime: 21, lowConfidence: true },
  { text: '"Is it over?"', startTime: 21.1, endTime: 22.78 },
  { text: 'Mr Last words', startTime: 22.9, endTime: 24.1 },
];

describe('切句搬到 netlify/shared/sentenceSegmentation.ts（行為不變）', () => {
  it('固定輸入的輸出與搬移前完全相同', async () => {
    const m = await load('../netlify/shared/sentenceSegmentation');
    expect(m.mergeSegmentsIntoSentences(SEGMENTS)).toEqual(EXPECTED);
  });
  it('正式轉錄改用共用模組，不再自己定義', () => {
    const src = read('netlify/functions/whisper-transcribe.ts');
    expect(src).toMatch(/from ['"]\.\.\/shared\/sentenceSegmentation['"]/);
    expect(src).not.toMatch(/function mergeSegmentsIntoSentences/);
    expect(src).toMatch(/timestamp_granularities\[\]", "segment"/);
    expect(src).not.toMatch(/"word"/);
  });
});

// ── 2. 診斷：安全 ─────────────────────────────────────────────
const CTX = { uid: 'u1', materialId: 'm1', appId: 'huan-power-english', bucket: 'huanux-english.firebasestorage.app' };
const OWN_URL = 'https://firebasestorage.googleapis.com/v0/b/huanux-english.firebasestorage.app/o/artifacts%2Fhuan-power-english%2Fusers%2Fu1%2Fmaterials%2Fm1.mp3?alt=media&token=t';

describe('診斷：只處理自己的上傳音檔', () => {
  it('接受自己的教材音檔；拒絕別人的、別的 bucket、別的主機、http、語音合成教材', async () => {
    const d = await load('../netlify/shared/transcribeDiagnostic');
    const ok = (m: any) => d.validateDiagnosticMaterial(m, CTX).ok;
    expect(ok({ audioUrl: OWN_URL, audioSource: 'upload' })).toBe(true);
    expect(ok({ audioUrl: OWN_URL.replace('u1%2F', 'u2%2F'), audioSource: 'upload' })).toBe(false);
    expect(ok({ audioUrl: OWN_URL.replace('m1.mp3', 'm2.mp3'), audioSource: 'upload' })).toBe(false);
    expect(ok({ audioUrl: OWN_URL.replace('huanux-english.firebasestorage.app', 'evil.appspot.com'), audioSource: 'upload' })).toBe(false);
    expect(ok({ audioUrl: 'https://169.254.169.254/latest', audioSource: 'upload' })).toBe(false);
    expect(ok({ audioUrl: OWN_URL.replace('https:', 'http:'), audioSource: 'upload' })).toBe(false);
    expect(ok({ audioUrl: OWN_URL, audioSource: 'tts' })).toBe(false);
    expect(ok(null)).toBe(false);
  });

  it('下載音檔不跟隨轉址；超過 25MB 不送出', async () => {
    const d = await load('../netlify/shared/transcribeDiagnostic');
    const calls: any[] = [];
    const redirect = vi.fn(async (url: string, init: any) => { calls.push(init); return new Response(null, { status: 302, headers: { location: 'http://10.0.0.1/' } }); });
    await expect(d.fetchDiagnosticAudio(OWN_URL, redirect)).rejects.toThrow();
    expect(calls[0].redirect).toMatch(/manual|error/);
    const big = vi.fn(async () => new Response(new Uint8Array(10), { status: 200, headers: { 'content-length': String(26 * 1024 * 1024) } }));
    await expect(d.fetchDiagnosticAudio(OWN_URL, big)).rejects.toThrow(/25/);
    const ok = vi.fn(async () => new Response(new Uint8Array(3000), { status: 200 }));
    expect((await d.fetchDiagnosticAudio(OWN_URL, ok)).byteLength).toBe(3000);
  });

  it('同一份教材 10 分鐘內不重複執行；卡住超過 20 分鐘的執行可重來', async () => {
    const d = await load('../netlify/shared/transcribeDiagnostic');
    const now = 1_000_000_000_000;
    const min = 60_000;
    expect(d.canStartDiagnostic(null, now)).toBe(true);
    expect(d.canStartDiagnostic({ status: 'running', startedAt: now - 5 * min }, now)).toBe(false);
    expect(d.canStartDiagnostic({ status: 'running', startedAt: now - 21 * min }, now)).toBe(true);
    expect(d.canStartDiagnostic({ status: 'done', startedAt: now - 5 * min }, now)).toBe(false);
    expect(d.canStartDiagnostic({ status: 'done', startedAt: now - 11 * min }, now)).toBe(true);
    expect(d.canStartDiagnostic({ status: 'error', startedAt: now - 1 * min }, now)).toBe(true);
  });
});

// ── 3. 診斷：呼叫兩家 ────────────────────────────────────────
const formOf = (init: any) => init.body as FormData;
const okJson = (body: any) => new Response(JSON.stringify(body), { status: 200 });
const err = (status: number, message: string) => new Response(JSON.stringify({ error: { message } }), { status });
const WHISPER_OK = {
  segments: [{ text: ' Hello there.', start: 0, end: 1.2 }],
  words: [{ word: 'Hello', start: 0, end: 0.5 }, { word: 'there.', start: 0.5, end: 1.2 }],
};

describe('診斷：OpenAI 與 Groq', () => {
  it('OpenAI：whisper-1、verbose_json、segment＋word、language=en', async () => {
    const d = await load('../netlify/shared/transcribeDiagnostic');
    let init: any;
    const f = vi.fn(async (_u: string, i: any) => { init = i; return okJson(WHISPER_OK); });
    const r = await d.callOpenAIDiagnostic(new ArrayBuffer(3000), 'k', f);
    const form = formOf(init);
    expect(form.get('model')).toBe('whisper-1');
    expect(form.get('response_format')).toBe('verbose_json');
    expect(form.getAll('timestamp_granularities[]').sort()).toEqual(['segment', 'word']);
    expect(form.get('language')).toBe('en');
    expect(r.status).toBe('done');
    expect(r.wordsStatus).toBe('ok');
    expect(r.segments).toEqual([{ t: 'Hello there.', s: 0, e: 1.2 }]);
    expect(r.words).toEqual({ w: ['Hello', 'there.'], s: [0, 0.5], e: [0.5, 1.2] });
  });

  it('Groq：不認得整個參數 → 拿掉參數重試', async () => {
    const d = await load('../netlify/shared/transcribeDiagnostic');
    const forms: FormData[] = [];
    const f = vi.fn(async (_u: string, i: any) => {
      forms.push(formOf(i));
      return forms.length === 1 ? err(400, 'unknown param timestamp_granularities') : okJson({ segments: WHISPER_OK.segments });
    });
    const r = await d.callGroqDiagnostic(new ArrayBuffer(3000), 'k', f);
    expect(forms[0].getAll('timestamp_granularities[]').sort()).toEqual(['segment', 'word']);
    expect(forms[1].getAll('timestamp_granularities[]')).toEqual([]);
    expect(forms[1].get('response_format')).toBe('verbose_json');
    expect(r.status).toBe('done');
    expect(r.wordsStatus).toBe('unsupported-param');
    expect(r.notes.join(' ')).toMatch(/unknown param/);
  });

  it('Groq：不支援 word → 只帶 segment 重試', async () => {
    const d = await load('../netlify/shared/transcribeDiagnostic');
    const forms: FormData[] = [];
    const f = vi.fn(async (_u: string, i: any) => {
      forms.push(formOf(i));
      return forms.length === 1 ? err(400, "timestamp_granularities 'word' is not supported for this model") : okJson({ segments: WHISPER_OK.segments });
    });
    const r = await d.callGroqDiagnostic(new ArrayBuffer(3000), 'k', f);
    expect(forms[1].getAll('timestamp_granularities[]')).toEqual(['segment']);
    expect(r.wordsStatus).toBe('unsupported-word');
  });

  it('Groq：其他 400 不重試，記錄錯誤；成功但沒有 words → wordsStatus missing', async () => {
    const d = await load('../netlify/shared/transcribeDiagnostic');
    const f1 = vi.fn(async () => err(400, 'file is too short'));
    const r1 = await d.callGroqDiagnostic(new ArrayBuffer(3000), 'k', f1);
    expect(f1).toHaveBeenCalledTimes(1);
    expect(r1.status).toBe('error');
    expect(r1.error).toMatch(/400/);
    const f2 = vi.fn(async () => okJson({ segments: WHISPER_OK.segments }));
    const r2 = await d.callGroqDiagnostic(new ArrayBuffer(3000), 'k', f2);
    expect(r2.status).toBe('done');
    expect(r2.wordsStatus).toBe('missing');
  });

  it('錯誤訊息不含金鑰', async () => {
    const d = await load('../netlify/shared/transcribeDiagnostic');
    const f = vi.fn(async () => err(401, 'Incorrect API key provided: sk-secret123'));
    const r = await d.callOpenAIDiagnostic(new ArrayBuffer(3000), 'sk-secret123', f);
    expect(r.status).toBe('error');
    expect(r.error).not.toContain('sk-secret123');
  });
});

// ── 4. Firestore 大小與分塊 ─────────────────────────────────
describe('診斷資料：依 Firestore 計算大小，超過就分塊', () => {
  it('大小估算依官方規則（字串 UTF-8＋1、數字 8、欄位名稱＋1）', async () => {
    const d = await load('../netlify/shared/transcribeDiagnostic');
    expect(d.firestoreValueSize('abc')).toBe(4);
    expect(d.firestoreValueSize('中')).toBe(4);
    expect(d.firestoreValueSize(1.5)).toBe(8);
    expect(d.firestoreValueSize(true)).toBe(1);
    expect(d.firestoreValueSize(null)).toBe(1);
    expect(d.firestoreValueSize([1, 'ab'])).toBe(8 + 3);
    expect(d.firestoreValueSize({ a: 1, bb: 'x' })).toBe(2 + 8 + 3 + 2);
  });

  it('長音檔（約 60 分鐘、1 萬字）分成多塊，每塊 ≤ 800KB，重組後與原資料相同', async () => {
    const d = await load('../netlify/shared/transcribeDiagnostic');
    const n = 10_000;
    const words = { w: Array.from({ length: n }, (_, i) => `word${i}`), s: Array.from({ length: n }, (_, i) => i * 0.3), e: Array.from({ length: n }, (_, i) => i * 0.3 + 0.25) };
    const segments = Array.from({ length: 900 }, (_, i) => ({ t: `This is synthetic segment number ${i} with several words in it.`, s: i * 4, e: i * 4 + 3.9 }));
    const parts = d.chunkProviderData({ segments, words }, 800_000);
    expect(parts.length).toBeGreaterThan(1);
    for (const p of parts) expect(d.firestoreValueSize(p)).toBeLessThanOrEqual(800_000);
    expect(d.reassembleProviderData(parts)).toEqual({ segments, words });
  });
});

// ── 5. 整體流程（假的 API 與寫入）──────────────────────────────
describe('runDiagnostic：兩家各自獨立，寫入狀態', () => {
  const deps = (over: any = {}) => {
    const writes: Array<{ path: string; data: any }> = [];
    return {
      writes,
      deps: {
        uid: 'u1', materialId: 'm1', now: () => 1_000_000,
        readMaterial: async () => ({ audioUrl: OWN_URL, audioSource: 'upload', title: 'T' }),
        readDiagnostic: async () => null,
        fetchAudio: async () => new ArrayBuffer(3000),
        openai: async () => ({ status: 'done', model: 'whisper-1', wordsStatus: 'ok', segments: [{ t: 'a.', s: 0, e: 1 }], words: { w: ['a.'], s: [0], e: [1] }, notes: [] }),
        groq: async () => { throw new Error('Groq 503'); },
        write: async (path: string, data: any) => { writes.push({ path, data }); },
        ...over,
      },
    };
  };

  it('Groq 失敗不影響 OpenAI；主文件最後是 done，記下各家狀態', async () => {
    const d = await load('../netlify/shared/transcribeDiagnostic');
    const { writes, deps: dd } = deps();
    await d.runDiagnostic(dd);
    expect(writes[0].data.status).toBe('running');
    const last = writes[writes.length - 1];
    expect(last.path).toMatch(/transcriptionDiagnostics\/m1$/);
    expect(last.data.status).toBe('done');
    expect(last.data.providers.openai.status).toBe('done');
    expect(last.data.providers.groq.status).toBe('error');
    expect(last.data.providers.groq.error).toMatch(/503/);
    expect(writes.some(w => /transcriptionDiagnostics\/m1\/parts\/openai-0$/.test(w.path))).toBe(true);
  });

  it('兩家都失敗 → error；教材網址不是自己的 → error 且不下載', async () => {
    const d = await load('../netlify/shared/transcribeDiagnostic');
    const a = deps({ openai: async () => { throw new Error('x'); } });
    await d.runDiagnostic(a.deps);
    expect(a.writes[a.writes.length - 1].data.status).toBe('error');
    const fetchAudio = vi.fn();
    const b = deps({ readMaterial: async () => ({ audioUrl: 'https://169.254.169.254/', audioSource: 'upload' }), fetchAudio });
    await d.runDiagnostic(b.deps);
    expect(fetchAudio).not.toHaveBeenCalled();
    expect(b.writes[b.writes.length - 1].data.status).toBe('error');
  });

  it('10 分鐘內已執行過 → 不執行、不寫入', async () => {
    const d = await load('../netlify/shared/transcribeDiagnostic');
    const { writes, deps: dd } = deps({ readDiagnostic: async () => ({ status: 'done', startedAt: 1_000_000 - 60_000 }) });
    await d.runDiagnostic(dd);
    expect(writes).toEqual([]);
  });

  it('背景函式：驗證正式帳號、檢查 materialId 格式、路徑用 token 的 uid', () => {
    const f = read('netlify/functions/transcribe-diagnostic.ts');
    expect(f).toMatch(/config = \{ background: true \}/);
    expect(f).toMatch(/verifyRealUserToken\(/);
    expect(f).toMatch(/ID_PATTERN\.test\(materialId\)/);
    expect(f).toMatch(/authResult\.uid/);
    expect(f).toMatch(/runDiagnostic\(/);
  });
});

// ── 6. 前端 ─────────────────────────────────────────────────
describe('教材詳情頁：⋯ 選單的時間軸診斷', () => {
  it('⋯ 選單有「時間軸診斷」，只有上傳音檔的教材顯示', () => {
    const v = read('src/components/MaterialDetailView.tsx');
    expect(v).toMatch(/aria-label="更多"/);
    expect(v).toMatch(/material\.audioSource === 'upload'/);
    expect(v).toContain('時間軸診斷');
  });
  it('可開始、下載（含教材目前時間）、刪除', () => {
    const s = read('src/services/transcriptionDiagnostic.ts');
    expect(s).toMatch(/export async function startTranscriptionDiagnostic/);
    expect(s).toMatch(/export async function downloadTranscriptionDiagnostic/);
    expect(s).toMatch(/export async function deleteTranscriptionDiagnostic/);
    expect(s).toMatch(/reassembleProviderData/);
    expect(s).toMatch(/originalStartTime/);
  });
});

// ── 7. 評分程式（與切句結果無關的人工標註邊界）────────────────────
describe('evaluateBoundaries', () => {
  const region = (from: number, to: number, boundaries: Array<[number, 'start' | 'end']>) => ({ from, to, boundaries: boundaries.map(([t, kind]) => ({ t, kind })) });
  const sent = (pairs: Array<[number, number]>) => pairs.map(([startTime, endTime]) => ({ startTime, endTime }));

  it('完全一致 → 誤差 0、沒有漏切多切', async () => {
    const { evaluateBoundaries } = await load('../netlify/shared/timestampEval');
    const r = evaluateBoundaries(sent([[1, 3], [3.2, 5]]), [region(0.5, 5.5, [[1, 'start'], [3, 'end'], [3.2, 'start'], [5, 'end']])]);
    expect(r.matched).toBe(4);
    expect(r.startMAE).toBe(0);
    expect(r.endMAE).toBe(0);
    expect(r.missed).toBe(0);
    expect(r.extra).toBe(0);
  });

  it('句尾系統性偏晚 0.1 → endMAE 0.1、endBias +0.1', async () => {
    const { evaluateBoundaries } = await load('../netlify/shared/timestampEval');
    const r = evaluateBoundaries(sent([[1, 3.1], [3.2, 5.1]]), [region(0.5, 5.5, [[1, 'start'], [3, 'end'], [3.2, 'start'], [5, 'end']])]);
    expect(r.endMAE).toBeCloseTo(0.1, 6);
    expect(r.endBias).toBeCloseTo(0.1, 6);
    expect(r.startMAE).toBe(0);
  });

  it('一句含兩句（漏切）：中間的句尾、句首都算 missed，且計入超過 0.2 秒的比例', async () => {
    const { evaluateBoundaries } = await load('../netlify/shared/timestampEval');
    const r = evaluateBoundaries(sent([[1, 5]]), [region(0.5, 5.5, [[1, 'start'], [3, 'end'], [3.2, 'start'], [5, 'end']])]);
    expect(r.matched).toBe(2);
    expect(r.missed).toBe(2);
    expect(r.over02Ratio).toBeCloseTo(0.5, 6);
  });

  it('句中被切斷（多切）：範圍內沒對到的邊界算 extra；範圍外的不算', async () => {
    const { evaluateBoundaries } = await load('../netlify/shared/timestampEval');
    const r = evaluateBoundaries(sent([[1, 2], [2, 3], [10, 12]]), [region(0.5, 3.5, [[1, 'start'], [3, 'end']])]);
    expect(r.matched).toBe(2);
    expect(r.extra).toBe(2);
  });

  it('一對一：兩個標註邊界靠近同一個預測邊界 → 一個 matched、一個 missed', async () => {
    const { evaluateBoundaries } = await load('../netlify/shared/timestampEval');
    const r = evaluateBoundaries(sent([[1, 3]]), [region(0.5, 4, [[1, 'start'], [2.9, 'end'], [3.1, 'end']])]);
    expect(r.matched).toBe(2);
    expect(r.missed).toBe(1);
  });

  it('超過 1 秒才找到的邊界不算對到', async () => {
    const { evaluateBoundaries } = await load('../netlify/shared/timestampEval');
    const r = evaluateBoundaries(sent([[1, 4.5]]), [region(0.5, 5, [[1, 'start'], [3, 'end']])]);
    expect(r.missed).toBe(1);
    expect(r.extra).toBe(1);
  });
});

// ── 8. D：用字的時間切句（離線對照用，不接正式流程）─────────────────
describe('buildSentencesFromWords', () => {
  const W = (list: Array<[string, number, number]>) => ({ w: list.map(x => x[0]), s: list.map(x => x[1]), e: list.map(x => x[2]) });

  it('在句末標點切句，起點＝第一個字（再減 0.1）、終點＝最後一個字', async () => {
    const { buildSentencesFromWords } = await load('../netlify/shared/wordSegmentation');
    const r = buildSentencesFromWords(W([['Hello', 1, 1.3], ['there.', 1.3, 1.7], ['How', 2.5, 2.7], ['are', 2.7, 2.8], ['you?', 2.8, 3.1]]));
    expect(r.map((x: any) => [x.text, x.startTime, x.endTime])).toEqual([['Hello there.', 0.9, 1.7], ['How are you?', 2.4, 3.1]]);
  });

  it('縮寫（Dr.、Mr.）不切句', async () => {
    const { buildSentencesFromWords } = await load('../netlify/shared/wordSegmentation');
    const r = buildSentencesFromWords(W([['Dr.', 1, 1.2], ['Smith', 1.2, 1.5], ['left.', 1.5, 1.9]]));
    expect(r).toHaveLength(1);
  });

  it('句尾的字被拉長（涵蓋停頓）→ 終點以「字的起點＋一般字長」為上限、標低可信度；不用下一個字的起點', async () => {
    const { buildSentencesFromWords } = await load('../netlify/shared/wordSegmentation');
    const r = buildSentencesFromWords(W([['It', 9.4, 9.6], ['is', 9.6, 9.8], ['done.', 9.8, 13.0], ['Next', 14.0, 14.3], ['one.', 14.3, 14.7]]));
    expect(r[0].endTime).toBeLessThan(10.8);
    expect(r[0].endTime).toBeGreaterThan(9.8);
    expect(r[0].lowConfidence).toBe(true);
    expect(r[1].startTime).toBeCloseTo(13.9, 6);
  });

  it('最後一個字沒有後繼字、沒有句末標點：照樣收尾', async () => {
    const { buildSentencesFromWords } = await load('../netlify/shared/wordSegmentation');
    const r = buildSentencesFromWords(W([['and', 1, 1.2], ['then', 1.2, 1.5]]));
    expect(r).toHaveLength(1);
    expect(r[0].endTime).toBe(1.5);
  });

  it('時間倒退或零長度的字 → 不讓終點早於起點，標低可信度', async () => {
    const { buildSentencesFromWords } = await load('../netlify/shared/wordSegmentation');
    const r = buildSentencesFromWords(W([['A', 5, 5], ['b', 4.8, 4.9], ['c.', 4.9, 5.0]]));
    expect(r[0].endTime).toBeGreaterThan(r[0].startTime);
    expect(r[0].lowConfidence).toBe(true);
  });

  it('不接到正式匯入流程', () => {
    expect(read('netlify/functions/whisper-transcribe.ts')).not.toMatch(/wordSegmentation/);
  });
});
