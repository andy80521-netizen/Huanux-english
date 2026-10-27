import React from 'react';
import { LanguagePattern } from '../types';
import { ChevronLeft, ChevronRight, Lock, Unlock, CheckCircle2 } from 'lucide-react';
import IconButton from './ui/IconButton';
import { groupMasteryBars } from '../utils/groupMastery';
import { isGroupUnlocked } from '../utils/groupUnlock';

interface Props {
  pattern: LanguagePattern;
  onBack: () => void;
  onSelectGroup: (groupIndex: number) => void;
  onViewGroup: (groupIndex: number) => void;
}

export default function GroupSelectionView({ pattern, onBack, onSelectGroup, onViewGroup }: Props) {
  const groups = Array.from({ length: 10 }, (_, i) => i);
  
  return (
    <div className="h-full overflow-y-auto pb-12">
      <header className="flex items-center gap-2 px-2 pt-2 sm:px-5 lg:px-9 lg:pt-6">
        <IconButton aria-label="返回句型詳情" onClick={onBack}>
          <ChevronLeft size={22} aria-hidden="true" />
        </IconButton>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-[15px] font-medium tracking-wide text-ink">選擇造句組別</h2>
          <p lang="en" className="truncate font-reading text-[15px] text-muted">{pattern.text}</p>
        </div>
      </header>

      <div className="grid grid-cols-2 gap-3 px-5 pt-5 sm:px-10 lg:grid-cols-3 lg:gap-4 lg:px-14 lg:pt-8">
        {groups.map(groupIndex => {
          const unlocked = isGroupUnlocked(pattern, groupIndex);
          const groupSentences = (pattern.exampleSentences || []).filter(s => s.groupIndex === groupIndex);
          const completedCount = groupSentences.filter(s => s.checked && (s.mastery || 0) >= 1000).length;
          const isCompleted = groupSentences.length === 10 && completedCount === 10;
          const bars = groupMasteryBars(pattern.exampleSentences, groupIndex);

          return (
            <div
              key={groupIndex}
              className={`flex min-w-0 flex-col overflow-hidden rounded-[18px] border transition-colors ${
                !unlocked ? 'border-line bg-transparent opacity-60'
                  : isCompleted ? 'border-gold/45 bg-surface hover:border-gold/70'
                  : 'border-line bg-surface hover:border-accent/50'
              }`}
            >
              <button
                type="button"
                onClick={() => unlocked && onSelectGroup(groupIndex)}
                disabled={!unlocked}
                className="flex min-w-0 flex-col gap-2.5 p-3.5 text-left disabled:cursor-not-allowed focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent lg:p-4"
              >
                <span className="flex items-center justify-between gap-2">
                  <span className="text-[15px] font-bold text-ink">第 {groupIndex + 1} 組</span>
                  {unlocked ? (
                    isCompleted
                      ? <CheckCircle2 size={18} className="text-gold" aria-label="已全部精熟" />
                      : <Unlock size={16} className="text-muted" aria-hidden="true" />
                  ) : (
                    <Lock size={16} className="text-muted" aria-label="未解鎖" />
                  )}
                </span>
                <span aria-hidden="true" className="grid h-[18px] min-w-0 grid-cols-10 items-end gap-[3px]">
                  {bars.map(b => (
                    b.created ? (
                      <span key={b.id} className="relative h-full overflow-hidden rounded-[2px] bg-line">
                        <span className={`absolute inset-x-0 bottom-0 ${b.mastered ? 'bg-gold' : 'bg-accent'}`} style={{ height: `${b.mastery / 10}%` }} />
                      </span>
                    ) : (
                      <span key={b.id} className="h-full rounded-[2px] border border-dashed border-muted/40" />
                    )
                  ))}
                </span>
                {unlocked ? (
                  <span className="text-xs leading-relaxed text-muted tabular-nums">
                    <span className="block">已造句：{groupSentences.filter(s => s.checked).length} / 10</span>
                    <span className="block">已精熟：<span className={completedCount === 10 ? 'text-gold' : 'text-ink'}>{completedCount}</span> / 10</span>
                  </span>
                ) : (
                  <span className="text-xs leading-relaxed text-muted">完成上一組才能解鎖</span>
                )}
              </button>

              {unlocked && (
                <button
                  type="button"
                  onClick={() => onViewGroup(groupIndex)}
                  className="flex min-h-10 items-center justify-center gap-1 border-t border-line text-xs text-accent transition-colors hover:bg-surface-2 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent"
                >
                  查看內容
                  <ChevronRight size={13} aria-hidden="true" />
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
