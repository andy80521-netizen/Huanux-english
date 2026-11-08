import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { toFields, fieldsToObject, runTransaction } from '../netlify/shared/firestoreRest';
import { buildTranslatePrompt, parseTranslations, TRANSLATE_BATCH_SIZE } from '../netlify/shared/translate';
import {
  validateSaveJob, isOwnAudioUrl, buildUploadMaterial, buildCoverExcerpt as serverExcerpt, runSaveMaterial,
  MAX_DOC_BYTES, type SaveDeps, type TxApi,
} from '../netlify/shared/saveMaterial';
import { buildCoverExcerpt as clientExcerpt } from '../src/utils/coverExcerpt';
import { describeSaveJob, SAVE_STALL_NO_START_MS, SAVE_STALL_HEARTBEAT_MS, canStartSave } from '../src/utils/saveJob';

// 規劃：docs/plans/background-material-save.md（擁有者 2026-11-09 核准）
const read = (f: string) => readFileSync(resolve(__dirname, '..', f), 'utf8');

const UID = 'u1';
const MID = 'mat_ABC123';
const APP = 'huan-power-english';
const BUCKET = 'huanux-english.firebasestorage.app';
const audioUrl = (uid = UID, mid = MID) =>
  `https://firebasestorage.googleapis.com/v0/b/${BUCKET}/o/${encodeURIComponent(`artifacts/${APP}/users/${uid}/materials/${mid}.mp3`)}?alt=media&token=t`;
const reviewed = (n: number) => Array.from({ length: n }, (_, i) => ({ text: `Sentence number ${i}.`, startTime: i, endTime: i + 0.9, ...(i === 1 ? { lowConfidence: true } : {}) }));

// ── 1. Firestore REST ──
describe('REST 值轉換（驗收 1）', () => {
  it('來回轉換；整數、小數、布林、巢狀；undefined 欄位省略', () => {
    const obj = { a: 1, b: 1.5, c: 'x', d: true, e: null, f: [1, { g: 'h' }], skip: undefined };
    const fields = toFields(obj);
    expect(fields.a).toEqual({ integerValue: '1' });
    expect(fields.b).toEqual({ doubleValue: 1.5 });
    expect(fields).not.toHaveProperty('skip');
    expect(fieldsToObject(fields)).toEqual({ a: 1, b: 1.5, c: 'x', d: true, e: null, f: [1, { g: 'h' }] });
  });
});

describe('REST 交易（驗收 2）', () => {
  const okJson = (body: any, status = 200) => new Response(JSON.stringify(body), { status });
  it('開交易 → 交易內讀取 → 一次 commit；ABORTED 時整筆重跑', async () => {
    let commits = 0;
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith(':beginTransaction')) return okJson({ transaction: 'TX' });
      if (url.endsWith(':commit')) {
        commits++;
        if (commits === 1) return okJson({ error: { status: 'ABORTED' } }, 409);
        return okJson({ writeResults: [] });
      }
      expect(url).toContain('transaction=TX');
      return okJson({ name: 'x', fields: toFields({ status: 'saving' }), updateTime: 't' });
    });
    let runs = 0;
    const r = await runTransaction('tok', async (t) => {
      runs++;
      const doc = await t.get('artifacts/a/users/u/transcriptionJobs/m');
      t.update('artifacts/a/users/u/transcriptionJobs/m', { progress: { done: 1, total: 2 } }, ['leaseId']);
      return doc?.status;
    }, { fetchImpl: fetchImpl as any });
    expect(r).toBe('saving');
    expect(runs).toBe(2);
    const commitBody = JSON.parse((fetchImpl.mock.calls.filter(c => String(c[0]).endsWith(':commit')).at(-1)![1] as RequestInit).body as string);
    expect(commitBody.transaction).toBe('TX');
    expect(commitBody.writes[0].updateMask.fieldPaths).toEqual(['progress', 'leaseId']);
    expect(commitBody.writes[0].currentDocument).toEqual({ exists: true });
  });
  it('建立用 exists=false；文件不存在時 get 回 null', async () => {
    const fetchImpl = vi.fn(async (url: string, _init?: RequestInit) => {
      if (url.endsWith(':beginTransaction')) return okJson({ transaction: 'TX' });
      if (url.endsWith(':commit')) return okJson({});
      return okJson({ error: { status: 'NOT_FOUND' } }, 404);
    });
    await runTransaction('tok', async (t) => {
      expect(await t.get('p/doc')).toBeNull();
      t.create('p/doc', { a: 1 });
    }, { fetchImpl: fetchImpl as any });
    const body = JSON.parse((fetchImpl.mock.calls.at(-1)![1] as RequestInit).body as string);
    expect(body.writes[0].currentDocument).toEqual({ exists: false });
  });
});

