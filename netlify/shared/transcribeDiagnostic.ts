// 時間軸診斷：同一份教材音檔同時取得 OpenAI whisper-1 與 Groq whisper-large-v3 的原始時間（segment＋word）
// 只寫入獨立集合 transcriptionDiagnostics，不改教材、不改轉錄任務
// 規劃：docs/plans/timestamp-baseline.md（擁有者 2026-11-12 核准）
import { isOwnAudioUrl } from './saveMaterial';
import { GROQ_TRANSCRIBE_MODEL, GROQ_TRANSCRIBE_URL, OPENAI_TRANSCRIBE_URL, MIN_AUDIO_BYTES } from './transcribe';

export const DIAG_BUCKET = 'huanux-english.firebasestorage.app';
/** OpenAI 單檔上限 25MB */
export const MAX_DIAG_AUDIO_BYTES = 25 * 1024 * 1024;
/** 同一份教材多久內不重複執行 */
export const DIAG_COOLDOWN_MS = 10 * 60_000;
/** 執行中超過這麼久視為卡住，可以重來 */
export const DIAG_STALE_MS = 20 * 60_000;
/** 每份分塊文件的大小上限（Firestore 單一文件 1MiB，留空間給文件名稱與其他欄位） */
export const DIAG_PART_MAX_BYTES = 800_000;
const OPENAI_TIMEOUT_MS = 10 * 60_000;
const GROQ_TIMEOUT_MS = 5 * 60_000;

type FetchLike = (url: string, init?: any) => Promise<Response>;

export interface SegmentRow { t: string; s: number; e: number }
export interface WordColumns { w: string[]; s: number[]; e: number[] }
export type WordsStatus = 'ok' | 'missing' | 'unsupported-word' | 'unsupported-param';
export interface ProviderResult {
    status: 'done' | 'error';
    model: string;
    wordsStatus?: WordsStatus;
    segments?: SegmentRow[];
    words?: WordColumns | null;
    notes: string[];
    error?: string;
    durationMs?: number;
}
export interface DiagnosticDoc { status?: string; startedAt?: number }

// ── 安全 ────────────────────────────────────────────────────

/** 教材文件由前端寫入，不能信任 audioUrl：必須是本專案 bucket 裡自己這份教材的 mp3（Codex） */
export function validateDiagnosticMaterial(
    material: any,
    ctx: { uid: string; materialId: string; appId: string; bucket: string },
): { ok: true; audioUrl: string } | { ok: false; error: string } {
    if (!material || typeof material !== 'object') return { ok: false, error: '找不到這份教材' };
    if (material.audioSource !== 'upload') return { ok: false, error: '只有上傳 mp3 的教材可以診斷' };
    if (!isOwnAudioUrl(material.audioUrl, ctx)) return { ok: false, error: '教材的音檔網址不正確' };
    return { ok: true, audioUrl: material.audioUrl };
}

/** 下載音檔：不跟隨轉址、超過 25MB 不下載 */
export async function fetchDiagnosticAudio(url: string, fetchImpl: FetchLike = fetch): Promise<ArrayBuffer> {
    const res = await fetchImpl(url, { redirect: 'manual' });
    if ((res.status >= 300 && res.status < 400) || res.type === 'opaqueredirect') throw new Error('音檔網址轉址，不下載');
    if (!res.ok) throw new Error(`下載音檔失敗 (HTTP ${res.status})`);
    const len = Number(res.headers.get('content-length') || 0);
    if (len > MAX_DIAG_AUDIO_BYTES) throw new Error('音檔超過 25MB，無法診斷');
    const buf = await res.arrayBuffer();
    if (buf.byteLength > MAX_DIAG_AUDIO_BYTES) throw new Error('音檔超過 25MB，無法診斷');
    if (buf.byteLength < MIN_AUDIO_BYTES) throw new Error('音檔太小');
    return buf;
}

export function canStartDiagnostic(doc: DiagnosticDoc | null | undefined, now: number): boolean {
    if (!doc || typeof doc.startedAt !== 'number') return true;
    const age = now - doc.startedAt;
    if (doc.status === 'running') return age > DIAG_STALE_MS;
    if (doc.status === 'error') return true;
    return age > DIAG_COOLDOWN_MS;
}

