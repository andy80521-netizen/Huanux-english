import React from 'react';
import { Loader2, Volume2 } from 'lucide-react';
import { RetellFeedback } from '../services/gemini';
import { RetellTargetPattern } from '../services/retell';

// 一次複述的回饋內容（複述完成畫面與歷史紀錄共用）
export default function RetellFeedbackPanel({ feedback, targetPatterns, onPlayModel, modelLoading }: {
  feedback: RetellFeedback;
  targetPatterns: RetellTargetPattern[];
  onPlayModel?: () => void;
  modelLoading?: boolean;
}) {
  const statusLabel: Record<string, { text: string; className: string }> = {
    correct: { text: '用對了', className: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300' },
    incorrect: { text: '用錯了', className: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300' },
    unused: { text: '沒用到', className: 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400' }
  };
  return (
    <div className="space-y-5">
      <div className="flex items-center justify-center gap-6">
        <div className="text-center">
          <div className="text-3xl font-black text-indigo-600 dark:text-indigo-400">{feedback.contentScore}</div>
          <div className="text-xs font-bold text-slate-500 mt-1">內容涵蓋</div>
        </div>
        <div className="h-10 w-px bg-slate-200 dark:bg-slate-700"></div>
        <div className="text-center">
          <div className="text-3xl font-black text-indigo-600 dark:text-indigo-400">{feedback.languageScore}</div>
          <div className="text-xs font-bold text-slate-500 mt-1">語言表現</div>
        </div>
      </div>

      {feedback.comment && (
        <p className="text-sm font-bold text-slate-700 dark:text-slate-200 leading-relaxed bg-indigo-50 dark:bg-indigo-900/20 rounded-xl p-4">{feedback.comment}</p>
      )}

      {(feedback.coverage.covered.length > 0 || feedback.coverage.missed.length > 0) && (
        <div className="space-y-2">
          <p className="text-xs font-black text-slate-500 dark:text-slate-400">內容涵蓋</p>
          {feedback.coverage.covered.map((c, i) => (
            <p key={`c${i}`} className="text-sm text-slate-700 dark:text-slate-300">✓ {c}</p>
          ))}
          {feedback.coverage.missed.map((m, i) => (
            <p key={`m${i}`} className="text-sm text-amber-700 dark:text-amber-400">✗ 漏掉：{m}</p>
          ))}
        </div>
      )}

      {feedback.corrections.length > 0 && (
        <div className="space-y-3">
          <p className="text-xs font-black text-slate-500 dark:text-slate-400">語言修正</p>
          {feedback.corrections.map((c, i) => (
            <div key={i} className="bg-slate-50 dark:bg-slate-950 rounded-xl p-3 border border-slate-100 dark:border-slate-800">
              <p className="text-sm text-slate-500 dark:text-slate-400 line-through">{c.original}</p>
              <p className="text-sm font-bold text-emerald-700 dark:text-emerald-400 mt-1">{c.better}</p>
              {c.note && <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">{c.note}</p>}
            </div>
          ))}
        </div>
      )}

      {feedback.patternUsage.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-black text-slate-500 dark:text-slate-400">句型運用</p>
          {feedback.patternUsage.map(u => {
            const p = targetPatterns.find(t => t.id === u.id);
            const label = statusLabel[u.status] || statusLabel.unused;
            return (
              <div key={u.id} className="flex items-start gap-2">
                <span className={`shrink-0 text-[11px] font-bold px-2 py-0.5 rounded-full ${label.className}`}>{label.text}</span>
                <div className="min-w-0">
                  <p className="text-sm font-bold text-slate-700 dark:text-slate-200">{p?.text || u.id}</p>
                  {u.note && <p className="text-xs text-slate-500 dark:text-slate-400">{u.note}</p>}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {feedback.modelAnswer && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-xs font-black text-slate-500 dark:text-slate-400">示範版本</p>
            {onPlayModel && (
              <button
                onClick={onPlayModel}
                disabled={modelLoading}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold bg-white dark:bg-slate-900 text-indigo-600 dark:text-indigo-400 border border-indigo-200 dark:border-indigo-800/60 rounded-xl shadow-xs disabled:opacity-50"
              >
                {modelLoading ? <Loader2 size={14} className="animate-spin" /> : <Volume2 size={14} />}
                {modelLoading ? '語音準備中…' : '播放示範'}
              </button>
            )}
          </div>
          <p className="text-sm font-bold text-slate-800 dark:text-slate-100 leading-relaxed">{feedback.modelAnswer}</p>
        </div>
      )}
    </div>
  );
}
