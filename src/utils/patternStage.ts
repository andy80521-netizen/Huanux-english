import { LanguagePattern } from '../types';

export type PatternStage = 'learning' | 'usable' | 'proficient' | 'mastered';

// 已精熟句數（mastery 達 1000）
export function getMasteredCount(pattern: Pick<LanguagePattern, 'exampleSentences'>): number {
  return (pattern.exampleSentences || []).filter(s => s.checked && (s.mastery || 0) >= 1000).length;
}

// 深度階段門檻（精熟句數）：勳章房與階段標籤共用，不可隨意改值
export const STAGE_THRESHOLDS = { usable: 10, proficient: 40, mastered: 100 } as const;

// 深度階段：未滿 10 句＝學習中；10 句＝可用（第 1 組全精熟）；40 句＝熟練；100 句＝精通
export function getPatternStage(pattern: Pick<LanguagePattern, 'exampleSentences'>): { stage: PatternStage; label: string; className: string } {
  const n = getMasteredCount(pattern);
  if (n >= STAGE_THRESHOLDS.mastered) return { stage: 'mastered', label: '精通', className: 'bg-gold text-white dark:text-ground' };
  if (n >= STAGE_THRESHOLDS.proficient) return { stage: 'proficient', label: '熟練', className: 'bg-accent text-on-accent' };
  if (n >= STAGE_THRESHOLDS.usable) return { stage: 'usable', label: '可用', className: 'bg-accent-soft text-ink' };
  return { stage: 'learning', label: '學習中', className: 'bg-surface-2 text-muted border border-line' };
}
