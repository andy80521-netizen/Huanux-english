import React, { useEffect, useState } from 'react';
import { Loader2, Volume2 } from 'lucide-react';
import { RetellFeedback } from '../services/gemini';
import { RetellTargetPattern } from '../services/retell';
import ProgressBar from './ui/ProgressBar';
import { countUpValue } from '../utils/countUp';

/** 系統是否開啟「減少動態效果」（分數跑動是 JS，全域 CSS 規則管不到，要自己判斷） */
const prefersReducedMotion = () => {
  try { return !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
};

/** 分數從 0 跑到目標值；animate 為 false、減少動態效果、或不是數字時直接顯示原值 */
function useCountUp(target: unknown, animate: boolean): unknown {
  const numeric = typeof target === 'number' && Number.isFinite(target);
  const [shown, setShown] = useState<unknown>(() => (animate && numeric && !prefersReducedMotion() ? 0 : target));
  useEffect(() => {
    if (!animate || !numeric || prefersReducedMotion()) {
      setShown(target);
      return;
    }
    const to = target as number;
    const duration = 800;
    const start = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const progress = (now - start) / duration;
      setShown(countUpValue(0, to, progress));
      if (progress < 1) raf = requestAnimationFrame(tick);
    };
    setShown(0);
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, animate, numeric]);
  return shown;
}

function Score({ label, value, animate }: { label: string; value: unknown; animate: boolean }) {
  const shown = useCountUp(value, animate);
  const numeric = typeof value === 'number' && Number.isFinite(value);
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-2">
      <span
        className="font-reading text-[56px] leading-[0.9] tracking-[-0.03em] text-ink tabular-nums lg:text-[64px]"
        // 跑動中的數字不念給螢幕閱讀器，避免念一串數字
        aria-hidden={numeric && animate ? true : undefined}
      >
        {String(shown ?? '')}
      </span>
      {numeric && animate && <span className="sr-only">{`${label} ${value}`}</span>}
      <span className="text-[13px] text-muted">{label}</span>
      {numeric && <ProgressBar value={typeof shown === 'number' ? shown : (value as number)} max={100} label={label} size="sm" className="max-w-[120px]" />}
    </div>
  );
}

const SectionTitle = ({ children }: { children: React.ReactNode }) => (
  <h3 className="text-sm font-bold text-ink">{children}</h3>
);

// 一次複述的回饋內容（複述完成畫面與歷史紀錄共用）
export default function RetellFeedbackPanel({ feedback, targetPatterns, onPlayModel, modelLoading, animateScores = false }: {
  feedback: RetellFeedback;
  targetPatterns: RetellTargetPattern[];
  onPlayModel?: () => void;
  modelLoading?: boolean;
  /** 只有「這次結果」傳 true：分數從 0 跑上去；歷史紀錄展開時直接顯示 */
  animateScores?: boolean;
}) {
  const statusLabel: Record<string, { text: string; className: string }> = {
    correct: { text: '用對了', className: 'bg-accent-soft text-ink' },
    incorrect: { text: '用錯了', className: 'bg-warn/10 text-warn' },
    unused: { text: '沒用到', className: 'bg-surface-2 text-muted border-line' }
  };
  return (
    <div className="flex flex-col gap-7">
      <div className="flex flex-col gap-4">
        <div className="flex items-stretch">
          <Score label="內容涵蓋" value={feedback.contentScore} animate={animateScores} />
          <div className="mx-5 w-px bg-line" aria-hidden="true" />
          <Score label="語言表現" value={feedback.languageScore} animate={animateScores} />
        </div>
        {feedback.comment && (
          <p className="text-[15px] leading-relaxed text-ink">{feedback.comment}</p>
        )}
      </div>

      {(feedback.coverage.covered.length > 0 || feedback.coverage.missed.length > 0) && (
        <section className="flex flex-col gap-2">
          <SectionTitle>內容涵蓋</SectionTitle>
          <ul className="flex flex-col gap-1.5">
            {feedback.coverage.covered.map((c, i) => (
              <li key={`c${i}`} className="flex gap-2 text-sm leading-relaxed text-ink">
                <span className="text-accent" aria-hidden="true">✓</span>
                <span>{c}</span>
              </li>
            ))}
            {feedback.coverage.missed.map((m, i) => (
              <li key={`m${i}`} className="flex gap-2 text-sm leading-relaxed text-warn">
                <span aria-hidden="true">✗</span>
                <span>漏掉：{m}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {feedback.corrections.length > 0 && (
        <section className="flex flex-col gap-2.5">
          <SectionTitle>語言修正</SectionTitle>
          {feedback.corrections.map((c, i) => (
            <div key={i} className="flex flex-col gap-1.5 rounded-2xl border border-line bg-surface px-4 py-3">
              <p lang="en" className="text-sm text-muted line-through decoration-warn">{c.original}</p>
              <p lang="en" className="font-reading text-[17px] leading-snug text-ink">{c.better}</p>
              {c.note && <p className="text-xs leading-relaxed text-muted">{c.note}</p>}
            </div>
          ))}
        </section>
      )}

      {feedback.patternUsage.length > 0 && (
        <section className="flex flex-col gap-2.5">
          <SectionTitle>句型運用</SectionTitle>
          {feedback.patternUsage.map(u => {
            const p = targetPatterns.find(t => t.id === u.id);
            const label = statusLabel[u.status] || statusLabel.unused;
            return (
              <div key={u.id} className="flex items-start gap-2.5">
                <span className={`mt-0.5 w-14 shrink-0 rounded-full border border-transparent py-0.5 text-center text-[11px] font-medium ${label.className}`}>{label.text}</span>
                <div className="flex min-w-0 flex-col gap-0.5">
                  <p lang="en" className="font-reading text-base leading-snug text-ink break-words">{p?.text || u.id}</p>
                  {u.note && <p className="text-xs leading-relaxed text-muted">{u.note}</p>}
                </div>
              </div>
            );
          })}
        </section>
      )}

      {feedback.modelAnswer && (
        <section className="flex flex-col gap-2.5">
          <div className="flex items-center justify-between gap-3">
            <SectionTitle>示範版本</SectionTitle>
            {onPlayModel && (
              <button
                type="button"
                onClick={onPlayModel}
                disabled={modelLoading}
                className="flex min-h-9 items-center gap-1.5 rounded-full bg-accent-soft px-3 text-xs text-ink transition-[filter] hover:brightness-[0.97] dark:hover:brightness-110 disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
              >
                {modelLoading ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : <Volume2 size={14} aria-hidden="true" />}
                {modelLoading ? '語音準備中…' : '播放示範'}
              </button>
            )}
          </div>
          <p lang="en" className="font-reading text-lg italic leading-relaxed text-ink">{feedback.modelAnswer}</p>
        </section>
      )}
    </div>
  );
}
