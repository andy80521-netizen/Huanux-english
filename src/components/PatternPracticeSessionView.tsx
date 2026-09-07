import React, { useState, useRef, useEffect } from 'react';
import { LanguagePattern, PatternExampleSentence } from '../types';
import { getSupportedMimeType } from '../utils/mediaRecorder';
import { transcribeRecording } from '../services/gemini';
import { calculateFinalScores } from '../utils/scoring';
import { auth, db, appId } from '../firebase';
import { doc, getDoc, updateDoc } from 'firebase/firestore';
import { Mic, Loader2, Play, RefreshCw, ChevronRight, Check, ChevronLeft } from 'lucide-react';
import { isSydneyDateReached, addSydneyCalendarDays, getSydneyCalendarDaysDiff } from '../utils/sydneyTime';

interface Props {
  pattern: LanguagePattern;
  sentenceIndex: number;
  groupIndex?: number;
  onBack: () => void;
  onNext: () => void;
  isLastSentence: boolean;
}

type SessionState = 'idle' | 'recording' | 'scoring' | 'scored';

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

export default function PatternPracticeSessionView({ pattern, sentenceIndex, groupIndex, onBack, onNext, isLastSentence }: Props) {
    const [sessionState, setSessionState] = useState<SessionState>('idle');
    const [activePromptType, setActivePromptType] = useState<PromptType | null>(null);
    const [errorMsg, setErrorMsg] = useState<string | null>(null);
    const [scoreResult, setScoreResult] = useState<{ pronunciation: number, fluency: number, stress: number, total: number } | null>(null);
    const [userText, setUserText] = useState<string>('');
    const [currentMastery, setCurrentMastery] = useState<number>(0);
    const [tierBlockInfo, setTierBlockInfo] = useState<{ blocked: boolean, waitDays: number } | null>(null);
    const [isPromptReady, setIsPromptReady] = useState<boolean>(true);

    const mediaRecorderRef = useRef<MediaRecorder | null>(null);
    const streamRef = useRef<MediaStream | null>(null);
    const audioContextRef = useRef<AudioContext | null>(null);
    const analyserRef = useRef<AnalyserNode | null>(null);
    const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
    const silenceTimerRef = useRef<number>(0);
    const requestAnimationFrameRef = useRef<number>(0);
    const audioChunksRef = useRef<Blob[]>([]);
    const recordingStartTimeRef = useRef<number>(0);

    const sentences = pattern.exampleSentences || [];
    const sentenceObj = sentences[sentenceIndex];

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
            const randomIndex = Math.floor(Math.random() * availablePrompts.length);
            setActivePromptType(availablePrompts[randomIndex]);
        }
        setCurrentMastery(sentenceObj.mastery || 0);
    };

    useEffect(() => {
        setSessionState('idle');
        setScoreResult(null);
        setUserText('');
        setErrorMsg(null);
        setTierBlockInfo(null);
        initPrompt();
    }, [sentenceIndex]);

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
        return cleanupAudio;
    }, []);

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
            } else if (Date.now() - silenceTimerRef.current > 1500) {
                // Silence detected for 1.5 seconds
                if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
                    mediaRecorderRef.current.stop();
                }
                return;
            }
        } else {
            silenceTimerRef.current = 0;
        }

        requestAnimationFrameRef.current = requestAnimationFrame(monitorVolume);
    };

    const startRecording = async () => {
        setErrorMsg(null);
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
            streamRef.current = stream;
            
            const mimeType = getSupportedMimeType();
            const mediaRecorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
            mediaRecorderRef.current = mediaRecorder;
            audioChunksRef.current = [];
            silenceTimerRef.current = 0;

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

            mediaRecorder.onstop = async () => {
                cleanupAudio();
                const durationSec = (Date.now() - recordingStartTimeRef.current) / 1000;
                setSessionState('scoring');
                
                const blob = new Blob(audioChunksRef.current, { type: mediaRecorder.mimeType || 'audio/webm' });
                const file = new File([blob], 'record.webm', { type: blob.type });

                try {
                    const transcribedText = await transcribeRecording(file);
                    setUserText(transcribedText);
                    const scores = calculateFinalScores(transcribedText, sentenceObj.text, durationSec);
                    setScoreResult(scores);

                    if (scores.total >= 70) {
                        const uid = auth.currentUser?.uid;
                        if (uid) {
                            const docRef = doc(db, `artifacts/${appId}/users/${uid}/languagePatterns`, pattern.id);
                            const snap = await getDoc(docRef);
                            if (snap.exists()) {
                                const data = snap.data();
                                const latestSentences: PatternExampleSentence[] = data.exampleSentences || [];
                                const targetIndex = latestSentences.findIndex(s => s.id === sentenceObj.id);
                                if (targetIndex >= 0) {
                                    const sentenceData = latestSentences[targetIndex];
                                    const oldMastery = sentenceData.mastery || 0;
                                    const oldNextAvailableAt = sentenceData.nextAvailableAt;
                                    const now = Date.now();
                                    
                                    const { newMastery, newNextAvailableAt, isBlockedByTier } = calculateMasteryAfterAttempt(
                                        oldMastery,
                                        oldNextAvailableAt,
                                        scores.total,
                                        now
                                    );
                                    
                                    sentenceData.mastery = newMastery;
                                    const updatePayload: any = { exampleSentences: latestSentences };
                                    
                                    if (newNextAvailableAt !== undefined) {
                                        sentenceData.nextAvailableAt = newNextAvailableAt;
                                    }
                                    
                                    await updateDoc(docRef, updatePayload);
                                    setCurrentMastery(newMastery);
                                    
                                    if (isBlockedByTier) {
                                        const targetDate = newNextAvailableAt || oldNextAvailableAt || now;
                                        const waitDays = getSydneyCalendarDaysDiff(now, targetDate);
                                        setTierBlockInfo({ blocked: true, waitDays: waitDays > 0 ? waitDays : 1 });
                                    } else {
                                        setTierBlockInfo(null);
                                    }
                                }
                            }
                        }
                    }
                    setSessionState('scored');
                } catch (err: any) {
                    console.error("Scoring error:", err);
                    setErrorMsg("語音辨識或評分失敗，請重試");
                    setSessionState('idle');
                }
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

    const handleRetry = () => {
        setScoreResult(null);
        setUserText('');
        setTierBlockInfo(null);
        setSessionState('idle');
        initPrompt();
    };

    return (
        <div className="flex flex-col h-full bg-slate-50 dark:bg-slate-950 p-6 overflow-y-auto pb-20">
            <div className="flex items-center gap-4 mb-8">
                <button 
                    onClick={onBack}
                    className="p-2 bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 rounded-full shadow-sm hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                >
                    <ChevronLeft size={24} />
                </button>
                <div className="flex-1">
                    <h2 className="text-xl font-black text-slate-800 dark:text-white line-clamp-1">
                        念出來練習
                    </h2>
                </div>
            </div>

            {!isPromptReady ? (
                <div className="bg-white dark:bg-slate-900 rounded-2xl p-8 shadow-sm border border-slate-200 dark:border-slate-800 flex flex-col items-center text-center">
                    <p className="text-slate-500 dark:text-slate-400 font-bold mb-6">
                        出題內容準備中，請稍後再試。
                    </p>
                    <button
                        onClick={onBack}
                        className="px-6 py-3 bg-indigo-600 text-white rounded-xl font-bold shadow-md hover:bg-indigo-700 transition-colors"
                    >
                        返回
                    </button>
                </div>
            ) : (
                <>
                    <div className="bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-100 dark:border-indigo-800 rounded-2xl p-6 mb-8 flex flex-col items-center">
                        {activePromptType === 'qaQuestion' && (
                            <>
                                <p className="text-sm font-bold text-indigo-600 dark:text-indigo-400 mb-2">回答這個問題：</p>
                                <p className="text-xl font-black text-slate-800 dark:text-slate-100 text-center">{sentenceObj.qaQuestion}</p>
                            </>
                        )}
                        {activePromptType === 'situationalPrompt' && (
                            <>
                                <p className="text-sm font-bold text-indigo-600 dark:text-indigo-400 mb-2">情境任務：</p>
                                <p className="text-xl font-black text-slate-800 dark:text-slate-100 text-center">{sentenceObj.situationalPrompt}</p>
                            </>
                        )}
                        {activePromptType === 'imageUrl' && (
                            <>
                                <p className="text-sm font-bold text-indigo-600 dark:text-indigo-400 mb-4">看圖說出對應的句子：</p>
                                <img src={sentenceObj.imageUrl} alt="情境圖" className="max-w-full h-48 object-cover rounded-xl" referrerPolicy="no-referrer" />
                            </>
                        )}
                    </div>

                    {errorMsg && (
                        <div className="bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 text-sm px-4 py-3 rounded-xl border border-red-100 dark:border-red-800 font-bold mb-6 text-center">
                            {errorMsg}
                        </div>
                    )}

                    {sessionState === 'idle' && (
                        <div className="flex justify-center mt-4">
                            <button
                                onClick={startRecording}
                                className="w-20 h-20 bg-indigo-600 text-white rounded-full shadow-lg hover:bg-indigo-700 hover:scale-105 active:scale-95 transition-all flex items-center justify-center"
                            >
                                <Mic size={32} />
                            </button>
                        </div>
                    )}

                    {sessionState === 'recording' && (
                        <div className="flex flex-col items-center justify-center mt-4 gap-4">
                            <div className="w-20 h-20 bg-red-500 text-white rounded-full shadow-lg animate-pulse flex items-center justify-center">
                                <Mic size={32} />
                            </div>
                            <p className="text-sm font-bold text-red-500">聆聽中... (講完自動停止)</p>
                        </div>
                    )}

                    {sessionState === 'scoring' && (
                        <div className="flex flex-col items-center justify-center mt-4 gap-4">
                            <div className="w-20 h-20 bg-amber-500 text-white rounded-full shadow-lg flex items-center justify-center">
                                <Loader2 size={32} className="animate-spin" />
                            </div>
                            <p className="text-sm font-bold text-amber-600 dark:text-amber-500">分析語音與評分中...</p>
                        </div>
                    )}

                    {sessionState === 'scored' && scoreResult && (
                        <div className="bg-white dark:bg-slate-900 rounded-2xl p-6 shadow-sm border border-slate-200 dark:border-slate-800 animate-in fade-in slide-in-from-bottom-4 duration-500">
                            <div className="flex items-center justify-center gap-4 mb-6">
                                <div className="text-center">
                                    <div className="text-4xl font-black text-indigo-600 dark:text-indigo-400">
                                        {scoreResult.total}
                                    </div>
                                    <div className="text-xs font-bold text-slate-500 mt-1">總分</div>
                                </div>
                                <div className="h-12 w-px bg-slate-200 dark:bg-slate-700"></div>
                                <div className="flex gap-4">
                                    <div className="text-center">
                                        <div className="text-xl font-bold text-slate-700 dark:text-slate-300">{scoreResult.pronunciation}</div>
                                        <div className="text-[10px] font-bold text-slate-500">發音</div>
                                    </div>
                                    <div className="text-center">
                                        <div className="text-xl font-bold text-slate-700 dark:text-slate-300">{scoreResult.fluency}</div>
                                        <div className="text-[10px] font-bold text-slate-500">流暢</div>
                                    </div>
                                    <div className="text-center">
                                        <div className="text-xl font-bold text-slate-700 dark:text-slate-300">{scoreResult.stress}</div>
                                        <div className="text-[10px] font-bold text-slate-500">重音</div>
                                    </div>
                                </div>
                            </div>
                            
                            <div className="space-y-4 mb-6">
                                <div className="bg-slate-50 dark:bg-slate-950 p-4 rounded-xl border border-slate-100 dark:border-slate-800">
                                    <p className="text-xs font-bold text-slate-500 mb-1">目標原句</p>
                                    <p className="font-bold text-slate-800 dark:text-slate-200">{sentenceObj.text}</p>
                                </div>
                                <div className="bg-slate-50 dark:bg-slate-950 p-4 rounded-xl border border-slate-100 dark:border-slate-800">
                                    <p className="text-xs font-bold text-slate-500 mb-1">您的發音 (語音辨識)</p>
                                    <p className="font-bold text-slate-800 dark:text-slate-200">{userText}</p>
                                </div>
                            </div>

                            <div className="flex items-center justify-between mb-2 px-2">
                                <span className="text-sm font-bold text-slate-600 dark:text-slate-400">目前熟練度</span>
                                <span className="text-sm font-black text-indigo-600 dark:text-indigo-400">{currentMastery} / 1000</span>
                            </div>
                            {tierBlockInfo?.blocked && (
                                <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-xl p-3 mb-8 text-amber-700 dark:text-amber-400 text-sm font-bold text-center">
                                    已到目前階段練習上限，{tierBlockInfo.waitDays}天後可以繼續往上練習到更高分
                                </div>
                            )}
                            {!tierBlockInfo?.blocked && <div className="mb-8"></div>}

                            <div className="flex flex-col sm:flex-row gap-3">
                                <button
                                    onClick={handleRetry}
                                    className="flex-1 py-4 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700 rounded-xl font-bold hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors flex items-center justify-center gap-2"
                                >
                                    <RefreshCw size={18} />
                                    再念一次
                                </button>
                                
                                {isLastSentence ? (
                                    <button
                                        onClick={onNext} // Should be a finish handler if it's the last sentence
                                        className="flex-1 py-4 bg-green-600 text-white rounded-xl font-bold shadow-md hover:bg-green-700 transition-colors flex items-center justify-center gap-2"
                                    >
                                        <Check size={18} />
                                        完成練習
                                    </button>
                                ) : (
                                    <button
                                        onClick={onNext}
                                        className="flex-1 py-4 bg-indigo-600 text-white rounded-xl font-bold shadow-md hover:bg-indigo-700 transition-colors flex items-center justify-center gap-2"
                                    >
                                        下一句
                                        <ChevronRight size={18} />
                                    </button>
                                )}
                            </div>
                        </div>
                    )}
                </>
            )}
        </div>
    );
}
