import React from 'react';
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
  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 backdrop-blur-sm p-4 animate-in fade-in duration-200">
      <div className="bg-white dark:bg-slate-900 rounded-[2rem] p-8 w-full max-w-xs shadow-2xl animate-in zoom-in-95 duration-200 text-center border border-slate-100 dark:border-slate-800">
        <div className="w-16 h-16 bg-red-50 dark:bg-red-900/20 rounded-full flex items-center justify-center mx-auto mb-6">
          <AlertTriangle className="text-red-500 dark:text-red-400" size={32} />
        </div>
        <h3 className="text-2xl font-black text-slate-800 dark:text-white mb-2">{title}</h3>
        <p className="text-slate-500 dark:text-slate-400 mb-8 leading-relaxed whitespace-pre-line break-words">{message}</p>
        <div className="flex gap-4">
          <button 
            onClick={onCancel} 
            className="flex-1 py-3.5 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 font-bold rounded-2xl hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
          >
            {cancelText}
          </button>
          <button 
            onClick={onConfirm} 
            className="flex-1 py-3.5 bg-red-500 text-white font-bold rounded-2xl shadow-lg shadow-red-200 dark:shadow-none hover:bg-red-600 transition-all active:scale-95"
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ConfirmDialog;
