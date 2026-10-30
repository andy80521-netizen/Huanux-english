import React, { useState, useEffect, useId, useRef } from 'react';
import { ChevronDown, AudioLines, LogOut, Mail, Lock, LogIn, UserPlus, Loader2, Moon, Sun, Monitor, User, Database, Save, X, Github, RefreshCw, AlertCircle, ExternalLink } from 'lucide-react';
import { User as FirebaseUser, signOut, signInWithEmailAndPassword, createUserWithEmailAndPassword, signInAnonymously, updateProfile, signInWithPopup } from 'firebase/auth';
import { auth, isFirebaseReady, githubProvider, isUsingDefaultConfig } from '../firebase';
import { getVoices, speakTextPromise } from '../utils';
import { ThemeMode } from '../utils/theme';
import type { SyncStatus } from '../utils/syncStatus';
import SegmentedControl from './ui/SegmentedControl';
import Button from './ui/Button';
import IconButton from './ui/IconButton';

interface Props {
  user: FirebaseUser | null;
  syncStatus: SyncStatus;
  voicePrefs: { zh?: string, en?: string };
  setVoicePrefs: React.Dispatch<React.SetStateAction<{ zh: string, en: string }>>;
  themeMode: ThemeMode;
  setThemeMode: (mode: ThemeMode) => void;
}

