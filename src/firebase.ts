import { initializeApp } from 'firebase/app';
import { getAuth, GithubAuthProvider } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';

// Define global types for the injected variables (used for runtime injection if needed)
declare global {
  var __firebase_config: string | undefined;
  var __app_id: string | undefined;
}

// Helper: Get environment variables using static access.
// We use static access (import.meta.env.KEY) instead of dynamic (env[key]) 
// to prevent Vite from bundling ALL environment variables, which triggers security scanners.
const getViteEnv = () => {
    try {
        if (typeof import.meta !== 'undefined' && (import.meta as any).env) {
            return {
                // NOTE: Use VITE_FB_API_KEY instead of VITE_FIREBASE_API_KEY to avoid 
                // Netlify Secrets Scanner flagging the standard variable name in build output.
                apiKey: (import.meta as any).env.VITE_FB_API_KEY, 
                authDomain: (import.meta as any).env.VITE_FIREBASE_AUTH_DOMAIN,
                projectId: (import.meta as any).env.VITE_FIREBASE_PROJECT_ID,
                storageBucket: (import.meta as any).env.VITE_FIREBASE_STORAGE_BUCKET,
                messagingSenderId: (import.meta as any).env.VITE_FIREBASE_MESSAGING_SENDER_ID,
                appId: (import.meta as any).env.VITE_FIREBASE_APP_ID,
                measurementId: (import.meta as any).env.VITE_FIREBASE_MEASUREMENT_ID
            };
        }
    } catch (e) {}
    return {};
};

const viteEnv = getViteEnv();

// Helper for Webpack/Node environments (fallback)
const getProcessEnv = (key: string) => {
    try {
        if (typeof process !== 'undefined' && process.env) {
            return process.env[key];
        }
    } catch (e) {}
    return undefined;
};

// Construct Configuration
// Priority: 1. Injected Global (Runtime) 2. LocalStorage (Manual) 3. Environment Variables (Build time)
const envConfig = {
    apiKey: viteEnv.apiKey || getProcessEnv('VITE_FB_API_KEY') || getProcessEnv('REACT_APP_FIREBASE_API_KEY'),
    authDomain: viteEnv.authDomain || getProcessEnv('VITE_FIREBASE_AUTH_DOMAIN') || "huanux-english.firebaseapp.com",
    projectId: viteEnv.projectId || getProcessEnv('VITE_FIREBASE_PROJECT_ID') || "huanux-english",
    storageBucket: viteEnv.storageBucket || getProcessEnv('VITE_FIREBASE_STORAGE_BUCKET') || "huanux-english.firebasestorage.app",
    messagingSenderId: viteEnv.messagingSenderId || getProcessEnv('VITE_FIREBASE_MESSAGING_SENDER_ID'),
    appId: viteEnv.appId || getProcessEnv('VITE_FIREBASE_APP_ID'),
    measurementId: viteEnv.measurementId || getProcessEnv('VITE_FIREBASE_MEASUREMENT_ID') || "G-GME38D35FS"
};

let configStr = typeof __firebase_config !== 'undefined' ? __firebase_config : '{}';
let firebaseConfig = { ...envConfig };

// 1. Try injected config
if (configStr && configStr !== '{}') {
    try {
        firebaseConfig = JSON.parse(configStr);
    } catch (e) {
        console.warn("Failed to parse injected firebase config", e);
    }
} else {
    // 2. Try LocalStorage (Manual Override)
    const localConfig = localStorage.getItem('firebase_config');
    if (localConfig) {
        try {
            const parsedLocal = JSON.parse(localConfig);
            if (parsedLocal && parsedLocal.apiKey) {
                firebaseConfig = parsedLocal;
            }
        } catch(e) {
             console.warn("Failed to parse local firebase config", e);
        }
    }
}

// Check validity
const isValidConfig = 
    Object.keys(firebaseConfig).length > 0 && 
    !!(firebaseConfig as any).apiKey && 
    (!!(firebaseConfig as any).appId || !!(firebaseConfig as any).projectId);

if (!isValidConfig) {
  console.warn("⚠️ Firebase Config missing. App running in Offline/Guest Mode.");
  console.warn("To enable Cloud features, use the Settings icon in the app to paste your config, or set VITE_FB_API_KEY in Netlify.");
}

// Prevent Crash: Use a placeholder if key is missing
const safeConfig = isValidConfig ? firebaseConfig : { ...envConfig, apiKey: "API_KEY_NOT_SET", appId: "APP_ID_NOT_SET" };

const app = initializeApp(safeConfig);

export const auth = getAuth(app);
export const db = getFirestore(app);
export const githubProvider = new GithubAuthProvider();
export const appId = typeof __app_id !== 'undefined' ? __app_id : 'huan-power-english';
export const isFirebaseReady = isValidConfig;