import React, { useState, useEffect } from 'react';
import { LanguagePattern } from '../types';
import { auth, db, appId } from '../firebase';
import { doc, onSnapshot } from 'firebase/firestore';
import { ChevronLeft, Loader2, Sparkles, BookOpen, Quote, PenTool, RefreshCw, Trash2 } from 'lucide-react';
import LanguageModelPracticeView from './LanguageModelPracticeView';
import GroupSelectionView from './GroupSelectionView';
import GroupDetailView from './GroupDetailView';
import { regenerateAndSaveSeedExamples } from '../services/seedExamples';
import ConfirmDialog from './ConfirmDialog';
import PatternSightingsSection from './PatternSightingsSection';
import { getPatternStage } from '../utils/patternStage';
import { deletePattern } from '../services/patternDelete';
import { getSydneyDateString } from '../utils/sydneyTime';

export default function LanguageModelDetailView({ patternId, onBack }: { patternId: string, onBack: () => void }) {
    const [pattern, setPattern] = useState<LanguagePattern | null>(null);
    const [showGroupSelection, setShowGroupSelection] = useState(false);
    const [selectedGroupIndex, setSelectedGroupIndex] = useState<number | null>(null);
    const [regenerating, setRegenerating] = useState(false);
    const [regenerateError, setRegenerateError] = useState<string | null>(null);
    const [showRegenerateConfirm, setShowRegenerateConfirm] = useState(false);
    const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
    const [deleting, setDeleting] = useState(false);
    const [deleteError, setDeleteError] = useState<string | null>(null);
    const [viewingGroupIndex, setViewingGroupIndex] = useState<number | null>(null);

    useEffect(() => {
        const uid = auth.currentUser?.uid;
        if (!uid || !patternId) return;

        const docRef = doc(db, `artifacts/${appId}/users/${uid}/languagePatterns`, patternId);
        const unsubscribe = onSnapshot(docRef, (snapshot) => {
            if (snapshot.exists()) {
                setPattern({ id: snapshot.id, ...snapshot.data() } as LanguagePattern);
            }
        }, (error) => {
            console.error('[監聽來源:LanguageModelDetailView-languagePattern]', error);
        });

        return () => unsubscribe();
    }, [patternId]);

    if (!pattern) {
        return (
            <div className="flex flex-col h-full bg-slate-50 dark:bg-slate-950 p-6 items-center justify-center">
                <Loader2 className="animate-spin text-indigo-600 mb-4" size={40} />
                <p className="text-slate-500 font-bold">載入中...</p>
            </div>
        );
    }

    if (selectedGroupIndex !== null && pattern) {
        return <LanguageModelPracticeView pattern={pattern} groupIndex={selectedGroupIndex} onBack={() => setSelectedGroupIndex(null)} />;
    }

    if (viewingGroupIndex !== null && pattern) {
        return <GroupDetailView
            pattern={pattern}
            groupIndex={viewingGroupIndex}
            onBack={() => setViewingGroupIndex(null)}
            onEnterGroup={() => {
                setSelectedGroupIndex(viewingGroupIndex);
                setViewingGroupIndex(null);
                setShowGroupSelection(false);
            }}
        />;
    }

    if (showGroupSelection && pattern) {
        return <GroupSelectionView pattern={pattern} onBack={() => setShowGroupSelection(false)} onSelectGroup={(idx) => {
            setSelectedGroupIndex(idx);
            setShowGroupSelection(false);
        }} onViewGroup={(idx) => setViewingGroupIndex(idx)} />;
    }

    const categoryLabels: Record<string, string> = {
        'structural': '結構句型',
        'phrase': '片語',
        'collocation': '語組'
    };

    const doRegenerate = async () => {
        const uid = auth.currentUser?.uid;
        if (!uid || regenerating) return;

        setShowRegenerateConfirm(false);
        setRegenerating(true);
        setRegenerateError(null);

        try {
            await regenerateAndSaveSeedExamples(pattern);
        } catch (err: any) {
            console.error('重新產生例句失敗:', err);
            setRegenerateError(err.message || '重新產生失敗，請稍後再試');
        } finally {
            setRegenerating(false);
        }
    };

    const handleRegenerateClick = () => {
        if (pattern.seedExamples && pattern.seedExamples.length > 0) {
            setShowRegenerateConfirm(true);
        } else {
            doRegenerate();
        }
    };

    const handleDeletePattern = async () => {
        const uid = auth.currentUser?.uid;
        if (!uid || deleting) return;

        setShowDeleteConfirm(false);
        setDeleting(true);
        setDeleteError(null);

        try {
            await deletePattern(pattern.id);
            onBack();
        } catch (err: any) {
            console.error('刪除句型失敗:', err);
            setDeleteError(err.message || '刪除失敗，請稍後再試');
            setDeleting(false);
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
                <div className="flex-1 flex flex-wrap gap-2 items-center">
                    <span className="text-[10px] font-bold bg-indigo-100 text-indigo-700 dark:bg-indigo-900/50 dark:text-indigo-300 px-2 py-0.5 rounded-full shrink-0">
                        {categoryLabels[pattern.category] || pattern.category}
                    </span>
                    <span className="text-[10px] font-bold bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-300 px-2 py-0.5 rounded-full shrink-0">
                        {pattern.primaryCategory}
                    </span>
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full shrink-0 ${getPatternStage(pattern).className}`}>
                        {getPatternStage(pattern).label}
                    </span>
                </div>
                <button
                    onClick={() => setShowDeleteConfirm(true)}
                    disabled={deleting}
                    className="p-2 bg-white dark:bg-slate-900 text-red-500 hover:text-red-600 dark:text-red-400 dark:hover:text-red-300 rounded-full shadow-sm hover:bg-red-50 dark:hover:bg-red-950/40 transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                    title="刪除句型"
                >
                    {deleting ? <Loader2 size={24} className="animate-spin" /> : <Trash2 size={24} />}
                </button>
            </div>

            {deleteError && (
                <div className="p-3 bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-800 rounded-xl text-red-600 dark:text-red-400 text-sm font-bold mb-6">
                    {deleteError}
                </div>
            )}

            <div className="bg-white dark:bg-slate-900 rounded-2xl p-6 shadow-sm border border-slate-200 dark:border-slate-800 mb-6">
                <h2 className="text-3xl sm:text-4xl font-black text-slate-800 dark:text-white mb-6 leading-tight">
                    {pattern.text}
                </h2>

                {pattern.maintenance && (
                    <p className="-mt-3 mb-6 text-xs font-bold text-emerald-600 dark:text-emerald-400">
                        維持複習：{pattern.maintenance.level > 0 ? `已連續通過 ${pattern.maintenance.level} 次` : pattern.maintenance.lastReviewedAt ? '上次沒有通過' : '尚未開始'}・下次 {getSydneyDateString(pattern.maintenance.dueAt)}
                    </p>
                )}
                
                <div className="space-y-6">
                    <div>
                        <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 flex items-center gap-2">
                            <BookOpen size={14} /> 語意說明
                        </h4>
                        <p className="text-slate-700 dark:text-slate-300 leading-relaxed font-bold">
                            {pattern.meaningZh}
                        </p>
                    </div>

                    {pattern.learningPoint && (
                        <div>
                            <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 flex items-center gap-2">
                                <Sparkles size={14} /> 學習重點
                            </h4>
                            <p className="text-slate-700 dark:text-slate-300 leading-relaxed">
                                {pattern.learningPoint}
                            </p>
                        </div>
                    )}
                    
                    <div>
                        <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 flex items-center gap-2">
                            <Sparkles size={14} /> 使用時機
                        </h4>
                        <p className="text-slate-700 dark:text-slate-300 leading-relaxed font-bold">
                            {pattern.usageContext}
                        </p>
                    </div>

                    {pattern.situationTags && pattern.situationTags.length > 0 && (
                        <div>
                            <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">情境標籤</h4>
                            <div className="flex flex-wrap gap-2">
                                {pattern.situationTags.map((tag, idx) => (
                                    <span key={idx} className="bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 text-xs px-3 py-1 rounded-lg font-bold border border-slate-200 dark:border-slate-700">
                                        #{tag}
                                    </span>
                                ))}
                            </div>
                        </div>
                    )}

                    {pattern.sourceLabel && (
                        <div className="pt-4 border-t border-slate-100 dark:border-slate-800 mt-4">
                            <span className="text-xs text-slate-500 dark:text-slate-400 font-bold">
                                來自: <span className="text-slate-600 dark:text-slate-300 italic">{pattern.sourceLabel}</span>
                            </span>
                        </div>
                    )}
                </div>
            </div>

                <button 
                    onClick={() => setShowGroupSelection(true)}
                    className="w-full mb-8 h-14 bg-indigo-600 text-white rounded-xl font-bold shadow-md hover:bg-indigo-700 transition-colors flex items-center justify-center gap-2"
                >
                    <PenTool size={20} />
                    開始造句練習
                </button>
                
            <div className="space-y-4">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                    <h3 className="text-lg font-black text-slate-800 dark:text-white flex items-center gap-2">
                        <Quote size={20} className="text-indigo-500" />
                        示範例句
                    </h3>
                    <button
                        onClick={handleRegenerateClick}
                        disabled={regenerating}
                        className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold bg-white dark:bg-slate-900 text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-slate-800 border border-indigo-200 dark:border-indigo-800/60 rounded-xl transition-all shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        {regenerating ? (
                            <>
                                <Loader2 size={14} className="animate-spin" />
                                <span>產生中…</span>
                            </>
                        ) : (
                            <>
                                <RefreshCw size={14} />
                                <span>重新產生</span>
                            </>
                        )}
                    </button>
                </div>

                {regenerateError && (
                    <div className="p-3 bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-800 rounded-xl text-red-600 dark:text-red-400 text-sm font-bold">
                        {regenerateError}
                    </div>
                )}

                {pattern.seedExamples && pattern.seedExamples.length > 0 ? (
                    <div className="space-y-3">
                        {pattern.seedExamples.map((ex, idx) => (
                            <div key={idx} className="bg-white dark:bg-slate-900 rounded-xl p-4 shadow-sm border border-slate-200 dark:border-slate-800">
                                <p className="font-bold text-slate-800 dark:text-slate-200 mb-1">{ex.en}</p>
                                <p className="text-sm font-bold text-slate-500 dark:text-slate-400">{ex.zh}</p>
                            </div>
                        ))}
                    </div>
                ) : (
                    <p className="text-sm font-bold text-slate-400 dark:text-slate-500 py-4 text-center">
                        目前沒有示範例句，可以按「重新產生」建立
                    </p>
                )}
            </div>

            <PatternSightingsSection patternId={pattern.id} />

            <ConfirmDialog
                isOpen={showRegenerateConfirm}
                title="重新產生例句？"
                message={`目前的 ${pattern.seedExamples?.length || 0} 句示範例句會被新的取代。\n已經加入造句的句子不受影響。`}
                confirmText="重新產生"
                cancelText="取消"
                onConfirm={doRegenerate}
                onCancel={() => setShowRegenerateConfirm(false)}
            />

            <ConfirmDialog
                isOpen={showDeleteConfirm}
                title="刪除這個句型？"
                message={`「${pattern.text}」\n這個句型的 ${(pattern.exampleSentences || []).length} 句造句與所有練習進度會一起刪除，無法復原。`}
                confirmText="刪除"
                cancelText="取消"
                onConfirm={handleDeletePattern}
                onCancel={() => setShowDeleteConfirm(false)}
            />
        </div>
    );
}
