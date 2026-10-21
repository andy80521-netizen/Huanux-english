import React, { useEffect, useRef, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db, auth, appId } from '../firebase';
import { Material } from '../types';
import { MessageSquareText, Loader2, RefreshCw } from 'lucide-react';
import { MaterialSegments, RetellSegment, RetellTargetPattern, RetellRecord, isSegmentsValid, createSegments, pickTargetPatterns, listRetells } from '../services/retell';

interface Props {
  material: Material;
  bySentence?: Record<string, string[]>;
  onStart: (segmentIndex: number, segment: RetellSegment, targetPatterns: RetellTargetPattern[]) => void;
}

// 教材詳情頁：複述練習區塊（分段清單與每段最近一次的分數）
export default function RetellSection({ material, bySentence, onStart }: Props) {
  const [segmentsDoc, setSegmentsDoc] = useState<MaterialSegments | null | undefined>(undefined);
  const [segmenting, setSegmenting] = useState(false);
  const [segmentError, setSegmentError] = useState<string | null>(null);
  const [records, setRecords] = useState<RetellRecord[]>([]);
  const [startingIndex, setStartingIndex] = useState<number | null>(null);
  const autoCreatedRef = useRef(false);

  useEffect(() => {
    const uid = auth.currentUser?.uid;
    if (!uid) return;
    const ref = doc(db, `artifacts/${appId}/users/${uid}/materialSegments`, material.id);
    const unsubscribe = onSnapshot(ref, (snapshot) => {
      setSegmentsDoc(snapshot.exists() ? (snapshot.data() as MaterialSegments) : null);
    }, (error) => {
      console.error('[監聽來源:RetellSection-materialSegments]', error);
    });
    return () => unsubscribe();
  }, [material.id]);

  useEffect(() => {
    listRetells(material.id).then(setRecords).catch(err => console.warn('[複述] 讀取紀錄失敗:', err));
  }, [material.id]);

  const runSegmenting = async () => {
    if (segmenting) return;
    setSegmenting(true);
    setSegmentError(null);
    try {
      await createSegments(material);
    } catch (err: any) {
      setSegmentError(err?.message || '分段失敗，請稍後再試');
    } finally {
      setSegmenting(false);
    }
  };

  // 第一次打開時自動分段
  useEffect(() => {
    if (segmentsDoc === null && !autoCreatedRef.current) {
      autoCreatedRef.current = true;
      runSegmenting();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [segmentsDoc]);

  const handleStart = async (index: number, segment: RetellSegment) => {
    if (startingIndex !== null) return;
    setStartingIndex(index);
    try {
      const targets = await pickTargetPatterns(material, segment, bySentence).catch(() => []);
      onStart(index, segment, targets);
    } finally {
      setStartingIndex(null);
    }
  };

  const activeIds = material.sentences.filter(s => !s.deleted && (s.text || '').trim()).map(s => s.id);
  const valid = segmentsDoc ? isSegmentsValid(material, segmentsDoc) : false;

  return (
    <div className="mb-6 p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-bold text-slate-700 dark:text-slate-200 flex items-center gap-1.5">
            <MessageSquareText size={16} className="text-indigo-500" />
            複述練習
          </p>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">聽完一段，用自己的話說出重點</p>
        </div>
        {segmentsDoc && (
          <button
            onClick={runSegmenting}
            disabled={segmenting}
            className="shrink-0 flex items-center gap-1 text-xs font-bold text-slate-500 dark:text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400 disabled:opacity-50"
          >
            {segmenting ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
            重新分段
          </button>
        )}
      </div>

      {segmentError && <p className="text-xs font-bold text-red-500">{segmentError}</p>}

      {(segmentsDoc === undefined || (segmenting && !segmentsDoc)) && (
        <div className="flex items-center gap-2 text-xs font-bold text-slate-500 dark:text-slate-400 py-2">
          <Loader2 size={14} className="animate-spin" />
          {segmentsDoc === undefined ? '載入中…' : '依主題分段中…'}
        </div>
      )}

      {segmentsDoc === null && !segmenting && (
        <button
          onClick={runSegmenting}
          className="w-full py-2.5 text-sm font-bold bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400 rounded-xl"
        >
          開始分段
        </button>
      )}

      {segmentsDoc && !valid && (
        <p className="text-xs font-bold text-amber-600 dark:text-amber-400">教材句子有變動，建議按「重新分段」</p>
      )}

      {segmentsDoc && (
        <div className="divide-y divide-slate-100 dark:divide-slate-800">
          {segmentsDoc.segments.map((seg, index) => {
            const first = activeIds.indexOf(seg.sentenceIds[0]) + 1;
            const last = activeIds.indexOf(seg.sentenceIds[seg.sentenceIds.length - 1]) + 1;
            const segRecords = records.filter(r => r.segmentIndex === index);
            const latest = segRecords[0];
            return (
              <div key={index} className="py-3 first:pt-1 last:pb-0 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-bold text-slate-800 dark:text-slate-100 line-clamp-1">{index + 1}. {seg.title}</p>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                    {first > 0 && last > 0 ? `第 ${first}–${last} 句` : `${seg.sentenceIds.length} 句`}
                    {latest ? `・上次 內容 ${latest.feedback?.contentScore ?? '-'}／語言 ${latest.feedback?.languageScore ?? '-'}（共 ${segRecords.length} 次）` : '・尚未複述'}
                  </p>
                </div>
                <button
                  onClick={() => handleStart(index, seg)}
                  disabled={startingIndex !== null || !valid}
                  className="shrink-0 px-3 py-2 text-xs font-bold bg-indigo-600 text-white rounded-xl hover:bg-indigo-700 transition-colors disabled:opacity-50 flex items-center gap-1.5"
                >
                  {startingIndex === index ? <Loader2 size={14} className="animate-spin" /> : null}
                  複述
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
