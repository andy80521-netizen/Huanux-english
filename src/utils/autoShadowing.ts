// 自動跟讀（連續一句接一句）的流程控制：純邏輯，元件只負責把事件送進來、執行回呼
// 規劃：docs/plans/auto-shadowing.md（擁有者 2026-11-13 核准）
// 重點（Codex）：每次開始／停止都換世代，所有計時器與非同步回報帶世代；每次作答最多前進一次；換句完成才開始下一句

export const AUTO_COUNTDOWN_SEC = 5;
/** 連續幾句沒有聲音就停止 */
export const AUTO_SILENT_STOP = 2;
/** 錄音期間「有聲音」累計不到這麼久（毫秒）＝沒有聲音 */
export const SILENT_VOICED_MS = 300;
const MASTERED = 1000;

export interface AutoSentence { id: string; deleted?: boolean; mastery?: number }

/** 自動模式要練的句子：沒刪除、還沒精熟（擁有者：已精熟自動略過） */
export const isAutoTarget = (s: AutoSentence | undefined) => !!s && !s.deleted && !(Number(s.mastery) >= MASTERED);

/** 從 from（含）往後第一句要練的；沒有回傳 -1 */
export function firstAutoIndex(list: AutoSentence[], from: number): number {
    for (let i = Math.max(0, from); i < list.length; i++) if (isAutoTarget(list[i])) return i;
    return -1;
}

/** from 之後（不含）第一句要練的；沒有回傳 -1 */
export const nextAutoIndex = (list: AutoSentence[], from: number) => firstAutoIndex(list, from + 1);

export type AutoStopReason = 'user' | 'end' | 'silent' | 'hidden' | 'navigate' | 'mic' | 'prepare' | 'scoreError' | 'none-left';
export type AutoPhase = 'off' | 'waiting' | 'practicing' | 'reviewing' | 'countdown';

export interface AutoSummary {
    /** 有結果的句子（評分存檔成功＋沒有聲音） */
    practiced: number;
    passed: number;
    silent: number;
    /** 熟練度有增加的句數 */
    gained: number;
    /** 有評分句子的平均總分（四捨五入；沒有時為 null） */
    average: number | null;
    failed: Array<{ index: number; id: string; total: number }>;
    /** 停止時還在評分中的句數 */
    pending: number;
}

export interface AutoView {
    active: boolean;
    phase: AutoPhase;
    countdown: number;
    stopReason: AutoStopReason | null;
    summary: AutoSummary;
}

export interface AutoDeps {
    getSentences: () => AutoSentence[];
    /** 自動換到第 index 句（元件呼叫 onJump） */
    goTo: (index: number) => void;
    /** 開始這一句（元件呼叫 handleStart） */
    start: (id: string) => void;
    onChange: (view: AutoView) => void;
}

