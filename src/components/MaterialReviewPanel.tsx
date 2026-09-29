import React, { useState, useRef, useEffect } from 'react';
import { Play, Pause, Save, X, AlertCircle, Trash2, RotateCcw, ChevronDown, ChevronUp } from 'lucide-react';

import { MaterialSentence } from '../types';

export type ReviewSentence = Pick<MaterialSentence, 'text' | 'translation' | 'startTime' | 'endTime' | 'lowConfidence' | 'needsReview'>;

export interface MaterialReviewPanelProps {
    source: 'upload' | 'tts';
    audioFile?: File;
    audioBlob?: Blob;
    fileName: string;
    initialSentences: ReviewSentence[];
    isSaving?: boolean;
    onSave: (sentences: ReviewSentence[]) => void;
    onCancel: () => void;
}

type InternalReviewSentence = ReviewSentence & {
    internalId: string;
    deleted: boolean;
};

export default function MaterialReviewPanel({
    source,
    audioFile,
    audioBlob,
    fileName,
    initialSentences,
    isSaving = false,
    onSave,
    onCancel
}: MaterialReviewPanelProps) {
    const [sentences, setSentences] = useState<InternalReviewSentence[]>(() =>
        initialSentences.map((s, i) => ({
            ...s,
            internalId: `rev_${i}`,
            deleted: false
        }))
    );
    const [audioUrl, setAudioUrl] = useState<string>('');
    const audioRef = useRef<HTMLAudioElement>(null);
    const [playingId, setPlayingId] = useState<string | null>(null);
    const [isDeletedExpanded, setIsDeletedExpanded] = useState(false);
    const [showDiscardConfirm, setShowDiscardConfirm] = useState(false);
    const [timeAdjustWarnings, setTimeAdjustWarnings] = useState<Record<string, string>>({});

    useEffect(() => {
        const fileOrBlob = audioFile || audioBlob;
        if (fileOrBlob) {
            const url = URL.createObjectURL(fileOrBlob);
            setAudioUrl(url);
            return () => URL.revokeObjectURL(url);
        }
    }, [audioFile, audioBlob]);

    const handlePlaySegment = (id: string) => {
        const sentence = sentences.find(s => s.internalId === id);
        if (sentence && audioRef.current) {
            audioRef.current.currentTime = sentence.startTime;
            audioRef.current.play();
            setPlayingId(id);
        }
    };

    const handleTimeUpdate = () => {
        if (playingId && audioRef.current) {
            const sentence = sentences.find(s => s.internalId === playingId);
            if (sentence && audioRef.current.currentTime >= sentence.endTime && sentence.endTime > 0) {
                audioRef.current.pause();
                setPlayingId(null);
            }
        }
    };

    const handlePause = () => {
        if (audioRef.current) {
            audioRef.current.pause();
            setPlayingId(null);
        }
    };

    const updateSentence = (id: string, field: keyof ReviewSentence, value: any) => {
        setSentences(prev => prev.map(s => s.internalId === id ? { ...s, [field]: value } : s));
    };

    const handleDelete = (id: string) => {
        if (playingId === id) {
            handlePause();
        }
        setSentences(prev => prev.map(s => s.internalId === id ? { ...s, deleted: true } : s));
    };

    const handleRestore = (id: string) => {
        setSentences(prev => prev.map(s => s.internalId === id ? { ...s, deleted: false } : s));
    };

    const handleAdjustTime = (id: string, field: 'startTime' | 'endTime', delta: number) => {
        const sentence = sentences.find(s => s.internalId === id);
        if (!sentence) return;

        const currentVal = sentence[field];
        const newVal = Math.round(Math.max(0, currentVal + delta) * 100) / 100;

        const newStart = field === 'startTime' ? newVal : sentence.startTime;
        const newEnd = field === 'endTime' ? newVal : sentence.endTime;

        if (newStart >= newEnd) {
            setTimeAdjustWarnings(prev => ({
                ...prev,
                [id]: '此調整會使開始時間大於或等於結束時間，已取消'
            }));
            return;
        }

        setTimeAdjustWarnings(prev => {
            if (!prev[id]) return prev;
            const updated = { ...prev };
            delete updated[id];
            return updated;
        });

        setSentences(prev => prev.map(s => s.internalId === id ? { ...s, [field]: newVal } : s));
    };

    const activeSentences = sentences.filter(s => !s.deleted);
    const deletedSentences = sentences.filter(s => s.deleted);

    const invalidSentenceIndices = activeSentences
        .map((s, idx) => (s.startTime >= s.endTime ? idx + 1 : null))
        .filter((idx): idx is number => idx !== null);
    const hasInvalidTime = invalidSentenceIndices.length > 0;

    const handleSaveClick = () => {
        if (activeSentences.length === 0 || hasInvalidTime || isSaving) return;

        if (deletedSentences.length > 0) {
            setShowDiscardConfirm(true);
        } else {
            executeSave();
        }
    };

    const executeSave = () => {
        setShowDiscardConfirm(false);
        const cleanSentences: ReviewSentence[] = activeSentences.map(s => ({
            text: s.text,
            translation: s.translation,
            startTime: s.startTime,
            endTime: s.endTime,
            lowConfidence: s.lowConfidence,
            needsReview: s.needsReview
        }));
        onSave(cleanSentences);
    };

    return (
        <div className="bg-white dark:bg-slate-900 rounded-2xl p-6 shadow-sm border border-slate-200 dark:border-slate-800">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
                <div>
                    <h3 className="text-xl font-bold text-slate-800 dark:text-white">校對內容</h3>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                        檔案：{fileName}（保留 {activeSentences.length} 句{deletedSentences.length > 0 ? `，已刪除 ${deletedSentences.length} 句` : ''}）
                    </p>
                </div>
                <div className="flex flex-col items-end gap-2">
                    <div className="flex gap-3">
                        <button
                            onClick={onCancel}
                            disabled={isSaving}
                            className="px-4 py-2 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 font-bold rounded-lg hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors flex items-center gap-2 disabled:opacity-50"
                        >
                            <X size={18} />
                            取消
                        </button>
                        <button
                            onClick={handleSaveClick}
                            disabled={isSaving || activeSentences.length === 0 || hasInvalidTime}
                            className="px-4 py-2 bg-indigo-600 text-white font-bold rounded-lg hover:bg-indigo-700 transition-colors flex items-center gap-2 disabled:opacity-50 shadow-md shadow-indigo-200 dark:shadow-none"
                        >
                            <Save size={18} />
                            確認儲存
                        </button>
                    </div>
                    {activeSentences.length === 0 && (
                        <span className="text-xs font-bold text-red-500">至少需保留 1 句才能存檔</span>
                    )}
                    {hasInvalidTime && (
                        <span className="text-xs font-bold text-red-500">
                            第 {invalidSentenceIndices.join('、')} 句的時間需要修正
                        </span>
                    )}
                </div>
            </div>

            {/* 捨棄已刪除句子確認對話框（內嵌式） */}
            {showDiscardConfirm && (
                <div className="mb-6 p-4 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 flex flex-col md:flex-row md:items-center justify-between gap-4 animate-in fade-in">
                    <div className="flex items-center gap-3">
                        <AlertCircle className="text-amber-600 dark:text-amber-400 shrink-0" size={20} />
                        <div>
                            <p className="font-bold text-amber-900 dark:text-amber-200 text-sm">
                                將永久捨棄 {deletedSentences.length} 句，確定要存檔嗎？
                            </p>
                            <p className="text-xs text-amber-700 dark:text-amber-400 mt-0.5">
                                存檔後將只保留當前主列表中的 {activeSentences.length} 句，已刪除的句子將無法復原。
                            </p>
                        </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                        <button
                            onClick={() => setShowDiscardConfirm(false)}
                            disabled={isSaving}
                            className="px-3 py-1.5 bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-bold rounded-lg hover:bg-slate-300 dark:hover:bg-slate-700 transition-colors text-xs disabled:opacity-50"
                        >
                            返回
                        </button>
                        <button
                            onClick={executeSave}
                            disabled={isSaving}
                            className="px-3 py-1.5 bg-amber-600 text-white font-bold rounded-lg hover:bg-amber-700 transition-colors text-xs disabled:opacity-50 shadow-sm"
                        >
                            確定存檔
                        </button>
                    </div>
                </div>
            )}

            <audio ref={audioRef} src={audioUrl} onTimeUpdate={handleTimeUpdate} onEnded={() => setPlayingId(null)} />

            {/* 主列表 */}
            <div className="space-y-4">
                {activeSentences.map((s, index) => {
                    const displayIndex = index + 1;
                    const isPlaying = playingId === s.internalId;
                    const isTimeInvalid = s.startTime >= s.endTime;
                    const isLowConfOrReview = !!(s.lowConfidence || s.needsReview);
                    const adjustWarning = timeAdjustWarnings[s.internalId];

                    return (
                        <div
                            key={s.internalId}
                            className={`p-4 rounded-xl flex flex-col gap-3 border transition-colors ${
                                isLowConfOrReview
                                    ? 'bg-yellow-50/50 dark:bg-yellow-900/10 border-yellow-400 dark:border-yellow-600'
                                    : 'bg-slate-50 dark:bg-slate-800/50 border-slate-200 dark:border-slate-700'
                            }`}
                        >
                            <div className="flex justify-between items-center pb-2 border-b border-slate-200 dark:border-slate-700/60">
                                <div className="flex items-center gap-2">
                                    <span className="text-xs font-black text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-950/60 px-2.5 py-0.5 rounded-md">
                                        第 {displayIndex} 句
                                    </span>
                                    {isLowConfOrReview && (
                                        <span className="text-xs font-bold text-yellow-700 dark:text-yellow-300 flex items-center gap-1 bg-yellow-100 dark:bg-yellow-900/40 px-2 py-0.5 rounded-full">
                                            <AlertCircle size={14} /> 此句的斷句或時間可能不準，建議優先核對
                                        </span>
                                    )}
                                </div>
                                <button
                                    onClick={() => handleDelete(s.internalId)}
                                    disabled={isSaving}
                                    className="px-2.5 py-1 text-xs font-bold text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/50 rounded-lg transition-colors flex items-center gap-1 disabled:opacity-50"
                                >
                                    <Trash2 size={14} />
                                    刪除
                                </button>
                            </div>

                            <div className="flex flex-col md:flex-row justify-between items-start gap-4">
                                <div className="flex-1 space-y-2 w-full">
                                    <div>
                                        <label className="text-xs font-bold text-slate-500 uppercase tracking-wider block mb-1">
                                            原文 (English)
                                        </label>
                                        <textarea
                                            value={s.text}
                                            onChange={(e) => updateSentence(s.internalId, 'text', e.target.value)}
                                            className="w-full p-2.5 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200 focus:ring-1 focus:ring-indigo-500 outline-none resize-none leading-relaxed"
                                            rows={source === 'upload' ? 3 : 2}
                                        />
                                    </div>

                                    {source === 'tts' && (
                                        <div>
                                            <label className="text-xs font-bold text-slate-500 uppercase tracking-wider block mb-1 mt-2">
                                                翻譯 (Chinese)
                                            </label>
                                            <textarea
                                                value={s.translation || ''}
                                                onChange={(e) => updateSentence(s.internalId, 'translation', e.target.value)}
                                                className="w-full p-2.5 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200 focus:ring-1 focus:ring-indigo-500 outline-none resize-none leading-relaxed"
                                                rows={2}
                                            />
                                        </div>
                                    )}

                                    {isTimeInvalid && (
                                        <p className="text-xs font-bold text-red-600 dark:text-red-400 flex items-center gap-1">
                                            <AlertCircle size={14} /> 開始時間必須小於結束時間
                                        </p>
                                    )}
                                    {adjustWarning && (
                                        <p className="text-xs font-bold text-amber-600 dark:text-amber-400 flex items-center gap-1">
                                            <AlertCircle size={14} /> {adjustWarning}
                                        </p>
                                    )}
                                </div>

                                <div className="w-full md:w-56 shrink-0 flex flex-col gap-2.5 bg-white dark:bg-slate-850 p-3 rounded-xl border border-slate-200 dark:border-slate-700">
                                    {/* 開始時間 */}
                                    <div>
                                        <div className="flex justify-between items-center mb-1">
                                            <label className="text-xs font-bold text-slate-500 uppercase">開始 (s)</label>
                                            <div className="flex gap-1">
                                                <button
                                                    type="button"
                                                    onClick={() => handleAdjustTime(s.internalId, 'startTime', -0.5)}
                                                    disabled={isSaving}
                                                    className="px-1.5 py-0.5 text-[11px] font-bold bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-200 rounded disabled:opacity-50"
                                                >
                                                    −0.5
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() => handleAdjustTime(s.internalId, 'startTime', 0.5)}
                                                    disabled={isSaving}
                                                    className="px-1.5 py-0.5 text-[11px] font-bold bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-200 rounded disabled:opacity-50"
                                                >
                                                    +0.5
                                                </button>
                                            </div>
                                        </div>
                                        <input
                                            type="number"
                                            step="0.01"
                                            value={s.startTime}
                                            onChange={(e) => updateSentence(s.internalId, 'startTime', parseFloat(e.target.value) || 0)}
                                            className="w-full p-1.5 text-sm rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-800 dark:text-slate-200 font-mono"
                                        />
                                    </div>

                                    {/* 結束時間 */}
                                    <div>
                                        <div className="flex justify-between items-center mb-1">
                                            <label className="text-xs font-bold text-slate-500 uppercase">結束 (s)</label>
                                            <div className="flex gap-1">
                                                <button
                                                    type="button"
                                                    onClick={() => handleAdjustTime(s.internalId, 'endTime', -0.5)}
                                                    disabled={isSaving}
                                                    className="px-1.5 py-0.5 text-[11px] font-bold bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-200 rounded disabled:opacity-50"
                                                >
                                                    −0.5
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() => handleAdjustTime(s.internalId, 'endTime', 0.5)}
                                                    disabled={isSaving}
                                                    className="px-1.5 py-0.5 text-[11px] font-bold bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-200 rounded disabled:opacity-50"
                                                >
                                                    +0.5
                                                </button>
                                            </div>
                                        </div>
                                        <input
                                            type="number"
                                            step="0.01"
                                            value={s.endTime}
                                            onChange={(e) => updateSentence(s.internalId, 'endTime', parseFloat(e.target.value) || 0)}
                                            className="w-full p-1.5 text-sm rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-800 dark:text-slate-200 font-mono"
                                        />
                                    </div>

                                    <button
                                        onClick={() => isPlaying ? handlePause() : handlePlaySegment(s.internalId)}
                                        className={`mt-1 w-full py-2 rounded-lg font-bold flex items-center justify-center gap-1.5 transition-colors text-sm ${
                                            isPlaying
                                                ? 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/50 dark:text-indigo-300'
                                                : 'bg-indigo-50 dark:bg-indigo-950/50 text-indigo-600 dark:text-indigo-400 hover:bg-indigo-100 dark:hover:bg-indigo-900/70'
                                        }`}
                                    >
                                        {isPlaying ? (
                                            <><Pause size={15} /> 暫停播放</>
                                        ) : (
                                            <><Play size={15} /> 播放片段</>
                                        )}
                                    </button>
                                </div>
                            </div>
                        </div>
                    );
                })}
            </div>

            {/* 已刪除（N）區塊 */}
            {deletedSentences.length > 0 && (
                <div className="mt-8 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden bg-slate-50/50 dark:bg-slate-900/50">
                    <button
                        onClick={() => setIsDeletedExpanded(!isDeletedExpanded)}
                        className="w-full px-4 py-3 bg-slate-100 dark:bg-slate-800/80 text-slate-700 dark:text-slate-300 font-bold flex items-center justify-between hover:bg-slate-200 dark:hover:bg-slate-800 transition-colors text-sm"
                    >
                        <span className="flex items-center gap-2">
                            <Trash2 size={16} className="text-slate-400" />
                            已刪除（{deletedSentences.length}）
                        </span>
                        {isDeletedExpanded ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
                    </button>

                    {isDeletedExpanded && (
                        <div className="p-4 space-y-3 divide-y divide-slate-200 dark:divide-slate-800">
                            {deletedSentences.map((s) => (
                                <div key={s.internalId} className="pt-3 first:pt-0 flex flex-col md:flex-row md:items-center justify-between gap-3">
                                    <div className="flex-1">
                                        <p className="text-sm text-slate-600 dark:text-slate-300 font-medium line-through opacity-75">
                                            {s.text}
                                        </p>
                                        <p className="text-xs text-slate-400 font-mono mt-1">
                                            時間：{s.startTime}s ~ {s.endTime}s
                                        </p>
                                    </div>
                                    <button
                                        onClick={() => handleRestore(s.internalId)}
                                        disabled={isSaving}
                                        className="self-end md:self-center px-3 py-1.5 bg-white dark:bg-slate-800 text-indigo-600 dark:text-indigo-400 border border-indigo-200 dark:border-indigo-800 rounded-lg hover:bg-indigo-50 dark:hover:bg-indigo-950 font-bold text-xs flex items-center gap-1.5 transition-colors disabled:opacity-50 shrink-0"
                                    >
                                        <RotateCcw size={14} />
                                        復原
                                    </button>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
