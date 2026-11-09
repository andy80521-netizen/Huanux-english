// 播放一句（或一段）時，準時停在句尾
// 規劃：docs/plans/import-timestamp-accuracy.md（PR-A）
// 背景：瀏覽器的 timeupdate 大約每 250ms 才觸發一次，只靠它判斷會多播最多約 0.25 秒（聽到下一句開頭）

export interface SegmentMedia {
    currentTime: number;
    playbackRate?: number;
    paused?: boolean;
    readyState?: number;
    pause(): void;
    addEventListener(type: string, fn: () => void): void;
    removeEventListener(type: string, fn: () => void): void;
}

export type SegmentEndReason = 'end' | 'hidden';

export interface SegmentEndDeps {
    /** 逐格檢查（瀏覽器為 requestAnimationFrame）；不傳時用計時器 */
    requestFrame?: (fn: () => void) => unknown;
    cancelFrame?: (handle: unknown) => void;
    /** 頁面被隱藏（鎖屏、切 App）時呼叫 fn；回傳取消監聽的函式 */
    onHidden?: (fn: () => void) => () => void;
}

/** 剩餘時間少於這個（毫秒，實際時間）就改成逐格檢查 */
const FRAME_WINDOW_MS = 150;
/** 沒有逐格檢查時的檢查間隔 */
const FALLBACK_STEP_MS = 15;

const browserDeps = (): SegmentEndDeps => {
    const hasWindow = typeof window !== 'undefined';
    return {
        requestFrame: hasWindow && typeof window.requestAnimationFrame === 'function'
            ? (fn) => window.requestAnimationFrame(() => fn())
            : undefined,
        cancelFrame: hasWindow && typeof window.cancelAnimationFrame === 'function'
            ? (h) => window.cancelAnimationFrame(h as number)
            : undefined,
        onHidden: (fn) => {
            if (typeof document === 'undefined') return () => {};
            const handler = () => { if (document.visibilityState === 'hidden') fn(); };
            document.addEventListener('visibilitychange', handler);
            return () => document.removeEventListener('visibilitychange', handler);
        },
    };
};

/**
 * 監看播放，到 endTime 就暫停並回呼 onEnd('end')；頁面隱藏時直接暫停並回呼 onEnd('hidden')（擁有者決定）。
 * 每次檢查都以實際 currentTime 為準；暫停、seek、變速時重新排程。回傳取消函式（不暫停、不回呼），附帶 refresh()。
 */
export function watchSegmentEnd(
    media: SegmentMedia,
    /** 句尾（秒）；傳函式時每次檢查都讀最新值（校對畫面播放中可能修改句尾） */
    endTimeOrGetter: number | (() => number),
    onEnd: (reason: SegmentEndReason) => void,
    deps: SegmentEndDeps = browserDeps(),
): (() => void) & { refresh: () => void } {
    const endOf = typeof endTimeOrGetter === 'function' ? endTimeOrGetter : () => endTimeOrGetter;
    let done = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let frame: unknown = null;
    const unlisten: Array<() => void> = [];

    const clearScheduled = () => {
        if (timer !== null) { clearTimeout(timer); timer = null; }
        if (frame !== null) { deps.cancelFrame?.(frame); frame = null; }
    };

    const cleanup = () => {
        done = true;
        clearScheduled();
        unlisten.forEach((u) => u());
        unlisten.length = 0;
    };

    const finish = (reason: SegmentEndReason) => {
        if (done) return;
        cleanup();
        try { media.pause(); } catch { /* 忽略 */ }
        onEnd(reason);
    };

    const check = () => {
        // 先清掉既有排程：check 也會由事件與 refresh 呼叫，不清會留下重複的計時（Codex 第 3 輪）
        clearScheduled();
        if (done) return;
        if (media.currentTime >= endOf()) { finish('end'); return; }
        schedule();
    };

    const schedule = () => {
        clearScheduled();
        if (done || media.paused) return;   // 暫停中：等 playing 再排
        const rate = media.playbackRate && media.playbackRate > 0 ? media.playbackRate : 1;
        const remainMs = ((endOf() - media.currentTime) / rate) * 1000;
        if (remainMs > FRAME_WINDOW_MS) {
            timer = setTimeout(check, remainMs - FRAME_WINDOW_MS / 2);
        } else if (deps.requestFrame) {
            frame = deps.requestFrame(check);
        } else {
            timer = setTimeout(check, FALLBACK_STEP_MS);
        }
    };

    const listen = (type: string, fn: () => void) => {
        media.addEventListener(type, fn);
        unlisten.push(() => media.removeEventListener(type, fn));
    };

    listen('timeupdate', () => { if (!done && media.currentTime >= endOf()) finish('end'); });
    listen('playing', check);
    listen('seeked', check);
    listen('ratechange', check);
    listen('pause', clearScheduled);
    listen('ended', () => finish('end'));
    if (deps.onHidden) unlisten.push(deps.onHidden(() => finish('hidden')));

    check();
    // 取消函式附帶 refresh：句尾改了（例如校對播放中縮短）時立刻依新句尾重新檢查與排程
    return Object.assign(() => { if (!done) cleanup(); }, { refresh: () => { if (!done) check(); } });
}

export type SegmentEndWatch = ReturnType<typeof watchSegmentEnd>;

