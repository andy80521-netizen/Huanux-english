import React, { useRef, useState } from 'react';
import { Material } from '../types';
import { ChevronLeft, Play, Pause, CheckCircle2, Mic, Loader2, Sparkles, Trash2, RotateCcw, ChevronDown, ChevronUp } from 'lucide-react';
import { auth, db, appId } from '../firebase';
import { doc, onSnapshot, collection, setDoc, updateDoc } from 'firebase/firestore';
import ShadowingPracticeView from './ShadowingPracticeView';
import { extractPatternsFromSentence } from '../services/gemini';

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
    const [showDeleted, setShowDeleted] = useState(false);

    if (!material) {
        return (
            <div className="flex flex-col h-full bg-slate-50 dark:bg-slate-950 p-6 items-center justify-center">
                <Loader2 className="animate-spin text-indigo-600 mb-4" size={40} />
                <p className="text-slate-500 font-bold">載入中...</p>
            </div>
        );
    }

    // 實際位置 vs 顯示序號：寫入、播放、萃取一律用句子在陣列中的實際位置；導覽與顯示只看未刪除的句子
    const activeIndices = material.sentences.map((s, i) => (s.deleted ? -1 : i)).filter(i => i >= 0);
    const deletedIndices = material.sentences.map((s, i) => (s.deleted ? i : -1)).filter(i => i >= 0);
    const lastActiveIndex = activeIndices[activeIndices.length - 1];

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
                isLastSentence={practiceIndex === lastActiveIndex}
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

    const handleExtract = async (index: number) => {
        if (!material) return;
        const uid = auth.currentUser?.uid;
        if (!uid) return;

        setExtractingIndex(index);
        setExtractMessage(null);
        const sentence = material.sentences[index];

        try {
            const patterns = await extractPatternsFromSentence(sentence.text, sentence.translation || '');
            
            const patternsRef = collection(db, `artifacts/${appId}/users/${uid}/languagePatterns`);
            const promises = patterns.map(p => {
                const docRef = doc(patternsRef);
                return setDoc(docRef, {
                    ...p,
                    id: docRef.id,
                    sourceMaterialId: material.id,
                    sourceLabel: sentence.text.substring(0, 20) + (sentence.text.length > 20 ? '...' : ''),
                    exampleSentences: [],
                    unlockedGroups: 0
                });
            });
            await Promise.all(promises);

            const updatedSentences = [...material.sentences];
            updatedSentences[index] = { ...updatedSentences[index], extracted: true };
            
            await updateDoc(doc(db, `artifacts/${appId}/users/${uid}/materials`, material.id), {
                sentences: updatedSentences
            });

            setExtractMessage({ text: `已成功從這句萃取出 ${patterns.length} 個句型`, isError: false });
            setTimeout(() => setExtractMessage(null), 3000);
        } catch (err: any) {
            console.error(err);
            setExtractMessage({ text: err.message || '萃取失敗', isError: true });
            setTimeout(() => setExtractMessage(null), 3000);
        } finally {
            setExtractingIndex(null);
        }
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

    return (
        <div className="flex flex-col h-full bg-slate-50 dark:bg-slate-950 p-6 overflow-y-auto pb-20">
            <div className="flex items-center gap-4 mb-8">
                <button 
                    onClick={onBack}
                    className="p-2 bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 rounded-full shadow-sm hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                >
                    <ChevronLeft size={24} />
                </button>
                <h2 className="text-2xl font-black text-slate-800 dark:text-white line-clamp-1 flex-1">
                    {material.title}
                </h2>
            </div>
            {extractMessage && (
                <div className={`mb-6 text-sm px-4 py-3 rounded-xl shadow-sm border animate-in slide-in-from-top-2 font-bold text-center ${
                    extractMessage.isError 
                        ? 'bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 border-red-100 dark:border-red-800' 
                        : 'bg-indigo-50 dark:bg-indigo-900/20 text-indigo-600 dark:text-indigo-400 border-indigo-100 dark:border-indigo-800'
                }`}>
                    {extractMessage.text}
                </div>
            )}

            <audio 
                ref={audioRef} 
                src={material.audioUrl} 
                onTimeUpdate={handleTimeUpdate} 
                onEnded={() => setPlayingIndex(null)} 
            />

            <div className="space-y-4">
                {material.sentences.map((s, i) => {
                    if (s.deleted) return null;
                    const isCompleted = s.mastery >= 1000;
                    return (
                        <div key={s.id} className="p-5 rounded-2xl bg-white dark:bg-slate-900 shadow-sm border border-slate-200 dark:border-slate-800 flex flex-col sm:flex-row gap-4 items-start">
                            <div className="flex-1 space-y-2">
                                <div className="flex items-center gap-2 mb-2">
                                    {s.lowConfidence && (
                                        <span className="text-[10px] font-bold bg-orange-100 text-orange-600 px-2 py-0.5 rounded-full shrink-0">
                                            低信心度
                                        </span>
                                    )}
                                    {isCompleted && (
                                        <span className="text-[10px] font-bold bg-green-100 text-green-600 px-2 py-0.5 rounded-full shrink-0 flex items-center gap-1">
                                            <CheckCircle2 size={12} /> 已精熟
                                        </span>
                                    )}
                                    <span className="text-xs font-bold text-slate-400 bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded-full">
                                        Mastery: {s.mastery}
                                    </span>
                                </div>
                                <p className="text-lg font-bold text-slate-800 dark:text-slate-200 leading-relaxed">
                                    {s.text}
                                </p>
                                <p className="text-slate-500 dark:text-slate-400 text-sm leading-relaxed">
                                    {s.translation}
                                </p>
                            </div>
                            
                            <div className="flex flex-wrap items-center gap-2 mt-4 sm:mt-0">
                                {isCompleted && !s.extracted && (
                                    <button
                                        onClick={() => handleExtract(i)}
                                        disabled={extractingIndex !== null}
                                        className="shrink-0 px-4 h-12 rounded-xl flex items-center justify-center gap-2 transition-all shadow-sm bg-purple-50 text-purple-600 hover:bg-purple-100 dark:bg-purple-900/30 dark:text-purple-400 dark:hover:bg-purple-900/50 font-bold text-sm disabled:opacity-50"
                                    >
                                        {extractingIndex === i ? <Loader2 size={18} className="animate-spin" /> : <Sparkles size={18} />}
                                        萃取語言模型
                                    </button>
                                )}
                                {isCompleted && s.extracted && (
                                    <div className="shrink-0 px-4 h-12 rounded-xl flex items-center justify-center gap-2 shadow-sm bg-slate-50 text-slate-500 dark:bg-slate-800/50 dark:text-slate-400 font-bold text-sm border border-slate-200 dark:border-slate-700">
                                        <Sparkles size={18} />
                                        已萃取
                                    </div>
                                )}
                                <button
                                    onClick={() => setPracticeIndex(i)}
                                    className="shrink-0 px-4 h-12 rounded-xl flex items-center justify-center gap-2 transition-all shadow-sm bg-indigo-50 text-indigo-600 hover:bg-indigo-100 dark:bg-indigo-900/30 dark:text-indigo-400 dark:hover:bg-indigo-900/50 font-bold text-sm"
                                >
                                    <Mic size={18} />
                                    跟讀
                                </button>
                                <button
                                    onClick={() => playingIndex === i ? handlePause() : handlePlaySegment(i)}
                                    className={`shrink-0 w-12 h-12 rounded-xl flex items-center justify-center transition-all shadow-sm ${playingIndex === i ? 'bg-slate-200 text-slate-800 dark:bg-slate-700 dark:text-slate-100' : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 hover:text-slate-800 dark:hover:bg-slate-700 dark:hover:text-slate-100'}`}
                                >
                                    {playingIndex === i ? <Pause size={20} className="fill-current" /> : <Play size={20} className="fill-current ml-1" />}
                                </button>
                                <button
                                    onClick={() => handleDeleteSentence(i)}
                                    disabled={activeIndices.length <= 1}
                                    title={activeIndices.length <= 1 ? "至少需保留 1 句" : "刪除句子"}
                                    className="shrink-0 w-12 h-12 rounded-xl flex items-center justify-center transition-all shadow-sm text-red-500 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-900/30 disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-red-500"
                                >
                                    <Trash2 size={20} />
                                </button>
                            </div>
                        </div>
                    );
                })}
            </div>

            {/* 已刪除（N）區塊 */}
            {deletedIndices.length > 0 && (
                <div className="mt-8 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden bg-slate-50/50 dark:bg-slate-900/50">
                    <button
                        onClick={() => setShowDeleted(!showDeleted)}
                        className="w-full px-4 py-3 bg-slate-100 dark:bg-slate-800/80 text-slate-700 dark:text-slate-300 font-bold flex items-center justify-between hover:bg-slate-200 dark:hover:bg-slate-800 transition-colors text-sm"
                    >
                        <span className="flex items-center gap-2">
                            <Trash2 size={16} className="text-slate-400" />
                            已刪除（{deletedIndices.length}）
                        </span>
                        {showDeleted ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
                    </button>

                    {showDeleted && (
                        <div className="p-4 space-y-3 divide-y divide-slate-200 dark:divide-slate-800">
                            {deletedIndices.map((i) => {
                                const s = material.sentences[i];
                                return (
                                    <div key={s.id || i} className="pt-3 first:pt-0 flex flex-col md:flex-row md:items-center justify-between gap-3">
                                        <div className="flex-1 space-y-1">
                                            <div className="flex items-center gap-2">
                                                <span className="text-xs font-bold text-slate-400 bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded-full">
                                                    Mastery: {s.mastery}
                                                </span>
                                            </div>
                                            <p className="text-sm text-slate-600 dark:text-slate-400 font-medium line-through opacity-75">
                                                {s.text}
                                            </p>
                                        </div>
                                        <button
                                            onClick={() => handleRestoreSentence(i)}
                                            className="self-end md:self-center px-3 py-1.5 bg-white dark:bg-slate-800 text-indigo-600 dark:text-indigo-400 border border-indigo-200 dark:border-indigo-800 rounded-lg hover:bg-indigo-50 dark:hover:bg-indigo-950 font-bold text-xs flex items-center gap-1.5 transition-colors shrink-0"
                                        >
                                            <RotateCcw size={14} />
                                            復原
                                        </button>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
