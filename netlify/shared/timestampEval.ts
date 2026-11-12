// 時間軸評分：切句結果 vs. 擁有者人工標註的邊界
// 規劃：docs/plans/timestamp-baseline.md（擁有者 2026-11-12 核准）
// 標註以「連續區段」為單位：區段內每個句首／句尾都標，與候選切句方式無關（Codex）

export interface TimedSentence { startTime: number; endTime: number }
export interface RefBoundary { t: number; kind: 'start' | 'end' }
export interface RefRegion { from: number; to: number; boundaries: RefBoundary[] }

export interface BoundaryEval {
    /** 標註邊界總數（分母） */
    total: number;
    matched: number;
    /** 標註邊界 1 秒內找不到同類預測邊界（漏切、偏太多） */
    missed: number;
    /** 區段內多出來、沒對到標註的預測邊界（句中被切斷） */
    extra: number;
    startMAE: number;
    endMAE: number;
    /** 平均（預測 − 標註），正＝偏晚 */
    startBias: number;
    endBias: number;
    /** 誤差 > 0.2 秒的比例（missed 視為超過），分母＝total */
    over02Ratio: number;
    /** 每個標註邊界的結果，方便看失敗例子 */
    details: Array<{ ref: RefBoundary; pred: number | null; error: number | null }>;
}

export const MATCH_WINDOW_SEC = 1;
export const OVER_SEC = 0.2;

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

export function evaluateBoundaries(predicted: TimedSentence[], regions: RefRegion[], window = MATCH_WINDOW_SEC): BoundaryEval {
    const preds: Array<{ t: number; kind: 'start' | 'end'; used: boolean }> = [];
    for (const s of predicted) {
        preds.push({ t: s.startTime, kind: 'start', used: false });
        preds.push({ t: s.endTime, kind: 'end', used: false });
    }
    const refs: Array<{ ref: RefBoundary; region: RefRegion; pred: number | null }> = [];
    for (const region of regions) for (const ref of region.boundaries) refs.push({ ref, region, pred: null });

    // 一對一配對：所有候選配對依距離由近到遠
    const pairs: Array<{ ri: number; pi: number; d: number }> = [];
    refs.forEach((r, ri) => preds.forEach((p, pi) => {
        if (p.kind !== r.ref.kind) return;
        const d = Math.abs(p.t - r.ref.t);
        if (d <= window) pairs.push({ ri, pi, d });
    }));
    pairs.sort((a, b) => a.d - b.d);
    for (const { ri, pi } of pairs) {
        if (refs[ri].pred !== null || preds[pi].used) continue;
        refs[ri].pred = preds[pi].t;
        preds[pi].used = true;
    }

    const startErr: number[] = [];
    const endErr: number[] = [];
    let over = 0;
    const details: BoundaryEval['details'] = [];
    for (const r of refs) {
        if (r.pred === null) {
            over += 1;
            details.push({ ref: r.ref, pred: null, error: null });
            continue;
        }
        const e = r.pred - r.ref.t;
        (r.ref.kind === 'start' ? startErr : endErr).push(e);
        if (Math.abs(e) > OVER_SEC + 1e-9) over += 1;
        details.push({ ref: r.ref, pred: r.pred, error: e });
    }
    const extra = preds.filter(p => !p.used && regions.some(g => p.t >= g.from && p.t <= g.to)).length;
    const total = refs.length;
    return {
        total,
        matched: startErr.length + endErr.length,
        missed: total - startErr.length - endErr.length,
        extra,
        startMAE: mean(startErr.map(Math.abs)),
        endMAE: mean(endErr.map(Math.abs)),
        startBias: mean(startErr),
        endBias: mean(endErr),
        over02Ratio: total ? over / total : 0,
        details,
    };
}
