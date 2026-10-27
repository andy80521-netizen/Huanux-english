import React, { useEffect, useRef, useState } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import { db, auth, appId } from '../firebase';
import { LanguagePattern } from '../types';
import { getPatternStage, getMasteredCount } from '../utils/patternStage';
import { Loader2, X } from 'lucide-react';
import IconButton from './ui/IconButton';
import { GroupSegments } from './ui/MasterySegments';
import { groupMasteredCounts } from '../utils/groupMastery';

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

  // 只是檢視，沒有副作用：Esc 關閉；開啟時焦點放在關閉鈕
  const closeRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onCloseRef.current(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const createdCount = (pattern?.exampleSentences || []).filter(s => s.checked).length;
  const masteredCount = pattern ? getMasteredCount(pattern) : 0;
  const stage = pattern ? getPatternStage(pattern) : null;

  return (
    <div className="fixed inset-0 z-100 flex items-center justify-center bg-black/40 p-4 backdrop-blur-xs" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={pattern?.text || '句型速覽'}
        className="relative w-full max-w-sm rounded-3xl border border-line bg-surface p-7 shadow-[0_24px_48px_-12px_rgb(0_0_0/0.25)]"
        onClick={e => e.stopPropagation()}
      >
        <IconButton ref={closeRef} aria-label="關閉" onClick={onClose} className="absolute top-3 right-3 text-muted">
          <X size={20} aria-hidden="true" />
        </IconButton>

        {!pattern && !notFound && (
          <div className="flex justify-center py-8">
            <Loader2 size={26} className="animate-spin text-accent" aria-hidden="true" />
          </div>
        )}

        {notFound && (
          <p className="py-8 text-center text-sm text-muted">這個句型已經不存在</p>
        )}

        {pattern && stage && (
          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center gap-1.5 pr-10">
              <span className="rounded-full border border-line bg-surface-2 px-2.5 py-0.5 text-[11px] text-muted">
                {categoryLabels[pattern.category] || pattern.category}
              </span>
              <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-medium ${stage.className}`}>
                {stage.label}
              </span>
            </div>
            <h3 lang="en" className="font-reading text-[28px] leading-tight text-ink break-words">{pattern.text}</h3>
            <p className="text-[15px] leading-relaxed text-ink">{pattern.meaningZh}</p>
            {pattern.usageContext && (
              <p className="text-[13px] leading-relaxed text-muted">{pattern.usageContext}</p>
            )}
            <div className="flex flex-col gap-1.5">
              <GroupSegments counts={groupMasteredCounts(pattern.exampleSentences)} />
              <span className="text-xs text-muted tabular-nums">已造句 {createdCount}/100・已精熟 {masteredCount}/100</span>
            </div>
            <p className="text-xs text-muted">到「語言模型」分頁可以查看與練習這個句型</p>
          </div>
        )}
      </div>
    </div>
  );
}
