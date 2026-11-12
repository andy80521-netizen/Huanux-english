import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// 規劃：docs/plans/auto-shadowing.md（擁有者 2026-11-13 核准）
const read = (f: string) => readFileSync(resolve(__dirname, '..', f), 'utf8');
const load = async () => (await import('../src/utils/autoShadowing')) as any;

type S = { id: string; deleted?: boolean; mastery?: number };
const list = (...ms: Array<number | 'del'>): S[] => ms.map((m, i) => (m === 'del' ? { id: `s${i}`, deleted: true, mastery: 0 } : { id: `s${i}`, mastery: m }));

/** 模擬元件：goTo 後由測試呼叫 sentenceChanged／sentenceReady */
const harness = async (sentences: S[]) => {
  const m = await load();
  const calls = { goTo: [] as number[], start: [] as string[], views: [] as any[] };
  const session = m.createAutoSession({
    getSentences: () => sentences,
    goTo: (i: number) => calls.goTo.push(i),
    start: (id: string) => calls.start.push(id),
    onChange: (v: any) => calls.views.push(v),
  });
  const view = () => calls.views[calls.views.length - 1];
  /** 模擬換句完成（元件的換句 effect 跑完、狀態回到 idle） */
  const arrive = (i: number) => { session.sentenceChanged(sentences[i].id); session.sentenceReady(sentences[i].id); };
  /** 模擬這一句錄完並評分存檔成功 */
  const scored = (total = 80, passed = true, gained = 1) => {
    const id = session.currentAttempt();
    session.attemptSubmitted(id);
    session.attemptScored(id, { passed, total, gained });
    return id;
  };
  return { m, session, calls, view, arrive, scored };
};

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe('選句：略過已刪除與已精熟（擁有者決定）', () => {
  it('firstAutoIndex 包含自己、nextAutoIndex 從下一句起；都沒有回傳 -1', async () => {
    const { firstAutoIndex, nextAutoIndex } = await load();
    const s = list(1000, 'del', 500, 1000, 0);
    expect(firstAutoIndex(s, 0)).toBe(2);
    expect(firstAutoIndex(s, 2)).toBe(2);
    expect(nextAutoIndex(s, 2)).toBe(4);
    expect(nextAutoIndex(s, 4)).toBe(-1);
    expect(firstAutoIndex(list(1000, 1000), 0)).toBe(-1);
  });

  it('目前這句已精熟 → 跳到後面第一句未精熟；後面都精熟 → 直接結束並說明', async () => {
    const h = await harness(list(1000, 300));
    expect(h.session.begin(0).startNow).toBe(false);
    expect(h.calls.goTo).toEqual([1]);
    h.arrive(1);
    expect(h.calls.start).toEqual(['s1']);
    const h2 = await harness(list(1000, 1000));
    h2.session.begin(0);
    expect(h2.view().active).toBe(false);
    expect(h2.view().stopReason).toBe('none-left');
    expect(h2.calls.start).toEqual([]);
  });
});

describe('一句接一句：播完錄音 → 倒數 5 秒 → 下一句', () => {
  it('目前這句可練 → 在點擊當下開始（startNow），之後每句只開始一次', async () => {
    const h = await harness(list(0, 0, 0));
    expect(h.session.begin(0).startNow).toBe(true);
    h.session.sentenceReady('s0');
    h.session.sentenceReady('s0');
    expect(h.calls.start).toEqual(['s0']);
  });

  it('評分後要等錄音播完才倒數；倒數 5 秒後前進一次', async () => {
    const h = await harness(list(0, 0, 0));
    h.session.begin(0); h.session.sentenceReady('s0');
    const a = h.scored();
    expect(h.view().phase).toBe('reviewing');
    vi.advanceTimersByTime(10_000);
    expect(h.calls.goTo).toEqual([]);          // 錄音還沒播完，不倒數
    h.session.playbackDone(a);
    expect(h.view().phase).toBe('countdown');
    expect(h.view().countdown).toBe(5);
    vi.advanceTimersByTime(4_000);
    expect(h.view().countdown).toBe(1);
    expect(h.calls.goTo).toEqual([]);
    vi.advanceTimersByTime(1_000);
    expect(h.calls.goTo).toEqual([1]);
    h.arrive(1);
    expect(h.calls.start).toEqual(['s0', 's1']);
  });

  it('前進時略過已精熟與已刪除', async () => {
    const h = await harness(list(0, 1000, 'del', 0));
    h.session.begin(0); h.session.sentenceReady('s0');
    h.session.playbackDone(h.scored());
    vi.advanceTimersByTime(5_000);
    expect(h.calls.goTo).toEqual([3]);
  });

  it('最後一句完成 → 不呼叫 goTo、結束並顯示摘要', async () => {
    const h = await harness(list(0, 0));
    h.session.begin(1); h.session.sentenceReady('s1');
    h.session.playbackDone(h.scored(90));
    vi.advanceTimersByTime(5_000);
    expect(h.calls.goTo).toEqual([]);
    expect(h.view().active).toBe(false);
    expect(h.view().stopReason).toBe('end');
    expect(h.view().summary.practiced).toBe(1);
  });
});

