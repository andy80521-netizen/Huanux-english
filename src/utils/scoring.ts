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

export const calculateFinalScores = (userText: string, targetText: string, durationSec: number) => {
    if (!userText || userText.trim().length === 0) {
        return { pronunciation: 0, fluency: 0, stress: 0, total: 0 };
    }
    
    const rawSimilarity = calculateSimilarity(userText, targetText);
    
    let pronunciationScore = rawSimilarity;
    if (rawSimilarity > 0) {
        pronunciationScore = Math.min(100, Math.round(rawSimilarity + (100 - rawSimilarity) * 0.5));
    }

    const targetWordCount = targetText.split(/\s+/).length;
    const userWordCount = userText.split(/\s+/).length;
    
    let fluencyScore = 100;
    if (targetWordCount <= 1) {
        fluencyScore = pronunciationScore > 60 ? 100 : 50;
    } else {
        const idealMinTime = targetWordCount * 0.4; 
        const idealMaxTime = targetWordCount * 0.8 + 1.5; 
        if (durationSec > idealMaxTime) fluencyScore -= (durationSec - idealMaxTime) * 10; 
        else if (durationSec < idealMinTime) fluencyScore -= (idealMinTime - durationSec) * 20; 
        fluencyScore = Math.round(fluencyScore * Math.min(1, userWordCount / targetWordCount));
    }
    fluencyScore = Math.max(0, Math.min(100, fluencyScore));

    let stressScore = Math.round(pronunciationScore * 0.7 + fluencyScore * 0.3);
    if (pronunciationScore > 80) stressScore = Math.min(100, stressScore + 5);

    const totalScore = Math.round((pronunciationScore + fluencyScore + stressScore) / 3);
    return { pronunciation: pronunciationScore, fluency: fluencyScore, stress: stressScore, total: totalScore };
};
