import React, { useState } from 'react';
import LanguageModelListView from './LanguageModelListView';
import LanguageModelDetailView from './LanguageModelDetailView';
import TodayReviewView from './TodayReviewView';
import SegmentedControl from './ui/SegmentedControl';

export interface PatternFilterState {
    search: string;
    category: 'all' | 'structural' | 'phrase' | 'collocation';
    primaryCategory: string;
    situationTag: string | null;
}

const TAB_OPTIONS = [
    { value: 'review', label: '今日複習' },
    { value: 'library', label: '句型庫' },
] as const;

const defaultFilters: PatternFilterState = {
    search: '',
    category: 'all',
    primaryCategory: 'all',
    situationTag: null
};

export default function LanguageModelMode() {
    const [currentView, setCurrentView] = useState<'list' | 'detail'>('list');
    const [activeTab, setActiveTab] = useState<'review' | 'library'>('review');
    const [selectedPatternId, setSelectedPatternId] = useState<string | null>(null);
    const [filters, setFilters] = useState<PatternFilterState>(defaultFilters);

    const tabs = (
        <SegmentedControl
            label="語言模型"
            options={TAB_OPTIONS}
            value={activeTab}
            onChange={setActiveTab}
            className="w-full sm:w-auto sm:min-w-[240px]"
        />
    );

    if (currentView === 'detail' && selectedPatternId) {
        return (
            <LanguageModelDetailView
                patternId={selectedPatternId}
                onBack={() => setCurrentView('list')}
            />
        );
    }

    if (activeTab === 'review') {
        return <TodayReviewView tabs={tabs} />;
    }

    return (
        <LanguageModelListView
            tabs={tabs}
            onPatternClick={(id) => {
                setSelectedPatternId(id);
                setCurrentView('detail');
            }}
            filters={filters}
            onFiltersChange={setFilters}
        />
    );
}
