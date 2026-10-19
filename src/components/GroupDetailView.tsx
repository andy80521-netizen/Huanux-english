import React, { useState } from 'react';
import { LanguagePattern, PatternExampleSentence } from '../types';
import { ChevronLeft, ChevronDown, ChevronUp, Target, Sparkles, Image as ImageIcon, PenTool } from 'lucide-react';
import { isSydneyDateReached, getSydneyCalendarDaysDiff } from '../utils/sydneyTime';

interface Props {
  pattern: LanguagePattern;
  groupIndex: number;
  onBack: () => void;
  onEnterGroup: () => void;
}

function getStatus(s: PatternExampleSentence | undefined, now: number): { label: string; className: string } {
  if (!s || !s.checked) {
    return { label: '尚未造句', className: 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400' };
  }
  if ((s.mastery || 0) >= 1000) {
    return { label: '已精熟', className: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300' };
  }
  if (s.nextAvailableAt !== undefined && !isSydneyDateReached(s.nextAvailableAt, now)) {
    const days = Math.max(1, getSydneyCalendarDaysDiff(now, s.nextAvailableAt));
    return { label: `等待 ${days} 天`, className: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300' };
  }
  return { label: '可練習', className: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300' };
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

  return (
    <div className="flex flex-col h-full bg-slate-50 dark:bg-slate-950 p-6 overflow-y-auto pb-20">
      <div className="flex items-center gap-4 mb-6">
        <button
          onClick={onBack}
          className="p-2 bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 rounded-full shadow-sm hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
        >
          <ChevronLeft size={24} />
        </button>
        <div className="flex-1 min-w-0">
          <h2 className="text-xl font-black text-slate-800 dark:text-white line-clamp-1">
            第 {groupIndex + 1} 組內容
          </h2>
          <p className="text-sm font-bold text-slate-500 dark:text-slate-400 line-clamp-1">
            {pattern.text}
          </p>
        </div>
      </div>

      <div className="flex items-center justify-between gap-3 mb-4 text-sm font-bold text-slate-500 dark:text-slate-400">
        <span>已造句 {createdCount}/10・已精熟 {masteredCount}/10</span>
        <button
          onClick={onEnterGroup}
          className="px-4 py-2 bg-indigo-600 text-white rounded-xl font-bold shadow-sm hover:bg-indigo-700 transition-colors flex items-center gap-1.5 shrink-0"
        >
          <PenTool size={16} />
          進入這一組
        </button>
      </div>

      <div className="space-y-3">
        {slots.map(({ id, index, sentence }) => {
          const status = getStatus(sentence, now);
          const mastery = Math.min(1000, sentence?.mastery || 0);
          const canExpand = !!sentence?.checked;
          const isExpanded = expandedId === id;

          return (
            <div key={id} className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden">
              <button
                type="button"
                onClick={() => canExpand && setExpandedId(isExpanded ? null : id)}
                disabled={!canExpand}
                className="w-full p-4 text-left flex flex-col gap-2 disabled:cursor-default"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-black text-slate-400 dark:text-slate-500">第 {index + 1} 句</span>
                  <div className="flex items-center gap-2">
                    <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${status.className}`}>
                      {status.label}
                    </span>
                    {canExpand && (isExpanded
                      ? <ChevronUp size={16} className="text-slate-400" />
                      : <ChevronDown size={16} className="text-slate-400" />)}
                  </div>
                </div>

                {sentence?.checked ? (
                  <>
                    <p className="font-bold text-slate-800 dark:text-slate-100 leading-relaxed">{sentence.text}</p>
                    <div className="flex items-center gap-2">
                      <div className="flex-1 h-1.5 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full ${mastery >= 1000 ? 'bg-emerald-500' : 'bg-indigo-500'}`}
                          style={{ width: `${mastery / 10}%` }}
                        />
                      </div>
                      <span className="text-xs font-bold text-slate-400 dark:text-slate-500 shrink-0">{mastery}/1000</span>
                    </div>
                  </>
                ) : (
                  <p className="text-sm font-bold text-slate-300 dark:text-slate-600">（還沒有造句）</p>
                )}
              </button>

              {isExpanded && sentence && (
                <div className="px-4 pb-4 pt-3 space-y-3 border-t border-slate-100 dark:border-slate-800">
                  <div>
                    <p className="text-xs font-bold text-indigo-600 dark:text-indigo-400 mb-1 flex items-center gap-1.5">
                      <Target size={14} /> 問答題
                    </p>
                    <p className="text-sm text-slate-700 dark:text-slate-300">
                      {sentence.qaQuestion || '尚未產生（練習時會自動產生）'}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs font-bold text-indigo-600 dark:text-indigo-400 mb-1 flex items-center gap-1.5">
                      <Sparkles size={14} /> 情境題
                    </p>
                    <p className="text-sm text-slate-700 dark:text-slate-300">
                      {sentence.situationalPrompt || '尚未產生（練習時會自動產生）'}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs font-bold text-indigo-600 dark:text-indigo-400 mb-1 flex items-center gap-1.5">
                      <ImageIcon size={14} /> 看圖題
                    </p>
                    {sentence.imageUrl ? (
                      <img
                        src={sentence.imageUrl}
                        alt="看圖題圖片"
                        loading="lazy"
                        className="w-full max-h-56 object-cover rounded-xl"
                        referrerPolicy="no-referrer"
                      />
                    ) : (
                      <p className="text-sm text-slate-700 dark:text-slate-300">尚未產生（練習時會自動補產）</p>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
