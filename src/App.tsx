import React, { useState, useEffect, useRef } from 'react';
import { 
  BookOpen, Mic, Trophy, Activity, User, FolderOpen, Loader2, Ear
} from 'lucide-react';
import { onAuthStateChanged, User as FirebaseUser } from 'firebase/auth';
import { collection, doc, setDoc, onSnapshot, query, orderBy, deleteDoc, getDoc } from 'firebase/firestore';
import { auth, db, appId } from './firebase';
import { INITIAL_DATA, INITIAL_COURSES, VocabItem } from './constants';

import WalkmanMode from './components/WalkmanMode';
import SpeakingCoachMode from './components/SpeakingCoachMode';
import ListeningCoachMode from './components/ListeningCoachMode';
import BadgeMode from './components/BadgeMode';
import LibraryMode from './components/LibraryMode';
import PersonalMode from './components/PersonalMode';

const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState('learn'); 
  const [vocabData, setVocabData] = useState<VocabItem[]>([]);
  const [courses, setCourses] = useState<string[]>(INITIAL_COURSES);
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [loading, setLoading] = useState(true);
  const vocabDataRef = useRef<VocabItem[]>([]); 
  const [voicePrefs, setVoicePrefs] = useState({ zh: '', en: '' });
  const [isDarkMode, setIsDarkMode] = useState(false);

  // 1. 載入本地設定 (語音 & 夜間模式)
  useEffect(() => {
    const savedVoice = localStorage.getItem('voicePrefs');
    if (savedVoice) setVoicePrefs(JSON.parse(savedVoice));

    const savedDark = localStorage.getItem('isDarkMode');
    if (savedDark) {
        setIsDarkMode(JSON.parse(savedDark));
    } else if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
        // 如果沒有存過設定，但系統偏好是深色，預設開啟
        setIsDarkMode(true);
    }
  }, []);

  useEffect(() => {
    localStorage.setItem('voicePrefs', JSON.stringify(voicePrefs));
  }, [voicePrefs]);

  useEffect(() => {
    localStorage.setItem('isDarkMode', JSON.stringify(isDarkMode));
  }, [isDarkMode]);

  // 2. 監聽登入狀態
  useEffect(() => { 
    const unsubscribe = onAuthStateChanged(auth, (u) => { 
      setUser(u); 
      setLoading(false); 
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

    // A. 監聽題目清單
    const qVocab = query(collection(db, 'artifacts', appId, 'users', user.uid, 'flashcards'), orderBy('id'));
    const unsubVocab = onSnapshot(qVocab, (snapshot) => {
        const data = snapshot.docs.map(doc => doc.data() as VocabItem);
        if (data.length > 0) { 
          setVocabData(data); 
        } else { 
          // 雲端無資料時，將目前的訪客資料同步上去
          const dataToUpload = vocabDataRef.current.length > 0 ? vocabDataRef.current : INITIAL_DATA;
          dataToUpload.forEach(item => {
             setDoc(doc(db, 'artifacts', appId, 'users', user.uid, 'flashcards', item.id.toString()), item);
          });
        }
    });

    // B. 監聽使用者設定 (包含課程清單)
    const unsubProfile = onSnapshot(doc(db, 'artifacts', appId, 'users', user.uid, 'profile', 'settings'), (snapshot) => {
      if (snapshot.exists()) {
        const data = snapshot.data();
        if (data.courses) setCourses(data.courses);
      } else {
        // 初始化雲端課程清關
        setDoc(doc(db, 'artifacts', appId, 'users', user.uid, 'profile', 'settings'), { courses: INITIAL_COURSES });
      }
    });

    return () => { unsubVocab(); unsubProfile(); };
  }, [user]);

  // 4. 資料更新操作 (支援雲端與本地切換)
  const handleSaveItem = async (itemOrItems: VocabItem | VocabItem[]) => {
      const items = Array.isArray(itemOrItems) ? itemOrItems : [itemOrItems];
      if (user) { 
        const promises = items.map(item => { 
          const id = item.id || Date.now() + Math.floor(Math.random() * 1000); 
          return setDoc(doc(db, 'artifacts', appId, 'users', user.uid, 'flashcards', id.toString()), { ...item, id }); 
        }); 
        await Promise.all(promises); 
      } else { 
        setVocabData(prev => { 
          const newData = [...prev]; 
          items.forEach(newItem => {
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
        const promises = ids.map(id => deleteDoc(doc(db, 'artifacts', appId, 'users', user.uid, 'flashcards', id.toString())));
        await Promise.all(promises); 
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
        await setDoc(doc(db, 'artifacts', appId, 'users', user.uid, 'profile', 'settings'), { courses: updatedCourses }, { merge: true });
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
      await setDoc(doc(db, 'artifacts', appId, 'users', user.uid, 'profile', 'settings'), { courses: updatedCourses }, { merge: true });
    } else {
      localStorage.setItem('guest_courses', JSON.stringify(updatedCourses));
    }
  };

  if (loading) return <div className="flex items-center justify-center h-screen bg-slate-50 dark:bg-slate-950"><Loader2 className="animate-spin text-indigo-600" size={40} /></div>;

  return (
    <div className={`${isDarkMode ? 'dark' : ''} h-full`}>
        <div className="fixed inset-0 bg-slate-200 dark:bg-slate-950 flex justify-center overflow-hidden font-sans text-slate-900 dark:text-slate-100 selection:bg-indigo-100 dark:selection:bg-indigo-900/50">
          <div className="w-full max-w-lg h-full bg-white dark:bg-slate-900 shadow-2xl flex flex-col relative overflow-hidden sm:rounded-none md:rounded-2xl md:my-4 md:h-[calc(100%-2rem)] md:border border-slate-300 dark:border-slate-800 transition-colors duration-300">
            <div className="bg-white/90 dark:bg-slate-900/90 backdrop-blur-md z-20 px-6 py-4 flex justify-between items-center border-b border-slate-100 dark:border-slate-800 sticky top-0 transition-colors duration-300">
              <div><h1 className="text-lg font-black text-slate-800 dark:text-white tracking-tight flex items-center gap-2"><Activity className="text-indigo-600 dark:text-indigo-400" size={24} />Huanux <span className="text-indigo-600 dark:text-indigo-400">ENGLISH</span></h1></div>
            </div>
            <div className="flex-1 overflow-hidden relative bg-slate-50 dark:bg-slate-950 transition-colors duration-300">
              {activeTab === 'learn' && <WalkmanMode vocabData={vocabData} courses={courses} voicePrefs={voicePrefs} />}
              {activeTab === 'coach' && <SpeakingCoachMode vocabData={vocabData} courses={courses} onUpdateVocab={handleSaveItem} voicePrefs={voicePrefs} />}
              {activeTab === 'listen' && <ListeningCoachMode vocabData={vocabData} courses={courses} onUpdateVocab={handleSaveItem} voicePrefs={voicePrefs} />}
              {activeTab === 'badges' && <BadgeMode vocabData={vocabData} />}
              {activeTab === 'library' && <LibraryMode vocabData={vocabData} setVocabData={setVocabData} courses={courses} setCourses={setCourses} onSaveItem={handleSaveItem} onDeleteItem={handleDeleteItem} onSaveCourse={handleSaveCourse} onDeleteCourse={handleDeleteCourse} />}
              {activeTab === 'personal' && <PersonalMode user={user} voicePrefs={voicePrefs} setVoicePrefs={setVoicePrefs} isDarkMode={isDarkMode} setIsDarkMode={setIsDarkMode} />}
            </div>
            <div className="bg-white dark:bg-slate-900 border-t border-slate-100 dark:border-slate-800 px-2 py-2 flex justify-around items-center z-20 pb-safe shadow-[0_-5px_20px_rgba(0,0,0,0.02)] dark:shadow-none transition-colors duration-300">
              <button onClick={() => setActiveTab('learn')} className={`flex flex-col items-center gap-1 p-2 rounded-2xl transition-all min-w-[3.5rem] duration-300 ${activeTab === 'learn' ? 'text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-900/30 font-bold -translate-y-1' : 'text-slate-400 dark:text-slate-500 hover:bg-slate-50 dark:hover:bg-slate-800'}`}><BookOpen size={20} strokeWidth={activeTab === 'learn' ? 2.5 : 2} /><span className="text-[10px]">隨身聽</span></button>
              <button onClick={() => setActiveTab('listen')} className={`flex flex-col items-center gap-1 p-2 rounded-2xl transition-all min-w-[3.5rem] duration-300 ${activeTab === 'listen' ? 'text-orange-500 dark:text-orange-400 bg-orange-50 dark:bg-orange-900/30 font-bold -translate-y-1' : 'text-slate-400 dark:text-slate-500 hover:bg-slate-50 dark:hover:bg-slate-800'}`}><Ear size={20} strokeWidth={activeTab === 'listen' ? 2.5 : 2} /><span className="text-[10px]">聽力教練</span></button>
              <button onClick={() => setActiveTab('coach')} className={`flex flex-col items-center gap-1 p-2 rounded-2xl transition-all min-w-[3.5rem] duration-300 ${activeTab === 'coach' ? 'text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-900/30 font-bold -translate-y-1' : 'text-slate-400 dark:text-slate-500 hover:bg-slate-50 dark:hover:bg-slate-800'}`}><Mic size={20} strokeWidth={activeTab === 'coach' ? 2.5 : 2} /><span className="text-[10px]">口說教練</span></button>
              <button onClick={() => setActiveTab('badges')} className={`flex flex-col items-center gap-1 p-2 rounded-2xl transition-all min-w-[3.5rem] duration-300 ${activeTab === 'badges' ? 'text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-900/30 font-bold -translate-y-1' : 'text-slate-400 dark:text-slate-500 hover:bg-slate-50 dark:hover:bg-slate-800'}`}><Trophy size={20} strokeWidth={activeTab === 'badges' ? 2.5 : 2} /><span className="text-[10px]">勳章房</span></button>
              <button onClick={() => setActiveTab('library')} className={`flex flex-col items-center gap-1 p-2 rounded-2xl transition-all min-w-[3.5rem] duration-300 ${activeTab === 'library' ? 'text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-900/30 font-bold -translate-y-1' : 'text-slate-400 dark:text-slate-500 hover:bg-slate-50 dark:hover:bg-slate-800'}`}><FolderOpen size={20} strokeWidth={activeTab === 'library' ? 2.5 : 2} /><span className="text-[10px]">題庫</span></button>
              <button onClick={() => setActiveTab('personal')} className={`flex flex-col items-center gap-1 p-2 rounded-2xl transition-all min-w-[3.5rem] duration-300 ${activeTab === 'personal' ? 'text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-900/30 font-bold -translate-y-1' : 'text-slate-400 dark:text-slate-500 hover:bg-slate-50 dark:hover:bg-slate-800'}`}><User size={20} strokeWidth={activeTab === 'personal' ? 2.5 : 2} /><span className="text-[10px]">個人</span></button>
            </div>
          </div>
          <style>{`
            .pb-safe { padding-bottom: env(safe-area-inset-bottom); }
            @keyframes spin-slow { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
            .animate-spin-slow { animation: spin-slow 3s linear infinite; }
          `}</style>
        </div>
    </div>
  );
};

export default App;