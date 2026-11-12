import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// 擁有者 2026-11-12：11/09 匯入的教材時間全是整數秒；診斷（segment＋word）今天回傳 0.01 秒精度
// → 診斷多一組「OpenAI 只要求 segment」（與正式匯入相同設定），確認整數秒是不是設定造成（docs/plans/timestamp-baseline.md）
const read = (f: string) => readFileSync(resolve(__dirname, '..', f), 'utf8');
const load = async (p: string) => (await import(/* @vite-ignore */ p)) as any;
const okJson = (body: any) => new Response(JSON.stringify(body), { status: 200 });
const OWN_URL = 'https://firebasestorage.googleapis.com/v0/b/huanux-english.firebasestorage.app/o/artifacts%2Fhuan-power-english%2Fusers%2Fu1%2Fmaterials%2Fm1.mp3?alt=media&token=t';

describe('診斷：OpenAI 只要求 segment（與正式匯入相同）', () => {
  it('callOpenAIDiagnostic 可指定只要求 segment；不要求 word 時 wordsStatus 為 not-requested', async () => {
    const d = await load('../netlify/shared/transcribeDiagnostic');
    let form: FormData | null = null;
    const f = vi.fn(async (_u: string, i: any) => { form = i.body; return okJson({ segments: [{ text: ' A.', start: 0, end: 1 }] }); });
    const r = await d.callOpenAIDiagnostic(new ArrayBuffer(3000), 'k', f, ['segment']);
    expect(form!.getAll('timestamp_granularities[]')).toEqual(['segment']);
    expect(form!.get('language')).toBe('en');
    expect(r.status).toBe('done');
    expect(r.wordsStatus).toBe('not-requested');
  });

  it('runDiagnostic 第三組 openaiSegment 獨立執行並寫入', async () => {
    const d = await load('../netlify/shared/transcribeDiagnostic');
    const writes: any[] = [];
    await d.runDiagnostic({
      uid: 'u1', materialId: 'm1', now: () => 1,
      readMaterial: async () => ({ audioUrl: OWN_URL, audioSource: 'upload' }),
      readDiagnostic: async () => null,
      fetchAudio: async () => new ArrayBuffer(3000),
      openai: async () => ({ status: 'done', model: 'whisper-1', wordsStatus: 'ok', segments: [{ t: 'a.', s: 0, e: 1 }], words: null, notes: [] }),
      groq: async () => ({ status: 'error', model: 'g', notes: [], error: 'x' }),
      openaiSegment: async () => ({ status: 'done', model: 'whisper-1', wordsStatus: 'not-requested', segments: [{ t: 'a.', s: 0, e: 1 }], words: null, notes: [] }),
      write: async (path: string, data: any) => { writes.push({ path, data }); },
    });
    const last = writes[writes.length - 1].data;
    expect(last.providers.openaiSegment.status).toBe('done');
    expect(writes.some(w => /parts\/openaiSegment-0$/.test(w.path))).toBe(true);
  });

  // 擁有者 2026-11-12 同意修改：診斷證實只要求 segment 時全是整數秒 → 正式匯入改為同時要求 word（切句仍只用 segments）
  it('背景函式接上 openaiSegment（只要求 segment）；正式匯入改為 segment＋word', () => {
    const f = read('netlify/functions/transcribe-diagnostic.ts');
    expect(f).toMatch(/openaiSegment: \(audio\) =>/);
    expect(f).toMatch(/\['segment'\]/);
    expect(read('netlify/functions/whisper-transcribe.ts')).toMatch(/timestamp_granularities\[\]", "word"/);
  });

  it('前端下載與畫面包含第三組', () => {
    expect(read('src/services/transcriptionDiagnostic.ts')).toMatch(/'openaiSegment'/);
    expect(read('src/components/TimelineDiagnosticDialog.tsx')).toMatch(/openaiSegment:/);
  });
});