const PersonalMode: React.FC<Props> = ({ user, syncStatus, voicePrefs, setVoicePrefs, themeMode, setThemeMode }) => {
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
        
        // We warn about default config, but we allow trying to login (in case user is the owner)
        // Only stop if apiKey is clearly missing or invalid structure
        
        try {
            if (isLoginMode) {
                await signInWithEmailAndPassword(auth, email, password);
            } else {
                if (!name.trim()) throw new Error("請輸入您的暱稱");
                const res = await createUserWithEmailAndPassword(auth, email, password);
                await updateProfile(res.user, { displayName: name });
            }
        } catch (err: any) {
            console.error("Auth Error:", err);
            let msg = err.message || '認證失敗';
            
            if (msg.includes('auth/invalid-credential') || msg.includes('auth/wrong-password') || msg.includes('auth/user-not-found')) msg = '帳號或密碼錯誤';
            else if (msg.includes('auth/email-already-in-use')) msg = '此 Email 已被註冊';
            else if (msg.includes('auth/weak-password')) msg = '密碼強度不足 (至少 6 位)';
            else if (msg.includes('auth/network-request-failed')) msg = '網路連線失敗，請檢查網路';
            else if (msg.includes('auth/too-many-requests')) msg = '登入失敗次數過多，請稍後再試';
            else if (msg.includes('auth/unauthorized-domain')) msg = '網域未授權：請至 Firebase Console 新增此網域';
            else if (msg.includes('api-key-not-valid') || msg.includes('auth/invalid-api-key')) {
                msg = 'API Key 無效 (請點擊設定按鈕檢查)';
                setShowConfig(true);
            } else if (msg.includes('permission-denied')) {
                msg = '權限不足：請檢查 Firebase Firestore 規則';
            }
            
            setError(msg);
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
            console.error("GitHub Login Error:", err);
            let msg = err.message || 'GitHub 登入失敗';
            
            if (msg.includes('account-exists-with-different-credential')) msg = '此 Email 已使用其他方式登入';
            else if (msg.includes('popup-closed-by-user')) msg = '登入視窗已關閉';
            else if (msg.includes('auth/popup-blocked')) msg = '彈出視窗被封鎖，請允許彈出視窗';
            else if (msg.includes('configuration-not-found')) msg = 'Firebase 尚未啟用 GitHub 登入';
            else if (msg.includes('auth/unauthorized-domain')) msg = '網域未授權：請至 Firebase Console 新增此網域';
            else if (msg.includes('api-key-not-valid') || msg.includes('auth/invalid-api-key')) {
                 msg = 'API Key 無效';
                 setShowConfig(true);
            }
            setError(msg);
        } finally {
            setLoading(false);
        }
    };

    const handleAnonymous = async () => {
        try {
            await signInAnonymously(auth);
        } catch (err: any) {
            console.error("Anon Login Error:", err);
            setError('匿名登入失敗: ' + err.message);
        }
    };

    const parseLooseJson = (str: string) => {
        // Try strict JSON parse first
        try {
            return JSON.parse(str);
        } catch (e) {
            // Fallback: Parse Javascript Object Literal (e.g. copied from Firebase Console)
            try {
                // 1. Remove comments (single line and multi-line)
                let cleaned = str.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
                
                // 2. Extract the object part: Find first '{' and last '}'
                const firstBrace = cleaned.indexOf('{');
                const lastBrace = cleaned.lastIndexOf('}');
                
                if (firstBrace !== -1 && lastBrace !== -1) {
                    cleaned = cleaned.substring(firstBrace, lastBrace + 1);
                } else {
                    // If no braces found, input might be invalid or just empty
                    throw new Error("找不到物件括號 {}");
                }

                // 3. Use Function constructor to safely evaluate the object literal
                // This handles unquoted keys, trailing commas, single quotes, etc.
                const fn = new Function(`return (${cleaned});`);
                const result = fn();
                
                if (!result || typeof result !== 'object') {
                    throw new Error("解析結果不是有效的物件");
                }
                return result;
            } catch (evalErr: any) {
                console.warn("Config parse error:", evalErr);
                throw new Error("格式錯誤。請確認您貼上的是正確的 Firebase Config 物件。");
            }
        }
    };

    const handleSaveConfig = () => {
        try {
            const trimmed = configJson.trim();
            if (!trimmed) {
                localStorage.removeItem('firebase_config');
                window.location.reload();
                return;
            }
            
            const parsed = parseLooseJson(trimmed);
            
            if (!parsed.apiKey) throw new Error('缺少 apiKey');
            if (!parsed.authDomain) throw new Error('缺少 authDomain');
            if (!parsed.projectId) throw new Error('缺少 projectId');

            localStorage.setItem('firebase_config', JSON.stringify(parsed));
            window.location.reload();
        } catch (e: any) {
            setError(e.message);
        }
    };

    const handleResetConfig = () => {
        localStorage.removeItem('firebase_config');
        window.location.reload();
    };

    const handleTestVoice = (lang: 'zh' | 'en') => {
        if (lang === 'zh') {
            speakTextPromise("你好，這是一個語音測試，聽起來如何？", 1.0, voicePrefs);
        } else {
            speakTextPromise("Hello, this is a voice test. How does it sound?", 1.0, voicePrefs);
        }
    };

    const displayName = user ? (user.displayName || (user.isAnonymous ? '訪客' : '使用者')) : '';
    const fieldClass = 'w-full min-h-12 rounded-[14px] border border-line bg-surface pl-11 pr-4 text-base text-ink placeholder:text-muted outline-hidden transition-colors focus:border-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent';
    const fieldIcon = 'pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted';

    const voiceRow = (lang: 'zh' | 'en', label: string, voices: SpeechSynthesisVoice[]) => (
        <div className="flex flex-col gap-1.5">
            <label htmlFor={`voice-${lang}`} className="text-[13px] text-muted">{label}</label>
            <div className="flex items-center gap-2">
                <div className="relative min-w-0 flex-1">
                    <select
                        id={`voice-${lang}`}
                        value={voicePrefs[lang] || ''}
                        onChange={(e) => setVoicePrefs(prev => ({ ...prev, [lang]: e.target.value }))}
                        className="w-full min-h-12 appearance-none truncate rounded-[14px] border border-line bg-surface pl-3.5 pr-10 text-base text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                    >
                        <option value="">自動選擇（推薦）</option>
                        {voices.map(v => (<option key={v.voiceURI} value={v.voiceURI}>{v.name}</option>))}
                    </select>
                    <ChevronDown className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-muted" size={16} aria-hidden="true" />
                </div>
                <IconButton
                    aria-label={`試聽語音（${label}）`}
                    title="試聽語音"
                    onClick={() => handleTestVoice(lang)}
                    className="size-12 border border-line text-accent"
                >
                    <AudioLines size={18} aria-hidden="true" />
                </IconButton>
            </div>
        </div>
    );

    const settings = (
        <div className="flex flex-col gap-9">
            <section aria-labelledby="appearance-h" className="flex flex-col gap-3">
                <h2 id="appearance-h" className="text-[13px] font-medium text-muted">外觀</h2>
                <SegmentedControl<ThemeMode>
                    label="外觀"
                    value={themeMode}
                    onChange={setThemeMode}
                    options={[
                        { value: 'system', label: '跟隨系統', icon: <Monitor size={14} aria-hidden="true" /> },
                        { value: 'light', label: '淺色', icon: <Sun size={14} aria-hidden="true" /> },
                        { value: 'dark', label: '深色', icon: <Moon size={14} aria-hidden="true" /> },
                    ]}
                />
            </section>
            <section aria-labelledby="voice-h" className="flex flex-col gap-4">
                <h2 id="voice-h" className="text-[13px] font-medium text-muted">語音設定</h2>
                {voiceRow('zh', '中文語音', zhVoices)}
                {voiceRow('en', '英文語音', enVoices)}
                <p className="text-[12px] leading-relaxed text-muted">提示：手機與電腦內建的語音包不同。若覺得預設聲音不自然，請在此手動選擇。</p>
            </section>
        </div>
    );

    const version = <p className="text-center text-[11px] tracking-[0.08em] text-muted">Huanux ENGLISH v1.8.1</p>;

    const divider = (text: string) => (
        <div className="flex items-center gap-3 text-[12px] text-muted">
            <span className="h-px flex-1 bg-line" aria-hidden="true" />{text}<span className="h-px flex-1 bg-line" aria-hidden="true" />
        </div>
    );

    return (
        <div className="h-full overflow-y-auto">
            {showConfig && <ConfigDialog
                configJson={configJson}
                setConfigJson={setConfigJson}
                error={error}
                onClose={() => setShowConfig(false)}
                onSave={handleSaveConfig}
                onReset={handleResetConfig}
            />}

            <div className="px-5 pt-6 pb-16 sm:px-8 lg:px-14 lg:pt-10">
                {user ? (
                    <div className="flex flex-col gap-8">
                        <h1 className="text-[22px] font-bold tracking-wide text-ink lg:text-[26px]">設定與個人</h1>
                        <div className="grid gap-9 lg:grid-cols-[340px_minmax(0,520px)] lg:items-start lg:gap-16">
                            <div className="flex flex-col gap-7 lg:rounded-3xl lg:border lg:border-line lg:bg-surface lg:p-7">
                                <section aria-label="帳號" className="flex items-center gap-4">
                                    <span aria-hidden="true" className="flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-full bg-accent-soft font-reading text-[28px] text-accent">
                                        {user.photoURL ? <img src={user.photoURL} alt="" className="size-full object-cover" /> : displayName.slice(0, 1)}
                                    </span>
                                    <div className="flex min-w-0 flex-col gap-1">
                                        <p className="text-lg font-bold text-ink break-words">{displayName}</p>
                                        <p className="text-[13px] text-muted break-all">{user.isAnonymous ? 'Anonymous User' : user.email}</p>
                                        <SyncBadge status={syncStatus} />
                                    </div>
                                </section>
                                {user.isAnonymous && (
                                    <p className="rounded-xl bg-warn/10 px-3.5 py-2.5 text-[12px] leading-relaxed text-warn">提示：匿名帳號資料在清除瀏覽器快取後會遺失，建議註冊帳號。</p>
                                )}
                                <div className="hidden flex-col gap-4 lg:flex">
                                    <Button variant="secondary" fullWidth icon={<LogOut size={18} aria-hidden="true" />} onClick={() => signOut(auth)}>登出帳號</Button>
                                    {version}
                                </div>
                            </div>
                            {settings}
                            <div className="flex flex-col gap-4 lg:hidden">
                                <Button variant="secondary" fullWidth icon={<LogOut size={18} aria-hidden="true" />} onClick={() => signOut(auth)}>登出帳號</Button>
                                {version}
                            </div>
                        </div>
                    </div>
                ) : (
                    <div className="grid gap-9 lg:grid-cols-[400px_minmax(0,520px)] lg:items-start lg:gap-16">
                        <section aria-labelledby="auth-h" className="flex flex-col gap-4">
                            <div className="flex items-start justify-between gap-3">
                                <div className="flex flex-col gap-1">
                                    <h1 id="auth-h" className="text-[22px] font-bold tracking-wide text-ink lg:text-[26px]">{isLoginMode ? '登入帳號' : '註冊新帳號'}</h1>
                                    <p className="text-[13px] text-muted">跨裝置同步學習進度</p>
                                </div>
                                <IconButton
                                    aria-label="設定資料庫連線"
                                    title="設定資料庫連線"
                                    onClick={() => setShowConfig(true)}
                                    className={`-mr-2.5 -mt-1.5 ${!isFirebaseReady || isUsingDefaultConfig ? 'text-warn motion-safe:animate-pulse' : 'text-muted'}`}
                                >
                                    <Database size={18} aria-hidden="true" />
                                </IconButton>
                            </div>

                            {isUsingDefaultConfig && (
                                <div className="flex gap-3 rounded-2xl bg-warn/10 p-4">
                                    <AlertCircle className="shrink-0 text-warn" size={20} aria-hidden="true" />
                                    <div>
                                        <h3 className="mb-1 text-[13px] font-bold text-warn">使用預設資料庫中</h3>
                                        <p className="text-[12px] leading-relaxed text-ink/80">
                                            若您不是開發者，請點擊右上角 <Database size={11} className="inline" aria-label="資料庫圖示" /> 設定您自己的 Firebase Config。若無法登入，請嘗試「訪客身分」。
                                        </p>
                                    </div>
                                </div>
                            )}

                            <button
                                onClick={handleGithubLogin}
                                type="button"
                                disabled={loading}
                                className="flex min-h-12 items-center justify-center gap-2 rounded-full bg-[#24292e] text-[15px] font-medium text-white transition-[filter] hover:brightness-125 disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                            >
                                {loading ? <Loader2 className="animate-spin" size={18} aria-hidden="true" /> : <Github size={18} aria-hidden="true" />}
                                使用 GitHub 登入
                            </button>
                            {divider('或使用 Email')}

                            <form onSubmit={handleAuth} className="flex flex-col gap-3">
                                {!isLoginMode && (
                                    <div className="relative">
                                        <User className={fieldIcon} size={18} aria-hidden="true" />
                                        <input
                                            type="text"
                                            aria-label="您的暱稱"
                                            className={fieldClass}
                                            value={name}
                                            onChange={(e) => setName(e.target.value)}
                                            placeholder="您的暱稱"
                                            required={!isLoginMode}
                                        />
                                    </div>
                                )}
                                <div className="relative">
                                    <Mail className={fieldIcon} size={18} aria-hidden="true" />
                                    <input
                                        type="email"
                                        aria-label="電子郵件"
                                        autoComplete="email"
                                        className={fieldClass}
                                        value={email}
                                        onChange={(e) => setEmail(e.target.value)}
                                        placeholder="電子郵件"
                                        required
                                    />
                                </div>
                                <div className="relative">
                                    <Lock className={fieldIcon} size={18} aria-hidden="true" />
                                    <input
                                        type="password"
                                        aria-label="密碼"
                                        autoComplete={isLoginMode ? 'current-password' : 'new-password'}
                                        className={fieldClass}
                                        value={password}
                                        onChange={(e) => setPassword(e.target.value)}
                                        placeholder="密碼"
                                        required
                                    />
                                </div>
                                {error && !showConfig && <p role="alert" className="rounded-xl bg-danger/10 px-3.5 py-2.5 text-[13px] font-medium text-danger">{error}</p>}
                                <Button
                                    type="submit"
                                    disabled={loading}
                                    fullWidth
                                    icon={loading ? <Loader2 className="animate-spin" size={18} aria-hidden="true" /> : (isLoginMode ? <LogIn size={18} aria-hidden="true" /> : <UserPlus size={18} aria-hidden="true" />)}
                                >
                                    {isLoginMode ? '立即登入' : '開始註冊'}
                                </Button>
                            </form>

                            <div className="flex flex-wrap items-center justify-between gap-x-4">
                                <button
                                    type="button"
                                    onClick={() => setIsLoginMode(!isLoginMode)}
                                    className="min-h-11 text-[14px] text-accent hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                                >
                                    {isLoginMode ? '沒有帳號？前往註冊' : '已有帳號？前往登入'}
                                </button>
                                <button
                                    type="button"
                                    onClick={handleAnonymous}
                                    className="min-h-11 text-[13px] text-muted hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                                >
                                    以訪客身分繼續使用
                                </button>
                            </div>
                        </section>
                        <div className="flex flex-col gap-9 border-t border-line pt-9 lg:border-t-0 lg:pt-0">
                            {settings}
                            {version}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

// Firebase 設定對話框：外觀沿用 ConfirmDialog；role="dialog"、Esc 關閉、開啟時焦點在關閉鈕（不自動聚焦輸入框，避免手機彈出鍵盤）
// 同步狀態：已同步／同步中／離線／同步失敗（App.tsx 依網路與 Firestore 監聽結果決定）
const SYNC_DISPLAY: Record<SyncStatus, { label: string; text: string; dot: string }> = {
    synced: { label: '資料已同步', text: 'text-accent', dot: 'bg-accent' },
    pending: { label: '資料同步中…', text: 'text-accent', dot: 'bg-accent motion-safe:animate-pulse' },
    offline: { label: '離線中，恢復連線後會自動上傳', text: 'text-warn', dot: 'bg-warn' },
    error: { label: '同步失敗', text: 'text-danger', dot: 'bg-danger' },
};

const SyncBadge: React.FC<{ status: SyncStatus }> = ({ status }) => {
    const d = SYNC_DISPLAY[status];
    return (
        <p role="status" className={`inline-flex items-center gap-1.5 text-[12px] ${d.text}`}>
            <span className={`size-1.5 shrink-0 rounded-full ${d.dot}`} aria-hidden="true" />{d.label}
        </p>
    );
};

const ConfigDialog: React.FC<{
    configJson: string;
    setConfigJson: (v: string) => void;
    error: string | null;
    onClose: () => void;
    onSave: () => void;
    onReset: () => void;
}> = ({ configJson, setConfigJson, error, onClose, onSave, onReset }) => {
    const titleId = useId();
    const closeRef = useRef<HTMLButtonElement>(null);
    const onCloseRef = useRef(onClose);
    onCloseRef.current = onClose;

    useEffect(() => {
        closeRef.current?.focus();
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onCloseRef.current(); };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, []);

    return (
        <div className="fixed inset-0 z-100 flex items-center justify-center bg-black/40 p-4 backdrop-blur-xs">
            <div
                role="dialog"
                aria-modal="true"
                aria-labelledby={titleId}
                className="flex max-h-full w-full max-w-md flex-col gap-4 overflow-y-auto rounded-3xl border border-line bg-surface p-6 shadow-[0_24px_48px_-12px_rgb(0_0_0/0.25)]"
            >
                <div className="flex items-center justify-between gap-3">
                    <h3 id={titleId} className="flex items-center gap-2 text-lg font-bold text-ink">
                        <Database className="text-accent" size={20} aria-hidden="true" /> Firebase 設定
                    </h3>
                    <IconButton ref={closeRef} aria-label="關閉" onClick={onClose} className="-mr-2">
                        <X size={18} aria-hidden="true" />
                    </IconButton>
                </div>

                <div className="rounded-2xl bg-accent-soft p-3.5 text-[12px] leading-relaxed text-ink">
                    <p className="mb-1 flex items-center gap-1 font-bold"><ExternalLink size={11} aria-hidden="true" /> 如何取得設定碼：</p>
                    <ol className="ml-4 list-decimal space-y-1 text-[11px] text-ink/80">
                        <li>前往 Firebase Console &gt; 專案設定 (Project Settings)</li>
                        <li>滑到下方 "Your apps" 區域</li>
                        <li>選擇 "Config" 並複製 <span className="rounded bg-surface px-1 font-mono">const firebaseConfig = ...</span> 整段程式碼</li>
                    </ol>
                </div>

                <textarea
                    aria-label="Firebase 設定碼"
                    value={configJson}
                    onChange={(e) => setConfigJson(e.target.value)}
                    className="h-32 w-full resize-none rounded-[14px] border border-line bg-ground p-3 font-mono text-base text-ink outline-hidden focus:border-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent sm:text-xs"
                    placeholder={`請貼上完整的程式碼，例如：\nconst firebaseConfig = {\n  apiKey: "AIza...",\n  authDomain: "..."\n};`}
                />

                {error && (
                    <div role="alert" className="flex items-center gap-2 rounded-xl bg-danger/10 px-3 py-2 text-[12px] text-danger">
                        <AlertCircle size={14} className="shrink-0" aria-hidden="true" />
                        {error}
                    </div>
                )}

                <div className="flex gap-3">
                    <Button variant="secondary" className="flex-1" icon={<RefreshCw size={18} aria-hidden="true" />} onClick={onReset} title="重設為預設值">重設</Button>
                    <Button className="flex-[2]" icon={<Save size={18} aria-hidden="true" />} onClick={onSave}>儲存並套用</Button>
                </div>
            </div>
        </div>
    );
};

export default PersonalMode;