import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// PR B：前端轉錄順序（transcribe-recording → 失敗才用 Gemini）、空字串是合法結果、413 不改打 Gemini

vi.mock('../src/firebase', () => ({ auth: { currentUser: { getIdToken: async () => 'tok' } }, storage: {}, appId: 'test' }));
vi.mock('firebase/storage', () => ({ ref: () => null, uploadBytes: async () => null, getDownloadURL: async () => '' }));
vi.mock('@google/genai', () => ({ GoogleGenAI: class {}, ThinkingLevel: { MINIMAL: 'MINIMAL' } }));

class FakeFileReader {
  result = 'data:audio/webm;base64,QUJD';
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  readAsDataURL() { setTimeout(() => this.onload?.(), 0); }
}
vi.stubGlobal('FileReader', FakeFileReader);

const json = (status: number, body: unknown) => Promise.resolve(new Response(JSON.stringify(body), { status }));
const file = () => new File([new Uint8Array(10)], 'r.webm', { type: 'audio/webm' });

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

const load = async () => (await import('../src/services/gemini')).transcribeRecordingDetailed;

describe('transcribeRecordingDetailed', () => {
  it('先打 transcribe-recording；成功就不呼叫 Gemini', async () => {
    fetchMock.mockImplementation((url: string) => json(200, { text: 'I used to walk.', model: 'whisper-large-v3' }));
    const r = await (await load())(file());
    expect(r).toEqual({ text: 'I used to walk.', model: 'whisper-large-v3' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe('/.netlify/functions/transcribe-recording');
  });
  it('空字串是合法結果（沒有人聲），不改打 Gemini', async () => {
    fetchMock.mockImplementation(() => json(200, { text: '', model: 'whisper-large-v3' }));
    const r = await (await load())(file());
    expect(r).toEqual({ text: '', model: 'whisper-large-v3' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it('transcribe-recording 失敗 → 改用 Gemini（ai-text transcribe），Gemini 的空字串也是成功', async () => {
    fetchMock.mockImplementation((url: string) => url.includes('transcribe-recording')
      ? json(502, { error: 'down' })
      : json(200, { text: '', model: 'gemini-3.6-flash' }));
    const r = await (await load())(file());
    expect(r).toEqual({ text: '', model: 'gemini-3.6-flash' });
    expect(fetchMock.mock.calls[1][0]).toBe('/.netlify/functions/ai-text');
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).task).toBe('transcribe');
  });
  it('413（錄音太大）→ 不改打 Gemini，直接顯示錄音太長', async () => {
    fetchMock.mockImplementation(() => json(413, { error: '錄音檔過大' }));
    await expect((await load())(file())).rejects.toThrow('錄音太長');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it('兩者都失敗 → 丟出錯誤', async () => {
    fetchMock.mockImplementation(() => json(503, { error: 'busy' }));
    await expect((await load())(file())).rejects.toThrow('語音轉文字失敗');
  });
});

describe('原始碼守門', () => {
  const read = (f: string) => readFileSync(resolve(__dirname, '..', f), 'utf8');
  it('Gemini 轉錄備援不使用 flash-lite', () => {
    const src = read('netlify/shared/aiKeys.ts');
    const m = src.match(/TRANSCRIBE_GEMINI_MODELS\s*=\s*\{([^}]*)\}/);
    expect(m).not.toBeNull();
    expect(m![1]).not.toMatch(/lite/);
    expect(read('netlify/functions/ai-text.ts')).toContain('TRANSCRIBE_GEMINI_MODELS');
  });
  it('TRANSCRIBE_PROMPT 要求照實轉錄', () => {
    const src = read('netlify/shared/prompts.ts');
    const m = src.match(/export const TRANSCRIBE_PROMPT\s*=\s*([\s\S]*?);\n/);
    expect(m).not.toBeNull();
    for (const w of ['不要修正文法', '不要補字', '聽不清楚', '不要猜', '沒有人聲', '空白']) expect(m![1]).toContain(w);
  });
  it('複述練習顯示轉錄模型、錄音限制 64 kbps', () => {
    const src = read('src/components/RetellView.tsx') + read('src/components/RetellFeedbackPanel.tsx');
    expect(src).toContain('transcribeRecordingDetailed');
    expect(src).toContain('語音辨識：');
    expect(read('src/components/RetellView.tsx')).toMatch(/audioBitsPerSecond:\s*64000/);
  });
});
