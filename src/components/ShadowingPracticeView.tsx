import React, { useState, useRef, useEffect } from 'react';
import { Material, MaterialSentence } from '../types';
import { ChevronLeft, Mic, AlertCircle, RotateCcw, Send, Loader2, Headphones, Check, Play, Pause, Layers, Volume1, Repeat, Square, SkipForward } from 'lucide-react';
import { transcribeRecordingDetailed } from '../services/gemini';
import { transcriberLabel } from '../utils/transcriber';
import { playAfterRecordingStarts } from '../utils/recordingTiming';
import { useMicSession, waitForMicLive, micSampler, logMicLive, MicReleasedError, KEEP_MIC_OPEN } from '../utils/micSession';
import { calculateShadowingScores, isShadowingPass, PracticeScores, SHADOWING_PASS_CONTENT, SHADOWING_PASS_TOTAL } from '../utils/scoring';
import WordDiffView from './WordDiffView';
import SentenceAnalysisPanel from './SentenceAnalysisPanel';
import { getSupportedMimeType } from '../utils/mediaRecorder';
import { auth, db, appId } from '../firebase';
import { doc, runTransaction } from 'firebase/firestore';
import { SILENT_AUDIO } from '../utils';
import { recordActiveSighting } from '../services/sightings';
import { nextShadowingMastery } from '../utils/shadowingMastery';
import { MASTERY_MAX } from '../utils/materialProgress';
import { countUpValue } from '../utils/countUp';
import Button from './ui/Button';
import IconButton from './ui/IconButton';
import ProgressBar from './ui/ProgressBar';
import { PLAYBACK_LEAD_MS, RECORDING_ORIGINAL_VOLUME, canSetElementVolume, overlayOffsetMs, sentenceSegment, shouldShowHeadphoneTip, dismissHeadphoneTip } from '../utils/shadowingAudio';
import { createListenPlayer, ListenMode, ListenPlayer } from '../utils/shadowingPlayback';
import { SHADOWING_SPEEDS, ShadowingSpeed, ShadowingAttempt, loadSpeed, saveSpeed, applyPlaybackSpeed, effectiveOriginalSec, scoreShadowingAttempt } from '../utils/shadowingSpeed';
import SegmentedControl from './ui/SegmentedControl';
import { watchSegmentEnd, seekSegmentStart, guardSegmentStart, prepareSegmentStart, pauseSafely, PREPARE_TIMEOUT_MS } from '../utils/segmentEnd';
import { createPlaybackTrace, PlaybackTrace } from '../utils/playbackTrace';
import { formatPlayRange } from '../utils/timeEdit';
import { createAutoSession, AutoSession, AutoView, AutoStopReason, AutoSummary, SILENT_VOICED_MS } from '../utils/autoShadowing';

/** 按下跟讀的靜音解鎖播放最多等幾毫秒，之後一律暫停、拉回起點（docs/plans/shadowing-stable-playback.md） */
const UNLOCK_WAIT_MS = 1500;

