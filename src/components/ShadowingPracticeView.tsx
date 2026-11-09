import React, { useState, useRef, useEffect } from 'react';
import { Material, MaterialSentence } from '../types';
import { ChevronLeft, Mic, AlertCircle, RotateCcw, Send, Loader2, Headphones, Check, Play, Pause, Layers, Volume1 } from 'lucide-react';
import { transcribeRecordingDetailed } from '../services/gemini';
import { transcriberLabel } from '../utils/transcriber';
import { playAfterRecordingStarts } from '../utils/recordingTiming';
import { useMicSession, waitForMicLive, micSampler, logMicLive, MicReleasedError, KEEP_MIC_OPEN } from '../utils/micSession';
import { calculateShadowingScores, isShadowingPass, PracticeScores, SHADOWING_PASS_CONTENT, SHADOWING_PASS_TOTAL } from '../utils/scoring';
import WordDiffView from './WordDiffView';
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
import { watchSegmentEnd, seekSegmentStart, guardSegmentStart, prepareSegmentStart, PREPARE_TIMEOUT_MS } from '../utils/segmentEnd';
import { createPlaybackTrace, PlaybackTrace } from '../utils/playbackTrace';
import { formatPlayRange } from '../utils/timeEdit';

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

type PracticeState = 'idle' | 'recording' | 'buffer' | 'finished' | 'scoring' | 'scored' | 'scoreError';

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
    const trace = (msg: string) => traceRef.current?.mark(msg);
    const [traceCopied, setTraceCopied] = useState<string | null>(null);
    const [traceFallback, setTraceFallback] = useState<string | null>(null);
    
    const audioRef = useRef<HTMLAudioElement>(null);
    const recordedAudioRef = useRef<HTMLAudioElement>(null);
    const playbackUrlRef = useRef<string | null>(null);
    // 一次錄音的快照（含錄音當下的原音速度）：評分、重試評分、聽聽看都讀它（docs/plans/shadowing-speed.md）
    const lastRecordingRef = useRef<({ blob: Blob } & ShadowingAttempt) | null>(null);
    // 原音語速：記住設定；每次按開始跟讀時拍下快照
    const [speed, setSpeed] = useState<ShadowingSpeed>(() => loadSpeed(getStorage));
    const recordSpeedRef = useRef<number>(1);
    const mediaRecorderRef = useRef<MediaRecorder | null>(null);
    const analyserRef = useRef<AnalyserNode | null>(null);
    const requestAnimationFrameRef = useRef<number>(0);
    const audioChunksRef = useRef<Blob[]>([]);
    const timerRef = useRef<NodeJS.Timeout | null>(null);

    /** 設定原音音量；這台裝置不能調（iPhone／iPad）時不做事 */
    const setOriginalVolume = (v: number) => {
        if (!canAdjustVolume() || !audioRef.current) return;
        try { audioRef.current.volume = v; } catch { /* 忽略 */ }
    };
    const restoreOriginalVolume = () => setOriginalVolume(1);

    const cleanupAudio = () => {
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
        scoringTokenRef.current += 1;
        playerRef.current?.stop();
        restoreOriginalVolume();
        setShowTip(false);
        // 換句時一併停止教材原音（錄音中跳句時原音還在播放）
        if (audioRef.current) {
            audioRef.current.pause();
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

        if (averageVolume >= 20) {
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

    const handleStart = async () => {
        if (startingRef.current) return;   // 正在準備麥克風時連按：不開第二次
        // 要看的句子在畫面上半部：開始跟讀時捲回最上方
        mainScrollRef.current?.scrollTo({ top: 0, behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
        // iPhone 只允許「使用者點擊當下」啟動播放，所以必須在任何 await 之前先解鎖錄音播放器
        if (recordedAudioRef.current) {
            recordedAudioRef.current.src = SILENT_AUDIO;
            recordedAudioRef.current.play().then(() => recordedAudioRef.current?.pause()).catch(() => {});
        }
        recordSpeedRef.current = speed;   // 這次錄音的原音速度快照
        trace(`按下跟讀：第 ${displayPosition} 句 ${formatPlayRange(sentence.startTime, sentence.endTime)}，語速 ${speed}`);
        // 原音在錄音開始後才播放：先在點擊當下靜音解鎖一次（iPhone 之後才允許播放）。
        // 解鎖前先設定起點，iPhone 不要從 0 秒開始緩衝（docs/plans/ios-seek-fix.md）
        const org = audioRef.current;
        let unlock: Promise<'ok' | 'rejected'> = Promise.resolve('rejected');
        let unlockEnded = false;
        if (org) {
            seekSegmentStart(org, sentence.startTime);
            applyPlaybackSpeed(org, speed);
            org.muted = true;
            // 解鎖播放一開始播就暫停（已有資料）；還在載入時（超過 UNLOCK_WAIT_MS）就讓它靜音繼續載入，就位後才暫停
            unlock = Promise.resolve(org.play()).then(
                () => { if (!unlockEnded) org.pause(); return 'ok' as const; },
                () => 'rejected' as const,
            );
            trace('靜音解鎖 play()');
        }

        setError(null);
        setTraceCopied(null);
        setTraceFallback(null);
        cleanupAudio();
        mic.resume();   // iPhone：喚醒 AudioContext 要在點擊當下、任何 await 之前
        startingRef.current = true;
        setMicPreparing(true);
        // 等待麥克風權限期間可能已換句或離開（桌機可點右側句子）：每個 await 之後都檢查，過期就結束，不啟動舊句子的錄音
        const startToken = scoringTokenRef.current;
        const isStale = () => startToken !== scoringTokenRef.current;
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
            /** 結束靜音解鎖播放：暫停並取消靜音 */
            const endUnlock = () => {
                unlockEnded = true;
                const el = audioRef.current;
                if (!el) return;
                if (!el.paused) el.pause();
                el.muted = false;
            };
            if (isStale() || !audioRef.current) {
                endUnlock();
                stopStarting();
                return;
            }
            mic.resume();

            // 原音先就位（停在句首、可以播放）才開始錄音（docs/plans/shadowing-stable-playback.md）。
            // 解鎖播放還在載入時不先暫停（iPhone 暫停後可能不再載入）：靜音繼續，就位後才暫停
            seekSegmentStart(audioRef.current, sentence.startTime);
            trace('等待原音就位');
            const ready = await prepareSegmentStart(audioRef.current, sentence.startTime, {
                timeoutMs: PREPARE_TIMEOUT_MS,
                isCancelled: isStale,
                log: trace,
            });
            endUnlock();
            if (ready !== 'ready' || !audioRef.current) {
                stopStarting();
                if (ready === 'timeout' && !isStale()) setError('原音載入失敗，請檢查網路後再試。');
                return;
            }
            // 解鎖播放可能在就位後又往前走了一點：暫停後再拉回句首（資料已在，跳轉很快；之後由起點確認把關）
            seekSegmentStart(audioRef.current, sentence.startTime);

            const mimeType = getSupportedMimeType();
            const mediaRecorder = new MediaRecorder(h.stream, mimeType ? { mimeType } : undefined);
            mediaRecorderRef.current = mediaRecorder;
            audioChunksRef.current = [];
            analyserRef.current = h.analyser;

            lastSoundTimeRef.current = 0;
            silenceTimerRef.current = 0;
            isBufferPhaseRef.current = false;

            mediaRecorder.ondataavailable = (e) => {
                if (e.data.size > 0) {
                    audioChunksRef.current.push(e.data);
                }
            };

            mediaRecorder.onstart = () => {
                recordStartAtRef.current = performance.now();
            };

            mediaRecorder.onstop = () => {
                cleanupAudio();
                restoreOriginalVolume();
                let speechSec = 0;
                if (lastSoundTimeRef.current > 0 && recordingStartTimeRef.current > 0) {
                    speechSec = Math.max(0, (lastSoundTimeRef.current - recordingStartTimeRef.current) / 1000);
                }
                setUserSpeechSec(speechSec);

                const blob = new Blob(audioChunksRef.current, { type: mediaRecorder.mimeType || 'audio/webm' });
                const url = URL.createObjectURL(blob);
                setRecordedBlobUrl(url);

                const attempt: ShadowingAttempt = { speechSec, speed: recordSpeedRef.current };
                lastRecordingRef.current = { blob, ...attempt };
                runScoring(blob, attempt);
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
                waitLive: async () => logMicLive('影子跟讀', await waitForMicLive({ sample: micSampler(h), isCancelled }), pressedAt),
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
                        });
                    // 確認真的從句子開頭播（位置確實在前進才判斷）；錄音中不重新載入，失敗就停止並請使用者複製診斷紀錄
                    startGuardRef.current?.();
                    startGuardRef.current = guardSegmentStart(a, sentence.startTime, (diag) => {
                        startGuardRef.current = null;
                        if (isCancelled()) return;
                        abortRecording();
                        setPracticeState('idle');
                        setError(`原音沒有從這一句的開頭開始播（${diag}）。請按下方「複製診斷紀錄」貼給開發者。`);
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
            unlockEnded = true;
            if (audioRef.current) {
                if (!audioRef.current.paused) audioRef.current.pause();
                audioRef.current.muted = false;
            }
            if (err instanceof MicReleasedError) return;
            console.error("Mic access error:", err);
            if (isStale()) return;
            cleanupAudio();
            setError("無法取得麥克風權限，請確認瀏覽器已允許使用麥克風。");
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

    const handleRetry = () => {
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

    const runScoring = async (blob: Blob, attempt: ShadowingAttempt) => {
        setPracticeState('scoring');
        setError(null);
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
                recordedAudioRef.current.play()
                    .then(() => { if (startToken === scoringTokenRef.current) playerRef.current?.markPlaying('mine'); })
                    .catch(() => {});
            }
            
        } catch (err: any) {
            console.error("Scoring error:", err);
            if (isStale()) return;
            setError(err.message || "評分過程中發生錯誤，請重試。");
            setPracticeState('scoreError');
        }
    };

    // 開始跟讀：第一次先顯示耳機提醒；提醒卡上的「開始跟讀」在同一次點擊裡同步開始
    const handleStartClick = () => {
        if (shouldShowHeadphoneTip(getStorage)) {
            setShowTip(true);
            return;
        }
        handleStart();
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
                        handleStart();
                    }}
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
                    </div>

                    {/* 評分結果 */}
                    {practiceState === 'scored' && scoreResult && (
                        <section className="flex max-w-[640px] flex-col gap-7" aria-label="評分結果">
                            <WordDiffView diff={scoreResult.diff} />

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
                                                onClick={() => playerRef.current?.toggle(mode)}
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
                        {practiceState === 'idle' && (
                            <div className="flex max-w-[640px] flex-col gap-4 lg:flex-row-reverse lg:items-center lg:justify-end lg:gap-6">
                                <p className="flex items-start gap-2.5 text-[13px] leading-relaxed text-muted lg:max-w-sm">
                                    <Headphones size={17} className="mt-0.5 shrink-0" aria-hidden="true" />
                                    <span>請戴上耳機練習。跟讀時會同時播放原音和錄音，沒戴耳機時麥克風會錄到原音，導致評分失準。</span>
                                </p>
                                <Button size="lg" onClick={handleStartClick} disabled={micPreparing} icon={<Mic size={22} aria-hidden="true" />} className="w-full lg:w-auto lg:shrink-0">
                                    {micPreparing ? '準備麥克風…' : '開始跟讀'}
                                </Button>
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
                                            runScoring(lastRecordingRef.current.blob, lastRecordingRef.current);
                                        }
                                    }}
                                    icon={<Send size={18} aria-hidden="true" />}
                                    className="px-4"
                                >
                                    重試評分
                                </Button>
                            </div>
                        )}

                        {practiceState === 'scored' && (
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