export function createAutoSession(deps: AutoDeps) {
    let active = false;
    let phase: AutoPhase = 'off';
    let generation = 0;
    let session = 0;
    let attemptSeq = 0;
    let pendingId: string | null = null;
    let current: { key: string; id: string; index: number } | null = null;
    let advancedFor: string | null = null;
    let countdown = 0;
    let timer: ReturnType<typeof setInterval> | null = null;
    let silentStreak = 0;
    let stopReason: AutoStopReason | null = null;
    // 摘要
    let totals: number[] = [];
    let passed = 0;
    let silent = 0;
    let gained = 0;
    let failed: AutoSummary['failed'] = [];
    const counted = new Set<string>();
    const pending = new Set<string>();
    const attemptInfo = new Map<string, { id: string; index: number; session: number }>();

    const clearTimer = () => { if (timer !== null) { clearInterval(timer); timer = null; } };
    const summary = (): AutoSummary => ({
        practiced: totals.length + silent,
        passed,
        silent,
        gained,
        average: totals.length ? Math.round(totals.reduce((a, b) => a + b, 0) / totals.length) : null,
        failed: [...failed],
        pending: pending.size,
    });
    const emit = () => deps.onChange({ active, phase, countdown, stopReason, summary: summary() });

    const finish = (reason: AutoStopReason) => {
        generation += 1;
        clearTimer();
        active = false;
        phase = 'off';
        pendingId = null;
        countdown = 0;
        stopReason = reason;
        emit();
    };

    const isCurrent = (key: string) => active && current !== null && current.key === key;

    const advance = () => {
        if (!active || !current || advancedFor === current.key) return;
        if (phase !== 'reviewing' && phase !== 'countdown') return;
        advancedFor = current.key;
        clearTimer();
        const list = deps.getSentences();
        const idx = list.findIndex(s => s.id === current!.id);
        const next = nextAutoIndex(list, idx >= 0 ? idx : current.index);
        if (next < 0) { finish('end'); return; }
        pendingId = list[next].id;
        phase = 'waiting';
        countdown = 0;
        emit();
        deps.goTo(next);
    };

    const startCountdown = () => {
        clearTimer();
        phase = 'countdown';
        countdown = AUTO_COUNTDOWN_SEC;
        const gen = generation;
        const key = current?.key;
        emit();
        timer = setInterval(() => {
            if (gen !== generation || !current || current.key !== key) { clearTimer(); return; }
            countdown -= 1;
            if (countdown <= 0) { advance(); return; }
            emit();
        }, 1000);
    };

    return {
        /** 按「自動跟讀」：回傳 startNow＝目前這句就要練（元件在同一次點擊裡開始） */
        begin(currentIndex: number): { startNow: boolean } {
            generation += 1;
            session += 1;
            clearTimer();
            totals = []; passed = 0; silent = 0; gained = 0; failed = [];
            counted.clear(); pending.clear(); attemptInfo.clear();
            silentStreak = 0;
            stopReason = null;
            current = null;
            advancedFor = null;
            const list = deps.getSentences();
            const idx = firstAutoIndex(list, currentIndex);
            if (idx < 0) {
                active = true;   // 讓 finish 正常收尾
                finish('none-left');
                return { startNow: false };
            }
            active = true;
            phase = 'waiting';
            pendingId = list[idx].id;
            emit();
            if (idx === currentIndex) return { startNow: true };
            deps.goTo(idx);
            return { startNow: false };
        },

        /** 換句（元件的換句 effect）：不是自動流程要去的句子 → 使用者自己換句，結束 */
        sentenceChanged(id: string) {
            if (!active) return;
            if (pendingId === id) return;
            if (current && current.id === id && phase === 'practicing') return;
            finish('navigate');
        },

        /** 這一句重設完成、回到 idle：是等待中的句子就開始（每句只開始一次） */
        sentenceReady(id: string) {
            if (!active || phase !== 'waiting' || pendingId !== id) return;
            pendingId = null;
            const list = deps.getSentences();
            attemptSeq += 1;
            const key = `${session}:${attemptSeq}`;
            current = { key, id, index: list.findIndex(s => s.id === id) };
            attemptInfo.set(key, { id, index: current.index, session });
            advancedFor = null;
            phase = 'practicing';
            emit();
            deps.start(id);
        },

        /** 目前作答的編號（錄音開始時記下，評分回報時帶回來）；不是自動模式回傳 null */
        currentAttempt(): string | null {
            return active && current && phase === 'practicing' ? current.key : null;
        },

        /** 錄音結束、送出評分 */
        attemptSubmitted(key: string | null) {
            if (!key || counted.has(key)) return;
            pending.add(key);
            if (isCurrent(key)) { phase = 'reviewing'; }
            emit();
        },

        /** 評分存檔成功（唯一計入摘要的時點；重試只算一次） */
        attemptScored(key: string | null, r: { passed: boolean; total: number; gained: number }) {
            if (!key) return;
            const info = attemptInfo.get(key);
            if (!info || info.session !== session) return;
            pending.delete(key);
            if (!counted.has(key)) {
                counted.add(key);
                totals.push(r.total);
                if (r.passed) passed += 1; else failed.push({ index: info.index, id: info.id, total: r.total });
                if (r.gained > 0) gained += 1;
            }
            if (isCurrent(key)) {
                silentStreak = 0;
                if (phase === 'practicing') phase = 'reviewing';
            }
            emit();
        },

        /** 評分失敗：不計入；目前這句 → 停止 */
        attemptFailed(key: string | null) {
            if (!key) return;
            pending.delete(key);
            if (isCurrent(key)) { finish('scoreError'); return; }
            emit();
        },

        /** 沒有聲音：不送評分，直接倒數；連續 AUTO_SILENT_STOP 句就停止 */
        attemptSilent(key: string | null) {
            if (!key || !isCurrent(key) || counted.has(key)) return;
            counted.add(key);
            silent += 1;
            silentStreak += 1;
            if (silentStreak >= AUTO_SILENT_STOP) { finish('silent'); return; }
            phase = 'reviewing';
            startCountdown();
        },

        /** 自己的錄音播完（或播放被擋、保險時間到）→ 開始倒數 */
        playbackDone(key: string | null) {
            if (!key || !isCurrent(key) || phase !== 'reviewing' || advancedFor === key) return;
            startCountdown();
        },

        /** 「立即下一句」 */
        skipNow() { advance(); },

        stop(reason: AutoStopReason = 'user') {
            if (!active) return;
            finish(reason);
        },

        isActive: () => active,
        phase: () => phase,
        view: (): AutoView => ({ active, phase, countdown, stopReason, summary: summary() }),
        /** 收起摘要 */
        clearResult() { stopReason = null; emit(); },
    };
}

export type AutoSession = ReturnType<typeof createAutoSession>;
