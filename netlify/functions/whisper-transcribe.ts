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

  const getRefinedTimestamps = (start: number, end: number) => {
    let finalStart = start;
    let finalEnd = end;
    
    if (words && words.length > 0) {
      // 找出第一個 word.start >= (這句話第一個 segment 的 start) 的字
      const firstWord = words.find(w => w.start >= start);
      if (firstWord) {
        finalStart = firstWord.start;
      }
      
      // 找出最後一個 word.start < (這句話最後一個 segment 的 end) 的字
      let lastWord: Word | undefined;
      for (let i = words.length - 1; i >= 0; i--) {
        if (words[i].start < end) {
          lastWord = words[i];
          break;
        }
      }
      if (lastWord) {
        finalEnd = lastWord.end;
      }
    }
    
    return { finalStart, finalEnd };
  };

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    const trimmedText = seg.text.trim();
    
    // 如果是這一句的第一個片段，記錄起點時間
    if (segmentCount === 0) {
      currentStartTime = seg.start;
    }
    
    currentSentenceParts.push(trimmedText);
    currentEndTime = seg.end;
    segmentCount++;

    // 組合到目前的完整字串（用空白連接）
    const combinedText = currentSentenceParts.join(" ");
    
    // 檢查結尾字元是否為句子結束標點（支援後面緊接引號）
    // [.!?] 匹配基本標點，["”']? 匹配可選的單雙引號，$ 匹配字串結尾
    const isSentenceEnd = /[.!?]["”']?$/.test(trimmedText);

    if (isSentenceEnd) {
      const { finalStart, finalEnd } = getRefinedTimestamps(currentStartTime, currentEndTime);
      // 遇到結尾標點，正常輸出這句
      results.push({
        text: combinedText,
        startTime: finalStart,
        endTime: finalEnd
      });
      // 清空狀態，準備迎接下一句
      currentSentenceParts = [];
      segmentCount = 0;
    } else if (segmentCount >= 4) {
      const { finalStart, finalEnd } = getRefinedTimestamps(currentStartTime, currentEndTime);
      // 安全網：當「滿 4 個」segment 還沒遇到標點時，強制在此處中斷並輸出
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

  // 處理收尾：如果全部陣列跑完，手上還有未輸出的字串（即音檔最後一句沒有句號）
  if (segmentCount > 0) {
    const { finalStart, finalEnd } = getRefinedTimestamps(currentStartTime, currentEndTime);
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
    // 嘗試解析 multipart/form-data
    const formData = await req.formData();
    const file = formData.get("file");

    if (!file || !(file instanceof File)) {
      return new Response(JSON.stringify({ error: "No audio file provided in 'file' field" }), { 
        status: 400,
        headers: { "Content-Type": "application/json" }
      });
    }

    // 準備傳送給 OpenAI 的 FormData
    const openAiFormData = new FormData();
    openAiFormData.append("file", file);
    openAiFormData.append("model", "whisper-1");
    openAiFormData.append("response_format", "verbose_json");
    // 注意：針對陣列參數，有些 API 接受 timestamp_granularities[]，Node 的 fetch 也支援直接 append
    openAiFormData.append("timestamp_granularities[]", "segment");
    openAiFormData.append("timestamp_granularities[]", "word");

    // 呼叫 OpenAI Whisper API
    const openAiResponse = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`
        // 注意: 使用 fetch 傳送 FormData 時，絕對不能手動設定 Content-Type，
        // 瀏覽器/Node 會自動補上帶有正確 boundary 的 multipart/form-data
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

    // 將 Whisper 回傳的 segments 轉換為需求格式，並傳入 words 進行精確時間對齊
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
