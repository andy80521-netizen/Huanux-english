
import React, { useState, useEffect, useRef, useMemo } from 'react';
import { 
  ChevronRight, Headphones, PlayCircle, PauseCircle, SkipForward, SkipBack, 
  RefreshCcw, Activity, Clock, ArrowLeft, RotateCw, List
} from 'lucide-react';
import { VocabItem } from '../constants';
import { speakTextPromise } from '../utils';

interface Props {
  vocabData: VocabItem[];
  courses: string[];
  voicePrefs: { zh?: string, en?: string };
}

const WalkmanMode: React.FC<Props> = ({ vocabData, courses, voicePrefs }) => {
  const [selectedCourse, setSelectedCourse] = useState<string | null>(null);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  
  // Settings
  const [playbackMode, setPlaybackMode] = useState<'loop' | 'single' | 'random'>('loop');
  const [playbackSpeed, setPlaybackSpeed] = useState(1.0);
  const [repeatCount, setRepeatCount] = useState(1);
  
  // Logic Control
  const [playVersion, setPlayVersion] = useState(0); // 用於強制觸發 useEffect 重播
  const [visualRepeatCount, setVisualRepeatCount] = useState(0); // 用於 UI 顯示目前是第幾次播放
  const flowRef = useRef({ active: false });
  const currentRepeatRef = useRef(0);
  
  // 智慧隨機播放池：記錄本輪尚未播放的索引
  const unplayedIndicesRef = useRef<number[]>([]);

  const filteredData = useMemo(() => {
      return selectedCourse ? vocabData.filter(v => v.course === selectedCourse && !v.isHidden) : [];
  }, [vocabData, selectedCourse]);

  const currentEntry = filteredData.length > 0 ? filteredData[currentIndex] : null;

  // 當課程改變或題目數量改變時，重置隨機池
  useEffect(() => {
      unplayedIndicesRef.current = [];
  }, [selectedCourse, filteredData.length]);

  // 取得下一個智慧隨機索引 (取後不放回，直到全部播完才重置)
  const getNextSmartRandomIndex = () => {
      const len = filteredData.length;
      if (len <= 0) return 0;
      if (len === 1) return 0;

      // 如果池子空了，重新填滿 (新的一輪)
      if (unplayedIndicesRef.current.length === 0) {
          // 建立一個包含 0 到 len-1 的陣列
          let newPool = Array.from({length: len}, (_, i) => i);
          
          // 若這是一輪新的開始，且剛好目前正在播放某一首，
          // 為了避免「上一輪最後一首」跟「新一輪第一首」是同一首 (造成連播兩次)，
          // 我們嘗試先排除掉當前這首，等下次再播它 (除非只剩它一首)。
          // 但為了嚴格遵守「每一輪每一題都要出現」，我們還是包含它，
          // 但可以透過抽樣檢查來盡量避免立即重複。
          unplayedIndicesRef.current = newPool;
      }

      // 從池子中隨機抽出一個位置
      let poolIndex = Math.floor(Math.random() * unplayedIndicesRef.current.length);
      let nextVocabIndex = unplayedIndicesRef.current[poolIndex];

      // 如果剛好抽到目前正在播放的這首 (發生在換輪時)，且池子裡還有別人，那就換一個
      // 這樣可以優化體驗，避免連續聽到同一首
      if (nextVocabIndex === currentIndex && unplayedIndicesRef.current.length > 1) {
           // 簡單策略：取下一個 (若溢出則繞回 0)
           poolIndex = (poolIndex + 1) % unplayedIndicesRef.current.length;
           nextVocabIndex = unplayedIndicesRef.current[poolIndex];
      }

      // 將該索引從池子中移除 (確保本輪不會再播到)
      unplayedIndicesRef.current.splice(poolIndex, 1);

      return nextVocabIndex;
  };

  // 輔助函式：立即停止音訊與邏輯
  const stopAudioImmediately = () => {
      flowRef.current.active = false;
      window.speechSynthesis.cancel();
  };

  // Media Session Handler
  useEffect(() => {
      if ('mediaSession' in navigator && currentEntry) {
          navigator.mediaSession.metadata = new MediaMetadata({
              title: currentEntry.question,
              artist: 'Huanux ENGLISH',
              album: selectedCourse || '',
              artwork: [{ src: 'https://via.placeholder.com/512', sizes: '512x512', type: 'image/png' }]
          });
          
          navigator.mediaSession.setActionHandler('play', () => { setIsPlaying(true); });
          navigator.mediaSession.setActionHandler('pause', () => { setIsPlaying(false); });
          navigator.mediaSession.setActionHandler('previoustrack', handlePrev);
          navigator.mediaSession.setActionHandler('nexttrack', handleNext);
      }
  }, [currentEntry, selectedCourse]);

  // 核心播放控制 Effect
  useEffect(() => {
      stopAudioImmediately();
      
      let timer: ReturnType<typeof setTimeout>;

      if (isPlaying && filteredData.length > 0) {
          timer = setTimeout(() => {
             flowRef.current.active = true;
             currentRepeatRef.current = 0; 
             setVisualRepeatCount(1);      
             runPlaybackCycle();
          }, 50);
      }

      return () => {
          clearTimeout(timer);
          stopAudioImmediately();
      };
  }, [isPlaying, currentIndex, playVersion, filteredData, repeatCount, playbackMode, playbackSpeed]);

  const runPlaybackCycle = async () => {
      if (!currentEntry) return;
      
      await speakTextPromise(currentEntry.question, playbackSpeed, voicePrefs);
      if (!flowRef.current.active) return;
      
      await new Promise(r => setTimeout(r, 800));
      if (!flowRef.current.active) return;
      
      await speakTextPromise(currentEntry.answer, playbackSpeed, voicePrefs);
      if (!flowRef.current.active) return;
      
      await new Promise(r => setTimeout(r, 1200));
      if (!flowRef.current.active) return;

      currentRepeatRef.current += 1;
      
      if (currentRepeatRef.current < repeatCount) {
          setVisualRepeatCount(currentRepeatRef.current + 1);
          runPlaybackCycle(); 
      } else {
          handleAutoNext();
      }
  };

  // 自動播放邏輯 (當前句子結束後)
  const handleAutoNext = () => {
      if (playbackMode === 'single') { 
          setPlayVersion(v => v + 1); 
      } 
      else if (playbackMode === 'random') { 
          const nextRandom = getNextSmartRandomIndex();
          if (nextRandom === currentIndex) {
             setPlayVersion(v => v + 1);
          } else {
             setCurrentIndex(nextRandom); 
          }
      } 
      else { 
          // 列表循環
          setCurrentIndex(prev => (prev + 1) % filteredData.length); 
      }
  };

  // 手動下一首
  const handleNext = () => { 
      stopAudioImmediately(); 
      
      if (playbackMode === 'random') { 
          const nextRandom = getNextSmartRandomIndex();
          if (nextRandom === currentIndex) {
             setPlayVersion(v => v + 1);
          } else {
             setCurrentIndex(nextRandom); 
          }
      } 
      else { 
          setCurrentIndex(prev => (prev + 1) % filteredData.length); 
      } 
  };
  
  // 手動上一首
  const handlePrev = () => { 
      stopAudioImmediately(); 
      
      if (playbackMode === 'random') { 
          // 上一首為了保持體驗簡單，我們還是使用隨機抽樣，或者可以單純倒退
          // 但因為使用者要求的是「隨機播放」的改進，這裡我們使用普通的隨機
          // 避免干擾「下一首」的智慧池邏輯 (如果上一首也從池子拿，會消耗掉未來的題目)
          let randIndex = Math.floor(Math.random() * filteredData.length); 
          if (randIndex === currentIndex && filteredData.length > 1) {
              randIndex = (randIndex + 1) % filteredData.length;
          }
          
          if (randIndex === currentIndex) {
             setPlayVersion(v => v + 1);
          } else {
             setCurrentIndex(randIndex); 
          }
      } 
      else { 
          setCurrentIndex(prev => (prev - 1 + filteredData.length) % filteredData.length); 
      } 
  };
  
  const togglePlaybackMode = () => { 
      stopAudioImmediately();
      const modes: ('loop' | 'single' | 'random')[] = ['loop', 'single', 'random']; 
      const nextIdx = (modes.indexOf(playbackMode) + 1) % modes.length; 
      
      // 當切換到隨機模式時，重置隨機池，確保新的循環開始
      if (modes[nextIdx] === 'random') {
          unplayedIndicesRef.current = [];
      }
      
      setPlaybackMode(modes[nextIdx]); 
  };
  
  const toggleSpeed = () => { 
      stopAudioImmediately();
      const speeds = [0.5, 0.75, 1.0, 1.2, 1.5]; 
      const nextIdx = (speeds.indexOf(playbackSpeed) + 1) % speeds.length; 
      setPlaybackSpeed(speeds[nextIdx]); 
  };
  
  const toggleRepeatCount = () => { 
      stopAudioImmediately();
      setRepeatCount(prev => prev >= 5 ? 1 : prev + 1); 
  };

  const togglePlayPause = () => {
      if (isPlaying) {
          stopAudioImmediately();
          setIsPlaying(false);
      } else {
          setIsPlaying(true);
      }
  };

  // UI Helper
  const getModeDisplay = () => {
      switch(playbackMode) {
          case 'loop': return { icon: <List size={18} />, label: '列表循環' };
          case 'single': return { icon: <RefreshCcw size={18} />, label: '單曲循環' };
          case 'random': return { icon: <Activity size={18} />, label: '隨機循環' };
      }
  };

  if (!selectedCourse) {
      return (
          <div className="h-full flex flex-col bg-slate-50 dark:bg-slate-950 p-6 overflow-y-auto">
              <h2 className="text-xl font-bold text-slate-800 dark:text-slate-100 mb-6 flex items-center gap-2"><Headphones size={24} className="text-indigo-600 dark:text-indigo-400"/> 隨身聽模式</h2>
              <div className="grid grid-cols-1 gap-4 pb-20">
                  {courses.map(course => {
                      const count = vocabData.filter(v => v.course === course && !v.isHidden).length;
                      return (
                          <button key={course} onClick={() => setSelectedCourse(course)} className="bg-white dark:bg-slate-900 p-6 rounded-2xl shadow-sm border border-slate-100 dark:border-slate-800 flex items-center justify-between group hover:border-indigo-200 dark:hover:border-indigo-800 transition-all text-left"><div className="flex items-center gap-4"><div className="p-3 bg-indigo-50 dark:bg-indigo-900/30 rounded-xl text-indigo-600 dark:text-indigo-400 group-hover:bg-indigo-600 group-hover:text-white transition-colors"><Headphones size={24} /></div><div><h3 className="font-bold text-slate-800 dark:text-slate-100 text-lg">{course}</h3><p className="text-slate-400 dark:text-slate-500 text-sm">{count} 個題目</p></div></div><ChevronRight className="text-slate-300 dark:text-slate-600 group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors" /></button>
                      );
                  })}
              </div>
          </div>
      );
  }

  if (filteredData.length === 0) return <div className="p-8 text-center text-slate-500 dark:text-slate-400 flex flex-col items-center justify-center h-full"><p className="mb-4">此課程沒有題目</p><button onClick={() => setSelectedCourse(null)} className="text-indigo-600 dark:text-indigo-400 font-bold">返回課程選擇</button></div>;

  return (
    <div className="flex flex-col h-full bg-slate-900 text-white relative">
      <div className="absolute inset-0 w-full h-full overflow-hidden pointer-events-none"><div className="absolute top-[-20%] left-[-20%] w-[140%] h-[140%] bg-[radial-gradient(circle,rgba(79,70,229,0.4)_0%,rgba(0,0,0,0)_70%)] opacity-50 blur-3xl animate-pulse-slow"></div></div>
      <div className="p-6 flex justify-between items-center z-10 relative shrink-0"><button onClick={() => { stopAudioImmediately(); setIsPlaying(false); setSelectedCourse(null); }} className="p-2 rounded-full bg-white/10 hover:bg-white/20 backdrop-blur-md transition-all"><ArrowLeft size={20} /></button><span className="text-sm font-bold opacity-80 uppercase tracking-widest">Walkman</span><div className="w-10"></div></div>
      <div className="flex-1 overflow-y-auto z-10 w-full scroll-smooth">
          <div className="flex flex-col items-center justify-center min-h-[calc(100%-100px)] p-6 pb-24 max-w-md mx-auto gap-8">
              
              {/* CD Cover Art */}
              <div className="flex-shrink-0 relative">
                  <div className={`w-64 h-64 rounded-[2rem] bg-gradient-to-br from-indigo-500 to-purple-600 shadow-2xl flex items-center justify-center relative overflow-hidden ${isPlaying ? 'scale-105 shadow-indigo-500/50' : 'scale-100'} transition-all duration-700 mx-auto border border-white/10`}>
                      <div className="absolute inset-0 bg-black/10"></div>
                      <Headphones size={80} className="text-white/20 absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2" />
                      <div className="z-10 p-6 text-center w-full">
                          <h3 className="text-xl font-bold leading-relaxed line-clamp-5 break-words drop-shadow-md">{currentEntry?.question}</h3>
                      </div>
                  </div>
                  {/* Status Badge */}
                  {isPlaying && repeatCount > 1 && (
                      <div className="absolute -bottom-3 left-1/2 -translate-x-1/2 bg-indigo-600 text-white text-xs font-bold px-3 py-1 rounded-full shadow-lg border border-indigo-400 animate-pulse whitespace-nowrap z-20">
                          播放中: {visualRepeatCount} / {repeatCount}
                      </div>
                  )}
              </div>

              <div className="w-full flex flex-col items-center gap-6">
                  {/* Text Display */}
                  <div className="text-center w-full space-y-2 px-4">
                      <h2 className="text-2xl font-bold truncate text-white drop-shadow-md min-h-[2rem]">{currentEntry?.answer}</h2>
                      <p className="text-indigo-200 text-sm font-medium tracking-wide">{selectedCourse} • {currentIndex + 1} / {filteredData.length}</p>
                  </div>
                  
                  {/* Control Panel */}
                  <div className="w-full bg-white/10 backdrop-blur-lg rounded-3xl p-5 border border-white/10 shadow-xl space-y-6">
                      
                      {/* 清晰的功能按鈕列 */}
                      <div className="flex flex-col gap-3">
                          <div className="grid grid-cols-2 gap-3">
                                <button onClick={toggleRepeatCount} className="flex items-center justify-center gap-2 bg-white/5 hover:bg-white/10 active:bg-white/20 py-3 rounded-xl transition-all border border-white/5 group">
                                    <span className="p-1.5 bg-indigo-500/30 rounded-full text-indigo-300 group-hover:text-white transition-colors"><RotateCw size={16} /></span>
                                    <span className="text-xs font-bold text-indigo-100">單句重複: {repeatCount} 次</span>
                                </button>
                                <button onClick={toggleSpeed} className="flex items-center justify-center gap-2 bg-white/5 hover:bg-white/10 active:bg-white/20 py-3 rounded-xl transition-all border border-white/5 group">
                                    <span className="p-1.5 bg-indigo-500/30 rounded-full text-indigo-300 group-hover:text-white transition-colors"><Clock size={16} /></span>
                                    <span className="text-xs font-bold text-indigo-100">語速: {playbackSpeed}x</span>
                                </button>
                          </div>
                          <button onClick={togglePlaybackMode} className="w-full flex items-center justify-center gap-2 bg-white/5 hover:bg-white/10 active:bg-white/20 py-3 rounded-xl transition-all border border-white/5 group">
                              <span className="p-1.5 bg-indigo-500/30 rounded-full text-indigo-300 group-hover:text-white transition-colors">{getModeDisplay().icon}</span>
                              <span className="text-xs font-bold text-indigo-100">播放模式: {getModeDisplay().label}</span>
                          </button>
                      </div>

                      {/* 播放控制列 */}
                      <div className="flex items-center justify-around pt-2">
                          <button onClick={handlePrev} className="p-4 text-white/70 hover:text-white hover:scale-110 transition-all active:scale-95"><SkipBack size={32} /></button>
                          <button onClick={togglePlayPause} className="w-20 h-20 rounded-full bg-white text-indigo-600 flex items-center justify-center shadow-2xl shadow-indigo-500/50 hover:scale-105 hover:bg-indigo-50 active:scale-95 transition-all">
                              {isPlaying ? <PauseCircle size={48} fill="currentColor" /> : <PlayCircle size={48} fill="currentColor" />}
                          </button>
                          <button onClick={handleNext} className="p-4 text-white/70 hover:text-white hover:scale-110 transition-all active:scale-95"><SkipForward size={32} /></button>
                      </div>
                  </div>
              </div>
          </div>
      </div>
    </div>
  );
};

export default WalkmanMode;
