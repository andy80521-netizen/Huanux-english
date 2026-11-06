// 影子跟讀的原音語速（擁有者 2026-11-06 決定：0.75／0.85／1.0，設定會記住，放慢照常累加熟練度）
// 規劃：docs/plans/shadowing-speed.md

import { calculateShadowingScores, type PracticeScores } from './scoring';

export const SHADOWING_SPEEDS = [0.75, 0.85, 1] as const;
export type ShadowingSpeed = (typeof SHADOWING_SPEEDS)[number];
export const DEFAULT_SPEED: ShadowingSpeed = 1;
export const SPEED_STORAGE_KEY = 'huanux_shadowing_speed_v1';

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

export function loadSpeed(getStorage: () => StorageLike | null | undefined): ShadowingSpeed {
    try {
        const v = Number(getStorage()?.getItem(SPEED_STORAGE_KEY));
        return (SHADOWING_SPEEDS as readonly number[]).includes(v) ? (v as ShadowingSpeed) : DEFAULT_SPEED;
    } catch {
        return DEFAULT_SPEED;
    }
}

export function saveSpeed(getStorage: () => StorageLike | null | undefined, speed: ShadowingSpeed): void {
    try {
        getStorage()?.setItem(SPEED_STORAGE_KEY, String(speed));
    } catch {
        /* 私密瀏覽等情況：不記住也不影響練習 */
    }
}

/** 放慢後的原音長度（秒） */
export const effectiveOriginalSec = (originalSec: number, speed: number) =>
    speed > 0 ? originalSec / speed : originalSec;

/** 設定播放速度，並保持音高（放慢不變低沉；Safari 舊版用 webkit 前綴） */
export function applyPlaybackSpeed(el: { playbackRate: number }, speed: number): void {
    el.playbackRate = speed;
    const a = el as { preservesPitch?: boolean; webkitPreservesPitch?: boolean; mozPreservesPitch?: boolean };
    a.preservesPitch = true;
    a.webkitPreservesPitch = true;
}

/** 一次錄音的快照：評分、重試評分、聽聽看都用錄音當下的速度，不讀目前的設定 */
export interface ShadowingAttempt {
    speechSec: number;
    speed: number;
}

export function scoreShadowingAttempt(
    userText: string,
    sentence: { text: string; startTime: number; endTime: number },
    attempt: ShadowingAttempt,
): PracticeScores {
    const originalSec = Math.max(0, sentence.endTime - sentence.startTime);
    return calculateShadowingScores(userText, sentence.text, attempt.speechSec, effectiveOriginalSec(originalSec, attempt.speed));
}
