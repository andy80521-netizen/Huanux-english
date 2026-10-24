import { storage, appId, auth } from '../firebase';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { GoogleGenAI, ThinkingLevel } from '@google/genai';
import { LanguagePattern } from '../types';
import { callWithModelFallback, isRetryableGeminiError } from '../utils/geminiFallback';
// 測試用開關：localStorage 設定 huanux_force_fallback = '1' 並重新整理頁面後，略過所有主要模型、直接使用備用模型
const withTestFallback = (models: string[]): string[] => {
    try {
        if (localStorage.getItem('huanux_force_fallback') === '1') {
            const rest = models.filter(m => m !== models[0]);
            return rest.length > 0 ? rest : models;
        }
    } catch {}
    return models;
};

const TEXT_MODEL = 'gemini-3.6-flash';
const TEXT_MODELS = withTestFallback([TEXT_MODEL, 'gemini-3.5-flash']); // 主要模型忙碌時改用備用模型

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

const cleanAndParseJSON = (text: string) => {
    try {
        const cleaned = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
        return JSON.parse(cleaned);
    } catch (e) {
        throw new Error("無法解析 Gemini 回傳的 JSON 格式。請稍後再試。");
    }
};

// 主要情境大類清單（v1 規格書第 2 節），萃取句型時要求 primaryCategory 從中選一個大類
const PRIMARY_CATEGORY_GUIDE = `主要情境分類（primaryCategory 只能填以下 13 個大類名稱之一，不要加【】符號；冒號後面的細項只是幫助你判斷歸類的參考，不要填細項）：
- 餐飲消費：餐廳用餐、咖啡/手搖飲料店點餐、超市/雜貨店採購、外送/外帶點餐
- 交通票務：買票(電影/演唱會/車票/機票)、大眾運輸問路搭乘、計程車/共乘叫車、租車/加油站
- 旅遊住宿：機場通關/登機、飯店入住退房、旅遊景點介紹/導覽、觀光諮詢/問路
- 職場工作：辦公室日常溝通(開會/交辦/回報)、倉庫/物流現場作業溝通、求職面試、電話/視訊會議、跟主管同事協調排班或請假、職場衝突/意見不合處理
- 電話客服：電話諮詢/客服申訴、預約掛號(醫療/美容/維修)、銀行/電信/保險客服對話
- 消費購物：商品退換貨、議價/詢問折扣、網路購物客訴/查詢訂單、消費者權益爭議
- 行銷商務：行銷話術/推銷產品、業務開發/陌生開發、簡報/提案表達、商務書信/email往來語氣
- 醫療健康：診所/醫院問診、藥局購買藥品說明症狀、健身房/運動教練溝通
- 政府行政：政府機關辦事(申請文件/簽證/稅務諮詢)、銀行開戶/金融事務
- 社交人際：朋友聚會邀約/婉拒、感謝/道歉/安慰、抱怨/委婉表達不滿、打招呼/寒暄/告別、約會/聯誼
- 時事議題：社會事件說明/新聞轉述、時事評論/表達立場、環保/公共議題討論
- 教育學習：課堂討論/發言、跟老師教授溝通(請假/問問題)、語言交換/學習夥伴對話
- 居家生活：租屋/房東溝通、鄰居互動、居家維修/水電叫工
只有在以上 13 類都明顯不適合時，才可以自訂一個新的大類名稱（4 個字，風格比照上面）。`;

// 清洗 primaryCategory：去除【】與空白，空值改為「未分類」
const normalizePrimaryCategories = (items: any) => {
    if (!Array.isArray(items)) return items;
    return items.map((item: any) => {
        const raw = typeof item?.primaryCategory === 'string' ? item.primaryCategory : '';
        const cleaned = raw.replace(/[【】]/g, '').trim();
        return { ...item, primaryCategory: cleaned || '未分類' };
    });
};

