import React, { useState, useEffect } from 'react';
import { LanguagePattern } from '../types';
import { auth, db, appId } from '../firebase';
import { collection, query, onSnapshot } from 'firebase/firestore';
import { Sparkles, User, ChevronRight, Search, X, RotateCcw, Trash2, CheckSquare, Square, Loader2 } from 'lucide-react';
import { PatternFilterState } from './LanguageModelMode';
import { getPatternStage } from '../utils/patternStage';
import ConfirmDialog from './ConfirmDialog';
import { deletePatterns } from '../services/patternDelete';

interface LanguageModelListViewProps {
    onPatternClick: (id: string) => void;
    filters: PatternFilterState;
    onFiltersChange: (newFilters: PatternFilterState) => void;
}

export default function LanguageModelListView({ onPatternClick, filters, onFiltersChange }: LanguageModelListViewProps) {
    const [patterns, setPatterns] = useState<LanguagePattern[]>([]);
    const [loading, setLoading] = useState(true);
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

    return (
        <div className="flex flex-col h-full bg-slate-50 dark:bg-slate-950 p-6 overflow-y-auto pb-20">
            <div className="flex items-center justify-between mb-6">
                <div>
                    <h2 className="text-2xl font-black text-slate-800 dark:text-white flex items-center gap-2">
                        <Sparkles className="text-indigo-600 dark:text-indigo-400" />
                        語言模型庫
                    </h2>
                    <p className="text-slate-500 dark:text-slate-400 mt-1 font-bold text-sm">
                        從跟讀教材中萃取出的精華句型
                    </p>
                </div>
                <div className="flex flex-col items-end gap-2 shrink-0">
                    {!selectMode && (
                        <button
                            onClick={() => { setSelectMode(true); setSelectedIds(new Set()); }}
                            className="text-xs font-bold text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 px-3 py-1.5 rounded-lg transition-colors flex items-center gap-1.5 shrink-0"
                        >
                            <CheckSquare size={14} />
                            選取
                        </button>
                    )}
                    {isFiltered && (
                        <button
                            onClick={handleClearFilters}
                            className="text-xs font-bold text-indigo-600 dark:text-indigo-400 hover:text-indigo-700 dark:hover:text-indigo-300 bg-indigo-50 dark:bg-indigo-900/30 hover:bg-indigo-100 dark:hover:bg-indigo-900/50 px-3 py-1.5 rounded-lg transition-colors flex items-center gap-1.5 shrink-0"
                        >
                            <RotateCcw size={14} />
                            清除篩選
                        </button>
                    )}
                </div>
            </div>

            {/* 選取模式操作列（批次刪除） */}
            {selectMode && (
                <div className="sticky top-0 z-10 mb-4 px-3 py-3 rounded-2xl bg-white/95 dark:bg-slate-900/95 backdrop-blur border border-indigo-200 dark:border-indigo-800 shadow-xs flex flex-wrap items-center gap-2">
                    <span className="text-sm font-black text-slate-700 dark:text-slate-200 flex-1 min-w-[5rem]">
                        已選 {selectedExisting.length} 個
                    </span>
                    <button
                        onClick={toggleSelectAllVisible}
                        disabled={visibleIds.length === 0}
                        className="text-xs font-bold text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-900/30 hover:bg-indigo-100 dark:hover:bg-indigo-900/50 px-3 py-2 rounded-lg transition-colors disabled:opacity-50"
                    >
                        {allVisibleSelected ? '取消全選' : '全選目前結果'}
                    </button>
                    <button
                        onClick={() => setPendingDeleteIds(selectedExisting.map(p => p.id))}
                        disabled={selectedExisting.length === 0 || !!deleteProgress}
                        className="text-xs font-bold text-white bg-red-500 hover:bg-red-600 px-3 py-2 rounded-lg transition-colors flex items-center gap-1.5 disabled:opacity-50"
                    >
                        <Trash2 size={14} />
                        刪除
                    </button>
                    <button
                        onClick={exitSelectMode}
                        disabled={!!deleteProgress}
                        className="text-xs font-bold text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 px-3 py-2 rounded-lg transition-colors disabled:opacity-50"
                    >
                        完成
                    </button>
                </div>
            )}

            {(deleteProgress || deleteMessage) && (
                <div className={`mb-4 px-4 py-3 rounded-xl text-sm font-bold flex items-center gap-2 break-words ${
                    deleteMessage?.isError
                        ? 'bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 border border-red-100 dark:border-red-800'
                        : 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-400 border border-emerald-100 dark:border-emerald-800'
                }`}>
                    {deleteProgress ? (
                        <>
                            <Loader2 size={16} className="animate-spin shrink-0" />
                            刪除中 {deleteProgress.done}/{deleteProgress.total}…
                        </>
                    ) : deleteMessage?.text}
                </div>
            )}

            {/* 篩選區 */}
            <div className="bg-white dark:bg-slate-900 rounded-2xl p-4 shadow-xs border border-slate-200 dark:border-slate-800 mb-6 space-y-4">
                {/* 關鍵字搜尋框 */}
                <div className="relative flex items-center">
                    <Search size={18} className="absolute left-3.5 text-slate-400 pointer-events-none" />
                    <input
                        type="text"
                        value={filters.search}
                        onChange={(e) => handleSearchChange(e.target.value)}
                        placeholder="搜尋句型或中文語意..."
                        className="w-full pl-10 pr-9 py-2.5 bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/80 rounded-xl text-sm font-medium text-slate-800 dark:text-slate-100 placeholder:text-slate-400 focus:outline-hidden focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500 transition-all"
                    />
                    {filters.search && (
                        <button
                            onClick={handleClearSearch}
                            className="absolute right-3 p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors"
                            title="清除搜尋"
                        >
                            <X size={16} />
                        </button>
                    )}
                </div>

                {/* 類型篩選按鈕列 */}
                <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-none">
                    <span className="text-xs font-bold text-slate-400 dark:text-slate-500 shrink-0">類型：</span>
                    <div className="flex flex-wrap gap-1.5 shrink-0">
                        {(['all', 'structural', 'phrase', 'collocation'] as const).map(catKey => {
                            const label = catKey === 'all' ? '全部' : categoryLabels[catKey];
                            const isSelected = filters.category === catKey;
                            return (
                                <button
                                    key={catKey}
                                    onClick={() => handleCategorySelect(catKey)}
                                    className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-all shrink-0 ${
                                        isSelected
                                            ? 'bg-indigo-600 text-white shadow-xs'
                                            : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
                                    }`}
                                >
                                    {label}
                                </button>
                            );
                        })}
                    </div>
                </div>

                {/* 主要情境標籤列 */}
                <div className="flex items-center gap-2 overflow-x-auto pb-1.5 pt-1 scrollbar-none">
                    <span className="text-xs font-bold text-slate-400 dark:text-slate-500 shrink-0">情境：</span>
                    <div className="flex items-center gap-1.5 shrink-0 flex-nowrap">
                        <button
                            onClick={() => handlePrimaryCategorySelect('all')}
                            className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-all shrink-0 flex items-center gap-1.5 ${
                                effectivePrimaryCategory === 'all'
                                    ? 'bg-indigo-600 text-white shadow-xs'
                                    : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
                            }`}
                        >
                            <span>全部</span>
                            <span className={`text-[10px] px-1.5 py-0.2 rounded-full ${
                                effectivePrimaryCategory === 'all'
                                    ? 'bg-indigo-700/60 text-indigo-100'
                                    : 'bg-slate-200 dark:bg-slate-700 text-slate-500 dark:text-slate-400'
                            }`}>
                                {step2Patterns.length}
                            </span>
                        </button>

                        {availablePrimaryCategories.map(cat => {
                            const isSelected = effectivePrimaryCategory === cat;
                            const count = primaryCategoryCounts[cat] || 0;
                            return (
                                <button
                                    key={cat}
                                    onClick={() => handlePrimaryCategorySelect(cat)}
                                    className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-all shrink-0 flex items-center gap-1.5 ${
                                        isSelected
                                            ? 'bg-indigo-600 text-white shadow-xs'
                                            : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
                                    }`}
                                >
                                    <span>{cat}</span>
                                    <span className={`text-[10px] px-1.5 py-0.2 rounded-full ${
                                        isSelected
                                            ? 'bg-indigo-700/60 text-indigo-100'
                                            : 'bg-slate-200 dark:bg-slate-700 text-slate-500 dark:text-slate-400'
                                    }`}>
                                        {count}
                                    </span>
                                </button>
                            );
                        })}
                    </div>
                </div>

                {/* 溝通功能標籤列（只有選取特定主要情境時才顯示） */}
                {effectivePrimaryCategory !== 'all' && (
                    <div className="pt-2 border-t border-slate-100 dark:border-slate-800/80">
                        <div className="flex items-start gap-2">
                            <span className="text-xs font-bold text-slate-400 dark:text-slate-500 shrink-0 mt-1">溝通功能：</span>
                            {availableSituationTags.length > 0 ? (
                                <div className="flex flex-wrap gap-1.5">
                                    {availableSituationTags.map(tag => {
                                        const isSelected = effectiveSituationTag === tag;
                                        const count = situationTagCounts[tag] || 0;
                                        return (
                                            <button
                                                key={tag}
                                                onClick={() => handleSituationTagClick(tag)}
                                                className={`px-2.5 py-1 text-xs font-bold rounded-lg transition-all shrink-0 flex items-center gap-1 ${
                                                    isSelected
                                                        ? 'bg-indigo-600 text-white shadow-xs'
                                                        : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
                                                }`}
                                            >
                                                <span>{tag}</span>
                                                <span className={`text-[10px] ${
                                                    isSelected ? 'text-indigo-200' : 'text-slate-400 dark:text-slate-500'
                                                }`}>
                                                    ({count})
                                                </span>
                                            </button>
                                        );
                                    })}
                                </div>
                            ) : (
                                <span className="text-xs text-slate-400 dark:text-slate-500 mt-1">此分類下無溝通功能標籤</span>
                            )}
                        </div>
                    </div>
                )}
            </div>

            {/* 篩選結果列表 或 無結果提示 */}
            {finalFilteredPatterns.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 text-center bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-8 shadow-xs">
                    <div className="w-14 h-14 bg-slate-100 dark:bg-slate-800 rounded-full flex items-center justify-center mb-4 text-slate-400">
                        <Search size={28} />
                    </div>
                    <h3 className="text-base font-bold text-slate-700 dark:text-slate-300 mb-1">
                        沒有符合條件的句型
                    </h3>
                    <p className="text-xs text-slate-400 dark:text-slate-500 mb-4">
                        請嘗試更換搜尋關鍵字或調整篩選條件
                    </p>
                    <button
                        onClick={handleClearFilters}
                        className="px-4 py-2 bg-indigo-50 dark:bg-indigo-900/30 hover:bg-indigo-100 dark:hover:bg-indigo-900/50 text-indigo-600 dark:text-indigo-400 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5"
                    >
                        <RotateCcw size={14} />
                        清除篩選
                    </button>
                </div>
            ) : (
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
                            
                            <div className="grid grid-cols-1 gap-4">
                                {grouped[primaryCategory].map(pattern => {
                                    const all = pattern.exampleSentences || [];
                                    const createdCount = all.filter(s => s.checked).length;
                                    const masteredCount = all.filter(s => s.checked && (s.mastery || 0) >= 1000).length;
                                    const isSelected = selectMode && selectedIds.has(pattern.id);

                                    return (
                                        <div 
                                            key={pattern.id}
                                            onClick={() => (selectMode ? toggleSelected(pattern.id) : onPatternClick(pattern.id))}
                                            className={`bg-white dark:bg-slate-900 rounded-xl p-4 shadow-xs border hover:shadow-md transition-all cursor-pointer group flex flex-col ${
                                                isSelected
                                                    ? 'border-indigo-500 ring-2 ring-indigo-500/30'
                                                    : 'border-slate-200 dark:border-slate-800 hover:border-indigo-200 dark:hover:border-indigo-800'
                                            }`}
                                        >
                                            <div className="flex items-start justify-between mb-1">
                                                <h4 className="text-lg font-black text-slate-800 dark:text-slate-100 flex-1 pr-2 leading-tight">
                                                    {pattern.text}
                                                </h4>
                                                {selectMode ? (
                                                    isSelected
                                                        ? <CheckSquare size={20} className="text-indigo-600 dark:text-indigo-400 shrink-0 mt-0.5" />
                                                        : <Square size={20} className="text-slate-300 dark:text-slate-600 shrink-0 mt-0.5" />
                                                ) : (
                                                    <div className="flex items-center gap-1 shrink-0">
                                                        <button
                                                            type="button"
                                                            onClick={(e) => { e.stopPropagation(); setPendingDeleteIds([pattern.id]); }}
                                                            disabled={!!deleteProgress}
                                                            title="刪除句型"
                                                            className="p-1.5 text-slate-300 hover:text-red-500 dark:text-slate-600 dark:hover:text-red-400 rounded-lg transition-colors disabled:opacity-50"
                                                        >
                                                            <Trash2 size={16} />
                                                        </button>
                                                        <ChevronRight size={18} className="text-slate-300 group-hover:text-indigo-500 transition-colors" />
                                                    </div>
                                                )}
                                            </div>
                                            {pattern.meaningZh && (
                                                <p className="text-sm text-slate-500 dark:text-slate-400 line-clamp-1 mb-2">
                                                    {pattern.meaningZh}
                                                </p>
                                            )}

                                            <div className="mt-auto pt-3">
                                                <div className="text-xs text-slate-500 dark:text-slate-400 mb-1.5 font-bold">
                                                    已造句 {createdCount}/100・已精熟 {masteredCount}/100
                                                </div>
                                                <div className="w-full h-1.5 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                                                    <div 
                                                        className="h-full bg-indigo-500 rounded-full transition-all duration-300"
                                                        style={{ width: `${Math.min(100, Math.max(0, masteredCount))}%` }}
                                                    />
                                                </div>
                                            </div>

                                            <div className="flex flex-wrap items-center gap-2 pt-3">
                                                <span className={`text-[10px] font-bold px-2 py-1 rounded-md ${getPatternStage(pattern).className}`}>
                                                    {getPatternStage(pattern).label}
                                                </span>
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
                                    );
                                })}
                            </div>
                        </div>
                    ))}
                </div>
            )}

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
