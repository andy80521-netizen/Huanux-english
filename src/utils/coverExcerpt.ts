// 封面摘要：教材前 800 字（netlify/shared/saveMaterial.ts 有同一份，測試確認兩者輸出相同）
export function buildCoverExcerpt(sentences: { text: string }[]): string {
    let result = '';
    for (const s of sentences) {
        if (!s.text) continue;
        const piece = (result ? ' ' : '') + s.text.trim();
        if (result.length + piece.length > 800) {
            const remaining = 800 - result.length;
            if (remaining > 0) {
                result += piece.slice(0, remaining);
            }
            break;
        }
        result += piece;
    }
    return result;
}
