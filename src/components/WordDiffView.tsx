import React from 'react';
import { WordDiff } from '../utils/scoring';

// 【v3.11】評分結果的逐字比對：漏念標紅、念錯加刪除線並附實際念的字、多念以灰色小字插在對應位置
export default function WordDiffView({ diff }: { diff: WordDiff[] }) {
    if (!diff || diff.length === 0) return null;
    const hasError = diff.some(d => d.type !== 'ok');

    return (
        <div className="bg-slate-50 dark:bg-slate-950 p-4 rounded-xl border border-slate-100 dark:border-slate-800">
            <p className="text-xs font-bold text-slate-500 mb-2">逐字比對</p>
            <p className="leading-loose break-words">
                {diff.map((d, i) => {
                    if (d.type === 'ok') {
                        return <span key={i} className="font-bold text-slate-800 dark:text-slate-200">{d.word} </span>;
                    }
                    if (d.type === 'missing') {
                        return (
                            <span key={i} className="font-bold text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/30 rounded px-1 mr-1">
                                {d.word}
                            </span>
                        );
                    }
                    if (d.type === 'wrong') {
                        return (
                            <span key={i} className="mr-1">
                                <span className="font-bold text-red-600 dark:text-red-400 line-through">{d.word}</span>
                                <span className="text-xs text-amber-600 dark:text-amber-400 ml-0.5">({d.said})</span>{' '}
                            </span>
                        );
                    }
                    return (
                        <span key={i} className="text-xs text-slate-400 dark:text-slate-500 italic mr-1">+{d.word}</span>
                    );
                })}
            </p>
            {hasError && (
                <p className="text-[11px] font-bold text-slate-400 dark:text-slate-500 mt-2">
                    紅底＝漏念　刪除線＝念錯（括號內是你念的）　灰色＋＝多念
                </p>
            )}
        </div>
    );
}
