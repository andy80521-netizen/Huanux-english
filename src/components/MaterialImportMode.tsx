import React, { useState, useRef, useEffect } from 'react';
import { FileText, Headphones, AlertCircle, Loader2, Upload, CheckCircle, Volume2, Sparkles, FolderOpen } from 'lucide-react';
import { splitTextToSentences, generateSpeechForSentences, transcribeAudioWithTimestamps, extractPatternsFromText } from '../services/gemini';
import { extractTextFromPdf } from '../utils/pdfExtract';
import { auth, db, storage, appId } from '../firebase';
import { onAuthStateChanged } from 'firebase/auth';
import { INITIAL_COURSES, INITIAL_DATA, VocabItem } from '../constants';
import { doc, setDoc, collection, onSnapshot, query, orderBy, getDoc } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { Material } from '../types';
import MaterialReviewPanel, { ReviewSentence } from './MaterialReviewPanel';
import MaterialListView from './MaterialListView';
import MaterialDetailView from './MaterialDetailView';
import { ChevronLeft } from 'lucide-react';

export type PendingMaterial = {
    source: 'upload' | 'tts';
    audioFile?: File;
    audioBlob?: Blob;
    fileName: string;
    sentences: ReviewSentence[];
};



export default function MaterialImportMode() {
    const [currentView, setCurrentView] = useState<'list' | 'import' | 'detail'>('list');
    const [selectedMaterial, setSelectedMaterial] = useState<string | null>(null);
    const [loadingState, setLoadingState] = useState<'idle' | 'processing' | 'uploading' | 'analyzing' | 'generating' | 'timestamping'>('idle');
    const [timestampWarning, setTimestampWarning] = useState(false);
    const [lowConfidenceTimestamps, setLowConfidenceTimestamps] = useState(false);
    const [pendingMaterial, setPendingMaterial] = useState<PendingMaterial | null>(null);
        const [ttsProgress, setTtsProgress] = useState<{ current: number; total: number } | null>(null);
    const [saveSuccess, setSaveSuccess] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [textInput, setTextInput] = useState('');
    const [importTitle, setImportTitle] = useState('文字匯入教材');
    const [isExtracting, setIsExtracting] = useState(false);
    const [extractSuccessMsg, setExtractSuccessMsg] = useState<string | null>(null);
    const [courses, setCourses] = useState<string[]>([]);
    const [vocabData, setVocabData] = useState<VocabItem[]>([]);
    const [selectedCourses, setSelectedCourses] = useState<string[]>([]);

    useEffect(() => {
        const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
            if (!currentUser) {
                const localData = localStorage.getItem('guest_vocab');
                const localCourses = localStorage.getItem('guest_courses');
                setCourses(localCourses ? JSON.parse(localCourses) : INITIAL_COURSES);
                if (localData) {
                    try {
                        setVocabData(JSON.parse(localData));
                    } catch(e) {
                        setVocabData(INITIAL_DATA);
                    }
                } else {
                    setVocabData(INITIAL_DATA);
                }
                return;
            }

            let unsubscribeItems: () => void = () => {};
            let unsubscribeProfile: () => void = () => {};
            
            try {
                const profileRef = doc(db, 'artifacts', appId, 'users', currentUser.uid, 'profile', 'settings');
                const profileSnap = await getDoc(profileRef);
                if (profileSnap.exists()) {
                    const data = profileSnap.data();
                    if (data.courses) setCourses(data.courses);
                } else {
                    setCourses(INITIAL_COURSES);
                }

                unsubscribeProfile = onSnapshot(profileRef, (docSnap) => {
                    if (docSnap.exists()) {
                        const data = docSnap.data();
                        if (data.courses) setCourses(data.courses);
                    }
                }, (error) => {
                    console.error('[監聽來源:MaterialImportMode-profileSettings]', error);
                });

                const itemsRef = collection(db, 'artifacts', appId, 'users', currentUser.uid, 'flashcards');
                const q = query(itemsRef, orderBy('createdAt', 'desc'));
                
                unsubscribeItems = onSnapshot(q, (snapshot) => {
                    const items: VocabItem[] = [];
                    snapshot.forEach((doc) => {
                        items.push({ id: Number(doc.id), ...doc.data() } as VocabItem);
                    });
                    setVocabData(items);
                }, (error) => {
                    console.error('[監聽來源:MaterialImportMode-flashcards]', error);
                });

            } catch (e) {
                console.error(e);
            }
            
            return () => {
                unsubscribeItems();
                unsubscribeProfile();
            };
        });

        return () => unsubscribe();
    }, []);

    const [results, setResults] = useState<{ text: string; translation: string; lowConfidence?: boolean }[]>([]);

    const fileInputRef = useRef<HTMLInputElement>(null);
    const audioInputRef = useRef<HTMLInputElement>(null);

    const handleError = (e: any) => {
        setLoadingState('idle');
        setError(e.message || '發生未知的錯誤');
        console.error(e);
    };

    
    const handleExtractPatterns = async () => {
        if (!auth.currentUser) {
            setError("請先登入");
            return;
        }
        if (results.length === 0) return;

        setIsExtracting(true);
        setError(null);
        setExtractSuccessMsg(null);

        try {
            const fullText = results.map(r => r.text).join(' ');
            const patterns = await extractPatternsFromText(fullText);
            
            const sourceLabel = fullText.length > 20 ? fullText.substring(0, 20) + '...' : fullText;
            
            const promises = patterns.map(pattern => {
                const docRef = doc(collection(db, `artifacts/${appId}/users/${auth.currentUser!.uid}/languagePatterns`));
                return setDoc(docRef, {
                    ...pattern,
                    id: docRef.id,
                    sourceLabel,
                    exampleSentences: [],
                    unlockedGroups: 0
                });
            });

            await Promise.all(promises);
            setExtractSuccessMsg(`成功萃取出 ${patterns.length} 個句型！`);
        } catch (e: any) {
            setError(e.message || '萃取失敗');
        } finally {
            setIsExtracting(false);
        }
    };

    
    const handleLibrarySubmit = () => {
        if (selectedCourses.length === 0) return;
        setLoadingState('processing');
        setError(null);
        setResults([]);
        setSaveSuccess(false);

        const filteredVocabs = vocabData.filter(v => selectedCourses.includes(v.course));
        
        const newResults = filteredVocabs.map(v => ({
            text: v.answer,
            translation: v.question
        }));
        
        setImportTitle(selectedCourses.join(', '));
        setResults(newResults);
        setLoadingState('idle');
    };

    const handleTextSubmit = async () => {
        setImportTitle('文字匯入教材');
        if (!textInput.trim()) return;
        setLoadingState('processing');
        setError(null);
        setResults([]);
        setSaveSuccess(false);
        
        try {
            const res = await splitTextToSentences(textInput);
            setResults(res);
        } catch (e: any) {
            handleError(e);
        } finally {
            setLoadingState('idle');
        }
    };

    const handlePdfOrTxtUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        setImportTitle('文字匯入教材');
        const file = e.target.files?.[0];
        if (!file) return;
        
        setLoadingState('processing');
        setError(null);
        setResults([]);
        setSaveSuccess(false);
        
        try {
            let extractedText = '';
            if (file.name.toLowerCase().endsWith('.pdf')) {
                extractedText = await extractTextFromPdf(file);
            } else if (file.name.toLowerCase().endsWith('.txt')) {
                extractedText = await file.text();
            } else {
                throw new Error("不支援的檔案格式，請上傳 .txt 或 .pdf");
            }
            
            setTextInput(extractedText);
            const res = await splitTextToSentences(extractedText);
            setResults(res);
        } catch (e: any) {
            handleError(e);
        } finally {
            setLoadingState('idle');
            if (fileInputRef.current) fileInputRef.current.value = '';
        }
    };

    
    
    
    const handleAudioUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        
        const uid = auth.currentUser?.uid;
        if (!uid) {
            setError("請先登入");
            return;
        }

        setLoadingState('transcribing'); // Changed from uploading
        setError(null);
        setResults([]);
        setSaveSuccess(false);
        setTimestampWarning(false);
        setLowConfidenceTimestamps(false);
        
        try {
            const result = await transcribeAudioWithTimestamps(file);
            
            const pendingSentences = result.map(r => ({
                text: r.text,
                translation: r.translation,
                startTime: r.startTime,
                endTime: r.endTime,
                needsReview: r.needsReview
            }));

            setPendingMaterial({
                source: 'upload',
                audioFile: file,
                fileName: file.name,
                sentences: pendingSentences
            });
            
        } catch (e: any) {
            console.error("處理音檔失敗:", e);
            handleError(e);
        } finally {
            setLoadingState('idle');
            if (audioInputRef.current) audioInputRef.current.value = '';
        }
    };
    const handleGenerate = async () => {
        const uid = auth.currentUser?.uid;
        if (!uid) {
            setError("請先登入");
            return;
        }
        setLoadingState('generating');
        setError(null);
        setTtsProgress({ current: 0, total: results.length });
        setSaveSuccess(false);

        try {
            const { audioBlob, sentencesWithTiming } = await generateSpeechForSentences(results, (current, total) => {
                setTtsProgress({ current, total });
            });

            const pendingSentences = results.map((r, i) => ({
                text: r.text,
                translation: r.translation,
                startTime: sentencesWithTiming[i].startTime,
                endTime: sentencesWithTiming[i].endTime
            }));

            setPendingMaterial({
                source: 'tts',
                audioBlob: audioBlob,
                fileName: importTitle,
                sentences: pendingSentences
            });

        } catch (e: any) {
            handleError(e);
        } finally {
            setLoadingState('idle');
            setTtsProgress(null);
        }
    };

    const confirmAndSaveMaterial = async (finalSentences: ReviewSentence[]) => {
        if (!pendingMaterial) return;
        const uid = auth.currentUser?.uid;
        if (!uid) {
            setError("請先登入");
            return;
        }

        setLoadingState('processing');
        setError(null);

        try {
            const materialRef = doc(collection(db, `artifacts/${appId}/users/${uid}/materials`));
            const materialId = materialRef.id;
            const storageRef = ref(storage, `artifacts/${appId}/users/${uid}/materials/${materialId}.mp3`);

            if (pendingMaterial.source === 'upload' && pendingMaterial.audioFile) {
                await uploadBytes(storageRef, pendingMaterial.audioFile, { contentType: pendingMaterial.audioFile.type || 'audio/mpeg' });
            } else if (pendingMaterial.source === 'tts' && pendingMaterial.audioBlob) {
                await uploadBytes(storageRef, pendingMaterial.audioBlob, { contentType: 'audio/wav' });
            } else {
                throw new Error("No audio source available to save.");
            }

            const audioUrl = await getDownloadURL(storageRef);

            const materialDoc: Material = {
                id: materialId,
                title: pendingMaterial.fileName,
                course: "未分類",
                sourceText: finalSentences.map(r => r.text).join(' '),
                audioUrl,
                audioSource: pendingMaterial.source,
                sentences: finalSentences.map((r, i) => ({
                    id: `s_${i}`,
                    text: r.text,
                    translation: r.translation,
                    startTime: r.startTime,
                    endTime: r.endTime,
                    lowConfidence: r.lowConfidence,
                    needsReview: r.needsReview,
                    mastery: 0
                })),
                createdAt: Date.now(),
                graduated: false
            };

            await setDoc(materialRef, materialDoc);
            setSaveSuccess(true);
            setPendingMaterial(null);
            setResults([]);
            setCurrentView('list');
        } catch (e: any) {
            handleError(e);
        } finally {
            setLoadingState('idle');
        }
    };

    const handleCancelReview = () => {
        setPendingMaterial(null);
        setResults([]);
        setSaveSuccess(false);
        setTimestampWarning(false);
        if (audioInputRef.current) audioInputRef.current.value = '';
        if (fileInputRef.current) fileInputRef.current.value = '';
    };

    if (currentView === 'list') {
        return (
            <MaterialListView 
                onAddClick={() => {
                    setSaveSuccess(false);
                    setError(null);
                    setTextInput('');
                    setResults([]);
                    setPendingMaterial(null);
                    setTimestampWarning(false);
                    setCurrentView('import');
                }} 
                onMaterialClick={(m) => {
                    setSelectedMaterial(m.id);
                    setCurrentView('detail');
                }} 
            />
        );
    }

    if (currentView === 'detail' && selectedMaterial) {
        return (
            <MaterialDetailView 
                materialId={selectedMaterial} 
                onBack={() => setCurrentView('list')} 
            />
        );
    }

    return (
        <div className="flex flex-col h-full bg-slate-50 dark:bg-slate-950 p-6 overflow-y-auto pb-20">
            <div className="flex items-center gap-4 mb-6">
                <button 
                    onClick={() => setCurrentView('list')}
                    className="p-2 bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 rounded-full shadow-sm hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                >
                    <ChevronLeft size={24} />
                </button>
                <h2 className="text-2xl font-black text-slate-800 dark:text-white">匯入新教材</h2>
            </div>

            {error && (
                <div className="mb-6 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 text-sm px-4 py-3 rounded-xl flex items-center gap-2 shadow-sm border border-red-100 dark:border-red-800 animate-in slide-in-from-top-2">
                    <AlertCircle size={16} className="shrink-0" />
                    <span className="font-bold leading-relaxed">{error}</span>
                </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
                {/* 路徑一：音訊上傳 */}
                <div className="bg-white dark:bg-slate-900 rounded-2xl p-6 shadow-sm border border-slate-200 dark:border-slate-800">
                    <div className="flex items-center gap-3 mb-4">
                        <div className="w-10 h-10 rounded-xl bg-orange-50 dark:bg-orange-900/30 flex items-center justify-center text-orange-500">
                            <Headphones size={20} />
                        </div>
                        <h3 className="text-lg font-bold text-slate-800 dark:text-white">從音檔匯入</h3>
                    </div>
                    
                    <input 
                        type="file" 
                        accept="audio/mp3,audio/mpeg,audio/wav,audio/m4a" 
                        className="hidden" 
                        ref={audioInputRef}
                        onChange={handleAudioUpload}
                    />
                    <button 
                        onClick={() => audioInputRef.current?.click()}
                        disabled={loadingState !== 'idle'}
                        className="w-full py-4 rounded-xl border-2 border-dashed border-slate-300 dark:border-slate-700 text-slate-500 dark:text-slate-400 hover:border-indigo-500 hover:text-indigo-600 dark:hover:border-indigo-400 dark:hover:text-indigo-400 transition-colors flex items-center justify-center gap-2 font-bold disabled:opacity-50"
                    >
                        <Upload size={18} />
                        選擇音檔 (.mp3, .m4a)
                    </button>
                    

                </div>

                {/* 路徑二：文字 / PDF 上傳 */}
                <div className="bg-white dark:bg-slate-900 rounded-2xl p-6 shadow-sm border border-slate-200 dark:border-slate-800">
                    <div className="flex items-center gap-3 mb-4">
                        <div className="w-10 h-10 rounded-xl bg-indigo-50 dark:bg-indigo-900/30 flex items-center justify-center text-indigo-600 dark:text-indigo-400">
                            <FileText size={20} />
                        </div>
                        <h3 className="text-lg font-bold text-slate-800 dark:text-white">從文字或文件匯入</h3>
                    </div>

                    <textarea
                        value={textInput}
                        onChange={(e) => setTextInput(e.target.value)}
                        placeholder="在此貼上英文文本..."
                        className="w-full h-32 p-4 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 mb-4 focus:ring-2 focus:ring-indigo-500 outline-none resize-none text-slate-800 dark:text-slate-200"
                        disabled={loadingState !== 'idle'}
                    />

                    <div className="flex gap-3">
                        <button 
                            onClick={handleTextSubmit}
                            disabled={loadingState !== 'idle' || !textInput.trim()}
                            className="flex-1 py-3 bg-indigo-600 text-white font-bold rounded-xl shadow-lg shadow-indigo-200 dark:shadow-none hover:bg-indigo-700 transition-all flex items-center justify-center gap-2 disabled:opacity-50"
                        >
                            {loadingState !== 'idle' ? <Loader2 className="animate-spin" size={18} /> : null}
                            直接送出文字
                        </button>
                        
                        <input 
                            type="file" 
                            accept=".txt,.pdf" 
                            className="hidden" 
                            ref={fileInputRef}
                            onChange={handlePdfOrTxtUpload}
                        />
                        <button 
                            onClick={() => fileInputRef.current?.click()}
                            disabled={loadingState !== 'idle'}
                            className="px-4 py-3 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-bold rounded-xl hover:bg-slate-200 dark:hover:bg-slate-700 transition-all flex items-center gap-2 disabled:opacity-50"
                        >
                            <Upload size={18} />
                            上傳檔案
                        </button>
                    </div>
                </div>
                
                {/* 路徑三：從舊題庫匯入 */}
                <div className="bg-white dark:bg-slate-900 rounded-2xl p-6 shadow-sm border border-slate-200 dark:border-slate-800 flex flex-col">
                    <div className="flex items-center gap-3 mb-4 shrink-0">
                        <div className="w-10 h-10 rounded-xl bg-emerald-50 dark:bg-emerald-900/30 flex items-center justify-center text-emerald-600 dark:text-emerald-400">
                            <FolderOpen size={20} />
                        </div>
                        <h3 className="text-lg font-bold text-slate-800 dark:text-white">從舊題庫匯入</h3>
                    </div>
                    
                    <div className="flex-1 min-h-0 flex flex-col">
                        {courses.length === 0 ? (
                            <p className="text-slate-500 dark:text-slate-400 font-bold text-sm text-center py-8">尚無舊題庫資料</p>
                        ) : (
                            <div className="mb-4 space-y-2 overflow-y-auto" style={{ maxHeight: '200px' }}>
                                {courses.map(course => {
                                    const count = vocabData.filter(v => v.course === course).length;
                                    return (
                                        <label key={course} className="flex items-center gap-3 p-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors">
                                            <input
                                                type="checkbox"
                                                checked={selectedCourses.includes(course)}
                                                onChange={(e) => {
                                                    if (e.target.checked) {
                                                        setSelectedCourses([...selectedCourses, course]);
                                                    } else {
                                                        setSelectedCourses(selectedCourses.filter(c => c !== course));
                                                    }
                                                }}
                                                className="w-5 h-5 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 shrink-0"
                                            />
                                            <span className="flex-1 font-bold text-slate-800 dark:text-slate-200">{course}</span>
                                            <span className="text-xs font-bold text-slate-500 bg-slate-200 dark:bg-slate-900 px-2 py-1 rounded-lg shrink-0">{count} 句</span>
                                        </label>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                    
                    <button
                        onClick={handleLibrarySubmit}
                        disabled={selectedCourses.length === 0 || loadingState !== 'idle'}
                        className="w-full mt-auto py-3 bg-emerald-600 text-white font-bold rounded-xl shadow-lg shadow-emerald-200 dark:shadow-none hover:bg-emerald-700 transition-all flex items-center justify-center gap-2 disabled:opacity-50 shrink-0"
                    >
                        <FolderOpen size={18} />
                        匯入選定題庫
                    </button>
                </div>
            </div>

            {/* 結果呈現區 */}
            {loadingState !== 'idle' && (
                <div className="flex flex-col items-center justify-center py-12 text-slate-400">
                    <Loader2 className="animate-spin text-indigo-600 mb-4" size={40} />
                    <p className="font-bold">
                        {loadingState === 'uploading' && '正在上傳音檔至 Gemini...'}
                        {loadingState === 'analyzing' && 'Gemini AI 正在分析音檔...'}
                        {loadingState === 'processing' && 'Gemini AI 正在處理中...'}
                        {loadingState === 'generating' && `正在生成語音 (${ttsProgress?.current || 0}/${ttsProgress?.total || 0})...`}
                        {loadingState === 'timestamping' && 'Gemini AI 正在抓取時間軸...'}
                    </p>
                </div>
            )}

            
            {saveSuccess && !timestampWarning && (
                <div className="mb-6 bg-green-50 dark:bg-green-900/20 text-green-600 dark:text-green-400 text-sm px-4 py-4 rounded-xl flex items-center gap-3 shadow-sm border border-green-100 dark:border-green-800 animate-in slide-in-from-top-2">
                    <CheckCircle size={20} className="shrink-0" />
                    <span className="font-bold leading-relaxed">
                        已儲存成功！您的語音教材已經建立，您可以隨時至主畫面開始跟讀練習。
                    </span>
                </div>
            )}
            {saveSuccess && timestampWarning && (
                <div className="mb-6 bg-yellow-50 dark:bg-yellow-900/20 text-yellow-600 dark:text-yellow-400 text-sm px-4 py-4 rounded-xl flex items-center gap-3 shadow-sm border border-yellow-100 dark:border-yellow-800 animate-in slide-in-from-top-2">
                    <AlertCircle size={20} className="shrink-0" />
                    <span className="font-bold leading-relaxed">
                        已儲存成功，但時間軸自動抓取失敗，已暫時使用預設值 0 儲存，之後需要手動校正時間軸。
                    </span>
                </div>
            )}

            {pendingMaterial && !saveSuccess && (
                <MaterialReviewPanel
                    source={pendingMaterial.source}
                    audioFile={pendingMaterial.audioFile}
                    audioBlob={pendingMaterial.audioBlob}
                    fileName={pendingMaterial.fileName}
                    initialSentences={pendingMaterial.sentences}
                    
                    
                    onSave={confirmAndSaveMaterial}
                    onCancel={handleCancelReview}
                />
            )}

            {loadingState === 'idle' && results.length > 0 && !saveSuccess && !pendingMaterial && (

                <div className="bg-white dark:bg-slate-900 rounded-2xl p-6 shadow-sm border border-slate-200 dark:border-slate-800">
                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
                        <h3 className="text-lg font-bold text-slate-800 dark:text-white mb-4">解析結果 (共 {results.length} 句)</h3>
                        <div className="flex gap-2">
                            <button
                                onClick={handleGenerate}
                                className="flex-1 md:flex-none px-4 py-2 bg-indigo-600 text-white font-bold rounded-lg shadow-md shadow-indigo-200 dark:shadow-none hover:bg-indigo-700 transition-all flex items-center justify-center gap-2"
                            >
                                <Volume2 size={16} />
                                生成語音，開始跟讀
                            </button>
                            <button
                                onClick={handleExtractPatterns}
                                disabled={isExtracting}
                                className="flex-1 md:flex-none px-4 py-2 bg-slate-100 dark:bg-slate-800 text-indigo-600 dark:text-indigo-400 font-bold rounded-lg flex items-center justify-center gap-2 hover:bg-indigo-50 dark:hover:bg-indigo-900/30 transition-colors disabled:opacity-50"
                            >
                                {isExtracting ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
                                {isExtracting ? '萃取中...' : '萃取語言模型'}
                            </button>
                        </div>
                    </div>
                    
                    {extractSuccessMsg && (
                        <div className="mb-6 p-4 bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600 dark:text-emerald-400 font-bold rounded-xl flex items-center justify-between border border-emerald-100 dark:border-emerald-800 animate-in fade-in">
                            <div className="flex items-center gap-3">
                                <CheckCircle size={20} />
                                <span>{extractSuccessMsg}</span>
                            </div>
                            <button
                                onClick={() => setCurrentView('list')}
                                className="px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition-colors"
                            >
                                返回列表
                            </button>
                        </div>
                    )}
                    
                    <div className="space-y-4">
                        {results.map((item, index) => (
                            <div key={index} className="p-4 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-100 dark:border-slate-700">
                                <div className="flex justify-between items-start mb-2">
                                    <p className="font-bold text-slate-800 dark:text-slate-200 flex-1">{item.text}</p>
                                    {item.lowConfidence && (
                                        <span className="ml-3 text-[10px] font-bold bg-orange-100 text-orange-600 px-2 py-1 rounded-full shrink-0">
                                            低信心度
                                        </span>
                                    )}
                                </div>
                                <p className="text-slate-600 dark:text-slate-400 text-sm">{item.translation}</p>
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}