export async function splitTextToSentences(sourceText: string): Promise<{ text: string; translation: string }[]> {
    const idToken = await auth.currentUser?.getIdToken();
    if (!idToken) throw new Error('請先登入');

    const response = await fetch('/.netlify/functions/split-text', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${idToken}`
        },
        body: JSON.stringify({ sourceText })
    });

    if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.error || `請求失敗 (HTTP ${response.status})`);
    }

    return await response.json();
}


export async function uploadFileToGemini(file: File) {
    return await ai.files.upload({
        file: file,
        config: {
            mimeType: file.type || 'audio/mpeg'
        }
    });
}


const TTS_MODEL = 'gemini-3.1-flash-tts-preview'; // 獨立常數，之後要換模型只改這裡

// 主要模型忙碌時：等 2 秒再試主要模型一次（盡量維持同一份教材聲音一致），仍失敗才改用備用模型
const TTS_MODELS = withTestFallback([TTS_MODEL, TTS_MODEL, 'gemini-3.8-flash-lite-tts']);

// 解析 TTS 回傳的音訊：同時支援「無檔頭的純 PCM」與「帶 WAV 檔頭」兩種格式，統一轉成純 PCM
const parseTtsAudio = (base64Data: string, mimeType: string | undefined) => {
    const binaryString = atob(base64Data);
    const bytes = new Uint8Array(binaryString.length);
    for (let j = 0; j < binaryString.length; j++) bytes[j] = binaryString.charCodeAt(j);

    const isWav = bytes.length > 12 &&
        String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]) === 'RIFF' &&
        String.fromCharCode(bytes[8], bytes[9], bytes[10], bytes[11]) === 'WAVE';

    if (isWav) {
        const view = new DataView(bytes.buffer);
        let offset = 12;
        let sampleRate = 0, numChannels = 0, bitsPerSample = 0;
        while (offset + 8 <= bytes.length) {
            const chunkId = String.fromCharCode(bytes[offset], bytes[offset + 1], bytes[offset + 2], bytes[offset + 3]);
            const chunkSize = view.getUint32(offset + 4, true);
            if (chunkId === 'fmt ') {
                numChannels = view.getUint16(offset + 10, true);
                sampleRate = view.getUint32(offset + 12, true);
                bitsPerSample = view.getUint16(offset + 22, true);
            } else if (chunkId === 'data') {
                const start = offset + 8;
                const end = Math.min(start + chunkSize, bytes.length);
                return { pcm: bytes.slice(start, end), sampleRate, numChannels, bitsPerSample };
            }
            offset += 8 + chunkSize + (chunkSize % 2);
        }
        throw new Error('WAV 格式解析失敗：找不到音訊資料');
    }

    const rateMatch = /rate=(\d+)/i.exec(mimeType || '');
    return { pcm: bytes, sampleRate: rateMatch ? Number(rateMatch[1]) : 24000, numChannels: 1, bitsPerSample: 16 };
};

export async function generateSpeechForSentences(
  sentences: { text: string }[],
  onProgress?: (current: number, total: number) => void
): Promise<{ audioBlob: Blob; sentencesWithTiming: { startTime: number; endTime: number }[] }> {
    const pcmChunks: Uint8Array[] = [];
    const sentencesWithTiming: { startTime: number; endTime: number }[] = [];
    let currentOffsetSeconds = 0;

    for (let i = 0; i < sentences.length; i++) {
        onProgress?.(i + 1, sentences.length);
        const sentence = sentences[i];
        
        try {
            const response = await callWithModelFallback(TTS_MODELS, (model) => ai.models.generateContent({
                model,
                contents: sentence.text,
                config: {
                    responseModalities: ["AUDIO"],
                    speechConfig: {
                        voiceConfig: {
                            prebuiltVoiceConfig: {
                                voiceName: "Aoede"
                            }
                        }
                    }
                }
            }), { delayMs: 2000 });

            const part = response.candidates?.[0]?.content?.parts?.[0];
            const base64Data = part?.inlineData?.data;
            if (!base64Data) {
                throw new Error("沒有回傳音訊資料");
            }

            const audio = parseTtsAudio(base64Data, part?.inlineData?.mimeType);
            // 所有句子必須是相同格式才能串接；下方 WAV 檔頭固定為 24kHz、單聲道、16-bit
            if (audio.sampleRate !== 24000 || audio.numChannels !== 1 || audio.bitsPerSample !== 16) {
                throw new Error(`語音格式不相容（${audio.sampleRate}Hz / ${audio.numChannels} 聲道 / ${audio.bitsPerSample}-bit），無法串接`);
            }
            const bytes = audio.pcm;

            const duration = bytes.length / 48000;
            const startTime = currentOffsetSeconds;
            const endTime = currentOffsetSeconds + duration;
            currentOffsetSeconds = endTime;

            pcmChunks.push(bytes);
            sentencesWithTiming.push({ startTime, endTime });
        } catch (error: any) {
            throw new Error(`第 ${i + 1} 句語音生成失敗: ${error.message}`);
        }
    }

    // Concatenate all PCM chunks
    const totalPcmLength = pcmChunks.reduce((acc, chunk) => acc + chunk.length, 0);
    const totalPcmData = new Uint8Array(totalPcmLength);
    let offset = 0;
    for (const chunk of pcmChunks) {
        totalPcmData.set(chunk, offset);
        offset += chunk.length;
    }

    // Generate WAV header
    const numChannels = 1;
    const sampleRate = 24000;
    const bitsPerSample = 16;
    const byteRate = (sampleRate * numChannels * bitsPerSample) / 8;
    const blockAlign = (numChannels * bitsPerSample) / 8;
    const dataSize = totalPcmLength;
    const chunkSize = 36 + dataSize;

    const buffer = new ArrayBuffer(44 + dataSize);
    const view = new DataView(buffer);

    const writeString = (view: DataView, offset: number, string: string) => {
        for (let i = 0; i < string.length; i++) {
            view.setUint8(offset + i, string.charCodeAt(i));
        }
    };

    writeString(view, 0, 'RIFF');
    view.setUint32(4, chunkSize, true);
    writeString(view, 8, 'WAVE');
    writeString(view, 12, 'fmt ');
    view.setUint32(16, 16, true); // Subchunk1Size
    view.setUint16(20, 1, true); // AudioFormat (1 = PCM)
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, byteRate, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, bitsPerSample, true);
    writeString(view, 36, 'data');
    view.setUint32(40, dataSize, true);

    const pcmDataBuffer = new Uint8Array(buffer, 44);
    pcmDataBuffer.set(totalPcmData);

    const audioBlob = new Blob([buffer], { type: 'audio/wav' });

    return { audioBlob, sentencesWithTiming };
}

// 把錄音檔轉成 base64（不含 data URL 前綴）
const fileToBase64 = (file: File): Promise<string> =>
    new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
        reader.onerror = () => reject(new Error('讀取錄音檔失敗'));
        reader.readAsDataURL(file);
    });

// 第三層：透過後端 Function 呼叫 Whisper（需登入）
async function transcribeWithWhisper(audioFile: File): Promise<string> {
    const idToken = await auth.currentUser?.getIdToken();
    if (!idToken) throw new Error('請先登入');
    const audioBase64 = await fileToBase64(audioFile);
    const response = await fetch('/.netlify/functions/transcribe-recording', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${idToken}` },
        body: JSON.stringify({ audioBase64, mimeType: audioFile.type || 'audio/webm' })
    });
    if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.error || `HTTP ${response.status}`);
    }
    const data = await response.json();
    if (typeof data?.text !== 'string') throw new Error('Whisper 回傳格式錯誤');
    return data.text.trim();
}

