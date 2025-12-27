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

// Try common variable names
const apiKey = getEnv('VITE_FIREBASE_API_KEY') || getEnv('REACT_APP_FIREBASE_API_KEY') || getEnv('API_KEY');

const defaultFirebaseConfig = {
  apiKey: apiKey,
  authDomain: "huanux-english.firebaseapp.com",
  projectId: "huanux-english",
  storageBucket: "huanux-english.firebasestorage.app",
  messagingSenderId: "389474252282",
  appId: "1:389474252282:web:6dbc2d1e350d043740e043",
  measurementId: "G-GME38D35FS"
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

// Check validity. Must have apiKey and it shouldn't be undefined/empty.
const isValidConfig = Object.keys(firebaseConfig).length > 0 && !!(firebaseConfig as any).apiKey;

if (!isValidConfig) {
  // Use console.warn instead of error so it doesn't look like a crash
  console.warn("⚠️ Firebase API Key not found. App running in Offline/Guest Mode.");
}

// Prevent Crash: Use a placeholder string if key is missing.
// This allows the app to load (Guest Mode) without throwing "auth/invalid-api-key" immediately.
const safeConfig = isValidConfig ? firebaseConfig : { ...defaultFirebaseConfig, apiKey: "API_KEY_NOT_SET" };

const app = initializeApp(safeConfig);

export const auth = getAuth(app);
export const db = getFirestore(app);
export const githubProvider = new GithubAuthProvider();
export const appId = typeof __app_id !== 'undefined' ? __app_id : 'huan-power-english';
export const isFirebaseReady = isValidConfig;