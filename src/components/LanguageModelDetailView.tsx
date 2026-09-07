import React, { useState, useEffect } from 'react';
import { LanguagePattern } from '../types';
import { auth, db, appId } from '../firebase';
import { doc, onSnapshot } from 'firebase/firestore';
import { ChevronLeft, Loader2, Sparkles, BookOpen, Quote, PenTool } from 'lucide-react';
import LanguageModelPracticeView from './LanguageModelPracticeView';
import GroupSelectionView from './GroupSelectionView';

export default function LanguageModelDetailView({ patternId, onBack }: { patternId: string, onBack: () => void }) {
    const [pattern, setPattern] = useState<LanguagePattern | null>(null);
    const [showGroupSelection, setShowGroupSelection] = useState(false);
    const [selectedGroupIndex, setSelectedGroupIndex] = useState<number | null>(null);

    useEffect(() => {
        const uid = auth.currentUser?.uid;
        if (!uid || !patternId) return;

        const docRef = doc(db, `artifacts/${appId}/users/${uid}/languagePatterns`, patternId);
        const unsubscribe = onSnapshot(docRef, (snapshot) => {
            if (snapshot.exists()) {
                setPattern({ id: snapshot.id, ...snapshot.data() } as LanguagePattern);
            }
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

    if (showGroupSelection && pattern) {
        return <GroupSelectionView pattern={pattern} onBack={() => setShowGroupSelection(false)} onSelectGroup={(idx) => {
            setSelectedGroupIndex(idx);
            setShowGroupSelection(false);
        }} />;
    }

    const categoryLabels: Record<string, string> = {
        'structural': '結構句型',
        'phrase': '片語',
        'collocation': '語組'
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
                </div>
            </div>

            <div className="bg-white dark:bg-slate-900 rounded-2xl p-6 shadow-sm border border-slate-200 dark:border-slate-800 mb-6">
                <h2 className="text-3xl sm:text-4xl font-black text-slate-800 dark:text-white mb-6 leading-tight">
                    {pattern.text}
                </h2>
                
                <div className="space-y-6">
                    <div>
                        <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 flex items-center gap-2">
                            <BookOpen size={14} /> 語意說明
                        </h4>
                        <p className="text-slate-700 dark:text-slate-300 leading-relaxed font-bold">
                            {pattern.meaningZh}
                        </p>
                    </div>
                    
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
                
            {pattern.seedExamples && pattern.seedExamples.length > 0 && (
                <div>
                    <h3 className="text-lg font-black text-slate-800 dark:text-white mb-4 flex items-center gap-2">
                        <Quote size={20} className="text-indigo-500" />
                        示範例句
                    </h3>
                    <div className="space-y-3">
                        {pattern.seedExamples.map((ex, idx) => (
                            <div key={idx} className="bg-white dark:bg-slate-900 rounded-xl p-4 shadow-sm border border-slate-200 dark:border-slate-800">
                                <p className="font-bold text-slate-800 dark:text-slate-200 mb-1">{ex.en}</p>
                                <p className="text-sm font-bold text-slate-500 dark:text-slate-400">{ex.zh}</p>
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}
