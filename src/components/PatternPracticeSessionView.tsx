import React, { useState, useRef, useEffect } from 'react';
import { LanguagePattern, PatternExampleSentence } from '../types';
import { getSupportedMimeType } from '../utils/mediaRecorder';
import { transcribeRecordingDetailed } from '../services/gemini';
import { shouldStopForSilence } from '../utils/silenceDetection';
import { transcriberLabel } from '../utils/transcriber';
import { practiceDurationSec } from '../utils/recordingTiming';
import { calculateFinalScores, canAccumulatePattern, PracticeScores } from '../utils/scoring';
import WordDiffView from './WordDiffView';
import { generateAndSavePracticePrompts } from '../services/practicePrompts';
import { requestPracticeImages } from '../services/practiceImage';
import { getSpeechUrl, prefetchSpeech } from '../services/speech';
import { auth } from '../firebase';
import { updatePatternSentences } from '../services/sentenceWrites';
import { Mic, Loader2, RefreshCw, ChevronRight, Check, ChevronLeft, Volume2, RotateCcw, AlertCircle } from 'lucide-react';
import Button from './ui/Button';
import IconButton from './ui/IconButton';
import ProgressBar from './ui/ProgressBar';
import { countUpValue } from '../utils/countUp';
import { isSydneyDateReached, addSydneyCalendarDays, getSydneyCalendarDaysDiff } from '../utils/sydneyTime';
import { SILENT_AUDIO } from '../utils';

interface Props {
  pattern: LanguagePattern;
  sentenceIndex: number;
  groupIndex?: number;
  onBack: () => void;
  onNext: () => void;
  isLastSentence: boolean;
  progressLabel?: string;
  onScored?: (sentenceId: string, total: number, isExact: boolean) => void; // 每次評分完成時回報（維持複習用）；isExact＝一字不差
  /** 進度（今日複習用）：畫在頁首下方的細線 */
  progress?: { done: number; total: number };
  /** 熟練度真的寫入後回報（今日複習的完成畫面用）；只在寫入成功時呼叫 */
  onMasteryUpdated?: (sentenceId: string, before: number, after: number) => void;
}

