import React, { useState, useEffect, useMemo, useRef } from 'react';
import { collection, onSnapshot } from 'firebase/firestore';
import { auth, db, appId } from '../firebase';
import { LanguagePattern, PatternExampleSentence } from '../types';
import { isSydneyDateReached, getSydneyDateString } from '../utils/sydneyTime';
import PatternPracticeSessionView from './PatternPracticeSessionView';
import { Sparkles, CalendarCheck, Target, CheckCircle2, ShieldCheck, Loader2, AlertCircle } from 'lucide-react';
import { prefetchSpeech } from '../services/speech';
import { needsMaintenanceInit, initMaintenance, isMaintenanceDue, pickMaintenanceSentences, applyMaintenanceResult, MaintenanceOutcome, MAINTENANCE_SIZE, MAINTENANCE_PASS_COUNT } from '../services/maintenance';

interface ReviewItem {
    pattern: LanguagePattern;
    sentence: PatternExampleSentence;
}

interface ReviewGroup {
    key: string;
    pattern: LanguagePattern;
    groupIndex: number;
    items: ReviewItem[];
    avgMastery: number;
}

interface MaintenanceItem {
    pattern: LanguagePattern;
    sentences: PatternExampleSentence[];
}

type MaintenanceResultState =
    | { kind: 'result'; outcome: MaintenanceOutcome }
    | { kind: 'incomplete' }
    | { kind: 'already' }
    | { kind: 'error'; message: string };

