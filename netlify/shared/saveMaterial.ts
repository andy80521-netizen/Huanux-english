// 匯入教材在伺服器背景存檔：驗證、分批翻譯（檢查點）、原子建立教材、派封面與重逢
// 規劃：docs/plans/background-material-save.md（擁有者 2026-11-09 核准）
//
// 任務文件 transcriptionJobs/{materialId} 的狀態：
//   processing → completed（轉錄完，待校對）→ saving（背景存檔中）→ saved（已建立教材，隨後刪除任務）
//   saving → saveError（失敗）／paused（超過軟期限，需要續存）
//   使用者「回到校對」→ reviewing；「重試／繼續」→ saving（saveAttempt + 1）
// 所有權：前端每次送出都把 saveAttempt + 1；背景執行以 leaseId 認領，之後每次寫入都在交易內重新確認
// saveAttempt 與 leaseId，不符就安靜結束（不寫 saveError）。教材與「saved」狀態在同一筆交易建立。

import type { TxApi } from './firestoreRest';
export type { TxApi } from './firestoreRest';

/** 租約：認領後這段時間內，同一個 attempt 的其他執行會讓開；每批完成時延長 */
export const LEASE_MS = 150_000;
/** 軟期限：背景函式上限 15 分鐘，超過這個時間就保存檢查點、標成「需要續存」 */
export const SOFT_DEADLINE_MS = 12 * 60_000;
/** 每批翻譯逾時與重試次數 */
export const BATCH_TIMEOUT_MS = 60_000;
export const BATCH_RETRIES = 2;
export const BATCH_SIZE = 30;
/** Firestore 單一文件 1MiB，留安全空間 */
export const MAX_DOC_BYTES = 900_000;
export const MAX_SENTENCE_CHARS = 2000;
export const MAX_TITLE_CHARS = 200;
const COVER_CHOICES = ['photo', 'anime', 'none'] as const;
export type CoverChoice = typeof COVER_CHOICES[number];

export interface ReviewedSentence {
    text: string;
    startTime: number;
    endTime: number;
    lowConfidence?: boolean;
    needsReview?: boolean;
}

export interface SaveDeps {
    /** 執行一筆交易（衝突時由實作重跑） */
    tx: <T>(fn: (t: TxApi) => Promise<T>) => Promise<T>;
    /** 翻譯一批 */
    translate: (sentences: string[]) => Promise<string[]>;
    /** 呼叫既有背景函式（generate-cover／detect-sightings），回傳是否被接受（2xx） */
    dispatch: (fn: 'generate-cover' | 'detect-sightings', body: Record<string, unknown>) => Promise<boolean>;
    now: () => number;
    newId: () => string;
    log?: (msg: string) => void;
}

export interface SaveInput {
    uid: string;
    materialId: string;
    saveAttempt: number;
    idToken: string;
    appId: string;
    bucket: string;
}

export type SaveOutcome = 'saved' | 'stale' | 'busy' | 'lost' | 'invalid' | 'paused' | 'error';

/** 音檔網址必須是 Firebase Storage 上「這個使用者、這份教材」的 mp3 */
export function isOwnAudioUrl(url: unknown, ctx: { uid: string; materialId: string; appId: string; bucket: string }): boolean {
    if (typeof url !== 'string') return false;
    let u: URL;
    try { u = new URL(url); } catch { return false; }
    if (u.protocol !== 'https:' || u.hostname !== 'firebasestorage.googleapis.com') return false;
    const prefix = `/v0/b/${ctx.bucket}/o/`;
    if (!u.pathname.startsWith(prefix)) return false;
    let objectPath: string;
    try { objectPath = decodeURIComponent(u.pathname.slice(prefix.length)); } catch { return false; }
    return objectPath === `artifacts/${ctx.appId}/users/${ctx.uid}/materials/${ctx.materialId}.mp3`;
}

const isFiniteNum = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);

/** 驗證前端寫入任務文件的內容（後端必須假設它可能被竄改） */
export function validateSaveJob(
    job: Record<string, any>,
    ctx: { uid: string; materialId: string; appId: string; bucket: string },
): { ok: true; value: { title: string; audioUrl: string; coverChoice: CoverChoice; reviewed: ReviewedSentence[] } } | { ok: false; error: string } {
    const fail = (error: string) => ({ ok: false as const, error });
    if (!isOwnAudioUrl(job.audioUrl, ctx)) return fail('音檔網址不正確');
    if (!COVER_CHOICES.includes(job.coverChoice)) return fail('封面選項不正確');
    const list = job.reviewed;
    if (!Array.isArray(list) || list.length === 0) return fail('沒有要儲存的句子');
    const reviewed: ReviewedSentence[] = [];
    for (const [i, s] of list.entries()) {
        if (!s || typeof s.text !== 'string' || !s.text.trim()) return fail(`第 ${i + 1} 句沒有文字`);
        if (s.text.length > MAX_SENTENCE_CHARS) return fail(`第 ${i + 1} 句太長`);
        if (!isFiniteNum(s.startTime) || !isFiniteNum(s.endTime) || s.startTime < 0 || s.startTime >= s.endTime) return fail(`第 ${i + 1} 句的時間不正確`);
        reviewed.push({
            text: s.text,
            startTime: s.startTime,
            endTime: s.endTime,
            ...(s.lowConfidence === true ? { lowConfidence: true } : {}),
            ...(s.needsReview === true ? { needsReview: true } : {}),
        });
    }
    const rawTitle = typeof job.title === 'string' ? job.title.replace(/[\u0000-\u001f\u007f]/g, '').trim() : '';
    return { ok: true, value: { title: rawTitle.slice(0, MAX_TITLE_CHARS) || '未命名教材', audioUrl: job.audioUrl, coverChoice: job.coverChoice, reviewed } };
}