export async function transcribeRecording(audioFile: File): Promise<string> {
    // 測試用開關：瀏覽器 localStorage 設定 huanux_force_whisper = '1' 時，直接使用 Whisper
    let forceWhisper = false;
    try { forceWhisper = localStorage.getItem('huanux_force_whisper') === '1'; } catch {}

    if (!forceWhisper) {
        // 第一、二層：Gemini 主要模型 → 備用模型
        // 錄音直接以 inlineData 夾帶在請求中（不再先上傳檔案），並關閉思考功能以降低延遲
        const t0 = performance.now();
        try {
            const audioBase64 = await fileToBase64(audioFile);
            const mimeType = (audioFile.type || 'audio/webm').split(';')[0];
            const data = await callAiText<{ text: string }>('transcribe', { audioBase64, mimeType });
            if (!data?.text) throw new Error("Gemini API 回傳空內容");
            console.log(`[計時] Gemini 語音轉文字完成：${Math.round(performance.now() - t0)} ms`);
            return data.text;
        } catch (e: any) {
            // 任何錯誤都改用 Whisper（Gemini 官方未保證支援 webm/mp4 格式，Whisper 則明確支援）
            console.warn(`[模型備援] Gemini 語音轉文字失敗（${Math.round(performance.now() - t0)} ms），改用 Whisper`, e?.message);
        }
    }

    const t1 = performance.now();
    try {
        const text = await transcribeWithWhisper(audioFile);
        console.log(`[計時] Whisper 語音轉文字完成：${Math.round(performance.now() - t1)} ms`);
        return text;
    } catch (e: any) {
        throw new Error(`語音轉文字失敗：AI 服務暫時忙碌，請稍後再試（${e.message}）`);
    }
}


