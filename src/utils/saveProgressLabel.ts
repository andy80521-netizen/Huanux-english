// 存檔中「確認儲存」按鈕的文字：進度要顯示在使用者剛按下的按鈕上（擁有者 2026-11-09 回報「按了沒反應」）
// 規劃：docs/plans/background-material-save.md

export function saveButtonLabel(
    loadingState: string,
    progress: { done: number; total: number } | null,
): string | null {
    if (loadingState === 'translating') return progress ? `翻譯中 ${progress.done}/${progress.total}…` : '翻譯中…';
    if (loadingState === 'processing') return '儲存中…';
    return null;
}
