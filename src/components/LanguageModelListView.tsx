import React, { useState, useEffect } from 'react';
import { LanguagePattern } from '../types';
import { auth, db, appId } from '../firebase';
import { collection, query, onSnapshot } from 'firebase/firestore';
import { Sparkles, User, ChevronRight } from 'lucide-react';

export default function LanguageModelListView({ onPatternClick }: { onPatternClick: (id: string) => void }) {
    const [patterns, setPatterns] = useState<LanguagePattern[]>([]);
    const [loading, setLoading] = useState(true);
    const [uid, setUid] = useState<string | null | undefined>(undefined);

    useEffect(() => {
        const currentUid = auth.currentUser?.uid;
        if (!currentUid) {
            setUid(null);
            setLoading(false);
            return;
        }
        setUid(currentUid);

        const q = query(
            collection(db, `artifacts/${appId}/users/${currentUid}/languagePatterns`)
        );

        const unsubscribe = onSnapshot(q, (snapshot) => {
            const data: LanguagePattern[] = [];
            snapshot.forEach((doc) => {
                data.push(doc.data() as LanguagePattern);
            });
            setPatterns(data);
            setLoading(false);
        }, (err) => {
            console.error("Error fetching language patterns: ", err);
            setLoading(false);
        });

        return () => unsubscribe();
    }, []);

    if (loading) {
        return (
            <div className="flex flex-col h-full bg-slate-50 dark:bg-slate-950 p-6 items-center justify-center text-slate-400">
                載入中...
            </div>
        );
    }

    if (uid === null) {
        return (
            <div className="flex flex-col h-full bg-slate-50 dark:bg-slate-950 p-6 items-center justify-center text-center">
                <div className="w-20 h-20 bg-slate-200 dark:bg-slate-800 rounded-full flex items-center justify-center mb-6 text-slate-400 dark:text-slate-500">
                    <User size={40} />
                </div>
                <h3 className="text-xl font-bold text-slate-700 dark:text-slate-300 mb-2">請先登入</h3>
                <p className="text-slate-500 dark:text-slate-400 max-w-sm">
                    請先至「個人」頁面登入才能使用語言模型功能。
                </p>
            </div>
        );
    }

    if (patterns.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center h-full bg-slate-50 dark:bg-slate-950 p-6 text-center">
                <div className="w-20 h-20 bg-slate-200 dark:bg-slate-800 rounded-full flex items-center justify-center mb-6 text-slate-400 dark:text-slate-500">
                    <Sparkles size={40} />
                </div>
                <h3 className="text-xl font-bold text-slate-700 dark:text-slate-300 mb-2">尚無任何語言模型句型</h3>
                <p className="text-slate-500 dark:text-slate-400 max-w-sm">
                    請先在教材裡完成跟讀練習並萃取句型。
                </p>
            </div>
        );
    }

    // 分類定義與轉換
    const categoryLabels: Record<string, string> = {
        'structural': '結構句型',
        'phrase': '片語',
        'collocation': '語組'
    };

    // 依 primaryCategory 分組
    const grouped = patterns.reduce((acc, p) => {
        const cat = p.primaryCategory || '未分類';
        if (!acc[cat]) acc[cat] = [];
        acc[cat].push(p);
        return acc;
    }, {} as Record<string, LanguagePattern[]>);

    return (
        <div className="flex flex-col h-full bg-slate-50 dark:bg-slate-950 p-6 overflow-y-auto pb-20">
            <div className="mb-8">
                <h2 className="text-2xl font-black text-slate-800 dark:text-white flex items-center gap-2">
                    <Sparkles className="text-indigo-600 dark:text-indigo-400" />
                    語言模型庫
                </h2>
                <p className="text-slate-500 dark:text-slate-400 mt-2 font-bold text-sm">
                    從跟讀教材中萃取出的精華句型
                </p>
            </div>

            <div className="space-y-8">
                {Object.keys(grouped).sort().map(primaryCategory => (
                    <div key={primaryCategory}>
                        <div className="flex items-center gap-2 mb-4">
                            <h3 className="text-lg font-bold text-slate-700 dark:text-slate-300">
                                {primaryCategory}
                            </h3>
                            <span className="text-xs bg-slate-200 dark:bg-slate-800 text-slate-500 dark:text-slate-400 px-2 py-0.5 rounded-full font-bold">
                                {grouped[primaryCategory].length}
                            </span>
                        </div>
                        
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            {grouped[primaryCategory].map(pattern => (
                                <div 
                                    key={pattern.id}
                                    onClick={() => onPatternClick(pattern.id)}
                                    className="bg-white dark:bg-slate-900 rounded-xl p-4 shadow-sm border border-slate-200 dark:border-slate-800 hover:shadow-md hover:border-indigo-200 dark:hover:border-indigo-800 transition-all cursor-pointer group flex flex-col"
                                >
                                    <div className="flex items-start justify-between mb-2">
                                        <h4 className="text-lg font-black text-slate-800 dark:text-slate-100 flex-1 pr-2 leading-tight">
                                            {pattern.text}
                                        </h4>
                                        <ChevronRight size={18} className="text-slate-300 group-hover:text-indigo-500 transition-colors shrink-0 mt-1" />
                                    </div>
                                    <div className="flex flex-wrap items-center gap-2 mt-auto pt-4">
                                        <span className="text-[10px] font-bold bg-indigo-50 text-indigo-600 dark:bg-indigo-900/30 dark:text-indigo-400 px-2 py-1 rounded-md">
                                            {categoryLabels[pattern.category] || pattern.category}
                                        </span>
                                        {pattern.sourceLabel && (
                                            <span className="text-[10px] font-bold text-slate-500 dark:text-slate-400 bg-slate-100 dark:bg-slate-800 px-2 py-1 rounded-md truncate max-w-[150px]">
                                                來自: {pattern.sourceLabel}
                                            </span>
                                        )}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}