/** 組教材（與原本前端 confirmAndSaveMaterial 的格式相同；選填欄位沒有值就省略） */
export function buildUploadMaterial(input: {
    materialId: string; title: string; audioUrl: string; reviewed: ReviewedSentence[]; translations: string[]; coverChoice: CoverChoice; now: number;
}): Record<string, any> {
    const { materialId, title, audioUrl, reviewed, translations, coverChoice, now } = input;
    return {
        id: materialId,
        title,
        course: '未分類',
        sourceText: reviewed.map(r => r.text).join(' '),
        audioUrl,
        audioSource: 'upload',
        sentences: reviewed.map((r, i) => ({
            id: `s_${i}`,
            text: r.text,
            translation: translations[i] || '',
            startTime: r.startTime,
            endTime: r.endTime,
            ...(r.lowConfidence ? { lowConfidence: true } : {}),
            ...(r.needsReview ? { needsReview: true } : {}),
            mastery: 0,
        })),
        createdAt: now,
        graduated: false,
        ...(coverChoice !== 'none' ? { coverStyle: coverChoice, coverStatus: 'generating', coverRequestedAt: now } : {}),
    };
}

/** 封面摘要（與 src/utils/coverExcerpt.ts 相同規則，測試確認輸出一致） */
export function buildCoverExcerpt(sentences: { text: string }[]): string {
    let result = '';
    for (const s of sentences) {
        if (!s.text) continue;
        const piece = (result ? ' ' : '') + s.text.trim();
        if (result.length + piece.length > 800) {
            const remaining = 800 - result.length;
            if (remaining > 0) {
                result += piece.slice(0, remaining);
            }
            break;
        }
        result += piece;
    }
    return result;
}

/** 估算文件大小（UTF-8 位元組，略為高估） */
export const estimateDocBytes = (obj: unknown) => Math.ceil(new TextEncoder().encode(JSON.stringify(obj)).length * 1.1);

const TOO_LONG = '教材太長，超過資料庫單一文件的上限，請把音檔分段匯入';

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`翻譯逾時（${Math.round(ms / 1000)} 秒）`)), ms);
        p.then((v) => { clearTimeout(timer); resolve(v); }, (e) => { clearTimeout(timer); reject(e); });
    });
}

class LostOwnership extends Error {}

