// 共用麥克風與「麥克風真的開始收音」的判斷
// 規劃：docs/plans/mic-warmup.md
// 背景：iPhone 開麥克風後有一段暖機時間，MediaRecorder 的 start 事件不代表已收到聲音，
// 暖機期間錄到的是數位零，使用者開頭的字會被吃掉

import { useEffect, useRef } from 'react';

/**
 * true：同一個練習頁只開一次麥克風，換句、重錄沿用，離開頁面才關（擁有者 2026-11-06 決定）
 * iPhone 實測若麥克風開著時播放變小聲／改從聽筒出聲，改成 false：每次錄完就關、下次重開（擁有者已同意的備案）
 */
export const KEEP_MIC_OPEN = true;

export interface MicHandle {
    stream: MediaStream;
    ctx: AudioContext;
    analyser: AnalyserNode;
}

export class MicReleasedError extends Error {
    constructor() {
        super('麥克風已釋放');
        this.name = 'MicReleasedError';
    }
}

export interface MicSessionDeps {
    getUserMedia: () => Promise<MediaStream>;
    createAudioContext: () => AudioContext;
}

const usable = (h: MicHandle | null): h is MicHandle =>
    !!h && h.ctx.state !== 'closed'
    && h.stream.getAudioTracks().some(t => t.readyState === 'live' && t.enabled && !t.muted);

const stopStream = (stream: MediaStream) => {
    stream.getTracks().forEach(t => { try { t.stop(); } catch { /* 忽略 */ } });
};

export function createMicSession(deps: MicSessionDeps) {
    let current: MicHandle | null = null;
    let pending: Promise<MicHandle> | null = null;
    let generation = 0;   // release() 時遞增，讓進行中的取得請求作廢

    const dispose = (h: MicHandle) => {
        stopStream(h.stream);
        try { h.analyser.disconnect(); } catch { /* 忽略 */ }
        h.ctx.close().catch(() => { /* 忽略 */ });
    };

    const acquire = (): Promise<MicHandle> => {
        if (usable(current)) return Promise.resolve(current);
        if (pending) return pending;
        if (current) {
            dispose(current);   // 軌道已結束（切到背景、被系統中斷）→ 重新取得
            current = null;
        }
        const mine = generation;
        pending = (async () => {
            try {
                const stream = await deps.getUserMedia();
                if (mine !== generation) {
                    stopStream(stream);
                    throw new MicReleasedError();
                }
                let ctx: AudioContext | null = null;
                try {
                    ctx = deps.createAudioContext();
                    const source = ctx.createMediaStreamSource(stream);
                    const analyser = ctx.createAnalyser();
                    analyser.fftSize = 256;
                    source.connect(analyser);   // 只接 Analyser，不接喇叭
                    current = { stream, ctx, analyser };
                    return current;
                } catch (err) {
                    // 音訊分析初始化失敗：已取得的麥克風與 AudioContext 要釋放，否則離開頁面後麥克風仍開著（Codex）
                    stopStream(stream);
                    ctx?.close().catch(() => { /* 忽略 */ });
                    throw err;
                }
            } finally {
                if (mine === generation) pending = null;
            }
        })();
        return pending;
    };

    const release = () => {
        generation++;
        pending = null;
        if (current) {
            dispose(current);
            current = null;
        }
    };

    /** 點擊當下（任何 await 之前）呼叫：iPhone 只在使用者手勢內允許喚醒 AudioContext */
    const resume = () => {
        if (current && current.ctx.state !== 'running' && current.ctx.state !== 'closed') {
            current.ctx.resume().catch(() => { /* 忽略 */ });
        }
    };

    return { acquire, release, resume, peek: () => current };
}

export type MicSession = ReturnType<typeof createMicSession>;

export interface MicSample {
    /** RMS 音量（dBFS） */
    db: number;
    /** AudioContext 狀態：不是 running 時 Analyser 會一直回傳同一份舊資料 */
    state: string;
    /** AudioContext 的時間（秒）：沒有前進＝沒有新的音訊資料 */
    audioTime: number;
}