describe('競態（Codex 🔴）', () => {
  it('倒數到期與「立即下一句」同時 → 只前進一次', async () => {
    const h = await harness(list(0, 0, 0));
    h.session.begin(0); h.session.sentenceReady('s0');
    h.session.playbackDone(h.scored());
    vi.advanceTimersByTime(5_000);
    h.session.skipNow();
    h.session.skipNow();
    expect(h.calls.goTo).toEqual([1]);
  });

  it('立即下一句之後，舊倒數不會再前進', async () => {
    const h = await harness(list(0, 0, 0));
    h.session.begin(0); h.session.sentenceReady('s0');
    h.session.playbackDone(h.scored());
    h.session.skipNow();
    vi.advanceTimersByTime(10_000);
    expect(h.calls.goTo).toEqual([1]);
  });

  it('倒數中停止 → 不前進；之後的舊回呼都失效', async () => {
    const h = await harness(list(0, 0, 0));
    h.session.begin(0); h.session.sentenceReady('s0');
    const a = h.scored();
    h.session.playbackDone(a);
    vi.advanceTimersByTime(2_000);
    h.session.stop('user');
    vi.advanceTimersByTime(10_000);
    h.session.playbackDone(a);
    h.session.skipNow();
    h.session.sentenceReady('s1');
    expect(h.calls.goTo).toEqual([]);
    expect(h.calls.start).toEqual(['s0']);
    expect(h.view().stopReason).toBe('user');
  });

  it('不是自動流程造成的換句（手動跳句、返回）→ 結束，舊回呼不會再前進或開始', async () => {
    const h = await harness(list(0, 0, 0));
    h.session.begin(0); h.session.sentenceReady('s0');
    const a = h.scored();
    h.session.sentenceChanged('s2');          // 使用者自己跳到第 3 句
    expect(h.view().active).toBe(false);
    expect(h.view().stopReason).toBe('navigate');
    h.session.playbackDone(a);
    vi.advanceTimersByTime(10_000);
    h.session.sentenceReady('s2');
    expect(h.calls.goTo).toEqual([]);
    expect(h.calls.start).toEqual(['s0']);
  });

  it('前進途中換到的句子符合等待中的句子 → 不算手動換句', async () => {
    const h = await harness(list(0, 0));
    h.session.begin(0); h.session.sentenceReady('s0');
    h.session.playbackDone(h.scored());
    vi.advanceTimersByTime(5_000);
    h.session.sentenceChanged('s1');
    expect(h.view().active).toBe(true);
  });
});

describe('評分中停止、摘要結算（Codex 🟠）', () => {
  it('評分中停止：結果仍計入摘要，但不前進', async () => {
    const h = await harness(list(0, 0));
    h.session.begin(0); h.session.sentenceReady('s0');
    const a = h.session.currentAttempt();
    h.session.attemptSubmitted(a);
    h.session.stop('user');
    expect(h.view().summary.pending).toBe(1);
    h.session.attemptScored(a, { passed: true, total: 88, gained: 1 });
    expect(h.view().summary.pending).toBe(0);
    expect(h.view().summary.practiced).toBe(1);
    expect(h.view().summary.passed).toBe(1);
    h.session.playbackDone(a);
    vi.advanceTimersByTime(10_000);
    expect(h.calls.goTo).toEqual([]);
  });

  it('同一次作答回報兩次（重試評分）只算一次；評分失敗 → 停止、不計入', async () => {
    const h = await harness(list(0, 0, 0));
    h.session.begin(0); h.session.sentenceReady('s0');
    const a = h.scored(80, true, 1);
    h.session.attemptScored(a, { passed: true, total: 80, gained: 1 });
    expect(h.view().summary.practiced).toBe(1);
    h.session.playbackDone(a);
    vi.advanceTimersByTime(5_000);
    h.arrive(1);
    const b = h.session.currentAttempt();
    h.session.attemptSubmitted(b);
    h.session.attemptFailed(b);
    expect(h.view().active).toBe(false);
    expect(h.view().stopReason).toBe('scoreError');
    expect(h.view().summary.practiced).toBe(1);
    expect(h.view().summary.pending).toBe(0);
  });

  it('摘要：通過數、沒通過清單、平均總分、熟練度增加句數', async () => {
    const h = await harness(list(0, 0, 0));
    h.session.begin(0); h.session.sentenceReady('s0');
    h.session.playbackDone(h.scored(90, true, 1));
    vi.advanceTimersByTime(5_000); h.arrive(1);
    h.session.playbackDone(h.scored(50, false, 0));
    vi.advanceTimersByTime(5_000); h.arrive(2);
    h.session.playbackDone(h.scored(70, true, 1));
    vi.advanceTimersByTime(5_000);
    const s = h.view().summary;
    expect(s.practiced).toBe(3);
    expect(s.passed).toBe(2);
    expect(s.gained).toBe(2);
    expect(s.average).toBe(70);
    expect(s.failed).toEqual([{ index: 1, id: 's1', total: 50 }]);
  });
});

