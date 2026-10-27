// 匯入新教材：處理中的三步驟進度（UI 改版 ②b）
// 只負責「目前在哪一步、顯示什麼字」，不碰任何匯入邏輯。

export type ImportLoadingState =
  | 'idle'
  | 'processing'
  | 'uploading'
  | 'analyzing'
  | 'generating'
  | 'timestamping'
  | 'uploadingAudio'
  | 'transcribing'
  | 'translating';

export type ImportStepStatus = 'done' | 'active' | 'pending';

export interface ImportStep {
  label: string;
  status: ImportStepStatus;
  detail?: string;
}

export interface ImportProgress {
  done: number;
  total: number;
}

const AUDIO_LABELS = ['上傳音檔', '轉錄與斷句', '校對與翻譯'] as const;
const TEXT_LABELS = ['準備句子', '生成語音', '校對與儲存'] as const;

const build = (labels: readonly string[], activeIndex: number, activeDetail: string): ImportStep[] =>
  labels.map((label, i) => {
    if (i < activeIndex) return { label, status: 'done' };
    if (i === activeIndex) return { label, status: 'active', detail: activeDetail };
    return { label, status: 'pending' };
  });

/**
 * @param loadingState MaterialImportMode 的 loadingState
 * @param ttsPending   只有在 pendingMaterial?.source === 'tts' 時為 true（文字／舊題庫路徑的儲存階段）
 * @param progress     翻譯或生成語音的進度；沒有時以 0 / 0 顯示（與原本提示文字相同）
 * @returns 沒有步驟可顯示時回傳 null（UI 保留原本的單行提示）
 */
export function importSteps(
  loadingState: ImportLoadingState,
  ttsPending: boolean,
  progress: ImportProgress | null,
): { steps: ImportStep[] } | null {
  const done = progress?.done ?? 0;
  const total = progress?.total ?? 0;

  switch (loadingState) {
    case 'uploadingAudio':
      return { steps: build(AUDIO_LABELS, 0, '正在上傳音檔至 Storage...') };
    case 'transcribing': {
      const steps = build(AUDIO_LABELS, 1, 'Whisper 正在進行語音轉錄與斷句...');
      steps[2] = { ...steps[2], detail: '完成後先校對時間軸，確認儲存時再翻譯' };
      return { steps };
    }
    case 'translating':
      return { steps: build(AUDIO_LABELS, 2, `正在翻譯（已完成 ${done} / 共 ${total} 句）...`) };
    case 'processing':
      return { steps: build(TEXT_LABELS, ttsPending ? 2 : 0, 'Gemini AI 正在處理中...') };
    case 'generating':
      return { steps: build(TEXT_LABELS, 1, `正在生成語音 (${done}/${total})...`) };
    default:
      return null;
  }
}
