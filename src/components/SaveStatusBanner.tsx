import React, { useEffect, useRef, useState } from 'react';
import { Loader2, AlertCircle, CheckCircle2, PauseCircle, PencilLine } from 'lucide-react';
import { describeSaveJob } from '../utils/saveJob';
import {
    subscribeSaveJobs, retryBackgroundSave, abandonBackgroundSave, materialExists, clearSavedJob, type SaveJob,
} from '../services/backgroundSave';

// 全域的背景存檔提示：放在 App 層（不隨分頁卸載），頂部一行、不蓋住底部錄音列
// 規劃：docs/plans/background-material-save.md（擁有者 2026-11-09 核准）

interface Props {
    uid: string | null | undefined;
    /** 「回到校對」：切到啟蒙的開始並打開這份教材的校對畫面 */
    onResumeReview: (materialId: string) => void;
}

const TICK_MS = 15_000;
const DONE_TOAST_MS = 6_000;

const SaveStatusBanner: React.FC<Props> = ({ uid, onResumeReview }) => {
    const [jobs, setJobs] = useState<SaveJob[]>([]);
    const [now, setNow] = useState(() => Date.now());
    const [busy, setBusy] = useState<Record<string, boolean>>({});
    const [errors, setErrors] = useState<Record<string, string>>({});
    const [confirmAbandon, setConfirmAbandon] = useState<string | null>(null);
    const [done, setDone] = useState<{ id: string; text: string }[]>([]);
    const tracked = useRef(new Map<string, string>());   // 曾經顯示過的任務：id → 標題

    useEffect(() => {
        if (!uid) { setJobs([]); return; }
        return subscribeSaveJobs(uid, setJobs);
    }, [uid]);

    // 定時重新判斷「可能中斷了」
    useEffect(() => {
        const t = setInterval(() => setNow(Date.now()), TICK_MS);
        return () => clearInterval(t);
    }, []);

    // 完成偵測：追蹤中的任務變成 saved 或消失 → 確認教材存在才提示「已儲存」
    useEffect(() => {
        const present = new Set(jobs.map(j => j.id));
        const finished: { id: string; title: string }[] = [];
        for (const j of jobs) {
            if (j.status === 'saved') {
                finished.push({ id: j.id, title: j.title || '教材' });
                void clearSavedJob(j.id);
            } else {
                tracked.current.set(j.id, j.title || '教材');
            }
        }
        for (const [id, title] of tracked.current) {
            if (!present.has(id)) finished.push({ id, title });
        }
        for (const f of finished) {
            tracked.current.delete(f.id);
            void materialExists(f.id).then((ok) => {
                if (!ok) return;
                setDone(prev => prev.some(d => d.id === f.id) ? prev : [...prev, { id: f.id, text: `${f.title} 已儲存` }]);
                setTimeout(() => setDone(prev => prev.filter(d => d.id !== f.id)), DONE_TOAST_MS);
            }).catch(() => {});
        }
    }, [jobs]);

    const run = async (id: string, fn: () => Promise<unknown>) => {
        setBusy(b => ({ ...b, [id]: true }));
        setErrors(e => { const n = { ...e }; delete n[id]; return n; });
        try {
            await fn();
        } catch (err: any) {
            setErrors(e => ({ ...e, [id]: err?.message || '操作失敗，請再試一次' }));
        } finally {
            setBusy(b => ({ ...b, [id]: false }));
        }
    };

    const rows = jobs
        .map(j => ({ job: j, view: describeSaveJob(j, now) }))
        .filter((r): r is { job: SaveJob; view: NonNullable<ReturnType<typeof describeSaveJob>> } => r.view !== null);

    if (rows.length === 0 && done.length === 0) return null;

    const btn = 'shrink-0 rounded-full px-2.5 py-1 text-[12px] font-medium transition-colors hover:bg-line disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-accent';

    return (
        <div className="shrink-0 px-4 pt-3 lg:px-8 lg:pt-6" aria-live="polite">
            <div className="mx-auto flex w-full max-w-[1200px] flex-col gap-2">
                {rows.map(({ job, view }) => {
                    const id = job.id;
                    const isBusy = !!busy[id];
                    const tone = view.kind === 'saving' ? 'bg-accent-soft text-ink'
                        : view.kind === 'error' || view.kind === 'stalled' ? 'bg-danger/10 text-danger'
                        : 'bg-warn/10 text-warn';
                    const Icon = view.kind === 'saving' ? Loader2 : view.kind === 'paused' ? PauseCircle : view.kind === 'reviewing' ? PencilLine : AlertCircle;
                    const canRetry = view.kind === 'error' || view.kind === 'stalled' || view.kind === 'paused';
                    const canReview = view.kind !== 'saving';
                    return (
                        <div key={id} role={view.kind === 'error' ? 'alert' : 'status'} className={`flex flex-wrap items-center gap-x-2 gap-y-1 rounded-xl px-4 py-2 text-[13px] font-medium ${tone}`}>
                            <Icon size={15} className={`shrink-0 ${view.kind === 'saving' ? 'animate-spin' : ''}`} aria-hidden="true" />
                            <span className="min-w-0 flex-1 break-words">{view.text}</span>
                            {/* 手機：按鈕換到下一行，文字完整顯示（含進度） */}
                            {(canRetry || canReview) && <span className="basis-full sm:hidden" aria-hidden="true" />}
                            {canRetry && (
                                <button type="button" className={btn} disabled={isBusy} onClick={() => run(id, () => retryBackgroundSave(id))}>
                                    {view.kind === 'paused' ? '繼續' : '重試'}
                                </button>
                            )}
                            {canReview && (
                                <button type="button" className={btn} disabled={isBusy} onClick={() => run(id, async () => onResumeReview(id))}>
                                    回到校對
                                </button>
                            )}
                            {canReview && (confirmAbandon === id ? (
                                <button type="button" className={`${btn} text-danger`} disabled={isBusy}
                                    onClick={() => { setConfirmAbandon(null); void run(id, () => abandonBackgroundSave(id)); }}>
                                    確定放棄（刪除音檔）
                                </button>
                            ) : (
                                <button type="button" className={btn} disabled={isBusy} onClick={() => setConfirmAbandon(id)}>
                                    放棄
                                </button>
                            ))}
                            {errors[id] && <span className="basis-full text-[12px] text-danger">{errors[id]}</span>}
                        </div>
                    );
                })}
                {done.map(d => (
                    <div key={d.id} role="status" className="flex items-center gap-2 rounded-xl bg-accent-soft px-4 py-2 text-[13px] font-medium text-ink">
                        <CheckCircle2 size={15} className="shrink-0 text-accent" aria-hidden="true" />
                        <span className="min-w-0 flex-1 break-words">{d.text}</span>
                    </div>
                ))}
            </div>
        </div>
    );
};

export default SaveStatusBanner;
