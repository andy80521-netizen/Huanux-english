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

// 語速異常偵測參數
const MAX_SECONDS_PER_WORD = 1.2;
const MIN_DURATION_FOR_RATE_CHECK = 3;

// 碎片併入參數：異常句往前找「字數 <= MAX_FRAGMENT_WORDS」且「開始時間在 FRAGMENT_LOOKBACK_SECONDS 秒內」的連續短句
const MAX_FRAGMENT_WORDS = 5;
const FRAGMENT_LOOKBACK_SECONDS = 10;

function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
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

  // 語速異常偵測 + 碎片併入（使用套用緩衝前的原始時間）：
  // Whisper 遇到片頭音樂時，常把後面才講的短句文字「提早」標到音樂區段，
  // 導致後面那句的時間區間異常地長。偵測到這種異常句時，把它前面緊鄰的碎片短句文字併進來，
  // 時間範圍只沿用異常句本身（真正的語音都在這段），音樂區段因此不會被任何句子涵蓋。
  const mergedResults: MergedSentence[] = [];
  for (const r of results) {
    const duration = r.endTime - r.startTime;
    const wordCount = countWords(r.text);
    const secondsPerWord = wordCount > 0 ? duration / wordCount : 0;
    const isAbnormalRate =
      duration > MIN_DURATION_FOR_RATE_CHECK && secondsPerWord > MAX_SECONDS_PER_WORD;

    if (!isAbnormalRate) {
      mergedResults.push(r);
      continue;
    }

    const pulledFragments: MergedSentence[] = [];
    while (mergedResults.length > 0) {
      const prev = mergedResults[mergedResults.length - 1];
      const isFragment =
        countWords(prev.text) <= MAX_FRAGMENT_WORDS &&
        r.startTime - prev.startTime <= FRAGMENT_LOOKBACK_SECONDS;
      if (!isFragment) break;
      pulledFragments.unshift(mergedResults.pop()!);
    }

    mergedResults.push({
      text: [...pulledFragments.map(p => p.text), r.text].join(" "),
      startTime: r.startTime,
      endTime: r.endTime,
      lowConfidence: true
    });
  }

  // 安全緩衝：每句 startTime 統一往前推 0.2 秒，允許與上一句重疊，
  // 寧可多聽到前一句尾音，也不要漏掉這句真正的第一個字。
  // 只調整 startTime，endTime 維持不變。
  const resultsWithBuffer = mergedResults.map(r => ({
    ...r,
    startTime: Math.max(0, r.startTime - 0.2)
  }));

  return resultsWithBuffer;
}

