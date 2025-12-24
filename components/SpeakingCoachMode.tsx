
import React, { useState, useEffect, useRef, useMemo } from 'react';
import { 
  Mic, Mic2, StopCircle, PlayCircle, SkipForward, SkipBack, RefreshCcw, Shuffle, ArrowLeft, Volume2, BarChart2, Headphones, ChevronRight, Activity, Loader2
} from 'lucide-react';
import { VocabItem } from '../constants';
import { speakTextPromise, calculateSimilarity, getBadgeInfo } from '../utils';

interface Props {
  vocabData: VocabItem[];
  courses: string[];
  onUpdateVocab: (item: VocabItem) => void;
  voicePrefs: { zh?: string, en?: string };
}

const SpeakingCoachMode: React.FC<Props> = ({ vocabData, courses, onUpdateVocab, voicePrefs }) => {
  const [coachCourse, setCoachCourse] = useState<string | null>(null); 
  const [isAutoLoop, setIsAutoLoop] = useState(false);
  const [isRandomLoop, setIsRandomLoop] = useState(false);
  const [isPlayingFlow, setIsPlayingFlow] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [phase, setPhase] = useState('idle'); 
  const [scores, setScores] = useState({ pronunciation: 0, fluency: 0, stress: 0, total: 0 });
  const [showResult, setShowResult] = useState(false);
  const [audioURL, setAudioURL] = useState<string | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const transcriptRef = useRef<string>('');
  const recognitionRef = useRef<any>(null);
  const flowRef = useRef({ active: false });

  const filteredData = useMemo(() => { return coachCourse ? vocabData.filter(v => v.course === coachCourse && !v.isHidden) : []; }, [vocabData, coachCourse]);
  const currentEntry = filteredData.length > 0 ? filteredData[currentIndex] : null;

  useEffect(() => {
    if ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) {
        const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
        recognitionRef.current = new SpeechRecognition();
        recognitionRef.current.continuous = false;
        recognitionRef.current.interimResults = true;
        recognitionRef.current.lang = 'en-US';
        recognitionRef.current.onresult = (event: any) => {
            let finalTranscript = '';
            for (let i = event.resultIndex; i < event.results.length; ++i) {
                if (event.results[i].isFinal) finalTranscript += event.results[i][0].transcript;
            }
            if (!finalTranscript && event.results.length > 0) finalTranscript = event.results[0][0].transcript;
            if (finalTranscript) transcriptRef.current = finalTranscript;
        };
    }
    return () => stopFlow();
  }, []);

  // 監聽題目索引變化，僅在「測驗中」且「循環開啟」時自動開始下一輪
  useEffect(() => {
    if ((isAutoLoop || isRandomLoop) && isPlayingFlow && flowRef.current.active && filteredData.length > 0) {
      const timer = setTimeout(() => {
        startFlow();
      }, 600);
      return () => clearTimeout(timer);
    }
  }, [currentIndex]);

  const calculateFinalScores = (userText: string, targetText: string, durationSec: number) => {
      if (!userText || userText.trim().length === 0) return { pronunciation: 0, fluency: 0, stress: 0, total: 0 };
      const pronunciationScore = calculateSimilarity(userText, targetText);
      const targetWordCount = targetText.split(/\s+/).length;
      const userWordCount = userText.split(/\s+/).length;
      const idealMinTime = targetWordCount * 0.4; 
      const idealMaxTime = targetWordCount * 0.8 + 1.5; 
      let fluencyScore = 100;
      if (durationSec > idealMaxTime) fluencyScore -= (durationSec - idealMaxTime) * 10; 
      else if (durationSec < idealMinTime) fluencyScore -= (idealMinTime - durationSec) * 20; 
      fluencyScore = Math.max(0, Math.min(100, Math.round(fluencyScore * Math.min(1, userWordCount / targetWordCount)))); 
      let stressScore = Math.max(0, Math.min(100, Math.round(pronunciationScore * 0.8 + fluencyScore * 0.2 + (Math.random() * 10 - 5))));
      const totalScore = Math.round((pronunciationScore + fluencyScore + stressScore) / 3);
      return { pronunciation: pronunciationScore, fluency: fluencyScore, stress: stressScore, total: totalScore };
  };

  const startFlow = async () => {
    if (!currentEntry || isRecording) return;
    
    flowRef.current.active = true; 
    setIsPlayingFlow(true); 
    setShowResult(false); 
    setAudioURL(null);
    transcriptRef.current = '';
    
    try {
      setPhase('reading_question'); 
      await speakTextPromise(currentEntry.question, 1.0, voicePrefs); 
      if (!flowRef.current.active) return;

      setPhase('recording');
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaRecorderRef.current = new MediaRecorder(stream);
      audioChunksRef.current = [];
      mediaRecorderRef.current.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data);
      };
      
      const onStopPromise = new Promise<string>((resolve) => {
        if (mediaRecorderRef.current) {
          mediaRecorderRef.current.onstop = () => {
            const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
            const url = URL.createObjectURL(audioBlob);
            setAudioURL(url);
            resolve(url);
          };
        } else resolve('');
      });

      mediaRecorderRef.current.start();
      recognitionRef.current?.start();
      setIsRecording(true);
      
      const wordCount = currentEntry.answer.split(' ').length;
      const recordDuration = Math.max(3000, (wordCount * 800) + 2000);
      const startTime = Date.now();
      
      await new Promise(r => setTimeout(r, recordDuration));
      
      setIsRecording(false);
      recognitionRef.current?.stop();
      mediaRecorderRef.current?.stop();
      
      const userAudioUrl = await onStopPromise;
      const durationSec = (Date.now() - startTime) / 1000;
      if (!flowRef.current.active) return;

      setPhase('scoring');
      await new Promise(r => setTimeout(r, 600));
      const finalScores = calculateFinalScores(transcriptRef.current, currentEntry.answer, durationSec);
      setScores(finalScores);
      
      // 只有 70 分以上才計入熟練度
      if (finalScores.total >= 70) {
        onUpdateVocab({ ...currentEntry, mastery: (currentEntry.mastery || 0) + finalScores.total });
      }

      setShowResult(true);

      setPhase('reviewing'); 
      await speakTextPromise(currentEntry.answer, 1.0, voicePrefs);
      if (!flowRef.current.active) return;

      const userAudioElement = document.getElementById('user-audio-playback') as HTMLAudioElement;
      if (userAudioElement && userAudioUrl) {
          try {
              await userAudioElement.play();
              await new Promise(r => {
                  userAudioElement.onended = r;
                  userAudioElement.onerror = r;
                  setTimeout(r, 8000); 
              });
          } catch (e) { console.warn("Auto-play failed", e); }
      }

      if (!flowRef.current.active) return;

      if (isAutoLoop || isRandomLoop) {
          setPhase('idle');
          await new Promise(r => setTimeout(r, 1200));
          if (isRandomLoop) handleRandomNext();
          else handleNext();
      } else {
          setIsPlayingFlow(false);
          setPhase('idle');
      }
    } catch(e) { 
      console.error("Speaking coach flow error:", e);
      stopFlow();
    }
  };

  const stopFlow = () => { 
    flowRef.current.active = false; 
    setIsPlayingFlow(false); 
    setPhase('idle'); 
    setIsRecording(false);
    window.speechSynthesis.cancel(); 
    try {
      mediaRecorderRef.current?.stop();
      recognitionRef.current?.stop();
    } catch(e) {}
  };

  const handleNext = () => {
    window.speechSynthesis.cancel();
    setPhase('idle');
    setShowResult(false);
    setAudioURL(null);
    setCurrentIndex(prev => (prev + 1) % filteredData.length);
  };

  const handlePrev = () => {
    window.speechSynthesis.cancel();
    setPhase('idle');
    setShowResult(false);
    setAudioURL(null);
    setCurrentIndex(prev => (prev - 1 + filteredData.length) % filteredData.length);
  };

  const handleRandomNext = () => {
    window.speechSynthesis.cancel();
    setPhase('idle');
    setShowResult(false);
    setAudioURL(null);
    const randIndex = Math.floor(Math.random() * filteredData.length);
    setCurrentIndex(randIndex);
  };

  if (!coachCourse) return (
    <div className="h-full flex flex-col bg-slate-50 dark:bg-slate-950 p-6 overflow-y-auto">
        <h2 className="text-xl font-bold text-slate-800 dark:text-slate-100 mb-6 flex items-center gap-2"><Mic size={24} className="text-indigo-600 dark:text-indigo-400"/> 口說教練</h2>
        <div className="grid grid-cols-1 gap-4 pb-20">{courses.map(course => (
          <button key={course} onClick={() => setCoachCourse(course)} className="bg-white dark:bg-slate-900 p-6 rounded-2xl shadow-sm border border-slate-100 dark:border-slate-800 flex items-center justify-between group hover:border-indigo-200 dark:hover:border-indigo-800 transition-all text-left"><div className="flex items-center gap-4"><div className="p-3 bg-indigo-50 dark:bg-indigo-900/30 rounded-xl text-indigo-600 dark:text-indigo-400 group-hover:bg-indigo-600 group-hover:text-white transition-colors"><Mic size={24} /></div><div><h3 className="font-bold text-slate-800 dark:text-slate-100 text-lg">{course}</h3><p className="text-slate-400 dark:text-slate-500 text-sm">{vocabData.filter(v => v.course === course && !v.isHidden).length} 個題目</p></div></div><ChevronRight className="text-slate-300 dark:text-slate-600 group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors" /></button>
        ))}</div>
    </div>
  );

  const isPass = scores.total >= 70;

  return (
    <div className="flex flex-col h-full bg-slate-50 dark:bg-slate-950 relative overflow-y-auto pb-20">
      <div className="bg-white dark:bg-slate-900 p-4 shadow-sm sticky top-0 z-10">
        <div className="flex justify-between items-center mb-4">
           <div className="flex items-center gap-2 flex-1 min-w-0">
             <button onClick={() => { stopFlow(); setCoachCourse(null); }} className="p-1 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 shrink-0"><ArrowLeft size={20} className="text-slate-500 dark:text-slate-400"/></button>
             <span className="text-xs font-bold text-slate-400 dark:text-slate-500 bg-slate-100 dark:bg-slate-800 px-2 py-1 rounded truncate">{coachCourse}</span>
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
                onChange={(e) => { stopFlow(); setCurrentIndex(Number(e.target.value)); }} 
                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
             >
               {filteredData.map((item, index) => (
                 <option key={index} value={index}>#{index + 1} {item.question.slice(0, 5)}...</option>
               ))}
             </select>
           </div>
        </div>
        <div className="flex items-center justify-between gap-2">
            {!isAutoLoop && !isRandomLoop && <button onClick={handlePrev} className="px-4 py-3 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"><SkipBack size={20} /></button>}
            <button onClick={() => { setIsAutoLoop(!isAutoLoop); setIsRandomLoop(false); if(isPlayingFlow) stopFlow(); }} className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-xl font-bold transition-all ${isAutoLoop ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-200 dark:shadow-none' : 'bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400'}`}><RefreshCcw size={18} className={isAutoLoop ? 'animate-spin-slow' : ''} />自動</button>
            <button onClick={() => { setIsRandomLoop(!isRandomLoop); setIsAutoLoop(false); if(isPlayingFlow) stopFlow(); }} className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-xl font-bold transition-all ${isRandomLoop ? 'bg-purple-600 text-white shadow-lg shadow-purple-200 dark:shadow-none' : 'bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400'}`}><Shuffle size={18} />隨機</button>
            {!isAutoLoop && !isRandomLoop && <button onClick={handleNext} className="px-4 py-3 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"><SkipForward size={20} /></button>}
        </div>
      </div>
      
      <div className="p-6 flex flex-col items-center">
        <div className="w-full max-w-md bg-white dark:bg-slate-900 rounded-3xl shadow-xl border border-slate-100 dark:border-slate-800 p-6 mb-6 relative overflow-hidden min-h-[300px] flex flex-col justify-between">
           {phase !== 'idle' && (<div className="absolute top-0 left-0 w-full h-1 bg-slate-100 dark:bg-slate-800"><div className={`h-full transition-all duration-300 ${phase === 'reading_question' ? 'bg-blue-500 w-1/4' : phase === 'recording' ? 'bg-red-500 w-2/4' : phase === 'scoring' ? 'bg-yellow-500 w-3/4' : 'bg-green-500 w-full'}`} /></div>)}
           
           <div className="text-center mb-6 mt-4 relative">
             <button onClick={() => currentEntry && speakTextPromise(currentEntry.question, 1.0, voicePrefs)} className="absolute right-0 top-0 p-2 text-indigo-200 hover:text-indigo-600 hover:bg-indigo-50 dark:hover:bg-indigo-900 rounded-full transition-all"><Volume2 size={20} /></button>
             <h3 className="text-xl font-bold text-slate-800 dark:text-slate-100 mb-2 px-6">{currentEntry?.question}</h3>
             {isRecording && <div className="flex items-center justify-center gap-2 text-red-500 font-bold animate-pulse"><Mic2 size={20} /> 正在錄音...</div>}
           </div>

           <div className={`transition-all duration-500 w-full ${showResult ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-10 hidden'}`}>
               <div className="mb-6 text-center">
                 <div className="text-2xl font-bold text-indigo-600 dark:text-indigo-400 mb-2 leading-snug">{currentEntry?.answer}</div>
                 <div className="text-sm font-mono text-slate-400 dark:text-slate-500 bg-slate-50 dark:bg-slate-800 inline-block px-3 py-1 rounded-full border border-slate-100 dark:border-slate-700">{currentEntry?.phonetic}</div>
               </div>

               <div className="grid grid-cols-3 gap-2 mb-4">
                 <div className="bg-slate-50 dark:bg-slate-800 p-3 rounded-2xl text-center border border-slate-100 dark:border-slate-700">
                   <div className="text-[10px] text-slate-400 dark:text-slate-500 uppercase font-black mb-1">發音</div>
                   <div className="text-xl font-black text-slate-700 dark:text-slate-200">{scores.pronunciation}</div>
                 </div>
                 <div className="bg-slate-50 dark:bg-slate-800 p-3 rounded-2xl text-center border border-slate-100 dark:border-slate-700">
                   <div className="text-[10px] text-slate-400 dark:text-slate-500 uppercase font-black mb-1">流利</div>
                   <div className="text-xl font-black text-slate-700 dark:text-slate-200">{scores.fluency}</div>
                 </div>
                 <div className="bg-slate-50 dark:bg-slate-800 p-3 rounded-2xl text-center border border-slate-100 dark:border-slate-700">
                   <div className="text-[10px] text-slate-400 dark:text-slate-500 uppercase font-black mb-1">重音</div>
                   <div className="text-xl font-black text-slate-700 dark:text-slate-200">{scores.stress}</div>
                 </div>
               </div>

               <div className={`${isPass ? 'bg-indigo-600 dark:bg-indigo-700' : 'bg-slate-500 dark:bg-slate-600'} p-4 rounded-2xl flex items-center justify-between px-6 shadow-lg shadow-indigo-100 dark:shadow-none mb-6 transition-colors`}>
                 <span className="text-white font-bold">{isPass ? '綜合評分' : '未達標準'}</span>
                 <div className="flex items-center gap-2"><BarChart2 className="text-white/70 w-5 h-5" /><span className="text-3xl font-black text-white">{scores.total}</span></div>
               </div>

               <div className="bg-slate-50 dark:bg-slate-800 p-4 rounded-2xl border border-slate-100 dark:border-slate-700">
                 <div className="flex items-center justify-between mb-2">
                   <span className="text-[10px] font-black text-slate-400 dark:text-slate-500 uppercase flex items-center gap-1"><Headphones size={12} /> 您的錄音回放</span>
                   {phase === 'reviewing' && <div className="text-[10px] text-indigo-500 dark:text-indigo-400 font-bold animate-pulse">播放中...</div>}
                 </div>
                 {audioURL ? <audio id="user-audio-playback" src={audioURL} controls className="w-full h-10" /> : <div className="h-10 bg-slate-100 dark:bg-slate-700 rounded-lg flex items-center justify-center text-xs text-slate-300 dark:text-slate-500">準備中...</div>}
               </div>
           </div>

           {!showResult && (
             <div className="flex-1 flex flex-col items-center justify-center opacity-30">
               <div className="w-24 h-24 bg-slate-100 dark:bg-slate-800 rounded-full flex items-center justify-center mb-4"><Headphones size={48} className="text-slate-300 dark:text-slate-600" /></div>
               <p className="text-sm text-slate-400 dark:text-slate-500 font-bold">聆聽 • 複誦 • 評分</p>
             </div>
           )}
        </div>

        <button 
          onClick={isPlayingFlow ? stopFlow : startFlow} 
          className={`w-full max-w-md py-4 rounded-2xl font-bold text-lg shadow-xl transition-all flex items-center justify-center gap-3 ${isPlayingFlow ? 'bg-red-50 dark:bg-red-900/20 text-red-500 dark:text-red-400 border border-red-100 dark:border-red-900' : 'bg-indigo-600 text-white shadow-indigo-200 dark:shadow-none hover:scale-105 active:scale-95'}`}
        >
          {isPlayingFlow ? <><StopCircle /> 停止測驗</> : <><PlayCircle /> 開始測驗</>}
        </button>
        
        {(isAutoLoop || isRandomLoop) && isPlayingFlow && (
          <div className="mt-4 flex flex-col items-center gap-2">
             <p className="text-xs font-bold text-slate-400 dark:text-slate-500 flex items-center gap-1 animate-pulse"><Activity size={12} /> {isAutoLoop ? '自動' : '隨機'}模式：完成複習後自動跳轉</p>
             <button onClick={stopFlow} className="text-[10px] text-indigo-500 dark:text-indigo-400 font-bold hover:underline">取消循環</button>
          </div>
        )}
      </div>
    </div>
  );
};

export default SpeakingCoachMode;
