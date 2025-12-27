import React, { useState, useEffect } from 'react';
import { Settings, Volume2, ChevronRight, Activity, LogOut, AlertTriangle, Mail, Lock, LogIn, UserPlus, Loader2, Moon, Sun, User, Database, Save, X, Github, PlayCircle } from 'lucide-react';
import { User as FirebaseUser, signOut, signInWithEmailAndPassword, createUserWithEmailAndPassword, signInAnonymously, updateProfile, signInWithPopup } from 'firebase/auth';
import { auth, isFirebaseReady, githubProvider } from '../firebase';
import { getVoices, speakTextPromise } from '../utils';

interface Props {
  user: FirebaseUser | null;
  voicePrefs: { zh?: string, en?: string };
  setVoicePrefs: React.Dispatch<React.SetStateAction<{ zh: string, en: string }>>;
  isDarkMode: boolean;
  setIsDarkMode: React.Dispatch<React.SetStateAction<boolean>>;
}

const PersonalMode: React.FC<Props> = ({ user, voicePrefs, setVoicePrefs, isDarkMode, setIsDarkMode }) => {
    const [availableVoices, setAvailableVoices] = useState<SpeechSynthesisVoice[]>([]);
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [name, setName] = useState('');
    const [isLoginMode, setIsLoginMode] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);
    
    // Config Modal State
    const [showConfig, setShowConfig] = useState(false);
    const [configJson, setConfigJson] = useState('');

    useEffect(() => {
        const loadVoices = async () => {
            const v = await getVoices();
            setAvailableVoices(v);
        };
        loadVoices();

        const savedConfig = localStorage.getItem('firebase_config');
        if (savedConfig) setConfigJson(savedConfig);
    }, []);

    const zhVoices = availableVoices.filter(v => v.lang.includes('zh'));
    const enVoices = availableVoices.filter(v => v.lang.includes('en'));

    const handleAuth = async (e: React.FormEvent) => {
        e.preventDefault();
        setError(null);
        setLoading(true);

        if (!isFirebaseReady) {
            setError('系統未連線：請點擊右上角資料庫圖示設定 Firebase');
            setLoading(false);
            setShowConfig(true);
            return;
        }

        try {
            if (isLoginMode) {
                await signInWithEmailAndPassword(auth, email, password);
            } else {
                if (!name.trim()) throw new Error("請輸入您的暱稱");
                const res = await createUserWithEmailAndPassword(auth, email, password);
                await updateProfile(res.user, { displayName: name });
            }
        } catch (err: any) {
            let msg = err.message;
            if (msg.includes('auth/invalid-credential') || msg.includes('auth/wrong-password') || msg.includes('auth/user-not-found')) msg = '帳號或密碼錯誤';
            else if (msg.includes('auth/email-already-in-use')) msg = '此 Email 已被註冊';
            else if (msg.includes('auth/weak-password')) msg = '密碼強度不足 (至少 6 位)';
            else if (msg.includes('api-key-not-valid')) {
                msg = 'API Key 無效 (請點擊設定按鈕檢查)';
                setShowConfig(true);
            }
            setError(msg || '認證失敗，請檢查資料');
        } finally {
            setLoading(false);
        }
    };

    const handleGithubLogin = async () => {
        setError(null);
        setLoading(true);
        if (!isFirebaseReady) {
            setError('系統未連線：請先設定 Firebase');
            setLoading(false);
            setShowConfig(true);
            return;
        }
        try {
            await signInWithPopup(auth, githubProvider);
        } catch (err: any) {
            console.error(err);
            let msg = err.message;
            if (msg.includes('account-exists-with-different-credential')) msg = '此 Email 已使用其他方式登入';
            else if (msg.includes('popup-closed-by-user')) msg = '登入視窗已關閉';
            else if (msg.includes('configuration-not-found')) msg = 'Firebase 尚未啟用 GitHub 登入';
            else if (msg.includes('api-key-not-valid')) {
                 msg = 'API Key 無效';
                 setShowConfig(true);
            }
            setError(msg || 'GitHub 登入失敗');
        } finally {
            setLoading(false);
        }
    };

    const handleAnonymous = async () => {
        try {
            await signInAnonymously(auth);
        } catch (err: any) {
            setError('匿名登入失敗');
        }
    };

    const handleSaveConfig = () => {
        try {
            if (!configJson.trim()) {
                localStorage.removeItem('firebase_config');
                window.location.reload();
                return;
            }
            const parsed = JSON.parse(configJson);
            if (!parsed.apiKey) throw new Error('缺少 apiKey');
            localStorage.setItem('firebase_config', JSON.stringify(parsed));
            window.location.reload();
        } catch (e) {
            setError('JSON 格式錯誤，請檢查');
        }
    };

    const handleTestVoice = (lang: 'zh' | 'en') => {
        if (lang === 'zh') {
            speakTextPromise("你好，這是一個語音測試，聽起來如何？", 1.0, voicePrefs);
        } else {
            speakTextPromise("Hello, this is a voice test. How does it sound?", 1.0, voicePrefs);
        }
    };

    return (
        <div className="h-full bg-slate-50 dark:bg-slate-950 overflow-y-auto transition-colors duration-300 relative">
            {/* Config Modal Overlay */}
            {showConfig && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-6 animate-in fade-in duration-200">
                    <div className="bg-white dark:bg-slate-900 w-full max-w-sm rounded-3xl p-6 shadow-2xl border border-slate-100 dark:border-slate-800 animate-in zoom-in-95 duration-200">
                        <div className="flex justify-between items-center mb-4">
                            <h3 className="text-lg font-black text-slate-800 dark:text-white flex items-center gap-2">
                                <Database className="text-indigo-600" size={20} /> Firebase 設定
                            </h3>
                            <button onClick={() => setShowConfig(false)} className="p-2 bg-slate-100 dark:bg-slate-800 rounded-full text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 transition-colors">
                                <X size={18} />
                            </button>
                        </div>
                        <p className="text-xs text-slate-500 dark:text-slate-400 mb-4 leading-relaxed">
                            請貼上您的 Firebase Config JSON 以啟用註冊與同步功能。<br/>
                            <span className="opacity-70 font-mono text-[10px]">(Dev: 設定 Netlify 環境變數 <code>VITE_FB_API_KEY</code>)</span>
                        </p>
                        <textarea 
                            value={configJson}
                            onChange={(e) => setConfigJson(e.target.value)}
                            className="w-full h-32 p-3 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-mono focus:ring-2 focus:ring-indigo-500 outline-none text-slate-900 dark:text-white resize-none mb-4"
                            placeholder={`{ "apiKey": "...", "authDomain": "...", ... }`}
                        />
                        <button 
                            onClick={handleSaveConfig} 
                            className="w-full py-3 bg-indigo-600 text-white font-bold rounded-xl shadow-lg hover:bg-indigo-700 transition-all flex items-center justify-center gap-2"
                        >
                            <Save size={18} /> 儲存並重新載入
                        </button>
                    </div>
                </div>
            )}

            <div className="min-h-full flex flex-col items-center justify-center p-6 pb-24">
                <div className="w-full max-w-sm bg-white dark:bg-slate-900 rounded-3xl shadow-xl border border-slate-100 dark:border-slate-800 p-8 text-center transition-colors duration-300 relative">
                    
                    {/* Theme Toggle */}
                    <div className="mb-8 p-1 bg-slate-100 dark:bg-slate-800 rounded-xl flex items-center">
                        <button 
                            onClick={() => setIsDarkMode(false)} 
                            className={`flex-1 py-2 rounded-lg text-xs font-bold flex items-center justify-center gap-2 transition-all ${!isDarkMode ? 'bg-white dark:bg-slate-700 shadow-sm text-indigo-600' : 'text-slate-400 hover:text-slate-600 dark:hover:text-slate-300'}`}
                        >
                            <Sun size={14} /> 白天模式
                        </button>
                        <button 
                            onClick={() => setIsDarkMode(true)} 
                            className={`flex-1 py-2 rounded-lg text-xs font-bold flex items-center justify-center gap-2 transition-all ${isDarkMode ? 'bg-slate-700 text-white shadow-sm' : 'text-slate-400 hover:text-slate-600 dark:hover:text-slate-300'}`}
                        >
                            <Moon size={14} /> 夜間模式
                        </button>
                    </div>

                    {user ? (
                        <>
                            <div className="w-20 h-20 bg-indigo-100 dark:bg-indigo-900/30 rounded-full flex items-center justify-center mx-auto mb-6 text-indigo-600 dark:text-indigo-400 shadow-sm">
                                {user.photoURL ? <img src={user.photoURL} alt="User" className="w-full h-full rounded-full object-cover" /> : <Settings size={40} />}
                            </div>
                            <h2 className="text-2xl font-bold text-slate-800 dark:text-white mb-2">設定與個人</h2>
                            <div className="mb-8">
                                <p className="text-lg font-black text-slate-800 dark:text-white mb-1">
                                    {user.displayName || (user.isAnonymous ? '訪客' : '使用者')}
                                </p>
                                <p className="text-xs text-slate-500 dark:text-slate-400 font-medium mb-2 font-mono">
                                    {user.isAnonymous ? 'Anonymous User' : user.email}
                                </p>
                                <div className="inline-flex items-center gap-2 bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400 px-3 py-1 rounded-full text-xs font-bold border border-green-100 dark:border-green-900/30"><Activity size={12} /> 資料同步中</div>
                                {user.isAnonymous && (
                                    <p className="text-[10px] text-orange-500 dark:text-orange-400 mt-2">提示：匿名帳號資料在清除瀏覽器快取後會遺失，建議註冊帳號。</p>
                                )}
                            </div>
                        </>
                    ) : (
                        <div className="text-left mb-8">
                            <div className="text-center mb-6 relative">
                                {/* Config Button - Hidden in plain sight for setup */}
                                <button 
                                    onClick={() => setShowConfig(true)}
                                    className={`absolute right-0 top-0 p-1 transition-colors ${!isFirebaseReady ? 'text-orange-500 animate-pulse' : 'text-slate-300 hover:text-indigo-500 dark:text-slate-700'}`}
                                    title="設定資料庫連線"
                                >
                                    <Database size={16} />
                                </button>
                                
                                <div className="w-16 h-16 bg-indigo-50 dark:bg-indigo-900/20 rounded-2xl flex items-center justify-center mx-auto mb-4 text-indigo-600 dark:text-indigo-400"><LogIn size={32} /></div>
                                <h2 className="text-xl font-black text-slate-800 dark:text-white">{isLoginMode ? '登入帳號' : '註冊新帳號'}</h2>
                                <p className="text-xs text-slate-400 dark:text-slate-500 mt-1">跨裝置同步學習進度</p>
                            </div>

                            <div className="space-y-3 mb-6">
                                <button 
                                    onClick={handleGithubLogin}
                                    type="button"
                                    disabled={loading}
                                    className="w-full py-3 bg-[#24292e] hover:bg-[#2f363d] text-white font-bold rounded-xl shadow-lg transition-all flex items-center justify-center gap-2"
                                >
                                    {loading ? <Loader2 className="animate-spin" size={18} /> : <Github size={18} />}
                                    使用 GitHub 登入
                                </button>
                                <div className="flex items-center gap-2">
                                    <div className="flex-1 h-px bg-slate-100 dark:bg-slate-800"></div>
                                    <span className="text-[10px] text-slate-300 dark:text-slate-600 font-bold uppercase">或使用 Email</span>
                                    <div className="flex-1 h-px bg-slate-100 dark:bg-slate-800"></div>
                                </div>
                            </div>

                            <form onSubmit={handleAuth} className="space-y-4">
                                {!isLoginMode && (
                                    <div className="relative animate-in slide-in-from-top-2 duration-300">
                                        <User className="absolute left-3 top-3 text-slate-400" size={18} />
                                        <input 
                                            type="text" 
                                            value={name} 
                                            onChange={(e) => setName(e.target.value)}
                                            className="w-full pl-10 pr-4 py-3 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-sm focus:ring-2 focus:ring-indigo-500 outline-none text-slate-900 dark:text-white" 
                                            placeholder="您的暱稱" 
                                            required={!isLoginMode}
                                        />
                                    </div>
                                )}
                                <div className="relative">
                                    <Mail className="absolute left-3 top-3 text-slate-400" size={18} />
                                    <input 
                                        type="email" 
                                        value={email} 
                                        onChange={(e) => setEmail(e.target.value)}
                                        className="w-full pl-10 pr-4 py-3 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-sm focus:ring-2 focus:ring-indigo-500 outline-none text-slate-900 dark:text-white" 
                                        placeholder="電子郵件" 
                                        required 
                                    />
                                </div>
                                <div className="relative">
                                    <Lock className="absolute left-3 top-3 text-slate-400" size={18} />
                                    <input 
                                        type="password" 
                                        value={password} 
                                        onChange={(e) => setPassword(e.target.value)}
                                        className="w-full pl-10 pr-4 py-3 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-sm focus:ring-2 focus:ring-indigo-500 outline-none text-slate-900 dark:text-white" 
                                        placeholder="密碼" 
                                        required 
                                    />
                                </div>
                                {error && <p className="text-xs text-red-500 font-bold bg-red-50 dark:bg-red-900/20 p-2 rounded-lg">{error}</p>}
                                <button 
                                    type="submit" 
                                    disabled={loading}
                                    className="w-full py-3 bg-indigo-600 text-white font-bold rounded-xl shadow-lg shadow-indigo-100 dark:shadow-none hover:bg-indigo-700 transition-all flex items-center justify-center gap-2"
                                >
                                    {loading ? <Loader2 className="animate-spin" size={18} /> : (isLoginMode ? <LogIn size={18} /> : <UserPlus size={18} />)}
                                    {isLoginMode ? '立即登入' : '開始註冊'}
                                </button>
                            </form>

                            <div className="flex items-center gap-2 my-6">
                                <div className="flex-1 h-px bg-slate-100 dark:bg-slate-800"></div>
                                <span className="text-[10px] text-slate-300 dark:text-slate-600 font-bold uppercase">或</span>
                                <div className="flex-1 h-px bg-slate-100 dark:bg-slate-800"></div>
                            </div>

                            <button 
                                onClick={() => setIsLoginMode(!isLoginMode)}
                                className="w-full py-3 border border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400 font-bold rounded-xl text-sm hover:bg-slate-50 dark:hover:bg-slate-800 transition-all mb-3"
                            >
                                {isLoginMode ? '沒有帳號？前往註冊' : '已有帳號？前往登入'}
                            </button>
                            
                            <button 
                                onClick={handleAnonymous}
                                className="w-full py-2 text-slate-400 dark:text-slate-500 font-bold text-[10px] hover:underline"
                            >
                                以訪客身分繼續使用
                            </button>
                        </div>
                    )}

                    <div className="text-left mb-8 space-y-5 bg-slate-50 dark:bg-slate-800/50 p-5 rounded-2xl border border-slate-100 dark:border-slate-800">
                        <div className="flex items-center gap-2 mb-2 border-b border-slate-200 dark:border-slate-700 pb-2"><Volume2 size={16} className="text-indigo-500" /><h3 className="text-sm font-bold text-slate-700 dark:text-slate-200 uppercase tracking-wider">語音設定 (TTS)</h3></div>
                        <div>
                            <label className="text-xs font-bold text-slate-500 dark:text-slate-400 mb-1.5 block">中文語音</label>
                            <div className="flex gap-2 items-center">
                                <div className="relative flex-1">
                                    <select value={voicePrefs.zh || ''} onChange={(e) => setVoicePrefs(prev => ({...prev, zh: e.target.value}))} className="w-full p-3 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-sm appearance-none text-slate-700 dark:text-slate-200">
                                        <option value="">✨ 自動選擇 (推薦)</option>
                                        {zhVoices.map(v => (<option key={v.voiceURI} value={v.voiceURI}>{v.name}</option>))}
                                    </select>
                                    <ChevronRight className="absolute right-3 top-3.5 text-slate-400 rotate-90" size={16} />
                                </div>
                                <button onClick={() => handleTestVoice('zh')} className="p-3 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-indigo-500 hover:text-indigo-600 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors" title="試聽語音">
                                    <PlayCircle size={20} />
                                </button>
                            </div>
                        </div>
                        <div>
                            <label className="text-xs font-bold text-slate-500 dark:text-slate-400 mb-1.5 block">英文語音</label>
                            <div className="flex gap-2 items-center">
                                <div className="relative flex-1">
                                    <select value={voicePrefs.en || ''} onChange={(e) => setVoicePrefs(prev => ({...prev, en: e.target.value}))} className="w-full p-3 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-sm appearance-none text-slate-700 dark:text-slate-200">
                                        <option value="">✨ 自動選擇 (推薦)</option>
                                        {enVoices.map(v => (<option key={v.voiceURI} value={v.voiceURI}>{v.name}</option>))}
                                    </select>
                                    <ChevronRight className="absolute right-3 top-3.5 text-slate-400 rotate-90" size={16} />
                                </div>
                                <button onClick={() => handleTestVoice('en')} className="p-3 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-indigo-500 hover:text-indigo-600 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors" title="試聽語音">
                                    <PlayCircle size={20} />
                                </button>
                            </div>
                        </div>
                        <div className="flex gap-2 items-start bg-indigo-50/50 dark:bg-indigo-900/20 p-2 rounded-lg"><AlertTriangle size={14} className="text-indigo-400 mt-0.5 shrink-0" /><p className="text-[10px] text-indigo-400/80 leading-relaxed">提示：手機與電腦內建的語音包不同。若覺得預設聲音不自然，請在此手動選擇。</p></div>
                    </div>
                    {user && (<button onClick={() => signOut(auth)} className="w-full py-3.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400 font-bold rounded-xl transition-all flex items-center justify-center gap-2 mb-4 hover:bg-slate-50 dark:hover:bg-slate-700"><LogOut size={18} /> 登出帳號</button>)}
                    <p className="mt-4 text-[10px] text-slate-300 dark:text-slate-600 font-mono">Huanux ENGLISH v1.8.0</p>
                </div>
            </div>
        </div>
    );
};

export default PersonalMode;