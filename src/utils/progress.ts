/**
 * 進度條兩段的百分比。
 * value：目前總值（已含本次增加的 gain）；max：上限；gain：本次增加量（可省略）。
 * 回傳原本那段與本次增加那段各佔的百分比，兩段相加介於 0～100。
 */
export function progressPercents(value: number, max: number, gain = 0): { basePct: number; gainPct: number } {
  if (!Number.isFinite(value) || !Number.isFinite(max) || max <= 0 || value <= 0) {
    return { basePct: 0, gainPct: 0 };
  }
  const total = Math.min(value, max);
  const safeGain = Number.isFinite(gain) && gain > 0 ? gain : 0;
  // 原本的值 = 總值 − 本次增加（不低於 0），再限制在上限內
  const base = Math.min(Math.max(value - safeGain, 0), max);
  const basePct = (base / max) * 100;
  const gainPct = ((total - base) / max) * 100;
  return { basePct, gainPct };
}
