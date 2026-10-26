import React, { useState, useEffect } from 'react';
import { collection, onSnapshot } from 'firebase/firestore';
import { auth, db, appId } from '../firebase';
import { LanguagePattern } from '../types';
import { Trophy, Medal, Star, Sparkles } from 'lucide-react';
import { getMasteredCount } from '../utils/patternStage';

export default function BadgeMode() {
    const [patterns, setPatterns] = useState<LanguagePattern[]>([]);
    const [loading, setLoading] = useState(true);
    const [user, setUser] = useState(auth.currentUser);

    useEffect(() => {
        const unsubscribeAuth = auth.onAuthStateChanged((u) => {
            setUser(u);
            if (!u) {
                setPatterns([]);
                setLoading(false);
            }
        });
        return () => unsubscribeAuth();
    }, []);

    useEffect(() => {
        if (!user) return;
        setLoading(true);
        const patternsRef = collection(db, `artifacts/${appId}/users/${user.uid}/languagePatterns`);
        const unsubscribe = onSnapshot(patternsRef, (snapshot) => {
            const loaded: LanguagePattern[] = [];
            snapshot.forEach((doc) => {
                loaded.push({ id: doc.id, ...doc.data() } as LanguagePattern);
            });
            setPatterns(loaded);
            setLoading(false);
        }, (error) => {
            console.error('[監聽來源:BadgeMode-languagePatterns]', error);
        });
        return () => unsubscribe();
    }, [user]);

    if (!user) {
        return (
            <div className="flex flex-col items-center justify-center h-full bg-slate-50 dark:bg-slate-950 text-slate-500 font-bold p-6 text-center">
                <Trophy size={48} className="mb-4 opacity-20" />
                <p>請先登入以檢視成就徽章</p>
            </div>
        );
    }

    if (loading && patterns.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center h-full bg-slate-50 dark:bg-slate-950 text-slate-500 font-bold p-6">
                <p>載入中...</p>
            </div>
        );
    }

    // 三個深度階段：可用（第 1 組全精熟）、熟練、精通
    const MILESTONES = [
        { target: 10, label: '可用' },
        { target: 40, label: '熟練' },
        { target: 100, label: '精通' }
    ];

    return (
        <div className="flex flex-col h-full bg-slate-50 dark:bg-slate-950 p-6 overflow-y-auto pb-20">
            <div className="mb-8">
                <h2 className="text-2xl font-black text-slate-900 dark:text-slate-100 tracking-tighter">成就徽章</h2>
                <p className="text-sm font-bold text-slate-500 mt-2">精熟 10 句即「可用」，40 句「熟練」，100 句「精通」</p>
            </div>

            {patterns.length === 0 ? (
                <div className="py-20 text-center text-slate-400 dark:text-slate-500 border-2 border-dashed border-slate-200 dark:border-slate-800 rounded-[3rem] bg-white/50 dark:bg-slate-900/50 backdrop-blur-xs">
                    <Sparkles className="mx-auto mb-6 opacity-20 text-indigo-400" size={64} />
                    <h4 className="font-black text-slate-600 dark:text-slate-300 text-lg mb-2">尚未開始任何句型</h4>
                    <p className="text-sm font-bold opacity-60 px-8 leading-relaxed">
                        去句型庫新增並練習，即可在這裡看到成就。
                    </p>
                </div>
            ) : (
                <div className="space-y-6">
                    {patterns.map(pattern => {
                        const finishedCount = getMasteredCount(pattern);
                        
                        return (
                            <div key={pattern.id} className="bg-white dark:bg-slate-900 rounded-2xl p-6 border border-slate-200 dark:border-slate-800 shadow-xs">
                                <h3 className="text-lg font-black text-slate-800 dark:text-slate-100 mb-4 truncate">{pattern.text}</h3>
                                <p className="text-xs font-bold text-slate-500 mb-6">已精熟句數：<span className="text-indigo-600 dark:text-indigo-400 text-base">{finishedCount}</span></p>
                                
                                <div className="grid grid-cols-3 gap-3">
                                    {MILESTONES.map(({ target, label }) => {
                                        const achieved = finishedCount >= target;
                                        const remaining = target - finishedCount;
                                        
                                        return (
                                            <div key={target} className={`relative overflow-hidden flex flex-col items-center justify-center p-4 rounded-xl border-2 transition-all ${achieved ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-900/30' : 'border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-950/50 grayscale opacity-70'}`}>
                                                <div className={`w-14 h-14 rounded-full flex items-center justify-center mb-3 ${achieved ? 'bg-indigo-500 text-white shadow-md' : 'bg-slate-200 dark:bg-slate-800 text-slate-400'}`}>
                                                    {target === 10 ? <Medal size={28} /> : target === 40 ? <Star size={28} /> : <Trophy size={28} />}
                                                </div>
                                                <div className="text-center z-10">
                                                    <div className={`font-black text-lg ${achieved ? 'text-indigo-700 dark:text-indigo-300' : 'text-slate-500 dark:text-slate-400'}`}>{label}</div>
                                                    <div className="text-[11px] font-bold text-slate-400 dark:text-slate-500">{target} 句精熟</div>
                                                    {!achieved && <div className="text-xs font-bold text-slate-400 dark:text-slate-500 mt-1">還差 {remaining} 句</div>}
                                                    {achieved && <div className="text-xs font-black text-indigo-500 dark:text-indigo-400 mt-1 uppercase tracking-widest">Achieved</div>}
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}