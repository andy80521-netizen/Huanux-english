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
  /** 放在詳情頁的工具卡片裡時不畫自己的外框 */
  embedded?: boolean;
}

// 教材詳情頁：複述練習區塊（分段清單與每段最近一次的分數）
export default function RetellSection({ material, bySentence, onStart, embedded = false }: Props) {
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
    <div className={embedded ? 'px-4 py-3.5 space-y-3' : 'mb-6 p-4 rounded-2xl bg-surface border border-line space-y-3'}>
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-ink flex items-center gap-1.5">
            {!embedded && <MessageSquareText size={16} className="text-accent" aria-hidden="true" />}
            複述練習
          </p>
          <p className="text-xs text-muted mt-0.5">聽完一段，用自己的話說出重點</p>
        </div>
        {segmentsDoc && (
          <button
            type="button"
            onClick={runSegmenting}
            disabled={segmenting}
            className="shrink-0 flex min-h-10 items-center gap-1 rounded-full px-2 text-xs text-muted hover:text-ink disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-accent"
          >
            {segmenting ? <Loader2 size={12} className="animate-spin" aria-hidden="true" /> : <RefreshCw size={12} aria-hidden="true" />}
            重新分段
          </button>
        )}
      </div>

      {segmentError && <p role="alert" className="text-xs font-medium text-danger">{segmentError}</p>}

      {(segmentsDoc === undefined || (segmenting && !segmentsDoc)) && (
        <div className="flex items-center gap-2 text-xs text-muted py-2" role="status">
          <Loader2 size={14} className="animate-spin" aria-hidden="true" />
          {segmentsDoc === undefined ? '載入中…' : '依主題分段中…'}
        </div>
      )}

      {segmentsDoc === null && !segmenting && (
        <button
          type="button"
          onClick={runSegmenting}
          className="w-full min-h-10 text-sm font-medium bg-accent-soft text-ink rounded-full hover:brightness-[0.97] dark:hover:brightness-110 focus-visible:outline-2 focus-visible:outline-accent"
        >
          開始分段
        </button>
      )}

      {segmentsDoc && !valid && (
        <p className="text-xs font-medium text-warn">教材句子有變動，建議按「重新分段」</p>
      )}

      {segmentsDoc && (
        <div className="space-y-3">
          {segmentsDoc.segments.map((seg, index) => {
            const first = activeIds.indexOf(seg.sentenceIds[0]) + 1;
            const last = activeIds.indexOf(seg.sentenceIds[seg.sentenceIds.length - 1]) + 1;
            const segRecords = records.filter(r => r.segmentIndex === index);
            const latest = segRecords[0];
            return (
              <div key={index} className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[13px] font-medium text-ink line-clamp-1">{index + 1}. {seg.title}</p>
                  <p className="text-xs text-muted mt-0.5">
                    {first > 0 && last > 0 ? `第 ${first}–${last} 句` : `${seg.sentenceIds.length} 句`}
                    {latest ? `・上次 內容 ${latest.feedback?.contentScore ?? '-'}／語言 ${latest.feedback?.languageScore ?? '-'}（共 ${segRecords.length} 次）` : '・尚未複述'}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => handleStart(index, seg)}
                  disabled={startingIndex !== null || !valid}
                  className="shrink-0 flex min-h-10 items-center gap-1.5 rounded-full bg-accent-soft px-4 text-xs font-medium text-ink transition-[filter] hover:brightness-[0.97] dark:hover:brightness-110 disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-accent"
                >
                  {startingIndex === index ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : null}
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
