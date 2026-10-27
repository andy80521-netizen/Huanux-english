import React, { useEffect, useId, useMemo, useState } from 'react';
import { Check, Loader2 } from 'lucide-react';

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
const CATEGORY_ORDER = ['structural', 'phrase', 'collocation'];

interface Props {
  candidates: ExtractCandidate[];
  note?: string;
  saving: boolean;
  onConfirm: (selectedIndexes: number[]) => void;
  onCancel: () => void;
}

// 萃取結果預覽：使用者勾選要加入句型庫的項目（預設全選）
// 刻意不處理 Esc：這裡的取消就是「全部不要」（會把該句標成已萃取），不該被誤觸
export default function ExtractPreviewDialog({ candidates, note, saving, onConfirm, onCancel }: Props) {
  const titleId = useId();
  const [selected, setSelected] = useState<Set<number>>(() => new Set<number>(candidates.map((_, i) => i)));

  useEffect(() => {
    setSelected(new Set<number>(candidates.map((_, i) => i)));
  }, [candidates]);

  // 分組只影響顯示；勾選仍用原 candidates 的索引。未知分類放最後一組
  const groups = useMemo(() => {
    const byCat = new Map<string, number[]>();
    candidates.forEach((c, i) => {
      const list = byCat.get(c.category) ?? [];
      list.push(i);
      byCat.set(c.category, list);
    });
    const known = CATEGORY_ORDER.filter(k => byCat.has(k));
    const unknown = [...byCat.keys()].filter(k => !CATEGORY_ORDER.includes(k));
    return [...known, ...unknown].map(k => ({ key: k, label: categoryLabels[k] || k, indexes: byCat.get(k)! }));
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
    <div className="fixed inset-0 z-100 flex items-end justify-center bg-black/40 backdrop-blur-xs p-0 sm:items-center sm:p-4 animate-in fade-in duration-200">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="flex max-h-[88vh] w-full flex-col rounded-t-3xl border border-line bg-surface shadow-[0_24px_48px_-12px_rgb(0_0_0/0.25)] sm:max-w-lg sm:rounded-3xl"
      >
        <div className="px-6 pt-6 pb-4">
          <h3 id={titleId} className="text-xl font-bold text-ink">選擇要加入的句型</h3>
          <p className="mt-1.5 text-sm leading-relaxed text-muted">
            取消勾選不想練的項目，只有勾選的會加入句型庫{note ? `　${note}` : ''}
          </p>
        </div>

        <div className="flex-1 overflow-y-auto border-y border-line px-4 py-4 sm:px-6">
          <div className="flex flex-col gap-6">
            {groups.map(g => (
              <section key={g.key} className="flex flex-col gap-2" aria-label={g.label}>
                <h4 className="px-1 text-xs tracking-[0.08em] text-muted">{g.label}</h4>
                {g.indexes.map(i => {
                  const c = candidates[i];
                  const isOn = selected.has(i);
                  return (
                    <button
                      key={i}
                      type="button"
                      role="checkbox"
                      aria-checked={isOn}
                      onClick={() => toggle(i)}
                      disabled={saving}
                      className={`flex w-full gap-3 rounded-2xl border p-4 text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-default ${
                        isOn ? 'border-accent bg-accent-soft/60' : 'border-line hover:bg-surface-2'
                      }`}
                    >
                      <span
                        aria-hidden="true"
                        className={`mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-md border transition-colors ${
                          isOn ? 'border-accent bg-accent text-on-accent' : 'border-muted/50 bg-surface'
                        }`}
                      >
                        {isOn && <Check size={14} strokeWidth={3} />}
                      </span>
                      <span className={`flex min-w-0 flex-1 flex-col gap-1 ${isOn ? '' : 'opacity-70'}`}>
                        <span lang="en" className="font-reading text-[17px] leading-snug text-ink break-words">{c.text}</span>
                        {c.meaningZh && <span className="text-sm text-ink">{c.meaningZh}</span>}
                        {c.learningPoint && (
                          <span className="text-xs leading-relaxed text-muted">學習重點：{c.learningPoint}</span>
                        )}
                      </span>
                    </button>
                  );
                })}
              </section>
            ))}
          </div>
        </div>

        <div className="flex gap-3 px-6 pt-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
          <button
            type="button"
            onClick={onCancel}
            disabled={saving}
            className="min-h-12 flex-1 rounded-full border border-line text-[15px] text-ink transition-colors hover:bg-surface-2 disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            全部不要
          </button>
          <button
            type="button"
            onClick={() => onConfirm(candidates.map((_, i) => i).filter(i => selected.has(i)))}
            disabled={saving || selected.size === 0}
            className="flex min-h-12 flex-1 items-center justify-center gap-2 rounded-full bg-accent text-[15px] font-medium text-on-accent transition-[filter,transform] hover:brightness-110 active:scale-[0.98] disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            {saving ? <><Loader2 size={16} className="animate-spin" aria-hidden="true" />加入中…</> : `加入句型庫（${selected.size}）`}
          </button>
        </div>
      </div>
    </div>
  );
}
