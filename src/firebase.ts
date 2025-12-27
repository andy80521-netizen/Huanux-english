import { initializeApp } from 'firebase/app';
import { getAuth, GithubAuthProvider } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';

// Define global types for the injected variables (used for runtime injection if needed)
declare global {
  var __firebase_config: string | undefined;
  var __app_id: string | undefined;
}

// Helper: Safely get environment variables from different environments (Vite vs Webpack/CRA)
const getEnv = (key: string) => {
    try {
        // Vite / Modern Browsers
        if (typeof import.meta !== 'undefined' && (import.meta as any).env) {
            return (import.meta as any).env[key];
        }
    } catch (e) {}
    
    try {
        // Webpack / Node-like envs (Create React App compatibility)
        if (typeof process !== 'undefined' && process.env) {
            return process.env[key];
        }
    } catch (e) {}
    
    return undefined;
};

// Try common variable names for API Key
const apiKey = getEnv('VITE_FIREBASE_API_KEY') || getEnv('REACT_APP_FIREBASE_API_KEY') || getEnv('API_KEY');

// To pass Netlify Secrets Scanning, we must not hardcode potentially sensitive-looking values.
// These should be set in Netlify Site Settings > Environment Variables.
const defaultFirebaseConfig = {
  apiKey: apiKey,
  authDomain: getEnv('VITE_FIREBASE_AUTH_DOMAIN') || "huanux-english.firebaseapp.com",
  projectId: getEnv('VITE_FIREBASE_PROJECT_ID') || "huanux-english",
  storageBucket: getEnv('VITE_FIREBASE_STORAGE_BUCKET') || "huanux-english.firebasestorage.app",
  messagingSenderId: getEnv('VITE_FIREBASE_MESSAGING_SENDER_ID'),
  appId: getEnv('VITE_FIREBASE_APP_ID'),
  measurementId: getEnv('VITE_FIREBASE_MEASUREMENT_ID') || "G-GME38D35FS"
};

// Priority: 1. Injected Global 2. LocalStorage 3. Env Var
let configStr = typeof __firebase_config !== 'undefined' ? __firebase_config : '{}';
let firebaseConfig = { ...defaultFirebaseConfig };

// 1. Try injected config
if (configStr && configStr !== '{}') {
    try {
        firebaseConfig = JSON.parse(configStr);
    } catch (e) {
        console.warn("Failed to parse injected firebase config", e);
    }
} else {
    // 2. Try LocalStorage
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

// Check validity. Must have apiKey and some identifier (appId or projectId).
const isValidConfig = 
    Object.keys(firebaseConfig).length > 0 && 
    !!(firebaseConfig as any).apiKey && 
    (!!(firebaseConfig as any).appId || !!(firebaseConfig as any).projectId);

if (!isValidConfig) {
  // Use console.warn instead of error so it doesn't look like a crash
  console.warn("⚠️ Firebase Config missing. App running in Offline/Guest Mode.");
  console.warn("To enable Cloud features, set VITE_FIREBASE_API_KEY and VITE_FIREBASE_APP_ID in Netlify.");
}

// Prevent Crash: Use a placeholder string if key is missing.
const safeConfig = isValidConfig ? firebaseConfig : { ...defaultFirebaseConfig, apiKey: "API_KEY_NOT_SET", appId: "APP_ID_NOT_SET" };

const app = initializeApp(safeConfig);

export const auth = getAuth(app);
export const db = getFirestore(app);
export const githubProvider = new GithubAuthProvider();
// Note: This appId variable is for the internal Firestore path structure, unrelated to Firebase Client App ID
export const appId = typeof __app_id !== 'undefined' ? __app_id : 'huan-power-english';
export const isFirebaseReady = isValidConfig;