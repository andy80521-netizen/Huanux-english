import { describe, it, expect, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// 規劃：docs/plans/review-fixes-50-51.md（擁有者 2026-11-13 核准）
const read = (f: string) => readFileSync(resolve(__dirname, '..', f), 'utf8');
const SENT = "The council has decided to delay the vote until next month, but it's not final.";
const good = JSON.stringify({ overview: '議會延後投票。', breaks: [2], pronunciation: ['x'] });

describe('#1 Groq 截斷或格式不合格 → 用同一個截止時間改用 Gemini', () => {
  const env = { ...process.env };
  afterEach(() => { process.env = { ...env }; vi.restoreAllMocks(); vi.resetModules(); });

  const groqResponse = (content: string, finish = 'stop') =>
    new Response(JSON.stringify({ choices: [{ message: { content }, finish_reason: finish }] }), { status: 200 });

  it('Groq finish_reason=length → 不採用，改用 Gemini', async () => {
    process.env.GROQ_API_KEY = 'test-groq-key-not-real';
    process.env.GEMINI_API_KEY = 'test-gemini-key-not-real';
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(groqResponse('{"overview":"半', 'length'));
    const keys = await import('../netlify/shared/aiKeys');
    const gem = vi.fn(async () => ({ text: good }));
    const r = await keys.callQualityTextTimed('t', 'prompt', 0.3, {
      deadlineMs: 50_000, groqTimeoutMs: 25_000, maxTokens: 4096,
      validate: (t: string) => { JSON.parse(t); },
      gemini: gem as any,
    });
    expect(gem).toHaveBeenCalledTimes(1);
    expect(r.text).toBe(good);
  });

  it('Groq 回傳完整但驗證失敗 → 改用 Gemini；Gemini 也不合格 → 丟出錯誤', async () => {
    process.env.GROQ_API_KEY = 'test-groq-key-not-real';
    process.env.GEMINI_API_KEY = 'test-gemini-key-not-real';
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(groqResponse('not json'));
    const keys = await import('../netlify/shared/aiKeys');
    const validate = (t: string) => { JSON.parse(t); };
    const ok = await keys.callQualityTextTimed('t', 'p', 0.3, { deadlineMs: 50_000, groqTimeoutMs: 25_000, maxTokens: 4096, validate, gemini: (async () => ({ text: good })) as any });
    expect(ok.text).toBe(good);
    await expect(keys.callQualityTextTimed('t', 'p', 0.3, { deadlineMs: 50_000, groqTimeoutMs: 25_000, maxTokens: 4096, validate, gemini: (async () => ({ text: 'bad' })) as any })).rejects.toThrow();
  });

  it('Groq 合格 → 不呼叫 Gemini', async () => {
    process.env.GROQ_API_KEY = 'test-groq-key-not-real';
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(groqResponse(good));
    const keys = await import('../netlify/shared/aiKeys');
    const gem = vi.fn();
    const r = await keys.callQualityTextTimed('t', 'p', 0.3, { deadlineMs: 50_000, groqTimeoutMs: 25_000, maxTokens: 4096, validate: (t: string) => { JSON.parse(t); }, gemini: gem as any });
    expect(gem).not.toHaveBeenCalled();
    expect(r.model).toMatch(/gpt-oss/);
  });

  it('Gemini 拿到的是同一個截止時間（不是重新 50 秒）', () => {
    const k = read('netlify/shared/aiKeys.ts');
    const fn = k.slice(k.indexOf('export async function callQualityTextTimed'));
    expect(fn).toMatch(/const deadlineAt = Date\.now\(\) \+ opts\.deadlineMs/);
    expect(fn).toMatch(/deadlineAt/);
    expect(fn.match(/Date\.now\(\) \+ opts\.deadlineMs/g)?.length).toBe(1);
  });

  it('解析任務：輸出上限 4096，並把正規化當成驗證傳入', async () => {
    const sa = await import('../netlify/shared/sentenceAnalysis');
    expect(sa.ANALYSIS_MAX_TOKENS).toBe(4096);
    const s = read('netlify/functions/ai-text.ts');
    const branch = s.slice(s.indexOf("task === 'analyzeSentence'"));
    expect(branch.slice(0, 1500)).toMatch(/validate:/);
  });

  it('後端：句子超過 1000 字回明確訊息', () => {
    const s = read('netlify/functions/ai-text.ts');
    const branch = s.slice(s.indexOf("task === 'analyzeSentence'"));
    expect(branch.slice(0, 1500)).toContain('句子太長，無法解析（上限 1000 字）');
  });
});

describe('#2 讀出存檔先整理格式（壞資料當作沒有解析）', () => {
  it('sanitizeStoredAnalysis：缺欄位、型別錯誤 → 補成安全格式；保留已存的意群', async () => {
    const { sanitizeStoredAnalysis } = await import('../src/utils/sentenceAnalysis');
    const a = sanitizeStoredAnalysis({
      overview: '說明', chunks: ['The council has', 3, 'decided'], structure: { main: 'm', parts: 'x' },
      grammar: { point: 'p' }, vocabulary: null, patterns: [{ category: 'phrase', text: 't', meaningZh: 'm', usage: 'u', examples: 'no' }, { category: 'bad', text: 't', meaningZh: 'm' }],
      pronunciation: 'x',
    })!;
    expect(a.overview).toBe('說明');
    expect(a.chunks).toEqual(['The council has', 'decided']);
    expect(a.structure).toEqual({ main: 'm', parts: [] });
    expect(a.grammar).toEqual([]);
    expect(a.vocabulary).toEqual([]);
    expect(a.patterns).toEqual([{ category: 'phrase', text: 't', meaningZh: 'm', usage: 'u', examples: [] }]);
    expect(a.pronunciation).toEqual([]);
  });

  it('sanitizeStoredAnalysis：沒有一句話看懂或根節點不對 → null', async () => {
    const { sanitizeStoredAnalysis } = await import('../src/utils/sentenceAnalysis');
    for (const bad of [null, undefined, 'x', [], {}, { overview: '' }, { overview: 3 }]) expect(sanitizeStoredAnalysis(bad)).toBeNull();
  });

  it('loadSentenceAnalysis 使用 sanitizeStoredAnalysis，且不寫回 Firestore', () => {
    const s = read('src/services/sentenceAnalysis.ts');
    const fn = s.slice(s.indexOf('export async function loadSentenceAnalysis'), s.indexOf('export async function requestSentenceAnalysis'));
    expect(fn).toMatch(/sanitizeStoredAnalysis\(/);
    expect(fn).not.toMatch(/setDoc|updateDoc|tx\.set/);
  });
});

describe('#3 錄音中麥克風音軌中斷 → 中止、不評分', () => {
  it('handleStart 為本次音軌掛 ended、錄音器掛 error；自動模式 stopAuto(\'mic\')，手動顯示提示；cleanupAudio 移除監聽', () => {
    const s = read('src/components/ShadowingPracticeView.tsx');
    const hs = s.slice(s.indexOf('const handleStart = async'), s.indexOf('const enterBufferPhase'));
    expect(hs).toMatch(/addEventListener\('ended', onMicLost\)/);
    expect(hs).toMatch(/mediaRecorder\.onerror = onMicLost/);
    const lost = hs.slice(hs.indexOf('const onMicLost'));
    const body = lost.slice(0, lost.indexOf('\n            };'));
    expect(body).toMatch(/stopAuto\('mic'\)/);
    expect(body).toMatch(/abortRecording\(\)/);
    expect(body).toContain('麥克風中斷了，請再試一次');
    const cleanup = s.slice(s.indexOf('const cleanupAudio'), s.indexOf('const cleanupAudio') + 900);
    expect(cleanup).toMatch(/micLostCleanupRef\.current\?\.\(\)/);
  });
});

describe('#4 解析請求前端截止時間', () => {
  it('analyzeAndSaveSentence：65 秒截止；只在仍是同一個請求時才清掉進行中紀錄', () => {
    const s = read('src/services/sentenceAnalysis.ts');
    expect(s).toMatch(/ANALYSIS_CLIENT_TIMEOUT_MS\s*=\s*65_?000/);
    const fn = s.slice(s.indexOf('export function analyzeAndSaveSentence'));
    expect(fn).toMatch(/ANALYSIS_CLIENT_TIMEOUT_MS/);
    expect(fn).toMatch(/inflight\.get\(key\) === job/);
    expect(fn).toContain('解析逾時');
  });
});

describe('#5 未存結果記下原因；再存一次每種結果都有回饋', () => {
  it('服務層存 { rec, result }；教材已刪除不放進未存結果（#9）', () => {
    const s = read('src/services/sentenceAnalysis.ts');
    expect(s).toMatch(/new Map<string, \{ rec: SentenceAnalysisRecord; result: /);
    const fn = s.slice(s.indexOf('export function analyzeAndSaveSentence'));
    expect(fn.slice(0, 2000)).toMatch(/'missing-material'/);
  });

  it('retrySave 處理 saved、changed／missing-sentence、missing-material 與例外', () => {
    const p = read('src/components/SentenceAnalysisPanel.tsx');
    const r = p.slice(p.indexOf('const retrySave'));
    const body = r.slice(0, r.indexOf('\n    };'));
    expect(body).toMatch(/saveSentenceAnalysis\(/);
    expect(body).toMatch(/'saved'/);
    expect(body).toMatch(/catch/);
    expect(body).toContain('還是沒有存起來');
    expect(body).not.toMatch(/analyzeAndSaveSentence\(/);
  });

  it('不能重存的原因（句子已變更或已刪除）只給重新解析，不顯示再存一次', () => {
    const p = read('src/components/SentenceAnalysisPanel.tsx');
    expect(p).toMatch(/unsaved\.result === 'saveFailed'/);
    expect(p).toContain('句子已變更或已刪除，解析沒有存起來，請重新解析');
  });
});

describe('#6 錯誤訊息對應實際原因', () => {
  it('服務層丟出可分類的錯誤；面板分別提示', () => {
    const s = read('src/services/sentenceAnalysis.ts');
    expect(s).toMatch(/export class SentenceAnalysisError/);
    expect(s).toMatch(/'auth'/);
    expect(s).toMatch(/'id'/);
    const p = read('src/components/SentenceAnalysisPanel.tsx');
    expect(p).toContain('請先登入');
    expect(p).toContain('這句的資料編號異常，無法解析');
    expect(p).toContain('這句太長，無法解析（上限 1000 字）');
  });
});

describe('#7 前後端格式版本號一致', () => {
  it('src/utils 與 netlify/shared 的 ANALYSIS_VERSION 相同；面板不再自己宣告', async () => {
    const front = await import('../src/utils/sentenceAnalysis');
    const back = await import('../netlify/shared/sentenceAnalysis');
    expect(front.ANALYSIS_VERSION).toBe(back.ANALYSIS_VERSION);
    expect(read('src/components/SentenceAnalysisPanel.tsx')).not.toMatch(/const ANALYSIS_VERSION\s*=/);
  });
});

describe('#8 記憶體快取綁帳號', () => {
  it('Map 的 key 含 uid；沒登入時讀快取回傳 null', () => {
    const s = read('src/services/sentenceAnalysis.ts');
    expect(s).toMatch(/const memoryKey = \(uid: string, materialId: string, sentenceId: string\)/);
    expect(s).not.toMatch(/memoryKey\(materialId, sentenceId\)/);
  });
});

describe('#10 刪除教材：後續清理失敗不顯示「刪除失敗」', () => {
  it('重逢紀錄清理有自己的 try/catch，提示「教材已刪除，部分檔案清理失敗」', () => {
    const l = read('src/components/MaterialListView.tsx');
    const i = l.indexOf('await deleteMaterialSightings(');
    expect(l.slice(Math.max(0, i - 200), i)).toMatch(/try \{/);
    expect(l).toContain('教材已刪除，部分檔案清理失敗');
  });

  it('刪除計畫去除重複的句子編號', async () => {
    const { planMaterialDelete } = await import('../src/utils/sentenceAnalysis');
    expect(planMaterialDelete('M1', ['s_0', 's_0', 's_1']).analysisIds).toEqual(['M1__s_0', 'M1__s_1']);
  });
});

describe('#11 #12 #13 頁面關閉、錯誤防護、小修、聽聽看', () => {
  it('自動模式期間也監聽 pagehide', () => {
    const s = read('src/components/ShadowingPracticeView.tsx');
    expect(s).toMatch(/addEventListener\('pagehide', onPageHide\)/);
    expect(s).toMatch(/removeEventListener\('pagehide', onPageHide\)/);
  });

  it('解析面板包在錯誤防護裡（只包面板）', () => {
    const p = read('src/components/SentenceAnalysisPanel.tsx');
    expect(p).toMatch(/class AnalysisErrorBoundary extends React\.Component/);
    expect(p).toMatch(/getDerivedStateFromError/);
    expect(p).toContain('解析內容格式異常，可以重新解析');
  });

  it('展開時清掉舊錯誤；重新解析前清掉舊的未存結果', () => {
    const p = read('src/components/SentenceAnalysisPanel.tsx');
    const t = p.slice(p.indexOf('const toggle'));
    expect(t.slice(0, t.indexOf('\n    };'))).toMatch(/if \(next\) setError\(null\)/);
    const r = p.slice(p.indexOf('const runAnalyze'));
    expect(r.slice(0, r.indexOf('\n    };'))).toMatch(/setUnsaved\(null\)/);
  });

  it('自動模式下 handleStart 因準備中提早結束 → 停止自動跟讀（不會卡住）', () => {
    const s = read('src/components/ShadowingPracticeView.tsx');
    const hs = s.slice(s.indexOf('const handleStart = async'));
    const head = hs.slice(0, hs.indexOf('\n        }') + 10);
    expect(head).toMatch(/if \(startingRef\.current\) \{/);
    expect(head).toMatch(/stopAuto\('prepare'\)/);
  });

  it('擁有者決定 1＝A：自動跟讀進行中隱藏「聽聽看」', () => {
    const s = read('src/components/ShadowingPracticeView.tsx');
    expect(s).toMatch(/\{!autoActive && \(\s*<section aria-labelledby="listen-h"/);
  });
});
