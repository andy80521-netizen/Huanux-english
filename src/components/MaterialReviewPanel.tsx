import React, { useState, useRef, useEffect } from 'react';
import { Play, Pause, Save, X, AlertCircle } from 'lucide-react';

import { MaterialSentence } from '../types';

export type ReviewSentence = Pick<MaterialSentence, 'text' | 'translation' | 'startTime' | 'endTime' | 'lowConfidence' | 'needsReview'>;

export interface MaterialReviewPanelProps {
    source: 'upload' | 'tts';
    audioFile?: File;
    audioBlob?: Blob;
    fileName: string;
    initialSentences: ReviewSentence[];
    
    onSave: (sentences: ReviewSentence[]) => void;
    onCancel: () => void;
}

export default function MaterialReviewPanel({
    source, audioFile, audioBlob, fileName, initialSentences,  onSave, onCancel
}: MaterialReviewPanelProps) {
    const [sentences, setSentences] = useState<ReviewSentence[]>(initialSentences);
    const [audioUrl, setAudioUrl] = useState<string>('');
    const audioRef = useRef<HTMLAudioElement>(null);
    const [playingIndex, setPlayingIndex] = useState<number | null>(null);

    useEffect(() => {
        const fileOrBlob = audioFile || audioBlob;
        if (fileOrBlob) {
            const url = URL.createObjectURL(fileOrBlob);
            setAudioUrl(url);
            return () => URL.revokeObjectURL(url);
        }
    }, [audioFile, audioBlob]);

    const handlePlaySegment = (index: number) => {
        const sentence = sentences[index];
        if (audioRef.current) {
            audioRef.current.currentTime = sentence.startTime;
            audioRef.current.play();
            setPlayingIndex(index);
        }
    };

    const handleTimeUpdate = () => {
        if (playingIndex !== null && audioRef.current) {
            const sentence = sentences[playingIndex];
            if (audioRef.current.currentTime >= sentence.endTime && sentence.endTime > 0) {
                audioRef.current.pause();
                setPlayingIndex(null);
            }
        }
    };

    const handlePause = () => {
        if (audioRef.current) {
            audioRef.current.pause();
            setPlayingIndex(null);
        }
    };

    const updateSentence = (index: number, field: keyof ReviewSentence, value: any) => {
        const updated = [...sentences];
        updated[index] = { ...updated[index], [field]: value };
        setSentences(updated);
    };

    return (
        <div className="bg-white dark:bg-slate-900 rounded-2xl p-6 shadow-sm border border-slate-200 dark:border-slate-800">
            <div className="flex items-center justify-between mb-6">
                <h3 className="text-xl font-bold text-slate-800 dark:text-white">校對內容</h3>
                <div className="flex gap-3">
                    <button onClick={onCancel} className="px-4 py-2 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 font-bold rounded-lg hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors flex items-center gap-2">
                        <X size={18} />
                        取消
                    </button>
                    <button onClick={() => onSave(sentences)} className="px-4 py-2 bg-indigo-600 text-white font-bold rounded-lg hover:bg-indigo-700 transition-colors flex items-center gap-2">
                        <Save size={18} />
                        確認儲存
                    </button>
                </div>
            </div>

            

            

            <audio ref={audioRef} src={audioUrl} onTimeUpdate={handleTimeUpdate} onEnded={() => setPlayingIndex(null)} />

            <div className="space-y-4">
                {sentences.map((s, i) => (
                    <div key={i} className={`p-4 rounded-xl flex flex-col gap-3 border ${s.needsReview ? 'bg-yellow-50/50 dark:bg-yellow-900/10 border-yellow-400 dark:border-yellow-600' : 'bg-slate-50 dark:bg-slate-800/50 border-slate-200 dark:border-slate-700'}`}>
                        <div className="flex justify-between items-start gap-4">
                            <div className="flex-1 space-y-2">
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-2">
                                        <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">原文 (English)</label>
                                        {s.needsReview && (
                                            <span className="text-xs font-bold text-yellow-600 dark:text-yellow-400 flex items-center gap-1 bg-yellow-100 dark:bg-yellow-900/40 px-2 py-0.5 rounded-full">
                                                <AlertCircle size={14} /> 此句時間軸可能不夠精確,建議仔細核對
                                            </span>
                                        )}
                                    </div>
                                    {s.lowConfidence && (
                                        <span className="text-[10px] font-bold bg-orange-100 text-orange-600 px-2 py-0.5 rounded-full shrink-0">
                                            低信心度
                                        </span>
                                    )}
                                </div>
                                <textarea
                                    value={s.text}
                                    onChange={(e) => updateSentence(i, 'text', e.target.value)}
                                    className="w-full p-2 text-sm rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200 focus:ring-1 focus:ring-indigo-500 outline-none resize-none"
                                    rows={2}
                                />
                                <label className="text-xs font-bold text-slate-500 uppercase tracking-wider mt-2 block">翻譯 (Chinese)</label>
                                <textarea
                                    value={s.translation}
                                    onChange={(e) => updateSentence(i, 'translation', e.target.value)}
                                    className="w-full p-2 text-sm rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200 focus:ring-1 focus:ring-indigo-500 outline-none resize-none"
                                    rows={2}
                                />
                            </div>
                            <div className="w-32 shrink-0 flex flex-col gap-2">
                                <div>
                                    <label className="text-xs font-bold text-slate-500 uppercase">Start (s)</label>
                                    <input
                                        type="number"
                                        step="0.1"
                                        value={s.startTime}
                                        onChange={(e) => updateSentence(i, 'startTime', parseFloat(e.target.value) || 0)}
                                        className="w-full p-2 text-sm rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200"
                                    />
                                </div>
                                <div>
                                    <label className="text-xs font-bold text-slate-500 uppercase">End (s)</label>
                                    <input
                                        type="number"
                                        step="0.1"
                                        value={s.endTime}
                                        onChange={(e) => updateSentence(i, 'endTime', parseFloat(e.target.value) || 0)}
                                        className="w-full p-2 text-sm rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200"
                                    />
                                </div>
                                <button
                                    onClick={() => playingIndex === i ? handlePause() : handlePlaySegment(i)}
                                    className={`mt-2 w-full py-2 rounded-lg font-bold flex items-center justify-center gap-1 transition-colors ${playingIndex === i ? 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/50 dark:text-indigo-300' : 'bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-300 dark:hover:bg-slate-600'}`}
                                >
                                    {playingIndex === i ? (
                                        <><Pause size={14} /> 暫停</>
                                    ) : (
                                        <><Play size={14} /> 播放</>
                                    )}
                                </button>
                            </div>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}
