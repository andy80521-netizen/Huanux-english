import React, { useState, useEffect } from 'react';
import { LanguagePattern } from '../types';
import { auth, db, appId } from '../firebase';
import { collection, query, onSnapshot } from 'firebase/firestore';
import { Sparkles, User, Search, X, RotateCcw, Trash2, Check, Loader2, AlertCircle } from 'lucide-react';
import Button from './ui/Button';
import IconButton from './ui/IconButton';
import { GroupSegments } from './ui/MasterySegments';
import { groupMasteredCounts } from '../utils/groupMastery';
import { PatternFilterState } from './LanguageModelMode';
import { getPatternStage } from '../utils/patternStage';
import ConfirmDialog from './ConfirmDialog';
import { deletePatterns } from '../services/patternDelete';

interface LanguageModelListViewProps {
    /** 「今日複習／句型庫」切換（手機在頁首、桌機在標題右側） */
    tabs?: React.ReactNode;
    onPatternClick: (id: string) => void;
    filters: PatternFilterState;
    onFiltersChange: (newFilters: PatternFilterState) => void;
}

/** 篩選用的圓角選項 */
const Chip: React.FC<{ on: boolean; onClick: () => void; children: React.ReactNode; className?: string }> = ({ on, onClick, children, className = '' }) => {
    return (
        <button
            type="button"
            aria-pressed={on}
            onClick={onClick}
            className={`flex min-h-9 shrink-0 items-center gap-1.5 rounded-full border px-3.5 text-[13px] transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent ${
                on ? 'border-accent bg-accent-soft text-ink font-medium' : 'border-line bg-surface text-ink hover:bg-surface-2'
            } ${className}`}
        >
            {children}
        </button>
    );
};

