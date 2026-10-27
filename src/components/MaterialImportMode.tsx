import React, { useState, useRef, useEffect } from 'react';
import { FileText, Headphones, AlertCircle, Loader2, Upload, CheckCircle, Volume2, Sparkles, FolderOpen, Check } from 'lucide-react';
import { splitTextToSentences, generateSpeechForSentences, extractPatternsFromText, translateSentences } from '../services/gemini';
import { extractTextFromPdf } from '../utils/pdfExtract';
import { auth, db, storage, appId } from '../firebase';
import { onAuthStateChanged } from 'firebase/auth';
import { INITIAL_COURSES, INITIAL_DATA, VocabItem } from '../constants';
import { doc, setDoc, deleteDoc, collection, onSnapshot, query, orderBy, getDoc } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL, deleteObject } from 'firebase/storage';
import { Material, CoverStyle } from '../types';
import { startCoverGeneration, buildCoverExcerpt } from '../services/cover';
import { savePatternsWithDedup, formatSaveResult } from '../services/patternSave';
import { requestSightingDetection } from '../services/sightings';
import MaterialReviewPanel, { ReviewSentence } from './MaterialReviewPanel';
import MaterialListView from './MaterialListView';
import MaterialDetailView from './MaterialDetailView';
import { ChevronLeft } from 'lucide-react';
import ExtractPreviewDialog from './ExtractPreviewDialog';
import Button from './ui/Button';
import IconButton from './ui/IconButton';
import { importSteps } from '../utils/importSteps';

export type PendingMaterial = {
    source: 'upload' | 'tts';
    audioFile?: File;
    audioBlob?: Blob;
    fileName: string;
    sentences: ReviewSentence[];
    materialId?: string;
    audioUrl?: string;
};



