import { BADGE_LEVELS, BadgeLevel } from './constants';

export const getVoices = (): Promise<SpeechSynthesisVoice[]> => {
  return new Promise((resolve) => {
    let voices = window.speechSynthesis.getVoices();
    if (voices.length > 0) { resolve(voices); return; }
    
    // iOS Safari sometimes doesn't fire onvoiceschanged immediately, so we poll
    const id = setInterval(() => {
        voices = window.speechSynthesis.getVoices();
        if (voices.length > 0) {
            clearInterval(id);
            resolve(voices);
        }
    }, 100);

    // Fallback if voices never load (rare but possible on some Android webviews)
    setTimeout(() => {
        clearInterval(id);
        resolve(window.speechSynthesis.getVoices());
    }, 2000);
  });
};

export const speakTextPromise = async (text: string, rate = 1.0, voicePrefs: { zh?: string, en?: string } = {}) => {
  if (!('speechSynthesis' in window)) return;
  
  // Critical Fix for Mobile: Cancel any pending speech and force resume
  window.speechSynthesis.cancel();
  if (window.speechSynthesis.paused) {
      window.speechSynthesis.resume();
  }

  const voices = await getVoices();
  
  return new Promise<void>((resolve) => {
    // Double check cancellation to be sure
    window.speechSynthesis.cancel();
    
    if (!text) { resolve(); return; }
    
    // Slight delay to allow cancel to process
    setTimeout(() => {
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.rate = rate;
        
        const hasChinese = /[\u4e00-\u9fa5]/.test(text);
        
        if (hasChinese) {
            utterance.lang = 'zh-TW'; 
            if (voicePrefs.zh) {
                const customVoice = voices.find(v => v.voiceURI === voicePrefs.zh);
                if (customVoice) utterance.voice = customVoice;
            }
            if (!utterance.voice) {
                const zhVoice = voices.find(v => (v.name.includes('Google') || v.name.includes('Microsoft')) && (v.lang === 'zh-TW' || v.lang === 'zh_TW')) ||
                                voices.find(v => v.lang === 'zh-TW' || v.lang === 'zh_TW') ||
                                voices.find(v => v.lang.toLowerCase().includes('zh-tw'));
                if (zhVoice) utterance.voice = zhVoice;
            }
        } else {
            utterance.lang = 'en-GB';
            if (voicePrefs.en) {
                const customVoice = voices.find(v => v.voiceURI === voicePrefs.en);
                if (customVoice) utterance.voice = customVoice;
            }
            if (!utterance.voice) {
                const preferredVoice = voices.find(v => v.lang.includes('en-GB') || v.lang.includes('en_GB')) || 
                                       voices.find(v => v.lang.includes('en-AU') || v.lang.includes('en_AU'));
                if (preferredVoice) utterance.voice = preferredVoice;
            }
        }
        
        // Mobile timeout safety: If onend doesn't fire (common iOS bug), resolve anyway
        const safetyTimeout = setTimeout(() => {
            resolve();
        }, (text.length * 200) + 3000);

        utterance.onend = () => {
            clearTimeout(safetyTimeout);
            resolve();
        };
        
        utterance.onerror = (e) => {
            clearTimeout(safetyTimeout);
            console.warn("Speech synthesis error:", e); 
            resolve();
        };
        
        window.speechSynthesis.speak(utterance);
    }, 50);
  });
};

// Levenshtein Distance Algorithm: Calculates the minimum number of single-character edits
const levenshteinDistance = (a: string, b: string) => {
  const matrix = [];

  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }

  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1, // substitution
          Math.min(
            matrix[i][j - 1] + 1, // insertion
            matrix[i - 1][j] + 1 // deletion
          )
        );
      }
    }
  }

  return matrix[b.length][a.length];
};

export const calculateSimilarity = (str1: string, str2: string) => {
    if (!str1 || !str2) return 0;
    
    // Normalize: lowercase and remove special characters
    const s1 = str1.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim();
    const s2 = str2.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim();
    
    if (!s1 || !s2) return 0;
    if (s1 === s2) return 100;

    // Use Levenshtein distance for better accuracy on short words
    const distance = levenshteinDistance(s1, s2);
    const maxLength = Math.max(s1.length, s2.length);
    
    // Calculate similarity percentage
    const similarity = ((maxLength - distance) / maxLength) * 100;
    
    return Math.max(0, Math.min(100, Math.round(similarity)));
};

