import React from 'react';
import { LanguagePattern } from '../types';
import { ChevronLeft, Lock, Unlock, CheckCircle2 } from 'lucide-react';
import { isGroupUnlocked } from '../utils/groupUnlock';

interface Props {
  pattern: LanguagePattern;
  onBack: () => void;
  onSelectGroup: (groupIndex: number) => void;
}

export default function GroupSelectionView({ pattern, onBack, onSelectGroup }: Props) {
  const groups = Array.from({ length: 10 }, (_, i) => i);
  
  return (
    <div className="flex flex-col h-full bg-slate-50 dark:bg-slate-950 p-6 overflow-y-auto pb-20">
      <div className="flex items-center gap-4 mb-8">
        <button 
          onClick={onBack}
          className="p-2 bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 rounded-full shadow-sm hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
        >
          <ChevronLeft size={24} />
        </button>
        <div>
          <h2 className="text-xl font-black text-slate-800 dark:text-white line-clamp-1">
             選擇造句組別
          </h2>
          <p className="text-sm font-bold text-slate-500 dark:text-slate-400">
             {pattern.text}
          </p>
        </div>
      </div>
      
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {groups.map(groupIndex => {
          const unlocked = isGroupUnlocked(pattern, groupIndex);
          const groupSentences = (pattern.exampleSentences || []).filter(s => s.groupIndex === groupIndex);
          const completedCount = groupSentences.filter(s => s.checked && (s.mastery || 0) >= 1000).length;
          const isCompleted = groupSentences.length === 10 && completedCount === 10;
          
          return (
            <button
              key={groupIndex}
              onClick={() => unlocked && onSelectGroup(groupIndex)}
              disabled={!unlocked}
              className={`relative flex flex-col p-5 rounded-2xl border text-left transition-all ${
                unlocked 
                  ? 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 hover:border-indigo-400 dark:hover:border-indigo-600 shadow-sm cursor-pointer' 
                  : 'bg-slate-100/50 dark:bg-slate-950/50 border-slate-200 dark:border-slate-800 opacity-60 cursor-not-allowed'
              }`}
            >
              <div className="flex justify-between items-start mb-4">
                <span className={`font-black text-lg ${unlocked ? 'text-slate-800 dark:text-slate-100' : 'text-slate-500'}`}>
                  第 {groupIndex + 1} 組
                </span>
                {unlocked ? (
                  isCompleted ? (
                    <CheckCircle2 size={20} className="text-emerald-500" />
                  ) : (
                    <Unlock size={20} className="text-indigo-400" />
                  )
                ) : (
                  <Lock size={20} className="text-slate-400" />
                )}
              </div>
              
              {unlocked ? (
                <div className="text-sm font-bold text-slate-500">
                  已完成：<span className={completedCount === 10 ? 'text-emerald-500' : 'text-indigo-500'}>{completedCount}</span> / 10 句
                </div>
              ) : (
                <div className="text-sm font-bold text-slate-400">
                  完成上一組才能解鎖
                </div>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
