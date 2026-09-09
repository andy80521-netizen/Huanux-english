import { Context } from "@netlify/functions";

interface Segment {
  text: string;
  start: number;
  end: number;
}

interface Word {
  word: string;
  start: number;
  end: number;
}

interface MergedSentence {
  text: string;
  startTime: number;
  endTime: number;
  lowConfidence?: boolean;
}

function mergeSegmentsIntoSentences(segments: Segment[], words: Word[] = []): MergedSentence[] {
  const results: MergedSentence[] = [];
  
  let currentSentenceParts: string[] = [];
  let currentStartTime: number = 0;
  let currentEndTime: number = 0;
  let segmentCount = 0;
  
  // 任務一：維護一個字數索引的累加計數器
  let wordCursor = 0;
  let sentenceFirstWordIndex = 0;

  // 輔助函式：透過索引去 words 陣列裡直接取值，若超出範圍則退回預設值
  const getIndexedTimestamps = (firstIdx: number, lastIdx: number, defaultStart: number, defaultEnd: number) => {
    let finalStart = defaultStart;
    let finalEnd = defaultEnd;

    if (words && words.length > 0) {
      const firstWordObj = words[firstIdx];
      if (firstWordObj && typeof firstWordObj.start === 'number') {
        finalStart = firstWordObj.start;
      }
      
      const lastWordObj = words[lastIdx];
      if (lastWordObj && typeof lastWordObj.end === 'number') {
        finalEnd = lastWordObj.end;
      }
    }

    return { finalStart, finalEnd };
  };

  const COMMON_ABBREVIATIONS = ["Dr", "Mr", "Mrs", "Ms", "St", "Jr", "Sr", "Prof"];

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    const trimmedText = seg.text.trim();
    
    // 計算這個 segment 有幾個字（避開空字串產生長度為 1 的 ['']）
    const textWords = trimmedText ? trimmedText.split(/\s+/) : [];
    const wordCountOfThisSegment = textWords.length;
    
    const segFirstWordIndex = wordCursor;
    // 這個 segment 結束的索引
    const segLastWordIndex = wordCursor + Math.max(0, wordCountOfThisSegment - 1);
    
    // 如果是這一句的第一個片段，記錄起點時間與第一個字的索引
    if (segmentCount === 0) {
      currentStartTime = seg.start;
      sentenceFirstWordIndex = segFirstWordIndex;
    }
    
    currentSentenceParts.push(trimmedText);
    currentEndTime = seg.end;
    segmentCount++;

    // 將 cursor 移到下一個 segment 的起點
    wordCursor += wordCountOfThisSegment;

    const combinedText = currentSentenceParts.join(" ");
    
    // 任務二：判斷是否為常見縮寫
    // 檢查結尾字元是否為句子結束標點
    const hasSentenceEndPunctuation = /[.!?]["”']?$/.test(trimmedText);
    // 剔除標點符號，用來做「完全等於清單內縮寫」的精確比對
    const textWithoutPunctuation = trimmedText.replace(/[.!?]["”']?$/, "");
    const isAbbreviation = COMMON_ABBREVIATIONS.some(abbr => abbr.toLowerCase() === textWithoutPunctuation.toLowerCase());
    
    // 若符合標點規則且「整個 segment 並非縮寫」，才視為句子結束
    const isSentenceEnd = hasSentenceEndPunctuation && !isAbbreviation;

    if (isSentenceEnd) {
      const { finalStart, finalEnd } = getIndexedTimestamps(
        sentenceFirstWordIndex, 
        segLastWordIndex, 
        currentStartTime, 
        currentEndTime
      );

      results.push({
        text: combinedText,
        startTime: finalStart,
        endTime: finalEnd
      });
      // 清空狀態
      currentSentenceParts = [];
      segmentCount = 0;
    } else if (segmentCount >= 4) {
      const { finalStart, finalEnd } = getIndexedTimestamps(
        sentenceFirstWordIndex, 
        segLastWordIndex, 
        currentStartTime, 
        currentEndTime
      );

      // 安全網：滿 4 個 segment 強制中斷
      results.push({
        text: combinedText,
        startTime: finalStart,
        endTime: finalEnd,
        lowConfidence: true
      });
      // 清空狀態
      currentSentenceParts = [];
      segmentCount = 0;
    }
  }

  // 處理收尾：如果全部陣列跑完還有未輸出的字串
  if (segmentCount > 0) {
    // 此時 wordCursor 已經往前推過了，所以最後一個字的索引是 wordCursor - 1
    const { finalStart, finalEnd } = getIndexedTimestamps(
      sentenceFirstWordIndex, 
      Math.max(0, wordCursor - 1), 
      currentStartTime, 
      currentEndTime
    );

    results.push({
      text: currentSentenceParts.join(" "),
      startTime: finalStart,
      endTime: finalEnd
    });
  }

  return results;
}

export default async (req: Request, context: Context) => {
  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return new Response(JSON.stringify({ error: "Missing OPENAI_API_KEY" }), { 
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }

  try {
    const formData = await req.formData();
    const file = formData.get("file");

    if (!file || !(file instanceof File)) {
      return new Response(JSON.stringify({ error: "No audio file provided in 'file' field" }), { 
        status: 400,
        headers: { "Content-Type": "application/json" }
      });
    }

    const openAiFormData = new FormData();
    openAiFormData.append("file", file);
    openAiFormData.append("model", "whisper-1");
    openAiFormData.append("response_format", "verbose_json");
    openAiFormData.append("timestamp_granularities[]", "segment");
    openAiFormData.append("timestamp_granularities[]", "word");

    const openAiResponse = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`
      },
      body: openAiFormData
    });

    const data = await openAiResponse.json();

    if (!openAiResponse.ok) {
      console.error("OpenAI API Error:", data);
      return new Response(JSON.stringify({ error: "OpenAI API request failed", details: data }), { 
        status: openAiResponse.status,
        headers: { "Content-Type": "application/json" }
      });
    }

    const results = mergeSegmentsIntoSentences(data.segments || [], data.words || []);

    return new Response(JSON.stringify(results), { 
      status: 200, 
      headers: { "Content-Type": "application/json" } 
    });

  } catch (error: any) {
    console.error("Transcription error:", error);
    return new Response(JSON.stringify({ error: "Internal Server Error", message: error.message }), { 
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }
};
