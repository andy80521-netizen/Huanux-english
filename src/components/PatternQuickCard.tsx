import React, { useEffect, useState } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import { db, auth, appId } from '../firebase';
import { LanguagePattern } from '../types';
import { getPatternStage, getMasteredCount } from '../utils/patternStage';
import { Loader2, X } from 'lucide-react';

const categoryLabels: Record<string, string> = {
  structural: '結構句型',
  phrase: '片語',
  collocation: '語組'
};

export default function PatternQuickCard({ patternId, onClose }: { patternId: string; onClose: () => void }) {
  const [pattern, setPattern] = useState<LanguagePattern | null>(null);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    const uid = auth.currentUser?.uid;
    if (!uid) return;
    let cancelled = false;
    getDoc(doc(db, `artifacts/${appId}/users/${uid}/languagePatterns`, patternId))
      .then(snap => {
        if (cancelled) return;
        if (snap.exists()) setPattern({ ...(snap.data() as LanguagePattern), id: snap.id });
        else setNotFound(true);
      })
      .catch(() => { if (!cancelled) setNotFound(true); });
    return () => { cancelled = true; };
  }, [patternId]);

  const createdCount = (pattern?.exampleSentences || []).filter(s => s.checked).length;
  const masteredCount = pattern ? getMasteredCount(pattern) : 0;
  const stage = pattern ? getPatternStage(pattern) : null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 backdrop-blur-sm p-4" onClick={onClose}>
      <div
        className="bg-white dark:bg-slate-900 rounded-3xl p-6 w-full max-w-sm shadow-2xl border border-slate-100 dark:border-slate-800"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex justify-end -mt-2 -mr-2">
          <button onClick={onClose} className="p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-lg">
            <X size={20} />
          </button>
        </div>

        {!pattern && !notFound && (
          <div className="flex justify-center py-8">
            <Loader2 size={28} className="animate-spin text-indigo-500" />
          </div>
        )}

        {notFound && (
          <p className="text-center text-sm font-bold text-slate-500 dark:text-slate-400 py-8">這個句型已經不存在</p>
        )}

        {pattern && stage && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[11px] font-bold bg-indigo-100 text-indigo-700 dark:bg-indigo-900/50 dark:text-indigo-300 px-2 py-0.5 rounded-full">
                {categoryLabels[pattern.category] || pattern.category}
              </span>
              <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${stage.className}`}>
                {stage.label}
              </span>
            </div>
            <h3 className="text-2xl font-black text-slate-800 dark:text-white leading-tight">{pattern.text}</h3>
            <p className="text-sm font-bold text-slate-600 dark:text-slate-300 leading-relaxed">{pattern.meaningZh}</p>
            {pattern.usageContext && (
              <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">{pattern.usageContext}</p>
            )}
            <div>
              <div className="text-xs font-bold text-slate-500 dark:text-slate-400 mb-1.5">
                已造句 {createdCount}/100・已精熟 {masteredCount}/100
              </div>
              <div className="w-full h-1.5 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                <div className="h-full bg-indigo-500 rounded-full" style={{ width: `${Math.min(100, masteredCount)}%` }} />
              </div>
            </div>
            <p className="text-[11px] text-slate-400 dark:text-slate-500">到「語言模型」分頁可以查看與練習這個句型</p>
          </div>
        )}
      </div>
    </div>
  );
}
