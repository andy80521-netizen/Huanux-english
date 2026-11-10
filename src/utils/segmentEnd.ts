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
 * 設定起點：一律立刻設定 currentTime（音檔還沒載入時瀏覽器會記成「預設起點」，載入後從這裡播，iPhone 靠這個）。
 * 還沒載入時間資訊（readyState < 1）→ 再等 loadedmetadata 確認一次，不在起點就再設一次（只套用最後一次要求）。
 * 擁有者 2026-11-09：PR #35 改成「沒載入就只等 loadedmetadata 才設定」後，iPhone 每一句跟讀都從頭播（docs/plans/ios-seek-fix.md）
 */
export function seekSegmentStart(media: SegmentMedia, startTime: number): void {
    const start = Number.isFinite(startTime) && startTime > 0 ? startTime : 0;
    cancelPendingPause(media);   // 新的播放：取消舊的延遲暫停（docs/plans/ios-ended-fix.md）
    pendingSeek.get(media)?.();
    pendingSeek.delete(media);
    media.currentTime = start;
    if (media.readyState === undefined || media.readyState >= 1) return;
    const onMeta = () => {
        media.removeEventListener('loadedmetadata', onMeta);
        pendingSeek.delete(media);
        if (Math.abs(media.currentTime - start) > 0.05) media.currentTime = start;
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
    ended?: boolean;
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

/** 網址加上 #t=起點（iPhone 原生支援，載入時就從起點開始，不靠事後跳轉） */
export function withStartFragment(url: string, start: number): string {
    const base = (url || '').split('#')[0];
    return start > 0 ? `${base}#t=${start.toFixed(2)}` : base;
}

export interface GuardOptions {
    /**
     * 補跳無效時是否改用 #t= 重新載入並播放（預設 true）。
     * 跟讀錄音中不適合重新載入（原音會延後、和錄音時序脫鉤，Gemini）→ 傳 false，直接回報失敗。
     */
    allowReload?: boolean;
    /** 診斷紀錄（docs/plans/shadowing-stable-playback.md） */
    log?: (msg: string) => void;
}

/** 連續看到幾次「位置在前進」才判斷起點（避免播放初期的空窗被誤判，擁有者 2026-11-10） */
const ADVANCE_SAMPLES = 2;

/**
 * 播放一段時確認真的從起點開始。在 seekSegmentStart 與 play() 之後呼叫；回傳取消函式（段落結束、停止時呼叫）。
 * 只在「正在播放、沒在跳轉、已有資料（readyState ≥ 2），而且連續看到位置在前進」時才判斷（docs/plans/shadowing-stable-playback.md）：
 * iPhone 播放初期可能短暫回報 0 秒，PR #42 一播放就判斷 → 誤判、中止跟讀。
 * 位置在起點之前 → 補跳（最多 MAX_START_RETRIES 次，每次補跳後重新取樣）→ #t= 重新載入（allowReload）→ 暫停並回報。
 * #t= 重新載入後播放被拒或載入失敗也算失敗（Codex）。重新載入後 src 會留著 #t=：只在載入當下決定起點，之後設定 currentTime 照常有效。
 */
export function guardSegmentStart(media: GuardMedia, startTime: number, onFail: (diag: string) => void, opts: GuardOptions = {}): () => void {
    const start = Number.isFinite(startTime) && startTime > 0 ? startTime : 0;
    const allowReload = opts.allowReload !== false;
    const log = opts.log ?? (() => {});
    let done = false;
    let retries = 0;
    let usedFragment = false;
    let last: number | null = null;
    let streak = 0;
    const unlisten: Array<() => void> = [];
    const cleanup = () => { done = true; unlisten.forEach((u) => u()); unlisten.length = 0; };
    const resetSamples = () => { last = null; streak = 0; };

    const fail = () => {
        if (done) return;
        const diag = describeSeekFailure(media, start);
        cleanup();
        try { media.pause(); } catch { /* 忽略 */ }
        log(`起點確認失敗：${diag}`);
        console.warn('[播放] 沒辦法跳到起點:', diag);
        onFail(diag);
    };

    const reload = (): boolean => {
        const base = (media.currentSrc || media.src || '').split('#')[0];
        if (!base) return false;
        log('起點確認：改用 #t= 重新載入');
        try {
            media.src = withStartFragment(base, start);
            media.load?.();
            const p = media.play?.();
            if (p && typeof (p as Promise<void>).then === 'function') (p as Promise<void>).then(undefined, () => fail());
        } catch {
            fail();
        }
        return true;
    };

    const sample = () => {
        if (done || start <= START_TOLERANCE_SEC) return;
        const ready = !media.paused && !media.seeking && (media.readyState === undefined || media.readyState >= 2);
        if (!ready) { resetSamples(); return; }
        const ct = media.currentTime;
        const prev = last;
        last = ct;
        if (prev === null || !(ct > prev + 0.01)) { streak = 0; return; }   // 還沒確認在前進
        streak += 1;
        if (streak < ADVANCE_SAMPLES) return;
        if (ct >= start - START_TOLERANCE_SEC) return;
        if (retries < MAX_START_RETRIES) {
            retries += 1;
            log(`起點確認：在 ${ct.toFixed(2)} 秒往前播，補跳回 ${start.toFixed(2)}（第 ${retries} 次）`);
            resetSamples();
            media.currentTime = start;
            return;
        }
        if (allowReload && !usedFragment) {
            usedFragment = true;
            resetSamples();
            if (reload()) return;
        }
        fail();
    };

    const onSeeked = () => { resetSamples(); sample(); };
    const onError = () => { if (usedFragment) fail(); };
    const listen = (type: string, fn: () => void) => {
        media.addEventListener(type, fn);
        unlisten.push(() => media.removeEventListener(type, fn));
    };
    listen('error', onError);
    listen('playing', sample);
    listen('timeupdate', sample);
    listen('seeked', onSeeked);
    listen('pause', resetSamples);
    sample();
    return () => { if (!done) cleanup(); };
}

// ── 原音先就位才錄音（docs/plans/shadowing-stable-playback.md）─────────────

/** 原音就位最多等幾毫秒（擁有者 2026-11-10：6 秒） */
export const PREPARE_TIMEOUT_MS = 6000;
/** 就位的位置誤差（秒） */
export const READY_TOLERANCE_SEC = 0.25;
/** 就位等待中最多重新設定起點幾次 */
const MAX_PREPARE_SEEKS = 3;
/** 沒有事件時的檢查間隔（偵測取消） */
const PREPARE_POLL_MS = 200;

export type PrepareResult = 'ready' | 'timeout' | 'cancelled';

export interface PrepareOptions {
    timeoutMs?: number;
    isCancelled?: () => boolean;
    /** 頁面被隱藏時呼叫 fn；回傳取消監聽的函式（預設：document visibilitychange） */
    onHidden?: (fn: () => void) => () => void;
    log?: (msg: string) => void;
}

const browserOnHidden = (fn: () => void) => {
    if (typeof document === 'undefined') return () => {};
    const handler = () => { if (document.visibilityState === 'hidden') fn(); };
    document.addEventListener('visibilitychange', handler);
    return () => document.removeEventListener('visibilitychange', handler);
};

/**
 * 等原音停在起點而且可以播放：readyState ≥ 1、沒在跳轉、位置與起點相差 ≤ 0.25 秒。
 * 不在起點就重新設定（例如靜音解鎖播放往前走了）。不會呼叫 play()、不會換 src。
 */
export function prepareSegmentStart(media: GuardMedia, startTime: number, opts: PrepareOptions = {}): Promise<PrepareResult> {
    const start = Number.isFinite(startTime) && startTime > 0 ? startTime : 0;
    const timeoutMs = opts.timeoutMs ?? PREPARE_TIMEOUT_MS;
    const log = opts.log ?? (() => {});
    return new Promise<PrepareResult>((resolve) => {
        let settled = false;
        let seeks = 0;
        const unlisten: Array<() => void> = [];
        let poll: ReturnType<typeof setInterval> | null = null;
        let timer: ReturnType<typeof setTimeout> | null = null;
        const finish = (r: PrepareResult) => {
            if (settled) return;
            settled = true;
            unlisten.forEach((u) => u());
            unlisten.length = 0;
            if (poll !== null) clearInterval(poll);
            if (timer !== null) clearTimeout(timer);
            log(`就位結果：${r}（ct=${media.currentTime.toFixed(2)} rs=${media.readyState ?? '?'}）`);
            resolve(r);
        };
        // iPhone：跳轉中被暫停會讓播放器回到 0 秒並宣告已播完，之後跳轉都落在 0（docs/plans/ios-ended-fix.md）
        // → 偵測到 ended，或跳轉完成仍不在起點兩次，就重新載入一次
        let recovered = false;
        let badSeeks = 0;
        const recover = (): boolean => {
            if (recovered || typeof media.load !== 'function') return false;
            recovered = true;
            badSeeks = 0;
            seeks = 0;
            log(`播放器狀態異常（ended=${media.ended ? 1 : 0}、跳轉後在 ${media.currentTime.toFixed(2)} 秒）→ 重新載入`);
            media.load();
            return true;
        };
        const evaluate = () => {
            if (settled) return;
            if (opts.isCancelled?.()) { finish('cancelled'); return; }
            const rs = media.readyState === undefined ? 4 : media.readyState;
            if (rs < 1 || media.seeking) return;
            const atStart = Math.abs(media.currentTime - start) <= READY_TOLERANCE_SEC;
            if (atStart && !media.ended) { finish('ready'); return; }
            if ((media.ended || badSeeks >= 2) && recover()) return;
            if (seeks < MAX_PREPARE_SEEKS) {
                seeks += 1;
                log(`就位：在 ${media.currentTime.toFixed(2)} 秒，拉回 ${start.toFixed(2)}`);
                media.currentTime = start;
            }
        };
        const onSeeked = () => {
            if (Math.abs(media.currentTime - start) > READY_TOLERANCE_SEC) badSeeks += 1;
            evaluate();
        };
        media.addEventListener('seeked', onSeeked);
        unlisten.push(() => media.removeEventListener('seeked', onSeeked));
        for (const type of ['loadedmetadata', 'loadeddata', 'canplay', 'canplaythrough', 'timeupdate', 'progress', 'pause', 'durationchange']) {
            media.addEventListener(type, evaluate);
            unlisten.push(() => media.removeEventListener(type, evaluate));
        }
        unlisten.push((opts.onHidden ?? browserOnHidden)(() => finish('cancelled')));
        poll = setInterval(evaluate, PREPARE_POLL_MS);
        timer = setTimeout(() => finish('timeout'), timeoutMs);
        evaluate();
    });
}

// ── iPhone：不要在跳轉中暫停（docs/plans/ios-ended-fix.md）──────────────────
// 診斷紀錄：跳轉中 pause() → 回到 0 秒並宣告已播完，之後跳轉都落在 0、按播放從頭播

/** 跳轉等待暫停的上限（毫秒），超過就直接暫停 */
const PAUSE_AFTER_SEEK_MAX_MS = 1000;

const pendingPause = new WeakMap<object, () => void>();

/** 取消還在等跳轉完成的暫停（開始新的播放前呼叫；seekSegmentStart 會自動呼叫，Codex） */
export function cancelPendingPause(media: object): void {
    pendingPause.get(media)?.();
    pendingPause.delete(media);
}

/** 暫停；正在跳轉時等跳轉完成才暫停（最多等 1 秒）。之後若開始新的播放（seekSegmentStart）就取消 */
export function pauseSafely(media: GuardMedia): void {
    cancelPendingPause(media);
    if (media.paused) return;
    if (!media.seeking) { media.pause(); return; }
    let done = false;
    const cancel = () => {
        if (done) return;
        done = true;
        media.removeEventListener('seeked', go);
        clearTimeout(timer);
        if (pendingPause.get(media) === cancel) pendingPause.delete(media);
    };
    const go = () => {
        if (done) return;
        cancel();
        if (!media.paused) media.pause();
    };
    const timer = setTimeout(go, PAUSE_AFTER_SEEK_MAX_MS);
    media.addEventListener('seeked', go);
    pendingPause.set(media, cancel);
}

/** 播放器已處於「已播完」：重新載入（之後設定的起點會在載入後套用）。回傳是否重新載入 */
export function recoverIfEnded(media: GuardMedia): boolean {
    if (!media.ended || typeof media.load !== 'function') return false;
    media.load();
    return true;
}
