// 背景存檔：任務狀態 → 全域提示（純函式）
// 規劃：docs/plans/background-material-save.md

/** 送出後這段時間內背景函式都沒有認領（沒有心跳）→ 可能沒叫到 */
export const SAVE_STALL_NO_START_MS = 60_000;
/** 心跳停止超過這段時間 → 可能中斷 */
export const SAVE_STALL_HEARTBEAT_MS = 3 * 60_000;

export type SaveJobStatus = 'processing' | 'completed' | 'error' | 'saving' | 'saveError' | 'paused' | 'reviewing' | 'saved';

export interface SaveJobDoc {
    status?: SaveJobStatus | string;
    title?: string;
    progress?: { done: number; total: number };
    saveRequestedAt?: number;
    heartbeatAt?: number;
    errorMessage?: string;
    saveAttempt?: number;
    /** 背景函式寫回的診斷說明（例如「第 2 次：出錯：…」） */
    saveDiag?: string;
}

export type SaveJobView =
    | { kind: 'saving'; text: string }
    | { kind: 'stalled'; text: string }
    | { kind: 'error'; text: string }
    | { kind: 'paused'; text: string }
    | { kind: 'reviewing'; text: string };

/** 哪些狀態可以由前端送出（或重新送出）背景存檔 */
export const canStartSave = (status: SaveJobStatus | string | undefined) =>
    status === 'completed' || status === 'reviewing' || status === 'saveError' || status === 'paused';

/** 任務 → 提示文字；不需要顯示（轉錄中、待校對、已存好）→ null */
export function describeSaveJob(job: SaveJobDoc, now: number): SaveJobView | null {
    const title = job.title || '教材';
    switch (job.status) {
        case 'saving': {
            const p = job.progress;
            const progress = p && p.total > 0 ? ` ${p.done}/${p.total}` : '';
            const stalled = typeof job.heartbeatAt === 'number'
                ? now - job.heartbeatAt > SAVE_STALL_HEARTBEAT_MS
                : typeof job.saveRequestedAt === 'number' && now - job.saveRequestedAt > SAVE_STALL_NO_START_MS;
            const diag = job.saveDiag ? `｜${job.saveDiag}` : '';
            return stalled
                ? { kind: 'stalled', text: `${title} 的儲存可能中斷了${progress ? `（已完成${progress}）` : ''}${diag}` }
                : { kind: 'saving', text: `教材儲存中：${title}${progress}` };
        }
        case 'saveError':
            return { kind: 'error', text: `${title} 儲存失敗：${job.errorMessage || '請重試'}` };
        case 'paused':
            return { kind: 'paused', text: `${title} 需要續存：${job.errorMessage || '已保存進度'}` };
        case 'reviewing':
            return { kind: 'reviewing', text: `${title} 還沒儲存，可以回到校對繼續` };
        default:
            return null;
    }
}
