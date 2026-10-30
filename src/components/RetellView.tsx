import React, { useEffect, useRef, useState } from 'react';
import { Material } from '../types';
import { ChevronLeft, Mic, Square, Loader2, Play, RotateCcw, Headphones, ChevronDown, AlertCircle } from 'lucide-react';
import { transcribeRecordingDetailed, RetellFeedback } from '../services/gemini';
import { transcriberLabel } from '../utils/transcriber';
import { RetellSegment, RetellTargetPattern, RetellRecord, reviewRetell, saveRetell, listRetells } from '../services/retell';
import { getSpeechUrl } from '../services/speech';
import { getSupportedMimeType } from '../utils/mediaRecorder';
import { SILENT_AUDIO } from '../utils';
import RetellFeedbackPanel from './RetellFeedbackPanel';
import Button from './ui/Button';
import IconButton from './ui/IconButton';

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
  // 這次由哪個模型轉錄（只顯示當次，不存進歷史紀錄）
  const [transcriber, setTranscriber] = useState('');
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
  const resultRef = useRef<HTMLDivElement>(null);

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
        const r = await transcribeRecordingDetailed(new File([blob], 'retell.webm', { type: blob.type }));
        text = r.text.trim();
        setTranscriber(transcriberLabel(r.model));
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
      // 限制 64 kbps：3 分鐘約 1.5 MB，不會超過上傳上限；語音已足夠清楚
      const recorder = new MediaRecorder(stream, { ...(mimeType ? { mimeType } : {}), audioBitsPerSecond: 64000 });
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

  const busy = phase === 'recording' || phase === 'processing';

  // 分析完成時把結果捲進畫面（手機上結果在句型下方，容易沒看到）
  useEffect(() => {
    if (phase !== 'done') return;
    let reduce = false;
    try { reduce = !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches; } catch { /* 沒有 matchMedia 時照常捲動 */ }
    resultRef.current?.scrollIntoView?.({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
  }, [phase]);

  const replayButton = (extra: string) => (
    <Button
      variant="secondary"
      size="sm"
      onClick={toggleSegmentAudio}
      disabled={!material.audioUrl || phase === 'recording'}
      icon={segmentPlaying ? <Square size={14} className="fill-current" aria-hidden="true" /> : <Headphones size={16} aria-hidden="true" />}
      className={`self-start ${segmentPlaying ? 'bg-accent-soft' : ''} ${extra}`}
    >
      {segmentPlaying ? '停止播放' : '重聽這一段'}
    </Button>
  );

  const historyList = history.length > 0 && (
    <section className="flex flex-col gap-2.5" aria-label="這一段的複述紀錄">
      <h3 className="text-[13px] font-medium text-ink">這一段的複述紀錄（{history.length}）</h3>
      {history.map(r => {
        const expanded = expandedHistoryId === r.id;
        return (
          <div key={r.id} className="overflow-hidden rounded-2xl border border-line bg-surface">
            <button
              type="button"
              aria-expanded={expanded}
              onClick={() => setExpandedHistoryId(expanded ? null : r.id)}
              className="flex min-h-14 w-full items-center justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-surface-2 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent"
            >
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className="text-xs text-muted">{new Date(r.createdAt).toLocaleString()}</span>
                <span className="text-sm text-ink tabular-nums">內容 {r.feedback?.contentScore ?? '-'}・語言 {r.feedback?.languageScore ?? '-'}</span>
              </span>
              <ChevronDown size={18} className={`shrink-0 text-muted transition-transform duration-[var(--dur-fast)] ${expanded ? 'rotate-180' : ''}`} aria-hidden="true" />
            </button>
            {expanded && r.feedback && (
              <div className="flex flex-col gap-5 border-t border-line px-4 pt-4 pb-5">
                <div className="flex flex-col gap-1.5">
                  <p className="text-xs text-muted">當時說的</p>
                  <p lang="en" className="text-sm leading-relaxed text-ink">{r.transcript}</p>
                </div>
                <RetellFeedbackPanel feedback={r.feedback} targetPatterns={r.targetPatterns || []} />
              </div>
            )}
          </div>
        );
      })}
    </section>
  );

  return (
    <div className="h-full lg:grid lg:grid-cols-[minmax(0,1fr)_320px]">
      <audio ref={segmentAudioRef} className="hidden" preload="none" onTimeUpdate={handleSegmentTimeUpdate} onEnded={() => setSegmentPlaying(false)} />
      <audio ref={speechAudioRef} className="hidden" preload="auto" />
      <audio ref={recordedAudioRef} className="hidden" preload="auto" />

      {/* 主區 */}
      <div className="flex h-full min-h-0 flex-col overflow-y-auto">
        <header className="flex items-center gap-2 px-2 pt-2 sm:px-5 lg:px-9 lg:pt-6">
          <IconButton aria-label="返回教材" onClick={onBack} disabled={busy}>
            <ChevronLeft size={22} aria-hidden="true" />
          </IconButton>
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-[15px] font-medium tracking-wide text-ink">複述練習</h2>
            <p className="truncate text-[13px] text-muted">第 {segmentIndex + 1} 段：{segment.title}</p>
          </div>
        </header>

        <main className="flex flex-1 flex-col px-6 pt-6 pb-12 sm:px-10 lg:px-14 lg:pt-10">
          <div className="flex max-w-[680px] flex-col gap-5">
            <p className="text-[15px] leading-[1.75] text-muted">
              聽完這一段之後，用自己的話、以英文說出這段在講什麼。不用逐字背誦，講出重點就好。
            </p>
            {replayButton('lg:hidden')}
            {targetPatterns.length > 0 && (
              <div className="flex flex-col gap-2.5">
                <p className="text-xs text-muted">試著用上這些句型</p>
                {targetPatterns.map(p => (
                  <div key={p.id} className="flex flex-col gap-0.5 border-l-2 border-accent py-0.5 pl-3.5">
                    <span lang="en" className="font-reading text-[17px] leading-snug text-ink break-words lg:text-[22px]">{p.text}</span>
                    {p.meaningZh && <span className="text-[13px] text-muted">{p.meaningZh}</span>}
                  </div>
                ))}
              </div>
            )}
          </div>

          {errorMsg && (
            <div role="alert" className="mt-8 flex max-w-[680px] items-start gap-3 rounded-xl bg-danger/10 px-4 py-3.5 text-sm text-danger">
              <AlertCircle size={18} className="mt-0.5 shrink-0" aria-hidden="true" />
              <span className="font-medium leading-relaxed break-words">{errorMsg}</span>
            </div>
          )}

          {/* 錄音區：待錄音、錄音中、處理中、錯誤時放在下方（桌機貼底），完成後換成回饋 */}
          <div aria-live="polite" className={phase === 'done' ? '' : 'mt-12 lg:mt-auto lg:pt-12'}>
            {phase === 'idle' && (
              <div className="flex flex-col items-center gap-4 sm:flex-row sm:gap-6">
                <button
                  type="button"
                  onClick={startRecording}
                  aria-label="開始錄音"
                  className="flex size-20 items-center justify-center rounded-full bg-accent text-on-accent shadow-[0_12px_28px_-10px_rgb(31_122_92/0.6)] transition-[filter,transform] hover:brightness-110 active:scale-95 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent dark:shadow-none"
                >
                  <Mic size={30} aria-hidden="true" />
                </button>
                <p className="text-sm text-muted">按下開始錄音，最長 3 分鐘</p>
              </div>
            )}

            {phase === 'recording' && (
              <div className="flex flex-col items-center gap-6 sm:flex-row sm:items-center sm:gap-7">
                <div className="flex items-center gap-3.5" role="timer">
                  <span className="size-3 rounded-full bg-danger animate-breathe" aria-hidden="true" />
                  <span className="font-reading text-[56px] leading-none text-ink tabular-nums lg:text-[64px]">{formatTime(seconds)}</span>
                  <span className="self-end pb-1.5 text-[13px] text-muted tabular-nums">/ {formatTime(MAX_SECONDS)}</span>
                </div>
                <div className="flex flex-col items-center gap-2 sm:items-start">
                  <Button size="lg" onClick={stopRecording} icon={<Square size={14} className="fill-current" aria-hidden="true" />}>
                    我說完了
                  </Button>
                  <p className="text-[13px] text-muted">停下來想沒關係，不會自動結束</p>
                </div>
              </div>
            )}

            {phase === 'processing' && (
              <div className="flex items-center justify-center gap-3 sm:justify-start">
                <Loader2 size={22} className="animate-spin text-accent" aria-hidden="true" />
                <p className="text-[15px] text-ink">{processingText}</p>
              </div>
            )}

            {phase === 'error' && (
              <div className="flex flex-wrap justify-center gap-3 sm:justify-start">
                <Button onClick={runAnalysis} icon={<RotateCcw size={16} aria-hidden="true" />}>重試分析</Button>
                <Button variant="secondary" onClick={() => { setPhase('idle'); setErrorMsg(null); }}>重新錄一次</Button>
              </div>
            )}
          </div>

          {phase === 'done' && feedback && (
            <div ref={resultRef} className="mt-10 flex max-w-[680px] scroll-mt-4 flex-col gap-8 border-t border-line pt-8">
              {transcript && (
                <section className="flex flex-col gap-1.5">
                  <p className="flex flex-wrap items-baseline justify-between gap-x-3 text-xs text-muted">
                    <span>你說的（語音辨識）</span>
                    {transcriber && <span className="text-[11px] text-muted/80">語音辨識：{transcriber}</span>}
                  </p>
                  <p lang="en" className="text-[15px] leading-relaxed text-ink">{transcript}</p>
                </section>
              )}
              <RetellFeedbackPanel feedback={feedback} targetPatterns={targetPatterns} onPlayModel={playModelAnswer} modelLoading={modelLoading} animateScores />
              <div className="grid grid-cols-2 gap-3 sm:max-w-md">
                <Button variant="secondary" onClick={playMyRecording} icon={<Play size={16} aria-hidden="true" />}>重播我的錄音</Button>
                <Button onClick={() => { setPhase('idle'); setFeedback(null); setTranscript(''); }} icon={<RotateCcw size={16} aria-hidden="true" />}>再複述一次</Button>
              </div>
            </div>
          )}

          {history.length > 0 && <div className="mt-12 max-w-[680px] lg:hidden">{historyList}</div>}
        </main>
      </div>

      {/* 桌機右側欄：重聽與歷史紀錄 */}
      <aside className="hidden min-h-0 flex-col gap-6 overflow-y-auto border-l border-line bg-surface-2 px-5 pt-8 pb-8 lg:flex" aria-label="重聽與複述紀錄">
        {replayButton('')}
        {historyList}
      </aside>
    </div>
  );
}
