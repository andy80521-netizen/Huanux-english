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
  const COMMON_ABBREVIATIONS = ["Dr", "Mr", "Mrs", "Ms", "St", "Jr", "Sr", "Prof"];

  // 步驟一：先把 segments 按照標點分組，不處理時間邊界
  const groupedSentences: { text: string; firstSeg: Segment; lastSeg: Segment; lowConfidence?: boolean }[] = [];
  
  let currentSentenceParts: string[] = [];
  let firstSeg: Segment | null = null;
  let segmentCount = 0;

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    const trimmedText = seg.text.trim();
    
    if (segmentCount === 0) {
      firstSeg = seg;
    }
    
    currentSentenceParts.push(trimmedText);
    segmentCount++;

    const hasSentenceEndPunctuation = /[.!?]["”']?$/.test(trimmedText);
    const textWithoutPunctuation = trimmedText.replace(/[.!?]["”']?$/, "");
    const isAbbreviation = COMMON_ABBREVIATIONS.some(abbr => abbr.toLowerCase() === textWithoutPunctuation.toLowerCase());
    const isSentenceEnd = hasSentenceEndPunctuation && !isAbbreviation;

    if (isSentenceEnd) {
      groupedSentences.push({
        text: currentSentenceParts.join(" "),
        firstSeg: firstSeg!,
        lastSeg: seg
      });
      currentSentenceParts = [];
      segmentCount = 0;
    } else if (segmentCount >= 4) {
      groupedSentences.push({
        text: currentSentenceParts.join(" "),
        firstSeg: firstSeg!,
        lastSeg: seg,
        lowConfidence: true
      });
      currentSentenceParts = [];
      segmentCount = 0;
    }
  }

  if (segmentCount > 0) {
    groupedSentences.push({
      text: currentSentenceParts.join(" "),
      firstSeg: firstSeg!,
      lastSeg: segments[segments.length - 1]
    });
  }

  // 步驟二：透過 words 尋找最大的停頓空隙，精確計算句子間的邊界
  const findPreciseBoundary = (roughBoundaryTime: number, words: Word[], sentenceIndex: number): number => {
    // 篩選出 start 落在 roughBoundaryTime - 2 到 roughBoundaryTime + 2 的字
    const filteredWords = words.filter(w => w.start >= roughBoundaryTime - 2 && w.start <= roughBoundaryTime + 2);
    filteredWords.sort((a, b) => a.start - b.start);

    // 防呆：如果找不到足夠的字，退回原本的 segment 邊界
    if (filteredWords.length < 2) {
      return roughBoundaryTime;
    }

    let maxGap = -1;
    let maxGapIndex = 0;

    // 依序檢查相鄰兩個字之間的空隙
    for (let k = 0; k < filteredWords.length - 1; k++) {
      const gap = filteredWords[k + 1].start - filteredWords[k].end;
      if (gap > maxGap) {
        maxGap = gap;
        maxGapIndex = k;
      }
    }

    // 取空隙的正中間值
    const preciseBoundary = (filteredWords[maxGapIndex].end + filteredWords[maxGapIndex + 1].start) / 2;

    // 暫時性 Log：核對第 1、2 句之間 (index 0) 與 第 8、9 句之間 (index 7)
    if (sentenceIndex === 0 || sentenceIndex === 7) {
      console.log(`\n========== 句子分界點核對 (第 ${sentenceIndex + 1} 句結束 與 第 ${sentenceIndex + 2} 句開始) ==========`);
      console.log(`原本 Segment 給的 Rough Boundary: ${roughBoundaryTime}`);
      console.log(`篩選範圍內的 Words:`, JSON.stringify(filteredWords));
      console.log(`找到的最大空隙是: ${maxGap.toFixed(4)} 秒`);
      console.log(`空隙發生在 "${filteredWords[maxGapIndex].word}" (end: ${filteredWords[maxGapIndex].end}) 與 "${filteredWords[maxGapIndex + 1].word}" (start: ${filteredWords[maxGapIndex + 1].start}) 之間`);
      console.log(`最後算出的精確分界時間點: ${preciseBoundary}`);
      console.log(`========================================================================\n`);
    }

    return preciseBoundary;
  };

  const results: MergedSentence[] = [];

  for (let i = 0; i < groupedSentences.length; i++) {
    const group = groupedSentences[i];
    
    // 預設為該句自己 segment 的 start / end
    let startTime = group.firstSeg.start;
    let endTime = group.lastSeg.end;

    // 下一句的 startTime 直接沿用上一句算出來的同一個分界值
    if (i > 0) {
      startTime = results[i - 1].endTime;
    }

    // 每一句的 endTime，如果後面還有下一句，就呼叫 findPreciseBoundary 計算
    if (i < groupedSentences.length - 1) {
      endTime = findPreciseBoundary(group.lastSeg.end, words, i);
    }

    results.push({
      text: group.text,
      startTime,
      endTime,
      ...(group.lowConfidence ? { lowConfidence: true } : {})
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
