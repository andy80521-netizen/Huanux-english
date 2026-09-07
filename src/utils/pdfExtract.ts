import * as pdfjsLib from 'pdfjs-dist';

// 指定 Worker 的 CDN 路徑，避免 Vite 打包時的 Worker 載入問題
pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.mjs`;

export async function extractTextFromPdf(file: File): Promise<string> {
    try {
        const arrayBuffer = await file.arrayBuffer();
        const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
        let fullText = '';

        for (let i = 1; i <= pdf.numPages; i++) {
            const page = await pdf.getPage(i);
            const textContent = await page.getTextContent();
            const pageText = textContent.items
                .map((item: any) => item.str)
                .join(' ');
            fullText += pageText + '\n';
        }

        const cleanedText = fullText.trim();
        if (!cleanedText) {
            throw new Error("這份 pdf 可能是掃描檔，請改用貼上文字的方式匯入。");
        }

        return cleanedText;
    } catch (error: any) {
        if (error.message && error.message.includes("掃描檔")) {
            throw error;
        }
        throw new Error("無法解析 PDF 檔案，可能檔案已損毀或包含不支援的格式。請改用純文字貼上。");
    }
}
