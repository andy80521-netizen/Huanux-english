import React, { useState, useEffect, useRef, useMemo } from 'react';
import { 
  ChevronRight, Headphones, PlayCircle, PauseCircle, SkipForward, SkipBack, 
  RefreshCcw, Activity, Clock, ArrowLeft, RotateCw, List, Zap
} from 'lucide-react';
import { VocabItem } from '../constants';
import { speakTextPromise } from '../utils';

interface Props {
  vocabData: VocabItem[];
  courses: string[];
  voicePrefs: { zh?: string, en?: string };
}

// 無聲音訊 Base64，用於保持手機後台運作 (iOS/Android Hack)
const SILENT_AUDIO = "data:audio/mp3;base64,SUQzBAAAAAAAI1RTU0UAAAAPAAADTGF2ZjU4LjI5LjEwMAAAAAAAAAAAAAAA//OEAAAAAAAAAAAAAAAAAAAAAAAASW5mbwAAAA8AAAAEAAABIADAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMD//////////////////////////////////////////////////////////////////wAAAAAATGF2YzU4LjU0AAAAAAAAAAAAAAAAJAAAAAAAAAAAASAA82oskAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

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
  const silentAudioRef = useRef<HTMLAudioElement>(null);
  const audioContextRef = useRef<AudioContext | null>(null); // Web Audio API Keep-Alive
  const wakeLockRef = useRef<any>(null); // Screen Wake Lock
  
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

  // Wake Lock Management
  const requestWakeLock = async () => {
    if ('wakeLock' in navigator) {
      try {
        wakeLockRef.current = await (navigator as any).wakeLock.request('screen');
        console.log('Wake Lock is active');
      } catch (err: any) {
        console.warn(`Wake Lock error: ${err.name}, ${err.message}`);
      }
    }
  };

  const releaseWakeLock = async () => {
    if (wakeLockRef.current) {
      try {
        await wakeLockRef.current.release();
        wakeLockRef.current = null;
        console.log('Wake Lock released');
      } catch (e) {
        console.warn('Wake Lock release error', e);
      }
    }
  };

  // Advanced Background Keep-Alive (AudioContext Oscillator)
  const enableBackgroundAudioHack = () => {
      try {
          // 1. Initialize AudioContext if not exists
          if (!audioContextRef.current) {
              const AudioContext = window.AudioContext || (window as any).webkitAudioContext;
              if (AudioContext) {
                  const ctx = new AudioContext();
                  audioContextRef.current = ctx;
                  
                  // Create a silent oscillator to keep the thread active
                  const osc = ctx.createOscillator();
                  const gain = ctx.createGain();
                  
                  osc.connect(gain);
                  gain.connect(ctx.destination);
                  
                  osc.frequency.value = 20; // Low frequency
                  gain.gain.value = 0.001; // Extremely low volume (but not zero to avoid OS optimization)
                  
                  osc.start();
                  console.log("Background AudioContext Hack Enabled");
              }
          }

          // 2. Resume Context if suspended
          if (audioContextRef.current && audioContextRef.current.state === 'suspended') {
              audioContextRef.current.resume();
          }

          // 3. Play HTML5 Audio element
          if (silentAudioRef.current) {
              silentAudioRef.current.volume = 0.01; // Non-zero volume
              silentAudioRef.current.play().catch(e => console.warn("Silent audio play failed", e));
          }
      } catch (e) {
          console.error("Failed to enable background audio hack", e);
      }
  };

  const disableBackgroundAudioHack = () => {
      if (audioContextRef.current) {
          audioContextRef.current.suspend();
      }
      if (silentAudioRef.current) {
          silentAudioRef.current.pause();
      }
  };

  // Re-acquire wake lock on visibility change
  useEffect(() => {
    const handleVisibilityChange = () => {
       if (document.visibilityState === 'visible' && isPlaying) {
           requestWakeLock();
           // Re-trigger audio context if user comes back
           if (audioContextRef.current?.state === 'suspended') {
               audioContextRef.current.resume();
           }
       }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
        document.removeEventListener('visibilitychange', handleVisibilityChange);
        releaseWakeLock();
    };
  }, [isPlaying]);

  // 取得下一個智慧隨機索引 (取後不放回，直到全部播完才重置)
  const getNextSmartRandomIndex = () => {
      const len = filteredData.length;
      if (len <= 0) return 0;
      if (len === 1) return 0;

      if (unplayedIndicesRef.current.length === 0) {
          let newPool = Array.from({length: len}, (_, i) => i);
          unplayedIndicesRef.current = newPool;
      }

      let poolIndex = Math.floor(Math.random() * unplayedIndicesRef.current.length);
      let nextVocabIndex = unplayedIndicesRef.current[poolIndex];

      if (nextVocabIndex === currentIndex && unplayedIndicesRef.current.length > 1) {
           poolIndex = (poolIndex + 1) % unplayedIndicesRef.current.length;
           nextVocabIndex = unplayedIndicesRef.current[poolIndex];
      }

      unplayedIndicesRef.current.splice(poolIndex, 1);
      return nextVocabIndex;
  };

  const stopAudioImmediately = () => {
      flowRef.current.active = false;
      window.speechSynthesis.cancel();
  };

  // Media Session Handler & Background Audio Management
  useEffect(() => {
      // Media Session
      if ('mediaSession' in navigator && currentEntry) {
          navigator.mediaSession.metadata = new MediaMetadata({
              title: currentEntry.question,
              artist: 'Huanux ENGLISH',
              album: selectedCourse || '',
              artwork: [
                { src: 'https://cdn-icons-png.flaticon.com/512/3845/3845868.png', sizes: '512x512', type: 'image/png' }
              ]
          });
          
          navigator.mediaSession.setActionHandler('play', () => { togglePlayPause(); });
          navigator.mediaSession.setActionHandler('pause', () => { togglePlayPause(); });
          navigator.mediaSession.setActionHandler('previoustrack', handlePrev);
          navigator.mediaSession.setActionHandler('nexttrack', handleNext);
      }
  }, [currentEntry, selectedCourse]);

  useEffect(() => {
      stopAudioImmediately();
      let timer: ReturnType<typeof setTimeout>;

      if (isPlaying && filteredData.length > 0) {
          timer = setTimeout(() => {
             flowRef.current.active = true;
             currentRepeatRef.current = 0; 
             setVisualRepeatCount(1);      
             runPlaybackCycle();
          }, 100); // Increased delay slightly for stability
      }

      return () => {
          clearTimeout(timer);
          stopAudioImmediately();
      };
  }, [isPlaying, currentIndex, playVersion, filteredData, repeatCount, playbackMode, playbackSpeed]);

  const runPlaybackCycle = async () => {
      if (!currentEntry) return;
      
      // Keep-Alive Check: Ensure background hack is active during cycles
      if (isPlaying && (!audioContextRef.current || audioContextRef.current.state === 'suspended')) {
          enableBackgroundAudioHack();
      }

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
          setCurrentIndex(prev => (prev + 1) % filteredData.length); 
      }
  };

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
  
  const handlePrev = () => { 
      stopAudioImmediately(); 
      if (playbackMode === 'random') { 
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
          disableBackgroundAudioHack();
          releaseWakeLock();
      } else {
          setIsPlaying(true);
          requestWakeLock();
          enableBackgroundAudioHack(); // Critical: Start the hack on user interaction
      }
  };

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
      {/* Silent Audio for Background Play - Force playsinline and ensure it is in DOM but hidden via style */}
      <audio 
        ref={silentAudioRef} 
        src={SILENT_AUDIO} 
        loop 
        playsInline 
        muted={false} 
        style={{ pointerEvents: 'none', opacity: 0, position: 'absolute', width: 1, height: 1 }} 
      />

      <div className="absolute inset-0 w-full h-full overflow-hidden pointer-events-none"><div className="absolute top-[-20%] left-[-20%] w-[140%] h-[140%] bg-[radial-gradient(circle,rgba(79,70,229,0.4)_0%,rgba(0,0,0,0)_70%)] opacity-50 blur-3xl animate-pulse-slow"></div></div>
      <div className="p-6 flex justify-between items-center z-10 relative shrink-0"><button onClick={() => { stopAudioImmediately(); setIsPlaying(false); disableBackgroundAudioHack(); setSelectedCourse(null); }} className="p-2 rounded-full bg-white/10 hover:bg-white/20 backdrop-blur-md transition-all"><ArrowLeft size={20} /></button><span className="text-sm font-bold opacity-80 uppercase tracking-widest">Walkman</span><div className="w-10"></div></div>
      
      {/* Main Container */}
      <div className="flex-1 overflow-y-auto z-10 w-full scroll-smooth flex flex-col">
          <div className="flex flex-col items-center flex-1 p-6 max-w-md mx-auto w-full min-h-[300px]">
              
              {/* Playback Status Indicator */}
              <div className="min-h-[2rem] flex items-center justify-center mb-4 gap-2">
                {isPlaying && repeatCount > 1 && (
                    <div className="bg-indigo-600 text-white text-[10px] font-bold px-3 py-1 rounded-full shadow-lg border border-indigo-400 animate-pulse">
                        播放中: {visualRepeatCount} / {repeatCount}
                    </div>
                )}
                {isPlaying && (
                    <div className="flex items-center gap-1.5 bg-green-500/20 px-3 py-1 rounded-full border border-green-500/30">
                        <Zap size={10} className="text-green-400 animate-pulse" />
                        <span className="text-[10px] text-green-300 font-bold">背景播放模式</span>
                    </div>
                )}
              </div>

              {/* Question */}
              <div className="w-full text-center px-2 mb-4">
                  <h3 className="text-xl sm:text-2xl font-bold text-indigo-300 leading-relaxed drop-shadow-md whitespace-pre-wrap break-words">
                    {currentEntry?.question}
                  </h3>
              </div>

              {/* Phonetic */}
              {currentEntry?.phonetic && (
                <div className="mb-6 px-4 py-1.5 rounded-full bg-white/5 border border-white/10 text-slate-300 font-mono text-sm tracking-wider shadow-sm text-center">
                    {currentEntry.phonetic}
                </div>
              )}
              
              {/* Answer */}
              <div className="w-full text-center px-2 mb-8 flex-1 flex items-center justify-center">
                <h2 className="text-3xl sm:text-4xl font-black text-white drop-shadow-xl leading-tight whitespace-pre-wrap break-words">
                    {currentEntry?.answer}
                </h2>
              </div>
              
              <p className="text-slate-500 text-xs font-bold tracking-widest uppercase opacity-70 mb-4">{selectedCourse} • {currentIndex + 1} / {filteredData.length}</p>
          </div>
          
          {/* Control Panel - Fixed at bottom of flow */}
          <div className="w-full shrink-0 p-6 pt-0 max-w-md mx-auto mb-safe">
              <div className="bg-white/10 backdrop-blur-lg rounded-3xl p-5 border border-white/10 shadow-xl space-y-5">
                  {/* Functional Controls */}
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

                  {/* Playback Controls */}
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
  );
};

export default WalkmanMode;