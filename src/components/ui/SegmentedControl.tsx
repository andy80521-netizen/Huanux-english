import React, { useRef } from 'react';

export interface SegmentOption<T extends string> {
  value: T;
  label: string;
  icon?: React.ReactNode;
}

interface SegmentedControlProps<T extends string> {
  options: ReadonlyArray<SegmentOption<T>>;
  value: T;
  onChange: (value: T) => void;
  /** 整組的名稱，例如「外觀」 */
  label: string;
  className?: string;
}

/**
 * 分段選擇器（單選）。鍵盤：Tab 進入目前選項，左右方向鍵切換，Home／End 到頭尾。
 */
export default function SegmentedControl<T extends string>({ options, value, onChange, label, className = '' }: SegmentedControlProps<T>) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const current = Math.max(0, options.findIndex((o) => o.value === value));

  const move = (to: number) => {
    const n = options.length;
    const i = ((to % n) + n) % n;
    onChange(options[i].value);
    refs.current[i]?.focus();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); move(current + 1); }
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); move(current - 1); }
    else if (e.key === 'Home') { e.preventDefault(); move(0); }
    else if (e.key === 'End') { e.preventDefault(); move(options.length - 1); }
  };

  return (
    <div
      role="radiogroup"
      aria-label={label}
      onKeyDown={onKeyDown}
      className={`grid gap-1 rounded-full bg-surface-2 p-1 border border-line ${className}`}
      style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}
    >
      {options.map((o, i) => {
        const selected = i === current;
        return (
          <button
            key={o.value}
            ref={(el) => { refs.current[i] = el; }}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(o.value)}
            className={
              'flex min-h-10 min-w-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-full px-2 text-[13px] ' +
              'transition-[background-color,color,box-shadow] duration-[var(--dur-fast)] ' +
              'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent ' +
              (selected
                ? 'bg-surface text-ink font-medium shadow-[0_1px_2px_rgb(0_0_0/0.08)] dark:shadow-none dark:bg-accent-soft'
                : 'text-muted hover:text-ink')
            }
          >
            {o.icon && <span className="hidden shrink-0 min-[420px]:inline-flex" aria-hidden="true">{o.icon}</span>}
            <span>{o.label}</span>
          </button>
        );
      })}
    </div>
  );
}
