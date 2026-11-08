import React, { useEffect, useRef, useState } from 'react';
import { Play, Pause, Ear, RotateCcw, AlertCircle, Loader2, Check } from 'lucide-react';
import Button from './ui/Button';
import TimeStepperField from './ui/TimeStepperField';
import { MaterialSentence } from '../types';
import { adjustTime, isValidRange, round2, tailRange } from '../utils/timeEdit';
import { saveSentenceTime, restoreOriginalSentenceTime } from '../services/materialTimeEdit';

// 教材詳情頁：修正一句的時間，介面與校對畫面相同（擁有者 2026-11-08 決定）
// 規劃：docs/plans/import-timestamp-accuracy.md（PR-G）

interface SentenceTimeEditorProps {
    materialId: string;
    sentence: MaterialSentence;
    /** 目前正在播放的 key（`${id}:edit`＝播放片段、`${id}:tail`＝聽句尾） */
    playingKey: string | null;
    onPlayRange: (key: string, start: number, end: number | (() => number)) => void;
    /** 編輯中的時間改了：讓播放中的停止點立刻依新時間重排（Gemini） */
    onTimesChanged?: () => void;
    onStop: () => void;
    onClose: () => void;
}

const SentenceTimeEditor: React.FC<SentenceTimeEditorProps> = ({ materialId, sentence, playingKey, onPlayRange, onStop, onClose, onTimesChanged }) => {
    const [startTime, setStartTime] = useState(sentence.startTime);
    const [endTime, setEndTime] = useState(sentence.endTime);
    const [warning, setWarning] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);
    const [saved, setSaved] = useState<string | null>(null);

    // 存檔或還原後（或其他裝置修改）以最新資料為準
    useEffect(() => {
        setStartTime(sentence.startTime);
        setEndTime(sentence.endTime);
    }, [sentence.startTime, sentence.endTime]);

    // 播放中讀最新的編輯值
    const endRef = useRef(endTime);
    endRef.current = endTime;
    useEffect(() => { onTimesChanged?.(); }, [startTime, endTime]);   // eslint-disable-line react-hooks/exhaustive-deps

    const fieldId = `time-${sentence.id}`;
    const invalid = !isValidRange(startTime, endTime);
    const dirty = round2(startTime) !== sentence.startTime || round2(endTime) !== sentence.endTime;
    const hasOriginal = typeof sentence.originalStartTime === 'number' && typeof sentence.originalEndTime === 'number';
    const playKey = `${sentence.id}:edit`;
    const tailKey = `${sentence.id}:tail`;

    const step = (field: 'startTime' | 'endTime', delta: number) => {
        const r = adjustTime({ startTime, endTime }, field, delta);
        if ('warning' in r) { setWarning(r.warning); return; }
        setWarning(null);
        setSaved(null);
        setStartTime(r.startTime);
        setEndTime(r.endTime);
    };

    const run = async (fn: () => Promise<unknown>, doneMsg: string) => {
        onStop();
        setSaving(true);
        setError(null);
        setSaved(null);
        try {
            await fn();
            setSaved(doneMsg);
        } catch (err: any) {
            setError(err?.message || '儲存失敗，請再試一次');
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="flex flex-col gap-3 rounded-xl border border-line bg-surface-2 p-3.5">
            <div className="grid grid-cols-2 gap-2.5">
                <TimeStepperField id={`${fieldId}-start`} label="開始 (s)" value={startTime} invalid={invalid} disabled={saving}
                    onChange={(v) => { setWarning(null); setSaved(null); setStartTime(v); }} onStep={(d) => step('startTime', d)} />
                <TimeStepperField id={`${fieldId}-end`} label="結束 (s)" value={endTime} invalid={invalid} disabled={saving}
                    onChange={(v) => { setWarning(null); setSaved(null); setEndTime(v); }} onStep={(d) => step('endTime', d)} />
            </div>

            {invalid && (
                <p className="flex items-center gap-1.5 text-xs font-medium text-danger">
                    <AlertCircle size={14} aria-hidden="true" /> 開始時間必須小於結束時間
                </p>
            )}
            {warning && (
                <p className="flex items-center gap-1.5 text-xs font-medium text-warn">
                    <AlertCircle size={14} aria-hidden="true" /> {warning}
                </p>
            )}

            <div className="grid grid-cols-2 gap-2.5">
                <Button variant="secondary" size="sm" fullWidth aria-pressed={playingKey === playKey} disabled={invalid}
                    onClick={() => playingKey === playKey ? onStop() : onPlayRange(playKey, round2(startTime), () => round2(endRef.current))}
                    className={playingKey === playKey ? 'border-accent bg-accent-soft' : ''}
                    icon={playingKey === playKey ? <Pause size={14} aria-hidden="true" /> : <Play size={14} className="fill-current" aria-hidden="true" />}>
                    {playingKey === playKey ? '暫停播放' : '播放片段'}
                </Button>
                <Button variant="secondary" size="sm" fullWidth aria-pressed={playingKey === tailKey} disabled={!(endTime > 0)}
                    title="從句尾前 1.5 秒播到句尾後 0.5 秒"
                    onClick={() => { if (playingKey === tailKey) { onStop(); return; } const r = tailRange(round2(endTime)); onPlayRange(tailKey, r.start, () => tailRange(round2(endRef.current)).end); }}
                    className={playingKey === tailKey ? 'border-accent bg-accent-soft' : ''}
                    icon={playingKey === tailKey ? <Pause size={14} aria-hidden="true" /> : <Ear size={14} aria-hidden="true" />}>
                    {playingKey === tailKey ? '暫停播放' : '聽句尾'}
                </Button>
            </div>

            {hasOriginal && (
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
                    <span className="tabular-nums">原始時間：{sentence.originalStartTime}s ~ {sentence.originalEndTime}s</span>
                    <Button variant="ghost" size="sm" disabled={saving} onClick={() => run(() => restoreOriginalSentenceTime(materialId, sentence.id), '已還原原始時間')}
                        icon={<RotateCcw size={14} aria-hidden="true" />}>
                        還原原始時間
                    </Button>
                </div>
            )}

            {error && (
                <p role="alert" className="flex items-center gap-1.5 text-xs font-medium text-danger">
                    <AlertCircle size={14} aria-hidden="true" /> {error}
                </p>
            )}

            {saved && !dirty && (
                <p role="status" className="flex items-center gap-1.5 text-xs font-medium text-accent">
                    <Check size={14} aria-hidden="true" /> {saved}
                </p>
            )}

            <div className="flex justify-end gap-2">
                <Button variant="ghost" size="sm" disabled={saving} onClick={() => { onStop(); onClose(); }}>
                    {dirty ? '取消' : '關閉'}
                </Button>
                <Button size="sm" disabled={saving || invalid || !dirty}
                    onClick={() => run(() => saveSentenceTime(materialId, sentence.id, startTime, endTime), '已儲存，跟讀會用新的時間')}
                    icon={saving ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : undefined}>
                    儲存
                </Button>
            </div>
        </div>
    );
};

export default SentenceTimeEditor;