/** 系統是否開啟「減少動態效果」（分數跑動是 JS，全域 CSS 規則管不到，要自己判斷） */
const prefersReducedMotion = () => {
    try { return !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
};

const PROMPT_LABEL: Record<string, string> = {
    qaQuestion: '回答這個問題',
    situationalPrompt: '情境任務',
    imageUrl: '看圖說出對應的句子',
};

type SessionState = 'idle' | 'recording' | 'scoring' | 'scored' | 'scoreError';

type PromptType = 'qaQuestion' | 'situationalPrompt' | 'imageUrl';


function calculateMasteryAfterAttempt(
  currentMastery: number,
  nextAvailableAt: number | undefined,
  scoreTotal: number,
  now: number
): {
  newMastery: number;
  newNextAvailableAt: number | undefined;
  isBlockedByTier: boolean;
} {
  let currentTierLimit = 1000;
  let waitDays = 0;

  if (currentMastery < 250) {
    currentTierLimit = 250;
    waitDays = 2;
  } else if (currentMastery === 250) {
    if (nextAvailableAt === undefined || isSydneyDateReached(nextAvailableAt, now)) {
      currentTierLimit = 500;
      waitDays = 4;
    } else {
      currentTierLimit = 250;
    }
  } else if (currentMastery < 500) {
    currentTierLimit = 500;
    waitDays = 4;
  } else if (currentMastery === 500) {
    if (nextAvailableAt === undefined || isSydneyDateReached(nextAvailableAt, now)) {
      currentTierLimit = 750;
      waitDays = 8;
    } else {
      currentTierLimit = 500;
    }
  } else if (currentMastery < 750) {
    currentTierLimit = 750;
    waitDays = 8;
  } else if (currentMastery === 750) {
    if (nextAvailableAt === undefined || isSydneyDateReached(nextAvailableAt, now)) {
      currentTierLimit = 1000;
    } else {
      currentTierLimit = 750;
    }
  }

  const theoreticalScore = currentMastery + scoreTotal;

  if (theoreticalScore <= currentTierLimit) {
    return {
      newMastery: theoreticalScore,
      newNextAvailableAt: undefined,
      isBlockedByTier: false
    };
  } else {
    if (currentTierLimit === 1000) {
      return {
        newMastery: 1000,
        newNextAvailableAt: undefined,
        isBlockedByTier: false
      };
    }
    
    // hit limit
    const isAlreadyAtLimit = currentMastery === currentTierLimit;
    return {
      newMastery: currentTierLimit,
      newNextAvailableAt: isAlreadyAtLimit ? undefined : addSydneyCalendarDays(now, waitDays),
      isBlockedByTier: true
    };
  }
}

// 依 v1 規格：mastery 越高，越常出現難度高的題型（情境任務、圖片）
const pickPromptTypeByMastery = (available: PromptType[], mastery: number): PromptType => {
    let weights: Record<string, number>;
    if (mastery < 400) weights = { qaQuestion: 70, situationalPrompt: 20, imageUrl: 10 };
    else if (mastery < 700) weights = { qaQuestion: 40, situationalPrompt: 35, imageUrl: 25 };
    else weights = { qaQuestion: 15, situationalPrompt: 40, imageUrl: 45 };

    const total = available.reduce((sum, t) => sum + (weights[t] || 0), 0);
    let r = Math.random() * total;
    for (const t of available) {
        r -= weights[t] || 0;
        if (r < 0) return t;
    }
    return available[available.length - 1];
};

export default function PatternPracticeSessionView({ pattern, sentenceIndex, groupIndex, onBack, onNext, isLastSentence, progressLabel, onScored, progress, onMasteryUpdated }: Props) {
    const [sessionState, setSessionState] = useState<SessionState>('idle');
    const [activePromptType, setActivePromptType] = useState<PromptType | null>(null);
    const [errorMsg, setErrorMsg] = useState<string | null>(null);
    const [scoreResult, setScoreResult] = useState<PracticeScores | null>(null);
    const [userText, setUserText] = useState<string>('');
    // 這次由哪個模型轉錄（結果頁小字顯示，診斷用）
    const [transcriber, setTranscriber] = useState('');
    const [currentMastery, setCurrentMastery] = useState<number>(0);
    const [tierBlockInfo, setTierBlockInfo] = useState<{ blocked: boolean, waitDays: number } | null>(null);
    const [isPromptReady, setIsPromptReady] = useState<boolean>(true);
    const [promptStatus, setPromptStatus] = useState<'idle' | 'generating' | 'error'>('idle');
    const [promptError, setPromptError] = useState<string | null>(null);
    const [generatedPrompts, setGeneratedPrompts] = useState<{ qaQuestion: string; situationalPrompt: string } | null>(null);
    const autoGeneratedForRef = useRef<string | null>(null);
    const imageRequestedForRef = useRef<string | null>(null);
    const speechAudioRef = useRef<HTMLAudioElement>(null);
    const answerAudioUrlRef = useRef<string | null>(null);
    const sessionStateRef = useRef<SessionState>('idle');
    const [promptAudioUrl, setPromptAudioUrl] = useState<string | null>(null);
    const [promptAudioLoading, setPromptAudioLoading] = useState(false);
    const [hasAnswerAudio, setHasAnswerAudio] = useState(false);
    // 結果畫面：這次真的寫入的熟練度增加量（>0 才顯示）、是否一字不差、總分跑動
    const [masteryGain, setMasteryGain] = useState<number | null>(null);
    const [lastExact, setLastExact] = useState(false);
    const [displayTotal, setDisplayTotal] = useState(0);
    const [showGain, setShowGain] = useState(false);

    const mediaRecorderRef = useRef<MediaRecorder | null>(null);
    const streamRef = useRef<MediaStream | null>(null);
    const audioContextRef = useRef<AudioContext | null>(null);
    const analyserRef = useRef<AnalyserNode | null>(null);
    const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
    const silenceTimerRef = useRef<number>(0);
    // 是否已經偵測到開口：開口前給較長的等待時間（回想句子），開口後中途停頓也不會太快被切斷
    const heardSpeechRef = useRef(false);
    const lastSoundAtRef = useRef(0);
    const requestAnimationFrameRef = useRef<number>(0);
    const audioChunksRef = useRef<Blob[]>([]);
    const recordingStartTimeRef = useRef<number>(0);
    const recordedAudioRef = useRef<HTMLAudioElement>(null);
    const playbackUrlRef = useRef<string | null>(null);
    const lastRecordingRef = useRef<{ blob: Blob; durationSec: number } | null>(null);

    const sentences = pattern.exampleSentences || [];
    const sentenceObj = sentences[sentenceIndex];

    // 目前題目要朗讀的文字（看圖題沒有文字，不朗讀）
    const currentPromptText =
        activePromptType === 'qaQuestion' ? (sentenceObj?.qaQuestion || generatedPrompts?.qaQuestion || '') :
        activePromptType === 'situationalPrompt' ? (sentenceObj?.situationalPrompt || generatedPrompts?.situationalPrompt || '') :
        '';

    const stopSpeech = () => {
        const el = speechAudioRef.current;
        if (!el) return;
        el.onended = null;
        el.pause();
    };

    // 播放一段語音；播放失敗或播完時呼叫 onEnded
    const playSpeech = (url: string, onEnded?: () => void) => {
        const el = speechAudioRef.current;
        if (!el) {
            onEnded?.();
            return;
        }
        el.onended = onEnded ? () => { el.onended = null; onEnded(); } : null;
        el.src = url;
        el.currentTime = 0;
        el.play().catch(() => {
            el.onended = null;
            onEnded?.();
        });
    };

    const initPrompt = () => {
        if (!sentenceObj) return;
        const availablePrompts: PromptType[] = [];
        if (sentenceObj.qaQuestion) availablePrompts.push('qaQuestion');
        if (sentenceObj.situationalPrompt) availablePrompts.push('situationalPrompt');
        if (sentenceObj.imageUrl) availablePrompts.push('imageUrl');

        if (availablePrompts.length === 0) {
            setIsPromptReady(false);
            setActivePromptType(null);
        } else {
            setIsPromptReady(true);
            setActivePromptType(pickPromptTypeByMastery(availablePrompts, sentenceObj.mastery || 0));
        }
        setCurrentMastery(sentenceObj.mastery || 0);
        setMasteryGain(null);
    };

    const generatePrompts = async () => {
        if (!sentenceObj || promptStatus === 'generating') return;
        setPromptStatus('generating'); setPromptError(null);
        try {
            const prompts = await generateAndSavePracticePrompts(pattern.id, sentenceObj.id, sentenceObj.text, pattern.text);
            setGeneratedPrompts(prompts);
            const available: PromptType[] = ['qaQuestion', 'situationalPrompt'];
            if (sentenceObj.imageUrl) available.push('imageUrl');
            setActivePromptType(pickPromptTypeByMastery(available, sentenceObj.mastery || 0));
            setIsPromptReady(true);
            setPromptStatus('idle');
        } catch (err: any) {
            console.error('產生題目失敗:', err);
            setPromptError(err?.message || '產生題目失敗，請稍後再試');
            setPromptStatus('error');
        }
    };

    useEffect(() => {
        stopSpeech();
        if (recordedAudioRef.current) {
            recordedAudioRef.current.pause();
            recordedAudioRef.current.currentTime = 0;
        }
        lastRecordingRef.current = null;
        if (playbackUrlRef.current) {
            URL.revokeObjectURL(playbackUrlRef.current);
            playbackUrlRef.current = null;
        }
        setSessionState('idle');
        setScoreResult(null);
        setUserText('');
        setErrorMsg(null);
        setTierBlockInfo(null);
        setPromptStatus('idle'); setPromptError(null); setGeneratedPrompts(null);
        initPrompt();
    }, [pattern.id, sentenceIndex]);

    const cleanupAudio = () => {
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

    useEffect(() => {
        return () => {
            // 離開頁面時若仍在錄音，先移除 onstop 再停止，避免離開後仍在背景評分並寫入分數
            if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
                mediaRecorderRef.current.onstop = null;
                mediaRecorderRef.current.stop();
            }
            recordedAudioRef.current?.pause();
            if (speechAudioRef.current) {
                speechAudioRef.current.onended = null;
                speechAudioRef.current.pause();
            }
            if (playbackUrlRef.current) {
                URL.revokeObjectURL(playbackUrlRef.current);
                playbackUrlRef.current = null;
            }
            cleanupAudio();
        };
    }, []);

    useEffect(() => {
        sessionStateRef.current = sessionState;
    }, [sessionState]);

    // 題目朗讀：題目文字變了就取得語音，取得後在待機狀態自動播放一次
    // （iPhone 在使用者點擊畫面前會擋下自動播放，第一題可能需要手動按「播放題目」）
    useEffect(() => {
        let cancelled = false;
        setPromptAudioUrl(null);
        if (!currentPromptText) {
            setPromptAudioLoading(false);
            return;
        }
        setPromptAudioLoading(true);
        getSpeechUrl(currentPromptText).then(url => {
            if (cancelled) return;
            setPromptAudioLoading(false);
            setPromptAudioUrl(url);
            if (url && sessionStateRef.current === 'idle') {
                playSpeech(url);
            }
        });
        return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [currentPromptText]);

    // 預先取得正確答案（原句）的語音，評分後播放
    useEffect(() => {
        let cancelled = false;
        answerAudioUrlRef.current = null;
        setHasAnswerAudio(false);
        const text = sentenceObj?.text;
        if (!text) return;
        getSpeechUrl(text).then(url => {
            if (cancelled) return;
            answerAudioUrlRef.current = url;
            setHasAnswerAudio(!!url);
        });
        return () => { cancelled = true; };
    }, [sentenceObj?.text]);

    useEffect(() => {
        if (!isPromptReady && sentenceObj && autoGeneratedForRef.current !== sentenceObj.id) {
            autoGeneratedForRef.current = sentenceObj.id;
            generatePrompts();
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isPromptReady, sentenceObj?.id]);

    // 進入練習時，幫這一組還沒有圖的句子補產看圖題圖片（同一組只觸發一次）
    useEffect(() => {
        const g = groupIndex ?? sentenceObj?.groupIndex;
        if (g === undefined || g === null) return;
        const key = `${pattern.id}::${g}`;
        if (imageRequestedForRef.current === key) return;
        imageRequestedForRef.current = key;
        const ids = (pattern.exampleSentences || []).filter(s => s.groupIndex === g).map(s => s.id);
        void requestPracticeImages(pattern.id, ids);
        // 同時預先產生這一組其他句子的題目與答案語音（目前這一句由下方當場取得）
        const others = (pattern.exampleSentences || []).filter(s => s.groupIndex === g && s.checked && s.id !== sentenceObj?.id);
        void prefetchSpeech(others.reduce<string[]>((acc, s) => acc.concat([s.qaQuestion || '', s.situationalPrompt || '', s.text || '']), []));
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [pattern.id, groupIndex, sentenceObj?.groupIndex]);

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

        if (averageVolume < 20) {
            if (silenceTimerRef.current === 0) {
                silenceTimerRef.current = Date.now();
            }
            if (shouldStopForSilence({
                now: Date.now(),
                startedAt: recordingStartTimeRef.current,
                heardSpeech: heardSpeechRef.current,
                silentSince: silenceTimerRef.current,
            })) {
                if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
                    mediaRecorderRef.current.stop();
                }
                return;
            }
        } else {
            heardSpeechRef.current = true;
            lastSoundAtRef.current = Date.now();
            silenceTimerRef.current = 0;
        }

        requestAnimationFrameRef.current = requestAnimationFrame(monitorVolume);
    };

    const runScoring = async (blob: Blob, durationSec: number) => {
        setSessionState('scoring');
        setErrorMsg(null);
        
        const file = new File([blob], 'record.webm', { type: blob.type });

        try {
            const { text: transcribedText, model } = await transcribeRecordingDetailed(file);
            setUserText(transcribedText);
            setTranscriber(transcriberLabel(model));
            const scores = calculateFinalScores(transcribedText, sentenceObj.text, durationSec);
            setScoreResult(scores);
            // 【v3.11】精準背出原句：一字不差才累加熟練度
            const isExact = canAccumulatePattern(scores);
            onScored?.(sentenceObj.id, scores.total, isExact);
            setLastExact(isExact);
            setMasteryGain(null);

            if (isExact) {
                const uid = auth.currentUser?.uid;
                if (uid) {
                    const now = Date.now();
                    let outcome: { oldMastery: number; newMastery: number; newNextAvailableAt?: number; isBlockedByTier: boolean; oldNextAvailableAt?: number } | null = null;
                    const written = await updatePatternSentences(pattern.id, (sentences) => {
                        outcome = null; // 交易可能重試：每次先清空，只留最後一次（真正提交）的結果
                        const idx = sentences.findIndex(s => s.id === sentenceObj.id);
                        if (idx < 0) return null;
                        const s = sentences[idx];
                        const oldMastery = s.mastery || 0;
                        const oldNextAvailableAt = s.nextAvailableAt;
                        const r = calculateMasteryAfterAttempt(oldMastery, oldNextAvailableAt, scores.total, now);
                        sentences[idx] = { ...s, mastery: r.newMastery, ...(r.newNextAvailableAt !== undefined ? { nextAvailableAt: r.newNextAvailableAt } : {}) };
                        outcome = { oldMastery, newMastery: r.newMastery, newNextAvailableAt: r.newNextAvailableAt, isBlockedByTier: r.isBlockedByTier, oldNextAvailableAt };
                        return sentences;
                    });
                    const committed = written !== null ? (outcome as typeof outcome) : null;
                    if (committed) {
                        const o = committed as NonNullable<typeof outcome>;
                        setCurrentMastery(o.newMastery);
                        const gain = o.newMastery - o.oldMastery;
                        setMasteryGain(gain > 0 ? gain : null);
                        onMasteryUpdated?.(sentenceObj.id, o.oldMastery, o.newMastery);
                        if (o.isBlockedByTier) {
                            const targetDate = o.newNextAvailableAt || o.oldNextAvailableAt || now;
                            const waitDays = getSydneyCalendarDaysDiff(now, targetDate);
                            setTierBlockInfo({ blocked: true, waitDays: waitDays > 0 ? waitDays : 1 });
                        } else {
                            setTierBlockInfo(null);
                        }
                    }
                }
            }
            setSessionState('scored');

            if (recordedAudioRef.current) {
                if (playbackUrlRef.current) {
                    URL.revokeObjectURL(playbackUrlRef.current);
                }
                const url = URL.createObjectURL(blob);
                playbackUrlRef.current = url;
                recordedAudioRef.current.src = url;
                recordedAudioRef.current.currentTime = 0;
                // 先播放正確答案，播完再播放自己的錄音；沒有答案語音時直接播錄音
                const playRecording = () => {
                    recordedAudioRef.current?.play().catch(() => {});
                };
                const answerUrl = answerAudioUrlRef.current;
                if (answerUrl) {
                    playSpeech(answerUrl, playRecording);
                } else {
                    playRecording();
                }
            }
        } catch (err: any) {
            console.error("Scoring error:", err);
            setErrorMsg("語音辨識或評分失敗，可以重試評分或重新錄一次");
            setSessionState('scoreError');
        }
    };

    const startRecording = async () => {
        // iPhone 只允許「使用者點擊當下」啟動播放，所以必須在任何 await 之前先解鎖錄音播放器
        if (recordedAudioRef.current) {
            recordedAudioRef.current.src = SILENT_AUDIO;
            recordedAudioRef.current.play().then(() => recordedAudioRef.current?.pause()).catch(() => {});
        }
        if (speechAudioRef.current) {
            const speechEl = speechAudioRef.current;
            speechEl.onended = null;
            speechEl.src = SILENT_AUDIO;
            speechEl.play().then(() => speechEl.pause()).catch(() => {});
        }
        setErrorMsg(null);
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
            streamRef.current = stream;
            
            const mimeType = getSupportedMimeType();
            const mediaRecorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
            mediaRecorderRef.current = mediaRecorder;
            audioChunksRef.current = [];
            silenceTimerRef.current = 0;
            heardSpeechRef.current = false;
            lastSoundAtRef.current = 0;

            const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
            const audioCtx = new AudioContextClass();
            audioContextRef.current = audioCtx;

            const source = audioCtx.createMediaStreamSource(stream);
            sourceRef.current = source;
            const analyser = audioCtx.createAnalyser();
            analyser.fftSize = 256;
            analyserRef.current = analyser;
            source.connect(analyser);

            mediaRecorder.ondataavailable = (e) => {
                if (e.data.size > 0) {
                    audioChunksRef.current.push(e.data);
                }
            };

            mediaRecorder.onstop = () => {
                cleanupAudio();
                // 評分時長＝最後出聲 + 1.5 秒（等同舊版自動停止的長度），不因新的 2.5 秒等待而降低流暢度
                const durationSec = practiceDurationSec(recordingStartTimeRef.current, lastSoundAtRef.current, Date.now());
                const blob = new Blob(audioChunksRef.current, { type: mediaRecorder.mimeType || 'audio/webm' });
                lastRecordingRef.current = { blob, durationSec };
                runScoring(blob, durationSec);
            };

            mediaRecorder.start();
            recordingStartTimeRef.current = Date.now();
            setSessionState('recording');
            monitorVolume();

        } catch (err: any) {
            console.error("Recording error:", err);
            setErrorMsg("無法取得麥克風權限");
            setSessionState('idle');
        }
    };

    // 結果畫面：總分從 0 跑上去，跑完再出現金色 +N；減少動態效果時直接顯示
    useEffect(() => {
        if (sessionState !== 'scored' || !scoreResult) return;
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
            const p = (now - start) / duration;
            setDisplayTotal(countUpValue(0, target, p));
            if (p < 1) raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
        const gainTimer = window.setTimeout(() => setShowGain(true), duration + 300);
        return () => {
            cancelAnimationFrame(raf);
            window.clearTimeout(gainTimer);
        };
    }, [sessionState, scoreResult]);

    const handleReplayPrompt = () => {
        if (promptAudioUrl) {
            recordedAudioRef.current?.pause();
            playSpeech(promptAudioUrl);
        }
    };

    const handleReplayAnswer = () => {
        recordedAudioRef.current?.pause();
        if (answerAudioUrlRef.current) {
            playSpeech(answerAudioUrlRef.current);
        }
    };

    const handleReplayRecording = () => {
        stopSpeech();
        if (recordedAudioRef.current) {
            recordedAudioRef.current.currentTime = 0;
            recordedAudioRef.current.play().catch(() => {});
        }
    };

    const handleRetry = () => {
        stopSpeech();
        if (recordedAudioRef.current) {
            recordedAudioRef.current.pause();
        }
        lastRecordingRef.current = null;
        if (playbackUrlRef.current) {
            URL.revokeObjectURL(playbackUrlRef.current);
            playbackUrlRef.current = null;
        }
        setErrorMsg(null);
        setScoreResult(null);
        setUserText('');
        setTierBlockInfo(null);
        setMasteryGain(null);
        setSessionState('idle');
        initPrompt();
    };

    const promptText = activePromptType === 'qaQuestion' ? (sentenceObj?.qaQuestion || generatedPrompts?.qaQuestion)
        : activePromptType === 'situationalPrompt' ? (sentenceObj?.situationalPrompt || generatedPrompts?.situationalPrompt)
        : '';
    const scored = sessionState === 'scored' && !!scoreResult;
    const gainShown = scored && masteryGain !== null && masteryGain > 0;
    const progressPct = progress && progress.total > 0 ? Math.min(100, (progress.done / progress.total) * 100) : null;

    return (
        <div className="@container flex h-full min-h-0 flex-col overflow-y-auto">
            <audio ref={recordedAudioRef} className="hidden" preload="auto" />
            <audio ref={speechAudioRef} className="hidden" preload="auto" />

            <header className="flex items-center gap-2 px-2 pt-2 sm:px-5 lg:px-9 lg:pt-6">
                <IconButton aria-label="返回" onClick={onBack}>
                    <ChevronLeft size={22} aria-hidden="true" />
                </IconButton>
                <div className="min-w-0 flex-1">
                    <h2 className="truncate text-[15px] font-medium tracking-wide text-ink">念出來練習</h2>
                    {progressLabel && <p className="text-[13px] text-muted">{progressLabel}</p>}
                </div>
            </header>
            {progressPct !== null && (
                <div className="mx-6 mt-4 h-0.5 rounded-full bg-line sm:mx-8 lg:mx-12" aria-hidden="true">
                    <div className="h-full rounded-full bg-accent transition-[width] duration-[var(--dur-base)]" style={{ width: `${progressPct}%` }} />
                </div>
            )}

            <main className="flex flex-1 flex-col px-7 pt-8 pb-6 sm:px-10 lg:px-14 lg:pt-10">
                {!isPromptReady ? (
                    <div className="flex flex-1 flex-col items-center justify-center gap-4 py-10 text-center" aria-live="polite">
                        {promptStatus === 'error' ? (
                            <>
                                <p role="alert" className="flex items-start gap-2 text-[15px] font-medium text-danger">
                                    <AlertCircle size={18} className="mt-0.5 shrink-0" aria-hidden="true" />
                                    {promptError || '產生題目失敗，請稍後再試'}
                                </p>
                                <div className="flex flex-wrap justify-center gap-3">
                                    <Button onClick={generatePrompts}>再試一次</Button>
                                    <Button variant="secondary" onClick={isLastSentence ? onBack : onNext}>跳過這題</Button>
                                    <Button variant="secondary" onClick={onBack}>返回</Button>
                                </div>
                            </>
                        ) : (
                            <>
                                <Loader2 size={28} className="animate-spin text-accent" aria-hidden="true" />
                                <p className="text-lg font-bold text-ink">正在準備題目…</p>
                                <p className="text-[13px] text-muted">第一次練習這句需要幾秒鐘</p>
                            </>
                        )}
                    </div>
                ) : (
                    <div className="grid w-full max-w-[680px] flex-1 grid-cols-1 content-start gap-8 @[60rem]:max-w-none @[60rem]:grid-cols-[minmax(0,1fr)_440px] @[60rem]:gap-x-14">
                        {/* 題目 */}
                        <section className="flex min-w-0 flex-col gap-4 @[60rem]:col-start-1 @[60rem]:row-start-1 @[60rem]:gap-5">
                            <span className="flex items-center gap-2 text-[13px] text-muted">
                                <span className="h-px w-[18px] bg-muted" aria-hidden="true" />
                                {activePromptType ? PROMPT_LABEL[activePromptType] : ''}
                            </span>
                            {activePromptType === 'imageUrl' ? (
                                <img src={sentenceObj.imageUrl} alt="情境圖" className={`w-full max-w-md rounded-2xl object-cover ${scored ? 'max-h-40' : 'max-h-72'}`} referrerPolicy="no-referrer" />
                            ) : (
                                <p
                                    lang={activePromptType === 'qaQuestion' ? 'en' : undefined}
                                    className={`break-words ${activePromptType === 'qaQuestion' ? 'font-reading tracking-[-0.005em]' : ''} ${
                                        scored
                                            ? 'text-[15px] leading-relaxed text-muted @[60rem]:text-[22px] @[60rem]:leading-[1.5] @[60rem]:text-ink'
                                            : activePromptType === 'qaQuestion' ? 'text-[30px] leading-[1.32] text-ink lg:text-[34px]' : 'text-[22px] leading-[1.6] text-ink'
                                    }`}
                                >
                                    {promptText}
                                </p>
                            )}
                            {(activePromptType === 'qaQuestion' || activePromptType === 'situationalPrompt') && !scored && (
                                <Button
                                    variant="secondary"
                                    size="sm"
                                    onClick={handleReplayPrompt}
                                    disabled={!promptAudioUrl}
                                    className="self-start"
                                    icon={promptAudioLoading ? <Loader2 size={15} className="animate-spin" aria-hidden="true" /> : <Volume2 size={16} aria-hidden="true" />}
                                >
                                    {promptAudioLoading ? '語音準備中…' : promptAudioUrl ? '播放題目' : '語音暫時無法使用'}
                                </Button>
                            )}

                            {!scored && (
                                <div className="mt-4 flex max-w-[280px] flex-col gap-2.5">
                                    <div className="flex items-baseline justify-between">
                                        <span className="text-[13px] text-muted">目前熟練度</span>
                                        <span className="font-reading text-[17px] text-ink tabular-nums">
                                            {currentMastery}<span className="font-sans text-[13px] text-muted"> / 1000</span>
                                        </span>
                                    </div>
                                    <ProgressBar value={Math.min(currentMastery, 1000)} max={1000} label="目前熟練度" tone={currentMastery >= 1000 ? 'gold' : 'accent'} />
                                    <span className="text-[13px] leading-relaxed text-muted">說出你造的那句話，一字不差才算數</span>
                                </div>
                            )}

                        </section>

                        {/* 狀態與結果 */}
                        <section aria-live="polite" className="flex min-w-0 flex-col gap-6 @[60rem]:col-start-2 @[60rem]:row-start-1">
                            {errorMsg && (
                                <div role="alert" className="flex items-start gap-3 rounded-xl bg-danger/10 px-4 py-3.5 text-sm text-danger">
                                    <AlertCircle size={18} className="mt-0.5 shrink-0" aria-hidden="true" />
                                    <span className="font-medium leading-relaxed break-words">{errorMsg}</span>
                                </div>
                            )}

                            {scored && scoreResult && (
                                <>
                                    <div className="flex items-end gap-7">
                                        <div className="relative flex flex-col">
                                            {lastExact && (
                                                <svg width="148" height="40" viewBox="0 0 148 40" aria-hidden="true" className="pointer-events-none absolute -top-[18px] -left-3.5 animate-sparkle">
                                                    <circle cx="8" cy="22" r="2" className="fill-gold" />
                                                    <circle cx="132" cy="10" r="2.5" className="fill-gold" />
                                                    <path d="M118 30 l3 -6 l3 6 l-3 6 z" className="fill-gold" opacity="0.8" />
                                                    <circle cx="40" cy="4" r="1.5" className="fill-accent" />
                                                </svg>
                                            )}
                                            <span className="font-reading text-[88px] leading-[0.9] tracking-[-0.03em] text-ink tabular-nums lg:text-[96px]" aria-hidden="true">{displayTotal}</span>
                                            <span className="sr-only">總分 {scoreResult.total}</span>
                                            <span className="mt-2.5 text-[13px] text-muted">{lastExact ? '總分・一字不差' : '總分'}</span>
                                        </div>
                                        <div className="flex flex-1 flex-col gap-3.5 pb-1.5">
                                            {([['內容', scoreResult.content], ['流暢', scoreResult.fluency]] as const).map(([label, v]) => (
                                                <div key={label} className="flex flex-col gap-1.5">
                                                    <div className="flex justify-between text-[13px]"><span className="text-muted">{label}</span><span className="text-ink tabular-nums">{v}</span></div>
                                                    <ProgressBar value={Number(v) || 0} max={100} label={label} size="sm" />
                                                </div>
                                            ))}
                                        </div>
                                    </div>

                                    {scoreResult.errors > 0 && (
                                        <p className="flex items-center gap-2 rounded-xl bg-warn/10 px-3.5 py-3 text-sm font-medium text-warn">
                                            <AlertCircle size={16} className="shrink-0" aria-hidden="true" />
                                            有 {scoreResult.errors} 個字不一致，熟練度未增加
                                        </p>
                                    )}

                                    <div className="flex flex-col gap-2.5 rounded-[14px] bg-surface-2 px-[18px] py-4 dark:bg-surface">
                                        <div className="flex items-baseline justify-between gap-3">
                                            <span className="text-[13px] text-muted">目前熟練度</span>
                                            <span className="text-sm">
                                                {gainShown && (
                                                    <span className={`mr-2.5 font-medium text-gold transition-opacity duration-500 ${showGain ? 'opacity-100' : 'opacity-0'}`}>+{masteryGain}</span>
                                                )}
                                                <span className="font-reading text-[17px] text-ink tabular-nums">{currentMastery}</span>
                                                <span className="text-muted"> / 1000</span>
                                            </span>
                                        </div>
                                        <ProgressBar
                                            value={Math.min(currentMastery, 1000)}
                                            max={1000}
                                            gain={gainShown && showGain ? masteryGain! : 0}
                                            label="目前熟練度"
                                            tone={currentMastery >= 1000 ? 'gold' : 'accent'}
                                        />
                                        {tierBlockInfo?.blocked && (
                                            <p className="mt-1 text-[13px] leading-relaxed text-warn">
                                                已到目前階段練習上限，{tierBlockInfo.waitDays}天後可以繼續往上練習到更高分
                                            </p>
                                        )}
                                    </div>

                                </>
                            )}
                        </section>

                        {/* 目標原句（手機排在分數之後；桌機在左欄下方） */}
                            {scored && (
                                <div className="flex min-w-0 flex-col gap-2.5 @[60rem]:col-start-1 @[60rem]:row-start-2 @[60rem]:self-end @[60rem]:border-t @[60rem]:border-line @[60rem]:pt-7">
                                    <span className="text-xs text-muted">目標原句</span>
                                    <p lang="en" className="font-reading text-[22px] leading-[1.45] text-ink break-words @[60rem]:text-[30px] @[60rem]:leading-[1.35]">{sentenceObj.text}</p>
                                    {hasAnswerAudio && (
                                        <button
                                            type="button"
                                            onClick={handleReplayAnswer}
                                            className="mt-1 flex min-h-10 items-center gap-2 self-start rounded-full bg-accent-soft px-3.5 text-[13px] text-ink transition-[filter] hover:brightness-[0.97] dark:hover:brightness-110 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                                        >
                                            <Volume2 size={15} aria-hidden="true" />
                                            重播正確答案
                                        </button>
                                    )}
                                </div>
                            )}

                        {/* 您念的內容與逐字比對 */}
                        {scored && scoreResult && (
                                    <div className="flex min-w-0 flex-col gap-2 @[60rem]:col-start-2 @[60rem]:row-start-2">
                                        <span className="flex flex-wrap items-baseline justify-between gap-x-3 text-xs text-muted">
                                            <span>您念的內容 (語音辨識)</span>
                                            {transcriber && <span className="text-[11px] text-muted/80">語音辨識：{transcriber}</span>}
                                        </span>
                                        <p lang="en" className="text-[15px] leading-relaxed text-ink break-words">{userText}</p>
                                        <WordDiffView diff={scoreResult.diff} />
                                        <button
                                            type="button"
                                            onClick={handleReplayRecording}
                                            className="flex min-h-10 items-center gap-2 self-start rounded-full px-1 text-sm text-accent transition-opacity hover:opacity-80 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                                        >
                                            <RotateCcw size={17} aria-hidden="true" />
                                            重播我的錄音
                                        </button>
                                    </div>
                        )}
                    </div>
                )}
            </main>

            {/* 動作列：手機固定在練習畫面捲動區底部，題目很長也按得到 */}
            {isPromptReady && (
                <div className="sticky bottom-0 z-10 border-t border-line/70 bg-ground/95 @[60rem]:static px-6 pt-4 pb-[max(1.25rem,env(safe-area-inset-bottom))] backdrop-blur-md sm:px-10 lg:px-14 @[60rem]:border-t-0 @[60rem]:bg-transparent @[60rem]:backdrop-blur-none">
                    <div className={`max-w-[680px] ${scored || sessionState === 'scoreError'
                        // 有結果時按鈕在右欄結果下方；待錄音、錄音中、評分中時錄音鈕在左欄題目下方
                        ? '@[60rem]:ml-auto @[60rem]:w-[440px] @[60rem]:max-w-none'
                        : '@[60rem]:mr-auto @[60rem]:w-[min(100%,560px)]'}`}>
                        {sessionState === 'idle' && (
                            <div className="flex flex-col items-center gap-2">
                                <button
                                    type="button"
                                    onClick={startRecording}
                                    aria-label="開始錄音"
                                    className="flex size-20 items-center justify-center rounded-full bg-accent text-on-accent shadow-[0_12px_28px_-10px_rgb(31_122_92/0.6)] transition-[filter,transform] hover:brightness-110 active:scale-95 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent dark:shadow-none"
                                >
                                    <Mic size={30} aria-hidden="true" />
                                </button>
                                <button
                                    type="button"
                                    onClick={generatePrompts}
                                    disabled={promptStatus === 'generating'}
                                    className="flex min-h-10 items-center gap-1.5 rounded-full px-3 text-[13px] text-muted transition-colors hover:text-ink disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-accent"
                                >
                                    {promptStatus === 'generating'
                                        ? <><Loader2 size={14} className="animate-spin" aria-hidden="true" /><span>產生中…</span></>
                                        : <><RefreshCw size={14} aria-hidden="true" /><span>換一組題目</span></>}
                                </button>
                                {promptStatus === 'error' && promptError && (
                                    <p className="text-center text-xs font-medium text-danger">{promptError}</p>
                                )}
                            </div>
                        )}

                        {sessionState === 'recording' && (
                            <div className="flex min-h-[124px] flex-col items-center justify-center gap-3" aria-live="polite">
                                <span className="flex size-20 items-center justify-center rounded-full border-2 border-danger/60" aria-hidden="true">
                                    <span className="size-4 rounded-full bg-danger animate-breathe" />
                                </span>
                                <p className="text-sm font-medium text-ink">聆聽中... (講完自動停止)</p>
                            </div>
                        )}

                        {sessionState === 'scoring' && (
                            <div className="flex min-h-[124px] flex-col items-center justify-center gap-3" aria-live="polite">
                                <Loader2 size={30} className="animate-spin text-accent" aria-hidden="true" />
                                <p className="text-sm font-medium text-ink">分析語音與評分中...</p>
                            </div>
                        )}

                        {sessionState === 'scoreError' && (
                            <div className="grid grid-cols-2 gap-3">
                                <Button variant="secondary" size="lg" onClick={handleRetry} icon={<RefreshCw size={17} aria-hidden="true" />} className="px-4">
                                    重新錄一次
                                </Button>
                                <Button
                                    size="lg"
                                    onClick={() => {
                                        if (lastRecordingRef.current) {
                                            runScoring(lastRecordingRef.current.blob, lastRecordingRef.current.durationSec);
                                        }
                                    }}
                                    icon={<RefreshCw size={17} aria-hidden="true" />}
                                    className="px-4"
                                >
                                    重試評分
                                </Button>
                            </div>
                        )}

                        {scored && (
                            <div className="grid grid-cols-2 gap-3">
                                <Button variant="secondary" size="lg" onClick={handleRetry} className="px-4">
                                    再念一次
                                </Button>
                                {isLastSentence ? (
                                    <Button size="lg" onClick={onNext} icon={<Check size={18} aria-hidden="true" />} className="px-4">
                                        完成練習
                                    </Button>
                                ) : (
                                    <Button size="lg" onClick={onNext} className="px-4">
                                        下一句
                                        <ChevronRight size={18} aria-hidden="true" />
                                    </Button>
                                )}
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}
