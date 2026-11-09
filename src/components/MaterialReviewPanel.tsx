import React, { useState, useRef, useEffect, useId } from 'react';
import { watchSegmentEnd, seekSegmentStart, guardSegmentStart, SegmentEndWatch } from '../utils/segmentEnd';
import { Play, Pause, Check, AlertCircle, Trash2, RotateCcw, ChevronDown, Merge, Scissors, Ear, Loader2 } from 'lucide-react';
import TimeStepperField from './ui/TimeStepperField';
import { adjustTime, tailRange, mergeWithPrevious, splitSentenceAt } from '../utils/timeEdit';
import SegmentedControl from './ui/SegmentedControl';
import Button from './ui/Button';

import { MaterialSentence, CoverStyle } from '../types';

export type ReviewSentence = Pick<MaterialSentence, 'text' | 'translation' | 'startTime' | 'endTime' | 'lowConfidence' | 'needsReview'>;

export interface MaterialReviewPanelProps {
    source: 'upload' | 'tts';
    audioFile?: File;
    audioBlob?: Blob;
    /** 沒有本機檔案時（從背景存檔「回到校對」）改播 Storage 上的音檔 */
    remoteAudioUrl?: string;
    /** 回到校對時沿用上次選的封面風格 */
    initialCoverChoice?: CoverStyle | 'none';
    fileName: string;
    initialSentences: ReviewSentence[];
    isSaving?: boolean;
    /** 存檔中按鈕顯示的文字（例如「翻譯中 12/35…」）；null＝沒有在存檔 */
    savingLabel?: string | null;
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
    /** 拆句後翻譯已清空，文字轉語音教材要補上翻譯才能存檔（Codex） */
    needsTranslation?: boolean;
};