export default function LanguageModelListView({ tabs, onPatternClick, filters, onFiltersChange }: LanguageModelListViewProps) {
    const [patterns, setPatterns] = useState<LanguagePattern[]>([]);
    const [loading, setLoading] = useState(true);
    // 監聽失敗：沒有資料時顯示錯誤與重試，不可當成「沒有句型」
    const [loadError, setLoadError] = useState(false);
    const [retryKey, setRetryKey] = useState(0);
    const [uid, setUid] = useState<string | null | undefined>(undefined);

    // 刪除：卡片垃圾桶（單一）或選取模式（批次）
    const [selectMode, setSelectMode] = useState(false);
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    const [pendingDeleteIds, setPendingDeleteIds] = useState<string[] | null>(null);
    const [deleteProgress, setDeleteProgress] = useState<{ done: number; total: number } | null>(null);
    const [deleteMessage, setDeleteMessage] = useState<{ text: string; isError: boolean } | null>(null);

    useEffect(() => {
        const currentUid = auth.currentUser?.uid;
        if (!currentUid) {
            setUid(null);
            setLoading(false);
            return;
        }
        setUid(currentUid);
        setLoading(true);
        setLoadError(false);

        const q = query(
            collection(db, `artifacts/${appId}/users/${currentUid}/languagePatterns`)
        );

        const unsubscribe = onSnapshot(q, (snapshot) => {
            const data: LanguagePattern[] = [];
            snapshot.forEach((doc) => {
                data.push({ ...(doc.data() as LanguagePattern), id: doc.id });
            });
            setPatterns(data);
            setLoading(false);
        }, (err) => {
            console.error("[監聽來源:LanguageModelListView-languagePatterns]", err);
            console.error("Error fetching language patterns: ", err);
            setLoadError(true);
            setLoading(false);
        });

        return () => unsubscribe();
    }, [retryKey]);

    const pageHeader = (actions?: React.ReactNode) => (
        <>
            {tabs && <div className="mb-6 lg:hidden">{tabs}</div>}
            <header className="flex items-end justify-between gap-4">
                <div className="flex min-w-0 flex-col gap-1">
                    <h1 className="text-[22px] font-bold tracking-wide text-ink lg:text-[26px]">語言模型庫</h1>
                    <p className="text-[13px] text-muted lg:text-sm">從跟讀教材中萃取出的精華句型</p>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                    {actions}
                    {tabs && <div className="hidden lg:block">{tabs}</div>}
                </div>
            </header>
        </>
    );

    const emptyShell = (icon: React.ReactNode, title: string, text: string) => (
        <div className="flex h-full flex-col overflow-y-auto px-5 pt-4 pb-12 sm:px-8 lg:px-14 lg:pt-9">
            {pageHeader()}
            <div className="flex flex-1 flex-col items-center justify-center gap-3 py-16 text-center">
                {icon}
                <h2 className="text-lg font-bold text-ink">{title}</h2>
                <p className="max-w-sm text-sm leading-relaxed text-muted">{text}</p>
            </div>
        </div>
    );

    if (loading) {
        return (
            <div className="flex h-full flex-col px-5 pt-4 sm:px-8 lg:px-14 lg:pt-9">
                {pageHeader()}
                <p className="flex flex-1 items-center justify-center gap-2 text-[15px] text-muted">
                    <Loader2 size={18} className="animate-spin text-accent" aria-hidden="true" />載入中...
                </p>
            </div>
        );
    }

    if (uid === null) {
        return emptyShell(<User size={36} className="text-muted" aria-hidden="true" />, '請先登入', '請先至「個人」頁面登入才能使用語言模型功能。');
    }

    if (loadError && patterns.length === 0) {
        return (
            <div className="flex h-full flex-col overflow-y-auto px-5 pt-4 pb-12 sm:px-8 lg:px-14 lg:pt-9">
                {pageHeader()}
                <div role="alert" className="flex flex-1 flex-col items-center justify-center gap-4 py-16 text-center">
                    <AlertCircle size={36} className="text-danger" aria-hidden="true" />
                    <p className="max-w-sm text-[15px] leading-relaxed text-muted">讀取句型失敗，請檢查網路後再試一次</p>
                    <Button variant="secondary" onClick={() => setRetryKey((k) => k + 1)}>重試</Button>
                </div>
            </div>
        );
    }

    if (patterns.length === 0) {
        return emptyShell(<Sparkles size={36} className="text-gold" aria-hidden="true" />, '尚無任何語言模型句型', '請先在教材裡完成跟讀練習並萃取句型。');
    }

    // 分類定義與轉換
    const categoryLabels: Record<string, string> = {
        'structural': '結構句型',
        'phrase': '片語',
        'collocation': '語組'
    };

    // 篩選運算（不寫回資料庫）
    // 步驟 1：關鍵字比對 text 與 meaningZh（不分大小寫）
    const trimmedSearch = filters.search.trim().toLowerCase();
    const step1Patterns = patterns.filter(p => {
        if (!trimmedSearch) return true;
        const textMatch = p.text.toLowerCase().includes(trimmedSearch);
        const meaningMatch = (p.meaningZh || '').toLowerCase().includes(trimmedSearch);
        return textMatch || meaningMatch;
    });

    // 步驟 2：類型篩選
    const step2Patterns = step1Patterns.filter(p => {
        if (filters.category === 'all') return true;
        return p.category === filters.category;
    });

    // 步驟 3：計算主要情境可用清單與數量
    const primaryCategoryCounts: Record<string, number> = {};
    step2Patterns.forEach(p => {
        const cat = p.primaryCategory || '未分類';
        primaryCategoryCounts[cat] = (primaryCategoryCounts[cat] || 0) + 1;
    });
    const availablePrimaryCategories = Object.keys(primaryCategoryCounts).sort();

    // 規則 C：若目前選中的主要情境不在第 3 步的可選清單中，篩選與畫面都視同「全部」
    const effectivePrimaryCategory = (filters.primaryCategory !== 'all' && availablePrimaryCategories.includes(filters.primaryCategory))
        ? filters.primaryCategory
        : 'all';

    const step3Patterns = step2Patterns.filter(p => {
        if (effectivePrimaryCategory === 'all') return true;
        return (p.primaryCategory || '未分類') === effectivePrimaryCategory;
    });

    // 步驟 4：只有選了特定主要情境時，才計算與顯示溝通功能標籤
    const situationTagCounts: Record<string, number> = {};
    if (effectivePrimaryCategory !== 'all') {
        step3Patterns.forEach(p => {
            (p.situationTags || []).forEach(tag => {
                if (tag && tag.trim()) {
                    situationTagCounts[tag] = (situationTagCounts[tag] || 0) + 1;
                }
            });
        });
    }
    // 依出現次數由多到少排序；次數相同依名稱排序
    const availableSituationTags = Object.keys(situationTagCounts).sort((a, b) => {
        const diff = situationTagCounts[b] - situationTagCounts[a];
        if (diff !== 0) return diff;
        return a.localeCompare(b);
    });

    // 規則 C：溝通功能若不在可選清單中，視同未選取
    const effectiveSituationTag = (filters.situationTag && availableSituationTags.includes(filters.situationTag))
        ? filters.situationTag
        : null;

    // 最終篩選句型
    const finalFilteredPatterns = step3Patterns.filter(p => {
        if (!effectiveSituationTag) return true;
        return (p.situationTags || []).includes(effectiveSituationTag);
    });

    // 依 primaryCategory 分組
    const grouped = finalFilteredPatterns.reduce((acc, p) => {
        const cat = p.primaryCategory || '未分類';
        if (!acc[cat]) acc[cat] = [];
        acc[cat].push(p);
        return acc;
    }, {} as Record<string, LanguagePattern[]>);

    // 規則 C：使用者修改搜尋文字或類型時，若因此造成原本的選取失效，在同一次更新中一併重設
    const updateFiltersWithValidation = (
        newSearch: string,
        newCategory: 'all' | 'structural' | 'phrase' | 'collocation',
        targetPrimaryCategory: string,
        targetSituationTag: string | null
    ) => {
        const s = newSearch.trim().toLowerCase();
        const s2 = patterns.filter(p => {
            const matchSearch = !s || p.text.toLowerCase().includes(s) || (p.meaningZh || '').toLowerCase().includes(s);
            const matchCat = newCategory === 'all' || p.category === newCategory;
            return matchSearch && matchCat;
        });

        const validPrimaryCategories = new Set(s2.map(p => p.primaryCategory || '未分類'));
        let finalPrimaryCategory = 'all';
        if (targetPrimaryCategory !== 'all' && validPrimaryCategories.has(targetPrimaryCategory)) {
            finalPrimaryCategory = targetPrimaryCategory;
        }

        let finalSituationTag: string | null = null;
        if (finalPrimaryCategory !== 'all' && targetSituationTag) {
            const s3 = s2.filter(p => (p.primaryCategory || '未分類') === finalPrimaryCategory);
            const validTags = new Set<string>();
            s3.forEach(p => (p.situationTags || []).forEach(t => validTags.add(t)));
            if (validTags.has(targetSituationTag)) {
                finalSituationTag = targetSituationTag;
            }
        }

        onFiltersChange({
            search: newSearch,
            category: newCategory,
            primaryCategory: finalPrimaryCategory,
            situationTag: finalSituationTag
        });
    };

    const handleSearchChange = (value: string) => {
        updateFiltersWithValidation(value, filters.category, filters.primaryCategory, filters.situationTag);
    };

    const handleClearSearch = () => {
        updateFiltersWithValidation('', filters.category, filters.primaryCategory, filters.situationTag);
    };

    const handleCategorySelect = (cat: 'all' | 'structural' | 'phrase' | 'collocation') => {
        updateFiltersWithValidation(filters.search, cat, filters.primaryCategory, filters.situationTag);
    };

    const handlePrimaryCategorySelect = (primaryCat: string) => {
        updateFiltersWithValidation(filters.search, filters.category, primaryCat, null);
    };

    const handleSituationTagClick = (tag: string) => {
        const nextTag = effectiveSituationTag === tag ? null : tag;
        onFiltersChange({
            ...filters,
            primaryCategory: effectivePrimaryCategory,
            situationTag: nextTag
        });
    };

    const handleClearFilters = () => {
        onFiltersChange({
            search: '',
            category: 'all',
            primaryCategory: 'all',
            situationTag: null
        });
    };

    const exitSelectMode = () => {
        setSelectMode(false);
        setSelectedIds(new Set());
    };

    const toggleSelected = (id: string) => {
        setSelectedIds(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id); else next.add(id);
            return next;
        });
    };

    // 全選只針對目前篩選結果
    const visibleIds = finalFilteredPatterns.map(p => p.id);
    const allVisibleSelected = visibleIds.length > 0 && visibleIds.every(id => selectedIds.has(id));
    const toggleSelectAllVisible = () => {
        setSelectedIds(prev => {
            const next = new Set(prev);
            if (allVisibleSelected) visibleIds.forEach(id => next.delete(id));
            else visibleIds.forEach(id => next.add(id));
            return next;
        });
    };

    // 只計算仍存在的句型（刪除後監聽會自動更新清單）
    const selectedExisting = patterns.filter(p => selectedIds.has(p.id));
    const pendingPatterns = pendingDeleteIds ? patterns.filter(p => pendingDeleteIds.includes(p.id)) : [];
    const pendingSentenceCount = pendingPatterns.reduce((n, p) => n + (p.exampleSentences || []).filter(s => s.checked).length, 0);
    const deleteConfirmMessage = pendingPatterns.length === 1
        ? `「${pendingPatterns[0].text}」的 ${pendingSentenceCount} 句造句與所有練習進度會一起刪除，無法復原。`
        : `${pendingPatterns.length} 個句型、共 ${pendingSentenceCount} 句造句與所有練習進度會一起刪除，無法復原。`;

    const handleConfirmDelete = async () => {
        const ids = pendingPatterns.map(p => p.id);
        setPendingDeleteIds(null);
        if (ids.length === 0) return;
        setDeleteMessage(null);
        setDeleteProgress({ done: 0, total: ids.length });
        const r = await deletePatterns(ids, (done, total) => setDeleteProgress({ done, total }));
        setDeleteProgress(null);
        setSelectedIds(prev => {
            const next = new Set(prev);
            ids.forEach(id => next.delete(id));
            return next;
        });
        if (r.failed > 0) {
            setDeleteMessage({ text: `已刪除 ${r.deleted} 個，${r.failed} 個刪除失敗，請稍後再試`, isError: true });
        } else {
            setDeleteMessage({ text: `已刪除 ${r.deleted} 個句型`, isError: false });
            if (ids.length > 1) exitSelectMode();
        }
        setTimeout(() => setDeleteMessage(null), 4000);
    };

    const isFiltered = filters.search !== '' || filters.category !== 'all' || effectivePrimaryCategory !== 'all' || effectiveSituationTag !== null;

    const headerActions = (
        <>
            {isFiltered && (
                <Button variant="ghost" size="sm" onClick={handleClearFilters} icon={<RotateCcw size={14} aria-hidden="true" />}>
                    清除篩選
                </Button>
            )}
            {!selectMode && (
                <Button variant="secondary" size="sm" onClick={() => { setSelectMode(true); setSelectedIds(new Set()); }}>
                    選取
                </Button>
            )}
        </>
    );

    const filterHeading = (text: string) => (
        <h2 className="hidden text-xs text-muted lg:block">{text}</h2>
    );

    return (
        <div className="h-full overflow-y-auto px-5 pt-4 pb-12 sm:px-8 lg:px-14 lg:pt-9">
            {pageHeader(headerActions)}

            <div className="mt-6 grid grid-cols-1 items-start gap-6 lg:mt-7 lg:grid-cols-[260px_minmax(0,1fr)] lg:gap-9">
                {/* 篩選：手機橫向捲動列、桌機左欄 */}
                <aside aria-label="篩選" className="flex min-w-0 flex-col gap-3 lg:sticky lg:top-0 lg:gap-6">
                    <div className="relative flex items-center">
                        <Search size={17} className="pointer-events-none absolute left-3.5 text-muted" aria-hidden="true" />
                        <label htmlFor="pattern-search" className="sr-only">搜尋句型或中文語意</label>
                        <input
                            id="pattern-search"
                            type="text"
                            className="h-11 w-full rounded-full border border-muted/35 bg-surface pr-10 pl-10 text-base text-ink placeholder:text-muted transition-colors focus-visible:border-accent focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-accent lg:text-sm"
                            value={filters.search}
                            placeholder="搜尋句型或中文語意..."
                            onChange={(e) => handleSearchChange(e.target.value)}
                        />
                        {filters.search && (
                            <IconButton aria-label="清除搜尋" title="清除搜尋" onClick={handleClearSearch} className="absolute right-0.5 size-10">
                                <X size={16} aria-hidden="true" />
                            </IconButton>
                        )}
                    </div>

                    <div className="flex flex-col gap-2">
                        {filterHeading('類型')}
                        <div role="group" aria-label="類型" className="-mx-5 flex gap-1.5 overflow-x-auto px-5 pb-0.5 [scrollbar-width:none] sm:-mx-8 sm:px-8 lg:mx-0 lg:flex-wrap lg:overflow-visible lg:px-0">
                            {(['all', 'structural', 'phrase', 'collocation'] as const).map(catKey => (
                                <Chip key={catKey} on={filters.category === catKey} onClick={() => handleCategorySelect(catKey)}>
                                    {catKey === 'all' ? '全部' : categoryLabels[catKey]}
                                </Chip>
                            ))}
                        </div>
                    </div>

                    <div className="flex flex-col gap-2">
                        {filterHeading('情境')}
                        <div role="group" aria-label="情境" className="-mx-5 flex gap-1.5 overflow-x-auto px-5 pb-0.5 [scrollbar-width:none] sm:-mx-8 sm:px-8 lg:mx-0 lg:flex-col lg:gap-0.5 lg:overflow-visible lg:px-0">
                            {[['all', step2Patterns.length] as const, ...availablePrimaryCategories.map(cat => [cat, primaryCategoryCounts[cat] || 0] as const)].map(([cat, count]) => {
                                const on = effectivePrimaryCategory === cat;
                                return (
                                    <Chip
                                        key={cat}
                                        on={on}
                                        onClick={() => handlePrimaryCategorySelect(cat)}
                                        className={`lg:min-h-10 lg:justify-between lg:rounded-xl lg:border-transparent lg:px-3 lg:text-sm ${on ? 'lg:bg-accent-soft' : 'lg:bg-transparent lg:hover:bg-surface-2'}`}
                                    >
                                        <span className="break-words">{cat === 'all' ? '全部' : cat}</span>
                                        <span className="text-xs font-normal text-muted tabular-nums">{count}</span>
                                    </Chip>
                                );
                            })}
                        </div>
                    </div>

                    {effectivePrimaryCategory !== 'all' && (
                        <div className="flex flex-col gap-2">
                            <h2 className="text-xs text-muted">溝通功能</h2>
                            {availableSituationTags.length > 0 ? (
                                <div role="group" aria-label="溝通功能" className="flex flex-wrap gap-1.5">
                                    {availableSituationTags.map(tag => (
                                        <Chip key={tag} on={effectiveSituationTag === tag} onClick={() => handleSituationTagClick(tag)} className="min-h-8 px-3 text-xs">
                                            <span className="break-words">{tag}</span>
                                            <span className="font-normal text-muted">({situationTagCounts[tag] || 0})</span>
                                        </Chip>
                                    ))}
                                </div>
                            ) : (
                                <p className="text-xs text-muted">此分類下無溝通功能標籤</p>
                            )}
                        </div>
                    )}
                </aside>

                <section className="@container flex min-w-0 flex-col gap-6">
                    {/* 選取模式操作列（批次刪除） */}
                    {selectMode && (
                        <div className="sticky top-0 z-20 flex flex-wrap items-center gap-2 rounded-2xl border border-accent/40 bg-surface/95 px-3 py-2.5 backdrop-blur-md">
                            <span className="min-w-20 flex-1 text-sm font-bold text-ink">已選 {selectedExisting.length} 個</span>
                            <Button variant="ghost" size="sm" onClick={toggleSelectAllVisible} disabled={visibleIds.length === 0}>
                                {allVisibleSelected ? '取消全選' : '全選目前結果'}
                            </Button>
                            <button
                                type="button"
                                onClick={() => setPendingDeleteIds(selectedExisting.map(p => p.id))}
                                disabled={selectedExisting.length === 0 || !!deleteProgress}
                                className="flex min-h-10 items-center gap-1.5 rounded-full bg-danger px-4 text-[13px] font-medium text-white transition-[filter] hover:brightness-110 disabled:opacity-50 dark:text-ground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-danger"
                            >
                                <Trash2 size={14} aria-hidden="true" />
                                刪除
                            </button>
                            <Button variant="secondary" size="sm" onClick={exitSelectMode} disabled={!!deleteProgress}>完成</Button>
                        </div>
                    )}

                    {(deleteProgress || deleteMessage) && (
                        <div
                            role={deleteMessage?.isError ? 'alert' : 'status'}
                            className={`flex items-center gap-2 rounded-xl px-4 py-3 text-sm font-medium break-words ${deleteMessage?.isError ? 'bg-danger/10 text-danger' : 'bg-accent-soft text-ink'}`}
                        >
                            {deleteProgress ? (
                                <>
                                    <Loader2 size={16} className="shrink-0 animate-spin" aria-hidden="true" />
                                    刪除中 {deleteProgress.done}/{deleteProgress.total}…
                                </>
                            ) : (
                                <>
                                    {deleteMessage?.isError && <AlertCircle size={16} className="shrink-0" aria-hidden="true" />}
                                    {deleteMessage?.text}
                                </>
                            )}
                        </div>
                    )}

                    {finalFilteredPatterns.length === 0 ? (
                        <div className="flex flex-col items-center gap-3 rounded-[20px] border border-line bg-surface px-6 py-14 text-center">
                            <Search size={28} className="text-muted" aria-hidden="true" />
                            <h2 className="text-base font-bold text-ink">沒有符合條件的句型</h2>
                            <p className="text-[13px] text-muted">請嘗試更換搜尋關鍵字或調整篩選條件</p>
                            <Button variant="secondary" size="sm" onClick={handleClearFilters} icon={<RotateCcw size={14} aria-hidden="true" />}>清除篩選</Button>
                        </div>
                    ) : (
                        Object.keys(grouped).sort().map(primaryCategory => (
                            <div key={primaryCategory} className="flex flex-col gap-2.5">
                                <h2 className="text-[13px] font-medium text-muted">{primaryCategory}・{grouped[primaryCategory].length}</h2>
                                <div className="grid grid-cols-1 gap-3 @[40rem]:grid-cols-2 @[40rem]:gap-4">
                                    {grouped[primaryCategory].map(pattern => {
                                        const all = pattern.exampleSentences || [];
                                        const createdCount = all.filter(s => s.checked).length;
                                        const masteredCount = all.filter(s => s.checked && (s.mastery || 0) >= 1000).length;
                                        const isSelected = selectMode && selectedIds.has(pattern.id);
                                        const stage = getPatternStage(pattern);

                                        const body = (title: React.ReactNode, trailing: React.ReactNode) => (
                                            <>
                                                <span className="flex w-full items-start justify-between gap-3">
                                                    <span className="flex min-w-0 flex-col gap-1">
                                                        {title}
                                                        {pattern.meaningZh && <span className="text-[13px] leading-relaxed text-muted break-words">{pattern.meaningZh}</span>}
                                                    </span>
                                                    {trailing}
                                                </span>
                                                <span className="flex w-full flex-col gap-1.5">
                                                    <GroupSegments counts={groupMasteredCounts(pattern.exampleSentences)} />
                                                    <span className="text-xs text-muted tabular-nums">已造句 {createdCount}/100・已精熟 {masteredCount}/100</span>
                                                </span>
                                                <span className="flex flex-wrap items-center gap-1.5">
                                                    <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-medium ${stage.className}`}>{stage.label}</span>
                                                    <span className="rounded-full border border-line bg-surface-2 px-2.5 py-0.5 text-[11px] text-muted">{categoryLabels[pattern.category] || pattern.category}</span>
                                                    {pattern.sourceLabel && (
                                                        <span className="min-w-0 max-w-full text-[11px] text-muted break-words">來自: {pattern.sourceLabel}</span>
                                                    )}
                                                </span>
                                            </>
                                        );

                                        if (selectMode) {
                                            return (
                                                <article key={pattern.id}>
                                                    <button
                                                        type="button"
                                                        aria-pressed={isSelected}
                                                        onClick={() => toggleSelected(pattern.id)}
                                                        className={`flex w-full flex-col gap-3 rounded-[18px] border bg-surface px-[18px] py-4 text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent lg:px-5 ${
                                                            isSelected ? 'border-accent bg-accent-soft/40' : 'border-line hover:border-accent/50'
                                                        }`}
                                                    >
                                                        {body(
                                                            <span lang="en" className="font-reading text-[21px] leading-tight text-ink break-words lg:text-[22px]">{pattern.text}</span>,
                                                            <span aria-hidden="true" className={`mt-1 flex size-5 shrink-0 items-center justify-center rounded-md border-[1.5px] ${isSelected ? 'border-accent bg-accent text-on-accent' : 'border-muted/60'}`}>
                                                                {isSelected && <Check size={14} strokeWidth={3} />}
                                                            </span>
                                                        )}
                                                    </button>
                                                </article>
                                            );
                                        }

                                        return (
                                            <article key={pattern.id} className="relative flex flex-col gap-3 rounded-[18px] border border-line bg-surface px-[18px] py-4 transition-[border-color,transform] duration-150 has-[[data-card-link]:active]:scale-[0.985] hover:border-accent/50 lg:px-5">
                                                {body(
                                                    <h3 className="min-w-0">
                                                        <button
                                                            type="button"
                                                            data-card-link
                                                            onClick={() => onPatternClick(pattern.id)}
                                                            lang="en"
                                                            className="text-left font-reading text-[21px] leading-tight text-ink break-words outline-hidden after:absolute after:inset-0 after:rounded-[18px] focus-visible:after:outline-2 focus-visible:after:outline-offset-2 focus-visible:after:outline-accent lg:text-[22px]"
                                                        >
                                                            {pattern.text}
                                                        </button>
                                                    </h3>,
                                                    <IconButton
                                                        aria-label="刪除句型"
                                                        title="刪除句型"
                                                        onClick={() => setPendingDeleteIds([pattern.id])}
                                                        disabled={!!deleteProgress}
                                                        className="relative z-10 -mt-1.5 -mr-2 size-9 text-muted hover:text-danger disabled:opacity-50"
                                                    >
                                                        <Trash2 size={16} aria-hidden="true" />
                                                    </IconButton>
                                                )}
                                            </article>
                                        );
                                    })}
                                </div>
                            </div>
                        ))
                    )}
                </section>
            </div>

            <ConfirmDialog
                isOpen={!!pendingDeleteIds && pendingPatterns.length > 0}
                title={pendingPatterns.length > 1 ? `刪除 ${pendingPatterns.length} 個句型？` : '刪除句型？'}
                message={deleteConfirmMessage}
                confirmText="刪除"
                onConfirm={handleConfirmDelete}
                onCancel={() => setPendingDeleteIds(null)}
            />
        </div>
    );
}
