import { checkAndUpdateUnlockedGroups } from '../utils/groupUnlock';
import React, { useState, useEffect } from 'react';
import { LanguagePattern, PatternExampleSentence } from '../types';
import { auth, db, appId } from '../firebase';
import { doc, updateDoc, getDoc } from 'firebase/firestore';
import { ChevronLeft, Loader2, Send, CheckCircle2, XCircle, Sparkles, Check, Edit3, Play } from 'lucide-react';
import PatternPracticeSessionView from './PatternPracticeSessionView';
import { checkSentenceQuality, generatePracticePrompts, generatePracticeImage } from '../services/gemini';

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
};

export default function LanguageModelPracticeView({ pattern, groupIndex, onBack }: Props) {
    const [inputText, setInputText] = useState('');
    const [isChecking, setIsChecking] = useState(false);
    const [errorMsg, setErrorMsg] = useState<string | null>(null);
    const [checkResult, setCheckResult] = useState<CheckResult | null>(null);
        const [attemptCountForCurrent, setAttemptCountForCurrent] = useState(0);

    const [isPracticing, setIsPracticing] = useState(false);
    const [practiceTargetIndex, setPracticeTargetIndex] = useState(-1);

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
                <div className="flex flex-col h-full bg-slate-50 dark:bg-slate-950 p-6 overflow-y-auto">
                    <div className="bg-white dark:bg-slate-900 rounded-2xl p-8 shadow-sm border border-slate-200 dark:border-slate-800 flex flex-col items-center text-center mt-20">
                        <div className="w-16 h-16 bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400 rounded-full flex items-center justify-center mb-4">
                            <CheckCircle2 size={32} />
                        </div>
                        <h3 className="text-2xl font-black text-slate-800 dark:text-white mb-2">本組10句已全部精熟</h3>
                        <button onClick={() => setIsPracticing(false)} className="mt-6 px-6 py-3 bg-indigo-600 text-white rounded-xl font-bold">返回</button>
                    </div>
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
            const updatedSentences = [...(pattern.exampleSentences || [])];
            const existingIndex = updatedSentences.findIndex(s => s.id === sentenceId);
            
            const newSentenceObj: PatternExampleSentence = {
                id: sentenceId,
                text: trimmed,
                checked: true,
                checkFeedback: {
                    natural: checkResult.natural,
                    grammar: checkResult.grammar,
                    spelling: checkResult.spelling,
                    comment: checkResult.comment,
                    suggestedRevision: checkResult.suggestedRevision,
                    suggestedRevisionScope: checkResult.suggestedRevisionScope
                },
                groupIndex,
                mastery: 0,
                attemptCount: attemptCountForCurrent,
            };

            if (existingIndex >= 0) {
                updatedSentences[existingIndex] = newSentenceObj;
            } else {
                updatedSentences.push(newSentenceObj);
            }

            const docRef = doc(db, `artifacts/${appId}/users/${uid}/languagePatterns`, pattern.id);
            await updateDoc(docRef, {
                exampleSentences: updatedSentences
            });

            setInputText('');
            setCheckResult(null);

            // 背景非同步生成出題內容，不阻塞畫面
            (async () => {
                try {
                    console.log("開始背景生成出題提示...");
                    const prompts = await generatePracticePrompts(trimmed, pattern.text);
                    
                    let imageUrl = '';
                    try {
                        console.log("開始背景生成情境圖片...");
                        imageUrl = await generatePracticeImage(trimmed, uid);
                    } catch (imgErr) {
                        console.error("背景圖片生成失敗 (可能因免費額度限制):", imgErr);
                    }

                    // 重新取得最新文件以避免 race condition
                    const snap = await getDoc(docRef);
                    if (snap.exists()) {
                        const data = snap.data();
                        const latestSentences: PatternExampleSentence[] = data.exampleSentences || [];
                        const targetIndex = latestSentences.findIndex(s => s.id === sentenceId);
                        
                        if (targetIndex >= 0) {
                            latestSentences[targetIndex] = {
                                ...latestSentences[targetIndex],
                                qaQuestion: prompts.qaQuestion,
                                situationalPrompt: prompts.situationalPrompt,
                                ...(imageUrl ? { imageUrl } : {})
                            };
                            
                            await updateDoc(docRef, {
                                exampleSentences: latestSentences
                            });
                            console.log("背景出題內容生成並儲存完成");
                        }
                    }

                } catch (bgErr) {
                    console.error("背景生成出題內容失敗:", bgErr);
                }
            })();

        } catch (err: any) {
            console.error(err);
            setErrorMsg(err.message || '存檔失敗，請稍後再試');
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

    return (
        <div className="flex flex-col h-full bg-slate-50 dark:bg-slate-950 p-6 overflow-y-auto pb-20">
            <div className="flex items-center gap-4 mb-8">
                <button 
                    onClick={onBack}
                    className="p-2 bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 rounded-full shadow-sm hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                    disabled={isChecking}
                >
                    <ChevronLeft size={24} />
                </button>
                <div className="flex-1">
                    <h2 className="text-xl font-black text-slate-800 dark:text-white line-clamp-1">
                        造句練習
                    </h2>
                    {!isFinished && (
                        <p className="text-sm font-bold text-slate-500 dark:text-slate-400">
                            第 {currentIndex + 1}/10 句
                        </p>
                    )}
                </div>
            </div>

            <div className="bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-100 dark:border-indigo-800 rounded-2xl p-6 mb-8">
                <h3 className="text-sm font-bold text-indigo-600 dark:text-indigo-400 mb-2 flex items-center gap-2">
                    <Sparkles size={16} /> 目標句型
                </h3>
                <p className="text-xl font-black text-slate-800 dark:text-slate-100 mb-1">{pattern.text}</p>
                <p className="text-slate-600 dark:text-slate-300 font-bold">{pattern.meaningZh}</p>
            </div>

            {isFinished ? (
                <div className="bg-white dark:bg-slate-900 rounded-2xl p-8 shadow-sm border border-slate-200 dark:border-slate-800 flex flex-col items-center text-center">
                    <div className="w-16 h-16 bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400 rounded-full flex items-center justify-center mb-4">
                        <CheckCircle2 size={32} />
                    </div>
                    <h3 className="text-2xl font-black text-slate-800 dark:text-white mb-2">
                        恭喜完成第 {groupIndex + 1} 組 10 句造句！
                    </h3>
                    <p className="text-slate-500 dark:text-slate-400 font-bold mb-6">
                        您已經完成了這個句型的基本練習，現在可以開始念出來練習了。
                    </p>
                    {justUnlocked !== null && (
                        <div className="mb-6 px-4 py-2 bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 rounded-xl font-black animate-in zoom-in">
                            🎉 已解鎖第 {justUnlocked + 1} 組！
                        </div>
                    )}
                    <button
                        onClick={startPractice}
                        className="px-8 py-4 bg-indigo-600 text-white rounded-xl font-bold shadow-md hover:bg-indigo-700 transition-colors flex items-center gap-2"
                    >
                        <Play size={20} />
                        開始練習
                    </button>
                </div>
            ) : (
                <div className="bg-white dark:bg-slate-900 rounded-2xl p-6 shadow-sm border border-slate-200 dark:border-slate-800 flex flex-col gap-6">
                    <div className="flex flex-col gap-2">
                        <label className="text-sm font-bold text-slate-700 dark:text-slate-300">
                            請用目標句型造一個英文句子：
                        </label>
                        <textarea
                            value={inputText}
                            onChange={handleTextChange}
                            placeholder="Type your sentence here..."
                            className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl p-4 text-slate-800 dark:text-slate-200 resize-none h-32 focus:outline-none focus:ring-2 focus:ring-indigo-500 font-medium"
                            disabled={isChecking}
                        />
                    </div>
                    
                    {errorMsg && (
                        <div className="bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 text-sm px-4 py-3 rounded-xl border border-red-100 dark:border-red-800 font-bold">
                            {errorMsg}
                        </div>
                    )}

                    {checkResult && (
                        <div className={`border rounded-xl p-4 ${
                            (checkResult.natural && checkResult.grammar && checkResult.spelling) 
                                ? 'bg-green-50 dark:bg-green-900/20 border-green-100 dark:border-green-800' 
                                : 'bg-orange-50 dark:bg-orange-900/20 border-orange-100 dark:border-orange-800'
                        }`}>
                            <h4 className={`text-sm font-bold mb-3 ${
                                (checkResult.natural && checkResult.grammar && checkResult.spelling) 
                                    ? 'text-green-800 dark:text-green-300' 
                                    : 'text-orange-800 dark:text-orange-300'
                            }`}>
                                {(checkResult.natural && checkResult.grammar && checkResult.spelling) ? '檢查通過：' : '未通過檢查：'}
                            </h4>
                            
                            <div className="flex flex-col gap-2 mb-3">
                                <div className="flex items-center gap-2 text-sm font-bold">
                                    {checkResult.natural ? <CheckCircle2 size={16} className="text-green-500" /> : <XCircle size={16} className="text-red-500" />}
                                    <span className={checkResult.natural ? "text-green-700 dark:text-green-400" : "text-red-700 dark:text-red-400"}>自然道地</span>
                                </div>
                                <div className="flex items-center gap-2 text-sm font-bold">
                                    {checkResult.grammar ? <CheckCircle2 size={16} className="text-green-500" /> : <XCircle size={16} className="text-red-500" />}
                                    <span className={checkResult.grammar ? "text-green-700 dark:text-green-400" : "text-red-700 dark:text-red-400"}>文法正確</span>
                                </div>
                                <div className="flex items-center gap-2 text-sm font-bold">
                                    {checkResult.spelling ? <CheckCircle2 size={16} className="text-green-500" /> : <XCircle size={16} className="text-red-500" />}
                                    <span className={checkResult.spelling ? "text-green-700 dark:text-green-400" : "text-red-700 dark:text-red-400"}>拼字正確</span>
                                </div>
                            </div>
                            
                            <p className={`text-sm font-bold leading-relaxed p-3 rounded-lg ${
                                (checkResult.natural && checkResult.grammar && checkResult.spelling)
                                    ? 'bg-green-100/50 dark:bg-green-900/40 text-green-900 dark:text-green-200'
                                    : 'bg-white/50 dark:bg-black/20 text-orange-900 dark:text-orange-200'
                            }`}>
                                {checkResult.comment}
                            </p>

                            {checkResult.suggestedRevision && (
                                <div className="mt-4 pt-4 border-t border-black/5 dark:border-white/10">
                                    <p className={`text-xs font-bold mb-1 ${
                                        (checkResult.natural && checkResult.grammar && checkResult.spelling)
                                            ? 'text-green-800 dark:text-green-400'
                                            : 'text-orange-800 dark:text-orange-400'
                                    }`}>
                                        建議優化說法 {checkResult.suggestedRevisionScope === 'partial' ? '(部分調整)' : '(整句重寫)'}：
                                    </p>
                                    <p className="text-sm font-bold text-slate-800 dark:text-slate-200 italic">
                                        "{checkResult.suggestedRevision}"
                                    </p>
                                </div>
                            )}

                            <div className="flex flex-col sm:flex-row gap-3 mt-5">
                                {checkResult.suggestedRevision && (
                                    <button
                                        onClick={handleUseSuggestion}
                                        className="flex-1 h-12 bg-white dark:bg-slate-800 text-indigo-600 dark:text-indigo-400 border border-indigo-200 dark:border-indigo-700 rounded-xl font-bold shadow-sm hover:bg-indigo-50 dark:hover:bg-slate-700 transition-colors flex items-center justify-center gap-2"
                                    >
                                        <Edit3 size={18} />
                                        使用建議優化說法
                                    </button>
                                )}
                                
                                {(checkResult.natural && checkResult.grammar && checkResult.spelling) && (
                                    <button
                                        onClick={handleConfirmSubmit}
                                        className="flex-1 h-12 bg-green-600 text-white rounded-xl font-bold shadow-md hover:bg-green-700 transition-colors flex items-center justify-center gap-2"
                                    >
                                        <Check size={18} />
                                        確認送出, 完成這句
                                    </button>
                                )}
                            </div>
                        </div>
                    )}

                    {!checkResult && (
                        <button
                            onClick={handleCheck}
                            disabled={!inputText.trim() || isChecking}
                            className="w-full h-14 bg-indigo-600 text-white rounded-xl font-bold shadow-md hover:bg-indigo-700 transition-colors disabled:opacity-50 flex items-center justify-center gap-2 mt-2"
                        >
                            {isChecking ? (
                                <>
                                    <Loader2 size={20} className="animate-spin" />
                                    檢查中...
                                </>
                            ) : (
                                <>
                                    <Send size={20} />
                                    送出檢查
                                </>
                            )}
                        </button>
                    )}
                </div>
            )}
        </div>
    );
}
