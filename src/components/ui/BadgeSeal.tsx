import React from 'react';
import type { BadgeTier } from '../../utils/badges';

/**
 * 勳章印章（UI 改版 ④）：外圈細環＋內圈實心＋階段文字。
 * 可用＝accent-soft、熟練＝accent、精通＝gold；未取得＝虛線空心。
 */
const STYLE: Record<BadgeTier, { ring: string; disc: string; text: string }> = {
  可用: { ring: 'stroke-accent', disc: 'fill-accent-soft', text: 'text-ink' },
  熟練: { ring: 'stroke-accent', disc: 'fill-accent', text: 'text-on-accent' },
  精通: { ring: 'stroke-gold', disc: 'fill-gold', text: 'text-white dark:text-ground' },
};

export default function BadgeSeal({ tier, size = 76, earned = true }: { tier: BadgeTier; size?: number; earned?: boolean }) {
  const r = size / 2;
  const s = STYLE[tier];
  return (
    <span className="relative inline-flex shrink-0 items-center justify-center" style={{ width: size, height: size }} aria-hidden="true">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="absolute inset-0">
        <circle
          cx={r} cy={r} r={r - 1.5} fill="none" strokeWidth={1.5}
          className={earned ? s.ring : 'stroke-muted/50'}
          strokeDasharray={earned ? undefined : '3 4'}
        />
        {earned && <circle cx={r} cy={r} r={r - 7} className={s.disc} />}
      </svg>
      <span
        className={`relative font-bold tracking-[0.08em] ${earned ? s.text : 'text-muted'}`}
        style={{ fontSize: Math.max(11, Math.round(size * 0.2)) }}
      >
        {tier}
      </span>
    </span>
  );
}
