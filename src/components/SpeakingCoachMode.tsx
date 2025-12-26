import React, { useState, useEffect, useRef, useMemo } from 'react';
import { 
  Mic, Mic2, StopCircle, PlayCircle, SkipForward, SkipBack, RefreshCcw, Shuffle, ArrowLeft, Volume2, BarChart2, Headphones, ChevronRight, Activity, Loader2, Zap, AlertCircle, Trophy
} from 'lucide-react';
import { VocabItem, BADGE_LEVELS, LISTENING_BADGE_LEVELS } from '../constants';
import { speakTextPromise, calculateSimilarity, getBadgeInfo, calculateTierProgress } from '../utils';

// 無聲 MP3 Base64，用於欺騙 iOS 保持 Audio Session 活躍
const SILENT_AUDIO = "data:audio/mp3;base64,SUQzBAAAAAAAI1RTU0UAAAAPAAADTGF2ZjU4LjI5LjEwMAAAAAAAAAAAAAAA//OEAAAAAAAAAAAAAAAAAAAAAAAASW5mbwAAAA8AAAAEAAABIADAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMD//////////////////////////////////////////////////////////////////wAAAAAATGF2YzU4LjU0AAAAAAAAAAAAAAAAJAAAAAAAAAAAASAA82oskAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

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
  const [resultMastery, setResultMastery] = useState<number | null>(null); 
  const [audioURL, setAudioURL] = useState<string | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [isMicReady, setIsMicReady] = useState(false); 
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [loopTrigger, setLoopTrigger] = useState(0); // Trigger for same-index looping
  
  // Resources
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null); 
  const audioChunksRef = useRef<Blob[]>([]);
  const transcriptRef = useRef<string>(''); 
  const recognitionRef = useRef<any>(null);
  const flowRef = useRef({ active: false });
  const audioRef = useRef<HTMLAudioElement>(null);
  const silentAudioRef = useRef<HTMLAudioElement>(null);
  const audioContextRef = useRef<AudioContext | null>(null); 
  
  // Smart Detection Refs
  const recordingResolverRef = useRef<(() => void) | null>(null); 
  const speechEndTimerRef = useRef<any>(null);

  // Smart Random Pool
  const unplayedIndicesRef = useRef<number[]>([]);

  const filteredData = useMemo(() => { return coachCourse ? vocabData.filter(v => v.course === coachCourse && !v.isHidden) : []; }, [vocabData, coachCourse]);
  const currentEntry = filteredData.length > 0 ? filteredData[currentIndex] : null;

  // Reset Smart Random Pool when course changes
  useEffect(() => {
      unplayedIndicesRef.current = [];
  }, [coachCourse, filteredData.length]);

  useEffect(() => {
      setResultMastery(null);
  }, [currentIndex, loopTrigger]);

  // Initialize Speech Recognition
  useEffect(() => {
    if ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) {
        const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
        try {
            recognitionRef.current = new SpeechRecognition();
            recognitionRef.current.continuous = true; 
            recognitionRef.current.interimResults = true;
            recognitionRef.current.lang = 'en-US';
            
            recognitionRef.current.onresult = (event: any) => {
                let finalTranscript = '';
                let interimTranscript = '';
                let hasFinal = false;
                
                for (let i = event.resultIndex; i < event.results.length; ++i) {
                    if (event.results[i].isFinal) {
                        finalTranscript += event.results[i][0].transcript;
                        hasFinal = true;
                    } else {
                        interimTranscript += event.results[i][0].transcript;
                    }
                }
                
                const txt = finalTranscript || interimTranscript;
                if (txt) {
                    transcriptRef.current = txt;
                }

                // Smart Loop Logic
                if (hasFinal && flowRef.current.active) {
                    if (speechEndTimerRef.current) clearTimeout(speechEndTimerRef.current);
                    speechEndTimerRef.current = setTimeout(() => {
                        if (recordingResolverRef.current) {
                            console.log("Smart Detect: Speech finished, advancing...");
                            recordingResolverRef.current(); 
                        }
                    }, 800);
                }
            };
            
            recognitionRef.current.onerror = (event: any) => {
                console.warn("Speech Recognition Error (Ignored):", event.error);
            };

        } catch (e) {
            console.warn("Speech Recognition not supported properly");
        }
    }
    
    return () => {
        stopFlow(true); 
    };
  }, []);

  // Watch index for auto-loop triggers
  useEffect(() => {
    if ((isAutoLoop || isRandomLoop) && isPlayingFlow && flowRef.current.active && filteredData.length > 0) {
      const timer = setTimeout(() => {
        startFlow(false); 
      }, 800); 
      return () => clearTimeout(timer);
    }
  }, [currentIndex, loopTrigger]);

  // --- AUDIO CONTEXT HACK FOR iOS ---
  const enableBackgroundAudioHack = () => {
      try {
          if (!audioContextRef.current) {
              const AudioContext = window.AudioContext || (window as any).webkitAudioContext;
              if (AudioContext) {
                  const ctx = new AudioContext();
                  audioContextRef.current = ctx;
                  const osc = ctx.createOscillator();
                  const gain = ctx.createGain();
                  osc.connect(gain);
                  gain.connect(ctx.destination);
                  osc.frequency.value = 20; 
                  gain.gain.value = 0.001; 
                  osc.start();
                  console.log("AudioContext Hack Enabled");
              }
          }
          if (audioContextRef.current && audioContextRef.current.state === 'suspended') {
              audioContextRef.current.resume();
          }
      } catch (e) {
          console.error("Audio Hack Failed", e);
      }
  };

  const calculateFinalScores = (userText: string, targetText: string, durationSec: number) => {
      if (!userText || userText.trim().length === 0) {
          return { pronunciation: 0, fluency: 0, stress: 0, total: 0 };
      }
      
      const rawSimilarity = calculateSimilarity(userText, targetText);
      
      let pronunciationScore = rawSimilarity;
      if (rawSimilarity > 0) {
          pronunciationScore = Math.min(100, Math.round(rawSimilarity + (100 - rawSimilarity) * 0.5));
      }

      const targetWordCount = targetText.split(/\s+/).length;
      const userWordCount = userText.split(/\s+/).length;
      
      let fluencyScore = 100;
      if (targetWordCount <= 1) {
          fluencyScore = pronunciationScore > 60 ? 100 : 50;
      } else {
          const idealMinTime = targetWordCount * 0.4; 
          const idealMaxTime = targetWordCount * 0.8 + 1.5; 
          if (durationSec > idealMaxTime) fluencyScore -= (durationSec - idealMaxTime) * 10; 
          else if (durationSec < idealMinTime) fluencyScore -= (idealMinTime - durationSec) * 20; 
          fluencyScore = Math.round(fluencyScore * Math.min(1, userWordCount / targetWordCount));
      }
      fluencyScore = Math.max(0, Math.min(100, fluencyScore));

      let stressScore = Math.round(pronunciationScore * 0.7 + fluencyScore * 0.3);
      if (pronunciationScore > 80) stressScore = Math.min(100, stressScore + 5);

      const totalScore = Math.round((pronunciationScore + fluencyScore + stressScore) / 3);
      return { pronunciation: pronunciationScore, fluency: fluencyScore, stress: stressScore, total: totalScore };
  };

  const getSupportedMimeType = () => {
    const types = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/aac'];
    for (const type of types) {
      if (MediaRecorder.isTypeSupported(type)) return type;
    }
    return '';
  };

  const ensureMicrophoneStream = async () => {
      if (streamRef.current && streamRef.current.active) {
          const audioTracks = streamRef.current.getAudioTracks();
          if (audioTracks.length > 0 && audioTracks[0].readyState === 'live' && !audioTracks[0].muted) {
              return streamRef.current;
          } else {
              console.warn("Stream exists but track is dead or muted, refreshing...");
          }
      }

      try {
          const stream = await navigator.mediaDevices.getUserMedia({ 
            audio: {
                echoCancellation: false, 
                noiseSuppression: true,
                autoGainControl: true
            } 
          });
          streamRef.current = stream;
          setIsMicReady(true);
          return stream;
      } catch (e) {
          console.error("Microphone access failed:", e);
          setIsMicReady(false);
          throw e;
      }
  };

  const releaseMicrophone = () => {
    if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
        streamRef.current = null;
        setIsMicReady(false);
    }
    if (audioContextRef.current) {
        audioContextRef.current.close().catch(() => {});
        audioContextRef.current = null;
    }
  };

  const startFlow = async (isUserGesture = true) => {
    if (!currentEntry || isRecording) return;
    
    if (isUserGesture) {
        if (silentAudioRef.current && silentAudioRef.current.paused) {
            silentAudioRef.current.play().catch(() => {});
        }
        enableBackgroundAudioHack();
    }
    
    flowRef.current.active = true; 
    setIsPlayingFlow(true); 
    setShowResult(false); 
    setAudioURL(null);
    setErrorMsg(null);
    setResultMastery(null);
    transcriptRef.current = ''; 
    audioChunksRef.current = []; 
    recordingResolverRef.current = null;
    if (speechEndTimerRef.current) clearTimeout(speechEndTimerRef.current);
    
    try {
      setPhase('reading_question'); 
      await speakTextPromise(currentEntry.question, 1.0, voicePrefs); 
      if (!flowRef.current.active) return;

      setPhase('recording');
      
      const wordCount = currentEntry.answer.split(' ').length;
      const recordDuration = Math.max(3500, (wordCount * 800) + 2000);

      let stream;
      let isErrorState = false;

      try {
        stream = await ensureMicrophoneStream();
      } catch (err) {
        console.warn("Loop Mic Fail (Recovering...):", err);
        setErrorMsg("麥克風無法存取 (iOS限制)，跳過本題...");
        isErrorState = true;
      }

      const startTime = Date.now();

      if (!isErrorState && stream) {
          const startRecognition = () => {
              if (!recognitionRef.current) return;
              try { recognitionRef.current.abort(); } catch(e) {}
              
              setTimeout(() => {
                 if (!flowRef.current.active) return;
                 try {
                     recognitionRef.current.start();
                 } catch(e) {
                 }
              }, 50);
          };

          const startRecorder = () => {
              const mimeType = getSupportedMimeType();
              const options = mimeType ? { mimeType } : undefined;
              
              try {
                  mediaRecorderRef.current = new MediaRecorder(stream, options);
                  mediaRecorderRef.current.ondataavailable = (e) => {
                    if (e.data && e.data.size > 0) audioChunksRef.current.push(e.data);
                  };
                  mediaRecorderRef.current.start(200); 
              } catch (e) {
                  console.error("MediaRecorder start failed:", e);
                  isErrorState = true; 
              }
          };

          startRecognition();
          startRecorder();
          setIsRecording(true);
      }

      if (isErrorState) {
          await new Promise(r => setTimeout(r, 2000));
      } else {
          const maxTimePromise = new Promise<void>(resolve => setTimeout(resolve, recordDuration));
          const smartDetectPromise = new Promise<void>(resolve => {
              recordingResolverRef.current = resolve;
          });
          await Promise.race([maxTimePromise, smartDetectPromise]);
      }
      
      setIsRecording(false);
      recordingResolverRef.current = null; 
      
      try { recognitionRef.current?.stop(); } catch(e) {}
      
      let blobUrl = '';
      if (!isErrorState && mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
          await new Promise<void>(resolve => {
              if (!mediaRecorderRef.current) { resolve(); return; }
              mediaRecorderRef.current.onstop = () => {
                  try {
                      const recordedType = mediaRecorderRef.current?.mimeType || 'audio/webm';
                      const audioBlob = new Blob(audioChunksRef.current, { type: recordedType });
                      if (audioBlob.size > 0) {
                          blobUrl = URL.createObjectURL(audioBlob);
                          setAudioURL(blobUrl);
                          if (audioRef.current) {
                              audioRef.current.src = blobUrl;
                              audioRef.current.load();
                          }
                      }
                  } catch(e) { console.warn("Blob creation failed", e); }
                  resolve();
              };
              mediaRecorderRef.current.stop();
          });
      }

      if (!flowRef.current.active) return;

      setPhase('scoring');
      
      const durationSec = (Date.now() - startTime) / 1000;
      await new Promise(r => setTimeout(r, 600));
      
      const finalScores = calculateFinalScores(transcriptRef.current, currentEntry.answer, durationSec);
      setScores(finalScores);
      
      const currentMastery = currentEntry.mastery || 0;
      let newMastery = currentMastery;

      if (finalScores.total >= 50) {
        newMastery = currentMastery + finalScores.total;
        onUpdateVocab({ ...currentEntry, mastery: newMastery });
      }
      setResultMastery(newMastery);

      setShowResult(true);

      setPhase('reviewing'); 
      
      await speakTextPromise(currentEntry.answer, 1.0, voicePrefs);
      if (!flowRef.current.active) return;

      if (audioRef.current && blobUrl) {
          try {
              audioRef.current.volume = 1.0;
              await new Promise<void>((resolve) => {
                  const el = audioRef.current;
                  if (!el) { resolve(); return; }
                  const onEnded = () => { el.removeEventListener('ended', onEnded); resolve(); };
                  const safety = setTimeout(() => { el.removeEventListener('ended', onEnded); resolve(); }, 30000);
                  el.addEventListener('ended', onEnded);
                  el.play().catch(e => {
                      clearTimeout(safety);
                      setTimeout(resolve, 1000);
                  });
              });
          } catch (e) { console.warn("Audio playback error", e); }
      }

      if (!flowRef.current.active) return;

      if (isAutoLoop || isRandomLoop) {
          setPhase('idle');
          await new Promise(r => setTimeout(r, 800)); 
          
          if (isRandomLoop) handleRandomNext(true); 
          else handleNext(true); 
      } else {
          stopFlow(false); 
      }

    } catch(e) { 
      console.error("Flow Error:", e);
      stopFlow(true); 
    }
  };

  const stopFlow = (fullyRelease = true) => { 
    flowRef.current.active = false; 
    setIsPlayingFlow(false); 
    setPhase('idle'); 
    setIsRecording(false);
    recordingResolverRef.current = null;
    if (speechEndTimerRef.current) clearTimeout(speechEndTimerRef.current);
    window.speechSynthesis.cancel(); 
    
    try {
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
          mediaRecorderRef.current.stop();
      }
      if (recognitionRef.current) recognitionRef.current.abort();
      
      if (audioRef.current) {
          audioRef.current.pause();
          audioRef.current.currentTime = 0;
      }

      if (fullyRelease) {
          releaseMicrophone();
          if (silentAudioRef.current) {
              silentAudioRef.current.pause();
          }
      }
    } catch(e) { console.warn(e); }
  };

  const handleNext = (retainStream = false) => {
    if (!retainStream) stopFlow(true); 
    else {
        setShowResult(false);
        setAudioURL(null);
        setPhase('idle');
        transcriptRef.current = '';
        setErrorMsg(null);
    }
    window.speechSynthesis.cancel();
    setCurrentIndex(prev => (prev + 1) % filteredData.length);
  };

  const handlePrev = () => {
    stopFlow(true); 
    setPhase('idle');
    setShowResult(false);
    setAudioURL(null);
    setErrorMsg(null);
    setCurrentIndex(prev => (prev - 1 + filteredData.length) % filteredData.length);
  };

  const getNextSmartRandomIndex = () => {
      const len = filteredData.length;
      if (len <= 0) return 0;
      if (len === 1) return 0;

      if (unplayedIndicesRef.current.length === 0) {
          unplayedIndicesRef.current = Array.from({length: len}, (_, i) => i);
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

  const handleRandomNext = (retainStream = false) => {
    if (!retainStream) stopFlow(true);
    else {
        setShowResult(false);
        setAudioURL(null);
        setPhase('idle');
        transcriptRef.current = '';
        setErrorMsg(null);
    }
    window.speechSynthesis.cancel();
    
    const nextIndex = getNextSmartRandomIndex();
    if (nextIndex === currentIndex) {
        setLoopTrigger(prev => prev + 1);
    } else {
        setCurrentIndex(nextIndex);
    }
  };

  if (!coachCourse) return (
    <div className="h-full flex flex-col bg-slate-50 dark:bg-slate-950 p-6 overflow-y-auto">
        <h2 className="text-xl font-bold text-slate-800 dark:text-slate-100 mb-6 flex items-center gap-2"><Mic size={24} className="text-indigo-600 dark:text-indigo-400"/> 口說教練</h2>
        <div className="grid grid-cols-1 gap-4 pb-20">{courses.map(course => (
          <button key={course} onClick={() => setCoachCourse(course)} className="bg-white dark:bg-slate-900 p-6 rounded-2xl shadow-sm border border-slate-100 dark:border-slate-800 flex items-center justify-between group hover:border-indigo-200 dark:hover:border-indigo-800 transition-all text-left"><div className="flex items-center gap-4"><div className="p-3 bg-indigo-50 dark:bg-indigo-900/30 rounded-xl text-indigo-600 dark:text-indigo-400 group-hover:bg-indigo-600 group-hover:text-white transition-colors"><Mic size={24} /></div><div><h3 className="font-bold text-slate-800 dark:text-slate-100 text-lg">{course}</h3><p className="text-slate-400 dark:text-slate-500 text-sm">{vocabData.filter(v => v.course === course && !v.isHidden).length} 個題目</p></div></div><ChevronRight className="text-slate-300 dark:text-slate-600 group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors" /></button>
        ))}</div>
    </div>
  );

  const isPass = scores.total >= 50; 
  // Get Current Scores
  const currentSpeakingScore = resultMastery !== null ? resultMastery : (currentEntry?.mastery || 0);
  const currentListeningScore = currentEntry?.listeningMastery || 0;
  
  const speakInfo = getBadgeInfo(currentSpeakingScore, BADGE_LEVELS);
  const listenInfo = getBadgeInfo(currentListeningScore, LISTENING_BADGE_LEVELS);
  
  const speakProgress = calculateTierProgress(currentSpeakingScore, speakInfo.currentBadge.threshold, speakInfo.nextBadge?.threshold);
  const listenProgress = calculateTierProgress(currentListeningScore, listenInfo.currentBadge.threshold, listenInfo.nextBadge?.threshold);


  return (
    <div className="flex flex-col h-full bg-slate-50 dark:bg-slate-950 relative overflow-y-auto pb-20">
      {/* iOS Silent Audio Keep-Alive */}
      <audio ref={silentAudioRef} src={SILENT_AUDIO} loop muted={false} playsInline className="hidden" />

      <div className="bg-white dark:bg-slate-900 p-4 shadow-sm sticky top-0 z-10">
        <div className="flex justify-between items-center mb-4">
           <div className="flex items-center gap-2 flex-1 min-w-0">
             <button onClick={() => { stopFlow(true); setCoachCourse(null); }} className="p-1 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 shrink-0"><ArrowLeft size={20} className="text-slate-500 dark:text-slate-400"/></button>
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
                onChange={(e) => { stopFlow(true); setCurrentIndex(Number(e.target.value)); }} 
                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
             >
               {filteredData.map((item, index) => (
                 <option key={index} value={index}>#{index + 1} {item.question.slice(0, 5)}...</option>
               ))}
             </select>
           </div>
        </div>
        <div className="flex items-center justify-between gap-2">
            {!isAutoLoop && !isRandomLoop && <button onClick={() => handlePrev()} className="px-4 py-3 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"><SkipBack size={20} /></button>}
            <button onClick={() => { setIsAutoLoop(!isAutoLoop); setIsRandomLoop(false); if(isPlayingFlow) stopFlow(false); }} className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-xl font-bold transition-all ${isAutoLoop ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-200 dark:shadow-none' : 'bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400'}`}><RefreshCcw size={18} className={isAutoLoop ? 'animate-spin-slow' : ''} />自動</button>
            <button onClick={() => { setIsRandomLoop(!isRandomLoop); setIsAutoLoop(false); if(isPlayingFlow) stopFlow(false); }} className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-xl font-bold transition-all ${isRandomLoop ? 'bg-purple-600 text-white shadow-lg shadow-purple-200 dark:shadow-none' : 'bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400'}`}><Shuffle size={18} />隨機</button>
            {!isAutoLoop && !isRandomLoop && <button onClick={() => handleNext()} className="px-4 py-3 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"><SkipForward size={20} /></button>}
        </div>
      </div>
      
      <div className="p-6 flex flex-col items-center">
        <div className="w-full max-w-md bg-white dark:bg-slate-900 rounded-3xl shadow-xl border border-slate-100 dark:border-slate-800 p-6 mb-6 relative overflow-hidden min-h-[300px] flex flex-col justify-between">
           {phase !== 'idle' && (<div className="absolute top-0 left-0 w-full h-1 bg-slate-100 dark:bg-slate-800"><div className={`h-full transition-all duration-300 ${phase === 'reading_question' ? 'bg-blue-500 w-1/4' : phase === 'recording' ? 'bg-red-500 w-2/4' : phase === 'scoring' ? 'bg-yellow-500 w-3/4' : 'bg-green-500 w-full'}`} /></div>)}
           
           <div className="text-center mb-6 mt-4 relative">
             <button onClick={() => currentEntry && speakTextPromise(currentEntry.question, 1.0, voicePrefs)} className="absolute right-0 top-0 p-2 text-indigo-200 hover:text-indigo-600 hover:bg-indigo-50 dark:hover:bg-indigo-900 rounded-full transition-all"><Volume2 size={20} /></button>
             <h3 className="text-xl font-bold text-slate-800 dark:text-slate-100 mb-2 px-6">{currentEntry?.question}</h3>
             {isRecording && <div className="flex items-center justify-center gap-2 text-red-500 font-bold animate-pulse"><Mic2 size={20} /> 正在錄音...</div>}
             {errorMsg && <div className="flex items-center justify-center gap-1 text-orange-500 text-xs font-bold mt-2 animate-bounce"><AlertCircle size={14} /> {errorMsg}</div>}
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

               <div className={`${isPass ? 'bg-indigo-600 dark:bg-indigo-700' : 'bg-slate-500 dark:bg-slate-600'} p-4 rounded-2xl flex items-center justify-between px-6 shadow-lg shadow-indigo-100 dark:shadow-none mb-4 transition-colors`}>
                 <span className="text-white font-bold">{isPass ? '綜合評分' : '未達標準'}</span>
                 <div className="flex items-center gap-2"><BarChart2 className="text-white/70 w-5 h-5" /><span className="text-3xl font-black text-white">{scores.total}</span></div>
               </div>
               
               {/* Dual Progress Bars */}
               <div className="bg-slate-50 dark:bg-slate-800 p-5 rounded-2xl border border-slate-100 dark:border-slate-700 mb-6">
                    <div className="flex items-center gap-2 mb-4">
                        <Trophy size={16} className="text-orange-500" />
                        <span className="text-xs font-black text-slate-500 dark:text-slate-400 uppercase tracking-wider">各項熟練度進度</span>
                    </div>
                    
                    <div className="space-y-4">
                        {/* Speaking Bar (Active) */}
                        <div>
                            <div className="flex justify-between items-end mb-1.5">
                                <div className="flex items-center gap-2">
                                    <span className="text-xs font-bold text-slate-700 dark:text-slate-200">口說</span>
                                    <span className="text-[10px] font-mono text-slate-400 dark:text-slate-500">{currentSpeakingScore} XP</span>
                                    {isPass && <span className="text-[10px] font-bold text-emerald-500 bg-emerald-50 dark:bg-emerald-900/30 px-1.5 rounded animate-pulse">+{scores.total}</span>}
                                </div>
                                <span className={`text-[10px] font-bold ${speakInfo.currentBadge.color}`}>{speakInfo.currentBadge.name}</span>
                            </div>
                            <div className="h-2 w-full bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
                                <div className="h-full bg-emerald-500 rounded-full transition-all duration-1000 ease-out" style={{width: `${speakProgress}%`}}></div>
                            </div>
                        </div>

                        {/* Listening Bar (Passive) */}
                        <div>
                            <div className="flex justify-between items-end mb-1.5">
                                <div className="flex items-center gap-2">
                                    <span className="text-xs font-bold text-slate-700 dark:text-slate-200">聽力</span>
                                    <span className="text-[10px] font-mono text-slate-400 dark:text-slate-500">{currentListeningScore} XP</span>
                                </div>
                                <span className={`text-[10px] font-bold ${listenInfo.currentBadge.color}`}>{listenInfo.currentBadge.name}</span>
                            </div>
                            <div className="h-2 w-full bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
                                <div className="h-full bg-orange-500 rounded-full transition-all duration-500 ease-out" style={{width: `${listenProgress}%`}}></div>
                            </div>
                        </div>
                    </div>
               </div>

               <div className="bg-slate-50 dark:bg-slate-800 p-4 rounded-2xl border border-slate-100 dark:border-slate-700 relative">
                 <div className="flex items-center justify-between mb-2">
                   <span className="text-[10px] font-black text-slate-400 dark:text-slate-500 uppercase flex items-center gap-1"><Headphones size={12} /> 您的錄音回放</span>
                   {phase === 'reviewing' && <div className="text-[10px] text-indigo-500 dark:text-indigo-400 font-bold animate-pulse">播放中...</div>}
                 </div>
                 
                 <audio 
                    ref={audioRef}
                    controls 
                    playsInline 
                    className={`w-full h-10 ${audioURL ? '' : 'hidden'}`}
                 />
                 {!audioURL && <div className="h-10 bg-slate-100 dark:bg-slate-700 rounded-lg flex items-center justify-center text-xs text-slate-300 dark:text-slate-500">準備中...</div>}
               </div>
           </div>

           {!showResult && (
             <div className="flex-1 flex flex-col items-center justify-center opacity-30">
               <div className="w-24 h-24 bg-slate-100 dark:bg-slate-800 rounded-full flex items-center justify-center mb-4"><Headphones size={48} className="text-slate-300 dark:text-slate-600" /></div>
               <p className="text-sm text-slate-400 dark:text-slate-500 font-bold">聆聽 • 複誦 • 評分</p>
               {phase === 'recording' && !isMicReady && !errorMsg && <p className="text-[10px] text-red-500 mt-2">連接麥克風中...</p>}
             </div>
           )}
        </div>

        <button 
          onClick={() => isPlayingFlow ? stopFlow(true) : startFlow(true)} 
          className={`w-full max-w-md py-4 rounded-2xl font-bold text-lg shadow-xl transition-all flex items-center justify-center gap-3 ${isPlayingFlow ? 'bg-red-50 dark:bg-red-900/20 text-red-500 dark:text-red-400 border border-red-100 dark:border-red-900' : 'bg-indigo-600 text-white shadow-indigo-200 dark:shadow-none hover:scale-105 active:scale-95'}`}
        >
          {isPlayingFlow ? <><StopCircle /> 停止測驗</> : <><PlayCircle /> 開始測驗</>}
        </button>
        
        {(isAutoLoop || isRandomLoop) && isPlayingFlow && (
          <div className="mt-4 flex flex-col items-center gap-2">
             <p className="text-xs font-bold text-slate-400 dark:text-slate-500 flex items-center gap-1 animate-pulse"><Zap size={12} className="text-orange-500"/> {isAutoLoop ? '自動' : '隨機'}模式：智慧偵測講完即評分</p>
             <button onClick={() => stopFlow(true)} className="text-[10px] text-indigo-500 dark:text-indigo-400 font-bold hover:underline">取消循環</button>
          </div>
        )}
      </div>
    </div>
  );
};

export default SpeakingCoachMode;