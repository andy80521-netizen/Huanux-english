import { checkAndUpdateUnlockedGroups } from '../utils/groupUnlock';
import React, { useState, useEffect, useRef } from 'react';
import { LanguagePattern, PatternExampleSentence } from '../types';
import { auth, db, appId } from '../firebase';
import { doc, updateDoc } from 'firebase/firestore';
import { ChevronLeft, Loader2, Send, CheckCircle2, XCircle, Sparkles, Check, Edit3, Play, Plus, RefreshCw } from 'lucide-react';
import PatternPracticeSessionView from './PatternPracticeSessionView';
import { checkSentenceQuality } from '../services/gemini';
import { updatePatternSentences } from '../services/sentenceWrites';
import { generateAndSavePracticePrompts } from '../services/practicePrompts';
import { regenerateAndSaveSeedExamples } from '../services/seedExamples';
import { requestPracticeImages } from '../services/practiceImage';
import ConfirmDialog from './ConfirmDialog';
import Button from './ui/Button';
import IconButton from './ui/IconButton';
import { AlertCircle } from 'lucide-react';

interface Props {
    pattern: LanguagePattern;
    groupIndex: number;
    onBack: () => void;
}

type CheckResult = {
    natural: boolean;
    grammar: boolean;
    spelling: boolean;
    comment: string;
    suggestedRevision?: string;
    suggestedRevisionScope?: 'whole' | 'partial';
    revisionNotes?: string[];
};

