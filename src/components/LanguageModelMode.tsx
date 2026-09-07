import React, { useState } from 'react';
import LanguageModelListView from './LanguageModelListView';
import LanguageModelDetailView from './LanguageModelDetailView';
import TodayReviewView from './TodayReviewView';

export default function LanguageModelMode() {
    const [currentView, setCurrentView] = useState<'list' | 'detail'>('list');
    const [activeTab, setActiveTab] = useState<'review' | 'library'>('review');
    const [selectedPatternId, setSelectedPatternId] = useState<string | null>(null);

    if (currentView === 'detail' && selectedPatternId) {
        return (
            <LanguageModelDetailView 
                patternId={selectedPatternId} 
                onBack={() => setCurrentView('list')} 
            />
        );
    }

    return (
        <div className="flex flex-col h-full bg-slate-50 dark:bg-slate-950">
            <div className="px-6 pt-6 pb-2">
                <div className="flex bg-slate-200/50 dark:bg-slate-800/50 p-1 rounded-xl">
                    <button
                        onClick={() => setActiveTab('review')}
                        className={`flex-1 py-2 text-sm font-bold rounded-lg transition-all ${
                            activeTab === 'review'
                                ? 'bg-white dark:bg-slate-700 text-indigo-600 dark:text-indigo-400 shadow-sm'
                                : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
                        }`}
                    >
                        今日複習
                    </button>
                    <button
                        onClick={() => setActiveTab('library')}
                        className={`flex-1 py-2 text-sm font-bold rounded-lg transition-all ${
                            activeTab === 'library'
                                ? 'bg-white dark:bg-slate-700 text-indigo-600 dark:text-indigo-400 shadow-sm'
                                : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
                        }`}
                    >
                        句型庫
                    </button>
                </div>
            </div>
            
            <div className="flex-1 overflow-hidden">
                {activeTab === 'review' ? (
                    <TodayReviewView />
                ) : (
                    <LanguageModelListView 
                        onPatternClick={(id) => {
                            setSelectedPatternId(id);
                            setCurrentView('detail');
                        }} 
                    />
                )}
            </div>
        </div>
    );
}
