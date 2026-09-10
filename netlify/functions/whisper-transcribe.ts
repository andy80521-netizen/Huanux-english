import { Context } from "@netlify/functions";

interface Segment {
  text: string;
  start: number;
  end: number;
}

interface MergedSentence {
  text: string;
  startTime: number;
  endTime: number;
  lowConfidence?: boolean;
}

function mergeSegmentsIntoSentences(segments: Segment[]): MergedSentence[] {
  const results: MergedSentence[] = [];

  let currentSentenceParts: string[] = [];
  let currentStartTime: number = 0;
  let currentEndTime: number = 0;
  let segmentCount = 0;

  const COMMON_ABBREVIATIONS = ["Dr", "Mr", "Mrs", "Ms", "St", "Jr", "Sr", "Prof"];

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    const trimmedText = seg.text.trim();

    if (segmentCount === 0) {
      currentStartTime = seg.start;
    }

    currentSentenceParts.push(trimmedText);
    currentEndTime = seg.end;
    segmentCount++;

    const combinedText = currentSentenceParts.join(" ");

    const hasSentenceEndPunctuation = /[.!?]["”']?$/.test(trimmedText);
    const textWithoutPunctuation = trimmedText.replace(/[.!?]["”']?$/, "");
    const isAbbreviation = COMMON_ABBREVIATIONS.some(abbr => abbr.toLowerCase() === textWithoutPunctuation.toLowerCase());

    const isSentenceEnd = hasSentenceEndPunctuation && !isAbbreviation;

    if (isSentenceEnd) {
      results.push({
        text: combinedText,
        startTime: currentStartTime,
        endTime: currentEndTime
      });
      currentSentenceParts = [];
      segmentCount = 0;
    } else if (segmentCount >= 4) {
      results.push({
        text: combinedText,
        startTime: currentStartTime,
        endTime: currentEndTime,
        lowConfidence: true
      });
      currentSentenceParts = [];
      segmentCount = 0;
    }
  }

  if (segmentCount > 0) {
    results.push({
      text: currentSentenceParts.join(" "),
      startTime: currentStartTime,
      endTime: currentEndTime
    });
  }

  // 安全緩衝：每句 startTime 統一往前推 1 秒，允許與上一句重疊，
  // 寧可多聽到前一句尾音，也不要漏掉這句真正的第一個字。
  // 只調整 startTime，endTime 維持不變。
  const resultsWithBuffer = results.map(r => ({
    ...r,
    startTime: Math.max(0, r.startTime - 1)
  }));

  return resultsWithBuffer;
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
    // 只要求 segment 顆粒度，不再要求 word（word 陣列與 segment 文字對不齊，已證實不可靠）
    openAiFormData.append("timestamp_granularities[]", "segment");

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

    // 將 Whisper 回傳的 segments 轉換為需求格式
    const results = mergeSegmentsIntoSentences(data.segments || []);

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
