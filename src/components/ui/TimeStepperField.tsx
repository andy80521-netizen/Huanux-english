import React from 'react';
import { TIME_STEP } from '../../utils/timeEdit';

// 時間欄位（−0.2／數字／+0.2）：校對畫面與教材詳情頁共用，介面一致（擁有者 2026-11-08 決定）
// 規劃：docs/plans/import-timestamp-accuracy.md（PR-G）

interface TimeStepperFieldProps {
    id: string;
    label: string;
    value: number;
    invalid?: boolean;
    disabled?: boolean;
    onChange: (value: number) => void;
    onStep: (delta: number) => void;
}

const STEP_LABEL = TIME_STEP.toFixed(1);
const BTN = 'h-full w-11 shrink-0 text-xs text-ink transition-colors hover:bg-line disabled:opacity-50 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent';

const TimeStepperField: React.FC<TimeStepperFieldProps> = ({ id, label, value, invalid, disabled, onChange, onStep }) => (
    <div className="flex min-w-0 flex-col gap-1.5">
        <label htmlFor={id} className="text-xs text-muted">{label}</label>
        <div className={`flex h-11 items-center overflow-hidden rounded-full border bg-surface-2 ${invalid ? 'border-danger' : 'border-muted/35'} focus-within:border-accent`}>
            <button type="button" aria-label={`${label} 減 ${STEP_LABEL} 秒`} onClick={() => onStep(-TIME_STEP)} disabled={disabled} className={BTN}>
                −{STEP_LABEL}
            </button>
            <input
                id={id}
                type="number"
                step="0.01"
                min="0"
                inputMode="decimal"
                value={value}
                disabled={disabled}
                onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
                className="h-full min-w-0 flex-1 bg-transparent text-center font-reading text-base text-ink tabular-nums outline-hidden disabled:opacity-50 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
            />
            <button type="button" aria-label={`${label} 加 ${STEP_LABEL} 秒`} onClick={() => onStep(TIME_STEP)} disabled={disabled} className={BTN}>
                +{STEP_LABEL}
            </button>
        </div>
    </div>
);

export default TimeStepperField;
