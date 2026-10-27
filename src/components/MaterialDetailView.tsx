import React, { useRef, useState } from 'react';
import { Material, CoverStyle } from '../types';
import { ChevronLeft, Play, Pause, Mic, Loader2, Sparkles, Trash2, RotateCcw, BookOpen, X, Search, RefreshCw } from 'lucide-react';
import { auth, db, appId } from '../firebase';
import { doc, onSnapshot, collection, setDoc, updateDoc, getDoc } from 'firebase/firestore';
import ShadowingPracticeView from './ShadowingPracticeView';
import { extractPatternsFromSentence } from '../services/gemini';
import { savePatternsWithDedup, formatSaveResult, listPatternsFromSentence } from '../services/patternSave';
import { startCoverGeneration, buildCoverExcerpt } from '../services/cover';
import ConfirmDialog from './ConfirmDialog';
import PatternQuickCard from './PatternQuickCard';
import ExtractPreviewDialog from './ExtractPreviewDialog';
import { requestSightingDetection, MaterialSightings } from '../services/sightings';
import RetellSection from './RetellSection';
import RetellView from './RetellView';
import { RetellSegment, RetellTargetPattern } from '../services/retell';
import Button from './ui/Button';
import IconButton from './ui/IconButton';
import ProgressBar from './ui/ProgressBar';
import SegmentedControl from './ui/SegmentedControl';
import { materialProgress, MASTERY_MAX } from '../utils/materialProgress';

