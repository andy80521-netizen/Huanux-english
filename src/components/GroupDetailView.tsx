import React, { useState } from 'react';
import { LanguagePattern, PatternExampleSentence } from '../types';
import { ChevronLeft, ChevronDown, Target, Sparkles, Image as ImageIcon, PenTool } from 'lucide-react';
import Button from './ui/Button';
import IconButton from './ui/IconButton';
import ProgressBar from './ui/ProgressBar';
import { isSydneyDateReached, getSydneyCalendarDaysDiff } from '../utils/sydneyTime';

interface Props {
  pattern: LanguagePattern;
  groupIndex: number;
  onBack: () => void;
  onEnterGroup: () => void;
}

function getStatus(s: PatternExampleSentence | undefined, now: number): { label: string; className: string } {
  if (!s || !s.checked) {
    return { label: '尚未造句', className: 'bg-surface-2 text-muted border border-line' };
  }
  if ((s.mastery || 0) >= 1000) {
    return { label: '已精熟', className: 'bg-gold text-white dark:text-ground' };
  }
  if (s.nextAvailableAt !== undefined && !isSydneyDateReached(s.nextAvailableAt, now)) {
    const days = Math.max(1, getSydneyCalendarDaysDiff(now, s.nextAvailableAt));
    return { label: `等待 ${days} 天`, className: 'bg-gold/12 text-gold' };
  }
  return { label: '可練習', className: 'bg-accent-soft text-ink' };
}

export default function GroupDetailView({ pattern, groupIndex, onBack, onEnterGroup }: Props) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const now = Date.now();

  const slots = Array.from({ length: 10 }, (_, i) => {
    const id = `p_${groupIndex}_${i}`;
    const sentence = (pattern.exampleSentences || []).find(s => s.id === id);
    return { id, index: i, sentence };
  });

  const createdCount = slots.filter(slot => slot.sentence?.checked).length;
  const masteredCount = slots.filter(slot => slot.sentence?.checked && (slot.sentence.mastery || 0) >= 1000).length;

  const promptBlock = (icon: React.ReactNode, label: string, body: React.ReactNode) => (
    <div className="flex flex-col gap-1">
      <p className="flex items-center gap-1.5 text-xs text-muted">{icon}{label}</p>
      {body}
    </div>
  );

  return (
    <div className="h-full overflow-y-auto pb-12">
      <header className="flex items-center gap-2 px-2 pt-2 sm:px-5 lg:px-9 lg:pt-6">
        <IconButton aria-label="返回組別" onClick={onBack}>
          <ChevronLeft size={22} aria-hidden="true" />
        </IconButton>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-[15px] font-medium tracking-wide text-ink">第 {groupIndex + 1} 組內容</h2>
          <p lang="en" className="truncate font-reading text-[15px] text-muted">{pattern.text}</p>
        </div>
      </header>

      <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-5 pt-5 sm:px-10 lg:pt-8">
        <div className="flex items-center justify-between gap-3">
          <span className="text-[13px] text-muted tabular-nums">已造句 {createdCount}/10・已精熟 {masteredCount}/10</span>
          <Button size="sm" onClick={onEnterGroup} icon={<PenTool size={15} aria-hidden="true" />}>進入這一組</Button>
        </div>

        <ul className="flex flex-col gap-2.5">
          {slots.map(({ id, index, sentence }) => {
            const status = getStatus(sentence, now);
            const mastery = Math.min(1000, sentence?.mastery || 0);
            const canExpand = !!sentence?.checked;
            const isExpanded = expandedId === id;

            return (
              <li key={id} className="overflow-hidden rounded-2xl border border-line bg-surface">
                <button
                  type="button"
                  onClick={() => canExpand && setExpandedId(isExpanded ? null : id)}
                  disabled={!canExpand}
                  aria-expanded={canExpand ? isExpanded : undefined}
                  className="flex w-full flex-col gap-2 p-4 text-left disabled:cursor-default focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent"
                >
                  <span className="flex items-center justify-between gap-2">
                    <span className="text-xs text-muted">第 {index + 1} 句</span>
                    <span className="flex items-center gap-2">
                      <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${status.className}`}>{status.label}</span>
                      {canExpand && <ChevronDown size={16} className={`text-muted transition-transform duration-[var(--dur-fast)] ${isExpanded ? 'rotate-180' : ''}`} aria-hidden="true" />}
                    </span>
                  </span>

                  {sentence?.checked ? (
                    <>
                      <span lang="en" className="font-reading text-lg leading-snug text-ink break-words">{sentence.text}</span>
                      <span className="flex items-center gap-2.5">
                        <ProgressBar value={mastery} max={1000} label={`第 ${index + 1} 句熟練度`} size="sm" tone={mastery >= 1000 ? 'gold' : 'accent'} className="flex-1" />
                        <span className="shrink-0 text-xs text-muted tabular-nums">{mastery}/1000</span>
                      </span>
                    </>
                  ) : (
                    <span className="text-sm text-muted">（還沒有造句）</span>
                  )}
                </button>

                {isExpanded && sentence && (
                  <div className="flex flex-col gap-3.5 border-t border-line px-4 pt-3.5 pb-4">
                    {promptBlock(<Target size={14} aria-hidden="true" />, '問答題',
                      <p lang={sentence.qaQuestion ? 'en' : undefined} className="text-sm leading-relaxed text-ink">{sentence.qaQuestion || '尚未產生（練習時會自動產生）'}</p>)}
                    {promptBlock(<Sparkles size={14} aria-hidden="true" />, '情境題',
                      <p className="text-sm leading-relaxed text-ink">{sentence.situationalPrompt || '尚未產生（練習時會自動產生）'}</p>)}
                    {promptBlock(<ImageIcon size={14} aria-hidden="true" />, '看圖題',
                      sentence.imageUrl ? (
                        <img src={sentence.imageUrl} alt="看圖題圖片" loading="lazy" className="max-h-56 w-full rounded-xl object-cover" referrerPolicy="no-referrer" />
                      ) : (
                        <p className="text-sm leading-relaxed text-ink">尚未產生（練習時會自動補產）</p>
                      ))}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