// ── 2. 翻譯共用 ──
describe('翻譯提示詞搬移後一字不改（驗收 3）', () => {
  it('與原本 translate-sentences 的提示詞相同', () => {
    const s = ['Hello.', 'How are you?'];
    expect(buildTranslatePrompt(s)).toBe(`請將以下英文句子陣列逐句翻譯成繁體中文。
請只回傳 JSON 格式的字串陣列，不要包含任何 markdown 標記、\`\`\`json 標籤或其他文字。
回傳的句數與順序必須與輸入完全一致，不得合併、不得拆分、亦不得改寫。
格式範例：["翻譯 1", "翻譯 2", ...]

輸入英文句子陣列：
${JSON.stringify(s, null, 2)}`);
    expect(TRANSLATE_BATCH_SIZE).toBe(30);
  });
  it('解析：去掉 ```json、句數不符或不是字串陣列 → 丟錯', () => {
    expect(parseTranslations('```json\n["a","b"]\n```', 2)).toEqual(['a', 'b']);
    expect(() => parseTranslations('["a"]', 2)).toThrow(/句數不一致/);
    expect(() => parseTranslations('[1,2]', 2)).toThrow();
  });
  it('translate-sentences 改用共用模組', () => {
    const f = read('netlify/functions/translate-sentences.ts');
    expect(f).toMatch(/buildTranslatePrompt\(/);
    expect(f).toMatch(/parseTranslations\(/);
  });
});

// ── 3. 驗證與組教材 ──
describe('驗證任務內容（驗收 4）', () => {
  const ctx = { uid: UID, materialId: MID, appId: APP, bucket: BUCKET };
  const job = (over: any = {}) => ({ status: 'saving', saveAttempt: 1, title: 'Daily Aus', audioUrl: audioUrl(), coverChoice: 'none', reviewed: reviewed(3), ...over });
  it('音檔網址必須是這個使用者、這份教材的 mp3', () => {
    expect(isOwnAudioUrl(audioUrl(), ctx)).toBe(true);
    expect(isOwnAudioUrl(audioUrl('other'), ctx)).toBe(false);
    expect(isOwnAudioUrl(audioUrl(UID, 'mat_OTHER'), ctx)).toBe(false);
    expect(isOwnAudioUrl('https://evil.example.com/a.mp3', ctx)).toBe(false);
  });
  it('合法 → ok；句子為空、時間顛倒、文字過長、封面選項不合法 → 錯誤', () => {
    expect(validateSaveJob(job(), ctx).ok).toBe(true);
    expect(validateSaveJob(job({ reviewed: [] }), ctx).ok).toBe(false);
    expect(validateSaveJob(job({ reviewed: [{ text: 'a', startTime: 3, endTime: 2 }] }), ctx).ok).toBe(false);
    expect(validateSaveJob(job({ reviewed: [{ text: 'x'.repeat(2001), startTime: 0, endTime: 1 }] }), ctx).ok).toBe(false);
    expect(validateSaveJob(job({ reviewed: [{ text: '   ', startTime: 0, endTime: 1 }] }), ctx).ok).toBe(false);
    expect(validateSaveJob(job({ coverChoice: 'evil' }), ctx).ok).toBe(false);
    expect(validateSaveJob(job({ audioUrl: audioUrl('other') }), ctx).ok).toBe(false);
  });
});

describe('組教材：格式與原本前端相同（驗收 5）', () => {
  it('句子 id、翻譯、mastery、選填欄位省略；選封面時加封面欄位', () => {
    const m = buildUploadMaterial({ materialId: MID, title: 'T', audioUrl: audioUrl(), reviewed: reviewed(2), translations: ['零', '一'], coverChoice: 'photo', now: 1000 });
    expect(m).toEqual({
      id: MID, title: 'T', course: '未分類', sourceText: 'Sentence number 0. Sentence number 1.', audioUrl: audioUrl(), audioSource: 'upload',
      sentences: [
        { id: 's_0', text: 'Sentence number 0.', translation: '零', startTime: 0, endTime: 0.9, mastery: 0 },
        { id: 's_1', text: 'Sentence number 1.', translation: '一', startTime: 1, endTime: 1.9, lowConfidence: true, mastery: 0 },
      ],
      createdAt: 1000, graduated: false, coverStyle: 'photo', coverStatus: 'generating', coverRequestedAt: 1000,
    });
    const none = buildUploadMaterial({ materialId: MID, title: 'T', audioUrl: audioUrl(), reviewed: reviewed(1), translations: ['零'], coverChoice: 'none', now: 1 });
    expect(none).not.toHaveProperty('coverStyle');
  });
  it('封面摘要與前端相同', () => {
    const s = reviewed(80);
    expect(serverExcerpt(s)).toBe(clientExcerpt(s));
  });
});

// ── 4. 背景流程（假的 Firestore 與翻譯）──
type Docs = Map<string, any>;
const JOB = `artifacts/${APP}/users/${UID}/transcriptionJobs/${MID}`;
const MAT = `artifacts/${APP}/users/${UID}/materials/${MID}`;
const SIGHT = `artifacts/${APP}/users/${UID}/materialSightings/${MID}`;

function fakeDeps(docs: Docs, opts: { translate?: SaveDeps['translate']; dispatch?: SaveDeps['dispatch']; clock?: { t: number } } = {}) {
  const clock = opts.clock ?? { t: 1_000_000 };
  let ids = 0;
  const translated: string[][] = [];
  const dispatched: string[] = [];
  const tx: SaveDeps['tx'] = async (fn) => {
    // 交易：在副本上執行，最後一次套用（模擬原子 commit）
    const writes: Array<() => void> = [];
    const api: TxApi = {
      get: async (p) => (docs.has(p) ? structuredClone(docs.get(p)) : null),
      update: (p, data, del = []) => writes.push(() => {
        if (!docs.has(p)) throw new Error('NOT_FOUND');
        const d = { ...docs.get(p), ...structuredClone(data) };
        for (const k of del) delete d[k];
        docs.set(p, d);
      }),
      set: (p, data) => writes.push(() => docs.set(p, { ...(docs.get(p) || {}), ...structuredClone(data) })),
      create: (p, data) => writes.push(() => { if (docs.has(p)) throw new Error('ALREADY_EXISTS'); docs.set(p, structuredClone(data)); }),
      delete: (p) => writes.push(() => { docs.delete(p); }),
    };
    const r = await fn(api);
    writes.forEach(w => w());
    return r;
  };
  const deps: SaveDeps = {
    tx,
    translate: opts.translate ?? (async (s) => { translated.push(s); return s.map(x => `中:${x}`); }),
    dispatch: opts.dispatch ?? (async (name) => { dispatched.push(name); return true; }),
    now: () => clock.t,
    newId: () => `lease${++ids}`,
  };
  return { deps, translated, dispatched, clock };
}
const input = (attempt = 1) => ({ uid: UID, materialId: MID, saveAttempt: attempt, idToken: 'tok', appId: APP, bucket: BUCKET });
const savingJob = (over: any = {}) => ({ status: 'saving', saveAttempt: 1, title: 'Daily Aus', audioUrl: audioUrl(), coverChoice: 'photo', reviewed: reviewed(65), progress: { done: 0, total: 65 }, saveRequestedAt: 999_000, ...over });

describe('runSaveMaterial：正常完成（驗收 6）', () => {
  it('分批翻譯、每批寫檢查點、原子建立教材、派封面與重逢、刪任務', async () => {
    const docs: Docs = new Map([[JOB, savingJob()]]);
    const progress: number[] = [];
    const f = fakeDeps(docs);
    const origTx = f.deps.tx;
    f.deps.tx = async (fn) => { const r = await origTx(fn); if (docs.get(JOB)?.progress) progress.push(docs.get(JOB).progress.done); return r; };
    expect(await runSaveMaterial(f.deps, input())).toBe('saved');
    expect(f.translated.map(b => b.length)).toEqual([30, 30, 5]);
    expect(progress).toContain(30);
    expect(progress).toContain(60);
    const mat = docs.get(MAT);
    expect(mat.sentences).toHaveLength(65);
    expect(mat.sentences[64].translation).toBe('中:Sentence number 64.');
    expect(mat.coverStatus).toBe('generating');
    expect(docs.get(SIGHT)).toMatchObject({ status: 'processing' });
    expect(f.dispatched).toEqual(['generate-cover', 'detect-sightings']);
    expect(docs.has(JOB)).toBe(false);
  });
  it('從檢查點接續：已翻譯的句子不再送翻譯', async () => {
    const done = Array.from({ length: 30 }, (_, i) => `舊${i}`);
    const docs: Docs = new Map([[JOB, savingJob({ translations: done, progress: { done: 30, total: 65 } })]]);
    const f = fakeDeps(docs);
    expect(await runSaveMaterial(f.deps, input())).toBe('saved');
    expect(f.translated.map(b => b.length)).toEqual([30, 5]);
    expect(docs.get(MAT).sentences[0].translation).toBe('舊0');
  });
});

describe('runSaveMaterial：所有權（驗收 7）', () => {
  it('saveAttempt 不符、狀態不是 saving → 安靜結束，不寫任何東西', async () => {
    const docs: Docs = new Map([[JOB, savingJob({ saveAttempt: 2 })]]);
    const f = fakeDeps(docs);
    expect(await runSaveMaterial(f.deps, input(1))).toBe('stale');
    expect(docs.get(JOB).status).toBe('saving');
    expect(docs.has(MAT)).toBe(false);
    docs.set(JOB, savingJob({ status: 'reviewing' }));
    expect(await runSaveMaterial(f.deps, input(1))).toBe('stale');
  });
  it('同一個 attempt 已有未過期的租約 → busy，不寫 saveError', async () => {
    const docs: Docs = new Map([[JOB, savingJob({ leaseId: 'other', leaseUntil: 1_000_000 + 60_000 })]]);
    const f = fakeDeps(docs);
    expect(await runSaveMaterial(f.deps, input())).toBe('busy');
    expect(docs.get(JOB).status).toBe('saving');
    expect(docs.get(JOB).leaseId).toBe('other');
  });
  it('翻譯途中使用者按「回到校對」（attempt+1）→ 舊執行停止，不建立教材、不寫 saveError', async () => {
    const docs: Docs = new Map([[JOB, savingJob()]]);
    let n = 0;
    const f = fakeDeps(docs, {
      translate: async (s) => {
        if (++n === 2) docs.set(JOB, { ...docs.get(JOB), status: 'reviewing', saveAttempt: 2 });
        return s.map(x => `中:${x}`);
      },
    });
    expect(await runSaveMaterial(f.deps, input())).toBe('lost');
    expect(docs.has(MAT)).toBe(false);
    expect(docs.get(JOB).status).toBe('reviewing');
  });
  it('建立教材前一刻被接管 → 不建立教材', async () => {
    const docs: Docs = new Map([[JOB, savingJob({ reviewed: reviewed(3), progress: { done: 0, total: 3 } })]]);
    const f = fakeDeps(docs, { translate: async (s) => { return s.map(x => `中:${x}`); } });
    const origTx = f.deps.tx;
    let calls = 0;
    f.deps.tx = async (fn) => {
      calls++;
      if (calls === 3) docs.set(JOB, { ...docs.get(JOB), saveAttempt: 2, leaseId: 'new' });   // 第 3 次交易＝建立教材
      return origTx(fn);
    };
    expect(await runSaveMaterial(f.deps, input())).toBe('lost');
    expect(docs.has(MAT)).toBe(false);
  });
});

describe('runSaveMaterial：失敗處理（驗收 8）', () => {
  it('內容不合法 → saveError，不呼叫翻譯', async () => {
    const docs: Docs = new Map([[JOB, savingJob({ audioUrl: audioUrl('other') })]]);
    const f = fakeDeps(docs);
    expect(await runSaveMaterial(f.deps, input())).toBe('invalid');
    expect(docs.get(JOB)).toMatchObject({ status: 'saveError' });
    expect(f.translated).toHaveLength(0);
  });
  it('翻譯一直失敗（重試 2 次後）→ saveError，已完成的檢查點與 reviewed 保留', async () => {
    const docs: Docs = new Map([[JOB, savingJob()]]);
    let n = 0;
    const f = fakeDeps(docs, { translate: async (s) => { if (++n > 1) throw new Error('Gemini 503'); return s.map(x => `中:${x}`); } });
    expect(await runSaveMaterial(f.deps, input())).toBe('error');
    expect(n).toBe(4);   // 第 1 批成功；第 2 批 1 次＋重試 2 次
    const job = docs.get(JOB);
    expect(job.status).toBe('saveError');
    expect(job.errorMessage).toContain('Gemini 503');
    expect(job.translations).toHaveLength(30);
    expect(job.reviewed).toHaveLength(65);
    expect(job).not.toHaveProperty('leaseId');
  });
  it('超過軟期限 → paused（需要續存），保留檢查點', async () => {
    const clock = { t: 1_000_000 };
    const docs: Docs = new Map([[JOB, savingJob()]]);
    const f = fakeDeps(docs, { clock, translate: async (s) => { clock.t += 7 * 60_000; return s.map(x => `中:${x}`); } });
    expect(await runSaveMaterial(f.deps, input())).toBe('paused');
    expect(docs.get(JOB).status).toBe('paused');
    expect(docs.get(JOB).translations.length).toBeGreaterThan(0);
    expect(docs.has(MAT)).toBe(false);
  });
  it('教材太大 → saveError（不截斷原文）', async () => {
    const big = Array.from({ length: 300 }, (_, i) => ({ text: 'x'.repeat(1900) + i, startTime: i, endTime: i + 1 }));
    const docs: Docs = new Map([[JOB, savingJob({ reviewed: big, progress: { done: 0, total: 300 } })]]);
    const f = fakeDeps(docs);
    expect(MAX_DOC_BYTES).toBeLessThan(1_048_576);
    expect(await runSaveMaterial(f.deps, input())).toBe('error');
    expect(docs.get(JOB).errorMessage).toContain('教材太長');
    expect(docs.has(MAT)).toBe(false);
  });
  it('教材建立後封面／重逢派工失敗 → 仍算已儲存，只記在各自狀態', async () => {
    const docs: Docs = new Map([[JOB, savingJob({ reviewed: reviewed(3), progress: { done: 0, total: 3 } })]]);
    const f = fakeDeps(docs, { dispatch: async () => false });
    expect(await runSaveMaterial(f.deps, input())).toBe('saved');
    expect(docs.get(MAT).coverStatus).toBe('error');
    expect(docs.get(SIGHT).status).toBe('error');
    expect(docs.has(JOB)).toBe(false);
  });
});

// ── 5. 前端狀態 ──
describe('全域提示的狀態判斷（驗收 9）', () => {
  const now = 2_000_000;
  it('儲存中、可能中斷（沒啟動／心跳停止）、失敗、需要續存、待校對', () => {
    expect(describeSaveJob({ status: 'saving', title: 'A', progress: { done: 12, total: 35 }, saveRequestedAt: now - 5_000 }, now)).toMatchObject({ kind: 'saving', text: '教材儲存中：A 12/35' });
    expect(describeSaveJob({ status: 'saving', title: 'A', progress: { done: 0, total: 35 }, saveRequestedAt: now - SAVE_STALL_NO_START_MS - 1 }, now).kind).toBe('stalled');
    expect(describeSaveJob({ status: 'saving', title: 'A', progress: { done: 30, total: 35 }, saveRequestedAt: now - 600_000, heartbeatAt: now - SAVE_STALL_HEARTBEAT_MS - 1 }, now).kind).toBe('stalled');
    expect(describeSaveJob({ status: 'saving', title: 'A', progress: { done: 30, total: 35 }, saveRequestedAt: now - 600_000, heartbeatAt: now - 10_000 }, now).kind).toBe('saving');
    expect(describeSaveJob({ status: 'saveError', title: 'A', errorMessage: 'x' }, now)).toMatchObject({ kind: 'error' });
    expect(describeSaveJob({ status: 'paused', title: 'A' }, now)).toMatchObject({ kind: 'paused' });
    expect(describeSaveJob({ status: 'reviewing', title: 'A' }, now)).toMatchObject({ kind: 'reviewing' });
    expect(describeSaveJob({ status: 'completed' }, now)).toBeNull();
    expect(describeSaveJob({ status: 'processing' }, now)).toBeNull();
  });
  it('哪些狀態可以送出存檔', () => {
    for (const s of ['completed', 'reviewing', 'saveError', 'paused']) expect(canStartSave(s)).toBe(true);
    for (const s of ['processing', 'saving', 'saved', 'error', undefined]) expect(canStartSave(s as any)).toBe(false);
  });
});

// ── 6. 接線 ──
describe('接線（驗收 10）', () => {
  it('背景函式：config.background、驗證 Token、自我呼叫網址用允許清單', () => {
    const f = read('netlify/functions/save-material.ts');
    expect(f).toMatch(/background: true/);
    expect(f).toMatch(/verifyRealUserToken\(/);
    expect(f).toMatch(/runSaveMaterial\(/);
    expect(f).toMatch(/isAllowedOrigin\(/);
  });
  it('轉錄函式只在 status 為 processing 時寫入', () => {
    const w = read('netlify/functions/whisper-transcribe.ts');
    expect(w).toMatch(/status !== ['"]processing['"]/);
    expect(w).toMatch(/currentDocument\.updateTime/);
  });
  it('前端：交接用交易、強制新 Token、等 202（逾時 10 秒）', () => {
    const s = read('src/services/backgroundSave.ts');
    expect(s).toMatch(/runTransaction\(/);
    expect(s).toMatch(/getIdToken\(true\)/);
    expect(s).toMatch(/keepalive: true/);
    expect(s).toMatch(/DISPATCH_TIMEOUT_MS = 10_000/);
    expect(s).toMatch(/results: deleteField\(\)/);
  });
  it('App 層全域提示；匯入頁改用背景存檔；校對畫面支援網址音檔', () => {
    expect(read('src/App.tsx')).toContain('SaveStatusBanner');
    const m = read('src/components/MaterialImportMode.tsx');
    expect(m).toMatch(/startBackgroundSave\(/);
    expect(m).not.toMatch(/translateSentences\(\s*finalSentences/);
    expect(read('src/components/MaterialReviewPanel.tsx')).toMatch(/remoteAudioUrl\?: string/);
  });
});
