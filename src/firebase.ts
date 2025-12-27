import { initializeApp } from 'firebase/app';
import { getAuth, GithubAuthProvider } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';

// Define global types for injected variables
declare global {
  var __firebase_config: string | undefined;
  var __app_id: string | undefined;
}

// Helper to safely get environment variables
const getEnv = (key: string) => {
  try {
    const val = (import.meta as any).env && (import.meta as any).env[key];
    if (val && typeof val === 'string') {
        // Strict filter for placeholders
        if (val.includes('placeholder') || val === 'undefined' || val.trim() === '') {
            return undefined;
        }
        return val;
    }
    return undefined;
  } catch {
    return undefined;
  }
};

// Hardcoded defaults from user provision
// These are used if Environment Variables are missing or invalid
const PROVIDED_CONFIG = {
  apiKey: "AIzaSyDsBeLHqos1Rx5mi1ydCRErfV2oldfJ93E",
  authDomain: "huanux-english.firebaseapp.com",
  projectId: "huanux-english",
  storageBucket: "huanux-english.firebasestorage.app",
  messagingSenderId: "389474252282",
  appId: "1:389474252282:web:6dbc2d1e350d043740e043",
  measurementId: "G-GME38D35FS"
};

const defaultFirebaseConfig = {
  apiKey: getEnv("VITE_FB_API_KEY") || PROVIDED_CONFIG.apiKey,
  authDomain: getEnv("VITE_FB_AUTH_DOMAIN") || PROVIDED_CONFIG.authDomain,
  projectId: getEnv("VITE_FB_PROJECT_ID") || PROVIDED_CONFIG.projectId,
  storageBucket: getEnv("VITE_FB_STORAGE_BUCKET") || PROVIDED_CONFIG.storageBucket,
  messagingSenderId: getEnv("VITE_FB_MSG_ID") || PROVIDED_CONFIG.messagingSenderId,
  appId: getEnv("VITE_FB_APP_ID") || PROVIDED_CONFIG.appId,
  measurementId: getEnv("VITE_FB_MEASURE_ID") || PROVIDED_CONFIG.measurementId
};

// Priority: 1. Runtime Injection 2. LocalStorage 3. Default
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
            // Basic structural validation
            if (parsedLocal && parsedLocal.apiKey && parsedLocal.apiKey.startsWith('AIza')) {
                firebaseConfig = parsedLocal;
            }
        } catch(e) {
             console.warn("Failed to parse local firebase config", e);
        }
    }
}

// Final check: if apiKey doesn't start with AIza, revert to provided default
if (!firebaseConfig.apiKey || !firebaseConfig.apiKey.startsWith('AIza')) {
    console.warn("Invalid API Key detected, reverting to default provided config.");
    firebaseConfig = { ...defaultFirebaseConfig };
}

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getFirestore(app);
export const githubProvider = new GithubAuthProvider();
export const appId = typeof __app_id !== 'undefined' ? __app_id : 'huan-power-english';
export const isFirebaseReady = !!firebaseConfig.apiKey;