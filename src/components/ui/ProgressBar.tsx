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
  /** 主段顏色：預設主色；已畢業（滿 1000）時用金色 */
  tone?: 'accent' | 'gold';
  className?: string;
}

/** 細長進度條；有 gain 時，增加的那段用金色接在後面 */
export default function ProgressBar({ value, max, gain = 0, label, size = 'md', tone = 'accent', className = '' }: ProgressBarProps) {
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
        className={`absolute inset-y-0 left-0 rounded-full ${tone === 'gold' ? 'bg-gold' : 'bg-accent'} transition-[width] duration-[var(--dur-base)] ease-[var(--ease-out-soft)]`}
        style={{ width: `${basePct}%` }}
      />
      {/* 一直保留這段（寬度 0 時看不到），金色段補上時才有寬度過場 */}
      <div
        className="absolute inset-y-0 bg-gold transition-[width,left] duration-[600ms] ease-[var(--ease-out-soft)]"
        style={{ left: `${basePct}%`, width: `${gainPct}%` }}
        aria-hidden="true"
      />
    </div>
  );
}
