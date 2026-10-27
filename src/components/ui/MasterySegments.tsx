import React from 'react';
import { GroupMasteryBar, masteryLevel } from '../../utils/groupMastery';

/**
 * 句型的熟練度視覺（UI 改版 ③b）：金色與深淺規則只寫在這裡。
 * - GroupSegments：10 段，每段＝一組已精熟句數／10，滿 10 金色（句型庫卡片、速覽卡）
 * - MasteryMap：10×10 格，未造句＝虛線空格、已造句 0＝最淺實心、1～3 階主色由淺到深、1000＝金色（句型詳情）
 */

export function GroupSegments({ counts, className = '' }: { counts: number[]; className?: string }) {
  return (
    <span aria-hidden="true" className={`grid grid-cols-10 gap-[3px] ${className}`}>
      {counts.map((n, g) => (
        <span key={g} className="relative h-1.5 overflow-hidden rounded-[2px] bg-line">
          <span
            className={`absolute inset-y-0 left-0 ${n >= 10 ? 'bg-gold' : 'bg-accent'}`}
            style={{ width: `${Math.min(10, Math.max(0, n)) * 10}%` }}
          />
        </span>
      ))}
    </span>
  );
}

const LEVEL_CLASS: Record<number, string> = {
  0: 'bg-line',
  1: 'bg-accent/25',
  2: 'bg-accent/55',
  3: 'bg-accent',
  4: 'bg-gold',
};

export function MasteryMap({ map }: { map: GroupMasteryBar[][] }) {
  return (
    <span aria-hidden="true" className="grid grid-cols-[1.25rem_repeat(10,minmax(0,1fr))] items-center gap-1">
      {map.map((row, g) => (
        <React.Fragment key={g}>
          <span className="pr-0.5 text-right text-[10px] text-muted tabular-nums">{g + 1}</span>
          {row.map((c) => (
            <span
              key={c.id}
              className={`aspect-square rounded-[4px] ${c.created ? LEVEL_CLASS[masteryLevel(c.mastery)] : 'border border-dashed border-muted/40'}`}
            />
          ))}
        </React.Fragment>
      ))}
    </span>
  );
}