async function writeToFirestore(
  resultDocPath: string,
  idToken: string,
  fields: Record<string, any>,
  fieldPaths: string[]
): Promise<void> {
  try {
    const cleanPath = resultDocPath.replace(/^\/+/, "");
    const documentResourcePath = cleanPath.startsWith("projects/")
      ? cleanPath
      : `projects/huanux-english/databases/(default)/documents/${cleanPath}`;

    const updateMaskParams = fieldPaths
      .map(path => `updateMask.fieldPaths=${encodeURIComponent(path)}`)
      .join("&");

    const firestoreUrl = `https://firestore.googleapis.com/v1/${documentResourcePath}?${updateMaskParams}`;

    const response = await fetch(firestoreUrl, {
      method: "PATCH",
      headers: {
        "Authorization": `Bearer ${idToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ fields })
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error(`Firestore REST API write failed (HTTP ${response.status} ${response.statusText}):`, errText);
    }
  } catch (err: any) {
    console.error("Firestore REST API write exception:", err);
  }
}

export const config = { background: true };

export default async (req: Request, context: Context) => {
  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  let body: any;
  try {
    body = await req.json();
  } catch (e: any) {
    console.error("Invalid JSON body received:", e?.message);
    return new Response(null, { status: 200 });
  }

  const { audioUrl, idToken, resultDocPath } = body || {};

  if (
    !audioUrl || typeof audioUrl !== "string" || !audioUrl.startsWith("https://") ||
    !idToken || typeof idToken !== "string" ||
    !resultDocPath || typeof resultDocPath !== "string"
  ) {
    console.error("Missing or invalid parameters:", {
      hasAudioUrl: typeof audioUrl === "string",
      hasIdToken: typeof idToken === "string",
      hasResultDocPath: typeof resultDocPath === "string"
    });
    return new Response(null, { status: 200 });
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    const errMsg = "Server configuration error: Missing OPENAI_API_KEY";
    console.error(errMsg);
    await writeToFirestore(
      resultDocPath,
      idToken,
      {
        status: { stringValue: "error" },
        errorMessage: { stringValue: errMsg },
        completedAt: { stringValue: new Date().toISOString() }
      },
      ["status", "errorMessage", "completedAt"]
    );
    return new Response(null, { status: 200 });
  }

  try {
    // 下載音檔
    let audioBuffer: ArrayBuffer;
    try {
      const audioResponse = await fetch(audioUrl);
      if (!audioResponse.ok) {
        throw new Error(`HTTP ${audioResponse.status} ${audioResponse.statusText}`);
      }
      audioBuffer = await audioResponse.arrayBuffer();
    } catch (fetchErr: any) {
      const errMsg = `下載音檔失敗: ${fetchErr.message}`;
      console.error(errMsg, fetchErr);
      await writeToFirestore(
        resultDocPath,
        idToken,
        {
          status: { stringValue: "error" },
          errorMessage: { stringValue: errMsg },
          completedAt: { stringValue: new Date().toISOString() }
        },
        ["status", "errorMessage", "completedAt"]
      );
      return new Response(null, { status: 200 });
    }

    // 準備傳送給 OpenAI 的 FormData
    const audioBlob = new Blob([audioBuffer], { type: "audio/mpeg" });
    const openAiFormData = new FormData();
    openAiFormData.append("file", audioBlob, "audio.mp3");
    openAiFormData.append("model", "whisper-1");
    openAiFormData.append("response_format", "verbose_json");
    openAiFormData.append("timestamp_granularities[]", "segment");

    // 呼叫 OpenAI Whisper API
    const openAiResponse = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`
      },
      body: openAiFormData
    });

    const data = await openAiResponse.json();

    if (!openAiResponse.ok) {
      const errMsg = `OpenAI API 錯誤 (${openAiResponse.status}): ${data?.error?.message || JSON.stringify(data)}`;
      console.error(errMsg, data);
      await writeToFirestore(
        resultDocPath,
        idToken,
        {
          status: { stringValue: "error" },
          errorMessage: { stringValue: errMsg },
          completedAt: { stringValue: new Date().toISOString() }
        },
        ["status", "errorMessage", "completedAt"]
      );
      return new Response(null, { status: 200 });
    }

    // 將 Whisper 回傳的 segments 轉換為需求格式
    const results = mergeSegmentsIntoSentences(data.segments || []);

    // 轉換成 Firestore REST API arrayValue 格式
    const firestoreResultsValues = results.map(item => {
      const fields: Record<string, any> = {
        text: { stringValue: item.text },
        startTime: { doubleValue: Number(item.startTime) },
        endTime: { doubleValue: Number(item.endTime) }
      };
      if (typeof item.lowConfidence === "boolean") {
        fields.lowConfidence = { booleanValue: item.lowConfidence };
      }
      return {
        mapValue: { fields }
      };
    });

    // 寫入 Firestore 結果
    await writeToFirestore(
      resultDocPath,
      idToken,
      {
        status: { stringValue: "completed" },
        results: {
          arrayValue: firestoreResultsValues.length > 0 ? { values: firestoreResultsValues } : {}
        },
        completedAt: { stringValue: new Date().toISOString() }
      },
      ["status", "results", "completedAt"]
    );

    return new Response(null, { status: 200 });
  } catch (error: any) {
    const errMsg = `Transcription error: ${error.message}`;
    console.error(errMsg, error);
    await writeToFirestore(
      resultDocPath,
      idToken,
      {
        status: { stringValue: "error" },
        errorMessage: { stringValue: errMsg },
        completedAt: { stringValue: new Date().toISOString() }
      },
      ["status", "errorMessage", "completedAt"]
    );
    return new Response(null, { status: 200 });
  }
};
