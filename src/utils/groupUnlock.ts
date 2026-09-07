import { LanguagePattern } from '../types';

export function isGroupUnlocked(pattern: LanguagePattern, groupIndex: number): boolean {
  if (groupIndex === 0) return true;
  return (pattern.unlockedGroups || 0) >= groupIndex;
}

export function checkAndUpdateUnlockedGroups(pattern: LanguagePattern): number {
  const currentUnlocked = pattern.unlockedGroups || 0;
  if (currentUnlocked >= 9) return currentUnlocked;
  
  const groupSentences = (pattern.exampleSentences || []).filter(s => s.groupIndex === currentUnlocked);
  const completedCount = groupSentences.filter(s => s.checked && (s.mastery || 0) >= 1000).length;
  
  if (groupSentences.length === 10 && completedCount === 10) {
    return currentUnlocked + 1;
  }
  
  return currentUnlocked;
}
