// 結果頁顯示「這次由哪個模型轉錄」（PR A，診斷用）

/** 'gemini-3.6-flash' → 'Gemini 3.6 Flash'；'whisper-1' → 'Whisper'；未知或空白 → '' */
export function transcriberLabel(model: string | null | undefined): string {
  const m = (model || '').trim();
  if (!m) return '';
  if (m === 'whisper-1') return 'Whisper';
  const whisper = m.match(/^whisper-(.+)$/i);
  if (whisper) return `Whisper ${whisper[1]}`;
  const gemini = m.match(/^gemini-(.+)$/i);
  if (gemini) {
    return 'Gemini ' + gemini[1].split('-').map((p) => (/^\d/.test(p) ? p : p.charAt(0).toUpperCase() + p.slice(1))).join(' ');
  }
  return m;
}
