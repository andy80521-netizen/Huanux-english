// 播放診斷紀錄（暫時功能，問題解決後拿掉；擁有者 2026-11-10）
// 規劃：docs/plans/shadowing-stable-playback.md
// 記錄原音元素的媒體事件與程式自己的動作（設定位置、播放、暫停、就位結果），讓擁有者在 iPhone 上複製貼回，找出真正原因

export interface TraceMedia {
    currentTime: number;
    readyState?: number;
    seeking?: boolean;
    paused?: boolean;
    playbackRate?: number;
    src?: string;
    currentSrc?: string;
    addEventListener(type: string, fn: () => void): void;
    removeEventListener(type: string, fn: () => void): void;
}

export interface PlaybackTrace {
    /** 記下程式自己的動作 */
    mark(label: string): void;
    /** 輸出文字（第一行是環境資訊） */
    text(): string;
    dispose(): void;
}

const EVENTS = [
    'loadstart', 'loadedmetadata', 'loadeddata', 'canplay', 'canplaythrough', 'play', 'playing', 'pause',
    'seeking', 'seeked', 'waiting', 'stalled', 'suspend', 'emptied', 'ended', 'error', 'ratechange', 'timeupdate',
];

export function createPlaybackTrace(media: TraceMedia, opts: { limit?: number; now?: () => number } = {}): PlaybackTrace {
    const limit = opts.limit ?? 300;
    const now = opts.now ?? (() => (typeof performance !== 'undefined' ? performance.now() : Date.now()));
    const t0 = now();
    const lines: string[] = [];
    let lastTimeupdate = -Infinity;

    const state = () => {
        const src = media.currentSrc || media.src || '';
        const frag = src.includes('#') ? ` src#${src.split('#')[1]}` : '';
        return `ct=${Number(media.currentTime).toFixed(2)} rs=${media.readyState ?? '?'} seek=${media.seeking ? 1 : 0} paused=${media.paused ? 1 : 0} rate=${media.playbackRate ?? 1}${frag}`;
    };
    const push = (what: string) => {
        lines.push(`${((now() - t0) / 1000).toFixed(3)} ${what} ${state()}`);
        if (lines.length > limit) lines.splice(0, lines.length - limit);
    };

    const handlers = EVENTS.map((type) => {
        const fn = () => {
            // timeupdate 很頻繁：最多每 0.2 秒記一筆（其他事件全記）
            if (type === 'timeupdate') {
                const t = now();
                if (t - lastTimeupdate < 200) return;
                lastTimeupdate = t;
            }
            push(type);
        };
        media.addEventListener(type, fn);
        return [type, fn] as const;
    });

    return {
        mark: (label) => push(`▶ ${label}`),
        text: () => {
            const ua = typeof navigator !== 'undefined' ? navigator.userAgent : 'unknown';
            return [`裝置：${ua}`, ...lines].join('\n');
        },
        dispose: () => { handlers.forEach(([type, fn]) => media.removeEventListener(type, fn)); },
    };
}
