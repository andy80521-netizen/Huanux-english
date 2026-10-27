/**
 * 數字跑動的中間值：ease-out（1 − (1 − t)^3），回傳整數。
 * progress 夾在 0～1；不是數字時視為已完成，直接回傳終點。
 */
export function countUpValue(from: number, to: number, progress: number): number {
  const t = Number.isFinite(progress) ? Math.min(1, Math.max(0, progress)) : 1;
  const eased = 1 - (1 - t) ** 3;
  return Math.round(from + (to - from) * eased);
}
