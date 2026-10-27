import React from 'react';
import { WordDiff } from '../utils/scoring';

// 【v3.11】評分結果的逐字比對：漏念加底線、念錯加刪除線並附實際念的字、多念以灰色小字插在對應位置
// 有問題的字依序淡入（減少動態效果時直接顯示）
export default function WordDiffView({ diff }: { diff: WordDiff[] }) {
    if (!diff || diff.length === 0) return null;
    const hasError = diff.some(d => d.type !== 'ok');
    let errorOrder = 0;
    const stagger = () => ({ animationDelay: `${120 + (errorOrder++) * 60}ms` });

    return (
        <div className="flex flex-col gap-2">
            <p className="text-xs text-muted">逐字比對</p>
            <p lang="en" className="font-reading text-[22px] leading-[1.6] text-ink break-words lg:text-[26px]">
                {diff.map((d, i) => {
                    if (d.type === 'ok') {
                        return <span key={i}>{d.word} </span>;
                    }
                    if (d.type === 'missing') {
                        return (
                            <React.Fragment key={i}>
                                <span
                                    className="inline-block animate-rise-in text-warn underline decoration-warn decoration-[1.5px] underline-offset-[5px]"
                                    style={stagger()}
                                >
                                    {d.word}
                                </span>{' '}
                            </React.Fragment>
                        );
                    }
                    if (d.type === 'wrong') {
                        return (
                            <React.Fragment key={i}>
                                <span className="inline-block animate-rise-in" style={stagger()}>
                                    <span className="text-warn line-through decoration-warn decoration-[1.5px]">{d.word}</span>
                                    <span className="ml-0.5 font-sans text-xs text-warn">({d.said})</span>
                                </span>{' '}
                            </React.Fragment>
                        );
                    }
                    return (
                        <React.Fragment key={i}>
                            <span className="inline-block animate-rise-in font-sans text-xs italic text-muted" style={stagger()}>+{d.word}</span>{' '}
                        </React.Fragment>
                    );
                })}
            </p>
            {hasError && (
                <p className="text-[11px] text-muted">
                    底線＝漏念　刪除線＝念錯（括號內是你念的）　灰色＋＝多念
                </p>
            )}
        </div>
    );
}