export default function MaterialReviewPanel({
    source,
    audioFile,
    audioBlob,
    remoteAudioUrl,
    initialCoverChoice,
    fileName,
    initialSentences,
    isSaving = false,
    savingLabel = null,
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
        if (initialCoverChoice) return initialCoverChoice;
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
        if (remoteAudioUrl) setAudioUrl(remoteAudioUrl);
    }, [audioFile, audioBlob, remoteAudioUrl]);

    // 準時停在句尾（docs/plans/import-timestamp-accuracy.md PR-A）：校對時聽到的句尾要和練習時一致
    const segWatchRef = useRef<SegmentEndWatch | null>(null);
    const sentencesRef = useRef(sentences);
    sentencesRef.current = sentences;
    // 播放中修改了句尾 → 依新句尾重新排程（縮短時才不會多播，Codex 第 2 輪）
    useEffect(() => { segWatchRef.current?.refresh(); }, [sentences]);
    // 確認真的從起點播（iPhone 長教材會跳不過去，docs/plans/ios-seek-fix.md）
    const startGuardRef = useRef<(() => void) | null>(null);
    const [playbackError, setPlaybackError] = useState<string | null>(null);
    const stopSegWatch = () => {
        segWatchRef.current?.(); segWatchRef.current = null;
        startGuardRef.current?.(); startGuardRef.current = null;
    };
    useEffect(() => stopSegWatch, []);

    /** 播放一段範圍（聽句尾用，key＝`${id}:tail`）；終點可傳函式讀最新值 */
    const playRange = (key: string, start: number, end: number | (() => number)) => {
        const el = audioRef.current;
        if (!el) return;
        stopSegWatch();
        setPlaybackError(null);
        seekSegmentStart(el, start);
        el.play()?.catch?.(() => setPlayingId(null));
        startGuardRef.current = guardSegmentStart(el, start, (diag) => {
            stopSegWatch();
            setPlayingId(null);
            setPlaybackError(`音檔沒辦法跳到這一句的開頭，請截圖回報：${diag}`);
        });
        setPlayingId(key);
        segWatchRef.current = watchSegmentEnd(el, end, () => {
            segWatchRef.current = null;
            setPlayingId(null);
        });
    };

    const handlePlaySegment = (id: string) => {
        const sentence = sentences.find(s => s.internalId === id);
        const el = audioRef.current;
        if (!sentence || !el) return;
        stopSegWatch();
        setPlaybackError(null);
        seekSegmentStart(el, sentence.startTime);
        el.play()?.catch?.(() => setPlayingId(null));
        startGuardRef.current = guardSegmentStart(el, sentence.startTime, (diag) => {
            stopSegWatch();
            setPlayingId(null);
            setPlaybackError(`音檔沒辦法跳到這一句的開頭，請截圖回報：${diag}`);
        });
        setPlayingId(id);
        if (sentence.endTime > 0) {
            // 讀最新的句尾：播放中修改結束時間，這次試聽就照新的句尾停（Codex）
            const endNow = () => sentencesRef.current.find(x => x.internalId === id)?.endTime ?? sentence.endTime;
            segWatchRef.current = watchSegmentEnd(el, endNow, () => {
                segWatchRef.current = null;
                setPlayingId(null);
            });
        }
    };

    /** 聽句尾：句尾前 1.5 秒播到句尾後 0.5 秒，確認有沒有切掉最後一個字、或吃到下一句 */
    const handlePlayTail = (id: string) => {
        const sentence = sentences.find(s => s.internalId === id);
        if (!sentence || !(sentence.endTime > 0)) return;
        const r = tailRange(sentence.endTime);
        // 播放中微調結束時間 → 停止點跟著新的句尾（Gemini）
        const tailEndNow = () => tailRange(sentencesRef.current.find(x => x.internalId === id)?.endTime ?? sentence.endTime).end;
        playRange(`${id}:tail`, r.start, tailEndNow);
    };

    // 保險：主要由 watchSegmentEnd 準時停止（聽句尾只靠監看，句子 id 對不上這裡不處理）
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
        stopSegWatch();
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

    const clearWarning = (id: string) => setTimeAdjustWarnings(prev => {
        if (!prev[id]) return prev;
        const updated = { ...prev };
        delete updated[id];
        return updated;
    });

    const handleAdjustTime = (id: string, field: 'startTime' | 'endTime', delta: number) => {
        const sentence = sentences.find(s => s.internalId === id);
        if (!sentence) return;
        const r = adjustTime(sentence, field, delta);
        if ('warning' in r) {
            const warning = r.warning;
            setTimeAdjustWarnings(prev => ({ ...prev, [id]: warning }));
            return;
        }
        clearWarning(id);
        setSentences(prev => prev.map(s => s.internalId === id ? { ...s, startTime: r.startTime, endTime: r.endTime } : s));
    };

    /** 合併到上一句（上一句＝前一個沒刪除的句子） */
    const handleMergeWithPrevious = (id: string) => {
        if (playingId) handlePause();
        setSentences(prev => {
            const idx = prev.findIndex(s => s.internalId === id);
            let p = idx - 1;
            while (p >= 0 && prev[p].deleted) p--;
            if (idx < 0 || p < 0) return prev;
            // 任一片段是拆句後還沒補翻譯的 → 合併後翻譯清空、仍需補齊（避免只剩一半的中文被存下，Codex）
            const pending = (x: InternalReviewSentence) => !!x.needsTranslation && !(x.translation || '').trim();
            const base = mergeWithPrevious(prev[p], prev[idx]);
            const merged = pending(prev[p]) || pending(prev[idx])
                ? { ...base, translation: '', needsTranslation: true }
                : { ...base, needsTranslation: undefined };
            return prev.filter((_, i) => i !== idx).map(s => (s.internalId === prev[p].internalId ? merged : s));
        });
        clearWarning(id);
    };

    const splitCounter = useRef(0);
    /** 拆成兩句：以原文欄位的游標位置拆開 */
    const handleSplit = (id: string, textareaId: string) => {
        const sentence = sentences.find(s => s.internalId === id);
        const el = document.getElementById(textareaId) as HTMLTextAreaElement | null;
        if (!sentence || !el) return;
        const parts = splitSentenceAt(sentence, el.selectionStart ?? 0);
        if (!parts) {
            setTimeAdjustWarnings(prev => ({ ...prev, [id]: '請先在原文中點一下要拆開的位置（不能在開頭或結尾）' }));
            return;
        }
        if (playingId) handlePause();
        clearWarning(id);
        const newId = `rev_split_${++splitCounter.current}`;
        const needsTranslation = source === 'tts' || undefined;
        setSentences(prev => prev.flatMap(s => s.internalId === id
            ? [{ ...parts[0], internalId: id, needsTranslation }, { ...parts[1], internalId: newId, deleted: false, needsTranslation }]
            : [s]));
    };

    const activeSentences = sentences.filter(s => !s.deleted);
    const deletedSentences = sentences.filter(s => s.deleted);

    const invalidSentenceIndices = activeSentences
        .map((s, idx) => (s.startTime >= s.endTime ? idx + 1 : null))
        .filter((idx): idx is number => idx !== null);
    const hasInvalidTime = invalidSentenceIndices.length > 0;
    // 拆句後還沒補翻譯的句子（只有文字轉語音教材在校對畫面輸入翻譯）
    const missingTranslationIndices = source === 'tts'
        ? activeSentences.map((s, idx) => (s.needsTranslation && !(s.translation || '').trim() ? idx + 1 : null)).filter((i): i is number => i !== null)
        : [];
    const hasMissingTranslation = missingTranslationIndices.length > 0;

    const handleSaveClick = () => {
        if (activeSentences.length === 0 || hasInvalidTime || hasMissingTranslation || isSaving) return;

        if (deletedSentences.length > 0) {
            setShowDiscardConfirm(true);
        } else {
            executeSave();
        }
    };

    const executeSave = () => {
        setShowDiscardConfirm(false);
        // 確認區開著時仍可編輯（例如拆句），最後一關再檢查一次（Codex）
        if (activeSentences.length === 0 || hasInvalidTime || hasMissingTranslation) return;
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

    const saveDisabled = isSaving || activeSentences.length === 0 || hasInvalidTime || hasMissingTranslation;

    const messages = (
        <>
            {playbackError && (
                <p role="alert" className="flex items-start gap-1.5 text-[13px] font-medium leading-relaxed text-danger break-words">
                    <AlertCircle size={15} className="mt-[0.125rem] shrink-0" aria-hidden="true" />{playbackError}
                </p>
            )}
            {notice && (
                <p role="alert" className="flex items-start gap-1.5 text-[13px] font-medium leading-relaxed text-danger">
                    <AlertCircle size={15} className="mt-[0.125rem] shrink-0" aria-hidden="true" />{notice}
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
            {hasMissingTranslation && (
                <p className="text-[13px] font-medium text-danger">
                    第 {missingTranslationIndices.join('、')} 句拆開後要補上翻譯
                </p>
            )}
        </>
    );

    // 捨棄已刪除句子確認（內嵌式）：手機放在底部動作列、桌機放在標題下，都在使用者剛按下的按鈕附近
    const discardConfirm = showDiscardConfirm && (
        <div className="flex flex-col gap-3 rounded-2xl bg-warn/10 p-4">
            <div className="flex items-start gap-3">
                <AlertCircle className="mt-[0.125rem] shrink-0 text-warn" size={18} aria-hidden="true" />
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
                        <Button onClick={handleSaveClick} disabled={saveDisabled} aria-live="polite" icon={savingLabel ? <Loader2 size={17} className="animate-spin" aria-hidden="true" /> : <Check size={17} aria-hidden="true" />}>{savingLabel ?? '確認儲存'}</Button>
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
                        <TimeStepperField
                            id={`${fieldId}-${field}`}
                            label={label}
                            value={s[field]}
                            invalid={isTimeInvalid}
                            disabled={isSaving}
                            onChange={(v) => updateSentence(s.internalId, field, v)}
                            onStep={(d) => handleAdjustTime(s.internalId, field, d)}
                        />
                    );
                    const isTailPlaying = playingId === `${s.internalId}:tail`;

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
                                    <div className="grid grid-cols-2 gap-2.5">
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
                                        <Button
                                            variant="secondary"
                                            size="sm"
                                            fullWidth
                                            aria-pressed={isTailPlaying}
                                            onClick={() => isTailPlaying ? handlePause() : handlePlayTail(s.internalId)}
                                            className={isTailPlaying ? 'border-accent bg-accent-soft' : ''}
                                            title="從句尾前 1.5 秒播到句尾後 0.5 秒"
                                            icon={isTailPlaying ? <Pause size={14} aria-hidden="true" /> : <Ear size={14} aria-hidden="true" />}
                                        >
                                            {isTailPlaying ? '暫停播放' : '聽句尾'}
                                        </Button>
                                    </div>
                                    <div className="grid grid-cols-2 gap-2.5">
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            fullWidth
                                            onClick={() => handleMergeWithPrevious(s.internalId)}
                                            disabled={isSaving || index === 0}
                                            title={index === 0 ? '第一句沒有上一句' : '把這句接到上一句後面'}
                                            icon={<Merge size={14} aria-hidden="true" />}
                                        >
                                            合併到上一句
                                        </Button>
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            fullWidth
                                            onClick={() => handleSplit(s.internalId, `${fieldId}-text`)}
                                            disabled={isSaving}
                                            title="先在原文中點一下要拆開的位置"
                                            icon={<Scissors size={14} aria-hidden="true" />}
                                        >
                                            拆成兩句
                                        </Button>
                                    </div>
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
                    <Button size="lg" onClick={handleSaveClick} disabled={saveDisabled} aria-live="polite" icon={savingLabel ? <Loader2 size={17} className="animate-spin" aria-hidden="true" /> : <Check size={17} aria-hidden="true" />} className="px-4">{savingLabel ?? '確認儲存'}</Button>
                </div>
            </div>
        </div>
    );
}