describe('沒有聲音（以錄音音量判斷，Codex 🟠）', () => {
  it('沒有聲音的句子直接倒數（不等錄音播放）；連續 2 句沒有聲音 → 停止', async () => {
    const h = await harness(list(0, 0, 0, 0));
    h.session.begin(0); h.session.sentenceReady('s0');
    h.session.attemptSilent(h.session.currentAttempt());
    expect(h.view().phase).toBe('countdown');
    vi.advanceTimersByTime(5_000); h.arrive(1);
    h.session.attemptSilent(h.session.currentAttempt());
    expect(h.view().active).toBe(false);
    expect(h.view().stopReason).toBe('silent');
    expect(h.view().summary.silent).toBe(2);
  });

  it('中間有一句有聲音 → 連續計數歸零', async () => {
    const h = await harness(list(0, 0, 0, 0));
    h.session.begin(0); h.session.sentenceReady('s0');
    h.session.attemptSilent(h.session.currentAttempt());
    vi.advanceTimersByTime(5_000); h.arrive(1);
    h.session.playbackDone(h.scored(0, false, 0));   // 有出聲但 0 分：不算沒有聲音
    vi.advanceTimersByTime(5_000); h.arrive(2);
    h.session.attemptSilent(h.session.currentAttempt());
    expect(h.view().active).toBe(true);
  });

  it('門檻常數：有聲音累計不到 300ms 視為沒有聲音、連續 2 句停止、倒數 5 秒', async () => {
    const m = await load();
    expect(m.SILENT_VOICED_MS).toBe(300);
    expect(m.AUTO_SILENT_STOP).toBe(2);
    expect(m.AUTO_COUNTDOWN_SEC).toBe(5);
  });
});

describe('元件接線（ShadowingPracticeView）', () => {
  const src = () => read('src/components/ShadowingPracticeView.tsx');

  it('使用 createAutoSession；換句時通知 sentenceChanged、回到 idle 時 sentenceReady', () => {
    const s = src();
    expect(s).toMatch(/createAutoSession\(/);
    expect(s).toMatch(/\.sentenceChanged\(sentence\.id\)/);
    expect(s).toMatch(/\.sentenceReady\(sentence\.id\)/);
  });

  it('點擊當下解鎖（unlockInGesture），handleStart 也使用它', () => {
    const s = src();
    expect(s).toMatch(/const unlockInGesture = /);
    const start = s.slice(s.indexOf('const handleStart'), s.indexOf('const enterBufferPhase'));
    expect(start).toMatch(/unlockInGesture\(/);
    const auto = s.slice(s.indexOf('const handleAutoStart'));
    expect(auto.slice(0, auto.indexOf('\n    };'))).toMatch(/unlockInGesture\(/);
  });

  it('準備中停止用獨立的 startCancelRef，不遞增 scoringTokenRef', () => {
    const s = src();
    expect(s).toMatch(/startCancelRef/);
    const stop = s.slice(s.indexOf('const stopAuto'));
    expect(stop.slice(0, stop.indexOf('\n    };'))).not.toMatch(/scoringTokenRef\.current \+= 1/);
  });

  it('自動模式：錄音期間累計有聲音的時間；沒有聲音不送評分（attemptSilent）', () => {
    const s = src();
    expect(s).toMatch(/voicedMsRef/);
    expect(s).toMatch(/\.attemptSilent\(/);
    expect(s).toMatch(/SILENT_VOICED_MS/);
  });

  it('評分結果、評分失敗、錄音播完都回報給自動流程', () => {
    const s = src();
    expect(s).toMatch(/\.attemptScored\(/);
    expect(s).toMatch(/\.attemptFailed\(/);
    expect(s).toMatch(/\.playbackDone\(/);
  });

  it('自動模式的麥克風檢查：AudioContext 不是 running 或收音確認逾時 → 停止並顯示「點一下繼續」', () => {
    const s = src();
    expect(s).toMatch(/stopAuto\('mic'\)/);
    expect(s).toContain('點一下繼續');
  });

  it('頁面隱藏、再念一次、聽聽看 → 結束自動模式', () => {
    const s = src();
    expect(s).toMatch(/stopAuto\('hidden'\)/);
    const retry = s.slice(s.indexOf('const handleRetry'), s.indexOf('const runScoring'));
    expect(retry).toMatch(/stopAuto\(/);
  });

  it('Wake Lock：自動模式期間申請、結束釋放', () => {
    const s = src();
    expect(s).toMatch(/wakeLock\.request\('screen'\)/);
    expect(s).toMatch(/\.release\(\)/);
  });

  it('畫面：自動跟讀按鈕、停止、立即下一句、倒數、摘要', () => {
    const s = src();
    expect(s).toContain('自動跟讀');
    expect(s).toContain('立即下一句');
    expect(s).toMatch(/aria-live="polite"/);
    expect(s).toContain('秒後下一句');
    expect(s).toMatch(/AutoShadowingSummary|自動跟讀結果/);
  });
});
