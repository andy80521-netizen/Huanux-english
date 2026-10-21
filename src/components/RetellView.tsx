import React, { useEffect, useRef, useState } from 'react';
import { Material } from '../types';
import { ChevronLeft, Mic, Square, Loader2, Play, RotateCcw, Headphones, ChevronDown, ChevronUp } from 'lucide-react';
import { transcribeRecording, RetellFeedback } from '../services/gemini';
import { RetellSegment, RetellTargetPattern, RetellRecord, reviewRetell, saveRetell, listRetells } from '../services/retell';
import { getSpeechUrl } from '../services/speech';
import { getSupportedMimeType } from '../utils/mediaRecorder';
import { SILENT_AUDIO } from '../utils';
import RetellFeedbackPanel from './RetellFeedbackPanel';

const MAX_SECONDS = 180;

type Phase = 'idle' | 'recording' | 'processing' | 'done' | 'error';

interface Props {
  material: Material;
  segment: RetellSegment;
  segmentIndex: number;
  targetPatterns: RetellTargetPattern[];
  onBack: () => void;
}

export default function RetellView({ material, segment, segmentIndex, targetPatterns, onBack }: Props) {
  const [phase, setPhase] = useState<Phase>('idle');
  const [seconds, setSeconds] = useState(0);
  const [processingText, setProcessingText] = useState('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [transcript, setTranscript] = useState('');
  const [feedback, setFeedback] = useState<RetellFeedback | null>(null);
  const [segmentPlaying, setSegmentPlaying] = useState(false);
  const [modelLoading, setModelLoading] = useState(false);
  const [history, setHistory] = useState<RetellRecord[]>([]);
  const [expandedHistoryId, setExpandedHistoryId] = useState<string | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<number | null>(null);
  const blobRef = useRef<Blob | null>(null);
  const transcriptRef = useRef<string>('');
  const playbackUrlRef = useRef<string | null>(null);
  const segmentAudioRef = useRef<HTMLAudioElement>(null);
  const speechAudioRef = useRef<HTMLAudioElement>(null);
  const recordedAudioRef = useRef<HTMLAudioElement>(null);

  const sentences = segment.sentenceIds
    .map(id => material.sentences.find(s => s.id === id))
    .filter((s): s is NonNullable<typeof s> => !!s);
  const segmentText = sentences.map(s => s.text).join(' ');
  const segStart = sentences.length > 0 ? sentences[0].startTime : 0;
  const segEnd = sentences.length > 0 ? sentences[sentences.length - 1].endTime : 0;

  const loadHistory = () => {
    listRetells(material.id)
      .then(list => setHistory(list.filter(r => r.segmentIndex === segmentIndex)))
      .catch(err => console.warn('[複述] 讀取紀錄失敗:', err));
  };

  useEffect(() => {
    loadHistory();
    return () => {
      if (timerRef.current) window.clearInterval(timerRef.current);
      if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
        mediaRecorderRef.current.onstop = null;
        mediaRecorderRef.current.stop();
      }
      streamRef.current?.getTracks().forEach(t => t.stop());
      segmentAudioRef.current?.pause();
      speechAudioRef.current?.pause();
      recordedAudioRef.current?.pause();
      if (playbackUrlRef.current) URL.revokeObjectURL(playbackUrlRef.current);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggleSegmentAudio = () => {
    const el = segmentAudioRef.current;
    if (!el || !material.audioUrl) return;
    if (segmentPlaying) {
      el.pause();
      setSegmentPlaying(false);
      return;
    }
    el.src = `${material.audioUrl}#t=${Math.max(0, segStart)}${segEnd > segStart ? `,${segEnd}` : ''}`;
    el.play().then(() => setSegmentPlaying(true)).catch(() => setSegmentPlaying(false));
  };

  const handleSegmentTimeUpdate = () => {
    const el = segmentAudioRef.current;
    if (el && segEnd > 0 && el.currentTime >= segEnd) {
      el.pause();
      setSegmentPlaying(false);
    }
  };

  const runAnalysis = async () => {
    const blob = blobRef.current;
    if (!blob) return;
    setPhase('processing');
    setErrorMsg(null);
    try {
      let text = transcriptRef.current;
      if (!text) {
        setProcessingText('語音辨識中…');
        text = (await transcribeRecording(new File([blob], 'retell.webm', { type: blob.type }))).trim();
        if (!text) throw new Error('沒有辨識到內容，請再說一次');
        transcriptRef.current = text;
        setTranscript(text);
      }
      setProcessingText('分析你的複述中…');
      const result = await reviewRetell(segmentText, text, targetPatterns);
      await saveRetell({
        materialId: material.id,
        segmentIndex,
        segmentTitle: segment.title,
        transcript: text,
        feedback: result,
        targetPatterns,
        createdAt: Date.now()
      });
      setFeedback(result);
      setPhase('done');
      loadHistory();
    } catch (err: any) {
      console.error('[複述] 分析失敗:', err);
      setErrorMsg(err?.message || '分析失敗，請稍後再試');
      setPhase('error');
    }
  };

  const stopRecording = () => {
    if (timerRef.current) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      mediaRecorderRef.current.stop();
    }
  };

  const startRecording = async () => {
    // iPhone 只允許「使用者點擊當下」啟動播放：在任何 await 之前先解鎖播放器
    for (const el of [speechAudioRef.current, recordedAudioRef.current]) {
      if (el) {
        el.src = SILENT_AUDIO;
        el.play().then(() => el.pause()).catch(() => {});
      }
    }
    segmentAudioRef.current?.pause();
    setSegmentPlaying(false);
    setErrorMsg(null);
    setFeedback(null);
    setTranscript('');
    transcriptRef.current = '';
    blobRef.current = null;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      streamRef.current = stream;
      const mimeType = getSupportedMimeType();
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      mediaRecorderRef.current = recorder;
      chunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = () => {
        streamRef.current?.getTracks().forEach(t => t.stop());
        streamRef.current = null;
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || 'audio/webm' });
        blobRef.current = blob;
        if (playbackUrlRef.current) URL.revokeObjectURL(playbackUrlRef.current);
        playbackUrlRef.current = URL.createObjectURL(blob);
        if (recordedAudioRef.current) recordedAudioRef.current.src = playbackUrlRef.current;
        runAnalysis();
      };
      recorder.start();
      setSeconds(0);
      setPhase('recording');
      const startedAt = Date.now();
      timerRef.current = window.setInterval(() => {
        const elapsed = Math.floor((Date.now() - startedAt) / 1000);
        setSeconds(elapsed);
        if (elapsed >= MAX_SECONDS) stopRecording();
      }, 500);
    } catch (err) {
      console.error('[複述] 無法開始錄音:', err);
      setErrorMsg('無法取得麥克風權限');
      setPhase('idle');
    }
  };

  const playModelAnswer = async () => {
    if (!feedback?.modelAnswer) return;
    recordedAudioRef.current?.pause();
    setModelLoading(true);
    const url = await getSpeechUrl(feedback.modelAnswer.slice(0, 500));
    setModelLoading(false);
    if (url && speechAudioRef.current) {
      speechAudioRef.current.src = url;
      speechAudioRef.current.currentTime = 0;
      speechAudioRef.current.play().catch(() => {});
    }
  };

  const playMyRecording = () => {
    speechAudioRef.current?.pause();
    if (recordedAudioRef.current && playbackUrlRef.current) {
      recordedAudioRef.current.currentTime = 0;
      recordedAudioRef.current.play().catch(() => {});
    }
  };

  const formatTime = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

  return (
    <div className="flex flex-col h-full bg-slate-50 dark:bg-slate-950 p-6 overflow-y-auto pb-20">
      <audio ref={segmentAudioRef} className="hidden" preload="none" onTimeUpdate={handleSegmentTimeUpdate} onEnded={() => setSegmentPlaying(false)} />
      <audio ref={speechAudioRef} className="hidden" preload="auto" />
      <audio ref={recordedAudioRef} className="hidden" preload="auto" />

      <div className="flex items-center gap-4 mb-6">
        <button
          onClick={onBack}
          disabled={phase === 'recording' || phase === 'processing'}
          className="p-2 bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 rounded-full shadow-sm hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors disabled:opacity-50"
        >
          <ChevronLeft size={24} />
        </button>
        <div className="flex-1 min-w-0">
          <h2 className="text-xl font-black text-slate-800 dark:text-white line-clamp-1">複述練習</h2>
          <p className="text-sm font-bold text-slate-500 dark:text-slate-400 line-clamp-1">第 {segmentIndex + 1} 段：{segment.title}</p>
        </div>
      </div>

      <div className="bg-white dark:bg-slate-900 rounded-2xl p-5 shadow-sm border border-slate-200 dark:border-slate-800 mb-6 space-y-4">
        <p className="text-sm font-bold text-slate-600 dark:text-slate-300 leading-relaxed">
          聽完這一段之後，用自己的話、以英文說出這段在講什麼。不用逐字背誦，講出重點就好。
        </p>
        <button
          onClick={toggleSegmentAudio}
          disabled={!material.audioUrl || phase === 'recording'}
          className="w-full py-3 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 rounded-xl font-bold flex items-center justify-center gap-2 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors disabled:opacity-50"
        >
          <Headphones size={18} />
          {segmentPlaying ? '停止播放' : '重聽這一段'}
        </button>
        {targetPatterns.length > 0 && (
          <div>
            <p className="text-xs font-black text-slate-500 dark:text-slate-400 mb-2">試著用上這些句型</p>
            <div className="space-y-1.5">
              {targetPatterns.map(p => (
                <div key={p.id} className="text-sm">
                  <span className="font-bold text-purple-700 dark:text-purple-300">{p.text}</span>
                  <span className="text-slate-500 dark:text-slate-400">　{p.meaningZh}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {errorMsg && (
        <div className="bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 text-sm px-4 py-3 rounded-xl border border-red-100 dark:border-red-800 font-bold mb-6 text-center">
          {errorMsg}
        </div>
      )}

      {phase === 'idle' && (
        <div className="flex flex-col items-center gap-3 mb-8">
          <button
            onClick={startRecording}
            className="w-20 h-20 bg-indigo-600 text-white rounded-full shadow-lg hover:bg-indigo-700 active:scale-95 transition-all flex items-center justify-center"
          >
            <Mic size={32} />
          </button>
          <p className="text-xs font-bold text-slate-500 dark:text-slate-400">按下開始錄音，最長 3 分鐘</p>
        </div>
      )}

      {phase === 'recording' && (
        <div className="flex flex-col items-center gap-3 mb-8">
          <div className="text-3xl font-black text-red-500 tabular-nums">{formatTime(seconds)}</div>
          <button
            onClick={stopRecording}
            className="px-8 py-4 bg-red-500 text-white rounded-2xl font-bold shadow-md hover:bg-red-600 transition-colors flex items-center gap-2"
          >
            <Square size={18} className="fill-current" />
            我說完了
          </button>
          <p className="text-xs font-bold text-slate-400 dark:text-slate-500">停下來想沒關係，不會自動結束</p>
        </div>
      )}

      {phase === 'processing' && (
        <div className="flex flex-col items-center gap-3 mb-8">
          <Loader2 size={32} className="animate-spin text-indigo-600 dark:text-indigo-400" />
          <p className="text-sm font-bold text-slate-600 dark:text-slate-300">{processingText}</p>
        </div>
      )}

      {phase === 'error' && (
        <div className="flex flex-wrap justify-center gap-3 mb-8">
          <button
            onClick={runAnalysis}
            className="px-5 py-3 bg-indigo-600 text-white rounded-xl font-bold shadow-md hover:bg-indigo-700 transition-colors flex items-center gap-2"
          >
            <RotateCcw size={16} />
            重試分析
          </button>
          <button
            onClick={() => { setPhase('idle'); setErrorMsg(null); }}
            className="px-5 py-3 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700 rounded-xl font-bold"
          >
            重新錄一次
          </button>
        </div>
      )}

      {phase === 'done' && feedback && (
        <div className="bg-white dark:bg-slate-900 rounded-2xl p-5 shadow-sm border border-slate-200 dark:border-slate-800 mb-6 space-y-5">
          {transcript && (
            <div>
              <p className="text-xs font-black text-slate-500 dark:text-slate-400 mb-1">你說的（語音辨識）</p>
              <p className="text-sm text-slate-700 dark:text-slate-300 leading-relaxed">{transcript}</p>
            </div>
          )}
          <RetellFeedbackPanel feedback={feedback} targetPatterns={targetPatterns} onPlayModel={playModelAnswer} modelLoading={modelLoading} />
          <div className="flex flex-col gap-3 pt-2">
            <button
              onClick={playMyRecording}
              className="w-full py-3 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700 rounded-xl font-bold flex items-center justify-center gap-2"
            >
              <Play size={16} />
              重播我的錄音
            </button>
            <button
              onClick={() => { setPhase('idle'); setFeedback(null); setTranscript(''); }}
              className="w-full py-3 bg-indigo-600 text-white rounded-xl font-bold shadow-md hover:bg-indigo-700 transition-colors flex items-center justify-center gap-2"
            >
              <RotateCcw size={16} />
              再複述一次
            </button>
          </div>
        </div>
      )}

      {history.length > 0 && (
        <div className="space-y-3">
          <p className="text-sm font-black text-slate-700 dark:text-slate-200">這一段的複述紀錄（{history.length}）</p>
          {history.map(r => {
            const expanded = expandedHistoryId === r.id;
            return (
              <div key={r.id} className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden">
                <button
                  onClick={() => setExpandedHistoryId(expanded ? null : r.id)}
                  className="w-full p-4 flex items-center justify-between gap-3 text-left"
                >
                  <div>
                    <p className="text-sm font-bold text-slate-700 dark:text-slate-200">{new Date(r.createdAt).toLocaleString()}</p>
                    <p className="text-xs font-bold text-slate-500 dark:text-slate-400 mt-0.5">內容 {r.feedback?.contentScore ?? '-'}・語言 {r.feedback?.languageScore ?? '-'}</p>
                  </div>
                  {expanded ? <ChevronUp size={18} className="text-slate-400" /> : <ChevronDown size={18} className="text-slate-400" />}
                </button>
                {expanded && r.feedback && (
                  <div className="px-4 pb-4 pt-3 border-t border-slate-100 dark:border-slate-800 space-y-4">
                    <div>
                      <p className="text-xs font-black text-slate-500 dark:text-slate-400 mb-1">當時說的</p>
                      <p className="text-sm text-slate-700 dark:text-slate-300 leading-relaxed">{r.transcript}</p>
                    </div>
                    <RetellFeedbackPanel feedback={r.feedback} targetPatterns={r.targetPatterns || []} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
