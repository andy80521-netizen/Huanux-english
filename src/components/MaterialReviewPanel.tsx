import React, { useState, useRef, useEffect, useId } from 'react';
import { Play, Pause, Check, AlertCircle, Trash2, RotateCcw, ChevronDown } from 'lucide-react';
import SegmentedControl from './ui/SegmentedControl';
import Button from './ui/Button';

import { MaterialSentence, CoverStyle } from '../types';

export type ReviewSentence = Pick<MaterialSentence, 'text' | 'translation' | 'startTime' | 'endTime' | 'lowConfidence' | 'needsReview'>;

export interface MaterialReviewPanelProps {
    source: 'upload' | 'tts';
    audioFile?: File;
    audioBlob?: Blob;
    fileName: string;
    initialSentences: ReviewSentence[];
    isSaving?: boolean;
    onSave: (sentences: ReviewSentence[], coverChoice: CoverStyle | 'none') => void;
    onCancel: () => void;
    /** 標題左側的元素（匯入頁的返回鈕） */
    headerStart?: React.ReactNode;
    /** 標題下方的狀態區（翻譯進度） */
    status?: React.ReactNode;
    /** 存檔失敗等訊息，顯示在動作按鈕旁（手機在底部按鈕上方） */
    notice?: string | null;
}

const COVER_OPTIONS = [
    { value: 'photo', label: '寫實攝影' },
    { value: 'anime', label: '日系動漫' },
    { value: 'none', label: '不產生封面' },
] as const;

const FIELD = 'border border-muted/35 bg-surface-2 text-ink transition-colors focus-visible:border-accent focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-accent';

type InternalReviewSentence = ReviewSentence & {
    internalId: string;
    deleted: boolean;
};