/** 系統是否開啟「減少動態效果」（分數跑動是 JS，全域 CSS 規則管不到，要自己判斷） */
const prefersReducedMotion = () => {
    try { return !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
};

/**
 * 這台裝置能不能調原音音量（iPhone／iPad 的 audio.volume 唯讀）。只在暫時元素上偵測一次並快取。
 * 本 PR 不走 Web Audio（Storage 尚未設定 CORS），不能調的裝置維持原本音量、改提示戴耳機。
 */
let volumeAdjustable: boolean | null = null;
const canAdjustVolume = () => {
    if (volumeAdjustable === null) {
        try { volumeAdjustable = canSetElementVolume(typeof Audio !== 'undefined' ? new Audio() : null); } catch { volumeAdjustable = false; }
    }
    return volumeAdjustable;
};

const getStorage = () => window.localStorage;

/** 結果頁「聽聽看」的裝飾波形高度（px） */
const WAVE = [6, 10, 16, 22, 14, 8, 18, 24, 20, 12, 6, 9, 15, 21, 17, 11, 7, 13, 19, 23, 16, 10];

const LISTEN_BUTTONS: Array<{ mode: ListenMode; label: string; ariaLabel?: string }> = [
    { mode: 'mine', label: '我的錄音', ariaLabel: '重播我的錄音' },
    { mode: 'original', label: '原音' },
    { mode: 'overlay', label: '重疊播放' },
];

/** 第一次開始跟讀前的耳機提醒（底部彈出）。「開始跟讀」在同一次點擊裡同步開始錄音，iPhone 才不會擋 */
const HeadphoneTip: React.FC<{ onStart: (dontShowAgain: boolean) => void; onCancel: () => void }> = ({ onStart, onCancel }) => {
    const [dontShow, setDontShow] = useState(false);
    const startRef = useRef<HTMLButtonElement>(null);
    const onCancelRef = useRef(onCancel);
    onCancelRef.current = onCancel;
    useEffect(() => {
        startRef.current?.focus();
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancelRef.current(); };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, []);
    return (
        <div className="fixed inset-0 z-100 flex items-end justify-center bg-black/40 backdrop-blur-xs sm:items-center sm:p-4" onClick={onCancel}>
            <div
                role="dialog"
                aria-modal="true"
                aria-labelledby="headphone-tip-h"
                onClick={(e) => e.stopPropagation()}
                className="flex w-full max-w-md flex-col gap-4 rounded-t-[28px] border border-line bg-surface px-6 pt-7 pb-[max(2rem,env(safe-area-inset-bottom))] shadow-[0_24px_48px_-12px_rgb(0_0_0/0.25)] animate-rise-in sm:rounded-3xl sm:pb-7"
            >
                <span className="flex size-14 items-center justify-center rounded-full bg-accent-soft" aria-hidden="true">
                    <Headphones size={26} className="text-accent" />
                </span>
                <h2 id="headphone-tip-h" className="text-xl font-bold text-ink">建議戴有線耳機練習</h2>
                <p className="text-sm leading-relaxed text-muted">跟讀時會同時播放原音和錄你的聲音。沒戴耳機時，原音會被麥克風收進去，你的聲音容易被壓掉，辨識變差、分數偏低。</p>
                <p className="text-sm leading-relaxed text-muted">藍牙耳機在錄音時音質會變差，有線耳機效果最好。沒有耳機也可以練，{canAdjustVolume() ? '錄音時原音會自動調小聲。' : '但這台裝置無法自動調小原音。'}</p>
                <label className="flex min-h-11 cursor-pointer items-center gap-2.5 text-sm text-ink">
                    <input type="checkbox" checked={dontShow} onChange={(e) => setDontShow(e.target.checked)} className="size-5 accent-[var(--accent)]" />
                    不再提醒
                </label>
                <Button ref={startRef} size="lg" fullWidth onClick={() => onStart(dontShow)} icon={<Mic size={20} aria-hidden="true" />}>
                    開始跟讀
                </Button>
                <Button variant="ghost" fullWidth onClick={onCancel} className="text-muted">取消</Button>
            </div>
        </div>
    );
};

const AUTO_STOP_TEXT: Partial<Record<AutoStopReason, string>> = {
    end: '已經跟讀到最後一句',
    user: '已停止自動跟讀',
    silent: '連續 2 句沒有偵測到聲音，自動跟讀已停止',
    hidden: '畫面被關閉或切到其他 App，自動跟讀已停止',
    prepare: '原音播放失敗，自動跟讀已停止',
    scoreError: '評分失敗，自動跟讀已停止。可以按「重試評分」',
};

/** 自動跟讀結果（結束時顯示）；沒通過的句子可以點過去重練 */
const AutoShadowingSummary: React.FC<{
    reason: AutoStopReason;
    summary: AutoSummary;
    sentences: MaterialSentence[];
    positionOf: (index: number) => number;
    onJump?: (index: number) => void;
    onClose: () => void;
}> = ({ reason, summary, sentences, positionOf, onJump, onClose }) => {
    const closeRef = useRef<HTMLButtonElement>(null);
    const onCloseRef = useRef(onClose);
    onCloseRef.current = onClose;
    useEffect(() => {
        closeRef.current?.focus();
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onCloseRef.current(); };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, []);
    const stats: Array<[string, string]> = [
        ['練習', `${summary.practiced} 句`],
        ['通過', `${summary.passed} 句`],
        ['平均總分', summary.average === null ? '—' : `${summary.average} 分`],
        ['熟練度增加', `${summary.gained} 句`],
    ];
    return (
        <div className="fixed inset-0 z-100 flex items-end justify-center bg-black/40 backdrop-blur-xs sm:items-center sm:p-4" onClick={onClose}>
            <div
                role="dialog"
                aria-modal="true"
                aria-labelledby="auto-summary-h"
                onClick={(e) => e.stopPropagation()}
                className="flex max-h-[85vh] w-full max-w-md flex-col gap-4 overflow-y-auto rounded-t-[28px] border border-line bg-surface px-6 pt-7 pb-[max(2rem,env(safe-area-inset-bottom))] shadow-[0_24px_48px_-12px_rgb(0_0_0/0.25)] animate-rise-in sm:rounded-3xl sm:pb-7"
            >
                <h2 id="auto-summary-h" className="text-xl font-bold text-ink">自動跟讀結果</h2>
                {AUTO_STOP_TEXT[reason] && <p className="text-sm text-muted">{AUTO_STOP_TEXT[reason]}</p>}
                <dl className="grid grid-cols-2 gap-3">
                    {stats.map(([k, v]) => (
                        <div key={k} className="rounded-2xl bg-surface-2 px-4 py-3">
                            <dt className="text-xs text-muted">{k}</dt>
                            <dd className="mt-1 font-reading text-xl tabular-nums text-ink">{v}</dd>
                        </div>
                    ))}
                </dl>
                {summary.silent > 0 && <p className="text-sm text-muted">沒有偵測到聲音：{summary.silent} 句（沒有評分）</p>}
                {summary.pending > 0 && (
                    <p role="status" className="flex items-center gap-2 text-sm text-muted">
                        <Loader2 size={16} className="animate-spin" aria-hidden="true" />評分中…（{summary.pending} 句）
                    </p>
                )}
                {summary.failed.length > 0 && (
                    <div className="flex flex-col gap-2">
                        <p className="text-sm font-medium text-ink">沒通過的句子</p>
                        <ul className="flex flex-col gap-1.5">
                            {summary.failed.map(f => {
                                const s = sentences[f.index];
                                const label = `第 ${positionOf(f.index)} 句・${f.total} 分`;
                                return (
                                    <li key={f.id}>
                                        {onJump && s && !s.deleted ? (
                                            <button
                                                type="button"
                                                onClick={() => { onClose(); onJump(f.index); }}
                                                className="flex min-h-11 w-full flex-col items-start rounded-xl border border-line px-3 py-2 text-left hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-accent"
                                            >
                                                <span className="text-xs text-muted">{label}</span>
                                                <span lang="en" className="line-clamp-1 text-sm text-ink">{s.text}</span>
                                            </button>
                                        ) : (
                                            <span className="text-sm text-muted">{label}</span>
                                        )}
                                    </li>
                                );
                            })}
                        </ul>
                    </div>
                )}
                <Button ref={closeRef} size="lg" fullWidth onClick={onClose}>知道了</Button>
            </div>
        </div>
    );
};

/** silent：自動跟讀中整段錄音沒有聲音（不送評分，docs/plans/auto-shadowing.md） */
type PracticeState = 'idle' | 'recording' | 'buffer' | 'finished' | 'scoring' | 'scored' | 'scoreError' | 'silent';

interface ShadowingPracticeViewProps {
    material: Material;
    sentenceIndex: number;
    onBack: () => void;
    onNext: () => void;
    /** 桌機右側句子列表：跳到指定句子（index 是 material.sentences 的實際位置） */
    onJump?: (index: number) => void;
    isLastSentence: boolean;
    sightingPatternIds?: string[];
}

export default function ShadowingPracticeView({ material, sentenceIndex, onBack, onNext, onJump, isLastSentence, sightingPatternIds }: ShadowingPracticeViewProps) {
    const sentence = material.sentences[sentenceIndex];
    // 標題的「第幾句／總句數」只計算未刪除的句子
    const activeIndices = material.sentences.map((s, i) => (s.deleted ? -1 : i)).filter(i => i >= 0);
    const displayPosition = activeIndices.indexOf(sentenceIndex) + 1;
    
    const [practiceState, setPracticeState] = useState<PracticeState>('idle');
    // 共用麥克風：進頁面就暖機，離開頁面才關（docs/plans/mic-warmup.md）
    const mic = useMicSession('影子跟讀');
    const [micPreparing, setMicPreparing] = useState(false);   // 按下開始 → 原音開始播之間
    const startingRef = useRef(false);                         // 防連按
    const [error, setError] = useState<string | null>(null);
    const [bufferCount, setBufferCount] = useState(6);
    const [recordedBlobUrl, setRecordedBlobUrl] = useState<string | null>(null);
    const [scoreResult, setScoreResult] = useState<PracticeScores | null>(null);
    const [userText, setUserText] = useState<string>('');
    // 這次由哪個模型轉錄（結果頁小字顯示，診斷用）
    const [transcriber, setTranscriber] = useState('');
    const mainScrollRef = useRef<HTMLDivElement>(null);
    const [userSpeechSec, setUserSpeechSec] = useState<number>(0);
    // 這次評分的熟練度變化：評分當下算一次，寫入與畫面共用（不在資料庫更新回來後重算）
    const [masteryResult, setMasteryResult] = useState<{ before: number; after: number; gain: number } | null>(null);
    // 結果頁動效：總分跑動中的數字、金色增加段是否已補上
    const [displayTotal, setDisplayTotal] = useState(0);
    const [showGain, setShowGain] = useState(false);
    // 每次換句或離開就加一；評分回來時若已換句，不再更新畫面
    const scoringTokenRef = useRef(0);
    // 跟讀辨識改善（PR #20）：耳機提醒、結果頁「聽聽看」
    const [showTip, setShowTip] = useState(false);
    const [listenMode, setListenMode] = useState<ListenMode | null>(null);
    const playerRef = useRef<ListenPlayer | null>(null);
    // 重疊播放對齊用：錄音實際開始（MediaRecorder start）與原音實際開始（playing）的時間
    const recordStartAtRef = useRef<number | null>(null);
    const originalPlayingAtRef = useRef<number | null>(null);
    const sentenceRef = useRef(sentence);
    sentenceRef.current = sentence;
    const listItemRefs = useRef<Record<number, HTMLButtonElement | null>>({});
    
    const recordingStartTimeRef = useRef<number>(0);
    const lastSoundTimeRef = useRef<number>(0);
    const silenceTimerRef = useRef<number>(0);
    const isBufferPhaseRef = useRef<boolean>(false);
    /** 原音準時停在句尾的監看（docs/plans/import-timestamp-accuracy.md PR-A）；回傳值是取消函式 */
    const endWatchRef = useRef<(() => void) | null>(null);
    /** 確認原音真的從句子開頭播（iPhone 長教材會跳不過去，docs/plans/ios-seek-fix.md）；回傳值是取消函式 */
    const startGuardRef = useRef<(() => void) | null>(null);
    /** 播放診斷紀錄（暫時功能，問題解決後拿掉；擁有者 2026-11-10） */
    const traceRef = useRef<PlaybackTrace | null>(null);
    /** 原音播放器已解鎖（iPhone 每個播放器只需在點擊當下播放過一次）：之後不再做靜音解鎖播放（docs/plans/ios-ended-fix.md） */
    const unlockedRef = useRef(false);
    const trace = (msg: string) => traceRef.current?.mark(msg);
    const [traceCopied, setTraceCopied] = useState<string | null>(null);
    const [traceFallback, setTraceFallback] = useState<string | null>(null);
    
    const audioRef = useRef<HTMLAudioElement>(null);
    const recordedAudioRef = useRef<HTMLAudioElement>(null);
    const playbackUrlRef = useRef<string | null>(null);
    // 一次錄音的快照（含錄音當下的原音速度）：評分、重試評分、聽聽看都讀它（docs/plans/shadowing-speed.md）
    const lastRecordingRef = useRef<({ blob: Blob; autoKey?: string | null } & ShadowingAttempt) | null>(null);
    // 原音語速：記住設定；每次按開始跟讀時拍下快照
    const [speed, setSpeed] = useState<ShadowingSpeed>(() => loadSpeed(getStorage));
    const recordSpeedRef = useRef<number>(1);
    const mediaRecorderRef = useRef<MediaRecorder | null>(null);
    const analyserRef = useRef<AnalyserNode | null>(null);
    const requestAnimationFrameRef = useRef<number>(0);
    const audioChunksRef = useRef<Blob[]>([]);
    const timerRef = useRef<NodeJS.Timeout | null>(null);

    // ── 自動跟讀（docs/plans/auto-shadowing.md）：流程控制在 utils/autoShadowing.ts，這裡只送事件、執行回呼 ──
    /** 準備中停止用：和 scoringTokenRef 分開，評分中停止時結果照常顯示（Codex） */
    const startCancelRef = useRef(0);
    /** 這次錄音的麥克風中斷監聽（docs/plans/review-fixes-50-51.md #3）；cleanupAudio 移除 */
    const micLostCleanupRef = useRef<(() => void) | null>(null);
    /** 這次錄音「有聲音」累計的毫秒數（判斷沒有聲音） */
    const voicedMsRef = useRef(0);
    const lastFrameAtRef = useRef(0);
    /** 錄音開始到停止的毫秒數（自己的錄音播放保險時間用） */
    const recordedMsRef = useRef(0);
    /** 靜音解鎖播放進行中：點「自動跟讀」與接著的開始共用同一次解鎖，不重複播放 */
    const unlockPendingRef = useRef<{ unlock: Promise<'ok' | 'rejected' | 'skip'>; ended: boolean } | null>(null);
    /** 自己的錄音播完 → 通知自動流程：取消監聽與保險計時 */
    const playbackDoneCleanupRef = useRef<(() => void) | null>(null);
    const startFnRef = useRef<() => void>(() => {});
    const sentencesRef = useRef(material.sentences);
    sentencesRef.current = material.sentences;
    const onJumpRef = useRef(onJump);
    onJumpRef.current = onJump;
    const [autoView, setAutoView] = useState<AutoView | null>(null);
    const [tipForAuto, setTipForAuto] = useState(false);
    const autoRef = useRef<AutoSession | null>(null);
    if (!autoRef.current) {
        autoRef.current = createAutoSession({
            getSentences: () => sentencesRef.current,
            goTo: (index) => onJumpRef.current?.(index),
            start: () => startFnRef.current(),
            onChange: setAutoView,
        });
    }
    const autoActive = !!autoView?.active;
    const clearPlaybackWatch = () => {
        playbackDoneCleanupRef.current?.();
        playbackDoneCleanupRef.current = null;
    };

    /** 設定原音音量；這台裝置不能調（iPhone／iPad）時不做事 */
    const setOriginalVolume = (v: number) => {
        if (!canAdjustVolume() || !audioRef.current) return;
        try { audioRef.current.volume = v; } catch { /* 忽略 */ }
    };
    const restoreOriginalVolume = () => setOriginalVolume(1);

    const cleanupAudio = () => {
        micLostCleanupRef.current?.();
        micLostCleanupRef.current = null;
        isBufferPhaseRef.current = false;
        endWatchRef.current?.();
        endWatchRef.current = null;
        startGuardRef.current?.();
        startGuardRef.current = null;
        if (requestAnimationFrameRef.current) {
            cancelAnimationFrame(requestAnimationFrameRef.current);
            requestAnimationFrameRef.current = 0;
        }
        // 共用麥克風（docs/plans/mic-warmup.md）：只拆掉這次錄音的音量偵測，麥克風留到離開頁面
        analyserRef.current = null;
        if (!KEEP_MIC_OPEN) mic.release();
    };

    const stopRecordingSafely = () => {
        isBufferPhaseRef.current = false;
        if (timerRef.current) {
            clearInterval(timerRef.current);
            timerRef.current = null;
        }
        if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
            mediaRecorderRef.current.stop();
        }
    };

    // 中途放棄錄音：先移除 onstop，避免停止後又把畫面切到「錄音完成」
    const abortRecording = () => {
        if (mediaRecorderRef.current) {
            mediaRecorderRef.current.onstop = null;
        }
        stopRecordingSafely();
        cleanupAudio();
        restoreOriginalVolume();
    };

    // 結果頁「聽聽看」的播放控制器：元件存活期間只建立一次
    useEffect(() => {
        const rec = recordedAudioRef.current;
        const org = audioRef.current;
        if (!rec || !org) return;
        const player = createListenPlayer({
            recording: rec,
            original: org,
            setOriginalVolume,
            segment: () => {
                const s = sentenceRef.current;
                const recSec = Number.isFinite(rec.duration) ? rec.duration : (lastRecordingRef.current?.speechSec ?? 0);
                return sentenceSegment(s.startTime, s.endTime, recSec);
            },
            offsetMs: () => overlayOffsetMs(recordStartAtRef.current, originalPlayingAtRef.current),
            onChange: setListenMode,
            rate: () => lastRecordingRef.current?.speed ?? 1,
            onStartFail: (diag) => setError(`原音沒辦法跳到這一句的開頭，請截圖回報：${diag}`),
        });
        playerRef.current = player;
        return () => {
            player.dispose();
            playerRef.current = null;
        };
    }, []);

    /**
     * 原音每一次開始播放都掛上精準的句尾監看（Codex：只靠 timeupdate 會多播約 0.25 秒）：
     * 錄音中到句尾 → 進入緩衝倒數；其他情況（準備、中止後意外開始播放）只暫停。聽聽看由它自己的監看處理。
     */
    const armEndWatch = () => {
        const a = audioRef.current;
        const s = sentenceRef.current;
        if (!a || endWatchRef.current || !(s.endTime > 0)) return;
        endWatchRef.current = watchSegmentEnd(a, s.endTime, (reason) => {
            endWatchRef.current = null;
            startGuardRef.current?.();
            startGuardRef.current = null;
            trace(`句尾監看結束（${reason}）`);
            if (mediaRecorderRef.current?.state === 'recording') enterBufferPhase();
        });
    };

    // 診斷紀錄與「任何一次開始播放都有句尾監看」：元件存活期間掛在原音元素上
    useEffect(() => {
        const a = audioRef.current;
        if (!a) return;
        const t = createPlaybackTrace(a);
        traceRef.current = t;
        const onPlaying = () => {
            if (playerRef.current?.playing()) return;
            armEndWatch();
        };
        a.addEventListener('playing', onPlaying);
        return () => {
            a.removeEventListener('playing', onPlaying);
            t.dispose();
            traceRef.current = null;
        };
    }, []);   // eslint-disable-line react-hooks/exhaustive-deps

    const copyTrace = async () => {
        const text = traceRef.current?.text() ?? '';
        try {
            await navigator.clipboard.writeText(text);
            setTraceCopied('已複製，請貼給開發者');
            setTraceFallback(null);
        } catch {
            // 不能寫入剪貼簿：顯示文字讓使用者自己長按複製
            setTraceFallback(text);
            setTraceCopied(null);
        }
    };

    // Reset state when sentence changes
    useEffect(() => {
        // 自動跟讀：不是自動流程要去的句子（手動跳句）→ 結束自動模式
        autoRef.current?.sentenceChanged(sentence.id);
        clearPlaybackWatch();
        scoringTokenRef.current += 1;
        playerRef.current?.stop();
        restoreOriginalVolume();
        setShowTip(false);
        // 換句時一併停止教材原音（錄音中跳句時原音還在播放）
        if (audioRef.current) {
            pauseSafely(audioRef.current);   // iPhone：跳轉中暫停會讓播放器壞掉
        }
        if (recordedAudioRef.current) {
            recordedAudioRef.current.pause();
            recordedAudioRef.current.currentTime = 0;
        }
        if (playbackUrlRef.current) {
            URL.revokeObjectURL(playbackUrlRef.current);
            playbackUrlRef.current = null;
        }
        lastRecordingRef.current = null;
        abortRecording();
        setPracticeState('idle');
        setError(null);
        setBufferCount(6);
        if (recordedBlobUrl) {
            URL.revokeObjectURL(recordedBlobUrl);
            setRecordedBlobUrl(null);
        }
        setScoreResult(null);
        setMasteryResult(null);
        setShowGain(false);
        setUserText('');
        setUserSpeechSec(0);
        recordingStartTimeRef.current = 0;
        lastSoundTimeRef.current = 0;
        silenceTimerRef.current = 0;
        audioChunksRef.current = [];
    }, [sentenceIndex]);

    // 自動跟讀：換句重設完成、回到 idle → 等待中的句子開始（每句只開始一次，由 autoShadowing 保證）
    useEffect(() => {
        if (practiceState !== 'idle' || startingRef.current) return;
        autoRef.current?.sentenceReady(sentence.id);
    }, [sentence.id, practiceState]);

    // 自動跟讀：鎖屏、切 App → 結束（各階段都和按停止相同，Codex）；只在自動模式期間監聽（stopAuto 只用 ref，不怕舊閉包）
    useEffect(() => {
        if (!autoActive) return;
        const onVisibility = () => {
            if (document.visibilityState === 'hidden') stopAuto('hidden');
        };
        // iPhone 有時只送 pagehide、不送 visibilitychange（docs/plans/review-fixes-50-51.md #11）
        const onPageHide = () => stopAuto('hidden');
        document.addEventListener('visibilitychange', onVisibility);
        window.addEventListener('pagehide', onPageHide);
        return () => {
            document.removeEventListener('visibilitychange', onVisibility);
            window.removeEventListener('pagehide', onPageHide);
        };
    }, [autoActive]);   // eslint-disable-line react-hooks/exhaustive-deps

    // 離開跟讀畫面 → 結束自動模式、清掉倒數與錄音播放監看
    useEffect(() => () => {
        autoRef.current?.stop('navigate');
        playbackDoneCleanupRef.current?.();
    }, []);

    // 自動跟讀期間不讓螢幕自動鎖定（Screen Wake Lock；不支援的瀏覽器照常使用）
    useEffect(() => {
        if (!autoActive) return;
        let lock: { release: () => Promise<void> } | null = null;
        let done = false;
        const nav = navigator as Navigator & { wakeLock?: { request: (type: 'screen') => Promise<{ release: () => Promise<void> }> } };
        if (nav.wakeLock) {
            nav.wakeLock.request('screen')
                .then((l) => { if (done) l.release().catch(() => {}); else lock = l; })
                .catch(() => { /* 不支援或被拒：不影響功能 */ });
        }
        return () => {
            done = true;
            lock?.release().catch(() => {});
            lock = null;
        };
    }, [autoActive]);

    // 真正離開這個畫面時才遞增（下面那個 effect 會在 recordedBlobUrl 改變時重跑，不能放在那裡，否則每次錄音結束都會被當成已離開）
    useEffect(() => {
        return () => {
            scoringTokenRef.current += 1;
        };
    }, []);

    // Cleanup on unmount
    useEffect(() => {
        return () => {
            if (recordedAudioRef.current) {
                recordedAudioRef.current.pause();
            }
            if (playbackUrlRef.current) {
                URL.revokeObjectURL(playbackUrlRef.current);
                playbackUrlRef.current = null;
            }
            abortRecording();
            restoreOriginalVolume();
            if (recordedBlobUrl) URL.revokeObjectURL(recordedBlobUrl);
        };
    }, [recordedBlobUrl]);

    const monitorVolume = () => {
        if (!analyserRef.current) return;
        
        const analyser = analyserRef.current;
        const bufferLength = analyser.frequencyBinCount;
        const dataArray = new Uint8Array(bufferLength);
        analyser.getByteFrequencyData(dataArray);

        let sum = 0;
        for (let i = 0; i < bufferLength; i++) {
            sum += dataArray[i];
        }
        const averageVolume = sum / bufferLength;
        // 自動跟讀判斷「沒有聲音」：累計有聲音的時間（每格最多算 100ms，避免分頁暫停後一次算太多）
        const frameAt = performance.now();
        const frameMs = lastFrameAtRef.current > 0 ? Math.min(100, frameAt - lastFrameAtRef.current) : 0;
        lastFrameAtRef.current = frameAt;

        if (averageVolume >= 20) {
            voicedMsRef.current += frameMs;
            lastSoundTimeRef.current = Date.now();
            silenceTimerRef.current = 0;
        } else {
            if (isBufferPhaseRef.current) {
                if (silenceTimerRef.current === 0) {
                    silenceTimerRef.current = Date.now();
                } else if (Date.now() - silenceTimerRef.current > 1500) {
                    // Silence detected for 1.5 seconds during buffer phase
                    stopRecordingSafely();
                    return;
                }
            }
        }

        requestAnimationFrameRef.current = requestAnimationFrame(monitorVolume);
    };

    /**
     * iPhone 只允許「使用者點擊當下」啟動播放與喚醒麥克風：一律在任何 await 之前呼叫。
     * 手動「開始跟讀」與「自動跟讀」都用它（自動模式之後的句子沒有點擊，靠這一次解鎖，docs/plans/auto-shadowing.md）。
     * 原音解鎖時「原地」播放，不設定起點：iPhone 在跳轉中被暫停會回到 0 秒並宣告已播完，
     * 之後每次跳轉都落在 0、按播放就從頭播（擁有者 2026-11-10 診斷紀錄，docs/plans/ios-ended-fix.md）。
     * 回傳這次（或進行中）的解鎖；呼叫端結束解鎖時把 ended 設為 true，延遲回來的 play() 就不會再暫停。
     */
    const unlockInGesture = (): { unlock: Promise<'ok' | 'rejected' | 'skip'>; ended: boolean } => {
        if (recordedAudioRef.current) {
            recordedAudioRef.current.src = SILENT_AUDIO;
            recordedAudioRef.current.play().then(() => recordedAudioRef.current?.pause()).catch(() => {});
        }
        mic.resume();
        const org = audioRef.current;
        if (unlockPendingRef.current && !unlockPendingRef.current.ended) return unlockPendingRef.current;
        const state: { unlock: Promise<'ok' | 'rejected' | 'skip'>; ended: boolean } = { unlock: Promise.resolve('skip'), ended: false };
        if (org && !unlockedRef.current) {
            applyPlaybackSpeed(org, speed);   // 語速不是跳轉，可以先套用
            org.muted = true;
            state.unlock = Promise.resolve(org.play()).then(
                () => {
                    unlockedRef.current = true;
                    if (!state.ended && !org.seeking) org.pause();   // 播起來就暫停（不在跳轉中）
                    return 'ok' as const;
                },
                () => 'rejected' as const,
            );
            unlockPendingRef.current = state;
            trace('靜音解鎖 play()（原地，不跳位置）');
        }
        return state;
    };

    const handleStart = async () => {
        if (startingRef.current) {   // 正在準備麥克風時連按：不開第二次
            // 自動模式這一句因此沒有開始 → 停止，不會卡在「練習中」（docs/plans/review-fixes-50-51.md #13）
            if (autoRef.current?.currentAttempt()) stopAuto('prepare');
            return;
        }
        // 自動跟讀的這一次作答（手動為 null）：評分、沒有聲音、錄音播完都帶著它回報
        const autoKey = autoRef.current?.currentAttempt() ?? null;
        // 要看的句子在畫面上半部：開始跟讀時捲回最上方
        mainScrollRef.current?.scrollTo({ top: 0, behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
        recordSpeedRef.current = speed;   // 這次錄音的原音速度快照
        trace(`按下跟讀${autoKey ? '（自動）' : ''}：第 ${displayPosition} 句 ${formatPlayRange(sentence.startTime, sentence.endTime)}，語速 ${speed}`);
        // 原音在錄音開始後才播放：第一次按時在點擊當下靜音解鎖（iPhone 之後才允許播放）
        const gesture = unlockInGesture();
        const unlock = gesture.unlock;

        setError(null);
        setTraceCopied(null);
        setTraceFallback(null);
        cleanupAudio();
        mic.resume();   // iPhone：喚醒 AudioContext 要在點擊當下、任何 await 之前
        startingRef.current = true;
        setMicPreparing(true);
        // 等待麥克風權限期間可能已換句或離開（桌機可點右側句子）：每個 await 之後都檢查，過期就結束，不啟動舊句子的錄音
        // 自動跟讀準備中按停止：startCancelRef 遞增（不動 scoringTokenRef）
        const startToken = scoringTokenRef.current;
        const cancelToken = startCancelRef.current;
        const isStale = () => startToken !== scoringTokenRef.current || cancelToken !== startCancelRef.current;
        const stopStarting = () => {
            startingRef.current = false;
            setMicPreparing(false);
        };
        const pressedAt = performance.now();
        try {
            // 同時等麥克風與解鎖播放（解鎖最多等 UNLOCK_WAIT_MS，避免卡住）
            const [h, unlockResult] = await Promise.all([
                mic.acquire(),
                Promise.race([unlock, new Promise<'slow'>((r) => setTimeout(() => r('slow'), UNLOCK_WAIT_MS))]),
            ]);
            trace(`解鎖結果：${unlockResult}`);
            /** 結束靜音解鎖播放：暫停並取消靜音（這時還沒設定起點，不會在跳轉中暫停） */
            const endUnlock = () => {
                gesture.ended = true;
                if (unlockPendingRef.current === gesture) unlockPendingRef.current = null;
                const el = audioRef.current;
                if (!el) return;
                pauseSafely(el);
                if (!el.seeking) el.muted = false;   // 還在跳轉（極少見）：維持靜音，就位後再處理
            };
            endUnlock();
            if (isStale() || !audioRef.current) {
                stopStarting();
                return;
            }
            mic.resume();
            // 自動跟讀：這一句沒有點擊，麥克風被系統暫停（AudioContext 不是 running）時最多等 1 秒恢復；
            // 恢復不了就停止，請使用者點一下繼續（Codex 🔴，docs/plans/auto-shadowing.md）
            if (autoKey) {
                const micRunning = () => h.ctx.state === 'running';
                if (!micRunning()) {
                    trace(`自動：麥克風 ${h.ctx.state}，嘗試恢復`);
                    await Promise.race([
                        h.ctx.resume().catch(() => { /* 被拒：下面判斷 */ }),
                        new Promise((r) => setTimeout(r, 1000)),
                    ]);
                    if (isStale()) { stopStarting(); return; }
                    if (!micRunning()) {
                        trace(`自動：麥克風仍是 ${h.ctx.state} → 停止`);
                        stopStarting();
                        stopAuto('mic');
                        return;
                    }
                }
            }

            // 暫停中設定起點，等跳轉完成、確認停在句首才開始錄音（docs/plans/shadowing-stable-playback.md）；
            // 播放器壞掉（已播完、跳轉落在 0）時 prepareSegmentStart 會重新載入一次（docs/plans/ios-ended-fix.md）
            seekSegmentStart(audioRef.current, sentence.startTime);
            trace('等待原音就位');
            const ready = await prepareSegmentStart(audioRef.current, sentence.startTime, {
                timeoutMs: PREPARE_TIMEOUT_MS,
                isCancelled: isStale,
                log: trace,
            });
            if (ready !== 'ready' || !audioRef.current) {
                if (audioRef.current) { pauseSafely(audioRef.current); audioRef.current.muted = false; }
                stopStarting();
                if (ready === 'timeout' && !isStale()) {
                    setError('原音載入失敗，請檢查網路後再試。若一直失敗，請按下方「複製診斷紀錄」貼給開發者。');
                    if (autoKey) stopAuto('prepare');
                }
                return;
            }
            // 就位時不在跳轉中：還在播（解鎖延遲暫停被取消）就在這裡暫停並重新設定句首，確保安靜、從句首開始
            if (!audioRef.current.paused) {
                audioRef.current.pause();
                seekSegmentStart(audioRef.current, sentence.startTime);
            }
            audioRef.current.muted = false;

            const mimeType = getSupportedMimeType();
            const mediaRecorder = new MediaRecorder(h.stream, mimeType ? { mimeType } : undefined);
            mediaRecorderRef.current = mediaRecorder;
            audioChunksRef.current = [];
            analyserRef.current = h.analyser;

            lastSoundTimeRef.current = 0;
            silenceTimerRef.current = 0;
            isBufferPhaseRef.current = false;
            voicedMsRef.current = 0;
            lastFrameAtRef.current = 0;

            mediaRecorder.ondataavailable = (e) => {
                if (e.data.size > 0) {
                    audioChunksRef.current.push(e.data);
                }
            };

            mediaRecorder.onstart = () => {
                recordStartAtRef.current = performance.now();
            };

            // 錄音中麥克風音軌意外結束（來電、被系統收走）：不當成正常錄完，中止、不評分（Codex，docs/plans/review-fixes-50-51.md #3）
            const micTrack = h.stream.getAudioTracks()[0];
            let micLost = false;
            const onMicLost = () => {
                if (micLost || mediaRecorderRef.current !== mediaRecorder) return;
                micLost = true;
                trace('麥克風音軌中斷 → 中止這次錄音、不評分');
                const wasAuto = !!autoKey && !!autoRef.current?.isActive();
                if (wasAuto) stopAuto('mic');   // 顯示「點一下繼續」
                abortRecording();
                if (audioRef.current) pauseSafely(audioRef.current);
                setPracticeState('idle');
                setMicPreparing(false);
                if (!wasAuto) setError('麥克風中斷了，請再試一次');
            };
            micTrack?.addEventListener('ended', onMicLost);
            mediaRecorder.onerror = onMicLost;
            micLostCleanupRef.current = () => micTrack?.removeEventListener('ended', onMicLost);

            mediaRecorder.onstop = () => {
                cleanupAudio();
                restoreOriginalVolume();
                // 自動跟讀這次已被停止（停止與 onstop 之間的競態）：不評分（審查第 1 輪，Codex）
                if (autoKey && cancelToken !== startCancelRef.current) {
                    trace('自動：錄音結束時已停止 → 不評分');
                    return;
                }
                // 錄音器先收到停止、音軌 ended 還沒送到：一樣當成麥克風中斷
                if (micTrack && micTrack.readyState === 'ended') { onMicLost(); return; }
                let speechSec = 0;
                if (lastSoundTimeRef.current > 0 && recordingStartTimeRef.current > 0) {
                    speechSec = Math.max(0, (lastSoundTimeRef.current - recordingStartTimeRef.current) / 1000);
                }
                setUserSpeechSec(speechSec);
                recordedMsRef.current = recordStartAtRef.current !== null ? performance.now() - recordStartAtRef.current : 0;

                // 自動跟讀：整段錄音有聲音的時間不到 SILENT_VOICED_MS → 沒有聲音，不送轉文字、不寫分數（docs/plans/auto-shadowing.md）
                if (autoKey && autoRef.current?.currentAttempt() === autoKey && voicedMsRef.current < SILENT_VOICED_MS) {
                    trace(`自動：沒有偵測到聲音（${Math.round(voicedMsRef.current)}ms）`);
                    setPracticeState('silent');
                    autoRef.current.attemptSilent(autoKey);
                    return;
                }

                const blob = new Blob(audioChunksRef.current, { type: mediaRecorder.mimeType || 'audio/webm' });
                const url = URL.createObjectURL(blob);
                setRecordedBlobUrl(url);

                const attempt: ShadowingAttempt = { speechSec, speed: recordSpeedRef.current };
                lastRecordingRef.current = { blob, autoKey, ...attempt };
                runScoring(blob, attempt, autoKey);
            };

            // Set up audio to play exactly at startTime
            recordStartAtRef.current = null;
            originalPlayingAtRef.current = null;
            if (audioRef.current) {
                // 錄音時原音調小聲，讓使用者的聲音蓋過原音（不能調的裝置不變）
                setOriginalVolume(RECORDING_ORIGINAL_VOLUME);
                audioRef.current.addEventListener('playing', () => {
                    if (originalPlayingAtRef.current === null) originalPlayingAtRef.current = performance.now();
                }, { once: true });
            }

            // 先開始錄音；等錄音真正啟動（start 事件）後再等 PLAYBACK_LEAD_MS 才播原音，
            // 避免錄音還沒開始、原音和使用者開頭的字沒錄到（等待期間已換句、重錄或離開就不播）
            mediaRecorder.start();
            startingRef.current = false;
            monitorVolume();
            setPracticeState('recording');
            const isCancelled = () => isStale() || mediaRecorderRef.current !== mediaRecorder;
            const playback = playAfterRecordingStarts(mediaRecorder, {
                leadMs: PLAYBACK_LEAD_MS,
                isCancelled,
                // 麥克風真的收音後才播原音（iPhone 暖機期間錄到的是零，跟著原音開口的第一個字會被吃掉）
                waitLive: async () => {
                    const live = await waitForMicLive({ sample: micSampler(h), isCancelled });
                    logMicLive('影子跟讀', live, pressedAt);
                    // 自動跟讀：麥克風沒有真的收到音訊 → 中止這次（不評分）、停止並請使用者點一下繼續（Codex 🔴）
                    if (live === 'timeout' && autoKey && !isCancelled()) {
                        trace('自動：麥克風收音確認逾時 → 停止');
                        stopAuto('mic');
                    }
                },
                play: () => {
                    setMicPreparing(false);
                    if (!audioRef.current) return;
                    const a = audioRef.current;
                    // 流暢度的講話時間從原音開始播放算起（不含前面等待的時間）
                    recordingStartTimeRef.current = Date.now();
                    applyPlaybackSpeed(a, recordSpeedRef.current);
                    a.muted = false;
                    trace('正式播放 play()');
                    audioRef.current.play()
                        .then(() => {
                            // 播放真的開始時錄音已經停了（中止、換句）：立刻暫停，不留下沒人管的播放
                            if (isCancelled() || mediaRecorderRef.current?.state !== 'recording') {
                                trace('播放開始時錄音已停止 → 暫停');
                                a.pause();
                            }
                        })
                        .catch(e => {
                            if (e?.name === 'AbortError') return;   // 我們自己暫停造成的
                            console.error("Audio play failed:", e);
                            trace(`play() 失敗：${e?.name || e}`);
                            if (isCancelled()) return;
                            abortRecording();
                            setPracticeState('idle');
                            setError("無法播放教材音訊，請確認裝置音量設定。");
                            if (autoKey) stopAuto('prepare');
                        });
                    // 確認真的從句子開頭播（位置確實在前進才判斷）；錄音中不重新載入，失敗就停止並請使用者複製診斷紀錄
                    startGuardRef.current?.();
                    startGuardRef.current = guardSegmentStart(a, sentence.startTime, (diag) => {
                        startGuardRef.current = null;
                        if (isCancelled()) return;
                        abortRecording();
                        setPracticeState('idle');
                        setError(`原音沒有從這一句的開頭開始播（${diag}）。請按下方「複製診斷紀錄」貼給開發者。`);
                        if (autoKey) stopAuto('prepare');
                    }, { allowReload: false, log: trace });
                    // 準時停在句尾；鎖屏或切 App 時直接暫停原音，一樣進入緩衝倒數（擁有者決定）
                    endWatchRef.current?.();
                    endWatchRef.current = null;
                    armEndWatch();
                },
            });
            await playback;
            setMicPreparing(false);

        } catch (err: any) {
            startingRef.current = false;
            setMicPreparing(false);
            // 麥克風失敗：結束靜音解鎖播放（不留下靜音中或播放中的原音）
            gesture.ended = true;
            if (unlockPendingRef.current === gesture) unlockPendingRef.current = null;
            if (audioRef.current) {
                pauseSafely(audioRef.current);
                audioRef.current.muted = false;
            }
            if (err instanceof MicReleasedError) return;
            console.error("Mic access error:", err);
            if (isStale()) return;
            cleanupAudio();
            setError("無法取得麥克風權限，請確認瀏覽器已允許使用麥克風。");
            if (autoKey) stopAuto('mic');
        }
    };

    /** 原音播到句尾：暫停原音、錄音繼續，進入 6 秒緩衝倒數 */
    const enterBufferPhase = () => {
        // 防止重複進入：監看與 timeupdate 都可能呼叫；pause() 後瀏覽器也可能再觸發一次 timeupdate，
        // 若不擋下會建立第二個倒數計時器，且先建立的那個永遠不會被清除
        if (isBufferPhaseRef.current) return;
        if (!mediaRecorderRef.current || mediaRecorderRef.current.state !== 'recording') return;
        audioRef.current?.pause();

        // Switch to buffer state but keep recording
        isBufferPhaseRef.current = true;
        silenceTimerRef.current = 0;
        setPracticeState('buffer');
        setBufferCount(6);

        if (timerRef.current) clearInterval(timerRef.current);
        timerRef.current = setInterval(() => {
            setBufferCount((prev) => {
                if (prev <= 1) {
                    stopRecordingSafely();
                    return 0;
                }
                return prev - 1;
            });
        }, 1000);
    };

    // 安全網：主要由 watchSegmentEnd 準時停止；不論什麼狀態，原音播過句尾都暫停（docs/plans/shadowing-stable-playback.md）
    const handleTimeUpdate = () => {
        const a = audioRef.current;
        if (!a || a.paused || !(sentence.endTime > 0) || a.currentTime < sentence.endTime) return;
        if (mediaRecorderRef.current?.state === 'recording') { enterBufferPhase(); return; }
        if (playerRef.current?.playing()) return;   // 聽聽看由它自己的監看停止
        trace('安全網：播過句尾 → 暫停');
        a.pause();
    };

    /**
     * 結束自動跟讀（各階段的處理，Codex 🔴）：
     * 準備中 → 取消這次開始；錄音中、緩衝中 → 中止錄音、不評分、原音暫停；
     * 評分中、看結果、倒數中 → 只結束自動模式，評分照常完成並存檔、結果照常顯示（不動 scoringTokenRef）
     */
    const stopAuto = (reason: AutoStopReason) => {
        const session = autoRef.current;
        if (!session || !session.isActive()) return;
        const phase = session.phase();
        session.stop(reason);
        clearPlaybackWatch();
        trace(`自動跟讀結束（${reason}）`);
        if (phase !== 'practicing' && phase !== 'waiting') return;
        startCancelRef.current += 1;
        // 不看錄音狀態一律中止：緩衝結束剛呼叫 stop()、onstop 還沒執行時，錄音已是 inactive，
        // 一樣要拿掉排入佇列的 onstop，否則仍會送評分（審查第 1 輪，Codex）
        abortRecording();
        if (audioRef.current) pauseSafely(audioRef.current);
        setPracticeState('idle');
    };

    const handleRetry = () => {
        stopAuto('navigate');   // 手動再念一次：結束自動模式
        playerRef.current?.stop();
        restoreOriginalVolume();
        if (recordedAudioRef.current) {
            recordedAudioRef.current.pause();
            recordedAudioRef.current.currentTime = 0;
        }
        if (playbackUrlRef.current) {
            URL.revokeObjectURL(playbackUrlRef.current);
            playbackUrlRef.current = null;
        }
        lastRecordingRef.current = null;
        stopRecordingSafely();
        cleanupAudio();
        setPracticeState('idle');
        setBufferCount(6);
        if (recordedBlobUrl) {
            URL.revokeObjectURL(recordedBlobUrl);
            setRecordedBlobUrl(null);
        }
        audioChunksRef.current = [];
        setScoreResult(null);
        setMasteryResult(null);
        setShowGain(false);
        setUserText('');
        setUserSpeechSec(0);
        setError(null);
    };

    const runScoring = async (blob: Blob, attempt: ShadowingAttempt, autoKey: string | null = null) => {
        setPracticeState('scoring');
        setError(null);
        autoRef.current?.attemptSubmitted(autoKey);
        const token = scoringTokenRef.current;
        // 已換句或離開：結果仍寫入這次錄音所屬的句子，但不更新目前的畫面
        const isStale = () => token !== scoringTokenRef.current;
        
        try {
            const mimeType = blob.type || 'audio/webm';
            const file = new File([blob], 'recording', { type: mimeType });
            
            // 參考原句轉文字（docs/plans/whisper-reference.md）：伺服器同時跑一次不帶原句的防補字
            const { text: transcribedText, model, referenced } = await transcribeRecordingDetailed(file, { reference: sentence.text });
            if (!isStale()) {
                setUserText(transcribedText);
                setTranscriber(transcriberLabel(model, referenced));
            }
            
            // 流暢度以錄音當下的速度換算原音長度（放慢時用放慢後的長度）
            const scores = scoreShadowingAttempt(transcribedText, sentence, attempt);
            if (!isStale()) setScoreResult(scores);
            
            // Save to Firestore
            const uid = auth.currentUser?.uid;
            if (!uid) {
                throw new Error("無法取得使用者資訊，請重新登入。");
            }
            
            // 【v3.11】內容 ≥ 70 且總分 ≥ 70 才累加熟練度（計算集中在 nextShadowingMastery，寫入與畫面共用同一份結果）
            const passed = isShadowingPass(scores);
            const before = sentence.mastery;
            const { mastery: newMastery, gain } = nextShadowingMastery(before, scores);
            if (!isStale()) setMasteryResult({ before, after: newMastery, gain });
            
            // 交易內讀最新的句子陣列、只改這一句的熟練度與分數：
            // 不可用畫面上的舊陣列整個寫回，否則會蓋掉同時在別處修改的時間、原始時間或刪除（Codex，PR-G）
            const lastScores = { content: scores.content, fluency: scores.fluency, total: scores.total };
            await runTransaction(db, async (tx) => {
                const ref = doc(db, `artifacts/${appId}/users/${uid}/materials`, material.id);
                const snap = await tx.get(ref);
                if (!snap.exists()) throw new Error('找不到這份教材');
                const latest: MaterialSentence[] = snap.data().sentences || [];
                if (!latest.some(s => s.id === sentence.id)) return;
                tx.update(ref, { sentences: latest.map(s => (s.id === sentence.id ? { ...s, mastery: newMastery, lastScores } : s)) });
            });
            // 自動跟讀摘要：熟練度交易成功才計入（停止或換句後完成的也算；重試評分只算一次）
            autoRef.current?.attemptScored(autoKey, { passed, total: scores.total, gained: gain });

            // 這句含有已學句型且達到累加熟練度的條件：記錄一次「親口念過」（不影響任何熟練度）
            if (passed && sightingPatternIds && sightingPatternIds.length > 0) {
                void recordActiveSighting(material.id, sentence.id, sightingPatternIds);
            }
            
            if (isStale()) return;
            setPracticeState('scored');

            // 評分完成後自動播放剛剛的錄音
            if (recordedAudioRef.current) {
                if (playbackUrlRef.current) {
                    URL.revokeObjectURL(playbackUrlRef.current);
                }
                const url = URL.createObjectURL(blob);
                playbackUrlRef.current = url;
                recordedAudioRef.current.src = url;
                recordedAudioRef.current.currentTime = 0;
                // 播放真的開始才同步成「我的錄音」播放中（被瀏覽器擋下時不顯示成播放中）
                const startToken = scoringTokenRef.current;
                const rec = recordedAudioRef.current;
                // 自動跟讀：自己的錄音播完才開始倒數（擁有者決定）；播放被擋或超過「錄音長度＋3 秒」也開始，不會卡住
                const done = () => {
                    clearPlaybackWatch();
                    autoRef.current?.playbackDone(autoKey);
                };
                if (autoKey && autoRef.current?.isActive()) {
                    clearPlaybackWatch();
                    const fallback = window.setTimeout(done, Math.max(0, recordedMsRef.current) + 3000);
                    rec.addEventListener('ended', done, { once: true });
                    playbackDoneCleanupRef.current = () => {
                        window.clearTimeout(fallback);
                        rec.removeEventListener('ended', done);
                    };
                }
                rec.play()
                    .then(() => { if (startToken === scoringTokenRef.current) playerRef.current?.markPlaying('mine'); })
                    .catch(() => { if (autoKey) done(); });
            } else if (autoKey) {
                autoRef.current?.playbackDone(autoKey);
            }
            
        } catch (err: any) {
            console.error("Scoring error:", err);
            autoRef.current?.attemptFailed(autoKey);
            if (isStale()) return;
            setError(err.message || "評分過程中發生錯誤，請重試。");
            setPracticeState('scoreError');
        }
    };

    // 開始跟讀：第一次先顯示耳機提醒；提醒卡上的「開始跟讀」在同一次點擊裡同步開始
    const handleStartClick = () => {
        if (shouldShowHeadphoneTip(getStorage)) {
            setTipForAuto(false);
            setShowTip(true);
            return;
        }
        handleStart();
    };
    startFnRef.current = () => { void handleStart(); };

    // 自動跟讀：在這次點擊裡解鎖播放器與麥克風（之後的句子沒有點擊）；目前這句要練就在同一次點擊裡開始，
    // 已精熟或已刪除就跳到後面第一句要練的（docs/plans/auto-shadowing.md，擁有者決定：已精熟自動略過）
    const handleAutoStart = (fromTip = false) => {
        const session = autoRef.current;
        if (!session || startingRef.current) return;
        if (!fromTip && shouldShowHeadphoneTip(getStorage)) { setTipForAuto(true); setShowTip(true); return; }
        const gesture = unlockInGesture();
        setError(null);
        const { startNow } = session.begin(sentenceIndex);
        if (startNow) session.sentenceReady(sentence.id);
        else if (!session.isActive()) endGestureUnlock(gesture);   // 後面沒有要練的句子：收掉這次解鎖
    };

    /** 解鎖之後沒有接著開始跟讀：結束靜音解鎖播放、取消靜音 */
    const endGestureUnlock = (gesture: { ended: boolean }) => {
        gesture.ended = true;
        if (unlockPendingRef.current === gesture) unlockPendingRef.current = null;
        const el = audioRef.current;
        if (el) { pauseSafely(el); el.muted = false; }
    };

    // 結果頁動效：總分從 0 跑到實際分數；約 300ms 後補上金色的熟練度增加段。減少動態效果時直接顯示結果
    useEffect(() => {
        if (practiceState !== 'scored' || !scoreResult) return;
        const target = scoreResult.total;
        if (prefersReducedMotion()) {
            setDisplayTotal(target);
            setShowGain(true);
            return;
        }
        setDisplayTotal(0);
        setShowGain(false);
        const duration = 700;
        const start = performance.now();
        let raf = 0;
        const tick = (now: number) => {
            const progress = (now - start) / duration;
            setDisplayTotal(countUpValue(0, target, progress));
            if (progress < 1) raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
        const gainTimer = window.setTimeout(() => setShowGain(true), duration + 300);
        return () => {
            cancelAnimationFrame(raf);
            window.clearTimeout(gainTimer);
        };
    }, [practiceState, scoreResult]);

    // 桌機右側列表：換句時把目前的句子捲到看得見的位置
    useEffect(() => {
        listItemRefs.current[sentenceIndex]?.scrollIntoView({ block: 'nearest' });
    }, [sentenceIndex]);

    const mastery = Number.isFinite(sentence.mastery) ? sentence.mastery : 0;
    const originalSec = Math.max(0, sentence.endTime - sentence.startTime);
    const lastTotal = sentence.lastScores?.total;
    const passed = scoreResult ? isShadowingPass(scoreResult) : false;
    const showSentence = practiceState !== 'scored';
    const jumpLocked = practiceState === 'scoring';
    // 句子解析（docs/plans/sentence-analysis.md）：看句子或看結果時才顯示；錄音、緩衝、評分、準備麥克風、自動跟讀中不顯示
    const showAnalysis = !micPreparing && !autoActive && (practiceState === 'idle' || practiceState === 'scored' || practiceState === 'scoreError' || practiceState === 'silent');
    const autoReason = !autoActive ? autoView?.stopReason ?? null : null;
    const showAutoSummary = !!autoView && !!autoReason && autoReason !== 'navigate' && autoReason !== 'mic' && autoReason !== 'none-left';
    const autoReviewing = autoActive && (practiceState === 'scored' || practiceState === 'silent');
    const positionOf = (index: number) => activeIndices.indexOf(index) + 1;

    return (
        <div className={`h-full ${onJump ? 'lg:grid lg:grid-cols-[minmax(0,1fr)_320px]' : ''}`}>
            <audio
                ref={audioRef}
                src={material.audioUrl}
                onTimeUpdate={handleTimeUpdate}
            />
            <audio
                ref={recordedAudioRef}
                className="hidden"
                preload="auto"
            />
            {showTip && (
                <HeadphoneTip
                    onCancel={() => setShowTip(false)}
                    onStart={(dontShowAgain) => {
                        if (dontShowAgain) dismissHeadphoneTip(getStorage);
                        setShowTip(false);
                        if (tipForAuto) handleAutoStart(true); else handleStart();
                    }}
                />
            )}
            {showAutoSummary && autoView && autoReason && (
                <AutoShadowingSummary
                    reason={autoReason}
                    summary={autoView.summary}
                    sentences={material.sentences}
                    positionOf={positionOf}
                    onJump={onJump}
                    onClose={() => autoRef.current?.clearResult()}
                />
            )}

            {/* 主區 */}
            <div ref={mainScrollRef} className="flex h-full min-h-0 flex-col overflow-y-auto">
                <header className="flex items-center gap-2 px-2 pt-2 sm:px-5 lg:px-9 lg:pt-6">
                    <IconButton aria-label="返回教材" onClick={onBack}>
                        <ChevronLeft size={22} aria-hidden="true" />
                    </IconButton>
                    <div className="min-w-0 flex-1">
                        <p className="truncate text-[15px] font-medium tracking-wide text-ink">{material.title}</p>
                        <p className="text-[13px] text-muted">第 {displayPosition} 句，共 {activeIndices.length} 句</p>
                    </div>
                </header>
                <div className="mx-6 mt-4 h-0.5 rounded-full bg-line sm:mx-8 lg:mx-12" aria-hidden="true">
                    <div
                        className="h-full rounded-full bg-accent transition-[width] duration-[var(--dur-base)]"
                        style={{ width: `${activeIndices.length > 0 ? (displayPosition / activeIndices.length) * 100 : 0}%` }}
                    />
                </div>

                <main className="flex flex-1 flex-col px-6 pt-10 sm:px-10 lg:px-14 lg:pt-14">
                    {autoActive && (
                        <div className="mb-6 flex max-w-[640px] items-center justify-between gap-3 rounded-2xl bg-accent-soft py-2 pr-2 pl-4">
                            <p className="flex items-center gap-2 text-sm font-medium text-ink">
                                <Repeat size={16} className="text-accent" aria-hidden="true" />
                                自動跟讀中・第 {displayPosition} 句
                            </p>
                            <Button variant="secondary" size="sm" onClick={() => stopAuto('user')} aria-label="停止自動跟讀" icon={<Square size={14} aria-hidden="true" />} className="bg-surface">
                                停止
                            </Button>
                        </div>
                    )}
                    {autoReason === 'mic' && (
                        <div role="alert" className="mb-6 flex max-w-[640px] flex-wrap items-center justify-between gap-3 rounded-2xl border border-line bg-surface px-4 py-3">
                            <p className="text-sm text-ink">麥克風暫停了，自動跟讀已停止</p>
                            <Button size="sm" onClick={() => { autoRef.current?.clearResult(); handleAutoStart(); }} icon={<Mic size={16} aria-hidden="true" />}>
                                點一下繼續
                            </Button>
                        </div>
                    )}
                    {autoReason === 'none-left' && (
                        <div role="status" className="mb-6 flex max-w-[640px] items-center justify-between gap-3 rounded-2xl border border-line bg-surface px-4 py-3">
                            <p className="text-sm text-ink">從這一句往後的句子都已精熟，沒有要自動跟讀的句子</p>
                            <Button variant="ghost" size="sm" onClick={() => autoRef.current?.clearResult()}>知道了</Button>
                        </div>
                    )}
                    {error && (
                        <div role="alert" className="mb-6 flex items-start gap-3 rounded-xl bg-danger/10 px-4 py-3.5 text-sm text-danger">
                            <AlertCircle size={18} className="mt-0.5 shrink-0" aria-hidden="true" />
                            <span className="font-medium leading-relaxed break-words">{error}</span>
                        </div>
                    )}

                    {showSentence && (
                        <div className="max-w-[640px]">
                            <p lang="en" className="font-reading text-[30px] leading-[1.32] tracking-[-0.005em] text-ink break-words md:text-[36px] lg:text-[40px] lg:leading-[1.28]">
                                {sentence.text}
                            </p>
                            <p className="mt-5 text-base leading-[1.75] text-muted break-words lg:text-[17px]">
                                {sentence.translation}
                            </p>
                            {showAnalysis && <SentenceAnalysisPanel material={material} sentence={sentence} sentenceIndex={sentenceIndex} />}

                            {practiceState === 'idle' && (
                                <div className="mt-10 flex max-w-sm flex-col gap-2.5">
                                    <div className="flex items-baseline justify-between">
                                        <span className="text-[13px] text-muted">熟練度</span>
                                        <span className="font-reading text-[17px] tabular-nums text-ink">
                                            {mastery}<span className="text-sm text-muted"> / {MASTERY_MAX}</span>
                                        </span>
                                    </div>
                                    <ProgressBar value={Math.min(mastery, MASTERY_MAX)} max={MASTERY_MAX} label="熟練度" tone={mastery >= MASTERY_MAX ? 'gold' : 'accent'} />
                                    <div className="mt-2 flex items-center justify-between gap-3">
                                        <span className="text-[13px] text-muted">原音速度</span>
                                        <SegmentedControl
                                            label="原音速度"
                                            options={SHADOWING_SPEEDS.map(v => ({ value: String(v), label: `${v}×` }))}
                                            value={String(speed)}
                                            onChange={(v) => { const n = Number(v) as ShadowingSpeed; setSpeed(n); saveSpeed(getStorage, n); }}
                                        />
                                    </div>
                                    <div className="flex gap-5 text-[13px] text-muted">
                                        {originalSec > 0 && <span>原音 {effectiveOriginalSec(originalSec, speed).toFixed(1)} 秒</span>}
                                        {typeof lastTotal === 'number' && <span>上次 {lastTotal} 分</span>}
                                    </div>
                                    {sentence.endTime > 0 && (
                                        <p className="text-[13px] tabular-nums text-muted">播放範圍 {formatPlayRange(sentence.startTime, sentence.endTime)}</p>
                                    )}
                                </div>
                            )}
                        </div>
                    )}

                    {/* 狀態 */}
                    <div aria-live="polite">
                        {practiceState === 'recording' && (
                            <div className="mt-10 flex items-center gap-3">
                                <span className="size-2.5 rounded-full bg-danger animate-breathe" aria-hidden="true" />
                                <p className="text-[15px] font-medium text-ink">{micPreparing ? '準備麥克風…' : '正在播放並同步錄音中...'}</p>
                            </div>
                        )}
                        {(practiceState === 'recording' || practiceState === 'buffer') && (
                            <p className="mt-3 flex items-center gap-1.5 text-[13px] text-muted">
                                {canAdjustVolume()
                                    ? <><Volume1 size={15} aria-hidden="true" />錄音時原音會調小聲，讓你的聲音更清楚</>
                                    : <><Headphones size={15} aria-hidden="true" />建議戴耳機，讓收音更清楚</>}
                            </p>
                        )}

                        {practiceState === 'buffer' && (
                            <div className="mt-10 flex flex-wrap items-center gap-x-6 gap-y-4">
                                <span className="font-reading text-[56px] leading-none tabular-nums text-accent">{bufferCount}</span>
                                <div className="flex flex-col gap-3">
                                    <p className="text-[15px] text-muted">教材播放完畢，您可以繼續補完發音</p>
                                    <Button onClick={stopRecordingSafely} icon={<Check size={16} aria-hidden="true" />} className="self-start">
                                        我念完了
                                    </Button>
                                </div>
                            </div>
                        )}

                        {practiceState === 'scoring' && (
                            <div className="mt-10 flex items-center gap-3 text-accent" role="status">
                                <Loader2 size={22} className="animate-spin" aria-hidden="true" />
                                <span className="text-[15px] font-medium text-ink">AI 評分中，請稍候...</span>
                            </div>
                        )}

                        {practiceState === 'scoreError' && (
                            <p className="mt-10 text-sm text-muted">評分失敗，可以重試評分或重新錄一次</p>
                        )}

                        {practiceState === 'silent' && (
                            <p className="mt-10 text-[15px] font-medium text-ink">沒有偵測到聲音，這一句不評分</p>
                        )}
                    </div>

                    {/* 評分結果 */}
                    {practiceState === 'scored' && scoreResult && (
                        <section className="flex max-w-[640px] flex-col gap-7" aria-label="評分結果">
                            <WordDiffView diff={scoreResult.diff} />
                            {showAnalysis && <SentenceAnalysisPanel material={material} sentence={sentence} sentenceIndex={sentenceIndex} />}

                            <div className="flex flex-wrap items-end gap-x-8 gap-y-5">
                                <div className="relative flex flex-col">
                                    {passed && (
                                        <span className="pointer-events-none absolute -top-5 -left-4 h-12 w-40" aria-hidden="true">
                                            <span className="absolute left-0 top-5 size-1.5 rounded-full bg-gold animate-sparkle [animation-delay:650ms]" />
                                            <span className="absolute left-28 top-0 size-2 rounded-full bg-gold animate-sparkle [animation-delay:760ms]" />
                                            <span className="absolute left-36 top-7 size-1.5 rotate-45 bg-gold animate-sparkle [animation-delay:840ms]" />
                                            <span className="absolute left-12 -top-1 size-1 rounded-full bg-accent animate-sparkle [animation-delay:900ms]" />
                                        </span>
                                    )}
                                    <span className="font-reading text-[88px] leading-[0.9] tracking-[-0.03em] tabular-nums text-ink" aria-hidden="true">
                                        {displayTotal}
                                    </span>
                                    <span className="sr-only">總分 {scoreResult.total} 分</span>
                                    <span className="mt-2.5 text-[13px] text-muted">總分{passed ? '，通過' : ''}</span>
                                </div>
                                <div className="flex min-w-48 flex-1 flex-col gap-3.5 pb-1.5">
                                    <div className="flex flex-col gap-1.5">
                                        <div className="flex justify-between text-[13px]"><span className="text-muted">內容</span><span className="tabular-nums text-ink">{scoreResult.content}</span></div>
                                        <ProgressBar value={scoreResult.content} max={100} label="內容" size="sm" />
                                    </div>
                                    <div className="flex flex-col gap-1.5">
                                        <div className="flex justify-between text-[13px]"><span className="text-muted">流暢度</span><span className="tabular-nums text-ink">{scoreResult.fluency}</span></div>
                                        <ProgressBar value={scoreResult.fluency} max={100} label="流暢度" size="sm" />
                                    </div>
                                </div>
                            </div>

                            {!passed && (
                                <p className="text-sm font-medium text-warn">
                                    {scoreResult.content < SHADOWING_PASS_CONTENT
                                        ? `內容未達 ${SHADOWING_PASS_CONTENT} 分（錯 ${scoreResult.errors} 個字），熟練度未增加`
                                        : `總分未達 ${SHADOWING_PASS_TOTAL} 分，熟練度未增加`}
                                </p>
                            )}

                            {masteryResult && (
                                <div className="flex flex-col gap-2.5 rounded-2xl border border-line bg-surface p-4">
                                    <div className="flex items-baseline justify-between gap-3">
                                        <span className="text-[13px] text-muted">熟練度</span>
                                        <span className="text-sm">
                                            {masteryResult.gain > 0 && (
                                                <span className={`mr-2.5 font-medium text-gold transition-opacity duration-[var(--dur-base)] ${showGain ? 'opacity-100' : 'opacity-0'}`}>
                                                    +{masteryResult.gain}
                                                </span>
                                            )}
                                            <span className="font-reading text-[17px] tabular-nums text-ink">{showGain ? masteryResult.after : masteryResult.before}</span>
                                            <span className="text-muted"> / {MASTERY_MAX}</span>
                                        </span>
                                    </div>
                                    <ProgressBar
                                        value={Math.min(showGain ? masteryResult.after : masteryResult.before, MASTERY_MAX)}
                                        max={MASTERY_MAX}
                                        gain={showGain && masteryResult.gain > 0 ? masteryResult.gain : 0}
                                        label="熟練度"
                                    />
                                </div>
                            )}

                            {/* 擁有者決定（docs/plans/review-fixes-50-51.md）：自動跟讀進行中隱藏「聽聽看」，要聽就先按停止 */}
                            {!autoActive && (
                            <section aria-labelledby="listen-h" className="flex flex-col gap-3.5 rounded-[20px] border border-line bg-surface p-[18px]">
                                <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                                    <h3 id="listen-h" className="text-[15px] font-bold text-ink">聽聽看</h3>
                                    <span className="text-xs text-muted">重疊播放：同時聽你的錄音和原音</span>
                                </div>
                                <div aria-hidden="true" className="flex flex-col gap-2">
                                    {([['原音', 'bg-muted', listenMode === 'original' || listenMode === 'overlay'], ['我的', 'bg-accent', listenMode === 'mine' || listenMode === 'overlay']] as const).map(([label, color, active]) => (
                                        <div key={label} className="flex items-center gap-2.5">
                                            <span className={`w-9 shrink-0 text-[11px] ${label === '我的' ? 'text-accent' : 'text-muted'}`}>{label}</span>
                                            <span className="flex h-6 min-w-0 flex-1 items-center gap-[3px] overflow-hidden">
                                                {WAVE.map((h, i) => (
                                                    <span
                                                        key={i}
                                                        className={`w-[3px] shrink-0 rounded-full ${color} ${active ? 'animate-wave' : 'opacity-50'}`}
                                                        style={{ height: h, animationDelay: `${(i % 7) * 120}ms` }}
                                                    />
                                                ))}
                                            </span>
                                        </div>
                                    ))}
                                </div>
                                <div className="grid grid-cols-3 gap-2">
                                    {LISTEN_BUTTONS.map(({ mode, label, ariaLabel }) => {
                                        const on = listenMode === mode;
                                        return (
                                            <button
                                                key={mode}
                                                type="button"
                                                aria-pressed={on}
                                                aria-label={ariaLabel}
                                                onClick={() => { stopAuto('navigate'); playerRef.current?.toggle(mode); }}
                                                className={`flex min-h-11 items-center justify-center gap-1.5 rounded-full px-2 text-[13px] transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${
                                                    on ? 'bg-accent font-medium text-on-accent' : 'border border-line text-ink hover:bg-surface-2'
                                                }`}
                                            >
                                                {on ? <Pause size={14} aria-hidden="true" /> : mode === 'overlay' ? <Layers size={14} aria-hidden="true" /> : <Play size={14} aria-hidden="true" />}
                                                {label}
                                            </button>
                                        );
                                    })}
                                </div>
                            </section>
                            )}

                            <div className="flex flex-col gap-2">
                                <p className="flex flex-wrap items-baseline justify-between gap-x-3 text-xs text-muted">
                                    <span>您實際念的內容：</span>
                                    {transcriber && <span className="text-[11px] text-muted/80">語音辨識：{transcriber}</span>}
                                </p>
                                <p className="text-[15px] leading-relaxed text-ink/80 break-words">
                                    {userText || "(未偵測到語音)"}
                                </p>
                            </div>
                        </section>
                    )}

                    {/* 操作 */}
                    <div className="mt-auto pt-10 pb-6 lg:pb-10">
                        {practiceState === 'idle' && autoActive && (
                            <p role="status" className="flex items-center gap-2 text-[15px] text-muted">
                                <Loader2 size={18} className="animate-spin" aria-hidden="true" />準備麥克風與原音…
                            </p>
                        )}
                        {practiceState === 'idle' && !autoActive && (
                            <div className="flex max-w-[640px] flex-col gap-4 lg:flex-row-reverse lg:items-center lg:justify-end lg:gap-6">
                                <p className="flex items-start gap-2.5 text-[13px] leading-relaxed text-muted lg:max-w-sm">
                                    <Headphones size={17} className="mt-0.5 shrink-0" aria-hidden="true" />
                                    <span>請戴上耳機練習。跟讀時會同時播放原音和錄音，沒戴耳機時麥克風會錄到原音，導致評分失準。</span>
                                </p>
                                <div className="flex flex-col gap-2.5 lg:shrink-0">
                                    <Button size="lg" onClick={handleStartClick} disabled={micPreparing} icon={<Mic size={22} aria-hidden="true" />} className="w-full lg:w-auto">
                                        {micPreparing ? '準備麥克風…' : '開始跟讀'}
                                    </Button>
                                    {onJump && activeIndices.length > 0 && (
                                        <Button variant="secondary" size="md" onClick={() => handleAutoStart()} disabled={micPreparing} icon={<Repeat size={18} aria-hidden="true" />} className="w-full lg:w-auto">
                                            自動跟讀
                                        </Button>
                                    )}
                                </div>
                            </div>
                        )}

                        {autoReviewing && autoView && (
                            <div className="flex max-w-[640px] flex-col gap-3">
                                <p aria-live="polite" className="text-[15px] font-medium text-ink">
                                    {autoView.phase === 'countdown'
                                        ? <><span className="font-reading text-2xl tabular-nums text-accent">{autoView.countdown}</span> 秒後下一句</>
                                        : '正在播放你的錄音，播完後倒數 5 秒'}
                                </p>
                                <div className="grid grid-cols-2 gap-3">
                                    <Button variant="secondary" size="lg" onClick={() => stopAuto('user')} aria-label="停止自動跟讀" icon={<Square size={16} aria-hidden="true" />} className="px-4">
                                        停止
                                    </Button>
                                    <Button size="lg" onClick={() => autoRef.current?.skipNow()} icon={<SkipForward size={18} aria-hidden="true" />} className="px-4">
                                        立即下一句
                                    </Button>
                                </div>
                            </div>
                        )}

                        {practiceState === 'silent' && !autoActive && (
                            <div className="grid max-w-[640px] grid-cols-2 gap-3">
                                <Button variant="secondary" size="lg" onClick={handleRetry} icon={<RotateCcw size={18} aria-hidden="true" />} className="px-4">
                                    再念一次
                                </Button>
                                {!isLastSentence && (
                                    <Button size="lg" onClick={onNext} className="px-4">
                                        下一句
                                    </Button>
                                )}
                            </div>
                        )}

                        {practiceState === 'scoreError' && (
                            <div className="grid max-w-[640px] grid-cols-2 gap-3">
                                <Button variant="secondary" size="lg" onClick={handleRetry} icon={<RotateCcw size={18} aria-hidden="true" />} className="px-4">
                                    重新錄一次
                                </Button>
                                <Button
                                    size="lg"
                                    onClick={() => {
                                        if (lastRecordingRef.current) {
                                            runScoring(lastRecordingRef.current.blob, lastRecordingRef.current, lastRecordingRef.current.autoKey ?? null);
                                        }
                                    }}
                                    icon={<Send size={18} aria-hidden="true" />}
                                    className="px-4"
                                >
                                    重試評分
                                </Button>
                            </div>
                        )}

                        {practiceState === 'scored' && !autoActive && (
                            <div className="grid max-w-[640px] grid-cols-2 gap-3">
                                <Button variant="secondary" size="lg" onClick={handleRetry} icon={<RotateCcw size={18} aria-hidden="true" />} className="px-4">
                                    再念一次
                                </Button>
                                {!isLastSentence ? (
                                    <Button size="lg" onClick={onNext} className="px-4">
                                        下一句
                                    </Button>
                                ) : (
                                    <div className="flex min-h-14 items-center justify-center rounded-full bg-accent-soft px-4 text-center text-sm font-medium text-ink">
                                        已完成本教材所有句子
                                    </div>
                                )}
                            </div>
                        )}
                    </div>

                    {/* 播放診斷紀錄（暫時功能，問題解決後拿掉；擁有者 2026-11-10） */}
                    <div className="mt-auto flex flex-col items-start gap-2 pt-10 pb-6">
                        <button
                            type="button"
                            onClick={copyTrace}
                            className="min-h-9 rounded-full px-3 text-xs text-muted underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-accent"
                        >
                            複製診斷紀錄
                        </button>
                        {traceCopied && <p role="status" className="px-3 text-xs text-accent">{traceCopied}</p>}
                        {traceFallback && (
                            <textarea
                                readOnly
                                aria-label="診斷紀錄"
                                value={traceFallback}
                                onFocus={(e) => e.currentTarget.select()}
                                className="h-40 w-full max-w-[640px] rounded-xl border border-line bg-surface-2 p-3 font-mono text-[11px] text-ink"
                            />
                        )}
                    </div>
                </main>
            </div>

            {/* 桌機：本集句子列表 */}
            {onJump && (
                <aside className="hidden min-h-0 flex-col border-l border-line bg-surface-2 lg:flex" aria-label="本集句子">
                    <div className="px-6 pt-8 pb-3">
                        <p className="text-sm font-medium text-ink">本集句子</p>
                        {jumpLocked && <p className="mt-1 text-xs text-muted">評分中，完成後可以切換句子</p>}
                    </div>
                    <ol className="flex-1 overflow-y-auto px-3 pb-6">
                        {activeIndices.map((idx, pos) => {
                            const item = material.sentences[idx];
                            const current = idx === sentenceIndex;
                            const m = Number.isFinite(item.mastery) ? item.mastery : 0;
                            return (
                                <li key={item.id}>
                                    <button
                                        type="button"
                                        ref={(el) => { listItemRefs.current[idx] = el; }}
                                        onClick={() => { if (!current) onJump(idx); }}
                                        disabled={jumpLocked && !current}
                                        aria-current={current ? 'true' : undefined}
                                        className={`w-full rounded-xl px-3 py-3 text-left transition-colors duration-[var(--dur-fast)] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent disabled:opacity-45 ${
                                            current ? 'bg-surface shadow-[0_1px_2px_rgb(0_0_0/0.06)]' : 'hover:bg-surface/70'
                                        }`}
                                    >
                                        <div className="flex items-baseline gap-3">
                                            <span className="w-6 shrink-0 text-xs tabular-nums text-muted">{pos + 1}</span>
                                            <span lang="en" className={`font-reading text-[15px] leading-snug line-clamp-2 ${current ? 'text-ink' : 'text-ink/75'}`}>{item.text}</span>
                                        </div>
                                        <div className="mt-2 ml-9">
                                            <ProgressBar value={Math.min(m, MASTERY_MAX)} max={MASTERY_MAX} label={`第 ${pos + 1} 句熟練度`} size="sm" tone={m >= MASTERY_MAX ? 'gold' : 'accent'} />
                                        </div>
                                    </button>
                                </li>
                            );
                        })}
                    </ol>
                </aside>
            )}
        </div>
    );
}
