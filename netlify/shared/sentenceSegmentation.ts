// 匯入 mp3 的切句（Whisper segment → 句子）
// 從 netlify/functions/whisper-transcribe.ts 搬來，行為不變；離線對照也用同一份（docs/plans/timestamp-baseline.md）

export interface Segment {
  text: string;
  start: number;
  end: number;
}

export interface MergedSentence {
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

export function mergeSegmentsIntoSentences(segments: Segment[]): MergedSentence[] {
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

  // 安全緩衝：每句 startTime 統一往前推 0.1 秒，允許與上一句重疊，
  // 寧可多聽到前一句尾音，也不要漏掉這句真正的第一個字。
  // 只調整 startTime，endTime 維持不變。
  // 最後把 startTime / endTime 四捨五入到小數點後兩位，去除浮點數誤差。
  const roundTo2 = (n: number) => Math.round(n * 100) / 100;
  const resultsWithBuffer = mergedResults.map(r => ({
    ...r,
    startTime: roundTo2(Math.max(0, r.startTime - 0.1)),
    endTime: roundTo2(r.endTime)
  }));

  return resultsWithBuffer;
}
