import { LanguagePattern } from '../types';
import { getMasteredCount, STAGE_THRESHOLDS } from './patternStage';

// 勳章房（UI 改版 ④）：只讀計算，門檻沿用 STAGE_THRESHOLDS（10／40／100）

export type BadgeTier = '可用' | '熟練' | '精通';

export const BADGE_TIERS: ReadonlyArray<{ tier: BadgeTier; target: number }> = [
  { tier: '可用', target: STAGE_THRESHOLDS.usable },
  { tier: '熟練', target: STAGE_THRESHOLDS.proficient },
  { tier: '精通', target: STAGE_THRESHOLDS.mastered },
];

export interface BadgeSummary { usable: number; proficient: number; mastered: number }

export interface BadgeRow {
  pattern: LanguagePattern;
  /** 已精熟句數（getMasteredCount） */
  mastered: number;
  /** 目前達到的最高階段；未滿 10 句為 null */
  tier: BadgeTier | null;
  /** 下一個門檻；三枚都已取得為 null */
  next: { tier: BadgeTier; target: number } | null;
  /** 距離下一個門檻還差幾句；沒有下一個門檻為 0 */
  remaining: number;
}

export interface NextBadge { pattern: LanguagePattern; tier: BadgeTier; target: number; remaining: number }

const byText = (a: LanguagePattern, b: LanguagePattern) => (a.text || '').localeCompare(b.text || '', 'en');

function toRow(pattern: LanguagePattern): BadgeRow {
  const mastered = getMasteredCount(pattern);
  let tier: BadgeTier | null = null;
  for (const t of BADGE_TIERS) if (mastered >= t.target) tier = t.tier;
  const nextTier = BADGE_TIERS.find((t) => mastered < t.target) || null;
  return {
    pattern,
    mastered,
    tier,
    next: nextTier ? { tier: nextTier.tier, target: nextTier.target } : null,
    remaining: nextTier ? nextTier.target - mastered : 0,
  };
}

/** 達到各門檻的句型數（累計：精通的句型也算在可用、熟練） */
export function badgeSummary(patterns: LanguagePattern[]): BadgeSummary {
  const sum = { usable: 0, proficient: 0, mastered: 0 };
  for (const p of patterns) {
    const n = getMasteredCount(p);
    if (n >= STAGE_THRESHOLDS.usable) sum.usable++;
    if (n >= STAGE_THRESHOLDS.proficient) sum.proficient++;
    if (n >= STAGE_THRESHOLDS.mastered) sum.mastered++;
  }
  return sum;
}

/** 所有句型：精熟句數多的在前，同分依句型文字（英文規則）；不改動傳入的陣列 */
export function badgeRows(patterns: LanguagePattern[]): BadgeRow[] {
  return patterns.map(toRow).sort((a, b) => b.mastered - a.mastered || byText(a.pattern, b.pattern));
}

/** 最快拿到的下一枚勳章：差最少句 → 精熟句數多 → 句型文字；沒有句型或全部精通時為 null */
export function nextBadge(patterns: LanguagePattern[]): NextBadge | null {
  const candidates = patterns.map(toRow).filter((r) => r.next !== null);
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => a.remaining - b.remaining || b.mastered - a.mastered || byText(a.pattern, b.pattern));
  const best = candidates[0];
  return { pattern: best.pattern, tier: best.next!.tier, target: best.next!.target, remaining: best.remaining };
}