export default function LanguageModelPracticeView({ pattern, groupIndex, onBack }: Props) {
    const [inputText, setInputText] = useState('');
    const [isChecking, setIsChecking] = useState(false);
    const [errorMsg, setErrorMsg] = useState<string | null>(null);
    const [checkResult, setCheckResult] = useState<CheckResult | null>(null);
        const [attemptCountForCurrent, setAttemptCountForCurrent] = useState(0);

    const [isPracticing, setIsPracticing] = useState(false);
    const [practiceTargetIndex, setPracticeTargetIndex] = useState(-1);
    const [addingSeed, setAddingSeed] = useState(false);
    const composeAreaRef = useRef<HTMLDivElement>(null);
    const [regeneratingSeeds, setRegeneratingSeeds] = useState(false);
    const [regenerateSeedsError, setRegenerateSeedsError] = useState<string | null>(null);
    const [showRegenerateSeedsConfirm, setShowRegenerateSeedsConfirm] = useState(false);

    // Filter sentences for group 0
    const groupSentences = (pattern.exampleSentences || []).filter(s => s.groupIndex === groupIndex);
    
    // Find the first index (0 to 9) that is NOT checked: true
    let currentIndex = 0;
    for (let i = 0; i < 10; i++) {
        const existing = groupSentences.find(s => s.id === `p_${groupIndex}_${i}`);
        if (!existing || !existing.checked) {
            currentIndex = i;
            break;
        }
        if (i === 9) {
            // all 10 are checked
            currentIndex = 10;
        }
    }

    const isFinished = currentIndex >= 10;
    const [justUnlocked, setJustUnlocked] = useState<number | null>(null);

    useEffect(() => {
        if (isFinished) {
            const newUnlocked = checkAndUpdateUnlockedGroups(pattern);
            const currentUnlocked = pattern.unlockedGroups || 0;
            if (newUnlocked > currentUnlocked) {
                setJustUnlocked(newUnlocked);
                const uid = auth.currentUser?.uid;
                if (uid) {
                    updateDoc(doc(db, `artifacts/${appId}/users/${uid}/languagePatterns`, pattern.id), {
                        unlockedGroups: newUnlocked
                    }).catch(console.error);
                }
            }
        }
    }, [isFinished, pattern]);
    const currentSentenceObj = groupSentences.find(s => s.id === `p_${groupIndex}_${currentIndex}`);

    // Pre-fill input text if user previously failed and we are retrying
    // Also reset states when currentIndex changes
    useEffect(() => {
        setCheckResult(null);
        setErrorMsg(null);
        setAttemptCountForCurrent(currentSentenceObj ? currentSentenceObj.attemptCount : 0);
        // We don't pre-fill inputText here as we don't want to overwrite what user is typing
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [currentIndex]);

        const startPractice = () => {
        const sentences = groupSentences;
        const targetInGroup = sentences.findIndex(s => s.checked && (s.mastery || 0) < 1000);
        if (targetInGroup !== -1) {
            const absoluteIndex = (pattern.exampleSentences || []).findIndex(s => s.id === sentences[targetInGroup].id);
            setPracticeTargetIndex(absoluteIndex);
        } else {
            setPracticeTargetIndex(-1);
        }
        setIsPracticing(true);
    };

    const handleNextPractice = () => {
        const groupSentences = (pattern.exampleSentences || []).filter(s => s.groupIndex === groupIndex);
        const uncompletedInGroup = groupSentences.filter(s => s.checked && (s.mastery || 0) < 1000);
        if (uncompletedInGroup.length === 0) {
            setIsPracticing(false);
            setPracticeTargetIndex(-1);
            return;
        }
        
        const currentAbsolute = (pattern.exampleSentences || [])[practiceTargetIndex];
        let nextInGroupIndex = groupSentences.findIndex(s => s.id === currentAbsolute?.id) + 1;
        
        let targetAbsolute = -1;
        for (let i = 0; i < groupSentences.length; i++) {
            const idx = (nextInGroupIndex + i) % groupSentences.length;
            const s = groupSentences[idx];
            if (s.checked && (s.mastery || 0) < 1000) {
                targetAbsolute = (pattern.exampleSentences || []).findIndex(x => x.id === s.id);
                break;
            }
        }
        
        if (targetAbsolute === -1 || targetAbsolute === practiceTargetIndex) {
            setIsPracticing(false);
            setPracticeTargetIndex(-1);
        } else {
            setPracticeTargetIndex(targetAbsolute);
        }
    };
    
    if (isPracticing) {
        if (practiceTargetIndex === -1) {
            return (
                <div className="flex h-full flex-col items-center justify-center gap-5 overflow-y-auto px-7 py-10 text-center">
                    <CheckCircle2 size={44} className="text-gold" aria-hidden="true" />
                    <h3 className="text-2xl font-bold text-ink">本組10句已全部精熟</h3>
                    <Button variant="secondary" onClick={() => setIsPracticing(false)}>返回</Button>
                </div>
            );
        }
        
        const isLast = (pattern.exampleSentences || []).filter(s => s.groupIndex === groupIndex && s.checked && (s.mastery || 0) < 1000).length <= 1;
        return (
            <PatternPracticeSessionView groupIndex={groupIndex}
                pattern={pattern}
                sentenceIndex={practiceTargetIndex}
                onBack={() => setIsPracticing(false)}
                onNext={isLast ? () => setIsPracticing(false) : handleNextPractice}
                isLastSentence={isLast}
            />
        );
    }

    const handleCheck = async () => {
        const trimmed = inputText.trim();
        if (!trimmed) return;

        setIsChecking(true);
        setErrorMsg(null);
        setCheckResult(null);

        try {
            const result = await checkSentenceQuality(pattern.text, trimmed);
            setCheckResult(result);
            setAttemptCountForCurrent(prev => prev + 1);
        } catch (err: any) {
            console.error(err);
            setErrorMsg(err.message || '檢查失敗，請稍後再試');
        } finally {
            setIsChecking(false);
        }
    };

    const generatePromptsInBackground = (docRef: any, sentenceId: string, sentenceText: string, uid: string) => {
        void requestPracticeImages(pattern.id, [sentenceId]);
        (async () => {
            try {
                await generateAndSavePracticePrompts(pattern.id, sentenceId, sentenceText, pattern.text);
                console.log("背景出題內容生成並儲存完成");
            } catch (bgErr) {
                console.error("背景生成出題內容失敗:", bgErr);
            }
        })();
    };

    const handleConfirmSubmit = async () => {
        if (!checkResult) return;
        
        const trimmed = inputText.trim();
        if (!trimmed) return;

        const uid = auth.currentUser?.uid;
        if (!uid) return;

        const isAllPassed = checkResult.natural && checkResult.grammar && checkResult.spelling;
        if (!isAllPassed) return; // Should not happen via UI, but just in case

        try {
            const sentenceId = `p_${groupIndex}_${currentIndex}`;
            const newSentenceObj: PatternExampleSentence = {
                id: sentenceId,
                text: trimmed,
                checked: true,
                checkFeedback: {
                    natural: checkResult.natural,
                    grammar: checkResult.grammar,
                    spelling: checkResult.spelling,
                    comment: checkResult.comment || '',
                    // 句子已經很好時 AI 不會給建議，沒有建議就不寫這兩個欄位
                    ...(checkResult.suggestedRevision ? { suggestedRevision: checkResult.suggestedRevision } : {}),
                    ...(checkResult.suggestedRevision && checkResult.suggestedRevisionScope ? { suggestedRevisionScope: checkResult.suggestedRevisionScope } : {}),
                    ...(checkResult.suggestedRevision && checkResult.revisionNotes && checkResult.revisionNotes.length > 0 ? { revisionNotes: checkResult.revisionNotes } : {})
                },
                groupIndex,
                mastery: 0,
                attemptCount: attemptCountForCurrent,
            };

            await updatePatternSentences(pattern.id, (sentences) => {
                const i = sentences.findIndex(s => s.id === sentenceId);
                if (i >= 0) sentences[i] = newSentenceObj; else sentences.push(newSentenceObj);
                return sentences;
            });

            const docRef = doc(db, `artifacts/${appId}/users/${uid}/languagePatterns`, pattern.id);
            setInputText('');
            setCheckResult(null);

            generatePromptsInBackground(docRef, sentenceId, trimmed, uid);

        } catch (err: any) {
            console.error(err);
            setErrorMsg(err.message || '存檔失敗，請稍後再試');
        }
    };

    const handleAddSeed = async (ex: { en: string; zh: string }) => {
        if (isFinished || addingSeed || isChecking || regeneratingSeeds) return;
        const uid = auth.currentUser?.uid;
        if (!uid) return;

        setAddingSeed(true);
        setErrorMsg(null);
        setCheckResult(null);

        try {
            const text = ex.en.trim();

            // 示範例句也要經過造句檢查：完全通過且沒有建議才直接加入；
            // 否則帶入輸入框並顯示檢查結果，由使用者決定（採用建議或確認送出）
            const result = await checkSentenceQuality(pattern.text, text);
            const passed = result.natural && result.grammar && result.spelling;
            if (!passed || result.suggestedRevision) {
                setInputText(text);
                setCheckResult(result);
                setAttemptCountForCurrent(prev => prev + 1);
                composeAreaRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                return;
            }

            const sentenceId = `p_${groupIndex}_${currentIndex}`;

            const newSentenceObj: PatternExampleSentence = {
                id: sentenceId,
                text,
                checked: true,
                checkFeedback: {
                    natural: true,
                    grammar: true,
                    spelling: true,
                    comment: result.comment || '來自示範例句（已通過檢查）'
                },
                groupIndex,
                mastery: 0,
                attemptCount: 0
            };

            await updatePatternSentences(pattern.id, (sentences) => {
                const i = sentences.findIndex(s => s.id === sentenceId);
                if (i >= 0) sentences[i] = newSentenceObj; else sentences.push(newSentenceObj);
                return sentences;
            });

            const docRef = doc(db, `artifacts/${appId}/users/${uid}/languagePatterns`, pattern.id);
            generatePromptsInBackground(docRef, sentenceId, text, uid);
        } catch (err: any) {
            console.error(err);
            setErrorMsg(err.message || '加入失敗，請稍後再試');
        } finally {
            setAddingSeed(false);
        }
    };

    const doRegenerateSeeds = async () => {
        if (regeneratingSeeds) return;
        setShowRegenerateSeedsConfirm(false);
        setRegeneratingSeeds(true);
        setRegenerateSeedsError(null);
        try {
            await regenerateAndSaveSeedExamples(pattern);
        } catch (err: any) {
            console.error('重新產生例句失敗:', err);
            setRegenerateSeedsError(err.message || '重新產生失敗，請稍後再試');
        } finally {
            setRegeneratingSeeds(false);
        }
    };

    const handleRegenerateSeedsClick = () => {
        if (pattern.seedExamples && pattern.seedExamples.length > 0) {
            setShowRegenerateSeedsConfirm(true);
        } else {
            doRegenerateSeeds();
        }
    };

    const handleUseSuggestion = () => {
        if (checkResult?.suggestedRevision) {
            setInputText(checkResult.suggestedRevision);
            setCheckResult(null);
        }
    };

    // When text changes, we might want to clear the check result so they have to check again
    const handleTextChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
        setInputText(e.target.value);
        if (checkResult) {
            setCheckResult(null);
        }
    };

    const isAllPassed = !!checkResult && checkResult.natural && checkResult.grammar && checkResult.spelling;
    const checkTag = (ok: boolean, label: string) => (
        <span className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${ok ? 'bg-accent-soft text-ink' : 'bg-danger/10 text-danger'}`}>
            {ok ? <Check size={12} strokeWidth={3} aria-hidden="true" /> : <XCircle size={12} aria-hidden="true" />}
            {label}
            <span className="sr-only">{ok ? '（通過）' : '（未通過）'}</span>
        </span>
    );
    const errorBox = (text: string) => (
        <div role="alert" className="flex items-start gap-3 rounded-xl bg-danger/10 px-4 py-3 text-sm text-danger">
            <AlertCircle size={18} className="mt-0.5 shrink-0" aria-hidden="true" />
            <span className="font-medium leading-relaxed break-words">{text}</span>
        </div>
    );

    return (
        <div className="h-full overflow-y-auto pb-12">
            <header className="flex items-center gap-2 px-2 pt-2 sm:px-5 lg:px-9 lg:pt-6">
                <IconButton aria-label="返回" onClick={onBack} disabled={isChecking}>
                    <ChevronLeft size={22} aria-hidden="true" />
                </IconButton>
                <div className="min-w-0 flex-1">
                    <h2 className="truncate text-[15px] font-medium tracking-wide text-ink">造句練習</h2>
                    {!isFinished && (
                        <p className="text-[13px] text-muted">第 {groupIndex + 1} 組・第 {currentIndex + 1}/10 句</p>
                    )}
                </div>
            </header>
            {!isFinished && (
                <div aria-hidden="true" className="mx-6 mt-3.5 grid grid-cols-10 gap-1 sm:mx-8 lg:mx-12">
                    {Array.from({ length: 10 }, (_, i) => {
                        const made = groupSentences.some(s => s.id === `p_${groupIndex}_${i}` && s.checked);
                        return <span key={i} className={`h-1 rounded-full ${made ? 'bg-accent' : i === currentIndex ? 'bg-muted/70' : 'bg-line'}`} />;
                    })}
                </div>
            )}

            <div className="mx-auto flex w-full max-w-[720px] flex-col gap-7 px-6 pt-7 sm:px-10 lg:pt-10">
                <section className="flex flex-col gap-1.5">
                    <span className="text-xs text-muted">目標句型</span>
                    <p lang="en" className="font-reading text-[28px] leading-tight text-ink break-words lg:text-[34px]">{pattern.text}</p>
                    <p className="text-[15px] text-ink">{pattern.meaningZh}</p>
                </section>

                {isFinished ? (
                    <section className="flex flex-col items-center gap-4 rounded-[20px] border border-line bg-surface px-6 py-10 text-center">
                        <CheckCircle2 size={44} className="text-accent" aria-hidden="true" />
                        <h3 className="text-[22px] font-bold text-ink">
                            恭喜完成第 {groupIndex + 1} 組 10 句造句！
                        </h3>
                        <p className="max-w-md text-sm leading-relaxed text-muted">
                            您已經完成了這個句型的基本練習，現在可以開始念出來練習了。
                        </p>
                        {justUnlocked !== null && (
                            <div className="rounded-full bg-gold/12 px-4 py-2 text-sm font-bold text-gold animate-rise-in">
                                已解鎖第 {justUnlocked + 1} 組！
                            </div>
                        )}
                        <Button size="lg" onClick={startPractice} icon={<Play size={18} aria-hidden="true" />} className="mt-2">
                            開始練習
                        </Button>
                    </section>
                ) : (
                    <>
                        <div ref={composeAreaRef} className="flex scroll-mt-4 flex-col gap-5">
                            <label className="flex flex-col gap-2">
                                <span className="text-sm font-medium text-ink">請用目標句型造一個英文句子：</span>
                                <textarea
                                    lang="en"
                                    value={inputText}
                                    onChange={handleTextChange}
                                    placeholder="Type your sentence here..."
                                    className="min-h-32 w-full resize-none rounded-2xl border border-muted/35 bg-surface px-4 py-3 font-reading text-[19px] leading-[1.45] text-ink placeholder:text-muted transition-colors focus-visible:border-accent focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-accent disabled:opacity-60"
                                    disabled={isChecking}
                                />
                            </label>

                            {errorMsg && errorBox(errorMsg)}

                            {checkResult && (
                                <section aria-live="polite" className="flex flex-col gap-3.5 rounded-[18px] border border-line bg-surface p-[18px]">
                                    <div className="flex flex-wrap items-center justify-between gap-2">
                                        <h4 className={`text-[15px] font-bold ${isAllPassed ? 'text-ink' : 'text-danger'}`}>
                                            {isAllPassed ? '檢查通過：' : '未通過檢查：'}
                                        </h4>
                                        <span className="flex flex-wrap gap-1.5">
                                            {checkTag(checkResult.natural, '自然道地')}
                                            {checkTag(checkResult.grammar, '文法正確')}
                                            {checkTag(checkResult.spelling, '拼字正確')}
                                        </span>
                                    </div>

                                    <p className="text-sm leading-relaxed text-ink">{checkResult.comment}</p>

                                    {checkResult.suggestedRevision && (
                                        <div className="flex flex-col gap-1.5 border-t border-line pt-3">
                                            <p className="text-xs text-muted">
                                                建議優化說法 {checkResult.suggestedRevisionScope === 'partial' ? '(部分調整)' : '(整句重寫)'}：
                                            </p>
                                            <p lang="en" className="font-reading text-lg italic leading-snug text-ink break-words">
                                                "{checkResult.suggestedRevision}"
                                            </p>
                                            {checkResult.revisionNotes && checkResult.revisionNotes.length > 0 && (
                                                <ul className="flex flex-col gap-1">
                                                    {checkResult.revisionNotes.map((note, i) => (
                                                        <li key={i} className="flex gap-1.5 text-xs leading-relaxed text-muted">
                                                            <span className="shrink-0" aria-hidden="true">•</span>
                                                            <span>{note}</span>
                                                        </li>
                                                    ))}
                                                </ul>
                                            )}
                                        </div>
                                    )}

                                    {(checkResult.suggestedRevision || isAllPassed) && (
                                        <div className="mt-1 grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                                            {checkResult.suggestedRevision && (
                                                <Button variant="secondary" onClick={handleUseSuggestion} icon={<Edit3 size={16} aria-hidden="true" />}>
                                                    使用建議優化說法
                                                </Button>
                                            )}
                                            {isAllPassed && (
                                                <Button onClick={handleConfirmSubmit} icon={<Check size={16} aria-hidden="true" />} className={checkResult.suggestedRevision ? '' : 'sm:col-span-2'}>
                                                    確認送出, 完成這句
                                                </Button>
                                            )}
                                        </div>
                                    )}
                                </section>
                            )}

                            {!checkResult && (
                                <Button
                                    size="lg"
                                    fullWidth
                                    onClick={handleCheck}
                                    disabled={!inputText.trim() || isChecking}
                                    icon={isChecking ? <Loader2 size={18} className="animate-spin" aria-hidden="true" /> : <Send size={18} aria-hidden="true" />}
                                >
                                    {isChecking ? '檢查中...' : '送出檢查'}
                                </Button>
                            )}
                        </div>

                        <section className="flex flex-col gap-1">
                            <div className="flex items-center justify-between gap-2 pb-2">
                                <div className="flex flex-col gap-0.5">
                                    <h3 className="text-[15px] font-bold text-ink">從示範例句加入</h3>
                                    <span className="text-xs text-muted">加入前會先檢查</span>
                                </div>
                                <Button
                                    variant="secondary"
                                    size="sm"
                                    onClick={handleRegenerateSeedsClick}
                                    disabled={regeneratingSeeds || addingSeed || isChecking}
                                    icon={regeneratingSeeds ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : <RefreshCw size={14} aria-hidden="true" />}
                                >
                                    {regeneratingSeeds ? '產生中…' : '重新產生'}
                                </Button>
                            </div>

                            {regenerateSeedsError && <div className="pb-2">{errorBox(regenerateSeedsError)}</div>}

                            {pattern.seedExamples && pattern.seedExamples.length > 0 ? (
                                <ul className="flex flex-col">
                                    {pattern.seedExamples.map((ex, idx) => {
                                        const isAdded = (pattern.exampleSentences || []).some(
                                            s => s.text.trim().toLowerCase() === ex.en.trim().toLowerCase()
                                        );
                                        return (
                                            <li key={idx} className="flex items-center gap-3 border-t border-line py-3">
                                                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                                                    <p lang="en" className="font-reading text-[17px] leading-snug text-ink break-words">{ex.en}</p>
                                                    <p className="text-xs text-muted">{ex.zh}</p>
                                                </div>
                                                {isAdded ? (
                                                    <span className="flex min-h-9 shrink-0 items-center gap-1 rounded-full bg-surface-2 px-3 text-xs text-muted">
                                                        <Check size={14} aria-hidden="true" />
                                                        已加入
                                                    </span>
                                                ) : (
                                                    <button
                                                        type="button"
                                                        onClick={() => handleAddSeed(ex)}
                                                        disabled={addingSeed || isChecking || regeneratingSeeds}
                                                        className="flex min-h-9 shrink-0 items-center gap-1 rounded-full bg-accent-soft px-3.5 text-xs text-ink transition-[filter] hover:brightness-[0.97] disabled:opacity-50 dark:hover:brightness-110 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                                                    >
                                                        {addingSeed ? (
                                                            <><Loader2 size={14} className="animate-spin" aria-hidden="true" />檢查中</>
                                                        ) : (
                                                            <><Plus size={14} aria-hidden="true" />加入</>
                                                        )}
                                                    </button>
                                                )}
                                            </li>
                                        );
                                    })}
                                </ul>
                            ) : (
                                <p className="py-4 text-center text-sm text-muted">目前沒有示範例句，可以按「重新產生」建立</p>
                            )}
                        </section>
                    </>
                )}
            </div>

            <ConfirmDialog
                isOpen={showRegenerateSeedsConfirm}
                title="重新產生例句？"
                message={`目前的 ${pattern.seedExamples?.length || 0} 句示範例句會被新的取代。\n已經加入造句的句子不受影響。`}
                confirmText="重新產生"
                cancelText="取消"
                onConfirm={doRegenerateSeeds}
                onCancel={() => setShowRegenerateSeedsConfirm(false)}
            />
        </div>
    );
}