export async function extractPatternsFromSentence(
    sentenceText: string,
    sentenceTranslation: string,
    existingPatterns: string[] = []   // 這句之前已萃取出的句型（重新萃取時避免重複）
  ): Promise<Omit<LanguagePattern, 'id' | 'sourceMaterialId' | 'sourceLabel' | 'exampleSentences' | 'unlockedGroups'>[]> {
    const data = await callAiText<{ patterns: any[] }>('extractFromSentence', {
        sentenceText,
        sentenceTranslation: (sentenceTranslation || '').slice(0, 1000),
        ...(existingPatterns.length > 0 ? { existingPatterns: existingPatterns.map(t => t.slice(0, 300)).slice(0, 20) } : {})
    });
    return data.patterns;
}


export async function checkSentenceQuality(
    patternText: string,
    userSentence: string
  ): Promise<{ 
      natural: boolean; 
      grammar: boolean; 
      spelling: boolean; 
      comment: string; 
      suggestedRevision?: string;
      suggestedRevisionScope?: 'whole' | 'partial';
      revisionNotes?: string[];
  }> {
    return callAiText('checkSentence', { patternText, userSentence });
}


export async function generatePracticePrompts(
  sentenceText: string,
  patternText: string
): Promise<{ qaQuestion: string; situationalPrompt: string }> {
    return callAiText('practicePrompts', { sentenceText, patternText });
}

const IMAGE_MODELS = withTestFallback(['gemini-3.1-flash-image', 'gemini-3.1-flash-lite-image']);

export async function generatePracticeImage(
  sentenceText: string,
  uid: string
): Promise<string> {
    const prompt = `Generate an image that visually represents this sentence: "${sentenceText}". The image should help the user recall this specific situation.`;

    // 依官方文件，這系列圖片模型不支援 responseMimeType，因此不設定
    const response = await callWithModelFallback(IMAGE_MODELS, (model) => ai.models.generateContent({
        model,
        contents: prompt,
    }));

    const parts = response.candidates?.[0]?.content?.parts || [];
    const inlineData = parts.find((p: any) => p?.inlineData?.data)?.inlineData;

    if (!inlineData || !inlineData.data) {
        throw new Error("Gemini API 未回傳圖片資料");
    }

    const imageBytes = Uint8Array.from(atob(inlineData.data), c => c.charCodeAt(0));

    // 依模型實際回傳的格式決定副檔名與 contentType
    const contentType = inlineData.mimeType || 'image/png';
    const ext = contentType.includes('jpeg') || contentType.includes('jpg') ? 'jpg' : contentType.includes('webp') ? 'webp' : 'png';
    const filename = `img_${Date.now()}.${ext}`;
    const imageRef = ref(storage, `artifacts/${appId}/users/${uid}/patternImages/${filename}`);

    await uploadBytes(imageRef, imageBytes, { contentType });
    const downloadUrl = await getDownloadURL(imageRef);
    
    return downloadUrl;
}