export default function MaterialImportMode() {
    const [currentView, setCurrentView] = useState<'list' | 'import' | 'detail'>('list');
    const [selectedMaterial, setSelectedMaterial] = useState<string | null>(null);
    const [loadingState, setLoadingState] = useState<'idle' | 'processing' | 'uploading' | 'analyzing' | 'generating' | 'timestamping' | 'uploadingAudio' | 'transcribing' | 'translating'>('idle');
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
    // 整篇萃取結果預覽：使用者勾選後才存入句型庫
    const [textExtractPreview, setTextExtractPreview] = useState<{ patterns: any[]; sourceLabel: string } | null>(null);
    const [savingTextPreview, setSavingTextPreview] = useState(false);
    const [courses, setCourses] = useState<string[]>([]);
    const [vocabData, setVocabData] = useState<VocabItem[]>([]);
    const [selectedCourses, setSelectedCourses] = useState<string[]>([]);
    const [whisperError, setWhisperError] = useState<string | null>(null);
    const [translateProgress, setTranslateProgress] = useState<{ done: number; total: number } | null>(null);
    const [translationError, setTranslationError] = useState<string | null>(null);

    const isSavingRef = useRef<boolean>(false);
    const whisperRunIdRef = useRef<number>(0);
    const whisperUnsubscribeRef = useRef<(() => void) | null>(null);
    const whisperTimeoutRef = useRef<NodeJS.Timeout | null>(null);
    const activeJobRef = useRef<{ materialId: string; audioUrl: string; file: File } | null>(null);

    const clearWhisperListener = () => {
        if (whisperUnsubscribeRef.current) {
            whisperUnsubscribeRef.current();
            whisperUnsubscribeRef.current = null;
        }
        if (whisperTimeoutRef.current) {
            clearTimeout(whisperTimeoutRef.current);
            whisperTimeoutRef.current = null;
        }
    };

    useEffect(() => {
        return () => {
            clearWhisperListener();
        };
    }, []);

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

            if (!patterns || patterns.length === 0) {
                setExtractSuccessMsg('這次沒有找到值得萃取的句型');
                return;
            }
            setTextExtractPreview({ patterns, sourceLabel });
        } catch (e: any) {
            setError(e.message || '萃取失敗');
        } finally {
            setIsExtracting(false);
        }
    };

    
    const handleConfirmTextPreview = async (selectedIndexes: number[]) => {
        if (!textExtractPreview) return;
        setSavingTextPreview(true);
        try {
            const chosen = selectedIndexes.map(i => textExtractPreview.patterns[i]).filter(Boolean);
            const saveResult = await savePatternsWithDedup(chosen, { sourceLabel: textExtractPreview.sourceLabel });
            setTextExtractPreview(null);
            setExtractSuccessMsg(formatSaveResult(saveResult));
        } catch (e: any) {
            setError(e.message || '存檔失敗');
        } finally {
            setSavingTextPreview(false);
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

    
    
    
    const cleanupPathOneUpload = async (materialId: string) => {
        const uid = auth.currentUser?.uid;
        if (!uid || !materialId) return;

        try {
            const storageRef = ref(storage, `artifacts/${appId}/users/${uid}/materials/${materialId}.mp3`);
            await deleteObject(storageRef);
        } catch (e) {
            console.warn('刪除 Storage 暫存音檔失敗或檔案不存在:', e);
        }

        try {
            const taskDocRef = doc(db, 'artifacts', appId, 'users', uid, 'transcriptionJobs', materialId);
            await deleteDoc(taskDocRef);
        } catch (e) {
            console.warn('刪除任務文件失敗或文件不存在:', e);
        }
    };

    const startWhisperTranscription = async (materialId: string, audioUrl: string, file: File) => {
        const runId = ++whisperRunIdRef.current;
        const uid = auth.currentUser?.uid;
        if (!uid) {
            setError("請先登入");
            return;
        }

        clearWhisperListener();
        setLoadingState('transcribing');
        setWhisperError(null);
        activeJobRef.current = { materialId, audioUrl, file };

        try {
            const taskDocPath = `artifacts/${appId}/users/${uid}/transcriptionJobs/${materialId}`;
            const taskDocRef = doc(db, taskDocPath);

            await setDoc(taskDocRef, {
                status: 'processing',
                createdAt: Date.now()
            });
            if (runId !== whisperRunIdRef.current) {
                try { await deleteDoc(taskDocRef); } catch (e) { console.warn('刪除任務文件失敗:', e); }
                return;
            }

            const idToken = await auth.currentUser.getIdToken();
            if (runId !== whisperRunIdRef.current) return;

            try {
                const response = await fetch('/.netlify/functions/whisper-transcribe', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        audioUrl,
                        idToken,
                        resultDocPath: taskDocPath
                    })
                });

                if (runId !== whisperRunIdRef.current) return;

                if (!response.ok) {
                    console.warn(`whisper-transcribe 回傳非 2xx: ${response.status}`);
                }
            } catch (fetchErr: any) {
                if (runId !== whisperRunIdRef.current) return;
                clearWhisperListener();
                setLoadingState('idle');
                setWhisperError(`呼叫轉錄服務失敗: ${fetchErr.message || fetchErr}`);
                return;
            }

            if (runId !== whisperRunIdRef.current) return;

            whisperTimeoutRef.current = setTimeout(() => {
                if (runId !== whisperRunIdRef.current) return;
                clearWhisperListener();
                setLoadingState('idle');
                setWhisperError('轉錄處理逾時（已等待 5 分鐘），請檢查 Netlify Function Log 查看執行狀況。');
            }, 5 * 60 * 1000);

            const unsubscribe = onSnapshot(taskDocRef, (snapshot) => {
                if (runId !== whisperRunIdRef.current) return;
                if (!snapshot.exists()) return;
                const data = snapshot.data();

                if (data.status === 'completed') {
                    clearWhisperListener();
                    activeJobRef.current = null;
                    setLoadingState('idle');
                    setWhisperError(null);

                    const rawResults = Array.isArray(data.results) ? data.results : [];
                    const pendingSentences: ReviewSentence[] = rawResults.map((r: any) => ({
                        text: r.text || '',
                        translation: '',
                        startTime: Number(r.startTime) || 0,
                        endTime: Number(r.endTime) || 0,
                        lowConfidence: !!r.lowConfidence
                    }));

                    setPendingMaterial({
                        source: 'upload',
                        audioFile: file,
                        fileName: file.name,
                        sentences: pendingSentences,
                        materialId,
                        audioUrl
                    });
                } else if (data.status === 'error') {
                    clearWhisperListener();
                    setLoadingState('idle');
                    setWhisperError(data.errorMessage || '轉錄處理發生錯誤。');
                }
            }, (snapshotErr) => {
                if (runId !== whisperRunIdRef.current) return;
                clearWhisperListener();
                setLoadingState('idle');
                setWhisperError(`監聽任務狀態失敗: ${snapshotErr.message}`);
            });

            whisperUnsubscribeRef.current = unsubscribe;
        } catch (err: any) {
            if (runId !== whisperRunIdRef.current) return;
            clearWhisperListener();
            setLoadingState('idle');
            setWhisperError(err.message || '啟動轉錄流程失敗');
        }
    };

    const handleRetryWhisper = () => {
        if (!activeJobRef.current) return;
        const { materialId, audioUrl, file } = activeJobRef.current;
        startWhisperTranscription(materialId, audioUrl, file);
    };

    const handleCancelWhisper = () => {
        whisperRunIdRef.current++;
        clearWhisperListener();
        setLoadingState('idle');
        setWhisperError(null);
        if (activeJobRef.current?.materialId) {
            cleanupPathOneUpload(activeJobRef.current.materialId);
        }
        activeJobRef.current = null;
        if (audioInputRef.current) audioInputRef.current.value = '';
    };

    const handleAudioUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        if (file.size > 24 * 1024 * 1024) {
            setError("檔案超過 24MB，請壓縮或改用較短的音檔");
            if (audioInputRef.current) audioInputRef.current.value = '';
            return;
        }

        const uid = auth.currentUser?.uid;
        if (!uid) {
            setError("請先登入");
            if (audioInputRef.current) audioInputRef.current.value = '';
            return;
        }

        const runId = ++whisperRunIdRef.current;

        clearWhisperListener();
        setLoadingState('uploadingAudio');
        setError(null);
        setWhisperError(null);
        setResults([]);
        setSaveSuccess(false);
        setTimestampWarning(false);
        setLowConfidenceTimestamps(false);

        try {
            const materialId = doc(collection(db, 'artifacts', appId, 'users', uid, 'materials')).id;
            const storageRef = ref(storage, `artifacts/${appId}/users/${uid}/materials/${materialId}.mp3`);

            await uploadBytes(storageRef, file, { contentType: 'audio/mpeg' });
            if (runId !== whisperRunIdRef.current) {
                cleanupPathOneUpload(materialId);
                return;
            }

            const audioUrl = await getDownloadURL(storageRef);
            if (runId !== whisperRunIdRef.current) {
                cleanupPathOneUpload(materialId);
                return;
            }

            await startWhisperTranscription(materialId, audioUrl, file);
        } catch (e: any) {
            if (runId !== whisperRunIdRef.current) return;
            console.error("處理音檔失敗:", e);
            clearWhisperListener();
            handleError(e);
        } finally {
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

    const confirmAndSaveMaterial = async (finalSentences: ReviewSentence[], coverChoice: CoverStyle | 'none' = 'none') => {
        if (!pendingMaterial) return;
        const uid = auth.currentUser?.uid;
        if (!uid) {
            setError("請先登入");
            return;
        }

        if (pendingMaterial.source === 'upload' && pendingMaterial.materialId && pendingMaterial.audioUrl) {
            if (isSavingRef.current) return;
            isSavingRef.current = true;
            setTranslationError(null);
            setLoadingState('translating');

            try {
                let translations: string[];
                try {
                    translations = await translateSentences(
                        finalSentences.map(s => s.text),
                        (done, total) => setTranslateProgress({ done, total })
                    );
                } catch (transErr: any) {
                    setTranslationError(`翻譯失敗：${transErr.message || transErr}。請再按一次「確認儲存」重試，校對內容已保留。`);
                    return;
                }

                try {
                    const materialRef = doc(db, 'artifacts', appId, 'users', uid, 'materials', pendingMaterial.materialId);
                    const materialDoc: Material = {
                        id: pendingMaterial.materialId,
                        title: pendingMaterial.fileName,
                        course: "未分類",
                        sourceText: finalSentences.map(r => r.text).join(' '),
                        audioUrl: pendingMaterial.audioUrl,
                        audioSource: 'upload',
                        sentences: finalSentences.map((r, i) => ({
                            id: `s_${i}`,
                            text: r.text,
                            translation: translations[i] || '',
                            startTime: r.startTime,
                            endTime: r.endTime,
                            lowConfidence: r.lowConfidence,
                            needsReview: r.needsReview,
                            mastery: 0
                        })),
                        createdAt: Date.now(),
                        graduated: false,
                        ...(coverChoice !== 'none' ? {
                            coverStyle: coverChoice,
                            coverStatus: 'generating' as const,
                            coverRequestedAt: Date.now()
                        } : {})
                    };

                    await setDoc(materialRef, materialDoc);

                    if (coverChoice !== 'none') {
                        startCoverGeneration(
                            pendingMaterial.materialId,
                            coverChoice,
                            pendingMaterial.fileName,
                            buildCoverExcerpt(finalSentences)
                        );
                    }

                    void requestSightingDetection(pendingMaterial.materialId);

                    try {
                        const taskDocRef = doc(db, 'artifacts', appId, 'users', uid, 'transcriptionJobs', pendingMaterial.materialId);
                        await deleteDoc(taskDocRef);
                    } catch (delErr) {
                        console.warn('刪除轉錄任務文件失敗:', delErr);
                    }

                    setTranslationError(null);
                    setSaveSuccess(true);
                    setPendingMaterial(null);
                    setResults([]);
                    setCurrentView('list');
                } catch (saveErr: any) {
                    setTranslationError(`儲存失敗：${saveErr.message || saveErr}。請再按一次「確認儲存」重試，校對內容已保留。`);
                }
            } finally {
                isSavingRef.current = false;
                setTranslateProgress(null);
                setLoadingState('idle');
            }
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
                graduated: false,
                ...(coverChoice !== 'none' ? {
                    coverStyle: coverChoice,
                    coverStatus: 'generating' as const,
                    coverRequestedAt: Date.now()
                } : {})
            };

            await setDoc(materialRef, materialDoc);

            if (coverChoice !== 'none') {
                startCoverGeneration(
                    materialId,
                    coverChoice,
                    pendingMaterial.fileName,
                    buildCoverExcerpt(finalSentences)
                );
            }

            void requestSightingDetection(materialId);

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

    // 版面：解析結果出現時捲到結果、進入校對時回到頁首（只影響捲動位置）
    const scrollRef = useRef<HTMLDivElement>(null);
    const resultsRef = useRef<HTMLElement>(null);
    const hasResults = results.length > 0;
    const isReviewing = !!pendingMaterial;
    useEffect(() => {
        if (!hasResults || isReviewing) return;
        const reduce = (() => { try { return !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches; } catch { return false; } })();
        resultsRef.current?.scrollIntoView?.({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
    }, [hasResults, isReviewing]);
    useEffect(() => {
        if (isReviewing && scrollRef.current) scrollRef.current.scrollTop = 0;
    }, [isReviewing]);

    const handleCancelReview = async () => {
        if (isSavingRef.current) {
            setTranslationError('翻譯中，請稍候完成後再操作');
            return;
        }

        if (pendingMaterial?.source === 'upload' && pendingMaterial.materialId) {
            await cleanupPathOneUpload(pendingMaterial.materialId);
        }

        setTranslationError(null);
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

    const busy = loadingState !== 'idle';
    const reviewing = !!pendingMaterial && !saveSuccess;
    const stepProgress = loadingState === 'translating'
        ? translateProgress
        : loadingState === 'generating' && ttsProgress
            ? { done: ttsProgress.current, total: ttsProgress.total }
            : null;
    const steps = importSteps(loadingState, pendingMaterial?.source === 'tts', stepProgress);
    const canCancelImport = loadingState === 'uploadingAudio' || loadingState === 'transcribing';

    const backButton = (
        <IconButton
            aria-label="返回教材列表"
            onClick={async () => {
                if (loadingState === 'uploadingAudio' || loadingState === 'transcribing' || activeJobRef.current) {
                    handleCancelWhisper();
                } else if (pendingMaterial?.source === 'upload') {
                    await handleCancelReview();
                }
                setCurrentView('list');
            }}
            disabled={loadingState === 'translating'}
            className="-ml-3"
        >
            <ChevronLeft size={22} aria-hidden="true" />
        </IconButton>
    );

    // 處理中：三步驟進度（沒有對應步驟時保留原本的單行提示）
    const progressBlock = busy && (
        <section aria-live="polite" className="flex flex-col gap-6 rounded-[20px] border border-line bg-surface px-5 py-5 lg:px-8 lg:py-7">
            <div className={`flex items-center justify-between gap-4 ${canCancelImport ? 'min-h-10' : ''}`}>
                <p className="text-[13px] text-muted">正在匯入</p>
                {canCancelImport && (
                    <Button variant="secondary" size="sm" onClick={handleCancelWhisper}>取消匯入</Button>
                )}
            </div>
            {steps ? (
                <ol className="grid grid-cols-1 gap-5 sm:grid-cols-3 sm:gap-4">
                    {steps.steps.map((st) => (
                        <li key={st.label} className="flex gap-3 sm:flex-col sm:gap-2.5" aria-current={st.status === 'active' ? 'step' : undefined}>
                            <div className={`hidden h-[3px] rounded-full sm:block ${st.status === 'pending' ? 'bg-line' : 'bg-accent'}`} aria-hidden="true" />
                            <span className="mt-px flex size-5 shrink-0 items-center justify-center sm:hidden" aria-hidden="true">
                                {st.status === 'done' && <span className="flex size-5 items-center justify-center rounded-full bg-accent text-on-accent"><Check size={12} strokeWidth={3} /></span>}
                                {st.status === 'active' && <Loader2 size={20} className="animate-spin text-accent" />}
                                {st.status === 'pending' && <span className="size-5 rounded-full border-[1.5px] border-muted/50" />}
                            </span>
                            <div className="flex min-w-0 flex-col gap-1">
                                <div className="flex items-center gap-2">
                                    <span className="hidden size-5 shrink-0 items-center justify-center sm:flex" aria-hidden="true">
                                        {st.status === 'done' && <span className="flex size-5 items-center justify-center rounded-full bg-accent text-on-accent"><Check size={12} strokeWidth={3} /></span>}
                                        {st.status === 'active' && <Loader2 size={20} className="animate-spin text-accent" />}
                                        {st.status === 'pending' && <span className="size-5 rounded-full border-[1.5px] border-muted/50" />}
                                    </span>
                                    <span className={`text-[15px] ${st.status === 'active' ? 'font-bold text-ink' : st.status === 'done' ? 'font-medium text-ink' : 'text-muted'}`}>
                                        {st.label}
                                        <span className="sr-only">{st.status === 'done' ? '（已完成）' : st.status === 'active' ? '（進行中）' : '（尚未開始）'}</span>
                                    </span>
                                </div>
                                {st.detail && <span className="text-pretty text-[13px] leading-relaxed text-muted sm:pl-7">{st.detail}</span>}
                            </div>
                        </li>
                    ))}
                </ol>
            ) : (
                <div className="flex items-center gap-3">
                    <Loader2 size={20} className="animate-spin text-accent" aria-hidden="true" />
                    <p className="text-[15px] font-medium text-ink">
                        {loadingState === 'uploading' && '正在上傳音檔至 Gemini...'}
                        {loadingState === 'analyzing' && 'Gemini AI 正在分析音檔...'}
                        {loadingState === 'timestamping' && 'Gemini AI 正在抓取時間軸...'}
                    </p>
                </div>
            )}
        </section>
    );

    const alertBox = (text: string, key: string) => (
        <div key={key} role="alert" className="flex items-start gap-3 rounded-xl bg-danger/10 px-4 py-3.5 text-sm text-danger">
            <AlertCircle size={18} className="mt-0.5 shrink-0" aria-hidden="true" />
            <span className="font-medium leading-relaxed break-words">{text}</span>
        </div>
    );

    const cardHeader = (icon: React.ReactNode, title: string, sub: string) => (
        <div className="flex flex-col items-start gap-3 @[15rem]:flex-row">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent" aria-hidden="true">{icon}</span>
            <div className="flex min-w-0 flex-col gap-0.5">
                <h2 className="text-base font-bold text-ink">{title}</h2>
                <p className="text-pretty text-xs leading-relaxed text-muted">{sub}</p>
            </div>
        </div>
    );

    return (
        <div ref={scrollRef} className={`flex h-full flex-col gap-6 overflow-y-auto px-5 pt-2 sm:px-8 lg:gap-8 lg:px-14 lg:pt-8 lg:pb-14 ${reviewing ? 'pb-0' : 'pb-12'}`}>
            {!reviewing && (
                <header className="flex flex-col gap-1">
                    <div className="flex items-center gap-1">
                        {backButton}
                        <h1 className="text-[22px] font-bold tracking-wide text-ink lg:text-[26px]">匯入新教材</h1>
                    </div>
                    <p className="text-pretty text-[13px] leading-relaxed text-muted lg:text-sm">選一種方式匯入。原文會逐句斷句並翻譯，不會摘要或改寫。</p>
                </header>
            )}

            {error && alertBox(error, 'error')}

            {whisperError && (
                <div role="alert" className="flex flex-col gap-3 rounded-xl bg-danger/10 p-4 text-sm text-danger sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex items-start gap-3">
                        <AlertCircle size={18} className="mt-0.5 shrink-0" aria-hidden="true" />
                        <span className="font-medium leading-relaxed break-words">{whisperError}</span>
                    </div>
                    <div className="flex shrink-0 gap-2 self-end sm:self-auto">
                        <Button size="sm" onClick={handleRetryWhisper}>重試</Button>
                        <Button variant="secondary" size="sm" onClick={handleCancelWhisper}>取消</Button>
                    </div>
                </div>
            )}

            {!pendingMaterial && progressBlock}

            {/* 校對中不顯示三張選項卡，校對畫面佔滿整頁 */}
            {!pendingMaterial && (
                <div className={`grid grid-cols-1 gap-4 lg:grid-cols-3 lg:gap-5 ${busy ? 'pointer-events-none opacity-45' : ''}`} aria-busy={busy || undefined}>
                    {/* 路徑一：音訊上傳 */}
                    <section className="@container flex flex-col gap-4 rounded-[18px] border border-line bg-surface p-[18px] lg:p-6">
                        {cardHeader(<Headphones size={20} />, '從音檔匯入', '真人 mp3（podcast、廣播），自動切出每句時間')}
                        <input
                            type="file"
                            accept=".mp3,audio/mpeg"
                            className="hidden"
                            ref={audioInputRef}
                            onChange={handleAudioUpload}
                        />
                        <button
                            type="button"
                            onClick={() => audioInputRef.current?.click()}
                            disabled={busy}
                            className="flex min-h-[88px] flex-1 flex-col items-center justify-center gap-1.5 rounded-[14px] border-[1.5px] border-dashed border-muted/45 bg-surface-2 text-sm font-medium text-ink transition-colors hover:border-accent hover:bg-accent-soft/50 disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent lg:min-h-[180px]"
                        >
                            <Upload size={20} aria-hidden="true" />
                            選擇音檔 (.mp3)
                        </button>
                    </section>

                    {/* 路徑二：文字 / PDF 上傳 */}
                    <section className="@container flex flex-col gap-4 rounded-[18px] border border-line bg-surface p-[18px] lg:p-6">
                        {cardHeader(<FileText size={20} />, '從文字或文件匯入', '貼上英文，或上傳 .txt／.pdf，用 AI 語音產生原音')}
                        <label className="flex flex-1 flex-col">
                            <span className="sr-only">英文文本</span>
                            <textarea
                                lang="en"
                                value={textInput}
                                onChange={(e) => setTextInput(e.target.value)}
                                placeholder="在此貼上英文文本..."
                                className="min-h-28 w-full flex-1 resize-none rounded-xl border border-muted/35 bg-surface-2 px-3.5 py-3 font-reading text-base leading-normal text-ink placeholder:text-muted transition-colors focus-visible:border-accent focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-accent lg:min-h-36"
                                disabled={busy}
                            />
                        </label>
                        {/* 卡片窄時（1024px 桌機三欄）上下排，避免按鈕溢出卡片 */}
                        <div className="flex flex-col gap-2.5 @[16rem]:flex-row">
                            <Button onClick={handleTextSubmit} disabled={busy || !textInput.trim()} className="flex-1 whitespace-nowrap">
                                直接送出文字
                            </Button>
                            <input
                                type="file"
                                accept=".txt,.pdf"
                                className="hidden"
                                ref={fileInputRef}
                                onChange={handlePdfOrTxtUpload}
                            />
                            <Button variant="secondary" onClick={() => fileInputRef.current?.click()} disabled={busy} icon={<Upload size={16} aria-hidden="true" />} className="shrink-0 whitespace-nowrap px-4">
                                上傳檔案
                            </Button>
                        </div>
                    </section>

                    {/* 路徑三：從舊題庫匯入 */}
                    <section className="@container flex flex-col gap-3 rounded-[18px] border border-line bg-surface p-[18px] lg:p-6">
                        {cardHeader(<FolderOpen size={20} />, '從舊題庫匯入', '把舊版課程的題目轉成教材')}
                        <div className="flex min-h-0 flex-1 flex-col">
                            {courses.length === 0 ? (
                                <p className="py-8 text-center text-sm text-muted">尚無舊題庫資料</p>
                            ) : (
                                <div className="-mx-1 flex max-h-[216px] flex-col gap-2 overflow-y-auto px-1 py-1">
                                    {courses.map(course => {
                                        const count = vocabData.filter(v => v.course === course).length;
                                        const checked = selectedCourses.includes(course);
                                        return (
                                            <label
                                                key={course}
                                                className={`flex min-h-12 cursor-pointer items-center gap-3 rounded-xl border px-3.5 transition-colors has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-accent ${
                                                    checked ? 'border-accent bg-accent-soft/60' : 'border-line bg-surface-2 hover:bg-line/50'
                                                }`}
                                            >
                                                <input
                                                    type="checkbox"
                                                    checked={checked}
                                                    disabled={busy}
                                                    onChange={(e) => {
                                                        if (e.target.checked) {
                                                            setSelectedCourses([...selectedCourses, course]);
                                                        } else {
                                                            setSelectedCourses(selectedCourses.filter(c => c !== course));
                                                        }
                                                    }}
                                                    className="sr-only"
                                                />
                                                <span
                                                    aria-hidden="true"
                                                    className={`flex size-5 shrink-0 items-center justify-center rounded-md border-[1.5px] transition-colors ${checked ? 'border-accent bg-accent text-on-accent' : 'border-muted/60'}`}
                                                >
                                                    {checked && <Check size={14} strokeWidth={3} />}
                                                </span>
                                                <span className="min-w-0 flex-1 text-sm font-medium text-ink break-words">{course}</span>
                                                <span className="shrink-0 text-xs text-muted tabular-nums">{count} 句</span>
                                            </label>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                        <Button
                            variant="secondary"
                            onClick={handleLibrarySubmit}
                            disabled={selectedCourses.length === 0 || busy}
                            fullWidth
                            className="mt-1"
                        >
                            匯入選定題庫
                        </Button>
                    </section>
                </div>
            )}

            {saveSuccess && !timestampWarning && (
                <div role="status" className="flex items-start gap-3 rounded-xl bg-accent-soft px-4 py-4 text-sm text-ink">
                    <CheckCircle size={20} className="mt-px shrink-0 text-accent" aria-hidden="true" />
                    <span className="font-medium leading-relaxed">
                        已儲存成功！您的語音教材已經建立，您可以隨時至主畫面開始跟讀練習。
                    </span>
                </div>
            )}
            {saveSuccess && timestampWarning && (
                <div role="status" className="flex items-start gap-3 rounded-xl bg-warn/10 px-4 py-4 text-sm text-warn">
                    <AlertCircle size={20} className="mt-px shrink-0" aria-hidden="true" />
                    <span className="font-medium leading-relaxed">
                        已儲存成功，但時間軸自動抓取失敗，已暫時使用預設值 0 儲存，之後需要手動校正時間軸。
                    </span>
                </div>
            )}

            {/* 校對中，翻譯／存檔訊息顯示在動作按鈕旁；其他時候顯示在這裡 */}
            {translationError && !reviewing && alertBox(translationError, 'translation')}

            {pendingMaterial && !saveSuccess && (
                <MaterialReviewPanel
                    source={pendingMaterial.source}
                    audioFile={pendingMaterial.audioFile}
                    audioBlob={pendingMaterial.audioBlob}
                    fileName={pendingMaterial.fileName}
                    initialSentences={pendingMaterial.sentences}
                    isSaving={loadingState === 'translating'}
                    onSave={confirmAndSaveMaterial}
                    onCancel={handleCancelReview}
                    headerStart={backButton}
                    status={progressBlock || null}
                    notice={translationError}
                />
            )}

            {loadingState === 'idle' && results.length > 0 && !saveSuccess && !pendingMaterial && (
                <section ref={resultsRef} className="flex scroll-mt-4 flex-col gap-5 rounded-[20px] border border-line bg-surface p-5 lg:p-8">
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                        <h2 className="text-lg font-bold text-ink">解析結果 (共 {results.length} 句)</h2>
                        <div className="flex flex-col gap-2.5 sm:flex-row">
                            <Button onClick={handleGenerate} icon={<Volume2 size={16} aria-hidden="true" />} className="whitespace-nowrap sm:flex-1 lg:flex-none">
                                生成語音，開始跟讀
                            </Button>
                            <Button
                                variant="secondary"
                                onClick={handleExtractPatterns}
                                disabled={isExtracting}
                                icon={isExtracting ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : <Sparkles size={16} aria-hidden="true" />}
                                className="whitespace-nowrap sm:flex-1 lg:flex-none"
                            >
                                {isExtracting ? '萃取中...' : '萃取語言模型'}
                            </Button>
                        </div>
                    </div>

                    {extractSuccessMsg && (
                        <div role="status" className="flex flex-col gap-3 rounded-xl bg-accent-soft p-4 text-sm text-ink sm:flex-row sm:items-center sm:justify-between">
                            <div className="flex items-start gap-3">
                                <CheckCircle size={20} className="mt-px shrink-0 text-accent" aria-hidden="true" />
                                <span className="font-medium leading-relaxed">{extractSuccessMsg}</span>
                            </div>
                            <Button size="sm" onClick={() => setCurrentView('list')} className="self-end sm:self-auto">
                                返回列表
                            </Button>
                        </div>
                    )}

                    <ol className="flex flex-col divide-y divide-line">
                        {results.map((item, index) => (
                            <li key={index} className="flex flex-col gap-1.5 py-4 first:pt-0 last:pb-0">
                                <div className="flex items-start justify-between gap-3">
                                    <p lang="en" className="font-reading text-lg leading-snug text-ink break-words">{item.text}</p>
                                    {item.lowConfidence && (
                                        <span className="shrink-0 rounded-full bg-warn/10 px-2 py-0.5 text-[11px] font-medium text-warn">
                                            低信心度
                                        </span>
                                    )}
                                </div>
                                <p className="text-sm leading-relaxed text-muted">{item.translation}</p>
                            </li>
                        ))}
                    </ol>
                </section>
            )}

            {textExtractPreview && (
                <ExtractPreviewDialog
                    candidates={textExtractPreview.patterns}
                    saving={savingTextPreview}
                    onConfirm={handleConfirmTextPreview}
                    onCancel={() => { setTextExtractPreview(null); setExtractSuccessMsg('沒有加入任何句型'); }}
                />
            )}
        </div>
    );
}
