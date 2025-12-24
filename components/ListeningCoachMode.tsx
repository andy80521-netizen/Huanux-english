
import React, { useState, useEffect, useRef, useMemo } from 'react';
import { 
  Ear, Play, SkipForward, SkipBack, RefreshCcw, Shuffle, ArrowLeft, Loader2, Keyboard, Activity, ChevronRight, StopCircle, PlayCircle
} from 'lucide-react';
import { VocabItem, LISTENING_BADGE_LEVELS } from '../constants';
import { speakTextPromise, getBadgeInfo } from '../utils';

interface Props {
  vocabData: VocabItem[];
  courses: string[];
  onUpdateVocab: (item: VocabItem) => void;
  voicePrefs: { zh?: string, en?: string };
}

const ListeningCoachMode: React.FC<Props> = ({ vocabData, courses, onUpdateVocab, voicePrefs }) => {
    const [listeningCourse, setListeningCourse] = useState<string | null>(null);
    const [currentIndex, setCurrentIndex] = useState(0);
    const [userInput, setUserInput] = useState('');
    const [isPlaying, setIsPlaying] = useState(false);
    const [isCoaching, setIsCoaching] = useState(false);
    const [showResult, setShowResult] = useState(false);
    const [score, setScore] = useState(0);
    const [isAutoLoop, setIsAutoLoop] = useState(false);
    const [isRandomLoop, setIsRandomLoop] = useState(false);
    const inputRef = useRef<HTMLTextAreaElement>(null);

    const filteredData = useMemo(() => {
        return listeningCourse ? vocabData.filter(v => v.course === listeningCourse && !v.isHidden) : [];
    }, [vocabData, listeningCourse]);

    const currentEntry = filteredData.length > 0 ? filteredData[currentIndex] : null;

    useEffect(() => {
        return () => window.speechSynthesis.cancel();
    }, []);

    useEffect(() => {
        if (!currentEntry) return;
        resetState();
        if (isCoaching && (isAutoLoop || isRandomLoop) && !showResult && !isPlaying) {
             const timer = setTimeout(() => { handlePlayAudio(); }, 800); 
             return () => clearTimeout(timer);
        }
    }, [currentIndex]);

    useEffect(() => {
        if (isCoaching && showResult && (isAutoLoop || isRandomLoop)) {
            const timer = setTimeout(() => {
                if (!showResult) return;
                if (isRandomLoop) handleRandomNext();
                else handleNext();
            }, 4000);
            return () => clearTimeout(timer);
        }
    }, [showResult, isCoaching]);

    const resetState = () => {
        setUserInput('');
        setShowResult(false);
        setScore(0);
        setIsPlaying(false);
        window.speechSynthesis.cancel();
        if (!showResult) {
            setTimeout(() => { if (inputRef.current) inputRef.current.focus(); }, 100);
        }
    };

    const handlePlayAudio = async () => {
        if (isPlaying || !currentEntry) return;
        setIsPlaying(true);
        if (inputRef.current) inputRef.current.focus();
        await speakTextPromise(currentEntry.answer, 1.0, voicePrefs);
        setIsPlaying(false);
    };

    const startPractice = () => {
        setIsCoaching(true);
        handlePlayAudio();
    };

    const stopPractice = () => {
        setIsCoaching(false);
        window.speechSynthesis.cancel();
        resetState();
    };

    const handleCheckAnswer = () => {
        if (!currentEntry) return;
        const normalizedInput = userInput.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim();
        const normalizedAnswer = currentEntry.answer.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim();
        const inputWords = normalizedInput.split(/\s+/).filter(w => w);
        const answerWords = normalizedAnswer.split(/\s+/).filter(w => w);
        let matchCount = 0;
        let answerIndex = 0;
        inputWords.forEach(word => {
             const foundIndex = answerWords.indexOf(word, answerIndex);
             if (foundIndex !== -1) { matchCount++; answerIndex = foundIndex + 1; }
        });
        const accuracy = answerWords.length > 0 ? (matchCount / answerWords.length) * 100 : 0;
        const finalScore = Math.min(100, Math.round(accuracy));
        setScore(finalScore);
        
        // 只有 70 分以上才計入熟練度
        if (finalScore >= 70) {
            const newMastery = (currentEntry.listeningMastery || 0) + finalScore;
            onUpdateVocab({ ...currentEntry, listeningMastery: newMastery });
        }
        
        setShowResult(true);
    };

    const handleNext = () => { resetState(); setCurrentIndex(prev => (prev + 1) % filteredData.length); };
    const handlePrev = () => { resetState(); setCurrentIndex(prev => (prev - 1 + filteredData.length) % filteredData.length); };
    const handleRandomNext = () => { resetState(); const randIndex = Math.floor(Math.random() * filteredData.length); setCurrentIndex(randIndex); };
    
    const handleExit = () => { setListeningCourse(null); setIsCoaching(false); window.speechSynthesis.cancel(); };

    if (!listeningCourse) {
        return (
            <div className="h-full flex flex-col bg-slate-50 dark:bg-slate-950 p-6 overflow-y-auto">
                <h2 className="text-xl font-bold text-slate-800 dark:text-slate-100 mb-6 flex items-center gap-2"><Ear size={24} className="text-orange-500 dark:text-orange-400"/> 聽力教練</h2>
                <div className="grid grid-cols-1 gap-4 pb-20">
                    {courses.map(course => (
                        <button key={course} onClick={() => setListeningCourse(course)} className="bg-white dark:bg-slate-900 p-6 rounded-2xl shadow-sm border border-slate-100 dark:border-slate-800 flex items-center justify-between group hover:border-orange-200 dark:hover:border-orange-800 transition-all text-left"><div className="flex items-center gap-4"><div className="p-3 bg-orange-50 dark:bg-orange-900/30 rounded-xl text-orange-500 dark:text-orange-400 group-hover:bg-orange-500 group-hover:text-white transition-colors"><Ear size={24} /></div><div><h3 className="font-bold text-slate-800 dark:text-slate-100 text-lg">{course}</h3><p className="text-slate-400 dark:text-slate-500 text-sm">{vocabData.filter(v => v.course === course && !v.isHidden).length} 個題目</p></div></div><ChevronRight className="text-slate-300 dark:text-slate-600 group-hover:text-orange-500 dark:group-hover:text-orange-400 transition-colors" /></button>
                    ))}
                </div>
            </div>
        );
    }

    const { currentBadge, nextBadge } = getBadgeInfo(currentEntry?.listeningMastery || 0, LISTENING_BADGE_LEVELS);
    const isPass = score >= 70;

    return (
        <div className="flex flex-col h-full bg-slate-50 dark:bg-slate-950 relative overflow-y-auto pb-20">
            <div className="bg-white dark:bg-slate-900 p-4 shadow-sm sticky top-0 z-10">
                <div className="flex justify-between items-center mb-4">
                   <div className="flex items-center gap-2 flex-1 min-w-0">
                       <button onClick={handleExit} className="p-1 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 shrink-0"><ArrowLeft size={20} className="text-slate-500 dark:text-slate-400"/></button>
                       <span className="text-xs font-bold text-slate-400 dark:text-slate-500 bg-slate-100 dark:bg-slate-800 px-2 py-1 rounded truncate">{listeningCourse}</span>
                   </div>
                   
                   <div className="relative shrink-0 max-w-[50%]">
                       <div className="flex items-center justify-center gap-1 bg-slate-100 dark:bg-slate-800 px-3 py-1.5 rounded-lg text-sm font-mono font-bold text-slate-600 dark:text-slate-300 overflow-hidden">
                           <span className="truncate">
                               #{currentIndex + 1} {currentEntry?.question.slice(0, 5)}...
                           </span>
                           <ChevronRight className="rotate-90 text-slate-400 dark:text-slate-500 shrink-0" size={12} />
                       </div>
                       <select 
                        value={currentIndex} 
                        onChange={(e) => { stopPractice(); setCurrentIndex(Number(e.target.value)); }} 
                        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                       >
                           {filteredData.map((item, index) => (<option key={index} value={index}>#{index + 1} {item.question.slice(0, 5)}...</option>))}
                       </select>
                   </div>
                </div>
                <div className="flex items-center justify-between gap-2">
                    {!isAutoLoop && !isRandomLoop && <button onClick={() => { stopPractice(); handlePrev(); }} className="px-4 py-3 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-700"><SkipBack size={20} /></button>}
                    <button onClick={() => { setIsAutoLoop(!isAutoLoop); setIsRandomLoop(false); if(isCoaching) stopPractice(); }} className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-xl font-bold transition-all ${isAutoLoop ? 'bg-orange-500 text-white shadow-lg shadow-orange-200 dark:shadow-none' : 'bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400'}`}><RefreshCcw size={18} className={isAutoLoop ? 'animate-spin-slow' : ''} />自動</button>
                    <button onClick={() => { setIsRandomLoop(!isRandomLoop); setIsAutoLoop(false); if(isCoaching) stopPractice(); }} className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-xl font-bold transition-all ${isRandomLoop ? 'bg-purple-600 text-white shadow-lg shadow-purple-200 dark:shadow-none' : 'bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400'}`}><Shuffle size={18} />隨機</button>
                    {!isAutoLoop && !isRandomLoop && <button onClick={() => { stopPractice(); handleNext(); }} className="px-4 py-3 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-700"><SkipForward size={20} /></button>}
                </div>
            </div>
            <div className="p-6 flex flex-col items-center max-w-md mx-auto w-full">
                {(isAutoLoop || isRandomLoop) && isCoaching && <p className="mb-4 text-[10px] font-bold text-slate-400 dark:text-slate-500 flex items-center gap-1 animate-pulse"><Activity size={12}/>{isAutoLoop ? '自動' : '隨機'}模式中：完成後自動跳轉</p>}
                
                <div className="w-full bg-white dark:bg-slate-900 rounded-3xl shadow-xl border border-slate-100 dark:border-slate-800 p-6 mb-6 flex flex-col items-center text-center">
                     <div className="w-20 h-20 bg-orange-50 dark:bg-orange-900/20 rounded-full flex items-center justify-center mb-6 text-orange-500 dark:text-orange-400 shadow-inner"><Ear size={40} /></div>
                     
                     <div className="flex items-center justify-center gap-4 mb-8 w-full">
                        <button onClick={handlePlayAudio} disabled={isPlaying} className={`p-4 rounded-full transition-all transform active:scale-95 shadow-lg flex items-center justify-center ${isPlaying ? 'bg-slate-100 dark:bg-slate-800 text-slate-300 dark:text-slate-600' : 'bg-orange-500 text-white hover:bg-orange-600 shadow-orange-200 dark:shadow-none'}`}>{isPlaying ? <Loader2 size={32} className="animate-spin" /> : <Play size={32} fill="currentColor" className="ml-1"/>}</button>
                        <div className="text-left"><p className="text-xs font-bold text-slate-400 dark:text-slate-500 uppercase">Listen</p><p className="text-sm font-bold text-slate-600 dark:text-slate-300">播放音檔</p></div>
                     </div>

                     {!showResult ? (
                        <div className="w-full space-y-4 animate-in fade-in slide-in-from-bottom-4 duration-500">
                             <div className="relative">
                                <textarea ref={inputRef} disabled={!isCoaching} value={userInput} onChange={(e) => setUserInput(e.target.value)} className="w-full p-4 bg-slate-50 dark:bg-slate-800 border-2 border-slate-200 dark:border-slate-700 rounded-xl focus:border-orange-500 dark:focus:border-orange-500 focus:ring-4 focus:ring-orange-50 dark:focus:ring-orange-900/30 outline-none transition-all resize-none text-lg font-medium text-slate-700 dark:text-slate-200 placeholder:text-slate-300 dark:placeholder:text-slate-600 disabled:opacity-50" rows={3} placeholder={isCoaching ? "請輸入您聽到的英文句子..." : "點擊下方「開始練習」..."} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleCheckAnswer(); } }} />
                                <Keyboard className="absolute right-3 bottom-3 text-slate-300 dark:text-slate-600" size={18} />
                             </div>
                             <button onClick={handleCheckAnswer} disabled={!userInput.trim() || !isCoaching} className="w-full py-3 bg-slate-800 dark:bg-slate-700 text-white font-bold rounded-xl shadow-lg hover:bg-slate-900 dark:hover:bg-slate-600 transition-all disabled:opacity-50 disabled:cursor-not-allowed">提交答案</button>
                        </div>
                     ) : (
                        <div className="w-full space-y-4 animate-in fade-in zoom-in duration-300">
                            <div className="text-left bg-slate-50 dark:bg-slate-800 p-4 rounded-xl border border-slate-200 dark:border-slate-700"><p className="text-xs font-bold text-slate-400 dark:text-slate-500 uppercase mb-1">正確答案</p><p className="text-lg font-bold text-indigo-600 dark:text-indigo-400 leading-snug">{currentEntry?.answer}</p></div>
                            <div className="flex items-center gap-2">
                                <div className={`flex-1 p-3 rounded-xl border flex flex-col items-center justify-center ${score === 100 ? 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800 text-green-600 dark:text-green-400' : isPass ? 'bg-orange-50 dark:bg-orange-900/20 border-orange-200 dark:border-orange-800 text-orange-600 dark:text-orange-400' : 'bg-slate-100 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400'}`}>
                                    <span className="text-xs font-bold uppercase opacity-70">準確度</span>
                                    <span className="text-2xl font-black">{score}%</span>
                                </div>
                                <div className={`flex-1 p-3 rounded-xl border flex flex-col items-center justify-center ${isPass ? 'bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300' : 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800 text-red-500 dark:text-red-400'}`}>
                                    <span className="text-xs font-bold uppercase opacity-70">{isPass ? '獲得積分' : '未達標'}</span>
                                    <span className="text-2xl font-black">+{isPass ? score : 0}</span>
                                </div>
                            </div>
                             <div className={`relative overflow-hidden p-3 rounded-xl border ${currentBadge.border} flex items-center gap-3`}>
                                <div className={`absolute inset-0 bg-gradient-to-br ${currentBadge.gradient} opacity-20`} />
                                <div className={`w-10 h-10 rounded-full flex items-center justify-center shadow-sm ${currentBadge.bg} ${currentBadge.ring} ring-1 z-10`}><currentBadge.icon size={18} /></div>
                                <div className="flex-1 z-10"><div className="flex justify-between items-center mb-1"><span className={`text-xs font-black ${currentBadge.color}`}>{currentBadge.name}</span><span className="text-[10px] font-mono font-bold text-slate-500 dark:text-slate-400">{currentEntry?.listeningMastery || 0} XP</span></div>{nextBadge && (<div className="w-full bg-white/50 dark:bg-slate-900/50 h-1.5 rounded-full overflow-hidden"><div className={`h-full ${currentBadge.barColor}`} style={{ width: `${Math.min(((currentEntry?.listeningMastery || 0) / nextBadge.threshold) * 100, 100)}%` }} /></div>)}</div>
                            </div>
                            {!isAutoLoop && !isRandomLoop && <button onClick={handleNext} className="w-full py-3 bg-orange-500 text-white font-bold rounded-xl shadow-lg hover:bg-orange-600 flex items-center justify-center gap-2">下一題 <ArrowLeft className="rotate-180" size={18} /></button>}
                        </div>
                     )}
                </div>

                <button 
                    onClick={isCoaching ? stopPractice : startPractice} 
                    className={`w-full max-w-md py-4 rounded-2xl font-bold text-lg shadow-xl transition-all flex items-center justify-center gap-3 ${isCoaching ? 'bg-red-50 dark:bg-red-900/20 text-red-500 dark:text-red-400 border border-red-100 dark:border-red-900' : 'bg-orange-500 text-white shadow-orange-200 dark:shadow-none hover:scale-105 active:scale-95'}`}
                >
                    {isCoaching ? <><StopCircle /> 停止練習</> : <><PlayCircle /> 開始練習</>}
                </button>
            </div>
        </div>
    );
};

export default ListeningCoachMode;
