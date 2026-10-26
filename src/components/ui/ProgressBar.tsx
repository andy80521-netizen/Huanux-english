import React from 'react';
import { progressPercents } from '../../utils/progress';

interface ProgressBarProps {
  /** 目前總值（已含本次增加的 gain） */
  value: number;
  max: number;
  /** 本次增加量，以金色另外標示（例如熟練度 +89） */
  gain?: number;
  /** 給螢幕閱讀器的名稱，例如「熟練度」 */
  label: string;
  size?: 'sm' | 'md';
  className?: string;
}

/** 細長進度條；有 gain 時，增加的那段用金色接在後面 */
export default function ProgressBar({ value, max, gain = 0, label, size = 'md', className = '' }: ProgressBarProps) {
  const { basePct, gainPct } = progressPercents(value, max, gain);
  const height = size === 'sm' ? 'h-1' : 'h-1.5';
  const safeMax = Number.isFinite(max) && max > 0 ? max : 0;
  const now = Number.isFinite(value) ? Math.min(Math.max(value, 0), safeMax) : 0;
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={safeMax}
      aria-valuenow={now}
      className={`relative w-full overflow-hidden rounded-full bg-line ${height} ${className}`}
    >
      <div
        className="absolute inset-y-0 left-0 rounded-full bg-accent transition-[width] duration-[var(--dur-base)] ease-[var(--ease-out-soft)]"
        style={{ width: `${basePct}%` }}
      />
      {gainPct > 0 && (
        <div
          className="absolute inset-y-0 bg-gold transition-[width] duration-[var(--dur-base)] ease-[var(--ease-out-soft)]"
          style={{ left: `${basePct}%`, width: `${gainPct}%` }}
        />
      )}
    </div>
  );
}
