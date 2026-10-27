import React, { useState, useEffect, useMemo, useReducer, useRef } from 'react';
import { collection, onSnapshot } from 'firebase/firestore';
import { auth, db, appId } from '../firebase';
import { LanguagePattern } from '../types';
import { Trophy, Sparkles, Loader2, AlertCircle } from 'lucide-react';
import Button from './ui/Button';
import BadgeSeal from './ui/BadgeSeal';
import { badgeSummary, nextBadge, badgeRows, BADGE_TIERS, BadgeRow } from '../utils/badges';
import { patternLoadReducer, initialLoadState } from '../utils/loadState';
import { countUpValue } from '../utils/countUp';

// 勳章房（UI 改版 ④）：總覽三枚印章、下一枚勳章、所有句型的精熟進度。只讀，不寫任何資料。

/** 系統是否開啟「減少動態效果」（數字跑動與逐列延遲是 JS，全域 CSS 規則管不到） */
const prefersReducedMotion = () => {
    try { return !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
};

/** 進場動畫只在這次開啟 App 後第一次進入勳章房時播放（模組層級，不存資料） */
let badgesIntroPlayed = false;

/** 逐列延遲：每列 60ms，上限 480ms，句型多也不會拖太久 */
const rowDelay = (i: number) => Math.min(i * 60, 480);

/** 數字從 0 數到目標值（獨立小元件，只重繪這個數字） */
const CountUp: React.FC<{ to: number; play: boolean; delay?: number }> = ({ to, play, delay = 0 }) => {
    const [shown, setShown] = useState(play ? 0 : to);
    const playedRef = useRef(false);
    useEffect(() => {
        // 只有第一次跑動；之後資料更新直接顯示新值，不再從 0 數起
        if (!play || playedRef.current) { setShown(to); return; }
        let raf = 0;
        let start = 0;
        const duration = 700;
        const tick = (now: number) => {
            if (!start) start = now + delay;
            const progress = (now - start) / duration;
            setShown(progress <= 0 ? 0 : countUpValue(0, to, progress));
            if (progress < 1) raf = requestAnimationFrame(tick);
            else playedRef.current = true;
        };
        raf = requestAnimationFrame(tick);
        return () => cancelAnimationFrame(raf);
    }, [to, play, delay]);
    return <>{shown}</>;
};

const TIER_PILL: Record<string, string> = {
    可用: 'bg-accent-soft text-ink',
    熟練: 'bg-accent text-on-accent',
    精通: 'bg-gold text-white dark:text-ground',
};

const PatternRow: React.FC<{ row: BadgeRow; intro: boolean; delay: number }> = ({ row, intro, delay }) => {
    const width = Math.min(100, row.mastered);
    const done = row.mastered >= 100;
    return (
        <li className={`flex flex-col gap-2.5 border-t border-line py-4 ${intro ? 'animate-rise-in' : ''}`} style={intro ? { animationDelay: `${delay}ms` } : undefined}>
            <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 flex-col gap-0.5">
                    <span lang="en" className="font-reading text-[20px] leading-snug text-ink break-words">{row.pattern.text}</span>
                    {row.pattern.meaningZh && <span className="text-[12px] text-muted break-words">{row.pattern.meaningZh}</span>}
                </div>
                {row.tier && (
                    <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-[11px] font-medium ${TIER_PILL[row.tier]}`}>{row.tier}</span>
                )}
            </div>
            <div className="flex flex-col gap-1.5">
                <span aria-hidden="true" className="relative h-1.5 rounded-full bg-line">
                    <span
                        className={`absolute inset-y-0 left-0 rounded-full ${done ? 'bg-gold' : 'bg-accent'} ${intro ? 'animate-grow-x' : ''}`}
                        style={{ width: `${width}%`, ...(intro ? { animationDelay: `${delay + 100}ms` } : {}) }}
                    />
                    {BADGE_TIERS.slice(0, 2).map((t) => (
                        <span
                            key={t.target}
                            className={`absolute -top-[3px] h-3 w-0.5 rounded-full ${row.mastered >= t.target ? 'bg-accent' : 'bg-muted/60'}`}
                            style={{ left: `${t.target}%` }}
                        />
                    ))}
                </span>
                <span className="flex flex-wrap items-baseline justify-between gap-x-3 text-[12px] text-muted">
                    <span>已精熟 <span className="font-reading text-[15px] text-ink">{row.mastered}</span> / 100</span>
                    <span>{row.next ? `還差 ${row.remaining} 句到「${row.next.tier}」` : '三枚勳章都已取得'}</span>
                </span>
            </div>
        </li>
    );
};

export default function BadgeMode() {
    const [patterns, setPatterns] = useState<LanguagePattern[]>([]);
    const [user, setUser] = useState(auth.currentUser);
    const [load, dispatch] = useReducer(patternLoadReducer, initialLoadState);
    // 第一次 render 就決定要不要播進場（StrictMode 重掛也保留這個決定）
    const [intro] = useState(() => !badgesIntroPlayed && !prefersReducedMotion());
    useEffect(() => { badgesIntroPlayed = true; }, []);
    const retryKey = load.retryKey;

    useEffect(() => {
        const unsubscribeAuth = auth.onAuthStateChanged((u) => {
            setUser(u);
            if (!u) setPatterns([]);
        });
        return () => unsubscribeAuth();
    }, []);

    useEffect(() => {
        if (!user) return;
        // 換帳號或重試：先清空，避免短暫顯示前一個帳號的資料
        setPatterns([]);
        dispatch({ type: 'subscribe' });
        const patternsRef = collection(db, `artifacts/${appId}/users/${user.uid}/languagePatterns`);
        const unsubscribe = onSnapshot(patternsRef, (snapshot) => {
            const loaded: LanguagePattern[] = [];
            snapshot.forEach((doc) => {
                loaded.push({ id: doc.id, ...doc.data() } as LanguagePattern);
            });
            setPatterns(loaded);
            dispatch({ type: 'snapshot', empty: loaded.length === 0 });
        }, (error) => {
            console.error('[監聽來源:BadgeMode-languagePatterns]', error);
            dispatch({ type: 'error' });
        });
        return () => unsubscribe();
    }, [user, retryKey]);

    const summary = useMemo(() => badgeSummary(patterns), [patterns]);
    const next = useMemo(() => nextBadge(patterns), [patterns]);
    const rows = useMemo(() => badgeRows(patterns), [patterns]);

    const shell = 'flex h-full flex-col overflow-y-auto px-5 pt-6 pb-16 sm:px-8 lg:px-14 lg:pt-10';
    const header = (
        <div className="flex flex-col gap-1.5">
            <h1 className="text-[22px] font-bold tracking-wide text-ink lg:text-[26px]">成就徽章</h1>
            <p className="text-[13px] leading-relaxed text-muted lg:text-sm">精熟 10 句即「可用」，40 句「熟練」，100 句「精通」</p>
        </div>
    );

    if (!user) {
        return (
            <div className={shell}>
                {header}
                <div className="flex flex-1 flex-col items-center justify-center gap-3 py-16 text-center text-[15px] text-muted">
                    <Trophy size={36} aria-hidden="true" />
                    <p>請先登入以檢視成就徽章</p>
                </div>
            </div>
        );
    }

    if (load.status === 'error' && patterns.length === 0) {
        return (
            <div className={shell}>
                {header}
                <div role="alert" className="flex flex-1 flex-col items-center justify-center gap-4 py-16 text-center">
                    <AlertCircle size={36} className="text-danger" aria-hidden="true" />
                    <p className="max-w-sm text-[15px] leading-relaxed text-muted">讀取句型失敗，請檢查網路後再試一次</p>
                    <Button variant="secondary" onClick={() => dispatch({ type: 'retry' })}>重試</Button>
                </div>
            </div>
        );
    }

    if (load.status === 'loading' && patterns.length === 0) {
        return (
            <div className={shell}>
                {header}
                <p className="flex flex-1 items-center justify-center gap-2 text-[15px] text-muted">
                    <Loader2 size={18} className="animate-spin text-accent" aria-hidden="true" />載入中...
                </p>
            </div>
        );
    }

    if (patterns.length === 0) {
        return (
            <div className={shell}>
                {header}
                <div className="flex flex-1 flex-col items-center justify-center gap-3 py-16 text-center">
                    <Sparkles size={36} className="text-gold" aria-hidden="true" />
                    <h2 className="text-lg font-bold text-ink">尚未開始任何句型</h2>
                    <p className="max-w-sm text-sm leading-relaxed text-muted">去句型庫新增並練習，即可在這裡看到成就。</p>
                </div>
            </div>
        );
    }

    const counts = { 可用: summary.usable, 熟練: summary.proficient, 精通: summary.mastered } as const;

    return (
        <div className={shell}>
            <div className="grid gap-7 lg:grid-cols-[300px_minmax(0,1fr)] lg:items-start lg:gap-10 xl:grid-cols-[360px_minmax(0,1fr)] xl:gap-14">
                <div className="flex flex-col gap-7 lg:sticky lg:top-0">
                    {header}
                    <ul aria-label="已取得的勳章" className="grid grid-cols-3 gap-2 lg:gap-3">
                        {BADGE_TIERS.map(({ tier }, i) => (
                            <li
                                key={tier}
                                className={`flex flex-col items-center gap-2 ${intro ? 'animate-pop-in' : ''}`}
                                style={intro ? { animationDelay: `${60 + i * 70}ms` } : undefined}
                            >
                                <span className="lg:hidden"><BadgeSeal tier={tier} size={76} earned={counts[tier] > 0} /></span>
                                <span className="hidden lg:inline-flex"><BadgeSeal tier={tier} size={92} earned={counts[tier] > 0} /></span>
                                <span className="text-[12px] text-muted">
                                    <span className="font-reading text-[22px] text-ink tabular-nums"><CountUp to={counts[tier]} play={intro} delay={60 + i * 70} /></span> 枚
                                    <span className="sr-only">「{tier}」</span>
                                </span>
                            </li>
                        ))}
                    </ul>
                    {next && (
                        <section aria-labelledby="next-badge-h" className="flex items-center gap-4 rounded-[20px] border border-line bg-surface px-5 py-4">
                            <BadgeSeal tier={next.tier} size={64} earned={false} />
                            <div className="flex min-w-0 flex-col gap-1">
                                <h2 id="next-badge-h" className="text-[12px] font-medium text-muted">下一枚勳章</h2>
                                <span lang="en" className="font-reading text-[20px] leading-snug text-ink break-words">{next.pattern.text}</span>
                                <span className="text-[13px] text-ink/80">
                                    再精熟 <span className="font-reading text-[17px] text-accent">{next.remaining}</span> 句就是「{next.tier}」
                                </span>
                            </div>
                        </section>
                    )}
                </div>
                <section aria-labelledby="all-patterns-h" className="flex flex-col">
                    <h2 id="all-patterns-h" className="mb-1 text-[13px] font-medium text-muted">所有句型・{rows.length}</h2>
                    <ul>
                        {rows.map((row, i) => <PatternRow key={row.pattern.id} row={row} intro={intro} delay={200 + rowDelay(i)} />)}
                    </ul>
                </section>
            </div>
        </div>
    );
}
