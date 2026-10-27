import React, { useState, useEffect, useRef } from 'react';
import {
  Trophy, User, Loader2, AlertCircle, BookOpen, Sparkles
} from 'lucide-react';
import { onAuthStateChanged, User as FirebaseUser } from 'firebase/auth';
import { collection, doc, setDoc, onSnapshot, query, orderBy, deleteDoc, getDoc } from 'firebase/firestore';
import { auth, db, appId } from './firebase';
import { INITIAL_DATA, INITIAL_COURSES, VocabItem } from './constants';
import { checkVocabContainment } from './utils';
import {
  ThemeMode, readThemeMode, writeThemeMode, resolveIsDark, getBrowserStorage, LEGACY_DARK_KEY
} from './utils/theme';

import BadgeMode from './components/BadgeMode';
import PersonalMode from './components/PersonalMode';
import MaterialImportMode from './components/MaterialImportMode';
import LanguageModelMode from './components/LanguageModelMode';

const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState('material'); 
  const [vocabData, setVocabData] = useState<VocabItem[]>([]);
  const [courses, setCourses] = useState<string[]>(INITIAL_COURSES);
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [loading, setLoading] = useState(true);
  const vocabDataRef = useRef<VocabItem[]>([]); 
  const [voicePrefs, setVoicePrefs] = useState({ zh: '', en: '' });
  const [syncError, setSyncError] = useState<string | null>(null);

  // 主題：一開始就讀好設定（不先用預設值再改），與 index.html 首屏腳本的結果一致，避免閃爍
  const [themeMode, setThemeModeState] = useState<ThemeMode>(() => readThemeMode(getBrowserStorage()));
  const [systemDark, setSystemDark] = useState<boolean>(() => {
    try { return !!window.matchMedia?.('(prefers-color-scheme: dark)').matches; } catch { return false; }
  });
  const isDark = resolveIsDark(themeMode, systemDark);

  const setThemeMode = (mode: ThemeMode) => {
    setThemeModeState(mode);
    writeThemeMode(getBrowserStorage(), mode);
  };

  // 1. 載入本地設定 (語音)；移除舊版的夜間模式設定
  useEffect(() => {
    const savedVoice = localStorage.getItem('voicePrefs');
    if (savedVoice) setVoicePrefs(JSON.parse(savedVoice));
    try { getBrowserStorage()?.removeItem(LEGACY_DARK_KEY); } catch { /* 無法存取時略過 */ }
  }, []);

  useEffect(() => {
    localStorage.setItem('voicePrefs', JSON.stringify(voicePrefs));
  }, [voicePrefs]);

  // 跟隨系統時，系統切換深淺色就即時跟著變
  useEffect(() => {
    if (themeMode !== 'system') return;
    let mq: MediaQueryList | undefined;
    try { mq = window.matchMedia?.('(prefers-color-scheme: dark)'); } catch { mq = undefined; }
    if (!mq) return;
    setSystemDark(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setSystemDark(e.matches);
    if (mq.addEventListener) mq.addEventListener('change', onChange);
    else mq.addListener(onChange);
    return () => {
      if (mq!.removeEventListener) mq!.removeEventListener('change', onChange);
      else mq!.removeListener(onChange);
    };
  }, [themeMode]);

  // 深色 class 掛在 <html>，讓頁面底色、捲軸、原生表單元件一起切換
  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle('dark', isDark);
    root.style.colorScheme = isDark ? 'dark' : 'light';
    const ground = getComputedStyle(root).getPropertyValue('--ground').trim();
    if (ground) {
      document.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.setAttribute('content', ground));
    }
  }, [isDark]);

  // 2. 監聽登入狀態
  useEffect(() => { 
    const unsubscribe = onAuthStateChanged(auth, (u) => { 
      setUser(u); 
      setLoading(false); 
      if (!u) setSyncError(null); // Clear error on logout
    }); 
    return () => unsubscribe(); 
  }, []);
  
  useEffect(() => { vocabDataRef.current = vocabData; }, [vocabData]);

  // 3. 核心同步邏輯：監聽 Firestore 資料
  useEffect(() => {
    if (!user) { 
      // 訪客模式：若無資料則使用初始資料
      if (vocabData.length === 0) {
        const localData = localStorage.getItem('guest_vocab');
        setVocabData(localData ? JSON.parse(localData) : INITIAL_DATA);
        const localCourses = localStorage.getItem('guest_courses');
        setCourses(localCourses ? JSON.parse(localCourses) : INITIAL_COURSES);
      }
      return; 
    }

    setSyncError(null);

    // A. 監聽題目清單 (Updated Path: artifacts/{appId}/users/{uid}/flashcards)
    const qVocab = query(collection(db, 'artifacts', appId, 'users', user.uid, 'flashcards'), orderBy('id'));
    const unsubVocab = onSnapshot(qVocab, 
      (snapshot) => {
        const data = snapshot.docs.map(doc => doc.data() as VocabItem);
        if (data.length > 0) { 
          setVocabData(data); 
        } else { 
          // 雲端無資料時，將目前的訪客資料同步上去
          const dataToUpload = vocabDataRef.current.length > 0 ? vocabDataRef.current : INITIAL_DATA;
          dataToUpload.forEach(item => {
             setDoc(doc(db, 'artifacts', appId, 'users', user.uid, 'flashcards', item.id.toString()), item)
                .catch(e => console.warn("Init vocab upload failed", e));
          });
        }
      }, 
      (error) => {
        console.error('[監聽來源:App-flashcards]', error);
        console.warn("Firestore Vocab Sync Error:", error);
        if (error.code === 'permission-denied') {
            setSyncError("權限不足：無法讀取資料庫。請檢查 Firebase Rules 是否開放 artifacts 路徑。");
        } else {
            setSyncError("資料同步失敗，請檢查網路連線。");
        }
      }
    );

    // B. 監聽使用者設定 (Updated Path: artifacts/{appId}/users/{uid}/profile/settings)
    const unsubProfile = onSnapshot(doc(db, 'artifacts', appId, 'users', user.uid, 'profile', 'settings'), 
      (snapshot) => {
        if (snapshot.exists()) {
          const data = snapshot.data();
          if (data.courses) setCourses(data.courses);
        } else {
          // 初始化雲端課程清關
          setDoc(doc(db, 'artifacts', appId, 'users', user.uid, 'profile', 'settings'), { courses: INITIAL_COURSES })
            .catch(e => console.warn("Init profile settings failed", e));
        }
      }, 
      (error) => {
        console.error('[監聽來源:App-profileSettings]', error);
        console.warn("Firestore Profile Sync Error:", error);
        // Error handled by vocab listener already or will be logged here
      }
    );

    return () => { unsubVocab(); unsubProfile(); };
  }, [user]);

  // 4. 資料更新操作 (支援雲端與本地切換)
  const handleSaveItem = async (itemOrItems: VocabItem | VocabItem[]) => {
      let itemsToProcess = Array.isArray(itemOrItems) ? itemOrItems : [itemOrItems];
      const currentData = vocabDataRef.current;
      
      const batchUpdateMap = new Map<number, VocabItem>();
      itemsToProcess.forEach(item => batchUpdateMap.set(item.id, item));

      itemsToProcess.forEach(sourceItem => {
          if (!sourceItem.answer) return;
          const normAnswer = sourceItem.answer.trim().toLowerCase();
          if (!normAnswer) return;

          currentData.forEach(targetItem => {
              if (targetItem.id === sourceItem.id) return;

              const currentTarget = batchUpdateMap.get(targetItem.id) || targetItem;
              const normTargetAnswer = currentTarget.answer.trim().toLowerCase();
              if (!normTargetAnswer) return;

              if (normAnswer === normTargetAnswer) {
                  let finalSourceMastery = sourceItem.mastery;
                  let finalSourceListening = sourceItem.listeningMastery;
                  let sourceChanged = false;

                  if (sourceItem.mastery === 0 && currentTarget.mastery > 0) {
                      finalSourceMastery = currentTarget.mastery;
                      sourceChanged = true;
                  }
                  if (sourceItem.listeningMastery === 0 && currentTarget.listeningMastery > 0) {
                      finalSourceListening = currentTarget.listeningMastery;
                      sourceChanged = true;
                  }

                  if (sourceChanged) {
                      const updatedSource = { ...sourceItem, mastery: finalSourceMastery, listeningMastery: finalSourceListening };
                      batchUpdateMap.set(updatedSource.id, updatedSource);
                      sourceItem = updatedSource; 
                  }

                  if (sourceItem.mastery !== currentTarget.mastery || sourceItem.listeningMastery !== currentTarget.listeningMastery) {
                      const updatedTarget = { 
                          ...currentTarget, 
                          mastery: sourceItem.mastery, 
                          listeningMastery: sourceItem.listeningMastery 
                      };
                      batchUpdateMap.set(updatedTarget.id, updatedTarget);
                  }
              }
              else if (checkVocabContainment(sourceItem.answer, currentTarget.answer)) {
                   let newTargetMastery = currentTarget.mastery;
                   let newTargetListening = currentTarget.listeningMastery;
                   let targetChanged = false;

                   if (sourceItem.mastery > currentTarget.mastery) {
                       newTargetMastery = sourceItem.mastery;
                       targetChanged = true;
                   }
                   if (sourceItem.listeningMastery > currentTarget.listeningMastery) {
                       newTargetListening = sourceItem.listeningMastery;
                       targetChanged = true;
                   }

                   if (targetChanged) {
                       const updatedTarget = { 
                           ...currentTarget, 
                           mastery: newTargetMastery, 
                           listeningMastery: newTargetListening 
                       };
                       batchUpdateMap.set(updatedTarget.id, updatedTarget);
                   }
              }
          });
      });

      const finalItems = Array.from(batchUpdateMap.values());

      if (user) { 
        try {
            const promises = finalItems.map(item => { 
                const id = item.id || Date.now() + Math.floor(Math.random() * 1000); 
                return setDoc(doc(db, 'artifacts', appId, 'users', user.uid, 'flashcards', id.toString()), { ...item, id }); 
            }); 
            await Promise.all(promises); 
        } catch (e) {
            console.error("Save Item Error:", e);
            setSyncError("儲存失敗：請檢查網路或權限");
        }
      } else { 
        setVocabData(prev => { 
          const newData = [...prev]; 
          finalItems.forEach(newItem => {
            const index = newData.findIndex(i => i.id === newItem.id);
            if (index !== -1) newData[index] = newItem;
            else newData.push({ ...newItem, id: newItem.id || Date.now() });
          });
          localStorage.setItem('guest_vocab', JSON.stringify(newData));
          return newData; 
        }); 
      }
  };

  const handleDeleteItem = async (idOrIds: number | number[]) => {
      const ids = Array.isArray(idOrIds) ? idOrIds : [idOrIds];
      if (user) { 
        try {
            const promises = ids.map(id => deleteDoc(doc(db, 'artifacts', appId, 'users', user.uid, 'flashcards', id.toString())));
            await Promise.all(promises); 
        } catch (e) {
            console.error("Delete Item Error:", e);
        }
      } else { 
        setVocabData(prev => {
          const filtered = prev.filter(i => !ids.includes(i.id));
          localStorage.setItem('guest_vocab', JSON.stringify(filtered));
          return filtered;
        }); 
      }
  };

  const handleSaveCourse = async (newName: string, oldName: string | null) => {
      let updatedCourses: string[];
      if (oldName) { 
        updatedCourses = courses.map(c => c === oldName ? newName : c);
        const itemsToUpdate = vocabData.filter(v => v.course === oldName).map(v => ({ ...v, course: newName })); 
        await handleSaveItem(itemsToUpdate); 
      } else { 
        updatedCourses = [...courses, newName];
      }
      
      setCourses(updatedCourses);
      if (user) {
        try {
            await setDoc(doc(db, 'artifacts', appId, 'users', user.uid, 'profile', 'settings'), { courses: updatedCourses }, { merge: true });
        } catch (e) {
            console.error("Save Course Error:", e);
        }
      } else {
        localStorage.setItem('guest_courses', JSON.stringify(updatedCourses));
      }
  };

  const handleDeleteCourse = async (courseName: string) => { 
    const updatedCourses = courses.filter(c => c !== courseName);
    setCourses(updatedCourses);
    const idsToDelete = vocabData.filter(v => v.course === courseName).map(v => v.id); 
    await handleDeleteItem(idsToDelete); 
    
    if (user) {
      try {
          await setDoc(doc(db, 'artifacts', appId, 'users', user.uid, 'profile', 'settings'), { courses: updatedCourses }, { merge: true });
      } catch (e) {
          console.error("Delete Course Error:", e);
      }
    } else {
      localStorage.setItem('guest_courses', JSON.stringify(updatedCourses));
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-dvh bg-ground" role="status" aria-label="載入中">
        <Loader2 className="animate-spin text-accent" size={32} />
      </div>
    );
  }

  const tabs = [
    { id: 'material', label: '啟蒙的開始', Icon: BookOpen },
    { id: 'languageModel', label: '語言模型', Icon: Sparkles },
    { id: 'badges', label: '勳章房', Icon: Trophy },
    { id: 'personal', label: '個人', Icon: User },
  ] as const;

  const wordmark = (
    <span className="flex items-baseline gap-2 select-none">
      <span className="font-reading text-[22px] leading-none tracking-[-0.01em] text-ink">Huanux</span>
      <span className="text-[11px] tracking-[0.16em] text-muted">ENGLISH</span>
    </span>
  );

  return (
    <div className="h-dvh flex flex-col lg:flex-row bg-ground text-ink overflow-hidden selection:bg-accent-soft">

      {/* 桌機：左側導覽欄 */}
      <aside className="hidden lg:flex w-58 shrink-0 flex-col gap-10 border-r border-line px-4 py-8">
        <div className="px-3">{wordmark}</div>
        <nav aria-label="主要分頁" className="flex flex-col gap-1">
          {tabs.map(({ id, label, Icon }) => {
            const active = activeTab === id;
            return (
              <button
                key={id}
                type="button"
                onClick={() => setActiveTab(id)}
                aria-current={active ? 'page' : undefined}
                className={`flex h-11 items-center gap-3 rounded-xl px-3 text-[15px] text-left transition-colors duration-[var(--dur-fast)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${
                  active
                    ? 'bg-accent-soft text-indigo-800 dark:text-accent font-bold'
                    : 'text-slate-600 dark:text-slate-400 hover:bg-surface-2 hover:text-ink'
                }`}
              >
                <Icon size={19} strokeWidth={active ? 2.2 : 1.8} aria-hidden="true" />
                <span>{label}</span>
              </button>
            );
          })}
        </nav>
      </aside>

      {/* 手機：頂部頁首 */}
      <header className="lg:hidden shrink-0 pt-safe border-b border-line bg-ground">
        <div className="flex h-13 items-center px-5">{wordmark}</div>
      </header>

      {/* 內容 */}
      <div className="flex-1 min-h-0 min-w-0 flex flex-col">
        {syncError && (
          <div className="shrink-0 px-4 pt-3 lg:px-8 lg:pt-6">
            <div role="alert" className="mx-auto flex w-full max-w-3xl items-center gap-2 rounded-xl bg-danger/10 px-4 py-2.5 text-[13px] font-medium text-danger">
              <AlertCircle size={15} className="shrink-0" aria-hidden="true" />
              <span>{syncError}</span>
            </div>
          </div>
        )}
        <main className="relative flex-1 min-h-0 overflow-hidden">
          {/* 「啟蒙的開始」已改版成寬版（列表三欄、詳情兩欄、跟讀側欄），其他分頁改版前維持 768px */}
          <div className={`mx-auto h-full w-full ${activeTab === 'material' ? 'lg:max-w-[1200px]' : 'lg:max-w-3xl'}`}>
            {activeTab === 'material' && <MaterialImportMode />}
            {activeTab === 'languageModel' && <LanguageModelMode />}
            {activeTab === 'badges' && <BadgeMode />}
            {activeTab === 'personal' && <PersonalMode user={user} voicePrefs={voicePrefs} setVoicePrefs={setVoicePrefs} themeMode={themeMode} setThemeMode={setThemeMode} />}
          </div>
        </main>
      </div>

      {/* 手機：底部分頁 */}
      <nav aria-label="主要分頁" className="lg:hidden shrink-0 grid grid-cols-4 border-t border-line bg-surface pb-safe">
        {tabs.map(({ id, label, Icon }) => {
          const active = activeTab === id;
          return (
            <button
              key={id}
              type="button"
              onClick={() => setActiveTab(id)}
              aria-current={active ? 'page' : undefined}
              className={`relative flex min-h-14 flex-col items-center justify-center gap-1 pt-1.5 pb-1 text-[11px] transition-colors duration-[var(--dur-fast)] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent ${
                active ? 'text-accent font-bold' : 'text-slate-600 dark:text-slate-400'
              }`}
            >
              <span
                aria-hidden="true"
                className={`absolute top-0 h-0.5 w-8 rounded-full bg-accent transition-opacity duration-[var(--dur-base)] ${active ? 'opacity-100' : 'opacity-0'}`}
              />
              <Icon size={22} strokeWidth={active ? 2.2 : 1.8} aria-hidden="true" />
              <span>{label}</span>
            </button>
          );
        })}
      </nav>
    </div>
  );
};

export default App;