export default function MaterialReviewPanel({
    source,
    audioFile,
    audioBlob,
    fileName,
    initialSentences,
    isSaving = false,
    onSave,
    onCancel,
    headerStart,
    status,
    notice
}: MaterialReviewPanelProps) {
    const uid = useId();
    const [sentences, setSentences] = useState<InternalReviewSentence[]>(() =>
        initialSentences.map((s, i) => ({
            ...s,
            internalId: `rev_${i}`,
            deleted: false
        }))
    );
    const [audioUrl, setAudioUrl] = useState<string>('');
    const audioRef = useRef<HTMLAudioElement>(null);
    const [playingId, setPlayingId] = useState<string | null>(null);
    const [isDeletedExpanded, setIsDeletedExpanded] = useState(false);
    const [showDiscardConfirm, setShowDiscardConfirm] = useState(false);
    const [timeAdjustWarnings, setTimeAdjustWarnings] = useState<Record<string, string>>({});
    const [coverChoice, setCoverChoice] = useState<CoverStyle | 'none'>(() => {
        try {
            const saved = localStorage.getItem('huanux_cover_style');
            if (saved === 'photo' || saved === 'anime' || saved === 'none') {
                return saved;
            }
        } catch (e) {
            console.warn('讀取封面風格偏好失敗:', e);
        }
        return 'photo';
    });

    const handleCoverChoiceChange = (choice: CoverStyle | 'none') => {
        setCoverChoice(choice);
        try {
            localStorage.setItem('huanux_cover_style', choice);
        } catch (e) {
            console.warn('儲存封面風格偏好失敗:', e);
        }
    };

    useEffect(() => {
        const fileOrBlob = audioFile || audioBlob;
        if (fileOrBlob) {
            const url = URL.createObjectURL(fileOrBlob);
            setAudioUrl(url);
            return () => URL.revokeObjectURL(url);
        }
    }, [audioFile, audioBlob]);

    const handlePlaySegment = (id: string) => {
        const sentence = sentences.find(s => s.internalId === id);
        if (sentence && audioRef.current) {
            audioRef.current.currentTime = sentence.startTime;
            audioRef.current.play();
            setPlayingId(id);
        }
    };

    const handleTimeUpdate = () => {
        if (playingId && audioRef.current) {
            const sentence = sentences.find(s => s.internalId === playingId);
            if (sentence && audioRef.current.currentTime >= sentence.endTime && sentence.endTime > 0) {
                audioRef.current.pause();
                setPlayingId(null);
            }
        }
    };

    const handlePause = () => {
        if (audioRef.current) {
            audioRef.current.pause();
            setPlayingId(null);
        }
    };

    const updateSentence = (id: string, field: keyof ReviewSentence, value: any) => {
        if (field === 'startTime' || field === 'endTime') {
            setTimeAdjustWarnings(prev => {
                if (!prev[id]) return prev;
                const updated = { ...prev };
                delete updated[id];
                return updated;
            });
        }
        setSentences(prev => prev.map(s => s.internalId === id ? { ...s, [field]: value } : s));
    };

    const handleDelete = (id: string) => {
        if (playingId === id) {
            handlePause();
        }
        setSentences(prev => prev.map(s => s.internalId === id ? { ...s, deleted: true } : s));
    };

    const handleRestore = (id: string) => {
        setSentences(prev => prev.map(s => s.internalId === id ? { ...s, deleted: false } : s));
    };

    const handleAdjustTime = (id: string, field: 'startTime' | 'endTime', delta: number) => {
        const sentence = sentences.find(s => s.internalId === id);
        if (!sentence) return;

        const currentVal = sentence[field];
        const newVal = Math.round(Math.max(0, currentVal + delta) * 100) / 100;

        const newStart = field === 'startTime' ? newVal : sentence.startTime;
        const newEnd = field === 'endTime' ? newVal : sentence.endTime;

        const oldGap = sentence.startTime - sentence.endTime;
        const newGap = newStart - newEnd;
        // 調整後仍不合理，且沒有比原本改善時才擋下（原本合理、調整後變不合理，也屬於這種情況）
        if (newStart >= newEnd && newGap >= oldGap) {
            setTimeAdjustWarnings(prev => ({
                ...prev,
                [id]: '此調整會使開始時間大於或等於結束時間，已取消'
            }));
            return;
        }

        setTimeAdjustWarnings(prev => {
            if (!prev[id]) return prev;
            const updated = { ...prev };
            delete updated[id];
            return updated;
        });

        setSentences(prev => prev.map(s => s.internalId === id ? { ...s, [field]: newVal } : s));
    };

    const activeSentences = sentences.filter(s => !s.deleted);
    const deletedSentences = sentences.filter(s => s.deleted);

    const invalidSentenceIndices = activeSentences
        .map((s, idx) => (s.startTime >= s.endTime ? idx + 1 : null))
        .filter((idx): idx is number => idx !== null);
    const hasInvalidTime = invalidSentenceIndices.length > 0;

    const handleSaveClick = () => {
        if (activeSentences.length === 0 || hasInvalidTime || isSaving) return;

        if (deletedSentences.length > 0) {
            setShowDiscardConfirm(true);
        } else {
            executeSave();
        }
    };

    const executeSave = () => {
        setShowDiscardConfirm(false);
        const cleanSentences: ReviewSentence[] = activeSentences.map(s => ({
            text: s.text,
            translation: s.translation,
            startTime: s.startTime,
            endTime: s.endTime,
            lowConfidence: s.lowConfidence,
            needsReview: s.needsReview
        }));
        onSave(cleanSentences, coverChoice);
    };

    const saveDisabled = isSaving || activeSentences.length === 0 || hasInvalidTime;

    const messages = (
        <>
            {notice && (
                <p role="alert" className="flex items-start gap-1.5 text-[13px] font-medium leading-relaxed text-danger">
                    <AlertCircle size={15} className="mt-0.5 shrink-0" aria-hidden="true" />{notice}
                </p>
            )}
            {activeSentences.length === 0 && (
                <p className="text-[13px] font-medium text-danger">至少需保留 1 句才能存檔</p>
            )}
            {hasInvalidTime && (
                <p className="text-[13px] font-medium text-danger">
                    第 {invalidSentenceIndices.join('、')} 句的時間需要修正
                </p>
            )}
        </>
    );

    // 捨棄已刪除句子確認（內嵌式）：手機放在底部動作列、桌機放在標題下，都在使用者剛按下的按鈕附近
    const discardConfirm = showDiscardConfirm && (
        <div className="flex flex-col gap-3 rounded-2xl bg-warn/10 p-4">
            <div className="flex items-start gap-3">
                <AlertCircle className="mt-0.5 shrink-0 text-warn" size={18} aria-hidden="true" />
                <div className="flex flex-col gap-1">
                    <p className="text-sm font-bold text-warn">
                        將永久捨棄 {deletedSentences.length} 句，確定要存檔嗎？
                    </p>
                    <p className="text-[13px] leading-relaxed text-ink">
                        存檔後將只保留當前主列表中的 {activeSentences.length} 句，已刪除的句子將無法復原。
                    </p>
                </div>
            </div>
            <div className="flex justify-end gap-2">
                <Button variant="secondary" size="sm" onClick={() => setShowDiscardConfirm(false)} disabled={isSaving}>
                    返回
                </Button>
                <button
                    type="button"
                    onClick={executeSave}
                    disabled={isSaving}
                    className="min-h-10 rounded-full bg-warn px-4 text-[13px] font-medium text-white transition-[filter,transform] hover:brightness-110 active:scale-[0.98] disabled:opacity-50 dark:text-ground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-warn"
                >
                    確定存檔
                </button>
            </div>
        </div>
    );

    return (
        <div className="flex flex-col gap-5">
            <header className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between lg:gap-10">
                <div className="flex min-w-0 flex-col gap-3">
                    <div className="flex items-center gap-1">
                        {headerStart}
                        <h2 className="text-[22px] font-bold tracking-wide text-ink lg:text-[26px]">校對內容</h2>
                    </div>
                    <p className="text-[13px] leading-relaxed text-muted break-words">
                        檔案：{fileName}（保留 {activeSentences.length} 句{deletedSentences.length > 0 ? `，已刪除 ${deletedSentences.length} 句` : ''}）
                    </p>
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                        <span className="text-[13px] text-muted" aria-hidden="true">封面風格</span>
                        <SegmentedControl
                            label="封面風格"
                            options={COVER_OPTIONS}
                            value={coverChoice}
                            onChange={handleCoverChoiceChange}
                        />
                    </div>
                </div>
                {/* 桌機：動作按鈕在標題右側 */}
                <div className="hidden shrink-0 flex-col items-end gap-2 lg:flex lg:max-w-sm">
                    <div className="flex gap-3">
                        <Button variant="secondary" onClick={onCancel} disabled={isSaving}>取消</Button>
                        <Button onClick={handleSaveClick} disabled={saveDisabled} icon={<Check size={17} aria-hidden="true" />}>確認儲存</Button>
                    </div>
                    <div className="flex flex-col items-end gap-1 text-right">{messages}</div>
                </div>
            </header>

            {status}

            {discardConfirm && <div className="hidden lg:block">{discardConfirm}</div>}

            <audio ref={audioRef} src={audioUrl || undefined} onTimeUpdate={handleTimeUpdate} onEnded={() => setPlayingId(null)} />

            {/* 主列表 */}
            <div className="flex flex-col gap-4">
                {activeSentences.map((s, index) => {
                    const displayIndex = index + 1;
                    const isPlaying = playingId === s.internalId;
                    const isTimeInvalid = s.startTime >= s.endTime;
                    const isLowConfOrReview = !!(s.lowConfidence || s.needsReview);
                    const adjustWarning = timeAdjustWarnings[s.internalId];
                    const fieldId = `${uid}-${s.internalId}`;

                    const timeField = (field: 'startTime' | 'endTime', label: string) => (
                        <div className="flex min-w-0 flex-col gap-1.5">
                            <label htmlFor={`${fieldId}-${field}`} className="text-xs text-muted">{label}</label>
                            <div className={`flex h-11 items-center overflow-hidden rounded-full border bg-surface-2 ${isTimeInvalid ? 'border-danger' : 'border-muted/35'} focus-within:border-accent`}>
                                <button
                                    type="button"
                                    aria-label={`${label} 減 0.5 秒`}
                                    onClick={() => handleAdjustTime(s.internalId, field, -0.5)}
                                    disabled={isSaving}
                                    className="h-full w-11 shrink-0 text-xs text-ink transition-colors hover:bg-line disabled:opacity-50 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent"
                                >
                                    −0.5
                                </button>
                                <input
                                    id={`${fieldId}-${field}`}
                                    type="number"
                                    step="0.01"
                                    inputMode="decimal"
                                    value={s[field]}
                                    onChange={(e) => updateSentence(s.internalId, field, parseFloat(e.target.value) || 0)}
                                    className="h-full min-w-0 flex-1 bg-transparent text-center font-reading text-base text-ink tabular-nums outline-hidden [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                                />
                                <button
                                    type="button"
                                    aria-label={`${label} 加 0.5 秒`}
                                    onClick={() => handleAdjustTime(s.internalId, field, 0.5)}
                                    disabled={isSaving}
                                    className="h-full w-11 shrink-0 text-xs text-ink transition-colors hover:bg-line disabled:opacity-50 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent"
                                >
                                    +0.5
                                </button>
                            </div>
                        </div>
                    );

                    return (
                        <article
                            key={s.internalId}
                            aria-label={`第 ${displayIndex} 句`}
                            className={`flex flex-col gap-3 rounded-2xl border bg-surface px-4 pt-3.5 pb-4 lg:px-5 lg:pb-5 ${
                                isLowConfOrReview ? 'border-warn/50' : 'border-line'
                            }`}
                        >
                            <div className="flex items-center justify-between">
                                <span className="text-[13px] font-bold text-ink">第 {displayIndex} 句</span>
                                <button
                                    type="button"
                                    onClick={() => handleDelete(s.internalId)}
                                    disabled={isSaving}
                                    className="-mr-2 flex min-h-9 items-center gap-1 rounded-full px-2.5 text-[13px] text-muted transition-colors hover:bg-danger/10 hover:text-danger disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-accent"
                                >
                                    <Trash2 size={15} aria-hidden="true" />
                                    刪除
                                </button>
                            </div>

                            {isLowConfOrReview && (
                                <p className="flex items-start gap-2 rounded-xl bg-warn/10 px-3 py-2 text-xs leading-relaxed text-warn">
                                    <AlertCircle size={15} className="mt-px shrink-0" aria-hidden="true" />
                                    此句的斷句或時間可能不準，建議優先核對
                                </p>
                            )}

                            <div className="flex flex-col gap-4 lg:grid lg:grid-cols-[minmax(0,1fr)_288px] lg:gap-6">
                                <div className="flex min-w-0 flex-col gap-3">
                                    <div className="flex flex-col gap-1.5">
                                        <label htmlFor={`${fieldId}-text`} className="text-xs text-muted">
                                            原文 (English)
                                        </label>
                                        <textarea
                                            id={`${fieldId}-text`}
                                            lang="en"
                                            value={s.text}
                                            onChange={(e) => updateSentence(s.internalId, 'text', e.target.value)}
                                            className={`w-full resize-none rounded-xl px-3 py-2.5 font-reading text-[17px] leading-[1.45] ${FIELD}`}
                                            rows={source === 'upload' ? 3 : 2}
                                        />
                                    </div>

                                    {source === 'tts' && (
                                        <div className="flex flex-col gap-1.5">
                                            <label htmlFor={`${fieldId}-translation`} className="text-xs text-muted">
                                                翻譯 (Chinese)
                                            </label>
                                            <textarea
                                                id={`${fieldId}-translation`}
                                                value={s.translation || ''}
                                                onChange={(e) => updateSentence(s.internalId, 'translation', e.target.value)}
                                                className={`w-full resize-none rounded-xl px-3 py-2.5 text-base leading-relaxed ${FIELD}`}
                                                rows={2}
                                            />
                                        </div>
                                    )}

                                    {isTimeInvalid && (
                                        <p className="flex items-center gap-1.5 text-xs font-medium text-danger">
                                            <AlertCircle size={14} aria-hidden="true" /> 開始時間必須小於結束時間
                                        </p>
                                    )}
                                    {adjustWarning && (
                                        <p className="flex items-center gap-1.5 text-xs font-medium text-warn">
                                            <AlertCircle size={14} aria-hidden="true" /> {adjustWarning}
                                        </p>
                                    )}
                                </div>

                                <div className="flex flex-col gap-3">
                                    <div className="grid grid-cols-2 gap-2.5">
                                        {timeField('startTime', '開始 (s)')}
                                        {timeField('endTime', '結束 (s)')}
                                    </div>
                                    <Button
                                        variant="secondary"
                                        size="sm"
                                        fullWidth
                                        aria-pressed={isPlaying}
                                        onClick={() => isPlaying ? handlePause() : handlePlaySegment(s.internalId)}
                                        className={isPlaying ? 'border-accent bg-accent-soft' : ''}
                                        icon={isPlaying ? <Pause size={14} aria-hidden="true" /> : <Play size={14} className="fill-current" aria-hidden="true" />}
                                    >
                                        {isPlaying ? '暫停播放' : '播放片段'}
                                    </Button>
                                </div>
                            </div>
                        </article>
                    );
                })}
            </div>

            {/* 已刪除（N）區塊 */}
            {deletedSentences.length > 0 && (
                <div className="overflow-hidden rounded-2xl border border-line bg-surface-2">
                    <button
                        type="button"
                        aria-expanded={isDeletedExpanded}
                        onClick={() => setIsDeletedExpanded(!isDeletedExpanded)}
                        className="flex min-h-13 w-full items-center justify-between px-4 text-sm text-ink transition-colors hover:bg-line/50 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent"
                    >
                        <span className="flex items-center gap-2">
                            <Trash2 size={16} className="text-muted" aria-hidden="true" />
                            已刪除（{deletedSentences.length}）
                        </span>
                        <ChevronDown size={18} className={`text-muted transition-transform duration-[var(--dur-fast)] ${isDeletedExpanded ? 'rotate-180' : ''}`} aria-hidden="true" />
                    </button>

                    {isDeletedExpanded && (
                        <ul className="flex flex-col divide-y divide-line border-t border-line">
                            {deletedSentences.map((s) => (
                                <li key={s.internalId} className="flex items-start gap-3 px-4 py-3.5">
                                    <div className="min-w-0 flex-1">
                                        <p lang="en" className="font-reading text-base text-muted line-through break-words">
                                            {s.text}
                                        </p>
                                        <p className="mt-1 text-xs text-muted tabular-nums">
                                            時間：{s.startTime}s ~ {s.endTime}s
                                        </p>
                                    </div>
                                    <Button
                                        variant="secondary"
                                        size="sm"
                                        onClick={() => handleRestore(s.internalId)}
                                        disabled={isSaving}
                                        icon={<RotateCcw size={14} aria-hidden="true" />}
                                        className="shrink-0"
                                    >
                                        復原
                                    </Button>
                                </li>
                            ))}
                        </ul>
                    )}
                </div>
            )}

            {/* 手機：動作列固定在匯入頁捲動區底部（App 底部分頁列上方） */}
            <div className="sticky bottom-0 z-10 -mx-5 mt-1 flex flex-col gap-2.5 border-t border-line bg-ground/95 px-5 pt-3 pb-3 backdrop-blur-md sm:-mx-8 sm:px-8 lg:hidden">
                {discardConfirm}
                {messages}
                <div className="grid grid-cols-[1fr_2fr] gap-2.5">
                    <Button variant="secondary" size="lg" onClick={onCancel} disabled={isSaving} className="px-4">取消</Button>
                    <Button size="lg" onClick={handleSaveClick} disabled={saveDisabled} icon={<Check size={17} aria-hidden="true" />} className="px-4">確認儲存</Button>
                </div>
            </div>
        </div>
    );
}
