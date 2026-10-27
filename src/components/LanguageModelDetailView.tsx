import React, { useState, useEffect } from 'react';
import { LanguagePattern } from '../types';
import { auth, db, appId } from '../firebase';
import { doc, onSnapshot } from 'firebase/firestore';
import { ChevronLeft, Loader2, PenTool, RefreshCw, Trash2, ShieldCheck, AlertCircle } from 'lucide-react';
import Button from './ui/Button';
import IconButton from './ui/IconButton';
import { MasteryMap } from './ui/MasterySegments';
import { patternMasteryMap } from '../utils/groupMastery';
import LanguageModelPracticeView from './LanguageModelPracticeView';
import GroupSelectionView from './GroupSelectionView';
import GroupDetailView from './GroupDetailView';
import { regenerateAndSaveSeedExamples } from '../services/seedExamples';
import ConfirmDialog from './ConfirmDialog';
import PatternSightingsSection from './PatternSightingsSection';
import { getPatternStage, getMasteredCount } from '../utils/patternStage';
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
            <div className="flex h-full items-center justify-center gap-2 text-[15px] text-muted">
                <Loader2 className="animate-spin text-accent" size={20} aria-hidden="true" />
                <p>載入中...</p>
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

    const stage = getPatternStage(pattern);
    const masteredTotal = getMasteredCount(pattern);
    const map = patternMasteryMap(pattern.exampleSentences);
    const milestones = [
        { at: 10, label: '可用 10', key: 'usable' },
        { at: 40, label: '熟練 40', key: 'proficient' },
        { at: 100, label: '精通 100', key: 'mastered' },
    ];

    const errorBox = (text: string) => (
        <div role="alert" className="flex items-start gap-3 rounded-xl bg-danger/10 px-4 py-3 text-sm text-danger">
            <AlertCircle size={18} className="mt-0.5 shrink-0" aria-hidden="true" />
            <span className="font-medium leading-relaxed break-words">{text}</span>
        </div>
    );

    return (
        <div className="h-full overflow-y-auto pb-12">
            <header className="flex items-center gap-2 px-2 pt-2 sm:px-5 lg:px-9 lg:pt-6">
                <IconButton aria-label="返回句型庫" onClick={onBack}>
                    <ChevronLeft size={22} aria-hidden="true" />
                </IconButton>
                <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
                    <span className="rounded-full border border-line bg-surface-2 px-2.5 py-0.5 text-[11px] text-muted">{categoryLabels[pattern.category] || pattern.category}</span>
                    {pattern.primaryCategory && (
                        <span className="rounded-full border border-line bg-surface-2 px-2.5 py-0.5 text-[11px] text-muted break-words">{pattern.primaryCategory}</span>
                    )}
                    <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-medium ${stage.className}`}>{stage.label}</span>
                </div>
                <IconButton
                    aria-label="刪除句型"
                    title="刪除句型"
                    onClick={() => setShowDeleteConfirm(true)}
                    disabled={deleting}
                    className="text-muted hover:text-danger disabled:opacity-50 lg:hidden"
                >
                    {deleting ? <Loader2 size={19} className="animate-spin" aria-hidden="true" /> : <Trash2 size={19} aria-hidden="true" />}
                </IconButton>
                <span className="hidden lg:block">
                <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => setShowDeleteConfirm(true)}
                    disabled={deleting}
                    aria-label="刪除句型"
                    icon={deleting ? <Loader2 size={15} className="animate-spin" aria-hidden="true" /> : <Trash2 size={15} aria-hidden="true" />}
                    className="text-muted hover:text-danger"
                >
                    刪除句型
                </Button>
                </span>
            </header>

            <div className="grid grid-cols-1 gap-10 px-6 pt-5 sm:px-10 lg:grid-cols-[minmax(0,1fr)_380px] lg:gap-14 lg:px-14 lg:pt-7">
                {/* 左欄：句型、熟練度地圖、開始造句、說明 */}
                <div className="@container flex min-w-0 flex-col gap-7">
                    {deleteError && errorBox(deleteError)}
                    <section className="flex flex-col gap-2.5">
                        <h1 lang="en" className="font-reading text-[40px] leading-[1.12] tracking-[-0.01em] text-ink break-words lg:text-[56px] lg:leading-[1.05]">{pattern.text}</h1>
                        {pattern.meaningZh && <p className="text-base leading-relaxed text-ink lg:text-lg">{pattern.meaningZh}</p>}
                        {pattern.maintenance && (
                            <p className="flex items-center gap-1.5 text-[13px] text-gold">
                                <ShieldCheck size={14} aria-hidden="true" />
                                維持複習：{pattern.maintenance.level > 0 ? `已連續通過 ${pattern.maintenance.level} 次` : pattern.maintenance.lastReviewedAt ? '上次沒有通過' : '尚未開始'}・下次 {getSydneyDateString(pattern.maintenance.dueAt)}
                            </p>
                        )}
                    </section>

                    <div className="grid grid-cols-1 items-start gap-7 @[40rem]:grid-cols-[300px_minmax(0,1fr)]">
                        <section className="flex w-full max-w-[400px] flex-col gap-3 rounded-[18px] border border-line bg-surface p-[18px]">
                            <div className="flex items-baseline justify-between gap-3">
                                <h2 className="text-[13px] font-medium text-ink">熟練度地圖</h2>
                                <span className="text-[13px] text-muted">
                                    <span className="font-reading text-xl text-ink tabular-nums">{masteredTotal}</span> / 100 句精熟
                                </span>
                            </div>
                            <div role="img" aria-label={`熟練度地圖：已精熟 ${masteredTotal} / 100 句`}>
                                <MasteryMap map={map} />
                            </div>
                            <div className="mt-1.5 flex flex-col gap-1.5" aria-hidden="true">
                                <div className="relative h-1 rounded-full bg-line">
                                    <div className="absolute inset-y-0 left-0 rounded-full bg-accent" style={{ width: `${Math.min(100, masteredTotal)}%` }} />
                                    {milestones.slice(0, 2).map(m => (
                                        <span key={m.at} className={`absolute -top-[3px] h-2.5 w-0.5 ${masteredTotal >= m.at ? 'bg-ink' : 'bg-muted/60'}`} style={{ left: `${m.at}%` }} />
                                    ))}
                                </div>
                                <div className="relative h-4 text-[11px] text-muted">
                                    {milestones.map(m => (
                                        <span
                                            key={m.at}
                                            className={`absolute whitespace-nowrap ${m.key === stage.stage ? 'font-medium text-ink' : ''}`}
                                            style={m.at === 100 ? { right: 0 } : { left: `${m.at}%`, transform: 'translateX(-50%)' }}
                                        >
                                            {m.label}
                                        </span>
                                    ))}
                                </div>
                            </div>
                        </section>

                        <div className="flex flex-col gap-6">
                            <Button size="lg" fullWidth onClick={() => setShowGroupSelection(true)} icon={<PenTool size={18} aria-hidden="true" />}>
                                開始造句練習
                            </Button>
                            {pattern.learningPoint && (
                                <section className="flex flex-col gap-1.5">
                                    <h2 className="text-xs font-medium text-muted">學習重點</h2>
                                    <p className="text-[15px] leading-relaxed text-ink">{pattern.learningPoint}</p>
                                </section>
                            )}
                            <section className="flex flex-col gap-1.5">
                                <h2 className="text-xs font-medium text-muted">使用時機</h2>
                                <p className="text-[15px] leading-relaxed text-ink">{pattern.usageContext}</p>
                            </section>
                            {pattern.situationTags && pattern.situationTags.length > 0 && (
                                <section className="flex flex-col gap-2">
                                    <h2 className="text-xs font-medium text-muted">情境標籤</h2>
                                    <div className="flex flex-wrap gap-1.5">
                                        {pattern.situationTags.map((tag, idx) => (
                                            <span key={idx} className="rounded-full border border-line bg-surface-2 px-2.5 py-1 text-xs text-ink break-words">#{tag}</span>
                                        ))}
                                    </div>
                                </section>
                            )}
                            {pattern.sourceLabel && (
                                <p className="text-xs text-muted break-words">來自: <span className="italic text-ink">{pattern.sourceLabel}</span></p>
                            )}
                        </div>
                    </div>
                </div>

                {/* 右側欄：示範例句、在教材中出現 */}
                <aside className="flex min-w-0 flex-col gap-10 lg:border-l lg:border-line lg:pl-8">
                    <section className="flex flex-col gap-1.5">
                        <div className="flex items-center justify-between gap-2">
                            <h2 className="text-[15px] font-bold text-ink">示範例句</h2>
                            <Button
                                variant="secondary"
                                size="sm"
                                onClick={handleRegenerateClick}
                                disabled={regenerating}
                                icon={regenerating ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : <RefreshCw size={14} aria-hidden="true" />}
                            >
                                {regenerating ? '產生中…' : '重新產生'}
                            </Button>
                        </div>
                        {regenerateError && <div className="mt-2">{errorBox(regenerateError)}</div>}
                        {pattern.seedExamples && pattern.seedExamples.length > 0 ? (
                            <ul className="mt-1 flex flex-col">
                                {pattern.seedExamples.map((ex, idx) => (
                                    <li key={idx} className="flex flex-col gap-1 border-t border-line py-3">
                                        <p lang="en" className="font-reading text-lg leading-snug text-ink break-words">{ex.en}</p>
                                        <p className="text-[13px] text-muted">{ex.zh}</p>
                                    </li>
                                ))}
                            </ul>
                        ) : (
                            <p className="py-4 text-center text-sm text-muted">目前沒有示範例句，可以按「重新產生」建立</p>
                        )}
                    </section>

                    <PatternSightingsSection patternId={pattern.id} />
                </aside>
            </div>

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
