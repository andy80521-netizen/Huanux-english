import React, { useEffect, useState } from 'react';
import { CheckSquare, Square, Loader2, Sparkles } from 'lucide-react';

export interface ExtractCandidate {
  category: string;
  text: string;
  meaningZh?: string;
  learningPoint?: string;
}

const categoryLabels: Record<string, string> = {
  structural: '結構句型',
  phrase: '片語',
  collocation: '語組'
};

interface Props {
  candidates: ExtractCandidate[];
  note?: string;
  saving: boolean;
  onConfirm: (selectedIndexes: number[]) => void;
  onCancel: () => void;
}

// 萃取結果預覽：使用者勾選要加入句型庫的項目（預設全選）
export default function ExtractPreviewDialog({ candidates, note, saving, onConfirm, onCancel }: Props) {
  const [selected, setSelected] = useState<Set<number>>(() => new Set<number>(candidates.map((_, i) => i)));

  useEffect(() => {
    setSelected(new Set<number>(candidates.map((_, i) => i)));
  }, [candidates]);

  const toggle = (i: number) => {
    if (saving) return;
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i); else next.add(i);
      return next;
    });
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 backdrop-blur-xs p-4 animate-in fade-in duration-200">
      <div className="bg-white dark:bg-slate-900 rounded-3xl w-full max-w-md max-h-[85vh] flex flex-col shadow-2xl border border-slate-100 dark:border-slate-800">
        <div className="px-5 pt-5 pb-3 border-b border-slate-100 dark:border-slate-800">
          <h3 className="text-lg font-black text-slate-800 dark:text-white flex items-center gap-2">
            <Sparkles size={18} className="text-purple-500" />
            選擇要加入的句型
          </h3>
          <p className="text-xs font-bold text-slate-500 dark:text-slate-400 mt-1">
            取消勾選不想練的項目，只有勾選的會加入句型庫{note ? `　${note}` : ''}
          </p>
        </div>

        <div className="overflow-y-auto p-4 space-y-3 flex-1">
          {candidates.map((c, i) => {
            const isOn = selected.has(i);
            return (
              <button
                key={i}
                type="button"
                onClick={() => toggle(i)}
                className={`w-full text-left rounded-2xl p-4 border transition-all flex gap-3 ${
                  isOn
                    ? 'border-indigo-400 bg-indigo-50/60 dark:bg-indigo-900/20 dark:border-indigo-700'
                    : 'border-slate-200 dark:border-slate-700 opacity-60'
                }`}
              >
                {isOn
                  ? <CheckSquare size={20} className="text-indigo-600 dark:text-indigo-400 shrink-0 mt-0.5" />
                  : <Square size={20} className="text-slate-400 shrink-0 mt-0.5" />}
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2 mb-1">
                    <span className="text-base font-black text-slate-800 dark:text-slate-100 break-words">{c.text}</span>
                    <span className="text-[10px] font-bold bg-indigo-100 text-indigo-700 dark:bg-indigo-900/50 dark:text-indigo-300 px-2 py-0.5 rounded-full shrink-0">
                      {categoryLabels[c.category] || c.category}
                    </span>
                  </div>
                  {c.meaningZh && (
                    <p className="text-sm font-bold text-slate-600 dark:text-slate-300">{c.meaningZh}</p>
                  )}
                  {c.learningPoint && (
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-1.5 leading-relaxed">
                      學習重點：{c.learningPoint}
                    </p>
                  )}
                </div>
              </button>
            );
          })}
        </div>

        <div className="p-4 border-t border-slate-100 dark:border-slate-800 flex gap-3">
          <button
            onClick={onCancel}
            disabled={saving}
            className="flex-1 py-3 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 font-bold rounded-2xl hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors disabled:opacity-50"
          >
            全部不要
          </button>
          <button
            onClick={() => onConfirm(candidates.map((_, i) => i).filter(i => selected.has(i)))}
            disabled={saving || selected.size === 0}
            className="flex-1 py-3 bg-indigo-600 text-white font-bold rounded-2xl hover:bg-indigo-700 transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
          >
            {saving ? <><Loader2 size={16} className="animate-spin" />加入中…</> : `加入句型庫（${selected.size}）`}
          </button>
        </div>
      </div>
    </div>
  );
}
