import React, { useState, useRef, useEffect } from 'react';
import { Material } from '../types';
import { ChevronLeft, Mic, AlertCircle, RotateCcw, Send, Loader2, Headphones, Check } from 'lucide-react';
import { transcribeRecording } from '../services/gemini';
import { calculateShadowingScores, isShadowingPass, PracticeScores, SHADOWING_PASS_CONTENT } from '../utils/scoring';
import WordDiffView from './WordDiffView';
import { getSupportedMimeType } from '../utils/mediaRecorder';
import { auth, db, appId } from '../firebase';
import { doc, updateDoc } from 'firebase/firestore';
import { SILENT_AUDIO } from '../utils';
import { recordActiveSighting } from '../services/sightings';

type PracticeState = 'idle' | 'recording' | 'buffer' | 'finished' | 'scoring' | 'scored' | 'scoreError';

interface ShadowingPracticeViewProps {
    material: Material;
    sentenceIndex: number;
    onBack: () => void;
    onNext: () => void;
    isLastSentence: boolean;
    sightingPatternIds?: string[];
}

export default function ShadowingPracticeView({ material, sentenceIndex, onBack, onNext, isLastSentence, sightingPatternIds }: ShadowingPracticeViewProps) {
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
    };

    // Reset state when sentence changes
    useEffect(() => {
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
        setUserText('');
        setUserSpeechSec(0);
        recordingStartTimeRef.current = 0;
        lastSoundTimeRef.current = 0;
        silenceTimerRef.current = 0;
        audioChunksRef.current = [];
    }, [sentenceIndex]);

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
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
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

            mediaRecorder.onstop = () => {
                cleanupAudio();
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
            if (audioRef.current) {
                audioRef.current.currentTime = sentence.startTime;
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
        setUserText('');
        setUserSpeechSec(0);
        setError(null);
    };

    const runScoring = async (blob: Blob, speechSec: number) => {
        setPracticeState('scoring');
        setError(null);
        
        try {
            const mimeType = blob.type || 'audio/webm';
            const file = new File([blob], 'recording', { type: mimeType });
            
            const transcribedText = await transcribeRecording(file);
            setUserText(transcribedText);
            
            const originalSec = Math.max(0, sentence.endTime - sentence.startTime);
            const scores = calculateShadowingScores(transcribedText, sentence.text, speechSec, originalSec);
            setScoreResult(scores);
            
            // Save to Firestore
            const uid = auth.currentUser?.uid;
            if (!uid) {
                throw new Error("無法取得使用者資訊，請重新登入。");
            }
            
            // 【v3.11】內容 ≥ 70 且總分 ≥ 70 才累加熟練度
            const passed = isShadowingPass(scores);
            let newMastery = sentence.mastery;
            if (passed) {
                newMastery = Math.min(1000, sentence.mastery + scores.total);
            }
            
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
            }
            
        } catch (err: any) {
            console.error("Scoring error:", err);
            setError(err.message || "評分過程中發生錯誤，請重試。");
            setPracticeState('scoreError');
        }
    };

    const handleReplayRecording = () => {
        if (recordedAudioRef.current) {
            recordedAudioRef.current.currentTime = 0;
            recordedAudioRef.current.play().catch(() => {});
        }
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
                <h2 className="text-2xl font-black text-slate-800 dark:text-white line-clamp-1 flex-1">
                    跟讀練習 ({displayPosition}/{activeIndices.length})
                </h2>
            </div>

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

            {error && (
                <div className="mb-6 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 text-sm px-4 py-4 rounded-xl flex items-center gap-3 shadow-sm border border-red-100 dark:border-red-800">
                    <AlertCircle size={20} className="shrink-0" />
                    <span className="font-bold leading-relaxed">{error}</span>
                </div>
            )}

            <div className="bg-white dark:bg-slate-900 rounded-3xl p-8 shadow-sm border border-slate-200 dark:border-slate-800 text-center space-y-6 max-w-2xl mx-auto w-full">
                
                <div className="space-y-4 mb-6">
                    <p className="text-2xl md:text-3xl font-black text-slate-800 dark:text-white leading-relaxed">
                        {sentence.text}
                    </p>
                    <p className="text-lg text-slate-500 dark:text-slate-400">
                        {sentence.translation}
                    </p>
                </div>

                {/* Status Indicator */}
                <div className="min-h-24 flex flex-col justify-center items-center">
                    {practiceState === 'idle' && (
                        <p className="text-slate-500 font-bold">準備好後，點擊下方按鈕開始</p>
                    )}
                    
                    {practiceState === 'recording' && (
                        <div className="flex flex-col items-center gap-2">
                            <div className="w-4 h-4 bg-red-500 rounded-full animate-pulse shadow-[0_0_15px_rgba(239,68,68,0.6)]"></div>
                            <p className="text-red-500 font-bold">正在播放並同步錄音中...</p>
                        </div>
                    )}

                    {practiceState === 'buffer' && (
                        <div className="flex flex-col items-center gap-2">
                            <div className="text-4xl font-black text-indigo-600 dark:text-indigo-400">
                                {bufferCount}
                            </div>
                            <p className="text-slate-500 font-bold">教材播放完畢，您可以繼續補完發音</p>
                            <button
                                onClick={stopRecordingSafely}
                                className="mt-3 px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl shadow-md transition-all flex items-center gap-2 text-sm cursor-pointer"
                            >
                                <Check size={16} />
                                我念完了
                            </button>
                        </div>
                    )}
                    
                    {practiceState === 'scoring' && (
                        <div className="flex flex-col items-center justify-center gap-3 text-indigo-600 dark:text-indigo-400 font-bold py-6">
                            <Loader2 size={32} className="animate-spin" />
                            <span className="text-base">AI 評分中，請稍候...</span>
                        </div>
                    )}

                    {practiceState === 'scoreError' && (
                        <div className="w-full text-center py-4">
                            <p className="text-sm font-bold text-slate-500 dark:text-slate-400">
                                評分失敗，可以重試評分或重新錄一次
                            </p>
                        </div>
                    )}

                    {practiceState === 'scored' && scoreResult && (
                        <div className="w-full text-left space-y-6">
                            <div className="bg-indigo-50 dark:bg-indigo-900/20 p-6 rounded-2xl border border-indigo-100 dark:border-indigo-800/50">
                                <h3 className="text-center font-black text-slate-800 dark:text-slate-200 mb-6 text-xl">評分結果</h3>
                                <div className="grid grid-cols-3 gap-4 text-center">
                                    <div>
                                        <div className="text-2xl font-black text-indigo-600 dark:text-indigo-400">{scoreResult.content}</div>
                                        <div className="text-xs font-bold text-slate-500 mt-1">內容</div>
                                    </div>
                                    <div>
                                        <div className="text-2xl font-black text-indigo-600 dark:text-indigo-400">{scoreResult.fluency}</div>
                                        <div className="text-xs font-bold text-slate-500 mt-1">流暢度</div>
                                    </div>
                                    <div className="border-l border-indigo-200 dark:border-indigo-800">
                                        <div className="text-2xl font-black text-emerald-600 dark:text-emerald-400">{scoreResult.total}</div>
                                        <div className="text-xs font-bold text-slate-500 mt-1">總分</div>
                                    </div>
                                </div>
                                {!isShadowingPass(scoreResult) && (
                                    <p className="mt-4 text-center text-sm font-bold text-amber-600 dark:text-amber-400">
                                        {scoreResult.content < SHADOWING_PASS_CONTENT
                                            ? `內容未達 70 分（錯 ${scoreResult.errors} 個字），熟練度未增加`
                                            : '總分未達 70 分，熟練度未增加'}
                                    </p>
                                )}
                            </div>

                            <WordDiffView diff={scoreResult.diff} />
                            
                            <div className="bg-slate-100 dark:bg-slate-800 p-4 rounded-xl border border-slate-200 dark:border-slate-700">
                                <p className="text-xs font-bold text-slate-500 mb-2">您實際念的內容：</p>
                                <p className="text-sm text-slate-700 dark:text-slate-300 font-medium leading-relaxed">
                                    {userText || "(未偵測到語音)"}
                                </p>
                            </div>

                            <div className="flex justify-center pt-2">
                                <button
                                    onClick={handleReplayRecording}
                                    className="px-5 py-2.5 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 font-bold rounded-xl shadow-sm transition-all flex items-center gap-2 text-sm cursor-pointer"
                                >
                                    <RotateCcw size={16} />
                                    重播我的錄音
                                </button>
                            </div>
                        </div>
                    )}
                </div>

                {/* Controls */}
                <div className="pt-6 border-t border-slate-100 dark:border-slate-800">
                    {practiceState === 'idle' && (
                        <div className="space-y-4">
                            <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800/60 rounded-2xl p-4 flex items-start gap-3 text-left">
                                <Headphones className="text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" size={20} />
                                <p className="text-xs sm:text-sm font-bold text-amber-800 dark:text-amber-300 leading-relaxed">
                                    請戴上耳機練習。跟讀時會同時播放原音和錄音，沒戴耳機時麥克風會錄到原音，導致評分失準。
                                </p>
                            </div>
                            <button 
                                onClick={handleStart}
                                className="w-full py-4 bg-indigo-600 text-white font-black rounded-2xl shadow-lg shadow-indigo-200 dark:shadow-none hover:bg-indigo-700 transition-all flex items-center justify-center gap-3 text-lg"
                            >
                                <Mic size={24} />
                                開始跟讀
                            </button>
                        </div>
                    )}

                    {practiceState === 'scoreError' && (
                        <div className="flex flex-col sm:flex-row gap-4">
                            <button 
                                onClick={handleRetry}
                                className="flex-1 py-4 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-bold rounded-2xl hover:bg-slate-200 dark:hover:bg-slate-700 transition-all flex items-center justify-center gap-2"
                            >
                                <RotateCcw size={20} />
                                重新錄一次
                            </button>
                            <button 
                                onClick={() => {
                                    if (lastRecordingRef.current) {
                                        runScoring(lastRecordingRef.current.blob, lastRecordingRef.current.speechSec);
                                    }
                                }}
                                className="flex-1 py-4 bg-indigo-600 text-white font-bold rounded-2xl hover:bg-indigo-700 transition-all flex items-center justify-center gap-2"
                            >
                                <Send size={20} />
                                重試評分
                            </button>
                        </div>
                    )}

                    {practiceState === 'scored' && (
                        <div className="flex flex-col sm:flex-row gap-4">
                            <button 
                                onClick={handleRetry}
                                className="flex-1 py-4 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-bold rounded-2xl hover:bg-slate-200 dark:hover:bg-slate-700 transition-all flex items-center justify-center gap-2"
                            >
                                <RotateCcw size={20} />
                                再念一次
                            </button>
                            {!isLastSentence ? (
                                <button 
                                    onClick={onNext}
                                    className="flex-1 py-4 bg-indigo-600 text-white font-bold rounded-2xl hover:bg-indigo-700 transition-all flex items-center justify-center gap-2"
                                >
                                    下一句
                                </button>
                            ) : (
                                <div className="flex-1 py-4 bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400 font-bold rounded-2xl flex items-center justify-center">
                                    已完成本教材所有句子
                                </div>
                            )}
                        </div>
                    )}
                </div>
                
            </div>
        </div>
    );
}