/** 錯誤訊息去掉金鑰樣式的字串 */
export function sanitizeError(msg: unknown, secrets: string[] = []): string {
    let s = String(msg ?? '').slice(0, 500);
    for (const k of secrets) if (k && k.length >= 8) s = s.split(k).join('***');   // 太短的字串不當成金鑰（避免誤換一般文字）
    return s.replace(/\b(sk|gsk|rk)[-_][A-Za-z0-9_-]{6,}/g, '***');
}

// ── 呼叫兩家 ────────────────────────────────────────────────

function buildForm(audio: ArrayBuffer, model: string, granularities: string[] | null): FormData {
    const form = new FormData();
    form.append('file', new Blob([audio], { type: 'audio/mpeg' }), 'audio.mp3');
    form.append('model', model);
    form.append('response_format', 'verbose_json');
    form.append('language', 'en');
    if (granularities) for (const g of granularities) form.append('timestamp_granularities[]', g);
    return form;
}

async function post(url: string, key: string, form: FormData, timeoutMs: number, fetchImpl: FetchLike): Promise<{ status: number; body: any; text: string }> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
        const res = await fetchImpl(url, { method: 'POST', headers: { Authorization: `Bearer ${key}` }, body: form, signal: ctrl.signal });
        const text = await res.text();
        let body: any = null;
        try { body = JSON.parse(text); } catch { /* 非 JSON */ }
        return { status: res.status, body, text };
    } finally {
        clearTimeout(timer);
    }
}

/** 不是有限數字的時間記成 -1（Firestore 不收 NaN；分析時視為缺值） */
const num = (x: unknown) => { const n = Number(x); return Number.isFinite(n) ? n : -1; };

function parseWhisper(body: any): { segments: SegmentRow[]; words: WordColumns | null } {
    const segments: SegmentRow[] = Array.isArray(body?.segments)
        ? body.segments.map((s: any) => ({ t: String(s?.text ?? '').trim(), s: num(s?.start), e: num(s?.end) }))
        : [];
    let words: WordColumns | null = null;
    if (Array.isArray(body?.words) && body.words.length > 0) {
        words = { w: [], s: [], e: [] };
        for (const x of body.words) {
            words.w.push(String(x?.word ?? ''));
            words.s.push(num(x?.start));
            words.e.push(num(x?.end));
        }
    }
    return { segments, words };
}

const errText = (r: { status: number; body: any; text: string }) => `HTTP ${r.status}：${r.body?.error?.message || r.text || ''}`;

export async function callOpenAIDiagnostic(audio: ArrayBuffer, key: string, fetchImpl: FetchLike = fetch): Promise<ProviderResult> {
    const model = 'whisper-1';
    const t0 = Date.now();
    try {
        const r = await post(OPENAI_TRANSCRIBE_URL, key, buildForm(audio, model, ['segment', 'word']), OPENAI_TIMEOUT_MS, fetchImpl);
        if (r.status !== 200) return { status: 'error', model, notes: [], error: sanitizeError(errText(r), [key]), durationMs: Date.now() - t0 };
        const { segments, words } = parseWhisper(r.body);
        return { status: 'done', model, wordsStatus: words ? 'ok' : 'missing', segments, words, notes: [], durationMs: Date.now() - t0 };
    } catch (e: any) {
        return { status: 'error', model, notes: [], error: sanitizeError(e?.message || e, [key]), durationMs: Date.now() - t0 };
    }
}

/**
 * Groq：先要 segment＋word。400 時分清楚（Codex）：
 * 「不支援 word」→ 只帶 segment 重試；「不認得 timestamp_granularities 參數」→ 拿掉參數重試；其他 400 不重試
 */