/** 讀取目前麥克風的音量（用 float 資料；byte 資料的解析度分不出 -80 dB） */
export function sampleMic(h: MicHandle, buf?: Float32Array): MicSample {
    const data = buf && buf.length === h.analyser.fftSize ? buf : new Float32Array(h.analyser.fftSize);
    h.analyser.getFloatTimeDomainData(data);
    let sum = 0;
    for (let i = 0; i < data.length; i++) sum += data[i] * data[i];
    const rms = Math.sqrt(sum / Math.max(1, data.length));
    return { db: 20 * Math.log10(rms + 1e-12), state: h.ctx.state, audioTime: h.ctx.currentTime };
}

/**
 * 等麥克風真的開始收音：AudioContext 在 running、有新的資料、音量高於門檻，以音訊時間累積滿 stableMs 才算。
 * 暫停、舊資料、低於門檻都會把累積歸零。逾時回傳 'timeout'（呼叫端照常開始，擁有者決定）。
 */
export async function waitForMicLive(opts: {
    sample: () => MicSample;
    floorDb?: number;
    stableMs?: number;
    timeoutMs?: number;
    pollMs?: number;
    now?: () => number;
    sleep?: (ms: number) => Promise<void>;
    isCancelled: () => boolean;
}): Promise<'live' | 'timeout' | 'cancelled'> {
    const {
        sample, floorDb = -80, stableMs = 60, timeoutMs = 1500, pollMs = 20, isCancelled,
        now = () => performance.now(),
        sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms)),
    } = opts;
    const startedAt = now();
    let lastAudioTime: number | null = null;
    let liveSince: number | null = null;   // 音訊時間（秒）
    for (;;) {
        if (isCancelled()) return 'cancelled';
        const s = sample();
        const fresh = s.state === 'running' && lastAudioTime !== null && s.audioTime > lastAudioTime;
        if (fresh && s.db > floorDb) {
            if (liveSince === null) liveSince = s.audioTime;
            if ((s.audioTime - liveSince) * 1000 >= stableMs) return 'live';
        } else if (!fresh || s.db <= floorDb) {
            liveSince = null;
        }
        lastAudioTime = s.state === 'running' ? s.audioTime : null;
        if (now() - startedAt >= timeoutMs) return 'timeout';
        await sleep(pollMs);
    }
}

/** 練習畫面用：掛載時就預先打開麥克風暖機（擁有者決定），卸載時釋放 */
export function useMicSession(label: string): MicSession {
    const ref = useRef<MicSession | null>(null);
    if (!ref.current) {
        ref.current = createMicSession({
            getUserMedia: () => navigator.mediaDevices.getUserMedia({ audio: true, video: false }),
            createAudioContext: () => {
                const Ctx = window.AudioContext || (window as any).webkitAudioContext;
                return new Ctx();
            },
        });
    }
    useEffect(() => {
        const mic = ref.current as MicSession;
        mic.acquire().catch(err => {
            if (!(err instanceof MicReleasedError)) console.warn(`[${label}] 預先開啟麥克風失敗，按開始時再試:`, err);
        });
        return () => mic.release();
    }, [label]);
    return ref.current;
}

/** 取樣函式（重用同一個緩衝區） */
export function micSampler(h: MicHandle): () => MicSample {
    const buf = new Float32Array(h.analyser.fftSize);
    return () => sampleMic(h, buf);
}

/** 診斷：記錄「按下 → 收音確認」的毫秒數與結果（不記音訊內容） */
export function logMicLive(label: string, result: 'live' | 'timeout' | 'cancelled', startedAt: number) {
    if (result !== 'cancelled') console.log(`[${label}] 麥克風收音確認：${result} ${Math.round(performance.now() - startedAt)}ms`);
}