export async function extractPatternsFromText(
    sourceText: string
  ): Promise<Omit<LanguagePattern, 'id' | 'sourceMaterialId' | 'sourceLabel' | 'exampleSentences' | 'unlockedGroups'>[]> {
    if (sourceText.length > 30000) {
        throw new Error('文字太長（超過 30000 字），請分段匯入');
    }
    const data = await callAiText<{ patterns: any[] }>('extractFromText', { sourceText });
    return data.patterns;
}




export async function translateSentences(
  sentences: string[],
  onProgress?: (done: number, total: number) => void
): Promise<string[]> {
    if (sentences.length === 0) {
        return [];
    }

    const idToken = await auth.currentUser?.getIdToken();
    if (!idToken) throw new Error('請先登入');

    const BATCH_SIZE = 30;
    const allTranslations: string[] = [];
    const total = sentences.length;

    const batches: string[][] = [];
    for (let i = 0; i < sentences.length; i += BATCH_SIZE) {
        batches.push(sentences.slice(i, i + BATCH_SIZE));
    }

    for (let b = 0; b < batches.length; b++) {
        const batch = batches[b];
        const response = await fetch('/.netlify/functions/translate-sentences', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${idToken}`
            },
            body: JSON.stringify({ sentences: batch })
        });

        if (!response.ok) {
            const errData = await response.json().catch(() => ({}));
            throw new Error(errData.error || `請求失敗 (HTTP ${response.status})`);
        }

        const data = await response.json();
        const batchTranslations = data?.translations;

        if (!Array.isArray(batchTranslations) || batchTranslations.length !== batch.length) {
            throw new Error(`翻譯失敗：第 ${b + 1} 批句數不符（預期 ${batch.length} 句，收到 ${batchTranslations?.length || 0} 句）`);
        }

        allTranslations.push(...batchTranslations);
        onProgress?.(allTranslations.length, total);
    }

    return allTranslations;
}

async function callAiText<T>(task: string, payload: any): Promise<T> {
    const user = auth.currentUser;
    if (!user) throw new Error('請先登入');
    const idToken = await user.getIdToken();
    const res = await fetch('/.netlify/functions/ai-text', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${idToken}` },
        body: JSON.stringify({ task, payload })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data?.error || `請求失敗 (HTTP ${res.status})`);
    return data as T;
}

export type PatternRelation = {
  index: number;
  relation: 'new' | 'duplicate' | 'variant' | 'synonym';
  matchId?: string;
  matchCandidateIndex?: number;
};

export async function classifyPatterns(
  candidates: { text: string; meaningZh: string }[],
  existing: { id: string; text: string; meaningZh: string }[]
): Promise<PatternRelation[]> {
    const data = await callAiText<{ results: PatternRelation[] }>('classifyPatterns', { candidates, existing });
    return data.results;
}

export interface RetellFeedback {
  coverage: { covered: string[]; missed: string[] };
  corrections: { original: string; better: string; note: string }[];
  patternUsage: { id: string; status: 'correct' | 'incorrect' | 'unused'; note: string }[];
  modelAnswer: string;
  comment: string;
  contentScore: number;
  languageScore: number;
}

export async function segmentMaterial(sentences: string[]): Promise<{ title: string; start: number; end: number }[]> {
    const data = await callAiText<{ segments: { title: string; start: number; end: number }[] }>('segmentMaterial', { sentences });
    return data.segments;
}

export async function reviewRetellWithAi(
  segmentText: string,
  transcript: string,
  targetPatterns: { id: string; text: string; meaningZh: string }[]
): Promise<RetellFeedback> {
    return callAiText<RetellFeedback>('reviewRetell', { segmentText, transcript, targetPatterns });
}

export async function regenerateSeedExamples(
  pattern: { text: string; meaningZh: string; usageContext: string; category: string },
  avoidSentences: string[]
): Promise<{ en: string; zh: string }[]> {
    const data = await callAiText<{ examples: { en: string; zh: string }[] }>('regenerateSeeds', {
        pattern: { text: pattern.text, meaningZh: pattern.meaningZh, usageContext: pattern.usageContext, category: pattern.category },
        avoidSentences: avoidSentences.slice(0, 300).map(s => s.slice(0, 500))
    });
    return data.examples;
}

