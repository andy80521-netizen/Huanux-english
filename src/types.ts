// ===== 啟蒙的開始:教材 =====
export interface MaterialSentence {
  id: string;
  text: string;              // 英文句子
  translation?: string;      // 中文翻譯（可由 Gemini 匯入時一併產生）
  startTime: number;         // 秒，對應 mp3 時間軸
  endTime: number;
  lowConfidence?: boolean;
  mastery: number;           // 沿用現有 mastery 累加機制
  lastScores?: { pronunciation: number; fluency: number; stress: number; total: number };
  extracted?: boolean;  // 是否已萃取過語言模型句型
}

export interface Material {
  id: string;
  title: string;
  course: string;
  sourceText: string;        // 原始匯入文字（Gemini 摘要拆句前的全文）
  audioUrl: string;          // Firebase Storage 下載網址
  audioSource: 'upload' | 'tts';
  sentences: MaterialSentence[];
  createdAt: number;
  graduated: boolean;        // 是否已萃取語言模型
  graduatedAt?: number;
}

// ===== 語言模型 =====
export type PatternCategory = 'structural' | 'phrase' | 'collocation';
// 對應使用者既有框架：結構句型 Structural Patterns / 片語 Phrases / 語組 Collocations

export interface PatternExampleSentence {
  id: string;
  text: string;                 // 使用者自己造的句子（這是固定的評分目標，不會變）
  checked: boolean;             // 是否通過 Gemini 檢查
  checkFeedback?: {
    natural: boolean;
    grammar: boolean;
    spelling: boolean;
    comment: string;            // 中文說明哪裡不自然/文法錯/拼字錯
    suggestedRevision?: string;
    suggestedRevisionScope?: 'whole' | 'partial';
  };
  groupIndex: number;           // 0-9，對應 10 組
  mastery: number;              // 沿用現有 mastery 累加機制，達 1000 視為完成
  attemptCount: number;         // 累計嘗試次數（含未達70分的無效嘗試，用於分配出題難度）
  lastAttemptAt?: number;       // 上次「有效嘗試」(>=70分)的時間戳，用於間隔複習判斷
  nextAvailableAt?: number;     // 下次可以再練這句的時間戳（間隔複習排程）
  // 三種出題內容都是「生成一次、固定重複使用」，不是每次練習重新生成
  qaQuestion?: string;          // 固定的提示Q&A問句
  situationalPrompt?: string;   // 固定的情境任務描述
  imageUrl?: string;            // 固定的情境圖片（Firebase Storage 網址）
}

export interface LanguagePattern {
  id: string;
  category: PatternCategory;
  text: string;                 // 句型/片語/語組本身（英文）
  meaningZh: string;            // 中文語意說明
  usageContext: string;         // 使用時機說明
  primaryCategory: string;      // 主要情境分類（場景/領域，句型庫瀏覽的主要導覽軸）
  situationTags: string[];      // 情緒/溝通功能標籤，例如「劃清界線」「委婉拒絕」
                                 // （跟 primaryCategory 是不同維度，不要合併）
  sourceMaterialId?: string;    // 來自哪篇教材
  sourceLabel?: string;         // 來源標籤
  seedExamples: { en: string; zh: string }[]; // Gemini 萃取時附的原始情境例句（至少5個，僅供參考）
  exampleSentences: PatternExampleSentence[]; // 使用者自造的100句（10組x10句）
  unlockedGroups: number;       // 目前解鎖到第幾組（0-9）
}
