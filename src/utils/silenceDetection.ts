// 語言模型複習的「講完自動停止」判斷（PR A，2026-10-30）
// 舊版從按下錄音就開始算 1.5 秒靜音：還在回想句子、或講到一半停下來想，就會被切斷

/** 還沒開口前，最多等這麼久（給使用者回想句子的時間） */
export const PRE_SPEECH_TIMEOUT_MS = 5000;
/** 開口之後，連續安靜這麼久才視為講完 */
export const MID_SPEECH_SILENCE_MS = 2500;

export interface SilenceState {
  now: number;
  /** 開始錄音的時間 */
  startedAt: number;
  /** 是否已經偵測到說話 */
  heardSpeech: boolean;
  /** 這段安靜從何時開始；正在出聲時為 null */
  silentSince: number | null;
}

export function shouldStopForSilence({ now, startedAt, heardSpeech, silentSince }: SilenceState): boolean {
  if (silentSince === null) return false;
  if (!heardSpeech) return now - startedAt > PRE_SPEECH_TIMEOUT_MS;
  return now - silentSince > MID_SPEECH_SILENCE_MS;
}
