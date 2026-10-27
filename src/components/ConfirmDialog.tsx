import React, { useEffect, useId, useRef } from 'react';
import { AlertTriangle } from 'lucide-react';

const ConfirmDialog: React.FC<{
  isOpen: boolean;
  title: string;
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
  confirmText?: string;
  cancelText?: string;
}> = ({ isOpen, title, message, onConfirm, onCancel, confirmText = "確定", cancelText = "取消" }) => {
  const titleId = useId();
  const cancelRef = useRef<HTMLButtonElement>(null);
  // 呼叫端每次重繪都會傳新的 onCancel，用 ref 保存，避免下面的 effect 重跑而把焦點搶回「取消」
  const onCancelRef = useRef(onCancel);
  onCancelRef.current = onCancel;

  // 開啟時把焦點放在「取消」（較安全的選項），Esc 等同取消
  useEffect(() => {
    if (!isOpen) return;
    cancelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancelRef.current(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen]);

  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 z-100 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4">
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="w-full max-w-xs rounded-3xl border border-line bg-surface p-7 text-center shadow-[0_24px_48px_-12px_rgb(0_0_0/0.25)]"
      >
        <div className="mx-auto mb-5 flex size-14 items-center justify-center rounded-full bg-danger/10">
          <AlertTriangle className="text-danger" size={26} aria-hidden="true" />
        </div>
        <h3 id={titleId} className="mb-2 text-xl font-bold text-ink">{title}</h3>
        <p className="mb-7 text-[15px] leading-relaxed text-muted whitespace-pre-line break-words">{message}</p>
        <div className="flex gap-3">
          <button
            ref={cancelRef}
            type="button"
            onClick={onCancel}
            className="min-h-12 flex-1 rounded-full border border-line text-[15px] text-ink transition-colors hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            {cancelText}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="min-h-12 flex-1 rounded-full bg-danger text-[15px] font-medium text-white dark:text-ground transition-[filter,transform] hover:brightness-110 active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-danger"
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ConfirmDialog;
