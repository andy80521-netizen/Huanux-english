import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// 擁有者 2026-11-12 診斷（David Jones）：OpenAI 只要求 segment → 230／230 段都是整數秒；同時要求 word → 精度約 0.01 秒
// → 正式匯入同時要求 segment＋word，切句規則完全不變（只用 segments）
const src = () => readFileSync(resolve(__dirname, '../netlify/functions/whisper-transcribe.ts'), 'utf8');

describe('匯入時間精確到 0.01 秒', () => {
  it('同時要求 segment 與 word 的時間', () => {
    const s = src();
    expect(s).toMatch(/append\("timestamp_granularities\[\]", "segment"\)/);
    expect(s).toMatch(/append\("timestamp_granularities\[\]", "word"\)/);
    expect(s).toMatch(/append\("response_format", "verbose_json"\)/);
    expect(s).toMatch(/append\("language", "en"\)/);
  });

  it('切句只用 segments，不用 words（切句規則不變）', () => {
    const s = src();
    expect(s).toMatch(/mergeSegmentsIntoSentences\(data\.segments \|\| \[\]\)/);
    expect(s).not.toMatch(/data\.words/);
  });
});
