import React, { useState, useEffect, useMemo, useRef } from 'react';
import { collection, onSnapshot } from 'firebase/firestore';
import { auth, db, appId } from '../firebase';
import { LanguagePattern, PatternExampleSentence } from '../types';
import { isSydneyDateReached, getSydneyDateString } from '../utils/sydneyTime';
import PatternPracticeSessionView from './PatternPracticeSessionView';
import { Sparkles, ShieldCheck, Loader2, AlertCircle, ChevronRight, CircleSlash } from 'lucide-react';
import Button from './ui/Button';
import { groupMasteryBars, GroupMasteryBar } from '../utils/groupMastery';
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

/** 系統是否開啟「減少動態效果」 */
const prefersReducedMotion = () => {
    try { return !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
};

/**
 * 一組 10 句的熟練度長條。
 * 小（今日複習卡片）：滿 1000 金色，其餘主色。
 * 大（本組練習完成）：底段主色、這次增加的那段金色；開始前就已滿 1000 的整根金色。
 */
function MasteryBars({ bars, size, showGain = false }: { bars: GroupMasteryBar[]; size: 'sm' | 'lg'; showGain?: boolean }) {
    const big = size === 'lg';
    return (
        <span
            aria-hidden="true"
            className={`grid grid-cols-10 items-end ${big ? 'h-24 gap-1.5' : 'h-5 w-full max-w-[184px] gap-1'}`}
        >
            {bars.map((b) => {
                if (!b.created) {
                    return <span key={b.id} className={`h-full border border-dashed border-muted/40 ${big ? 'rounded-md' : 'rounded-[3px]'}`} />;
                }
                const base = b.mastery - b.gain;
                const alreadyFull = b.mastered && b.gain === 0;
                const gainPct = big && showGain ? b.gain / 10 : 0;
                return (
                    <span key={b.id} className={`relative h-full overflow-hidden bg-line ${big ? 'rounded-md' : 'rounded-[3px]'}`}>
                        <span
                            className={`absolute inset-x-0 bottom-0 ${(!big && b.mastered) || alreadyFull ? 'bg-gold' : 'bg-accent'}`}
                            style={{ height: `${(big ? base : b.mastery) / 10}%` }}
                        />
                        {big && (
                            <span
                                className="absolute inset-x-0 bg-gold transition-[height] delay-200 duration-700 ease-[var(--ease-out-soft)]"
                                style={{ bottom: `${base / 10}%`, height: `${gainPct}%` }}
                            />
                        )}
                    </span>
                );
            })}
        </span>
    );
}

export default function TodayReviewView({ tabs }: { tabs?: React.ReactNode }) {
    const [patterns, setPatterns] = useState<LanguagePattern[]>([]);
    const [loading, setLoading] = useState(true);
    // 監聽失敗（Firestore 會結束這個監聽）：沒有資料時顯示錯誤與重試，已有資料就保留畫面
    const [loadError, setLoadError] = useState(false);
    const [retryKey, setRetryKey] = useState(0);
    const [user, setUser] = useState(auth.currentUser);
    
    // Session states
    const [sessionQueue, setSessionQueue] = useState<ReviewItem[] | null>(null);
    const [completedKeys, setCompletedKeys] = useState<Set<string>>(new Set());
    const [activeItemKey, setActiveItemKey] = useState<string | null>(null);
    const [startMasteryMap, setStartMasteryMap] = useState<Record<string, number>>({});
    const [activeGroup, setActiveGroup] = useState<{ pattern: LanguagePattern; groupIndex: number } | null>(null);
    const [isSummary, setIsSummary] = useState(false);
    // 練習期間真的寫入的熟練度（句子 id → 寫入後的值）：完成畫面以這份為準，避免監聽延遲先顯示 +0
    const [sessionAfter, setSessionAfter] = useState<Record<string, number>>({});
    const [summaryBarsShown, setSummaryBarsShown] = useState(false);

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
        setLoadError(false);
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
            setLoadError(true);
            setLoading(false);
        });
        return () => unsubscribe();
    }, [user, retryKey]);

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

    // 本組完成畫面：長條的金色增加段只長高一次；減少動態效果時直接顯示
    useEffect(() => {
        if (!isSummary) {
            setSummaryBarsShown(false);
            return;
        }
        if (prefersReducedMotion()) {
            setSummaryBarsShown(true);
            return;
        }
        const raf = requestAnimationFrame(() => setSummaryBarsShown(true));
        return () => cancelAnimationFrame(raf);
    }, [isSummary]);

    if (user && loadError && patterns.length === 0) {
        return (
            <div className="flex h-full flex-col px-5 pt-4 sm:px-8 lg:px-14 lg:pt-9">
                {tabs && <div className="lg:flex lg:justify-end">{tabs}</div>}
                <div role="alert" className="flex flex-1 flex-col items-center justify-center gap-4 text-center text-[15px] text-muted">
                    <AlertCircle size={36} className="text-danger" aria-hidden="true" />
                    <p className="max-w-sm leading-relaxed">讀取句型失敗，請檢查網路後再試一次</p>
                    <Button variant="secondary" onClick={() => setRetryKey((k) => k + 1)}>重試</Button>
                </div>
            </div>
        );
    }

    if (!user || (loading && patterns.length === 0)) {
        return (
            <div className="flex h-full flex-col px-5 pt-4 sm:px-8 lg:px-14 lg:pt-9">
                {tabs && <div className="lg:flex lg:justify-end">{tabs}</div>}
                <div className="flex flex-1 items-center justify-center text-[15px] text-muted">
                    {!user ? <p>請先登入以檢視今日複習</p> : (
                        <p className="flex items-center gap-2"><Loader2 size={18} className="animate-spin text-accent" aria-hidden="true" />載入中...</p>
                    )}
                </div>
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
        setSessionAfter({});
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
        setSessionAfter({});
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
        setSessionAfter({});
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
        const pending = maintenanceSaving || !r;
        const passed = r?.kind === 'result' && r.outcome.passed;
        return (
            <div className="flex h-full flex-col overflow-y-auto px-7 pt-10 pb-9 sm:px-10">
                <div className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center gap-8" aria-live="polite">
                    <div className="flex flex-col gap-3">
                        <span className={`flex size-14 items-center justify-center rounded-2xl ${pending ? 'bg-surface-2 text-accent' : passed ? 'bg-gold/12 text-gold' : 'bg-warn/10 text-warn'}`} aria-hidden="true">
                            {pending ? <Loader2 size={28} className="animate-spin" /> : passed ? <ShieldCheck size={28} /> : <AlertCircle size={28} />}
                        </span>
                        <h1 className="text-[26px] font-bold tracking-wide text-ink">
                            {pending ? '儲存結果中…'
                                : r.kind === 'result' ? (r.outcome.passed ? '維持複習通過' : '這次沒有通過')
                                : r.kind === 'incomplete' ? '這次不計算'
                                : r.kind === 'already' ? '已經更新過了'
                                : '儲存失敗'}
                        </h1>
                        <p lang="en" className="font-reading text-[22px] leading-snug text-ink break-words">{maintenancePattern.text}</p>
                    </div>

                    {r && !maintenanceSaving && (
                        <div className="flex flex-col gap-1.5 border-y border-line py-5 text-[15px] leading-relaxed text-ink">
                            {r.kind === 'result' && (
                                <>
                                    <p>{MAINTENANCE_SIZE} 句中 {r.outcome.passCount} 句全對</p>
                                    {r.outcome.passed ? (
                                        <p>已連續通過 {r.outcome.level} 次</p>
                                    ) : (
                                        <p>{r.outcome.failedCount} 句熟練度降為 750，已回到今日複習，今天就可以重新練習</p>
                                    )}
                                    <p className="text-muted">下次維持複習：{getSydneyDateString(r.outcome.dueAt)}</p>
                                </>
                            )}
                            {r.kind === 'incomplete' && <p>有題目沒有完成評分，這次的結果不會更新，之後再做一次即可</p>}
                            {r.kind === 'already' && <p>這個句型的維持複習已經更新過（或已延後），這次不重複計算</p>}
                            {r.kind === 'error' && <p className="text-danger">{r.message}，請稍後再做一次</p>}
                        </div>
                    )}
                </div>
                <div className="mx-auto w-full max-w-md pt-6">
                    <Button size="lg" fullWidth onClick={handleBackFromSession} disabled={maintenanceSaving}>返回今日複習</Button>
                </div>
            </div>
        );
    }

    if (isSummary && activeGroup) {
        // 練習後的熟練度：優先用這次練習真的寫入的值，沒有才用最新的監聽資料
        const latestGroupPattern = patterns.find(item => item.id === activeGroup.pattern.id) || activeGroup.pattern;
        let totalMasteryDiff = 0;
        let masteredCount = 0;
        const startById: Record<string, number> = {};

        completedKeys.forEach(key => {
            const [pId, sId] = key.split('::');
            const p = patterns.find(item => item.id === pId);
            const s = p?.exampleSentences?.find(item => item.id === sId);
            const latestMastery = sessionAfter[sId] ?? (s?.mastery || 0);
            const startMastery = startMasteryMap[key] ?? 0;

            totalMasteryDiff += (latestMastery - startMastery);
            if (startMastery < 1000 && latestMastery === 1000) {
                masteredCount += 1;
            }
        });
        Object.entries(startMasteryMap).forEach(([key, v]) => {
            const [pId, sId] = key.split('::');
            if (pId === activeGroup.pattern.id) startById[sId] = Number(v) || 0;
        });
        const bars = groupMasteryBars(latestGroupPattern.exampleSentences, activeGroup.groupIndex, startById, sessionAfter);

        const diffDisplay = totalMasteryDiff >= 0 ? `+${totalMasteryDiff}` : `${totalMasteryDiff}`;

        return (
            <div className="flex h-full flex-col overflow-y-auto px-7 pt-14 pb-9 sm:px-10">
                <div className="mx-auto flex w-full max-w-lg flex-1 flex-col justify-center gap-9">
                    <div className="relative flex flex-col gap-2.5">
                        <svg width="190" height="56" viewBox="0 0 190 56" aria-hidden="true" className="pointer-events-none absolute -top-10 -left-2.5 animate-sparkle">
                            <circle cx="10" cy="40" r="2.5" className="fill-gold" />
                            <circle cx="70" cy="8" r="2" className="fill-accent" />
                            <path d="M150 34 l4 -8 l4 8 l-4 8 z" className="fill-gold" opacity="0.85" />
                            <circle cx="178" cy="14" r="2.5" className="fill-gold" />
                            <circle cx="118" cy="48" r="1.5" className="fill-accent" />
                        </svg>
                        <span className="text-[13px] text-muted">第 {activeGroup.groupIndex + 1} 組</span>
                        <h1 className="text-[26px] font-bold tracking-wide text-ink">本組練習完成</h1>
                        <p lang="en" className="font-reading text-[22px] leading-snug text-ink break-words">{activeGroup.pattern.text}</p>
                    </div>

                    <section aria-label={`本組 10 句熟練度`} className="flex flex-col gap-3">
                        <MasteryBars bars={bars} size="lg" showGain={summaryBarsShown} />
                        <div className="flex justify-between gap-2 text-xs text-muted">
                            <span>第 1 句</span>
                            <span>金色＝這次增加的熟練度</span>
                            <span>第 10 句</span>
                        </div>
                    </section>

                    <section className="grid grid-cols-3 border-y border-line">
                        <div className="flex flex-col gap-1.5 py-[18px]">
                            <span className="font-reading text-[40px] leading-none text-ink tabular-nums">{completedKeys.size}</span>
                            <span className="text-[13px] text-muted">練習句數</span>
                        </div>
                        <div className="flex flex-col gap-1.5 border-l border-line py-[18px] pl-4">
                            <span className={`font-reading text-[40px] leading-none tabular-nums ${totalMasteryDiff > 0 ? 'text-gold' : 'text-ink'}`}>{diffDisplay}</span>
                            <span className="text-[13px] text-muted">熟練度合計</span>
                        </div>
                        <div className="flex flex-col gap-1.5 border-l border-line py-[18px] pl-4">
                            <span className="font-reading text-[40px] leading-none text-ink tabular-nums">{masteredCount}</span>
                            <span className="text-[13px] text-muted">本次精熟</span>
                        </div>
                    </section>
                </div>
                <div className="mx-auto w-full max-w-lg pt-6">
                    <Button size="lg" fullWidth onClick={handleBackFromSession}>返回今日複習</Button>
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
                progress={{ done: completedKeys.size, total: sessionQueue.length }}
                progressLabel={maintenancePattern
                    ? `維持題・第 ${completedKeys.size + 1} / ${sessionQueue.length} 題`
                    : `第 ${completedKeys.size + 1} / ${sessionQueue.length} 題`}
                onScored={maintenancePattern
                    ? (sentenceId, _total, isExact) => { maintenanceScoresRef.current[sentenceId] = isExact; }
                    : undefined}
                onMasteryUpdated={(sentenceId, _before, after) => {
                    setSessionAfter(prev => ({ ...prev, [sentenceId]: after }));
                }}
            />
        );
    }

    const statsLine = reviewItems.length > 0 || maintenanceItems.length > 0
        ? [
            reviewItems.length > 0 ? `共有 ${reviewItems.length} 個句子等待練習` : '',
            maintenanceItems.length > 0 ? `${maintenanceItems.length} 個句型要維持複習` : ''
        ].filter(Boolean).join('・')
        : '所有進度已完成';

    const maintenanceSection = maintenanceItems.length > 0 && (
        <section className="flex flex-col gap-2.5">
            <h2 className="flex items-center gap-1.5 text-[13px] font-medium text-muted">
                <ShieldCheck size={15} className="text-gold" aria-hidden="true" />
                維持複習
            </h2>
            {maintenanceItems.map((item) => (
                <button
                    key={item.pattern.id}
                    type="button"
                    onClick={() => startMaintenance(item)}
                    className="flex w-full items-center gap-3.5 rounded-[18px] border border-gold/35 bg-surface px-[18px] py-4 text-left transition-colors hover:border-gold/70 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                >
                    <span className="flex min-w-0 flex-1 flex-col gap-1">
                        <span lang="en" className="font-reading text-[21px] leading-tight text-ink break-words">{item.pattern.text}</span>
                        <span className="text-[13px] leading-relaxed text-muted">
                            維持題 {item.sentences.length} 句・{(item.pattern.maintenance?.level || 0) > 0
                                ? `已連續通過 ${item.pattern.maintenance?.level} 次`
                                : item.pattern.maintenance?.lastReviewedAt ? '上次沒有通過' : '第一次維持複習'}・{MAINTENANCE_SIZE} 句中 {MAINTENANCE_PASS_COUNT} 句全對即通過
                        </span>
                    </span>
                    <ChevronRight size={18} className="shrink-0 text-muted" aria-hidden="true" />
                </button>
            ))}
        </section>
    );

    return (
        <div className="@container h-full overflow-y-auto px-5 pt-4 pb-12 sm:px-8 lg:px-14 lg:pt-9">
            {tabs && <div className="mb-6 lg:hidden">{tabs}</div>}
            <header className="flex items-end justify-between gap-6">
                <div className="flex min-w-0 flex-col gap-1">
                    <h1 className="text-[22px] font-bold tracking-wide text-ink lg:text-[26px]">今日複習</h1>
                    <p className="text-[13px] text-muted lg:text-sm">{statsLine}</p>
                </div>
                {tabs && <div className="hidden shrink-0 lg:block">{tabs}</div>}
            </header>

            <div className="mt-6 grid grid-cols-1 items-start gap-6 lg:mt-7 xl:grid-cols-[minmax(0,1fr)_300px] xl:gap-8">
                <div className="flex min-w-0 flex-col gap-6">
                    <div className="xl:hidden">{maintenanceSection}</div>

                    {reviewGroups.length === 0 && maintenanceItems.length === 0 ? (
                        <div className="flex flex-col items-center gap-3 rounded-[20px] border border-line bg-surface px-6 py-16 text-center">
                            <Sparkles size={36} className="text-gold" aria-hidden="true" />
                            <h2 className="text-lg font-bold text-ink">今天沒有可以複習的句子</h2>
                            <p className="text-sm text-muted">去造更多新句型，或等待下一輪解鎖吧！</p>
                        </div>
                    ) : reviewGroups.length > 0 && (
                        <section className="flex flex-col gap-2.5">
                            <h2 className="text-[13px] font-medium text-muted">待練組別</h2>
                            <div className="grid grid-cols-1 gap-3 @[40rem]:grid-cols-2 @[40rem]:gap-4">
                                {reviewGroups.map((group) => {
                                    const bars = groupMasteryBars(group.pattern.exampleSentences, group.groupIndex);
                                    return (
                                        <button
                                            key={group.key}
                                            type="button"
                                            onClick={() => startSession(group)}
                                            className="flex w-full flex-col gap-3.5 rounded-[18px] border border-line bg-surface px-[18px] py-4 text-left transition-colors hover:border-accent/50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent lg:px-[22px] lg:py-5"
                                        >
                                            <span className="flex w-full items-start justify-between gap-3">
                                                <span className="flex min-w-0 flex-col gap-1">
                                                    <span lang="en" className="font-reading text-xl leading-tight text-ink break-words lg:text-[22px]">{group.pattern.text}</span>
                                                    <span className="text-[13px] text-muted">第 {group.groupIndex + 1} 組・待練 {group.items.length} 句</span>
                                                </span>
                                                <ChevronRight size={18} className="mt-1 shrink-0 text-muted" aria-hidden="true" />
                                            </span>
                                            <span className="flex w-full items-center gap-3">
                                                <MasteryBars bars={bars} size="sm" />
                                                <span className="shrink-0 text-xs text-muted tabular-nums">待練平均 {group.avgMastery} / 1000</span>
                                            </span>
                                        </button>
                                    );
                                })}
                            </div>
                        </section>
                    )}
                </div>

                <aside className="hidden flex-col gap-4 xl:flex">
                    {maintenanceSection}
                    {reviewGroups.length > 0 && (
                        <p className="text-pretty text-[13px] leading-relaxed text-muted">每組的小長條是 10 句的熟練度；滿 1000 變成金色。</p>
                    )}
                </aside>
            </div>
        </div>
    );
}