export default function TodayReviewView() {
    const [patterns, setPatterns] = useState<LanguagePattern[]>([]);
    const [loading, setLoading] = useState(true);
    const [user, setUser] = useState(auth.currentUser);
    
    // Session states
    const [sessionQueue, setSessionQueue] = useState<ReviewItem[] | null>(null);
    const [completedKeys, setCompletedKeys] = useState<Set<string>>(new Set());
    const [activeItemKey, setActiveItemKey] = useState<string | null>(null);
    const [startMasteryMap, setStartMasteryMap] = useState<Record<string, number>>({});
    const [activeGroup, setActiveGroup] = useState<{ pattern: LanguagePattern; groupIndex: number } | null>(null);
    const [isSummary, setIsSummary] = useState(false);

    // 維持複習
    const [maintenancePattern, setMaintenancePattern] = useState<LanguagePattern | null>(null);
    const maintenanceScoresRef = useRef<Record<string, boolean>>({});
    const [maintenanceSaving, setMaintenanceSaving] = useState(false);
    const [maintenanceResult, setMaintenanceResult] = useState<MaintenanceResultState | null>(null);
    const maintenanceInitRequestedRef = useRef<Set<string>>(new Set());
    const speechPrefetchedRef = useRef(false);

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
            console.error('[監聽來源:TodayReviewView-languagePatterns]', error);
        });
        return () => unsubscribe();
    }, [user]);

    // 達到「可用」但還沒有維持複習排程的句型：補設 30 天後到期（舊句型也適用）
    useEffect(() => {
        patterns.forEach((p) => {
            if (!needsMaintenanceInit(p) || maintenanceInitRequestedRef.current.has(p.id)) return;
            maintenanceInitRequestedRef.current.add(p.id);
            initMaintenance(p.id).catch((err) => console.warn('[維持複習] 設定排程失敗:', err));
        });
    }, [patterns]);

    const maintenanceItems = useMemo(() => {
        const now = Date.now();
        const items: MaintenanceItem[] = [];
        patterns.forEach((pattern) => {
            if (!isMaintenanceDue(pattern, now)) return;
            const sentences = pickMaintenanceSentences(pattern, now);
            if (sentences.length < MAINTENANCE_SIZE) return;
            items.push({ pattern, sentences });
        });
        items.sort((a, b) => (a.pattern.text || '').localeCompare(b.pattern.text || ''));
        return items;
    }, [patterns]);

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

    const reviewGroups = useMemo(() => {
        const map = new Map<string, { pattern: LanguagePattern; groupIndex: number; items: ReviewItem[] }>();

        reviewItems.forEach((item) => {
            const gIdx = item.sentence.groupIndex ?? 0;
            const key = `${item.pattern.id}::${gIdx}`;
            if (!map.has(key)) {
                map.set(key, { pattern: item.pattern, groupIndex: gIdx, items: [] });
            }
            map.get(key)!.items.push(item);
        });

        const groups: ReviewGroup[] = Array.from(map.entries()).map(([key, data]) => {
            // items（依 sentence.id 結尾數字由小到大排序，例如 p_0_2 的 2）
            const sortedItems = [...data.items].sort((a, b) => {
                const numA = parseInt(a.sentence.id.split('_').pop() || '0', 10);
                const numB = parseInt(b.sentence.id.split('_').pop() || '0', 10);
                return (isNaN(numA) ? 0 : numA) - (isNaN(numB) ? 0 : numB);
            });
            const totalMastery = sortedItems.reduce((acc, it) => acc + (it.sentence.mastery || 0), 0);
            const avgMastery = sortedItems.length > 0 ? Math.round(totalMastery / sortedItems.length) : 0;
            return {
                key,
                pattern: data.pattern,
                groupIndex: data.groupIndex,
                items: sortedItems,
                avgMastery
            };
        });

        // 組的排序：先依 pattern.text（localeCompare），再依 groupIndex
        groups.sort((a, b) => {
            const cmp = (a.pattern.text || '').localeCompare(b.pattern.text || '');
            if (cmp !== 0) return cmp;
            return a.groupIndex - b.groupIndex;
        });

        return groups;
    }, [reviewItems]);

    // 打開今日複習時，預先產生待練句子缺少的語音（每次進入畫面一次，最多 30 段）
    useEffect(() => {
        if (speechPrefetchedRef.current || loading) return;
        if (maintenanceItems.length === 0 && reviewGroups.length === 0) return;
        speechPrefetchedRef.current = true;
        const sentences: PatternExampleSentence[] = [
            ...maintenanceItems.reduce<PatternExampleSentence[]>((acc, m) => acc.concat(m.sentences), []),
            ...reviewGroups.reduce<PatternExampleSentence[]>((acc, g) => acc.concat(g.items.map(it => it.sentence)), [])
        ];
        void prefetchSpeech(sentences.reduce<string[]>((acc, s) => acc.concat([s.qaQuestion || '', s.situationalPrompt || '', s.text || '']), []));
    }, [loading, maintenanceItems, reviewGroups]);

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

    const startSession = (group: ReviewGroup) => {
        const queue = group.items;
        if (queue.length === 0) return;
        setSessionQueue(queue);
        setCompletedKeys(new Set());
        const initialMastery: Record<string, number> = {};
        queue.forEach((it) => {
            const key = `${it.pattern.id}::${it.sentence.id}`;
            initialMastery[key] = it.sentence.mastery || 0;
        });
        setStartMasteryMap(initialMastery);
        setActiveGroup({ pattern: group.pattern, groupIndex: group.groupIndex });
        setIsSummary(false);
        const firstKey = `${queue[0].pattern.id}::${queue[0].sentence.id}`;
        setActiveItemKey(firstKey);
    };

    const startMaintenance = (item: MaintenanceItem) => {
        const queue: ReviewItem[] = item.sentences.map((sentence) => ({ pattern: item.pattern, sentence }));
        if (queue.length === 0) return;
        setSessionQueue(queue);
        setCompletedKeys(new Set());
        setStartMasteryMap({});
        setActiveGroup(null);
        setMaintenancePattern(item.pattern);
        maintenanceScoresRef.current = {};
        setMaintenanceResult(null);
        setMaintenanceSaving(false);
        setIsSummary(false);
        setActiveItemKey(`${queue[0].pattern.id}::${queue[0].sentence.id}`);
        // 預先產生第 2、3 題的語音（第 1 題由練習畫面當場取得）
        void prefetchSpeech(item.sentences.slice(1).reduce<string[]>((acc, s) => acc.concat([s.qaQuestion || '', s.situationalPrompt || '', s.text || '']), []));
    };

    // 三句都做完才結算；任何一句沒有結果（例如跳過）就不計算，下次重做
    const finishMaintenance = async (pattern: LanguagePattern, queue: ReviewItem[]) => {
        const scores: Record<string, boolean> = {};
        for (const it of queue) {
            const s = maintenanceScoresRef.current[it.sentence.id];
            if (typeof s !== 'boolean') {
                setMaintenanceResult({ kind: 'incomplete' });
                return;
            }
            scores[it.sentence.id] = s;
        }
        setMaintenanceSaving(true);
        try {
            const outcome = await applyMaintenanceResult(pattern.id, scores);
            setMaintenanceResult(outcome ? { kind: 'result', outcome } : { kind: 'already' });
        } catch (err: any) {
            console.error('[維持複習] 儲存結果失敗:', err);
            setMaintenanceResult({ kind: 'error', message: err?.message || '儲存結果失敗' });
        } finally {
            setMaintenanceSaving(false);
        }
    };

    const handleBackFromSession = () => {
        setSessionQueue(null);
        setCompletedKeys(new Set());
        setActiveItemKey(null);
        setStartMasteryMap({});
        setActiveGroup(null);
        setIsSummary(false);
        setMaintenancePattern(null);
        maintenanceScoresRef.current = {};
        setMaintenanceResult(null);
        setMaintenanceSaving(false);
    };

    const handleNextInSession = () => {
        if (!sessionQueue || !activeItemKey) return;
        
        const newCompleted = new Set(completedKeys);
        newCompleted.add(activeItemKey);
        setCompletedKeys(newCompleted);
        
        // Find next uncompleted item in queue
        const nextItem = sessionQueue.find(item => {
            const key = `${item.pattern.id}::${item.sentence.id}`;
            return !newCompleted.has(key);
        });
        
        if (nextItem) {
            setActiveItemKey(`${nextItem.pattern.id}::${nextItem.sentence.id}`);
        } else {
            // Queue finished -> enter summary mode
            setActiveItemKey(null);
            setIsSummary(true);
            if (maintenancePattern) {
                void finishMaintenance(maintenancePattern, sessionQueue);
            }
        }
    };

    if (isSummary && maintenancePattern) {
        const r = maintenanceResult;
        const passed = r?.kind === 'result' && r.outcome.passed;
        return (
            <div className="flex flex-col items-center justify-center h-full bg-slate-50 dark:bg-slate-950 p-6 overflow-y-auto">
                <div className="w-full max-w-md bg-white dark:bg-slate-900 rounded-3xl p-8 border border-slate-200 dark:border-slate-800 shadow-xl text-center space-y-6">
                    <div className={`w-16 h-16 rounded-2xl flex items-center justify-center mx-auto shadow-inner ${passed ? 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-600 dark:text-emerald-400' : 'bg-amber-100 dark:bg-amber-900/40 text-amber-600 dark:text-amber-400'}`}>
                        {maintenanceSaving || !r ? <Loader2 size={36} className="animate-spin" /> : passed ? <ShieldCheck size={36} /> : <AlertCircle size={36} />}
                    </div>

                    <div>
                        <h2 className="text-2xl font-black text-slate-800 dark:text-white">
                            {maintenanceSaving || !r ? '儲存結果中…'
                                : r.kind === 'result' ? (r.outcome.passed ? '維持複習通過' : '這次沒有通過')
                                : r.kind === 'incomplete' ? '這次不計算'
                                : r.kind === 'already' ? '已經更新過了'
                                : '儲存失敗'}
                        </h2>
                        <p className="text-sm font-bold text-slate-500 dark:text-slate-400 mt-1">
                            {maintenancePattern.text}
                        </p>
                    </div>

                    {r && !maintenanceSaving && (
                        <div className="bg-slate-50 dark:bg-slate-800/60 rounded-2xl p-4 border border-slate-100 dark:border-slate-800 text-sm font-bold text-slate-600 dark:text-slate-300 leading-relaxed space-y-1">
                            {r.kind === 'result' && (
                                <>
                                    <p>{MAINTENANCE_SIZE} 句中 {r.outcome.passCount} 句全對</p>
                                    {r.outcome.passed ? (
                                        <p>已連續通過 {r.outcome.level} 次</p>
                                    ) : (
                                        <p>{r.outcome.failedCount} 句熟練度降為 750，已回到今日複習，今天就可以重新練習</p>
                                    )}
                                    <p>下次維持複習：{getSydneyDateString(r.outcome.dueAt)}</p>
                                </>
                            )}
                            {r.kind === 'incomplete' && <p>有題目沒有完成評分，這次的結果不會更新，之後再做一次即可</p>}
                            {r.kind === 'already' && <p>這個句型的維持複習已經更新過（或已延後），這次不重複計算</p>}
                            {r.kind === 'error' && <p>{r.message}，請稍後再做一次</p>}
                        </div>
                    )}

                    <button
                        onClick={handleBackFromSession}
                        disabled={maintenanceSaving}
                        className="w-full py-4 bg-indigo-600 hover:bg-indigo-700 active:scale-95 text-white font-bold rounded-2xl shadow-lg shadow-indigo-200 dark:shadow-none transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        返回今日複習
                    </button>
                </div>
            </div>
        );
    }

    if (isSummary && activeGroup) {
        let totalMasteryDiff = 0;
        let masteredCount = 0;

        completedKeys.forEach(key => {
            const [pId, sId] = key.split('::');
            const p = patterns.find(item => item.id === pId);
            const s = p?.exampleSentences?.find(item => item.id === sId);
            const latestMastery = s?.mastery || 0;
            const startMastery = startMasteryMap[key] ?? 0;

            totalMasteryDiff += (latestMastery - startMastery);
            if (startMastery < 1000 && latestMastery === 1000) {
                masteredCount += 1;
            }
        });

        const diffDisplay = totalMasteryDiff >= 0 ? `+${totalMasteryDiff}` : `${totalMasteryDiff}`;

        return (
            <div className="flex flex-col items-center justify-center h-full bg-slate-50 dark:bg-slate-950 p-6 overflow-y-auto">
                <div className="w-full max-w-md bg-white dark:bg-slate-900 rounded-3xl p-8 border border-slate-200 dark:border-slate-800 shadow-xl text-center space-y-6">
                    <div className="w-16 h-16 bg-emerald-100 dark:bg-emerald-900/40 text-emerald-600 dark:text-emerald-400 rounded-2xl flex items-center justify-center mx-auto shadow-inner">
                        <CheckCircle2 size={36} />
                    </div>

                    <div>
                        <h2 className="text-2xl font-black text-slate-800 dark:text-white">
                            本組練習完成
                        </h2>
                        <p className="text-sm font-bold text-slate-500 dark:text-slate-400 mt-1">
                            {activeGroup.pattern.text}・第 {activeGroup.groupIndex + 1} 組
                        </p>
                    </div>

                    <div className="grid grid-cols-3 gap-3 pt-2">
                        <div className="bg-slate-50 dark:bg-slate-800/60 rounded-2xl p-4 border border-slate-100 dark:border-slate-800">
                            <div className="text-xs font-bold text-slate-500 dark:text-slate-400 mb-1">練習句數</div>
                            <div className="text-xl font-black text-slate-800 dark:text-white">{completedKeys.size}</div>
                        </div>
                        <div className="bg-indigo-50 dark:bg-indigo-950/40 rounded-2xl p-4 border border-indigo-100 dark:border-indigo-900/50">
                            <div className="text-xs font-bold text-indigo-600 dark:text-indigo-400 mb-1">熟練度合計</div>
                            <div className="text-xl font-black text-indigo-600 dark:text-indigo-400">{diffDisplay}</div>
                        </div>
                        <div className="bg-amber-50 dark:bg-amber-950/40 rounded-2xl p-4 border border-amber-100 dark:border-amber-900/50">
                            <div className="text-xs font-bold text-amber-600 dark:text-amber-400 mb-1">本次精熟</div>
                            <div className="text-xl font-black text-amber-600 dark:text-amber-400">{masteredCount}</div>
                        </div>
                    </div>

                    <button
                        onClick={handleBackFromSession}
                        className="w-full py-4 bg-indigo-600 hover:bg-indigo-700 active:scale-95 text-white font-bold rounded-2xl shadow-lg shadow-indigo-200 dark:shadow-none transition-all cursor-pointer"
                    >
                        返回今日複習
                    </button>
                </div>
            </div>
        );
    }

    if (sessionQueue && activeItemKey) {
        const [targetPatternId, targetSentenceId] = activeItemKey.split('::');
        
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
            const key = `${item.pattern.id}::${item.sentence.id}`;
            return key !== activeItemKey && !completedKeys.has(key);
        });
        const isLastSentence = remainingUncompleted.length === 0;
        
        return (
            <PatternPracticeSessionView
                pattern={latestPattern}
                sentenceIndex={latestSentenceIndex}
                groupIndex={activeGroup?.groupIndex}
                onBack={handleBackFromSession}
                onNext={handleNextInSession}
                isLastSentence={isLastSentence}
                progressLabel={maintenancePattern
                    ? `維持題・第 ${completedKeys.size + 1} / ${sessionQueue.length} 題`
                    : `第 ${completedKeys.size + 1} / ${sessionQueue.length} 題`}
                onScored={maintenancePattern
                    ? (sentenceId, _total, isExact) => { maintenanceScoresRef.current[sentenceId] = isExact; }
                    : undefined}
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
                        {reviewItems.length > 0 || maintenanceItems.length > 0
                            ? [
                                reviewItems.length > 0 ? `共有 ${reviewItems.length} 個句子等待練習` : '',
                                maintenanceItems.length > 0 ? `${maintenanceItems.length} 個句型要維持複習` : ''
                            ].filter(Boolean).join('・')
                            : '所有進度已完成'}
                    </p>
                </div>
            </div>

            {maintenanceItems.length > 0 && (
                <div className="mb-6">
                    <h3 className="text-sm font-black text-slate-500 dark:text-slate-400 mb-3 flex items-center gap-2">
                        <ShieldCheck size={16} className="text-emerald-500" />
                        維持複習
                    </h3>
                    <div className="space-y-4">
                        {maintenanceItems.map((item) => (
                            <div
                                key={item.pattern.id}
                                onClick={() => startMaintenance(item)}
                                className="bg-white dark:bg-slate-900 rounded-2xl p-5 border border-emerald-200 dark:border-emerald-900/60 shadow-sm cursor-pointer hover:border-emerald-400 dark:hover:border-emerald-700 transition-colors"
                            >
                                <div className="text-xs font-bold text-emerald-600 dark:text-emerald-400 mb-2 truncate">
                                    句型：{item.pattern.text}
                                </div>
                                <div className="text-lg font-bold text-slate-800 dark:text-slate-100 mb-2">
                                    維持題 {item.sentences.length} 句
                                </div>
                                <div className="text-xs font-bold text-slate-500 dark:text-slate-400">
                                    {(item.pattern.maintenance?.level || 0) > 0
                                        ? `已連續通過 ${item.pattern.maintenance?.level} 次`
                                        : item.pattern.maintenance?.lastReviewedAt ? '上次沒有通過' : '第一次維持複習'}
                                    ・{MAINTENANCE_SIZE} 句中 {MAINTENANCE_PASS_COUNT} 句全對即通過
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {reviewGroups.length === 0 && maintenanceItems.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-20 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 text-center shadow-sm">
                    <Sparkles size={48} className="text-amber-400 mb-4" />
                    <h3 className="text-lg font-black text-slate-700 dark:text-slate-200 mb-2">今天沒有可以複習的句子</h3>
                    <p className="text-sm font-bold text-slate-500">
                        去造更多新句型，或等待下一輪解鎖吧！
                    </p>
                </div>
            ) : (
                <div className="space-y-4">
                    {reviewGroups.map((group) => {
                        return (
                            <div 
                                key={group.key}
                                onClick={() => startSession(group)}
                                className="bg-white dark:bg-slate-900 rounded-2xl p-5 border border-slate-200 dark:border-slate-800 shadow-sm cursor-pointer hover:border-indigo-300 dark:hover:border-indigo-700 transition-colors group"
                            >
                                <div className="text-xs font-bold text-indigo-500 dark:text-indigo-400 mb-2 truncate">
                                    來自句型：{group.pattern.text}
                                </div>
                                <div className="text-lg font-bold text-slate-800 dark:text-slate-100 mb-4">
                                    第 {group.groupIndex + 1} 組・待練 {group.items.length} 句
                                </div>
                                <div className="flex items-center gap-2 text-xs font-bold text-slate-500 dark:text-slate-400">
                                    <Target size={14} className="text-amber-500" />
                                    平均熟練度：{group.avgMastery} / 1000
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}