export async function callGroqDiagnostic(audio: ArrayBuffer, key: string, fetchImpl: FetchLike = fetch): Promise<ProviderResult> {
    const model = GROQ_TRANSCRIBE_MODEL;
    const t0 = Date.now();
    const notes: string[] = [];
    try {
        let r = await post(GROQ_TRANSCRIBE_URL, key, buildForm(audio, model, ['segment', 'word']), GROQ_TIMEOUT_MS, fetchImpl);
        let degraded: WordsStatus | null = null;
        if (r.status === 400) {
            const msg = String(r.body?.error?.message || r.text || '');
            const wordUnsupported = /\bword\b/i.test(msg) && /not supported|unsupported|invalid|not allowed/i.test(msg);
            const paramUnknown = /unknown param|unrecognized|unexpected/i.test(msg) && /timestamp_granularities/i.test(msg);
            if (wordUnsupported || paramUnknown) {
                notes.push(sanitizeError(`第一次（segment＋word）：${msg}`, [key]));
                degraded = wordUnsupported ? 'unsupported-word' : 'unsupported-param';
                r = await post(GROQ_TRANSCRIBE_URL, key, buildForm(audio, model, wordUnsupported ? ['segment'] : null), GROQ_TIMEOUT_MS, fetchImpl);
            }
        }
        if (r.status !== 200) return { status: 'error', model, notes, error: sanitizeError(errText(r), [key]), durationMs: Date.now() - t0 };
        const { segments, words } = parseWhisper(r.body);
        const wordsStatus: WordsStatus = degraded ?? (words ? 'ok' : 'missing');
        return { status: 'done', model, wordsStatus, segments, words: degraded ? null : words, notes, durationMs: Date.now() - t0 };
    } catch (e: any) {
        return { status: 'error', model, notes, error: sanitizeError(e?.message || e, [key]), durationMs: Date.now() - t0 };
    }
}

// ── Firestore 文件大小與分塊 ─────────────────────────────────
// 依官方規則：字串＝UTF-8 位元組＋1、數字 8、布林 1、null 1、陣列＝元素總和、map＝每個（欄位名稱＋1）＋值

const utf8 = (s: string) => new TextEncoder().encode(s).length;

export function firestoreValueSize(v: unknown): number {
    if (v === null || v === undefined) return 1;
    if (typeof v === 'string') return utf8(v) + 1;
    if (typeof v === 'number') return 8;
    if (typeof v === 'boolean') return 1;
    if (Array.isArray(v)) return v.reduce((n: number, x) => n + firestoreValueSize(x), 0);
    if (typeof v === 'object') {
        let n = 0;
        for (const [k, x] of Object.entries(v as Record<string, unknown>)) n += utf8(k) + 1 + firestoreValueSize(x);
        return n;
    }
    return 8;
}

export interface ProviderPart { segments?: SegmentRow[]; words?: WordColumns }

/** 依大小分塊：先放 segments、再放 words；每塊（以 Firestore 規則計算）不超過 maxBytes */
export function chunkProviderData(data: { segments?: SegmentRow[]; words?: WordColumns | null }, maxBytes = DIAG_PART_MAX_BYTES): ProviderPart[] {
    const parts: ProviderPart[] = [];
    const segs = data.segments ?? [];
    const SEG_FIELD = utf8('segments') + 1;
    let cur: SegmentRow[] = [];
    let size = SEG_FIELD;
    for (const row of segs) {
        const add = firestoreValueSize(row);
        if (cur.length > 0 && size + add > maxBytes) {
            parts.push({ segments: cur });
            cur = [];
            size = SEG_FIELD;
        }
        cur.push(row);
        size += add;
    }
    if (cur.length > 0 || !data.words) parts.push({ segments: cur });

    const w = data.words;
    if (w && w.w.length > 0) {
        const WORD_FIELDS = (utf8('words') + 1) + 3 * 2;   // words、w、s、e 欄位名稱
        let cw: WordColumns = { w: [], s: [], e: [] };
        let wsize = WORD_FIELDS;
        for (let i = 0; i < w.w.length; i++) {
            const add = firestoreValueSize(w.w[i]) + 16;
            if (cw.w.length > 0 && wsize + add > maxBytes) {
                parts.push({ words: cw });
                cw = { w: [], s: [], e: [] };
                wsize = WORD_FIELDS;
            }
            cw.w.push(w.w[i]);
            cw.s.push(w.s[i]);
            cw.e.push(w.e[i]);
            wsize += add;
        }
        if (cw.w.length > 0) parts.push({ words: cw });
    }
    return parts;
}

