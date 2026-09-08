import { storage, appId } from '../firebase';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { GoogleGenAI } from '@google/genai';
import { LanguagePattern } from '../types';
const TEXT_MODEL = 'gemini-3.6-flash';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

const cleanAndParseJSON = (text: string) => {
    try {
        const cleaned = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
        return JSON.parse(cleaned);
    } catch (e) {
        throw new Error("無法解析 Gemini 回傳的 JSON 格式。請稍後再試。");
    }
};

export async function splitTextToSentences(sourceText: string): Promise<{ text: string; translation: string }[]> {
    const response = await fetch('/.netlify/functions/split-text', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
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

export async function transcribeAudioToSentences(fileData: { uri: string; mimeType: string }, onProgress?: (status: 'uploading' | 'analyzing') => void): Promise<{ text: string; translation: string; lowConfidence: boolean }[]> {
    onProgress?.('analyzing');

    const prompt = `請將這段音檔逐字轉錄為英文句子，並提供每一句的繁體中文翻譯。
若該句轉錄結果聽不清楚或有不確定性，請將 lowConfidence 標記為 true。
請只回傳 JSON 格式的陣列，不要包含任何 markdown 標記、\`\`\`json 標籤或其他文字。
text 欄位必須是原文逐字轉錄內容，絕對不可改寫、不可濃縮摘要。
格式範例：[{ "text": "Sentence 1.", "translation": "翻譯 1。", "lowConfidence": false }, ...]`;

    onProgress?.('analyzing');
    const response = await ai.models.generateContent({
        model: TEXT_MODEL,
        contents: [
            prompt,
            {
                fileData: {
                    fileUri: fileData.uri,
                    mimeType: fileData.mimeType
                }
            }
        ],
        config: {
            temperature: 0.1,
            responseMimeType: "application/json",
        }
    });

    if (!response.text) {
        throw new Error("Gemini API 回傳空內容");
    }

    return cleanAndParseJSON(response.text);
}

const TTS_MODEL = 'gemini-3.1-flash-tts-preview'; // 獨立常數，之後要換模型只改這裡

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
            const response = await ai.models.generateContent({
                model: TTS_MODEL,
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
            });

            const part = response.candidates?.[0]?.content?.parts?.[0];
            const base64Data = part?.inlineData?.data;
            if (!base64Data) {
                throw new Error("沒有回傳音訊資料");
            }

            // Decode base64 to Uint8Array
            const binaryString = atob(base64Data);
            const len = binaryString.length;
            const bytes = new Uint8Array(len);
            for (let j = 0; j < len; j++) {
                bytes[j] = binaryString.charCodeAt(j);
            }

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


import { detectSilenceIntervals } from '../utils/audioAnalysis';

export async function detectTimestamps(
  fileData: { uri: string; mimeType: string },
  audioFile: File,
  sentences: { text: string }[]
): Promise<{ timestamps: { startTime: number; endTime: number }[]; lowConfidence: boolean }> {

    const prompt = `這裡有一段音檔以及它的逐字稿。請幫我為逐字稿中的「每一句話」找出在音檔中對應的開始時間與結束時間（以秒為單位，可以是小數）。
請嚴格遵守以下規則：
1. 請只回傳 JSON 格式的陣列，不要包含任何 markdown 標記、\`\`\`json 標籤或其他文字。
2. 回傳的陣列長度必須剛好是 ${sentences.length}，必須與提供的逐字稿順序完全一致。
3. 每一項的格式為 { "startTime": 1.5, "endTime": 3.2 }。

逐字稿內容：
${JSON.stringify(sentences.map(s => s.text), null, 2)}`;

    const response = await ai.models.generateContent({
        model: TEXT_MODEL,
        contents: [
            prompt,
            {
                fileData: {
                    fileUri: fileData.uri,
                    mimeType: fileData.mimeType
                }
            }
        ],
        config: {
            temperature: 0.1,
            responseMimeType: "application/json",
        }
    });

    if (!response.text) {
        throw new Error("無法抓取時間軸：Gemini API 回傳空內容");
    }

    const parsed = cleanAndParseJSON(response.text);
    
    if (!Array.isArray(parsed) || parsed.length !== sentences.length) {
        throw new Error("無法抓取時間軸：回傳的句數與原始逐字稿不符");
    }

    for (const item of parsed) {
        if (typeof item.startTime !== 'number' || typeof item.endTime !== 'number') {
            throw new Error("無法抓取時間軸：回傳的時間格式不正確");
        }
    }

    const geminiGuessedTimestamps = parsed as { startTime: number; endTime: number }[];

    try {
        const { intervals: silenceIntervals, duration: audioDuration } = await detectSilenceIntervals(audioFile);
        const expectedGapCount = sentences.length - 1;

        if (expectedGapCount <= 0) {
            return {
                timestamps: [{ startTime: 0, endTime: audioDuration }],
                lowConfidence: false
            };
        }

        let finalSilences = [...silenceIntervals];
        const diff = finalSilences.length - expectedGapCount;

        if (diff > 0) {
            // 有多餘停頓點，需要篩選
            const geminiBoundaries: number[] = [];
            for (let i = 0; i < expectedGapCount; i++) {
                geminiBoundaries.push(geminiGuessedTimestamps[i].endTime);
                geminiBoundaries.push(geminiGuessedTimestamps[i + 1].startTime);
            }

            while (finalSilences.length > expectedGapCount) {
                let worstIndex = -1;
                let maxMinDistance = -1;

                for (let i = 0; i < finalSilences.length; i++) {
                    const silenceMid = (finalSilences[i].start + finalSilences[i].end) / 2;
                    let minDistance = Infinity;
                    for (const gb of geminiBoundaries) {
                        const dist = Math.abs(silenceMid - gb);
                        if (dist < minDistance) {
                            minDistance = dist;
                        }
                    }
                    if (minDistance > maxMinDistance) {
                        maxMinDistance = minDistance;
                        worstIndex = i;
                    }
                }
                
                if (worstIndex !== -1) {
                    finalSilences.splice(worstIndex, 1);
                }
            }
        } else if (diff === -1) {
            // 少一個，找出距離所有 silence 最遠的 Gemini boundary 補進來
            const geminiBoundaries: number[] = [];
            for (let i = 0; i < expectedGapCount; i++) {
                geminiBoundaries.push(geminiGuessedTimestamps[i].endTime);
                geminiBoundaries.push(geminiGuessedTimestamps[i + 1].startTime);
            }
            
            let bestGeminiBoundary = 0;
            let maxMinDistance = -1;

            for (const gb of geminiBoundaries) {
                let minDistance = Infinity;
                for (const s of finalSilences) {
                    const silenceMid = (s.start + s.end) / 2;
                    const dist = Math.abs(silenceMid - gb);
                    if (dist < minDistance) {
                        minDistance = dist;
                    }
                }
                if (minDistance > maxMinDistance) {
                    maxMinDistance = minDistance;
                    bestGeminiBoundary = gb;
                }
            }
            finalSilences.push({ start: bestGeminiBoundary, end: bestGeminiBoundary });
        }

        // 當調整後長度一致時，套用校正
        if (finalSilences.length === expectedGapCount) {
            finalSilences.sort((a, b) => a.start - b.start);
            const correctedTimestamps = [];

            for (let i = 0; i < sentences.length; i++) {
                const startTime = i === 0 ? 0 : (finalSilences[i - 1].start + finalSilences[i - 1].end) / 2;
                const endTime = i === sentences.length - 1 ? audioDuration : (finalSilences[i].start + finalSilences[i].end) / 2;
                correctedTimestamps.push({ startTime, endTime });
            }

            return { timestamps: correctedTimestamps, lowConfidence: false };
        } else {
            // 如果還是不一致 (例如 diff < -1)，退回原始猜測
            return { timestamps: geminiGuessedTimestamps, lowConfidence: true };
        }
    } catch (err) {
        console.warn("自動校正時間軸失敗，退回原始猜測:", err);
        return { timestamps: geminiGuessedTimestamps, lowConfidence: true };
    }
}


export async function transcribeRecording(audioFile: File): Promise<string> {
    try {
        const uploadResult = await uploadFileToGemini(audioFile);
        
        const prompt = "請把這段音檔裡使用者說的英文內容逐字轉錄出來,只回傳轉錄後的純文字,不要有任何其他說明文字、不要有引號、不要有markdown格式";
        
        const response = await ai.models.generateContent({
            model: TEXT_MODEL,
            contents: [
                prompt,
                {
                    fileData: {
                        fileUri: uploadResult.uri,
                        mimeType: uploadResult.mimeType
                    }
                }
            ],
            config: {
                temperature: 0.1,
            }
        });
        
        if (!response.text) {
            throw new Error("Gemini API 回傳空內容");
        }
        
        return response.text.trim();
    } catch (e: any) {
        throw new Error(`語音轉文字失敗: ${e.message}`);
    }
}


export async function extractPatternsFromSentence(
    sentenceText: string,
    sentenceTranslation: string
  ): Promise<Omit<LanguagePattern, 'id' | 'sourceMaterialId' | 'sourceLabel' | 'exampleSentences' | 'unlockedGroups'>[]> {
    const prompt = `這是使用者既有的雙語分析框架(結構句型Structural Patterns / 片語Phrases / 語組Collocations三分類)。
輸入只有這一句英文+中文翻譯,請從這句話裡拆解出可能不只一個的句型/片語/語組(例如一句話裡可能同時有一個結構句型跟一個片語,都要各自拆出來)。
每個萃取出來的項目要包含:
- category (三選一: "structural", "phrase", "collocation")
- text (句型/片語本身，英文)
- meaningZh (中文語意說明)
- usageContext (使用時機說明)
- primaryCategory (場景分類, 你可以直接沿用規格書裡提到的主要情境分類邏輯,自行判斷合理值)
- situationTags (情緒/溝通功能標籤陣列，例如 ["劃清界線", "委婉拒絕"])
- seedExamples (至少5個, 明確由你生成的示範例句，不是從原句摘錄，格式 {en: string, zh: string} 陣列)

請只回傳 JSON 陣列，不要有其他文字。
格式範例：
[
  {
    "category": "structural",
    "text": "...",
    "meaningZh": "...",
    "usageContext": "...",
    "primaryCategory": "...",
    "situationTags": ["..."],
    "seedExamples": [{"en": "...", "zh": "..."}]
  }
]

輸入句子：
英文: ${sentenceText}
中文: ${sentenceTranslation}
`;

    const response = await ai.models.generateContent({
        model: TEXT_MODEL,
        contents: prompt,
        config: {
            temperature: 0.2,
        }
    });

    const text = response.text;
    if (!text) {
        throw new Error("無法從 Gemini 取得內容");
    }

    try {
        return cleanAndParseJSON(text);
    } catch (e: any) {
        throw new Error("解析語言模型句型失敗：" + e.message);
    }
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
  }> {
    const prompt = `這是使用者針對某個英文句型/片語自己造的一句話，請檢查這句話：
1) natural (自然度): 只有在「嚴重不自然」時(例如明顯的中式直譯、語序完全不符合英文母語者的表達方式)才給 false。正常範圍內自然度的高低差異不算「不自然」，應該給 true。
2) grammar (文法): 文法對不對。
3) spelling (拼字): 拼字對不對。

注意：使用者造的句子不需要跟原本的句型有完全一樣的情境或字面意思，只需要有實際運用到這個句型/片語的核心用法即可，請基於這個前提判斷，不要因為使用者換了完全不同的情境就誤判為不相關。

目標句型/片語：${patternText}
使用者造的句子：${userSentence}

請只回傳 JSON 物件，不要有其他文字。
- comment 欄位請用中文說明哪裡不自然/文法錯在哪/拼字錯在哪。如果三者都通過 (皆為 true)，comment 可以是簡短的肯定文字(例如「很好，這句話運用得很自然！」)。
- 不論 natural 是 true 或 false，只要你認為有更道地/更好的說法，就提供 suggestedRevision (完整句子版本) 以及 suggestedRevisionScope ('whole' 或 'partial')。
- 如果是部分片段需要調整，suggestedRevision 仍然提供「完整句子」，方便直接替換使用，但 suggestedRevisionScope 標記為 'partial' 讓使用者知道問題只在小部分。如果是整句重寫則標記為 'whole'。
- 如果句子已經很好、沒有更好的建議，suggestedRevision 和 suggestedRevisionScope 可以省略。

格式範例 (有建議時)：
{
  "natural": true,
  "grammar": true,
  "spelling": true,
  "comment": "句子結構很好，但有個小地方可以更道地。",
  "suggestedRevision": "The revised full sentence.",
  "suggestedRevisionScope": "partial"
}

格式範例 (沒建議時)：
{
  "natural": true,
  "grammar": true,
  "spelling": true,
  "comment": "很好，這句話運用得很自然！"
}
`;

    const response = await ai.models.generateContent({
        model: TEXT_MODEL,
        contents: prompt,
        config: {
            temperature: 0.2,
        }
    });

    const text = response.text;
    if (!text) {
        throw new Error("無法從 Gemini 取得內容");
    }

    try {
        return cleanAndParseJSON(text);
    } catch (e: any) {
        throw new Error("解析句子檢查結果失敗：" + e.message);
    }
}


export async function generatePracticePrompts(
  sentenceText: string,
  patternText: string
): Promise<{ qaQuestion: string; situationalPrompt: string }> {
    const prompt = `使用者已經造好一句話: "${sentenceText}"，運用了句型/片語: "${patternText}"。
請設計兩種提示，讓使用者之後看到提示時，能夠回想起並念出這句原本的話(不是造新句子，是要引導使用者念出這句固定的話)：
1) qaQuestion: 一個問答式的引導問句，回答這個問句最自然的答案就是 "${sentenceText}" 這句話
2) situationalPrompt: 一段情境任務描述(例如「你正在跟朋友聊到...，請說出你的想法」)，情境要能自然導向使用者說出 "${sentenceText}"

請只回傳 JSON 物件，不要有其他文字。格式範例：
{
  "qaQuestion": "...",
  "situationalPrompt": "..."
}`;

    const response = await ai.models.generateContent({
        model: TEXT_MODEL,
        contents: prompt,
        config: {
            temperature: 0.3,
        }
    });

    const text = response.text;
    if (!text) {
        throw new Error("無法從 Gemini 取得內容");
    }

    try {
        return cleanAndParseJSON(text);
    } catch (e: any) {
        throw new Error("解析出題內容失敗：" + e.message);
    }
}

export async function generatePracticeImage(
  sentenceText: string,
  uid: string
): Promise<string> {
    const prompt = `Generate an image that visually represents this sentence: "${sentenceText}". The image should help the user recall this specific situation.`;

    // 備註：在實際測試時，使用 image model (例如 gemini-3.1-flash-image) 會遇到 
    // "Quota exceeded for metric: generativelanguage.googleapis.com/generate_content_free_tier_requests, limit: 0"
    // 這表示免費層級 (Free Tier) 對於圖片生成的配額目前為 0。
    // 這裡先實作標準的呼叫流程。
    const response = await ai.models.generateContent({
        model: 'gemini-3.1-flash-image', 
        contents: prompt,
        config: {
            responseMimeType: "image/jpeg"
        }
    });

    const candidate = response.candidates?.[0];
    const inlineData = candidate?.content?.parts?.[0]?.inlineData;

    if (!inlineData) {
        throw new Error("Gemini API 未回傳圖片資料");
    }

    const imageBytes = Uint8Array.from(atob(inlineData.data), c => c.charCodeAt(0));
    
    // 使用 timestamp 作為檔名的一部分
    const filename = `img_${Date.now()}.jpg`;
    const imageRef = ref(storage, `artifacts/${appId}/users/${uid}/patternImages/${filename}`);
    
    await uploadBytes(imageRef, imageBytes, { contentType: 'image/jpeg' });
    const downloadUrl = await getDownloadURL(imageRef);
    
    return downloadUrl;
}

export async function extractPatternsFromText(
    sourceText: string
  ): Promise<Omit<LanguagePattern, 'id' | 'sourceMaterialId' | 'sourceLabel' | 'exampleSentences' | 'unlockedGroups'>[]> {
    const prompt = `這是使用者既有的雙語分析框架(結構句型Structural Patterns / 片語Phrases / 語組Collocations三分類)。
輸入為一段完整的英文段落, 請從這段文字裡找出所有值得萃取的句型/片語/語組。請考慮跨句子的語境關聯, 不要逐句機械式拆解。
每個萃取出來的項目要包含:
- category (三選一: "structural", "phrase", "collocation")
- text (句型/片語本身，英文)
- meaningZh (中文語意說明)
- usageContext (使用時機說明)
- primaryCategory (場景分類, 自行判斷合理的情境分類)
- situationTags (情緒/溝通功能標籤陣列，例如 ["強調", "轉折"])
- seedExamples (至少5個, 明確由你生成的示範例句，格式 {en: string, zh: string} 陣列)

請只回傳 JSON 陣列，不要有其他文字。
格式範例：
[
  {
    "category": "structural",
    "text": "...",
    "meaningZh": "...",
    "usageContext": "...",
    "primaryCategory": "...",
    "situationTags": ["..."],
    "seedExamples": [{"en": "...", "zh": "..."}]
  }
]

輸入文字：
${sourceText}
`;

    const response = await ai.models.generateContent({
        model: TEXT_MODEL,
        contents: prompt,
        config: {
            temperature: 0.2,
        }
    });

    const text = response.text;
    if (!text) {
        throw new Error("無法從 Gemini 取得內容");
    }

    try {
        return cleanAndParseJSON(text);
    } catch (e: any) {
        throw new Error("解析語言模型句型失敗：" + e.message);
    }
}
