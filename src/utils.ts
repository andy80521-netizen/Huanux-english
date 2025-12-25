import { BADGE_LEVELS, BadgeLevel } from './constants';

export const getVoices = (): Promise<SpeechSynthesisVoice[]> => {
  return new Promise((resolve) => {
    let voices = window.speechSynthesis.getVoices();
    if (voices.length > 0) { resolve(voices); return; }
    window.speechSynthesis.onvoiceschanged = () => { voices = window.speechSynthesis.getVoices(); resolve(voices); };
    setTimeout(() => resolve(window.speechSynthesis.getVoices()), 1000);
  });
};

export const speakTextPromise = async (text: string, rate = 1.0, voicePrefs: { zh?: string, en?: string } = {}) => {
  if (!('speechSynthesis' in window)) return;
  
  if (window.speechSynthesis.paused) {
      window.speechSynthesis.resume();
  }

  const voices = await getVoices();
  
  return new Promise<void>((resolve) => {
    window.speechSynthesis.cancel();
    
    if (!text) { resolve(); return; }
    
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
        
        utterance.onend = () => resolve();
        utterance.onerror = (e) => {
            console.warn("Speech synthesis error:", e); 
            resolve();
        };
        
        setTimeout(resolve, (text.length * 500) + 2000);
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