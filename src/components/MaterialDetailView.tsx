import React, { useRef, useState } from 'react';
import { Material, CoverStyle } from '../types';
import { ChevronLeft, Play, Pause, CheckCircle2, Mic, Loader2, Sparkles, Trash2, RotateCcw, BookOpen, X } from 'lucide-react';
import { auth, db, appId } from '../firebase';
import { doc, onSnapshot, collection, setDoc, updateDoc } from 'firebase/firestore';
import ShadowingPracticeView from './ShadowingPracticeView';
import { extractPatternsFromSentence } from '../services/gemini';
import { startCoverGeneration, buildCoverExcerpt } from '../services/cover';
import ConfirmDialog from './ConfirmDialog';

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

    return (
        <div className="flex flex-col h-full bg-slate-50 dark:bg-slate-950 p-6 overflow-y-auto pb-20">
            <div className="flex items-center gap-4 mb-6">
                <button 
                    onClick={onBack}
                    className="p-2 bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 rounded-full shadow-sm hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                >
                    <ChevronLeft size={24} />
                </button>
                <h2 className="text-2xl font-black text-slate-800 dark:text-white line-clamp-1 flex-1">
                    {material.title}
                </h2>
                <button
                    onClick={() => setShowTrash(true)}
                    className="p-2 bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 rounded-full shadow-sm hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors relative"
                    title="垃圾桶"
                >
                    <Trash2 size={24} />
                    {deletedIndices.length > 0 && (
                        <span className="absolute -top-1 -right-1 bg-red-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full min-w-[18px] text-center leading-none">
                            {deletedIndices.length}
                        </span>
                    )}
                </button>
            </div>

            {/* 封面區 */}
            <div className="mb-6 space-y-3">
                <div className="aspect-video w-full rounded-2xl overflow-hidden bg-slate-100 dark:bg-slate-800 relative flex items-center justify-center border border-slate-200 dark:border-slate-800 shadow-sm">
                    {material.coverUrl && material.coverStatus !== 'generating' ? (
                        <img
                            src={material.coverUrl}
                            alt={material.title}
                            className="w-full h-full object-cover"
                        />
                    ) : isCoverGenerating ? (
                        <div className="flex flex-col items-center justify-center gap-2 text-indigo-500 dark:text-indigo-400">
                            <Loader2 size={32} className="animate-spin" />
                            <span className="text-sm font-bold text-slate-500 dark:text-slate-400">封面產生中</span>
                        </div>
                    ) : (
                        <div className="w-full h-full bg-gradient-to-br from-indigo-50 to-slate-100 dark:from-slate-850 dark:to-slate-800 flex items-center justify-center text-slate-300 dark:text-slate-600">
                            <BookOpen size={48} />
                        </div>
                    )}
                </div>

                {/* 封面操作列 */}
                <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                        <span className="text-xs font-bold text-slate-600 dark:text-slate-300">封面風格：</span>
                        <div className="inline-flex rounded-lg p-0.5 bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
                            <button
                                type="button"
                                onClick={() => handleCoverStyleChange('photo')}
                                className={`px-2.5 py-1 text-xs font-bold rounded-md transition-all ${
                                    coverStyle === 'photo'
                                        ? 'bg-white dark:bg-slate-700 text-indigo-600 dark:text-indigo-400 shadow-sm'
                                        : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                                }`}
                            >
                                寫實攝影
                            </button>
                            <button
                                type="button"
                                onClick={() => handleCoverStyleChange('anime')}
                                className={`px-2.5 py-1 text-xs font-bold rounded-md transition-all ${
                                    coverStyle === 'anime'
                                        ? 'bg-white dark:bg-slate-700 text-indigo-600 dark:text-indigo-400 shadow-sm'
                                        : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                                }`}
                            >
                                日系動漫
                            </button>
                        </div>
                    </div>

                    <button
                        onClick={handleGenerateCover}
                        disabled={isCoverGenerating}
                        className="px-4 py-2 bg-indigo-600 text-white font-bold rounded-xl shadow-sm hover:bg-indigo-700 transition-all active:scale-95 disabled:opacity-50 disabled:pointer-events-none flex items-center gap-2 text-sm"
                    >
                        {isCoverGenerating ? (
                            <>
                                <Loader2 size={16} className="animate-spin" />
                                產生中…
                            </>
                        ) : (
                            material.coverUrl ? '重新產生封面' : '產生封面'
                        )}
                    </button>
                </div>

                {material.coverStatus === 'error' && (
                    <p className="text-xs text-red-500 font-bold">
                        封面產生失敗：{material.coverError || '未知錯誤'}
                    </p>
                )}
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
                        <div key={s.id} className="p-5 rounded-2xl bg-white dark:bg-slate-900 shadow-sm border border-slate-200 dark:border-slate-800 flex flex-col gap-4">
                            <div className="w-full space-y-2">
                                <div className="flex flex-wrap items-center gap-2 mb-2">
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
                            
                            <div className="flex flex-wrap items-center gap-2">
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
                                    onClick={() => setPendingDeleteIndex(i)}
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
                    className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 backdrop-blur-sm p-4 animate-in fade-in duration-200"
                    onClick={() => setShowTrash(false)}
                >
                    <div 
                        className="bg-white dark:bg-slate-900 rounded-[2rem] p-6 w-full max-w-lg shadow-2xl border border-slate-100 dark:border-slate-800 flex flex-col max-h-[85vh] animate-in zoom-in-95 duration-200"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className="flex items-center justify-between pb-4 border-b border-slate-100 dark:border-slate-800 mb-4">
                            <h3 className="text-xl font-black text-slate-800 dark:text-white flex items-center gap-2">
                                <Trash2 size={20} className="text-slate-400" />
                                垃圾桶（{deletedIndices.length}）
                            </h3>
                            <button
                                onClick={() => setShowTrash(false)}
                                className="p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                            >
                                <X size={20} />
                            </button>
                        </div>

                        <div className="max-h-[70vh] overflow-y-auto space-y-3 pr-1">
                            {deletedIndices.length === 0 ? (
                                <div className="text-center py-12 text-slate-400 dark:text-slate-500 font-medium">
                                    垃圾桶是空的
                                </div>
                            ) : (
                                deletedIndices.map((i) => {
                                    const s = material.sentences[i];
                                    return (
                                        <div key={s.id || i} className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-850/60 border border-slate-100 dark:border-slate-800 flex flex-col gap-3">
                                            <div className="flex-1 space-y-1 min-w-0">
                                                <div className="flex items-center gap-2">
                                                    <span className="text-xs font-bold text-slate-400 bg-slate-200/70 dark:bg-slate-800 px-2 py-0.5 rounded-full">
                                                        Mastery: {s.mastery}
                                                    </span>
                                                </div>
                                                <p className="text-sm font-semibold text-slate-700 dark:text-slate-300 break-words line-through opacity-80">
                                                    {s.text}
                                                </p>
                                                {s.translation && (
                                                    <p className="text-xs text-slate-500 dark:text-slate-400 break-words">
                                                        {s.translation}
                                                    </p>
                                                )}
                                            </div>
                                            <button
                                                onClick={() => handleRestoreSentence(i)}
                                                className="self-end px-3 py-1.5 bg-white dark:bg-slate-800 text-indigo-600 dark:text-indigo-400 border border-indigo-200 dark:border-indigo-800 rounded-lg hover:bg-indigo-50 dark:hover:bg-indigo-950 font-bold text-xs flex items-center gap-1.5 transition-colors shrink-0 shadow-sm"
                                            >
                                                <RotateCcw size={14} />
                                                復原
                                            </button>
                                        </div>
                                    );
                                })
                            )}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