export function reassembleProviderData(parts: ProviderPart[]): { segments: SegmentRow[]; words: WordColumns | null } {
    const segments: SegmentRow[] = [];
    let words: WordColumns | null = null;
    for (const p of parts) {
        if (p.segments) segments.push(...p.segments);
        if (p.words) {
            if (!words) words = { w: [], s: [], e: [] };
            words.w.push(...p.words.w);
            words.s.push(...p.words.s);
            words.e.push(...p.words.e);
        }
    }
    return { segments, words };
}

// ── 整體流程 ────────────────────────────────────────────────

export const diagnosticDocPath = (appId: string, uid: string, materialId: string) =>
    `artifacts/${appId}/users/${uid}/transcriptionDiagnostics/${materialId}`;

export interface RunDiagnosticDeps {
    uid: string;
    materialId: string;
    appId?: string;
    now?: () => number;
    readMaterial: () => Promise<any>;
    readDiagnostic: () => Promise<DiagnosticDoc | null>;
    fetchAudio: (url: string) => Promise<ArrayBuffer>;
    openai: (audio: ArrayBuffer) => Promise<ProviderResult>;
    groq: (audio: ArrayBuffer) => Promise<ProviderResult>;
    /** 寫入（合併）一份文件 */
    write: (path: string, data: Record<string, any>) => Promise<void>;
}

export async function runDiagnostic(deps: RunDiagnosticDeps): Promise<'done' | 'error' | 'skipped'> {
    const appId = deps.appId ?? 'huan-power-english';
    const now = deps.now ?? Date.now;
    const base = diagnosticDocPath(appId, deps.uid, deps.materialId);

    const existing = await deps.readDiagnostic().catch(() => null);
    if (!canStartDiagnostic(existing, now())) return 'skipped';

    const startedAt = now();
    await deps.write(base, { status: 'running', startedAt, finishedAt: null, error: null, providers: {} });
    const finishError = async (error: string) => {
        await deps.write(base, { status: 'error', startedAt, finishedAt: now(), error: sanitizeError(error) }).catch(() => {});
        return 'error' as const;
    };

    try {
        const material = await deps.readMaterial();
        const v = validateDiagnosticMaterial(material, { uid: deps.uid, materialId: deps.materialId, appId, bucket: DIAG_BUCKET });
        if ('error' in v) return await finishError(v.error);
        const audio = await deps.fetchAudio(v.audioUrl);

        const settled = await Promise.allSettled([deps.openai(audio), deps.groq(audio)]);
        const names = ['openai', 'groq'] as const;
        const providers: Record<string, any> = {};
        for (let i = 0; i < names.length; i++) {
            const name = names[i];
            const s = settled[i];
            const r: ProviderResult = s.status === 'fulfilled'
                ? s.value
                : { status: 'error', model: '', notes: [], error: sanitizeError((s.reason as any)?.message || s.reason) };
            const summary: Record<string, any> = {
                status: r.status, model: r.model, wordsStatus: r.wordsStatus ?? null, notes: r.notes ?? [],
                error: r.error ?? null, durationMs: r.durationMs ?? null,
                segmentCount: r.segments?.length ?? 0, wordCount: r.words?.w.length ?? 0, parts: 0,
            };
            if (r.status === 'done') {
                try {
                    const parts = chunkProviderData({ segments: r.segments, words: r.words });
                    for (let p = 0; p < parts.length; p++) {
                        await deps.write(`${base}/parts/${name}-${p}`, { provider: name, index: p, ...parts[p] });
                    }
                    summary.parts = parts.length;
                } catch (e: any) {
                    summary.status = 'error';
                    summary.error = sanitizeError(`寫入診斷資料失敗：${e?.message || e}`);
                }
            }
            providers[name] = summary;
        }
        const anyDone = Object.values(providers).some((p: any) => p.status === 'done');
        await deps.write(base, {
            status: anyDone ? 'done' : 'error',
            startedAt,
            finishedAt: now(),
            title: typeof material?.title === 'string' ? material.title.slice(0, 200) : null,
            error: anyDone ? null : '兩家轉錄都失敗',
            providers,
        });
        return anyDone ? 'done' : 'error';
    } catch (e: any) {
        return finishError(e?.message || String(e));
    }
}