/** 背景存檔主流程 */
export async function runSaveMaterial(deps: SaveDeps, input: SaveInput): Promise<SaveOutcome> {
    const { uid, materialId, saveAttempt, idToken, appId, bucket } = input;
    const base = `artifacts/${appId}/users/${uid}`;
    const jobPath = `${base}/transcriptionJobs/${materialId}`;
    const materialPath = `${base}/materials/${materialId}`;
    const sightingsPath = `${base}/materialSightings/${materialId}`;
    const log = deps.log ?? (() => {});
    const startedAt = deps.now();
    const leaseId = deps.newId();

    const ownedBy = (j: Record<string, any> | null) =>
        !!j && j.status === 'saving' && j.saveAttempt === saveAttempt && j.leaseId === leaseId;

    /** 交易內確認仍是擁有者才寫入；不是 → false */
    const guarded = (write: (t: TxApi, job: Record<string, any>) => void | Promise<void>) =>
        deps.tx(async (t) => {
            const j = await t.get(jobPath);
            if (!ownedBy(j)) return false;
            await write(t, j as Record<string, any>);
            return true;
        });

    // 1. 認領
    const claim = await deps.tx(async (t) => {
        const j = await t.get(jobPath);
        if (!j || j.status !== 'saving' || j.saveAttempt !== saveAttempt) return { kind: 'stale' as const };
        if (j.leaseId && typeof j.leaseUntil === 'number' && j.leaseUntil > deps.now()) return { kind: 'busy' as const };
        t.update(jobPath, { leaseId, leaseUntil: deps.now() + LEASE_MS, heartbeatAt: deps.now() });
        return { kind: 'claimed' as const, job: j };
    });
    if (claim.kind !== 'claimed') {
        log(`未認領：${claim.kind}`);
        return claim.kind;
    }
    const job = claim.job;

    const fail = async (message: string, outcome: SaveOutcome): Promise<SaveOutcome> => {
        const ok = await guarded((t) => t.update(jobPath, { status: 'saveError', errorMessage: message.slice(0, 300) }, ['leaseId', 'leaseUntil']))
            .catch((e) => { log(`寫入失敗狀態時出錯：${e?.message}`); return false; });
        return ok ? outcome : 'lost';
    };

    let material: Record<string, any>;
    let value: { title: string; audioUrl: string; coverChoice: CoverChoice; reviewed: ReviewedSentence[] };
    try {
        // 2. 驗證（呼叫 AI 之前）
        const v = validateSaveJob(job, { uid, materialId, appId, bucket });
        if ('error' in v) return await fail(v.error, 'invalid');
        value = v.value;
        const texts = value.reviewed.map(r => r.text);
        const emptyEstimate = buildUploadMaterial({ ...value, materialId, translations: [], now: deps.now() });
        if (estimateDocBytes(emptyEstimate) > MAX_DOC_BYTES) return await fail(TOO_LONG, 'error');

        // 3. 分批翻譯（從檢查點接續）
        const prior: string[] = Array.isArray(job.translations) && job.translations.length <= texts.length
            && job.translations.every((x: unknown) => typeof x === 'string') ? job.translations : [];
        const translations = [...prior];
        while (translations.length < texts.length) {
            if (deps.now() - startedAt > SOFT_DEADLINE_MS) {
                const ok = await guarded((t) => t.update(jobPath, {
                    status: 'paused', errorMessage: '處理時間較長，已保存進度，請按「繼續」接著完成',
                }, ['leaseId', 'leaseUntil']));
                return ok ? 'paused' : 'lost';
            }
            const batch = texts.slice(translations.length, translations.length + BATCH_SIZE);
            let result: string[] | null = null;
            let lastErr: unknown = null;
            for (let attempt = 0; attempt <= BATCH_RETRIES && !result; attempt++) {
                try {
                    const r = await withTimeout(deps.translate(batch), BATCH_TIMEOUT_MS);
                    if (!Array.isArray(r) || r.length !== batch.length) throw new Error('翻譯句數不一致');
                    result = r;
                } catch (e) {
                    lastErr = e;
                    log(`翻譯第 ${translations.length + 1} 句起的一批失敗（第 ${attempt + 1} 次）：${(e as Error)?.message}`);
                }
            }
            if (!result) return await fail(`翻譯失敗：${(lastErr as Error)?.message || lastErr}`, 'error');
            translations.push(...result);
            // 檢查點＋心跳＋延長租約（串行寫入，不另開計時器）
            const ok = await guarded((t) => t.update(jobPath, {
                translations, progress: { done: translations.length, total: texts.length },
                heartbeatAt: deps.now(), leaseUntil: deps.now() + LEASE_MS,
            }));
            if (!ok) throw new LostOwnership();
        }

        // 4. 組教材與大小檢查
        material = buildUploadMaterial({ ...value, materialId, translations, now: deps.now() });
        if (estimateDocBytes(material) > MAX_DOC_BYTES) return await fail(TOO_LONG, 'error');

        // 5. 原子建立教材＋任務改 saved
        const committed = await deps.tx(async (t) => {
            const j = await t.get(jobPath);
            if (!ownedBy(j)) return 'lost' as const;
            const existing = await t.get(materialPath);
            if (!existing) t.create(materialPath, material);
            t.update(jobPath, { status: 'saved', savedAt: deps.now() }, ['leaseId', 'leaseUntil']);
            return existing ? 'existed' as const : 'created' as const;
        });
        if (committed === 'lost') return 'lost';
        if (committed === 'existed') {
            log('教材已存在，不覆寫');
            await deps.tx(async (t) => { t.delete(jobPath); }).catch(() => {});
            return 'saved';
        }
    } catch (e) {
        if (e instanceof LostOwnership) { log('失去所有權，停止'); return 'lost'; }
        log(`背景存檔失敗：${(e as Error)?.message}`);
        return await fail(`儲存失敗：${(e as Error)?.message || e}`, 'error');
    }

    // 6. 教材已建立：封面、重逢只派工，失敗不推翻教材
    if (value.coverChoice !== 'none') {
        const ok = await deps.dispatch('generate-cover', {
            idToken, materialId, style: value.coverChoice, title: value.title, excerpt: buildCoverExcerpt(value.reviewed),
        }).catch(() => false);
        if (!ok) {
            await deps.tx(async (t) => { t.update(materialPath, { coverStatus: 'error', coverError: '啟動封面產生失敗' }); })
                .catch((e) => log(`記錄封面錯誤失敗：${e?.message}`));
        }
    }
    try {
        await deps.tx(async (t) => { t.set(sightingsPath, { status: 'processing', requestedAt: deps.now(), error: '' }); });
        const ok = await deps.dispatch('detect-sightings', { idToken, materialId }).catch(() => false);
        if (!ok) await deps.tx(async (t) => { t.set(sightingsPath, { status: 'error', error: '送出比對請求失敗' }); });
    } catch (e) {
        log(`重逢比對派工失敗：${(e as Error)?.message}`);
    }

    // 7. 刪除任務文件（失敗也算已儲存；前端看到 saved 一樣會清理）
    await deps.tx(async (t) => { t.delete(jobPath); }).catch((e) => log(`刪除任務文件失敗：${e?.message}`));
    return 'saved';
}
