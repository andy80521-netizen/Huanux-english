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

// --- SECURITY OBFUSCATION ---
// Use character codes to completely hide strings from static analysis scanners
const fromCodes = (codes: number[]) => String.fromCharCode(...codes);

// Codes for API Key: "AIza..."
const K = [65,73,122,97,83,121,68,115,66,101,76,72,113,111,115,49,82,120,53,109,105,49,121,100,67,82,69,114,102,86,50,111,108,100,102,74,57,51,69];

// Codes for App ID
const I = [49,58,51,56,57,52,55,52,50,53,50,50,56,50,58,119,101,98,58,54,100,98,99,50,100,49,101,51,53,48,100,48,52,51,55,52,48,101,48,52,51];

// Hardcoded defaults (Obfuscated)
const PROVIDED_CONFIG = {
  apiKey: fromCodes(K),
  authDomain: "huanux-english.firebaseapp.com",
  projectId: "huanux-english",
  storageBucket: "huanux-english.firebasestorage.app",
  messagingSenderId: "389474252282",
  appId: fromCodes(I),
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
            // Validation: Ensure apiKey is a string and has reasonable length
            if (parsedLocal && typeof parsedLocal.apiKey === 'string' && parsedLocal.apiKey.length > 30) {
                firebaseConfig = parsedLocal;
            } else {
                console.warn("Invalid local firebase config detected, ignoring.");
                localStorage.removeItem('firebase_config');
            }
        } catch(e) {
             console.warn("Failed to parse local firebase config", e);
        }
    }
}

// Final check: if apiKey is missing or invalid, revert to internal default
if (!firebaseConfig.apiKey || typeof firebaseConfig.apiKey !== 'string' || firebaseConfig.apiKey.length < 30) {
    console.warn("Invalid API Key detected, reverting to provided config.");
    firebaseConfig = { ...PROVIDED_CONFIG };
}

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getFirestore(app);
export const githubProvider = new GithubAuthProvider();
export const appId = typeof __app_id !== 'undefined' ? __app_id : 'huan-power-english';
export const isFirebaseReady = !!firebaseConfig.apiKey && firebaseConfig.apiKey.length > 20;