export default function MaterialDetailView({ materialId, onBack }: { materialId: string, onBack: () => void }) {
    const [material, setMaterial] = useState<Material | null>(null);

    React.useEffect(() => {
        const uid = auth.currentUser?.uid;
        if (!uid || !materialId) return;

        const docRef = doc(db, `artifacts/${appId}/users/${uid}/materials`, materialId);
        const unsubscribe = onSnapshot(docRef, (snapshot) => {
            if (snapshot.exists()) {
                setMaterial({ id: snapshot.id, ...snapshot.data() } as Material);
            }
        }, (error) => {
            console.error('[監聽來源:MaterialDetailView-material]', error);
        });

    
        return () => unsubscribe();
    }, [materialId]);
    const audioRef = useRef<HTMLAudioElement>(null);
    const [playingIndex, setPlayingIndex] = useState<number | null>(null);
    const [practiceIndex, setPracticeIndex] = useState<number | null>(null);
    const [extractingIndex, setExtractingIndex] = useState<number | null>(null);
    const [extractMessage, setExtractMessage] = useState<{ text: string, isError: boolean } | null>(null);
    const [showTrash, setShowTrash] = useState(false);
    const [pendingDeleteIndex, setPendingDeleteIndex] = useState<number | null>(null);
    const [coverStyle, setCoverStyle] = useState<CoverStyle>(() => {
        try {
            const saved = localStorage.getItem('huanux_cover_style');
            if (saved === 'photo' || saved === 'anime') return saved;
        } catch {}
        return 'photo';
    });

    const handleCoverStyleChange = (style: CoverStyle) => {
        setCoverStyle(style);
        try {
            localStorage.setItem('huanux_cover_style', style);
        } catch {}
    };

    const [sightings, setSightings] = useState<MaterialSightings | null>(null);
    const [patternNames, setPatternNames] = useState<Record<string, string | null>>({});
    const [quickCardPatternId, setQuickCardPatternId] = useState<string | null>(null);
    // 萃取結果預覽：使用者勾選後才存入句型庫
    const [extractPreview, setExtractPreview] = useState<{ index: number; patterns: any[]; reviewNote: string } | null>(null);
    const [savingPreview, setSavingPreview] = useState(false);
    const [retellTarget, setRetellTarget] = useState<{ segmentIndex: number; segment: RetellSegment; targetPatterns: RetellTargetPattern[] } | null>(null);

    // 監聽這份教材的已學句型比對結果
    React.useEffect(() => {
        const uid = auth.currentUser?.uid;
        if (!uid || !materialId) return;
        const ref = doc(db, `artifacts/${appId}/users/${uid}/materialSightings`, materialId);
        const unsubscribe = onSnapshot(ref, (snapshot) => {
            setSightings(snapshot.exists() ? (snapshot.data() as MaterialSightings) : null);
        }, (error) => {
            console.error('[監聽來源:MaterialDetailView-materialSightings]', error);
        });
        return () => unsubscribe();
    }, [materialId]);

    // 取得標籤要顯示的句型文字（已刪除的句型記為 null，不顯示標籤）
    React.useEffect(() => {
        const uid = auth.currentUser?.uid;
        if (!uid || !sightings?.bySentence) return;
        const bySentence = sightings.bySentence;
        const ids = Array.from(new Set(Object.keys(bySentence).reduce<string[]>((acc, key) => acc.concat(bySentence[key] || []), []))).filter(id => !(id in patternNames));
        if (ids.length === 0) return;
        let cancelled = false;
        Promise.all(ids.map(id =>
            getDoc(doc(db, `artifacts/${appId}/users/${uid}/languagePatterns`, id))
                .then(snap => [id, snap.exists() ? String(snap.data().text || '') : null] as const)
                .catch(() => [id, null] as const)
        )).then(entries => {
            if (cancelled) return;
            setPatternNames(prev => {
                const next = { ...prev };
                for (const [id, name] of entries) next[id] = name;
                return next;
            });
        });
        return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [sightings?.bySentence]);

    if (!material) {
        return (
            <div className="flex flex-col h-full p-6 items-center justify-center" role="status">
                <Loader2 className="animate-spin text-accent mb-4" size={32} aria-hidden="true" />
                <p className="text-muted">載入中...</p>
            </div>
        );
    }

    // 實際位置 vs 顯示序號：寫入、播放、萃取一律用句子在陣列中的實際位置；導覽與顯示只看未刪除的句子
    const activeIndices = material.sentences.map((s, i) => (s.deleted ? -1 : i)).filter(i => i >= 0);
    const deletedIndices = material.sentences.map((s, i) => (s.deleted ? i : -1)).filter(i => i >= 0);
    const lastActiveIndex = activeIndices[activeIndices.length - 1];

    if (retellTarget) {
        return (
            <RetellView
                material={material}
                segment={retellTarget.segment}
                segmentIndex={retellTarget.segmentIndex}
                targetPatterns={retellTarget.targetPatterns}
                onBack={() => setRetellTarget(null)}
            />
        );
    }

    if (practiceIndex !== null) {
        return (
            <ShadowingPracticeView 
                material={material} 
                sentenceIndex={practiceIndex} 
                onBack={() => setPracticeIndex(null)} 
                onNext={() => setPracticeIndex(prev => {
                    if (prev === null) return prev;
                    const next = activeIndices.find(i => i > prev);
                    return next !== undefined ? next : prev;
                })}
                onJump={(index) => setPracticeIndex(index)}
                isLastSentence={practiceIndex === lastActiveIndex}
                sightingPatternIds={sightings?.bySentence?.[material.sentences[practiceIndex]?.id] || []}
            />
        );
    }

    const handlePlaySegment = (index: number) => {
        const sentence = material.sentences[index];
        if (audioRef.current) {
            audioRef.current.currentTime = sentence.startTime;
            audioRef.current.play();
            setPlayingIndex(index);
        }
    };

    const handleTimeUpdate = () => {
        if (playingIndex !== null && audioRef.current) {
            const sentence = material.sentences[playingIndex];
            if (audioRef.current.currentTime >= sentence.endTime && sentence.endTime > 0) {
                audioRef.current.pause();
                setPlayingIndex(null);
            }
        }
    };

    const handlePause = () => {
        if (audioRef.current) {
            audioRef.current.pause();
            setPlayingIndex(null);
        }
    };

    // 把句子標記為「已萃取」
    const markExtracted = async (index: number) => {
        const uid = auth.currentUser?.uid;
        if (!uid || !material) return;
        const updatedSentences = [...material.sentences];
        updatedSentences[index] = { ...updatedSentences[index], extracted: true };
        await updateDoc(doc(db, `artifacts/${appId}/users/${uid}/materials`, material.id), {
            sentences: updatedSentences
        });
    };

    const showExtractMessage = (text: string, isError: boolean) => {
        setExtractMessage({ text, isError });
        setTimeout(() => setExtractMessage(null), isError ? 3000 : 6000);
    };

    // 第一步：萃取＋審核，結果先給使用者預覽勾選
    const handleExtract = async (index: number) => {
        if (!material) return;
        const uid = auth.currentUser?.uid;
        if (!uid) return;

        setExtractingIndex(index);
        setExtractMessage(null);
        const sentence = material.sentences[index];

        try {
            // 重新萃取時，把這句已有的句型告訴 AI，避免產生重疊的句型
            const existingFromSentence = sentence.extracted
                ? await listPatternsFromSentence(material.id, { id: sentence.id, text: sentence.text }).catch(() => [])
                : [];
            const { patterns, review } = await extractPatternsFromSentence(
                sentence.text,
                sentence.translation || '',
                existingFromSentence.map(p => p.text).filter(Boolean)
            );

            const reviewNote = review.reviewed && (review.dropped > 0 || review.fixed > 0)
                ? `（審核刪除 ${review.dropped} 個、修正 ${review.fixed} 個）`
                : '';

            if (patterns.length === 0) {
                await markExtracted(index);
                showExtractMessage('這次沒有找到值得萃取的句型' + reviewNote, false);
                return;
            }
            setExtractPreview({ index, patterns, reviewNote });
        } catch (err: any) {
            console.error(err);
            showExtractMessage(err.message || '萃取失敗', true);
        } finally {
            setExtractingIndex(null);
        }
    };

    // 第二步：只把勾選的項目存入句型庫
    const handleConfirmPreview = async (selectedIndexes: number[]) => {
        if (!material || !extractPreview) return;
        const { index, patterns, reviewNote } = extractPreview;
        const sentence = material.sentences[index];
        setSavingPreview(true);
        try {
            const chosen = selectedIndexes.map(i => patterns[i]).filter(Boolean);
            const saveResult = await savePatternsWithDedup(chosen, {
                sourceMaterialId: material.id,
                sourceSentenceId: sentence.id,
                sourceLabel: sentence.text.substring(0, 20) + (sentence.text.length > 20 ? '...' : ''),
                sourceExample: { en: sentence.text, zh: sentence.translation || '' }
            });
            await markExtracted(index);
            setExtractPreview(null);
            showExtractMessage(formatSaveResult(saveResult) + reviewNote, false);
        } catch (err: any) {
            console.error(err);
            showExtractMessage(err.message || '存檔失敗', true);
        } finally {
            setSavingPreview(false);
        }
    };

    const handleCancelPreview = async () => {
        if (!extractPreview) return;
        const { index } = extractPreview;
        setExtractPreview(null);
        try {
            await markExtracted(index);
        } catch (err) {
            console.warn('標記已萃取失敗:', err);
        }
        showExtractMessage('沒有加入任何句型', false);
    };

    const handleDeleteSentence = async (index: number) => {
        const uid = auth.currentUser?.uid;
        if (!uid || activeIndices.length <= 1) return;
        if (playingIndex === index) handlePause();
        try {
            const updatedSentences = material.sentences.map((s, i) => (i === index ? { ...s, deleted: true } : s));
            await updateDoc(doc(db, `artifacts/${appId}/users/${uid}/materials`, material.id), { sentences: updatedSentences });
        } catch (err: any) {
            console.error(err);
            setExtractMessage({ text: err.message || '刪除失敗', isError: true });
            setTimeout(() => setExtractMessage(null), 3000);
        }
    };

    const handleRestoreSentence = async (index: number) => {
        const uid = auth.currentUser?.uid;
        if (!uid) return;
        try {
            // Firestore 不接受寫入 undefined，所以復原時把 deleted 欄位整個移除
            const updatedSentences = material.sentences.map((s, i) => {
                if (i !== index) return s;
                const { deleted, ...rest } = s;
                return rest;
            });
            await updateDoc(doc(db, `artifacts/${appId}/users/${uid}/materials`, material.id), { sentences: updatedSentences });
        } catch (err: any) {
            console.error(err);
            setExtractMessage({ text: err.message || '復原失敗', isError: true });
            setTimeout(() => setExtractMessage(null), 3000);
        }
    };

    const handleGenerateCover = async () => {
        if (!material) return;
        const uid = auth.currentUser?.uid;
        if (!uid) return;

        try {
            await updateDoc(doc(db, `artifacts/${appId}/users/${uid}/materials`, material.id), {
                coverStyle,
                coverStatus: 'generating',
                coverRequestedAt: Date.now()
            });

            startCoverGeneration(
                material.id,
                coverStyle,
                material.title,
                buildCoverExcerpt(material.sentences.filter(s => !s.deleted))
            );
        } catch (err: any) {
            console.error(err);
            setExtractMessage({ text: err.message || '更新封面狀態失敗', isError: true });
            setTimeout(() => setExtractMessage(null), 3000);
        }
    };

    const isCoverGenerating = material.coverStatus === 'generating' && !!material.coverRequestedAt && (Date.now() - material.coverRequestedAt < 5 * 60 * 1000);

    const { total: activeTotal, completed: completedTotal } = materialProgress(material.sentences);

    // 已學句型比對的狀態（判斷與文字沿用原本）
    const isDetecting = sightings?.status === 'processing' && typeof sightings.requestedAt === 'number' && Date.now() - sightings.requestedAt < 5 * 60 * 1000;
    const matchedCount = Object.keys(sightings?.bySentence || {}).length;
    const sightingStatusText = isDetecting
        ? '比對中，完成後含有已學句型的句子會加上標籤'
        : sightings?.status === 'error'
            ? `比對失敗：${sightings.error || '請稍後再試'}`
            : sightings?.status === 'done'
                ? `${matchedCount} 句含有已學句型`
                : sightings?.status === 'processing'
                    ? '上次比對沒有完成，可以重新比對'
                    : '還沒比對過';

    return (
        <div className="h-full overflow-y-auto">
            <div className="px-5 pt-2 pb-24 sm:px-8 lg:grid lg:grid-cols-[360px_minmax(0,1fr)] lg:items-start lg:gap-12 lg:px-12 lg:pt-6 lg:pb-16">

                {/* 左欄：封面、標題、進度、工具 */}
                <section className="flex flex-col gap-5">
                    <div className="-mx-3 flex items-center justify-between">
                        <IconButton aria-label="返回教材列表" onClick={onBack}>
                            <ChevronLeft size={22} aria-hidden="true" />
                        </IconButton>
                        <IconButton
                            aria-label={deletedIndices.length > 0 ? `垃圾桶，${deletedIndices.length} 句已刪除` : '垃圾桶'}
                            title="垃圾桶"
                            onClick={() => setShowTrash(true)}
                            className="relative text-muted"
                        >
                            <Trash2 size={19} strokeWidth={1.8} aria-hidden="true" />
                            {deletedIndices.length > 0 && (
                                <span className="absolute top-1.5 right-1 min-w-4 h-4 px-1 rounded-full bg-ink text-surface text-[10px] leading-4 text-center" aria-hidden="true">
                                    {deletedIndices.length}
                                </span>
                            )}
                        </IconButton>
                    </div>

                    {/* 封面 */}
                    <div className="aspect-video w-full overflow-hidden rounded-[18px] bg-surface-2 border border-line flex items-center justify-center">
                        {material.coverUrl && material.coverStatus !== 'generating' ? (
                            <img src={material.coverUrl} alt="" className="w-full h-full object-cover" />
                        ) : isCoverGenerating ? (
                            <div className="flex flex-col items-center justify-center gap-2 text-accent" role="status">
                                <Loader2 size={28} className="animate-spin" aria-hidden="true" />
                                <span className="text-sm text-muted">封面產生中</span>
                            </div>
                        ) : (
                            <BookOpen size={40} strokeWidth={1.4} className="text-muted/50" aria-hidden="true" />
                        )}
                    </div>

                    {/* 標題與整體進度 */}
                    <div className="flex flex-col gap-3">
                        <h2 className="font-reading text-[30px] leading-[1.18] tracking-[-0.01em] text-ink break-words">{material.title}</h2>
                        <div className="flex items-center justify-between text-[13px] text-muted">
                            <span>{activeTotal} 句</span>
                            <span><span className="font-medium text-ink">{completedTotal}</span> 句已畢業</span>
                        </div>
                        <ProgressBar value={completedTotal} max={activeTotal} label="整份教材進度" size="sm" />
                    </div>

                    {/* 封面風格與產生封面 */}
                    <div className="flex flex-wrap items-center justify-between gap-2">
                        <SegmentedControl<CoverStyle>
                            label="封面風格"
                            value={coverStyle}
                            onChange={handleCoverStyleChange}
                            options={[
                                { value: 'photo', label: '寫實攝影' },
                                { value: 'anime', label: '日系動漫' },
                            ]}
                        />
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={handleGenerateCover}
                            disabled={isCoverGenerating}
                            icon={isCoverGenerating ? <Loader2 size={15} className="animate-spin" aria-hidden="true" /> : <RefreshCw size={15} aria-hidden="true" />}
                        >
                            {isCoverGenerating ? '產生中…' : (material.coverUrl ? '重新產生封面' : '產生封面')}
                        </Button>
                    </div>
                    {material.coverStatus === 'error' && (
                        <p role="alert" className="-mt-2 text-xs font-medium text-danger break-words">
                            封面產生失敗：{material.coverError || '未知錯誤'}
                        </p>
                    )}

                    {/* 工具：已學句型比對＋複述練習（同一張卡片，分隔線區隔） */}
                    <div className="rounded-2xl border border-line bg-surface">
                        <div className="flex items-center gap-3 px-4 py-3.5">
                            <div className="min-w-0 flex-1">
                                <p className="text-sm font-medium text-ink">已學句型比對</p>
                                <p className={`text-xs mt-0.5 ${sightings?.status === 'error' ? 'text-danger' : 'text-muted'}`}>{sightingStatusText}</p>
                            </div>
                            <Button
                                variant="secondary"
                                size="sm"
                                onClick={() => requestSightingDetection(material.id)}
                                disabled={isDetecting}
                                icon={isDetecting ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : <Search size={14} aria-hidden="true" />}
                                className="shrink-0"
                            >
                                {sightings?.status === 'done' ? '重新比對' : '比對已學句型'}
                            </Button>
                        </div>
                        <div className="mx-4 h-px bg-line" />
                        <RetellSection
                            embedded
                            material={material}
                            bySentence={sightings?.bySentence}
                            onStart={(segmentIndex, segment, targetPatterns) => setRetellTarget({ segmentIndex, segment, targetPatterns })}
                        />
                    </div>
                </section>

                {/* 右欄：句子 */}
                <section className="mt-9 lg:mt-[60px]">
                    <div className="flex items-baseline justify-between pb-3 lg:border-b lg:border-line">
                        <h3 className="text-[17px] font-bold tracking-wide text-ink">句子</h3>
                        <span className="text-xs text-muted">點「跟讀」開始練習</span>
                    </div>

                    {extractMessage && (
                        <div
                            role="status"
                            className={`my-3 rounded-xl px-4 py-3 text-sm font-medium text-center break-words ${
                                extractMessage.isError ? 'bg-danger/10 text-danger' : 'bg-accent-soft text-ink'
                            }`}
                        >
                            {extractMessage.text}
                        </div>
                    )}

                    <audio
                        ref={audioRef}
                        src={material.audioUrl}
                        onTimeUpdate={handleTimeUpdate}
                        onEnded={() => setPlayingIndex(null)}
                    />

                    <div className="flex flex-col gap-3 lg:gap-0">
                        {material.sentences.map((s, i) => {
                            if (s.deleted) return null;
                            const mastery = Number.isFinite(s.mastery) ? s.mastery : 0;
                            const isCompleted = mastery >= MASTERY_MAX;
                            const patternIds = (sightings?.bySentence?.[s.id] || []).filter(pid => patternNames[pid]);
                            const canDelete = activeIndices.length > 1;
                            return (
                                <article
                                    key={s.id}
                                    className="flex flex-col gap-2.5 rounded-2xl border border-line bg-surface p-4 sm:p-5 lg:rounded-none lg:border-0 lg:border-b lg:bg-transparent lg:px-0 lg:py-5"
                                >
                                    <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
                                        <span className="tabular-nums">{activeIndices.indexOf(i) + 1}</span>
                                        {isCompleted && (
                                            <span className="rounded-full bg-gold/12 px-2 py-0.5 text-[11px] text-gold">已精熟</span>
                                        )}
                                        {s.lowConfidence && (
                                            <span className="rounded-full bg-warn/10 px-2 py-0.5 text-[11px] text-warn">低信心度</span>
                                        )}
                                    </div>
                                    <p lang="en" className="font-reading text-[20px] leading-[1.4] text-ink break-words">
                                        {s.text}
                                    </p>
                                    <p className="text-sm leading-[1.65] text-muted break-words">
                                        {s.translation}
                                    </p>
                                    {patternIds.length > 0 && (
                                        <div className="flex flex-wrap gap-1.5 pt-0.5">
                                            {patternIds.map(pid => (
                                                <button
                                                    key={pid}
                                                    type="button"
                                                    onClick={() => setQuickCardPatternId(pid)}
                                                    className="min-h-8 rounded-full bg-accent-soft px-3 text-xs text-ink transition-[filter] hover:brightness-[0.97] dark:hover:brightness-110 focus-visible:outline-2 focus-visible:outline-accent"
                                                >
                                                    含句型：{patternNames[pid]}
                                                </button>
                                            ))}
                                        </div>
                                    )}

                                    <div className="flex flex-wrap items-center gap-x-1 gap-y-2 pt-1">
                                        <div className="mr-auto flex min-w-24 items-center gap-2">
                                            <ProgressBar
                                                value={Math.min(mastery, MASTERY_MAX)}
                                                max={MASTERY_MAX}
                                                label="熟練度"
                                                size="sm"
                                                tone={isCompleted ? 'gold' : 'accent'}
                                                className="w-16"
                                            />
                                            <span className="font-reading text-[15px] tabular-nums text-ink">{mastery}</span>
                                        </div>
                                        <div className="ml-auto flex items-center gap-1">
                                            <IconButton
                                                aria-label="刪除句子"
                                                title={canDelete ? '刪除句子' : '至少需保留 1 句'}
                                                onClick={() => setPendingDeleteIndex(i)}
                                                disabled={!canDelete}
                                                className="text-muted hover:text-danger hover:bg-danger/10 disabled:opacity-35 disabled:hover:bg-transparent disabled:hover:text-muted"
                                            >
                                                <Trash2 size={17} strokeWidth={1.8} aria-hidden="true" />
                                            </IconButton>
                                            {isCompleted && (
                                                <Button
                                                    variant="ghost"
                                                    size="sm"
                                                    onClick={() => handleExtract(i)}
                                                    disabled={extractingIndex !== null}
                                                    title={s.extracted ? '已萃取過，可重新萃取（與既有句型重複的會自動略過）' : undefined}
                                                    icon={extractingIndex === i ? <Loader2 size={15} className="animate-spin" aria-hidden="true" /> : <Sparkles size={15} aria-hidden="true" />}
                                                    className="text-gold! hover:bg-gold/10!"
                                                >
                                                    {s.extracted ? '重新萃取' : '萃取'}
                                                </Button>
                                            )}
                                            <IconButton
                                                aria-label={playingIndex === i ? '暫停' : '播放這一句'}
                                                onClick={() => playingIndex === i ? handlePause() : handlePlaySegment(i)}
                                                className={`border ${playingIndex === i ? 'border-accent bg-accent-soft' : 'border-line'}`}
                                            >
                                                {playingIndex === i
                                                    ? <Pause size={16} className="fill-current" aria-hidden="true" />
                                                    : <Play size={16} className="fill-current ml-0.5" aria-hidden="true" />}
                                            </IconButton>
                                            <Button onClick={() => setPracticeIndex(i)} icon={<Mic size={16} aria-hidden="true" />}>
                                                跟讀
                                            </Button>
                                        </div>
                                    </div>
                                </article>
                            );
                        })}
                    </div>
                </section>
            </div>

            {/* 刪除確認對話框 */}
            <ConfirmDialog
                isOpen={pendingDeleteIndex !== null}
                title="刪除這句？"
                message={(() => {
                    if (pendingDeleteIndex === null) return '';
                    const s = material.sentences[pendingDeleteIndex];
                    if (!s) return '';
                    const preview = s.text.length > 40 ? s.text.substring(0, 40) + '…' : s.text;
                    return `「${preview}」\n刪除後可以從右上角的垃圾桶復原，練習分數會保留。`;
                })()}
                confirmText="刪除"
                cancelText="取消"
                onConfirm={() => {
                    const idx = pendingDeleteIndex;
                    setPendingDeleteIndex(null);
                    if (idx !== null) {
                        handleDeleteSentence(idx);
                    }
                }}
                onCancel={() => setPendingDeleteIndex(null)}
            />

            {/* 垃圾桶視窗 */}
            {showTrash && (
                <div
                    className="fixed inset-0 z-100 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4"
                    onClick={() => setShowTrash(false)}
                >
                    <div
                        role="dialog"
                        aria-modal="true"
                        aria-label={`垃圾桶（${deletedIndices.length}）`}
                        className="flex max-h-[85vh] w-full max-w-lg flex-col rounded-3xl border border-line bg-surface p-6 shadow-[0_24px_48px_-12px_rgb(0_0_0/0.25)]"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className="mb-4 flex items-center justify-between border-b border-line pb-4">
                            <h3 className="flex items-center gap-2 text-lg font-bold text-ink">
                                <Trash2 size={19} className="text-muted" aria-hidden="true" />
                                垃圾桶（{deletedIndices.length}）
                            </h3>
                            <IconButton aria-label="關閉" onClick={() => setShowTrash(false)} className="-mr-2 text-muted">
                                <X size={20} aria-hidden="true" />
                            </IconButton>
                        </div>

                        <div className="max-h-[70vh] space-y-3 overflow-y-auto pr-1">
                            {deletedIndices.length === 0 ? (
                                <div className="py-12 text-center text-muted">
                                    垃圾桶是空的
                                </div>
                            ) : (
                                deletedIndices.map((i) => {
                                    const s = material.sentences[i];
                                    return (
                                        <div key={s.id || i} className="flex flex-col gap-3 rounded-xl border border-line bg-surface-2 p-3.5">
                                            <div className="min-w-0 flex-1 space-y-1">
                                                <span className="text-xs text-muted tabular-nums">熟練度 {s.mastery}</span>
                                                <p lang="en" className="font-reading text-[17px] leading-snug text-ink break-words line-through decoration-muted/60 opacity-80">
                                                    {s.text}
                                                </p>
                                                {s.translation && (
                                                    <p className="text-xs text-muted break-words">
                                                        {s.translation}
                                                    </p>
                                                )}
                                            </div>
                                            <Button
                                                variant="secondary"
                                                size="sm"
                                                onClick={() => handleRestoreSentence(i)}
                                                icon={<RotateCcw size={14} aria-hidden="true" />}
                                                className="self-end"
                                            >
                                                復原
                                            </Button>
                                        </div>
                                    );
                                })
                            )}
                        </div>
                    </div>
                </div>
            )}

            {quickCardPatternId && (
                <PatternQuickCard patternId={quickCardPatternId} onClose={() => setQuickCardPatternId(null)} />
            )}

            {extractPreview && (
                <ExtractPreviewDialog
                    candidates={extractPreview.patterns}
                    note={extractPreview.reviewNote}
                    saving={savingPreview}
                    onConfirm={handleConfirmPreview}
                    onCancel={handleCancelPreview}
                />
            )}
        </div>
    );
}
