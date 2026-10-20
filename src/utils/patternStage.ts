import { LanguagePattern } from '../types';

export type PatternStage = 'learning' | 'usable' | 'proficient' | 'mastered';

// 已精熟句數（mastery 達 1000）
export function getMasteredCount(pattern: Pick<LanguagePattern, 'exampleSentences'>): number {
  return (pattern.exampleSentences || []).filter(s => s.checked && (s.mastery || 0) >= 1000).length;
}

// 深度階段：未滿 10 句＝學習中；10 句＝可用（第 1 組全精熟）；40 句＝熟練；100 句＝精通
export function getPatternStage(pattern: Pick<LanguagePattern, 'exampleSentences'>): { stage: PatternStage; label: string; className: string } {
  const n = getMasteredCount(pattern);
  if (n >= 100) return { stage: 'mastered', label: '精通', className: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300' };
  if (n >= 40) return { stage: 'proficient', label: '熟練', className: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300' };
  if (n >= 10) return { stage: 'usable', label: '可用', className: 'bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300' };
  return { stage: 'learning', label: '學習中', className: 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400' };
}