export const fetchIPA = async (text: string) => {
  if (!text) return '';
  const words = text.split(/\s+/);
  const results = await Promise.all(words.map(async (word) => {
    const cleanWord = word.replace(/[^a-zA-Z]/g, '');
    if (!cleanWord) return word;
    try {
      const res = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${cleanWord}`);
      if (!res.ok) throw new Error('Not found');
      const data = await res.json();
      if (Array.isArray(data) && data.length > 0) {
         const entry = data[0];
         const phonetic = entry.phonetic || entry.phonetics?.find((p: any) => p.text)?.text;
         if (phonetic) return phonetic;
      }
      return cleanWord;
    } catch (e) { return cleanWord; }
  }));
  return results.join(' ');
};

export const getBadgeInfo = (mastery: number, levels: BadgeLevel[] = BADGE_LEVELS) => {
    let currentBadge = levels[0];
    let nextBadge = levels[1] || null; 
    for (let i = levels.length - 1; i >= 0; i--) {
        if (mastery >= levels[i].threshold) {
            currentBadge = levels[i];
            nextBadge = levels[i+1] || null; 
            break;
        }
    }
    return { currentBadge, nextBadge };
};

export const calculateTierProgress = (score: number, currentThreshold: number, nextThreshold: number | undefined) => {
    if (!nextThreshold) return 100;
    const range = nextThreshold - currentThreshold;
    const progress = score - currentThreshold;
    return Math.max(0, Math.min(100, (progress / range) * 100));
};

export const checkVocabContainment = (container: string, content: string): boolean => {
    if (!container || !content) return false;
    
    // Clean: remove (...) and punctuation, convert to lower case
    const clean = (s: string) => s.toLowerCase().replace(/\s*\(.*?\)\s*/g, '').replace(/[.,/#!$%^&*;:{}=\-_`~()]/g, '').replace(/\s{2,}/g, ' ').trim();
    
    const cContainer = clean(container);
    const cContent = clean(content);
    
    if (!cContainer || !cContent) return false;

    // 1. Strict inclusion
    if (cContainer.includes(cContent)) return true;

    // 2. Fuzzy inclusion for phrases (handles simple tense changes like have/had)
    const contentWords = cContent.split(' ');
    const containerWords = cContainer.split(' ');
    const len = contentWords.length;
    
    // Only apply fuzzy logic for phrases (>1 word) to avoid false positives on short words
    if (len < 2) return false; 
    
    if (containerWords.length < len) return false;

    for (let i = 0; i <= containerWords.length - len; i++) {
        const windowStr = containerWords.slice(i, i + len).join(' ');
        // 80% threshold usually handles single word variation in a 3-word phrase well
        // e.g., "have a crack" (12) vs "had a crack" (11). Similarity > 80.
        if (calculateSimilarity(windowStr, cContent) >= 80) return true;
    }

    return false;
};

export const expandContractions = (text: string) => {
    if (!text) return '';
    let res = text.toLowerCase();
    
    // Normalize unicode apostrophes if any
    res = res.replace(/[\u2018\u2019]/g, "'");

    const specifics: Record<string, string> = {
        "won't": "will not",
        "can't": "can not",
        "cannot": "can not",
        "shan't": "shall not",
        "let's": "let us",
        "it's": "it is",
        "that's": "that is",
        "what's": "what is",
        "who's": "who is",
        "there's": "there is",
        "he's": "he is",
        "she's": "she is"
    };
    
    for (const [k, v] of Object.entries(specifics)) {
        res = res.replace(new RegExp(`\\b${k}\\b`, 'g'), v);
    }
    
    // General suffixes
    res = res
        .replace(/'m\b/g, " am")
        .replace(/'re\b/g, " are")
        .replace(/'ll\b/g, " will")
        .replace(/'ve\b/g, " have")
        .replace(/n't\b/g, " not")
        .replace(/'s\b/g, " is")
        .replace(/'d\b/g, " would");
        
    return res;
};