import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { shouldStopForSilence, PRE_SPEECH_TIMEOUT_MS, MID_SPEECH_SILENCE_MS } from '../src/utils/silenceDetection';
import { transcriberLabel } from '../src/utils/transcriber';
import { PLAYBACK_LEAD_MS } from '../src/utils/shadowingAudio';

// 語音辨識快速修正（PR A，擁有者 2026-10-30 核准）：
// ① 結果頁顯示轉錄模型 ② 語言模型複習的靜音判斷 ③ 跟讀開始時捲到最上方 ④ 先錄音再播原音

const read = (f: string) => readFileSync(resolve(__dirname, '..', f), 'utf8');

describe('② 靜音判斷', () => {
  it('門檻：開口前最多等 5 秒、開口後停 2.5 秒才結束', () => {
    expect(PRE_SPEECH_TIMEOUT_MS).toBe(5000);
    expect(MID_SPEECH_SILENCE_MS).toBe(2500);
  });
  it('還沒開口：安靜不到 5 秒不停（回想句子的時間）', () => {
    expect(shouldStopForSilence({ now: 4900, startedAt: 0, heardSpeech: false, silentSince: 0 })).toBe(false);
  });
  it('還沒開口：安靜超過 5 秒就停', () => {
    expect(shouldStopForSilence({ now: 5001, startedAt: 0, heardSpeech: false, silentSince: 0 })).toBe(true);
  });
  it('開口後：中途停頓 2.5 秒內不停（舊版 1.5 秒就停）', () => {
    expect(shouldStopForSilence({ now: 10_000, startedAt: 0, heardSpeech: true, silentSince: 8_000 })).toBe(false);
  });
  it('開口後：安靜超過 2.5 秒就停', () => {
    expect(shouldStopForSilence({ now: 10_600, startedAt: 0, heardSpeech: true, silentSince: 8_000 })).toBe(true);
  });
  it('正在出聲（silentSince 為 null）→ 不停', () => {
    expect(shouldStopForSilence({ now: 60_000, startedAt: 0, heardSpeech: true, silentSince: null })).toBe(false);
  });
});

describe('① 轉錄模型名稱', () => {
  it('Gemini 模型名稱轉成好讀的文字', () => {
    expect(transcriberLabel('gemini-3.6-flash')).toBe('Gemini 3.6 Flash');
    expect(transcriberLabel('gemini-3.1-flash-lite')).toBe('Gemini 3.1 Flash Lite');
  });
  it('Whisper', () => {
    expect(transcriberLabel('whisper-1')).toBe('Whisper');
    expect(transcriberLabel('whisper-large-v3')).toBe('Whisper large-v3');
  });
  it('不知道或空白 → 空字串（畫面不顯示）', () => {
    expect(transcriberLabel('')).toBe('');
    expect(transcriberLabel(undefined)).toBe('');
  });
  it('後端回傳模型名稱；前端結果頁顯示', () => {
    expect(read('netlify/functions/ai-text.ts')).toMatch(/result = \{ text: [^}]*model[^}]*\}/);
    expect(read('netlify/functions/transcribe-recording.ts')).toMatch(/model:\s*'whisper-1'/);
    expect(read('src/services/gemini.ts')).toContain('transcribeRecordingDetailed');
    for (const f of ['src/components/ShadowingPracticeView.tsx', 'src/components/PatternPracticeSessionView.tsx']) {
      const src = read(f);
      expect(src).toContain('transcribeRecordingDetailed');
      expect(src).toContain('語音辨識：');
    }
  });
});

describe('② 語言模型複習接上新的靜音判斷', () => {
  const src = read('src/components/PatternPracticeSessionView.tsx');
  it('使用 shouldStopForSilence，不再寫死 1500ms', () => {
    expect(src).toContain('shouldStopForSilence');
    expect(src).not.toMatch(/>\s*1500\b/);
  });
});

describe('③④ 影子跟讀', () => {
  const src = read('src/components/ShadowingPracticeView.tsx');
  it('先錄音、等 300ms 再播原音', () => {
    expect(PLAYBACK_LEAD_MS).toBe(300);
    expect(src).toContain('PLAYBACK_LEAD_MS');
  });
  it('開始跟讀時捲到最上方', () => {
    expect(src).toMatch(/scrollTo\(\s*\{\s*top:\s*0/);
  });
  it('流暢度的講話時間從原音開始播放算起（不含前面等待的 300ms）', () => {
    // recordingStartTimeRef 在呼叫原音 play() 的地方設定，而不是在 mediaRecorder.start() 之後
    const startIdx = src.indexOf('mediaRecorder.start()');
    const setIdx = src.indexOf('recordingStartTimeRef.current = Date.now()');
    const playIdx = src.indexOf('audioRef.current.play()', startIdx);
    expect(startIdx).toBeGreaterThan(-1);
    expect(setIdx).toBeGreaterThan(startIdx);
    expect(playIdx).toBeGreaterThan(-1);
    expect(Math.abs(playIdx - setIdx)).toBeLessThan(400);
  });
});
