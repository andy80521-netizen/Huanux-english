import React, { useState, useRef, useEffect } from 'react';
import { Material } from '../types';
import { ChevronLeft, Mic, AlertCircle, RotateCcw, Send, Loader2, Headphones, Check, Play, Pause, Layers, Volume1 } from 'lucide-react';
import { transcribeRecording } from '../services/gemini';
import { calculateShadowingScores, isShadowingPass, PracticeScores, SHADOWING_PASS_CONTENT, SHADOWING_PASS_TOTAL } from '../utils/scoring';
import WordDiffView from './WordDiffView';
import { getSupportedMimeType } from '../utils/mediaRecorder';
import { auth, db, appId } from '../firebase';
import { doc, updateDoc } from 'firebase/firestore';
import { SILENT_AUDIO } from '../utils';
import { recordActiveSighting } from '../services/sightings';
import { nextShadowingMastery } from '../utils/shadowingMastery';
import { MASTERY_MAX } from '../utils/materialProgress';
import { countUpValue } from '../utils/countUp';
import Button from './ui/Button';
import IconButton from './ui/IconButton';
import ProgressBar from './ui/ProgressBar';
import { RECORDING_ORIGINAL_VOLUME, canSetElementVolume, overlayOffsetMs, sentenceSegment, shouldShowHeadphoneTip, dismissHeadphoneTip } from '../utils/shadowingAudio';
import { createListenPlayer, ListenMode, ListenPlayer } from '../utils/shadowingPlayback';

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
    const [error, setError] = useState<string | null>(null);
    const [bufferCount, setBufferCount] = useState(6);
    const [recordedBlobUrl, setRecordedBlobUrl] = useState<string | null>(null);
    const [scoreResult, setScoreResult] = useState<PracticeScores | null>(null);
    const [userText, setUserText] = useState<string>('');
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
    
    const audioRef = useRef<HTMLAudioElement>(null);
    const recordedAudioRef = useRef<HTMLAudioElement>(null);
    const playbackUrlRef = useRef<string | null>(null);
    const lastRecordingRef = useRef<{ blob: Blob; speechSec: number } | null>(null);
    const mediaRecorderRef = useRef<MediaRecorder | null>(null);
    const streamRef = useRef<MediaStream | null>(null);
    const audioContextRef = useRef<AudioContext | null>(null);
    const analyserRef = useRef<AnalyserNode | null>(null);
    const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
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
        if (requestAnimationFrameRef.current) {
            cancelAnimationFrame(requestAnimationFrameRef.current);
            requestAnimationFrameRef.current = 0;
        }
        if (sourceRef.current) {
            sourceRef.current.disconnect();
            sourceRef.current = null;
        }
        if (analyserRef.current) {
            analyserRef.current.disconnect();
            analyserRef.current = null;
        }
        if (audioContextRef.current) {
            audioContextRef.current.close().catch(console.error);
            audioContextRef.current = null;
        }
        if (streamRef.current) {
            streamRef.current.getTracks().forEach(track => track.stop());
            streamRef.current = null;
        }
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
        });
        playerRef.current = player;
        return () => {
            player.dispose();
            playerRef.current = null;
        };
    }, []);

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
        // iPhone 只允許「使用者點擊當下」啟動播放，所以必須在任何 await 之前先解鎖錄音播放器
        if (recordedAudioRef.current) {
            recordedAudioRef.current.src = SILENT_AUDIO;
            recordedAudioRef.current.play().then(() => recordedAudioRef.current?.pause()).catch(() => {});
        }

        setError(null);
        cleanupAudio();
        // 等待麥克風權限期間可能已換句或離開（桌機可點右側句子）：每個 await 之後都檢查，過期就釋放資源並結束，不啟動舊句子的錄音
        const startToken = scoringTokenRef.current;
        const isStale = () => startToken !== scoringTokenRef.current;
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
            if (isStale()) {
                stream.getTracks().forEach(track => track.stop());
                return;
            }
            streamRef.current = stream;
            
            const mimeType = getSupportedMimeType();
            const mediaRecorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
            mediaRecorderRef.current = mediaRecorder;
            audioChunksRef.current = [];

            // Setup Web Audio API
            const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
            const audioCtx = new AudioContextClass();
            audioContextRef.current = audioCtx;
            await audioCtx.resume().catch(console.warn);
            if (isStale()) {
                cleanupAudio();
                return;
            }

            const source = audioCtx.createMediaStreamSource(stream);
            sourceRef.current = source;
            const analyser = audioCtx.createAnalyser();
            analyser.fftSize = 256;
            analyserRef.current = analyser;
            source.connect(analyser);

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

                lastRecordingRef.current = { blob, speechSec };
                runScoring(blob, speechSec);
            };

            // Set up audio to play exactly at startTime
            recordStartAtRef.current = null;
            originalPlayingAtRef.current = null;
            if (audioRef.current) {
                audioRef.current.currentTime = sentence.startTime;
                // 錄音時原音調小聲，讓使用者的聲音蓋過原音（不能調的裝置不變）
                setOriginalVolume(RECORDING_ORIGINAL_VOLUME);
                audioRef.current.addEventListener('playing', () => {
                    if (originalPlayingAtRef.current === null) originalPlayingAtRef.current = performance.now();
                }, { once: true });
            }

            // Sync start: record + play audio at the same time
            recordingStartTimeRef.current = Date.now();
            mediaRecorder.start();
            monitorVolume();

            if (audioRef.current) {
                audioRef.current.play().catch(e => {
                    console.error("Audio play failed:", e);
                    abortRecording();
                    setPracticeState('idle');
                    setError("無法播放教材音訊，請確認裝置音量設定。");
                });
            }
            
            setPracticeState('recording');

        } catch (err: any) {
            console.error("Mic access error:", err);
            if (isStale()) return;
            cleanupAudio();
            setError("無法取得麥克風權限，請確認瀏覽器已允許使用麥克風。");
        }
    };

    const handleTimeUpdate = () => {
        if (practiceState !== 'recording' || !audioRef.current) return;
        
        // Stop audio when it reaches the sentence endTime
        if (audioRef.current.currentTime >= sentence.endTime && sentence.endTime > 0) {
            // 防止重複進入：pause() 後瀏覽器可能再觸發一次 timeupdate，此時畫面狀態尚未更新，
            // 若不擋下會建立第二個倒數計時器，且先建立的那個永遠不會被清除
            if (isBufferPhaseRef.current) return;

            audioRef.current.pause();
            
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
        }
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

    const runScoring = async (blob: Blob, speechSec: number) => {
        setPracticeState('scoring');
        setError(null);
        const token = scoringTokenRef.current;
        // 已換句或離開：結果仍寫入這次錄音所屬的句子，但不更新目前的畫面
        const isStale = () => token !== scoringTokenRef.current;
        
        try {
            const mimeType = blob.type || 'audio/webm';
            const file = new File([blob], 'recording', { type: mimeType });
            
            const transcribedText = await transcribeRecording(file);
            if (!isStale()) setUserText(transcribedText);
            
            const originalSec = Math.max(0, sentence.endTime - sentence.startTime);
            const scores = calculateShadowingScores(transcribedText, sentence.text, speechSec, originalSec);
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
            
            const updatedSentences = material.sentences.map((s, i) =>
                i === sentenceIndex
                    ? { ...s, mastery: newMastery, lastScores: { content: scores.content, fluency: scores.fluency, total: scores.total } }
                    : s
            );
            
            await updateDoc(doc(db, `artifacts/${appId}/users/${uid}/materials`, material.id), {
                sentences: updatedSentences
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
                recordedAudioRef.current.play().catch(() => {});
                playerRef.current?.markPlaying('mine');
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
            <div className="flex h-full min-h-0 flex-col overflow-y-auto">
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
                                    <div className="flex gap-5 text-[13px] text-muted">
                                        {originalSec > 0 && <span>原音 {originalSec.toFixed(1)} 秒</span>}
                                        {typeof lastTotal === 'number' && <span>上次 {lastTotal} 分</span>}
                                    </div>
                                </div>
                            )}
                        </div>
                    )}

                    {/* 狀態 */}
                    <div aria-live="polite">
                        {practiceState === 'recording' && (
                            <div className="mt-10 flex items-center gap-3">
                                <span className="size-2.5 rounded-full bg-danger animate-breathe" aria-hidden="true" />
                                <p className="text-[15px] font-medium text-ink">正在播放並同步錄音中...</p>
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
                                <p className="text-xs text-muted">您實際念的內容：</p>
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
                                <Button size="lg" onClick={handleStartClick} icon={<Mic size={22} aria-hidden="true" />} className="w-full lg:w-auto lg:shrink-0">
                                    開始跟讀
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
                                            runScoring(lastRecordingRef.current.blob, lastRecordingRef.current.speechSec);
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
