import React, { useRef, useState } from 'react';
import { Material } from '../types';
import { ChevronLeft, Play, Pause, CheckCircle2, Mic, Loader2, Sparkles } from 'lucide-react';
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
        });

    
        return () => unsubscribe();
    }, [materialId]);
    const audioRef = useRef<HTMLAudioElement>(null);
    const [playingIndex, setPlayingIndex] = useState<number | null>(null);
    const [practiceIndex, setPracticeIndex] = useState<number | null>(null);
    const [extractingIndex, setExtractingIndex] = useState<number | null>(null);
    const [extractMessage, setExtractMessage] = useState<{ text: string, isError: boolean } | null>(null);

    if (!material) {
        return (
            <div className="flex flex-col h-full bg-slate-50 dark:bg-slate-950 p-6 items-center justify-center">
                <Loader2 className="animate-spin text-indigo-600 mb-4" size={40} />
                <p className="text-slate-500 font-bold">載入中...</p>
            </div>
        );
    }

    if (practiceIndex !== null) {
        return (
            <ShadowingPracticeView 
                material={material} 
                sentenceIndex={practiceIndex} 
                onBack={() => setPracticeIndex(null)} 
                onNext={() => setPracticeIndex(prev => prev !== null && prev < material.sentences.length - 1 ? prev + 1 : prev)}
                isLastSentence={practiceIndex === material.sentences.length - 1}
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
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
