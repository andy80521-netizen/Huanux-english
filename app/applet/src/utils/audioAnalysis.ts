export interface SilenceInterval {
  start: number;  // 秒
  end: number;    // 秒
}

export async function detectSilenceIntervals(
  audioFile: File,
  options?: { silenceThresholdDb?: number; minSilenceDurationSec?: number }
): Promise<SilenceInterval[]> {
  const silenceThresholdDb = options?.silenceThresholdDb ?? -40; // 預設門檻：-40 dB
  const minSilenceDurationSec = options?.minSilenceDurationSec ?? 0.3; // 預設最短靜音時長：0.3秒
  
  // 建立 AudioContext (相容 webkit 舊版)
  const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
  if (!AudioContextClass) {
    throw new Error("此瀏覽器環境不支援 Web Audio API (AudioContext)");
  }
  
  const audioContext = new AudioContextClass();
  
  try {
    // 讀取檔案並解碼成 AudioBuffer
    const arrayBuffer = await audioFile.arrayBuffer();
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
    
    // 取第一聲道(Channel 0)的數據進行分析。對於語音辨識/靜音偵測，單聲道通常已足夠代表性。
    const channelData = audioBuffer.getChannelData(0);
    const sampleRate = audioBuffer.sampleRate;
    
    // 設定時間窗口長度為 20ms (0.02秒)
    const windowDurationSec = 0.02;
    const windowSize = Math.floor(sampleRate * windowDurationSec);
    
    const intervals: SilenceInterval[] = [];
    
    let isSilent = false;
    let currentSilenceStartSec = 0;
    
    // 逐個時間窗口掃描
    for (let i = 0; i < channelData.length; i += windowSize) {
      let sumSquares = 0;
      const currentWindowSize = Math.min(windowSize, channelData.length - i);
      
      // 計算該窗口內振幅的平方和
      for (let j = 0; j < currentWindowSize; j++) {
        const amplitude = channelData[i + j];
        sumSquares += amplitude * amplitude;
      }
      
      // 算出均方根 (Root Mean Square)
      const rms = Math.sqrt(sumSquares / currentWindowSize);
      
      // 轉換為分貝 (dB)。若 rms 為 0，設為 -Infinity
      let db = -Infinity;
      if (rms > 0) {
        db = 20 * Math.log10(rms);
      }
      
      const currentTimeSec = i / sampleRate;
      
      // 狀態機：判斷當下是否低於靜音門檻
      if (db < silenceThresholdDb) {
        if (!isSilent) {
          isSilent = true;
          currentSilenceStartSec = currentTimeSec;
        }
      } else {
        if (isSilent) {
          isSilent = false;
          const silenceDuration = currentTimeSec - currentSilenceStartSec;
          
          // 若靜音持續時間超過門檻，則記錄此區間
          if (silenceDuration >= minSilenceDurationSec) {
            intervals.push({
              start: currentSilenceStartSec,
              end: currentTimeSec
            });
          }
        }
      }
    }
    
    // 處理音檔尾部剛好處於靜音的狀況
    if (isSilent) {
      const endTimeSec = channelData.length / sampleRate;
      const silenceDuration = endTimeSec - currentSilenceStartSec;
      if (silenceDuration >= minSilenceDurationSec) {
        intervals.push({
          start: currentSilenceStartSec,
          end: endTimeSec
        });
      }
    }
    
    return intervals;
  } finally {
    // 釋放 AudioContext 資源
    audioContext.close();
  }
}
