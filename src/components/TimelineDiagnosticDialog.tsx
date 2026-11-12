import React, { useEffect, useState } from 'react';
import { Loader2, Download, Trash2, Activity, X } from 'lucide-react';
import type { Material } from '../types';
import Button from './ui/Button';
import IconButton from './ui/IconButton';
import {
    subscribeTranscriptionDiagnostic, startTranscriptionDiagnostic, downloadTranscriptionDiagnostic,
    deleteTranscriptionDiagnostic, TranscriptionDiagnostic, DiagnosticProviderSummary,
} from '../services/transcriptionDiagnostic';

// 時間軸診斷：同一份音檔同時取得 OpenAI 與 Groq 的原始時間，下載給開發者分析
// 規劃：docs/plans/timestamp-baseline.md（擁有者 2026-11-12 核准）

const COOLDOWN_MS = 10 * 60_000;
/** 和伺服器相同：執行中超過 20 分鐘視為卡住，可以重來（Codex） */
const STALE_MS = 20 * 60_000;
const PROVIDER_LABEL: Record<string, string> = { openai: 'OpenAI whisper-1', groq: 'Groq whisper-large-v3' };
const WORDS_LABEL: Record<string, string> = {
    ok: '有每個字的時間',
    missing: '沒有回傳每個字的時間',
    'unsupported-word': '不支援每個字的時間',
    'unsupported-param': '不認得時間顆粒度參數',
};

const TimelineDiagnosticDialog: React.FC<{ material: Material; onClose: () => void }> = ({ material, onClose }) => {
    const [diag, setDiag] = useState<TranscriptionDiagnostic | null>(null);
    const [busy, setBusy] = useState<'start' | 'download' | 'delete' | null>(null);
    const [message, setMessage] = useState<{ text: string; isError?: boolean } | null>(null);
    const [now, setNow] = useState(Date.now());

    useEffect(() => subscribeTranscriptionDiagnostic(material.id, setDiag), [material.id]);
    useEffect(() => {
        const t = setInterval(() => setNow(Date.now()), 15_000);
        return () => clearInterval(t);
    }, []);

    const stale = diag?.status === 'running' && typeof diag.startedAt === 'number' && now - diag.startedAt > STALE_MS;
    const running = diag?.status === 'running' && !stale;
    const coolingDown = diag?.status === 'done' && typeof diag.startedAt === 'number' && now - diag.startedAt < COOLDOWN_MS;

    const run = async (kind: 'start' | 'download' | 'delete', fn: () => Promise<void>, done?: string) => {
        setBusy(kind);
        setMessage(null);
        try {
            await fn();
            if (done) setMessage({ text: done });
        } catch (e: any) {
            setMessage({ text: e?.message || '發生錯誤，請再試一次', isError: true });
        } finally {
            setBusy(null);
        }
    };

    return (
        <div className="fixed inset-0 z-100 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4" onClick={() => { if (!busy) onClose(); }}>
            <div
                role="dialog"
                aria-modal="true"
                aria-labelledby="timeline-diag-h"
                className="flex max-h-[85vh] w-full max-w-lg flex-col gap-4 overflow-y-auto rounded-3xl border border-line bg-surface p-6 shadow-[0_24px_48px_-12px_rgb(0_0_0/0.25)]"
                onClick={(e) => e.stopPropagation()}
                onKeyDown={(e) => { if (e.key === 'Escape' && !busy) onClose(); }}
            >
                <div className="flex items-center justify-between border-b border-line pb-4">
                    <h3 id="timeline-diag-h" className="flex items-center gap-2 text-lg font-bold text-ink">
                        <Activity size={18} className="text-accent" aria-hidden="true" />時間軸診斷
                    </h3>
                    <IconButton aria-label="關閉" onClick={onClose} className="-mr-2 text-muted"><X size={20} aria-hidden="true" /></IconButton>
                </div>
                <p className="text-sm leading-relaxed text-muted">
                    把這份音檔同時交給 OpenAI 與 Groq 轉錄，取得每一段與每個字的原始時間，下載後附到對話給開發者分析。
                    不會改動教材。每份教材 10 分鐘內只能診斷一次（9 分鐘音檔約 US$0.05）。
                </p>

                {diag && (
                    <div className="rounded-2xl border border-line bg-surface-2 p-4 text-sm" role="status">
                        <p className="font-medium text-ink">
                            {running ? '診斷中，通常 1～3 分鐘…' : stale ? '上次診斷沒有完成，可以重新診斷' : diag.status === 'done' ? '診斷完成' : `診斷失敗：${diag.error || '未知錯誤'}`}
                        </p>
                        {!running && !stale && diag.providers && (
                            <ul className="mt-2 flex flex-col gap-1 text-[13px] text-muted">
                                {(Object.entries(diag.providers) as Array<[string, DiagnosticProviderSummary]>).map(([name, p]) => (
                                    <li key={name} className="break-words">
                                        {PROVIDER_LABEL[name] || name}：{p.status === 'done'
                                            ? `${p.segmentCount ?? 0} 段、${p.wordCount ?? 0} 字（${WORDS_LABEL[p.wordsStatus || ''] || '—'}）`
                                            : `失敗（${p.error || '未知錯誤'}）`}
                                    </li>
                                ))}
                            </ul>
                        )}
                    </div>
                )}

                {message && (
                    <p role={message.isError ? 'alert' : 'status'} className={`text-xs font-medium break-words ${message.isError ? 'text-danger' : 'text-accent'}`}>{message.text}</p>
                )}

                <div className="flex flex-col gap-2">
                    <Button
                        fullWidth
                        disabled={!!busy || running || coolingDown}
                        onClick={() => run('start', () => startTranscriptionDiagnostic(material.id), '已送出，完成後這裡會更新')}
                        icon={busy === 'start' || running ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : <Activity size={16} aria-hidden="true" />}
                    >
                        {running ? '診斷中…' : coolingDown ? '10 分鐘內已診斷過' : diag ? '重新診斷' : '開始診斷'}
                    </Button>
                    {diag?.status === 'done' && (
                        <Button
                            variant="secondary"
                            fullWidth
                            disabled={!!busy}
                            onClick={() => run('download', () => downloadTranscriptionDiagnostic(material), '已下載，請把檔案附到對話')}
                            icon={busy === 'download' ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : <Download size={16} aria-hidden="true" />}
                        >
                            下載診斷資料
                        </Button>
                    )}
                    {diag && !running && (
                        <Button
                            variant="ghost"
                            fullWidth
                            disabled={!!busy}
                            onClick={() => run('delete', () => deleteTranscriptionDiagnostic(material.id), '已刪除診斷資料')}
                            icon={busy === 'delete' ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : <Trash2 size={16} aria-hidden="true" />}
                            className="text-muted"
                        >
                            刪除診斷資料
                        </Button>
                    )}
                </div>
            </div>
        </div>
    );
};

export default TimelineDiagnosticDialog;
