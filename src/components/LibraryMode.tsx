import React, { useState, useMemo } from 'react';
import { 
  Folder, Plus, Trash2, Search, Edit, ArrowLeft, FolderPlus, Layers, Loader2, Eye, EyeOff, Check, AlertTriangle, Save, ChevronRight, Mic, Ear, X, Link as LinkIcon, Download
} from 'lucide-react';
import { VocabItem, BADGE_LEVELS, LISTENING_BADGE_LEVELS } from '../constants';
import { fetchIPA, getBadgeInfo } from '../utils';

// 自定義確認對話框組件
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
        <p className="text-slate-500 dark:text-slate-400 mb-8 leading-relaxed">{message}</p>
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

interface Props {
  vocabData: VocabItem[];
  setVocabData: React.Dispatch<React.SetStateAction<VocabItem[]>>;
  courses: string[];
  setCourses: React.Dispatch<React.SetStateAction<string[]>>;
  onSaveItem: (item: VocabItem | VocabItem[]) => void;
  onDeleteItem: (id: number | number[]) => void;
  onSaveCourse: (newName: string, oldName: string | null) => void;
  onDeleteCourse: (name: string) => void;
}

const LibraryMode: React.FC<Props> = ({ vocabData, courses, onSaveItem, onDeleteItem, onSaveCourse, onDeleteCourse }) => {
  const [currentLevel, setCurrentLevel] = useState<'courses' | 'questions'>('courses'); 
  const [activeCourse, setActiveCourse] = useState<string | null>(null);
  const [isEditingCourse, setIsEditingCourse] = useState(false);
  const [courseNameInput, setCourseNameInput] = useState('');
  const [editingCourseName, setEditingCourseName] = useState<string | null>(null);
  const [isEditingQuestion, setIsEditingQuestion] = useState(false);
  const [questionFormData, setQuestionFormData] = useState({ question: '', answer: '', phonetic: '' });
  const [editingQuestionId, setEditingQuestionId] = useState<number | null>(null);
  const [isGeneratingPhonetic, setIsGeneratingPhonetic] = useState(false);
  const [isBulkAdding, setIsBulkAdding] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [bulkText, setBulkText] = useState('');
  const [importUrl, setImportUrl] = useState('');
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [showHidden, setShowHidden] = useState(false);

  // 確認視窗狀態
  const [confirmModal, setConfirmModal] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    onConfirm: () => void;
  }>({
    isOpen: false,
    title: '',
    message: '',
    onConfirm: () => {},
  });

  const closeConfirm = () => setConfirmModal(prev => ({ ...prev, isOpen: false }));

  const saveCourse = () => { if (courseNameInput.trim()) { onSaveCourse(courseNameInput, editingCourseName); setIsEditingCourse(false); } };
  
  const saveQuestion = () => {
      if (!questionFormData.question || !questionFormData.answer || !activeCourse) return;
      const newItem: VocabItem = { 
        ...questionFormData, 
        id: (editingQuestionId as number) || Date.now(), 
        course: activeCourse, 
        mastery: vocabData.find(v => v.id === editingQuestionId)?.mastery || 0, 
        listeningMastery: vocabData.find(v => v.id === editingQuestionId)?.listeningMastery || 0, 
        isHidden: false, 
        type: 'Q&A' 
      };
      onSaveItem(newItem); 
      setIsEditingQuestion(false);
  };

  const fetchFromUrl = async () => {
      if(!importUrl) return;
      setIsProcessing(true);
      try {
          const res = await fetch(importUrl);
          if(!res.ok) throw new Error("Fetch failed");
          const text = await res.text();
          setBulkText(text);
          setImportUrl('');
      } catch (e) {
          alert("無法從 URL 讀取資料，請確認連結是否為公開的 Raw Text (如 GitHub Raw URL)");
      } finally {
          setIsProcessing(false);
      }
  };

  const handleBulkSave = async () => {
    if (!bulkText.trim() || !activeCourse) return;
    setIsProcessing(true);
    const lines = bulkText.split('\n');
    // 使用當前時間作為基準 ID，確保批量新增時 ID 的連續性和順序
    const baseId = Date.now();
    
    try {
      const processedItems = await Promise.all(lines.map(async (line, index) => {
          const trimmedLine = line.trim();
          if (!trimmedLine) return null;
          let parts: string[] = [];
          if (trimmedLine.includes('\t')) parts = trimmedLine.split('\t');
          else if (trimmedLine.includes(' - ')) parts = trimmedLine.split(' - ');
          else if (trimmedLine.includes('-')) parts = trimmedLine.split('-');
          if (parts.length >= 2) {
              const question = parts[0].trim();
              const answer = parts.slice(1).join(' ').trim();
              if (question && answer) {
                  const ipa = await fetchIPA(answer);
                  return { 
                      id: baseId + index, // 強制指定 ID 以確保排序與貼上順序一致
                      course: activeCourse, 
                      question, 
                      answer, 
                      phonetic: ipa ? `/${ipa}/` : '', 
                      type: 'Q&A', 
                      mastery: 0, 
                      listeningMastery: 0, 
                      isHidden: false 
                  };
              }
          }
          return null;
      }));
      const validItems = processedItems.filter((i): i is any => i !== null);
      if (validItems.length > 0) { onSaveItem(validItems); setIsBulkAdding(false); setBulkText(''); }
    } finally { setIsProcessing(false); }
  };

  const toggleSelect = (id: number) => { setSelectedIds(prev => prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]); };
  
  const requestDeleteQuestion = (id: number) => {
    setConfirmModal({ isOpen: true, title: "刪除題目", message: "確定要刪除這張卡片嗎？", onConfirm: () => { onDeleteItem(id); closeConfirm(); } });
  };
  const requestBulkDelete = () => {
    setConfirmModal({ isOpen: true, title: "批量刪除", message: `確定要刪除這 ${selectedIds.length} 個題目嗎？`, onConfirm: () => { onDeleteItem(selectedIds); setSelectedIds([]); closeConfirm(); } });
  };
  const requestDeleteCourse = (courseName: string) => {
    setConfirmModal({ isOpen: true, title: "刪除課程", message: `確定要刪除「${courseName}」嗎？課程內的所有題目也將被移除。`, onConfirm: () => { onDeleteCourse(courseName); closeConfirm(); } });
  };
  const handleBulkHide = () => {
    const itemsToUpdate = vocabData.filter(v => selectedIds.includes(v.id)).map(v => ({ ...v, isHidden: !showHidden }));
    onSaveItem(itemsToUpdate); setSelectedIds([]);
  };

  const filtered = useMemo(() => {
     return vocabData.filter(v => v.course === activeCourse && (showHidden ? v.isHidden : !v.isHidden) && (v.question.includes(searchTerm) || v.answer.includes(searchTerm)));
  }, [vocabData, activeCourse, showHidden, searchTerm]);

  // Helper to calculate progress within the current tier
  const calculateTierProgress = (score: number, currentThreshold: number, nextThreshold: number | undefined) => {
    if (!nextThreshold) return 100; // Max level
    const range = nextThreshold - currentThreshold;
    const progress = score - currentThreshold;
    return Math.max(0, Math.min(100, (progress / range) * 100));
  };

  const handleSelectAll = () => {
    if (selectedIds.length === filtered.length && filtered.length > 0) {
      setSelectedIds([]);
    } else {
      setSelectedIds(filtered.map(i => i.id));
    }
  };

  const isSelectionMode = selectedIds.length > 0;

  return (
      <div className="h-full flex flex-col bg-slate-50 dark:bg-slate-950 relative">
        <ConfirmDialog 
          isOpen={confirmModal.isOpen} 
          title={confirmModal.title} 
          message={confirmModal.message} 
          onConfirm={confirmModal.onConfirm} 
          onCancel={closeConfirm} 
        />

        {/* MODAL: Edit Course */}
        {isEditingCourse && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm p-4"><div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl p-6 w-full max-w-sm border border-slate-100 dark:border-slate-800"><h3 className="text-xl font-bold text-slate-800 dark:text-white mb-4">{editingCourseName ? '重新命名課程' : '新增課程'}</h3><input value={courseNameInput} onChange={(e) => setCourseNameInput(e.target.value)} className="w-full p-3 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl mb-6 outline-none focus:ring-2 focus:ring-indigo-500 text-slate-900 dark:text-white" placeholder="輸入課程名稱..." autoFocus /><div className="flex gap-3"><button onClick={() => setIsEditingCourse(false)} className="flex-1 py-3 text-slate-500 dark:text-slate-400 font-bold bg-slate-100 dark:bg-slate-800 rounded-xl">取消</button><button onClick={saveCourse} className="flex-1 py-3 text-white font-bold bg-indigo-600 rounded-xl">確認</button></div></div></div>
        )}

        {/* MODAL: Bulk Add Questions */}
        {isBulkAdding && (
            <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 backdrop-blur-sm p-4 animate-in fade-in duration-200">
                <div className="bg-white dark:bg-slate-900 rounded-2xl w-full max-w-lg shadow-2xl flex flex-col overflow-hidden animate-in zoom-in-95 duration-200 border border-slate-100 dark:border-slate-800 max-h-[90vh]">
                    <div className="px-6 py-4 border-b border-slate-100 dark:border-slate-800 flex justify-between items-center">
                        <h3 className="text-xl font-black text-slate-800 dark:text-white flex items-center gap-2">
                            <Layers className="text-indigo-600 dark:text-indigo-400" size={24} /> 批量新增題目
                        </h3>
                        <button onClick={() => setIsBulkAdding(false)} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors bg-slate-100 dark:bg-slate-800 p-2 rounded-full">
                            <X size={20} />
                        </button>
                    </div>
                    
                    <div className="p-6 overflow-y-auto">
                         <div className="bg-indigo-50 dark:bg-indigo-900/20 p-5 rounded-xl mb-6 text-sm text-indigo-900 dark:text-indigo-100 leading-relaxed border border-indigo-100 dark:border-indigo-900/30">
                            <p className="font-bold mb-3 text-indigo-700 dark:text-indigo-300">使用說明：</p>
                            <ul className="list-disc list-outside ml-4 space-y-2 opacity-90">
                                <li>請直接複製貼上您的單字列表（例如從 Excel 或 Quizlet）。</li>
                                <li>格式要求：<span className="bg-white dark:bg-indigo-950 px-1.5 py-0.5 rounded border border-indigo-200 dark:border-indigo-800 font-mono text-xs font-bold mx-1 text-indigo-600 dark:text-indigo-400">題目 [Tab] 答案</span> 或 <span className="bg-white dark:bg-indigo-950 px-1.5 py-0.5 rounded border border-indigo-200 dark:border-indigo-800 font-mono text-xs font-bold mx-1 text-indigo-600 dark:text-indigo-400">題目 - 答案</span></li>
                                <li>每一行代表一個新題目，系統將自動產生音標。</li>
                            </ul>
                        </div>

                        {/* Import from URL */}
                        <div className="mb-4 flex gap-2">
                             <div className="relative flex-1">
                                <LinkIcon className="absolute left-3 top-3.5 text-slate-400" size={16} />
                                <input 
                                    value={importUrl}
                                    onChange={(e) => setImportUrl(e.target.value)}
                                    className="w-full pl-10 pr-4 py-3 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-sm outline-none focus:ring-2 focus:ring-indigo-500 text-slate-900 dark:text-white"
                                    placeholder="貼上 URL (例如 GitHub Raw JSON/Text)"
                                />
                             </div>
                             <button 
                                onClick={fetchFromUrl}
                                disabled={!importUrl || isProcessing}
                                className="px-4 py-3 bg-slate-800 dark:bg-slate-700 text-white rounded-xl hover:bg-slate-900 dark:hover:bg-slate-600 transition-colors disabled:opacity-50 font-bold flex items-center gap-2"
                             >
                                 {isProcessing ? <Loader2 className="animate-spin" size={16} /> : <Download size={16} />}
                                 載入
                             </button>
                        </div>

                        <div className="relative">
                           <textarea 
                             value={bulkText} 
                             onChange={(e) => setBulkText(e.target.value)} 
                             placeholder={`Question 1   Answer 1\nQuestion 2   Answer 2\n題目 A - 答案 A`} 
                             className="w-full h-48 p-4 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-sm outline-none focus:ring-2 focus:ring-indigo-500 resize-none text-slate-900 dark:text-white font-mono leading-relaxed" 
                           />
                        </div>
                    </div>

                    <div className="px-6 py-4 border-t border-slate-100 dark:border-slate-800 flex gap-3 bg-slate-50/50 dark:bg-slate-900/50">
                        <button 
                            onClick={() => setIsBulkAdding(false)} 
                            className="flex-1 py-3 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 font-bold rounded-xl hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
                        >
                            取消
                        </button>
                        <button 
                            onClick={handleBulkSave} 
                            disabled={isProcessing || !bulkText.trim()} 
                            className="flex-1 py-3 bg-indigo-600 text-white font-bold rounded-xl shadow-lg shadow-indigo-200 dark:shadow-none hover:bg-indigo-700 transition-all flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            {isProcessing ? <Loader2 className="animate-spin" size={18} /> : <Save size={18} />} 開始匯入
                        </button>
                    </div>
                </div>
            </div>
        )}

        {/* Main Content */}
        <div className="flex-1 overflow-hidden flex flex-col">
            <div className="p-4 bg-white dark:bg-slate-900 border-b border-slate-100 dark:border-slate-800 flex justify-between items-center shadow-sm z-10 min-h-[72px]">
                <div className="flex items-center gap-3">
                    {currentLevel === 'questions' && (
                        <button onClick={() => { setCurrentLevel('courses'); setActiveCourse(null); }} className="p-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-full transition-colors">
                            <ArrowLeft size={20} className="text-slate-500 dark:text-slate-400" />
                        </button>
                    )}
                    <h2 className="text-xl font-black text-slate-800 dark:text-white tracking-tight flex items-center gap-2">
                        {currentLevel === 'courses' ? <><Folder className="text-indigo-600 dark:text-indigo-400" /> 題庫管理</> : <span className="truncate max-w-[150px]">{activeCourse}</span>}
                    </h2>
                </div>
                <div className="flex gap-2">
                    {currentLevel === 'courses' && (
                        <button onClick={() => { setCourseNameInput(''); setEditingCourseName(null); setIsEditingCourse(true); }} className="p-2 bg-indigo-50 dark:bg-indigo-900/20 text-indigo-600 dark:text-indigo-400 rounded-xl font-bold flex items-center gap-2 text-xs hover:bg-indigo-100 dark:hover:bg-indigo-900/40 transition-colors">
                            <Plus size={16} /> <span className="hidden sm:inline">新增課程</span>
                        </button>
                    )}
                     {currentLevel === 'questions' && (
                        <div className="flex items-center gap-1">
                             <span className="text-xs font-bold text-slate-300 dark:text-slate-600 bg-slate-100 dark:bg-slate-800 px-2 py-1 rounded-md">{filtered.length}</span>
                        </div>
                    )}
                </div>
            </div>

            <div className="flex-1 overflow-y-auto bg-slate-50 dark:bg-slate-950">
                {currentLevel === 'courses' ? (
                    <div className="grid grid-cols-1 gap-4 p-4 pb-20">
                        {courses.map(course => {
                            const count = vocabData.filter(v => v.course === course).length;
                            return (
                                <div key={course} onClick={() => { setActiveCourse(course); setCurrentLevel('questions'); }} className="bg-white dark:bg-slate-900 p-5 rounded-2xl shadow-sm border border-slate-100 dark:border-slate-800 flex items-center justify-between group hover:border-indigo-200 dark:hover:border-indigo-800 transition-all cursor-pointer">
                                    <div className="flex items-center gap-4">
                                        <div className="p-3 bg-indigo-50 dark:bg-indigo-900/30 rounded-xl text-indigo-600 dark:text-indigo-400 group-hover:bg-indigo-600 group-hover:text-white transition-colors">
                                            <Folder size={24} />
                                        </div>
                                        <div>
                                            <h3 className="font-bold text-slate-800 dark:text-white text-lg">{course}</h3>
                                            <p className="text-slate-400 dark:text-slate-500 text-xs font-bold">{count} 個題目</p>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
                                        <button onClick={() => { setEditingCourseName(course); setCourseNameInput(course); setIsEditingCourse(true); }} className="p-2 text-slate-300 hover:text-indigo-500 transition-colors"><Edit size={18} /></button>
                                        <button onClick={() => requestDeleteCourse(course)} className="p-2 text-slate-300 hover:text-red-500 transition-colors"><Trash2 size={18} /></button>
                                        <ChevronRight className="text-slate-200 dark:text-slate-700 ml-2" />
                                    </div>
                                </div>
                            );
                        })}
                        {courses.length === 0 && (
                            <div className="text-center py-20 text-slate-400 dark:text-slate-500">
                                <FolderPlus size={48} className="mx-auto mb-4 opacity-20" />
                                <p>尚未建立任何課程</p>
                            </div>
                        )}
                    </div>
                ) : (
                    <div className="pb-20 relative">
                        {/* Dynamic Header */}
                        <div className="sticky top-0 bg-slate-50 dark:bg-slate-950 z-20 pt-2 pb-2 px-4 shadow-sm space-y-2">
                             <div className="flex gap-2 h-12">
                                {/* Left: Select All Checkbox */}
                                <button 
                                  onClick={handleSelectAll} 
                                  className="w-12 h-12 shrink-0 flex items-center justify-center rounded-xl hover:bg-slate-200/50 dark:hover:bg-slate-800/50 transition-colors"
                                >
                                  <div className={`w-6 h-6 rounded-lg border-2 flex items-center justify-center transition-all ${
                                     selectedIds.length > 0
                                     ? 'bg-indigo-600 border-indigo-600 text-white' 
                                     : 'border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900'
                                  }`}>
                                      <Check size={14} strokeWidth={3} className={`transition-opacity ${selectedIds.length > 0 ? 'opacity-100' : 'opacity-0'}`} />
                                  </div>
                                </button>

                                {isSelectionMode ? (
                                    <>
                                        <button onClick={requestBulkDelete} className="flex-1 bg-red-50 dark:bg-red-900/20 border border-red-100 dark:border-red-900/50 rounded-xl flex items-center justify-center gap-2 text-red-600 dark:text-red-400 font-bold animate-in fade-in slide-in-from-right-4 duration-200">
                                            <Trash2 size={18} /> 刪除 ({selectedIds.length})
                                        </button>
                                        <button onClick={handleBulkHide} className="flex-1 bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl flex items-center justify-center gap-2 text-slate-600 dark:text-slate-300 font-bold animate-in fade-in slide-in-from-right-8 duration-200">
                                            {showHidden ? <Eye size={18} /> : <EyeOff size={18} />} {showHidden ? '顯示' : '隱藏'}
                                        </button>
                                    </>
                                ) : (
                                    <>
                                        <div className="flex-1 relative">
                                            <Search className="absolute left-3 top-3.5 text-slate-400" size={18} />
                                            <input 
                                                value={searchTerm} 
                                                onChange={(e) => setSearchTerm(e.target.value)} 
                                                placeholder="搜尋題目..." 
                                                className="w-full h-12 pl-10 pr-4 bg-slate-100 dark:bg-slate-900 border-none rounded-xl text-sm outline-none focus:ring-2 focus:ring-indigo-500 text-slate-700 dark:text-slate-200 placeholder:font-bold placeholder:text-slate-400" 
                                            />
                                        </div>
                                        <button onClick={() => setShowHidden(!showHidden)} className={`w-12 h-12 shrink-0 rounded-xl border border-slate-200 dark:border-slate-700 flex items-center justify-center transition-colors ${showHidden ? 'bg-indigo-600 text-white border-transparent' : 'bg-white dark:bg-slate-900 text-slate-400'}`}>
                                             {showHidden ? <Eye size={20} /> : <EyeOff size={20} />}
                                        </button>
                                        <button onClick={() => setIsBulkAdding(true)} className={`w-12 h-12 shrink-0 rounded-xl border border-slate-200 dark:border-slate-700 flex items-center justify-center transition-colors bg-white dark:bg-slate-900 text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400`}>
                                            <Layers size={20} />
                                        </button>
                                         <button onClick={() => { setEditingQuestionId(null); setQuestionFormData({ question: '', answer: '', phonetic: '' }); setIsEditingQuestion(true); }} className="w-12 h-12 shrink-0 rounded-xl bg-indigo-600 text-white flex items-center justify-center shadow-lg shadow-indigo-200 dark:shadow-none hover:bg-indigo-700 transition-colors">
                                            <Plus size={24} />
                                        </button>
                                    </>
                                )}
                             </div>
                        </div>

                        {/* List */}
                        <div className="space-y-3 p-4 pt-0">
                            {filtered.map((item, index) => {
                                const speakInfo = getBadgeInfo(item.mastery, BADGE_LEVELS);
                                const listenInfo = getBadgeInfo(item.listeningMastery, LISTENING_BADGE_LEVELS);
                                
                                const speakProgress = calculateTierProgress(item.mastery, speakInfo.currentBadge.threshold, speakInfo.nextBadge?.threshold);
                                const listenProgress = calculateTierProgress(item.listeningMastery, listenInfo.currentBadge.threshold, listenInfo.nextBadge?.threshold);
                                const isSelected = selectedIds.includes(item.id);

                                return (
                                <div key={item.id} className={`bg-white dark:bg-slate-900 p-4 rounded-2xl border ${isSelected ? 'border-indigo-500 ring-1 ring-indigo-500' : 'border-slate-100 dark:border-slate-800'} shadow-sm relative group transition-all`}>
                                    <div className="flex justify-between items-start mb-3 gap-3">
                                         <div className="flex gap-3 flex-1 min-w-0">
                                             <div onClick={() => toggleSelect(item.id)} className={`w-6 h-6 mt-1 rounded-lg border-2 flex items-center justify-center cursor-pointer transition-all flex-shrink-0 ${isSelected ? 'bg-indigo-600 border-indigo-600 text-white' : 'border-slate-200 dark:border-slate-700 hover:border-indigo-400'}`}>
                                                {isSelected && <Check size={14} strokeWidth={3} />}
                                            </div>
                                            <div className="flex-1 min-w-0 cursor-pointer" onClick={() => { setEditingQuestionId(item.id); setQuestionFormData({ question: item.question, answer: item.answer, phonetic: item.phonetic }); setIsEditingQuestion(true); }}>
                                                <h4 className={`text-base font-bold text-slate-800 dark:text-slate-100 leading-snug mb-1.5 ${item.isHidden ? 'line-through opacity-50 decoration-2 decoration-slate-300' : ''}`}>
                                                    <span className="text-slate-300 dark:text-slate-600 font-mono text-sm mr-2 select-none">{index + 1}.</span>
                                                    {item.question}
                                                </h4>
                                                <p className="text-sm font-medium text-indigo-600 dark:text-indigo-400 font-mono leading-relaxed break-words">
                                                    {item.answer}
                                                </p>
                                            </div>
                                         </div>
                                         <div className="flex items-center gap-1 shrink-0 ml-0">
                                             <button onClick={() => { setEditingQuestionId(item.id); setQuestionFormData({ question: item.question, answer: item.answer, phonetic: item.phonetic }); setIsEditingQuestion(true); }} className="p-2 text-slate-300 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors">
                                                <Edit size={18} />
                                            </button>
                                            <button onClick={() => requestDeleteQuestion(item.id)} className="p-2 text-slate-300 hover:text-red-500 transition-colors">
                                                <Trash2 size={18} />
                                            </button>
                                        </div>
                                    </div>

                                    {/* Progress Bars */}
                                    <div className="grid grid-cols-2 gap-4 border-t border-slate-100 dark:border-slate-800 pt-4">
                                        {/* Speaking */}
                                        <div>
                                            <div className="flex justify-between items-end mb-1.5">
                                                <span className="text-xs font-bold text-slate-500 dark:text-slate-400">口說: {item.mastery}</span>
                                                <span className={`text-[10px] font-bold ${speakInfo.currentBadge.color}`}>{speakInfo.currentBadge.name}</span>
                                            </div>
                                            <div className="h-1.5 w-full bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                                                <div className="h-full bg-emerald-500 rounded-full transition-all duration-500 ease-out" style={{width: `${speakProgress}%`}}></div>
                                            </div>
                                        </div>
                                        {/* Listening */}
                                        <div>
                                            <div className="flex justify-between items-end mb-1.5">
                                                <span className="text-xs font-bold text-slate-500 dark:text-slate-400">聽力: {item.listeningMastery}</span>
                                                <span className={`text-[10px] font-bold ${listenInfo.currentBadge.color}`}>{listenInfo.currentBadge.name}</span>
                                            </div>
                                            <div className="h-1.5 w-full bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                                                <div className="h-full bg-orange-500 rounded-full transition-all duration-500 ease-out" style={{width: `${listenProgress}%`}}></div>
                                            </div>
                                        </div>
                                    </div>
                                    
                                     {item.isHidden && (
                                        <div className="absolute top-4 right-10 flex items-center gap-1 text-[10px] font-black uppercase text-slate-400 dark:text-slate-600 bg-slate-100 dark:bg-slate-800 px-2 py-1 rounded-md">
                                            <EyeOff size={12} /> Hidden
                                        </div>
                                    )}
                                </div>
                            )})}
                        </div>
                    </div>
                )}
            </div>
        </div>

        {/* MODAL: Edit Question */}
        {isEditingQuestion && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm p-4">
                <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl p-6 w-full max-w-sm border border-slate-100 dark:border-slate-800">
                    <h3 className="text-xl font-bold text-slate-800 dark:text-white mb-4">{editingQuestionId ? '編輯題目' : '新增題目'}</h3>
                    <div className="space-y-3 mb-6">
                        <div>
                            <label className="text-xs font-bold text-slate-500 dark:text-slate-400 mb-1 block">題目 (正面)</label>
                            <input value={questionFormData.question} onChange={(e) => setQuestionFormData({...questionFormData, question: e.target.value})} className="w-full p-3 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl outline-none focus:ring-2 focus:ring-indigo-500 text-slate-900 dark:text-white" placeholder="輸入單字或句子..." autoFocus />
                        </div>
                        <div>
                            <label className="text-xs font-bold text-slate-500 dark:text-slate-400 mb-1 block">答案 (背面)</label>
                            <textarea value={questionFormData.answer} onChange={(e) => setQuestionFormData({...questionFormData, answer: e.target.value})} className="w-full p-3 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl outline-none focus:ring-2 focus:ring-indigo-500 text-slate-900 dark:text-white resize-none" rows={3} placeholder="輸入翻譯或解釋..." />
                        </div>
                         <div>
                            <div className="flex justify-between items-center mb-1">
                                <label className="text-xs font-bold text-slate-500 dark:text-slate-400 block">音標 (選填)</label>
                                <button onClick={async () => { if(!questionFormData.answer) return; setIsGeneratingPhonetic(true); const ipa = await fetchIPA(questionFormData.answer); setQuestionFormData(prev => ({...prev, phonetic: ipa ? `/${ipa}/` : ''})); setIsGeneratingPhonetic(false); }} disabled={isGeneratingPhonetic || !questionFormData.answer} className="text-[10px] text-indigo-500 font-bold hover:underline disabled:opacity-50">
                                    {isGeneratingPhonetic ? '生成中...' : '自動生成'}
                                </button>
                            </div>
                            <input value={questionFormData.phonetic} onChange={(e) => setQuestionFormData({...questionFormData, phonetic: e.target.value})} className="w-full p-3 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl outline-none focus:ring-2 focus:ring-indigo-500 text-slate-900 dark:text-white font-mono text-sm" placeholder="/.../" />
                        </div>
                    </div>
                    <div className="flex gap-3">
                        <button onClick={() => setIsEditingQuestion(false)} className="flex-1 py-3 text-slate-500 dark:text-slate-400 font-bold bg-slate-100 dark:bg-slate-800 rounded-xl">取消</button>
                        <button onClick={saveQuestion} className="flex-1 py-3 text-white font-bold bg-indigo-600 rounded-xl hover:bg-indigo-700">儲存</button>
                    </div>
                </div>
            </div>
        )}

      </div>
  );
};

export default LibraryMode;