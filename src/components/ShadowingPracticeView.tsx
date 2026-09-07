import React, { useState, useRef, useEffect } from 'react';
import { Material } from '../types';
import { ChevronLeft, Mic, AlertCircle, PlaySquare, RotateCcw, Send, Loader2 } from 'lucide-react';
import { transcribeRecording } from '../services/gemini';
import { calculateFinalScores } from '../utils/scoring';
import { getSupportedMimeType } from '../utils/mediaRecorder';
import { auth, db, appId } from '../firebase';
import { doc, updateDoc } from 'firebase/firestore';

type PracticeState = 'idle' | 'recording' | 'buffer' | 'finished' | 'scoring' | 'scored';

interface ShadowingPracticeViewProps {
    material: Material;
    sentenceIndex: number;
    onBack: () => void;
    onNext: () => void;
    isLastSentence: boolean;
}

export default function ShadowingPracticeView({ material, sentenceIndex, onBack, onNext, isLastSentence }: ShadowingPracticeViewProps) {
    const sentence = material.sentences[sentenceIndex];
    
    const [practiceState, setPracticeState] = useState<PracticeState>('idle');
    const [error, setError] = useState<string | null>(null);
    const [bufferCount, setBufferCount] = useState(6);
    const [recordedBlobUrl, setRecordedBlobUrl] = useState<string | null>(null);
    const [scoreResult, setScoreResult] = useState<{ pronunciation: number, fluency: number, stress: number, total: number } | null>(null);
    const [userText, setUserText] = useState<string>('');
    const [recordingDurationSec, setRecordingDurationSec] = useState<number>(0);
    
    const recordingStartTimeRef = useRef<number>(0);
    
    const audioRef = useRef<HTMLAudioElement>(null);
    const mediaRecorderRef = useRef<MediaRecorder | null>(null);
    const audioChunksRef = useRef<Blob[]>([]);
    const timerRef = useRef<NodeJS.Timeout | null>(null);

    // Reset state when sentence changes
    useEffect(() => {
        setPracticeState('idle');
        setError(null);
        setBufferCount(6);
        if (recordedBlobUrl) {
            URL.revokeObjectURL(recordedBlobUrl);
            setRecordedBlobUrl(null);
        }
        setScoreResult(null);
        setUserText('');
        setRecordingDurationSec(0);
        recordingStartTimeRef.current = 0;
        audioChunksRef.current = [];
        
        if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
            mediaRecorderRef.current.stop();
        }
        if (timerRef.current) clearInterval(timerRef.current);
    }, [sentenceIndex]);

    // Cleanup on unmount
    useEffect(() => {
        return () => {
            if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
                mediaRecorderRef.current.stop();
            }
            if (timerRef.current) clearInterval(timerRef.current);
            if (recordedBlobUrl) URL.revokeObjectURL(recordedBlobUrl);
        };
    }, [recordedBlobUrl]);

    const handleStart = async () => {
        setError(null);
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            
            const mimeType = getSupportedMimeType();
            const mediaRecorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
            mediaRecorderRef.current = mediaRecorder;
            audioChunksRef.current = [];

            mediaRecorder.ondataavailable = (e) => {
                if (e.data.size > 0) {
                    audioChunksRef.current.push(e.data);
                }
            };

            mediaRecorder.onstop = () => {
                const durationSec = (Date.now() - recordingStartTimeRef.current) / 1000;
                setRecordingDurationSec(durationSec);
                const blob = new Blob(audioChunksRef.current, { type: mediaRecorder.mimeType || 'audio/webm' });
                const url = URL.createObjectURL(blob);
                setRecordedBlobUrl(url);
                setPracticeState('finished');
                
                // Stop all tracks to release microphone
                stream.getTracks().forEach(track => track.stop());
            };

            // Set up audio to play exactly at startTime
            if (audioRef.current) {
                audioRef.current.currentTime = sentence.startTime;
            }

            // Sync start: record + play audio at the same time
            recordingStartTimeRef.current = Date.now();
            mediaRecorder.start();
            if (audioRef.current) {
                audioRef.current.play().catch(e => {
                    console.error("Audio play failed:", e);
                    setError("無法播放教材音訊，請確認裝置音量設定。");
                });
            }
            
            setPracticeState('recording');

        } catch (err: any) {
            console.error("Mic access error:", err);
            setError("無法取得麥克風權限，請確認瀏覽器已允許使用麥克風。");
        }
    };

    const handleTimeUpdate = () => {
        if (practiceState !== 'recording' || !audioRef.current) return;
        
        // Stop audio when it reaches the sentence endTime
        if (audioRef.current.currentTime >= sentence.endTime && sentence.endTime > 0) {
            audioRef.current.pause();
            
            // Switch to buffer state but keep recording
            setPracticeState('buffer');
            setBufferCount(6);
            
            timerRef.current = setInterval(() => {
                setBufferCount((prev) => {
                    if (prev <= 1) {
                        clearInterval(timerRef.current!);
                        if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
                            mediaRecorderRef.current.stop();
                        }
                        return 0;
                    }
                    return prev - 1;
                });
            }, 1000);
        }
    };

    const handleRetry = () => {
        setPracticeState('idle');
        setBufferCount(6);
        if (recordedBlobUrl) {
            URL.revokeObjectURL(recordedBlobUrl);
            setRecordedBlobUrl(null);
        }
        audioChunksRef.current = [];
        setScoreResult(null);
        setUserText('');
        setError(null);
    };

    const handleScore = async () => {
        if (!recordedBlobUrl || audioChunksRef.current.length === 0) return;
        
        setPracticeState('scoring');
        setError(null);
        
        try {
            const mimeType = mediaRecorderRef.current?.mimeType || 'audio/webm';
            const blob = new Blob(audioChunksRef.current, { type: mimeType });
            const file = new File([blob], 'recording', { type: mimeType });
            
            const transcribedText = await transcribeRecording(file);
            
            setUserText(transcribedText);
            
            const scores = calculateFinalScores(transcribedText, sentence.text, recordingDurationSec);
            setScoreResult(scores);
            
            // Save to Firestore
            const uid = auth.currentUser?.uid;
            if (!uid) {
                throw new Error("無法取得使用者資訊，請重新登入。");
            }
            
            let newMastery = sentence.mastery;
            if (scores.total >= 70) {
                newMastery = Math.min(1000, sentence.mastery + scores.total);
            }
            
            const updatedSentences = material.sentences.map((s, i) =>
                i === sentenceIndex
                    ? { ...s, mastery: newMastery, lastScores: scores }
                    : s
            );
            
            await updateDoc(doc(db, `artifacts/${appId}/users/${uid}/materials`, material.id), {
                sentences: updatedSentences
            });
            
            setPracticeState('scored');
            
        } catch (err: any) {
            console.error("Scoring error:", err);
            setError(err.message || "評分過程中發生錯誤，請重試。");
            setPracticeState('finished');
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
                    跟讀練習 ({sentenceIndex + 1}/{material.sentences.length})
                </h2>
            </div>

            <audio 
                ref={audioRef} 
                src={material.audioUrl} 
                onTimeUpdate={handleTimeUpdate}
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
                        <div className="flex flex-col items-center gap-1">
                            <div className="text-4xl font-black text-indigo-600 dark:text-indigo-400">
                                {bufferCount}
                            </div>
                            <p className="text-slate-500 font-bold">教材播放完畢，您可以繼續補完發音</p>
                        </div>
                    )}
                    
                    {(practiceState === 'finished' || practiceState === 'scoring') && recordedBlobUrl && (
                        <div className="w-full px-4">
                            <p className="text-slate-500 font-bold mb-3">錄音完成，請試聽</p>
                            <audio src={recordedBlobUrl} controls className="w-full h-12 outline-none mb-4" />
                            {practiceState === 'scoring' && (
                                <div className="flex items-center justify-center gap-3 text-indigo-600 dark:text-indigo-400 font-bold">
                                    <Loader2 size={20} className="animate-spin" />
                                    <span>AI 評分中，請稍候...</span>
                                </div>
                            )}
                        </div>
                    )}

                    {practiceState === 'scored' && scoreResult && (
                        <div className="w-full text-left space-y-6">
                            <div className="bg-indigo-50 dark:bg-indigo-900/20 p-6 rounded-2xl border border-indigo-100 dark:border-indigo-800/50">
                                <h3 className="text-center font-black text-slate-800 dark:text-slate-200 mb-6 text-xl">評分結果</h3>
                                <div className="grid grid-cols-4 gap-4 text-center">
                                    <div>
                                        <div className="text-2xl font-black text-indigo-600 dark:text-indigo-400">{scoreResult.pronunciation}</div>
                                        <div className="text-xs font-bold text-slate-500 mt-1">發音</div>
                                    </div>
                                    <div>
                                        <div className="text-2xl font-black text-indigo-600 dark:text-indigo-400">{scoreResult.fluency}</div>
                                        <div className="text-xs font-bold text-slate-500 mt-1">流暢度</div>
                                    </div>
                                    <div>
                                        <div className="text-2xl font-black text-indigo-600 dark:text-indigo-400">{scoreResult.stress}</div>
                                        <div className="text-xs font-bold text-slate-500 mt-1">重音/語調</div>
                                    </div>
                                    <div className="border-l border-indigo-200 dark:border-indigo-800">
                                        <div className="text-2xl font-black text-emerald-600 dark:text-emerald-400">{scoreResult.total}</div>
                                        <div className="text-xs font-bold text-slate-500 mt-1">總分</div>
                                    </div>
                                </div>
                            </div>
                            
                            <div className="bg-slate-100 dark:bg-slate-800 p-4 rounded-xl border border-slate-200 dark:border-slate-700">
                                <p className="text-xs font-bold text-slate-500 mb-2">您實際念的內容：</p>
                                <p className="text-sm text-slate-700 dark:text-slate-300 font-medium leading-relaxed">
                                    {userText || "(未偵測到語音)"}
                                </p>
                            </div>
                        </div>
                    )}
                </div>

                {/* Controls */}
                <div className="pt-6 border-t border-slate-100 dark:border-slate-800">
                    {practiceState === 'idle' && (
                        <button 
                            onClick={handleStart}
                            className="w-full py-4 bg-indigo-600 text-white font-black rounded-2xl shadow-lg shadow-indigo-200 dark:shadow-none hover:bg-indigo-700 transition-all flex items-center justify-center gap-3 text-lg"
                        >
                            <Mic size={24} />
                            開始跟讀
                        </button>
                    )}

                    {practiceState === 'finished' && (
                        <div className="flex flex-col sm:flex-row gap-4">
                            <button 
                                onClick={handleRetry}
                                className="flex-1 py-4 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-bold rounded-2xl hover:bg-slate-200 dark:hover:bg-slate-700 transition-all flex items-center justify-center gap-2"
                            >
                                <RotateCcw size={20} />
                                重新錄一次
                            </button>
                            <button 
                                onClick={handleScore}
                                className="flex-1 py-4 bg-indigo-600 text-white font-bold rounded-2xl hover:bg-indigo-700 transition-all flex items-center justify-center gap-2"
                            >
                                <Send size={20} />
                                送出評分
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
