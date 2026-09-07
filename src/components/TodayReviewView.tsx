import React, { useState, useEffect, useMemo } from 'react';
import { collection, onSnapshot } from 'firebase/firestore';
import { auth, db, appId } from '../firebase';
import { LanguagePattern, PatternExampleSentence } from '../types';
import { isSydneyDateReached } from '../utils/sydneyTime';
import PatternPracticeSessionView from './PatternPracticeSessionView';
import { Sparkles, CalendarCheck, Target } from 'lucide-react';

interface ReviewItem {
    pattern: LanguagePattern;
    sentence: PatternExampleSentence;
}

export default function TodayReviewView() {
    const [patterns, setPatterns] = useState<LanguagePattern[]>([]);
    const [loading, setLoading] = useState(true);
    const [user, setUser] = useState(auth.currentUser);
    
    // Session states
    const [sessionQueue, setSessionQueue] = useState<ReviewItem[] | null>(null);
    const [completedKeys, setCompletedKeys] = useState<Set<string>>(new Set());
    const [activeItemKey, setActiveItemKey] = useState<string | null>(null);

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
        });
        return () => unsubscribe();
    }, [user]);

    const reviewItems = useMemo(() => {
        const items: ReviewItem[] = [];
        const now = Date.now();
        
        patterns.forEach((pattern) => {
            if (!pattern.exampleSentences) return;
            
            pattern.exampleSentences.forEach((sentence) => {
                if (!sentence.checked) return;
                
                const mastery = sentence.mastery || 0;
                if (mastery >= 1000) return;
                
                const nextAvailableAt = sentence.nextAvailableAt;
                if (nextAvailableAt === undefined || isSydneyDateReached(nextAvailableAt, now)) {
                    items.push({ pattern, sentence });
                }
            });
        });
        
        return items;
    }, [patterns]);

    if (!user) {
        return (
            <div className="flex flex-col items-center justify-center h-full bg-slate-50 dark:bg-slate-950 text-slate-500 font-bold">
                <p>請先登入以檢視今日複習</p>
            </div>
        );
    }

    if (loading && patterns.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center h-full bg-slate-50 dark:bg-slate-950 text-slate-500 font-bold">
                <p>載入中...</p>
            </div>
        );
    }

    const startSession = (startIndex: number) => {
        // Capture snapshot
        setSessionQueue([...reviewItems]);
        setCompletedKeys(new Set());
        
        const startingItem = reviewItems[startIndex];
        const key = `${startingItem.pattern.id}-${startingItem.sentence.id}`;
        setActiveItemKey(key);
    };

    const handleBackFromSession = () => {
        setSessionQueue(null);
        setCompletedKeys(new Set());
        setActiveItemKey(null);
    };

    const handleNextInSession = () => {
        if (!sessionQueue || !activeItemKey) return;
        
        const newCompleted = new Set(completedKeys);
        newCompleted.add(activeItemKey);
        setCompletedKeys(newCompleted);
        
        // Find next uncompleted item in queue
        const nextItem = sessionQueue.find(item => {
            const key = `${item.pattern.id}-${item.sentence.id}`;
            return !newCompleted.has(key);
        });
        
        if (nextItem) {
            setActiveItemKey(`${nextItem.pattern.id}-${nextItem.sentence.id}`);
        } else {
            // Queue finished
            handleBackFromSession();
        }
    };

    if (sessionQueue && activeItemKey) {
        const [targetPatternId, targetSentenceId] = activeItemKey.split('-');
        
        // Fetch from LATEST patterns source of truth, not snapshot
        const latestPattern = patterns.find(p => p.id === targetPatternId);
        if (!latestPattern || !latestPattern.exampleSentences) {
            // Fallback if data is suddenly gone
            handleBackFromSession();
            return null;
        }
        
        const latestSentenceIndex = latestPattern.exampleSentences.findIndex(s => s.id === targetSentenceId);
        if (latestSentenceIndex === -1) {
            // Fallback if data is suddenly gone
            handleBackFromSession();
            return null;
        }
        
        // Check if this is the last uncompleted item in the snapshot queue
        const remainingUncompleted = sessionQueue.filter(item => {
            const key = `${item.pattern.id}-${item.sentence.id}`;
            return key !== activeItemKey && !completedKeys.has(key);
        });
        const isLastSentence = remainingUncompleted.length === 0;
        
        return (
            <PatternPracticeSessionView
                pattern={latestPattern}
                sentenceIndex={latestSentenceIndex}
                onBack={handleBackFromSession}
                onNext={handleNextInSession}
                isLastSentence={isLastSentence}
            />
        );
    }

    return (
        <div className="flex flex-col h-full bg-slate-50 dark:bg-slate-950 p-6 overflow-y-auto pb-20">
            <div className="mb-6 flex items-center gap-3">
                <div className="w-10 h-10 bg-indigo-100 dark:bg-indigo-900/40 text-indigo-600 dark:text-indigo-400 rounded-xl flex items-center justify-center">
                    <CalendarCheck size={24} />
                </div>
                <div>
                    <h2 className="text-2xl font-black text-slate-800 dark:text-white">今日複習</h2>
                    <p className="text-sm font-bold text-slate-500">
                        {reviewItems.length > 0 
                            ? `共有 ${reviewItems.length} 個句子等待練習` 
                            : '所有進度已完成'}
                    </p>
                </div>
            </div>

            {reviewItems.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-20 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 text-center shadow-sm">
                    <Sparkles size={48} className="text-amber-400 mb-4" />
                    <h3 className="text-lg font-black text-slate-700 dark:text-slate-200 mb-2">今天沒有可以複習的句子</h3>
                    <p className="text-sm font-bold text-slate-500">
                        去造更多新句型，或等待下一輪解鎖吧！
                    </p>
                </div>
            ) : (
                <div className="space-y-4">
                    {reviewItems.map((item, index) => {
                        const mastery = item.sentence.mastery || 0;
                        return (
                            <div 
                                key={`${item.pattern.id}-${item.sentence.id}`}
                                onClick={() => startSession(index)}
                                className="bg-white dark:bg-slate-900 rounded-2xl p-5 border border-slate-200 dark:border-slate-800 shadow-sm cursor-pointer hover:border-indigo-300 dark:hover:border-indigo-700 transition-colors group"
                            >
                                <div className="text-xs font-bold text-indigo-500 mb-2 truncate">
                                    來自句型：{item.pattern.text}
                                </div>
                                <div className="text-lg font-bold text-slate-800 dark:text-slate-100 mb-4">
                                    {item.sentence.text}
                                </div>
                                <div className="flex items-center gap-2 text-xs font-bold text-slate-500">
                                    <Target size={14} className="text-amber-500" />
                                    熟練度: {mastery} / 1000
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}