const pendingSeek = new WeakMap<object, () => void>();

/**
 * 設定起點。音檔還沒載入時間資訊（readyState < 1）時，iPhone 可能忽略 currentTime 的設定，
 * 改成等 loadedmetadata 再設定（只套用最後一次要求）。play() 仍由呼叫端在點擊當下呼叫。
 */
export function seekSegmentStart(media: SegmentMedia, startTime: number): void {
    const start = Number.isFinite(startTime) && startTime > 0 ? startTime : 0;
    pendingSeek.get(media)?.();
    pendingSeek.delete(media);
    if (media.readyState === undefined || media.readyState >= 1) {
        media.currentTime = start;
        return;
    }
    const onMeta = () => {
        media.removeEventListener('loadedmetadata', onMeta);
        pendingSeek.delete(media);
        media.currentTime = start;
    };
    media.addEventListener('loadedmetadata', onMeta);
    pendingSeek.set(media, () => media.removeEventListener('loadedmetadata', onMeta));
}

// ── 起點確認（docs/plans/ios-seek-fix.md）────────────────────────────────
// 擁有者 2026-11-09 回報：iPhone（Chrome，底層與 Safari 相同）上 9 分鐘的教材，每次播放（跟讀、詳情頁、聽句尾）
// 都從音檔開頭播；幾分鐘內的短教材正常。電腦版 Chromium 用同一個音檔正常 → 判斷是 iPhone 跳到「還沒下載的位置」失敗。
// 做法：播放中確認位置；落在起點之前 → 再跳一次；仍不行 → 改用網址指定起點（#t=）重新載入；再不行 → 停止並回報診斷。

/** 播放位置落在起點之前超過這個（秒）就算沒跳成功 */
export const START_TOLERANCE_SEC = 0.5;
/** 直接重新設定起點的次數上限（之後改用 #t= 重新載入） */
export const MAX_START_RETRIES = 2;

interface RangesLike { length: number; start(i: number): number; end(i: number): number }

export interface GuardMedia extends SegmentMedia {
    seeking?: boolean;
    duration?: number;
    src?: string;
    currentSrc?: string;
    seekable?: RangesLike;
    buffered?: RangesLike;
    load?(): void;
    play?(): Promise<void> | void;
}

const fmtRanges = (r?: RangesLike) => {
    if (!r || !r.length) return '無';
    const parts: string[] = [];
    for (let i = 0; i < r.length; i++) parts.push(`${r.start(i).toFixed(1)}～${r.end(i).toFixed(1)}`);
    return parts.join('、');
};

/** 給使用者截圖回報用的診斷文字 */
export function describeSeekFailure(media: GuardMedia, start: number): string {
    const dur = typeof media.duration === 'number' && Number.isFinite(media.duration) ? media.duration.toFixed(1) : String(media.duration);
    return `目標 ${start.toFixed(1)} 秒，目前 ${media.currentTime.toFixed(1)} 秒，長度 ${dur} 秒，可跳轉 ${fmtRanges(media.seekable)}，已下載 ${fmtRanges(media.buffered)}，狀態 ${media.readyState ?? '?'}`;
}

/** 用網址指定起點重新載入（iPhone 原生支援，不靠事後跳轉）；沒有網址時回傳 false */
function reloadWithFragment(media: GuardMedia, start: number): boolean {
    const base = (media.currentSrc || media.src || '').split('#')[0];
    if (!base) return false;
    media.src = `${base}#t=${start.toFixed(2)}`;
    try { media.load?.(); } catch { /* 忽略 */ }
    try { const p = media.play?.(); if (p && typeof (p as Promise<void>).catch === 'function') (p as Promise<void>).catch(() => {}); } catch { /* 忽略 */ }
    return true;
}

/**
 * 播放一段時確認真的從起點開始。在 seekSegmentStart 與 play() 之後呼叫；回傳取消函式（段落結束、停止時呼叫）。
 * 失敗時會暫停並呼叫 onFail（附診斷文字）。
 */
export function guardSegmentStart(media: GuardMedia, startTime: number, onFail: (diag: string) => void): () => void {
    const start = Number.isFinite(startTime) && startTime > 0 ? startTime : 0;
    let done = false;
    let retries = 0;
    let usedFragment = false;
    const unlisten: Array<() => void> = [];
    const cleanup = () => { done = true; unlisten.forEach((u) => u()); unlisten.length = 0; };

    const check = () => {
        if (done || start <= START_TOLERANCE_SEC) return;
        if (media.paused || media.seeking) return;
        if (media.currentTime >= start - START_TOLERANCE_SEC) return;
        if (retries < MAX_START_RETRIES) {
            retries += 1;
            media.currentTime = start;
            return;
        }
        if (!usedFragment) {
            usedFragment = true;
            if (reloadWithFragment(media, start)) return;
        }
        const diag = describeSeekFailure(media, start);
        cleanup();
        try { media.pause(); } catch { /* 忽略 */ }
        console.warn('[播放] 沒辦法跳到起點:', diag);
        onFail(diag);
    };

    for (const type of ['playing', 'timeupdate', 'seeked']) {
        media.addEventListener(type, check);
        unlisten.push(() => media.removeEventListener(type, check));
    }
    check();
    return () => { if (!done) cleanup(); };
}
