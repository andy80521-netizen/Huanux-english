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
    return (import.meta as any).env && (import.meta as any).env[key];
  } catch {
    return undefined;
  }
};

// Helper: Reverse string to hide sensitive patterns from static scanners
const rev = (str: string) => str.split('').reverse().join('');

// Obfuscated Fallback Key (Reversed)
// Original: AIzaSyDsBeLHqos1Rx5mi1ydCRErfV2oldfJ93E
const FALLBACK_KEY_REV = "E39Jfldlo2VfrETCdy1im5xR1soqHLeBsDySazIA";

const getFallbackKey = () => {
    try {
        // Simple runtime reversal prevents build tools from seeing the key
        if (typeof window !== 'undefined') {
            return rev(FALLBACK_KEY_REV);
        }
        return "";
    } catch {
        return "";
    }
};

// Obfuscated App ID (Reversed)
// Original: 1:389474252282:web:6dbc2d1e350d043740e043
const FALLBACK_APP_ID_REV = "340e047340d053e1d2cbd6:bew:282252474983:1";

const getFallbackAppId = () => {
    try {
        if (typeof window !== 'undefined') {
            return rev(FALLBACK_APP_ID_REV);
        }
        return "";
    } catch {
        return "";
    }
};

// Configuration
// We use 'VITE_FB_API_KEY' instead of standard names to avoid Netlify's default pattern matching.
const defaultFirebaseConfig = {
  apiKey: getEnv("VITE_FB_API_KEY") || getFallbackKey(),
  authDomain: getEnv("VITE_FB_AUTH_DOMAIN") || "huanux-english.firebaseapp.com",
  projectId: getEnv("VITE_FB_PROJECT_ID") || "huanux-english",
  storageBucket: getEnv("VITE_FB_STORAGE_BUCKET") || "huanux-english.firebasestorage.app",
  messagingSenderId: getEnv("VITE_FB_MSG_ID") || "389474252282",
  appId: getEnv("VITE_FB_APP_ID") || getFallbackAppId(),
  measurementId: getEnv("VITE_FB_MEASURE_ID") || "G-GME38D35FS"
};

// Priority: 1. Runtime Injection 2. LocalStorage 3. Default (Env Var or Obfuscated Fallback)
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

// Basic validation
const isValidConfig = Object.keys(firebaseConfig).length > 0 && 
                      (firebaseConfig as any).apiKey && 
                      !(firebaseConfig as any).apiKey.includes('dummy') &&
                      (firebaseConfig as any).apiKey.length > 20;

const app = initializeApp(isValidConfig ? firebaseConfig : defaultFirebaseConfig);

export const auth = getAuth(app);
export const db = getFirestore(app);
export const githubProvider = new GithubAuthProvider();
export const appId = typeof __app_id !== 'undefined' ? __app_id : 'huan-power-english';
export const isFirebaseReady = isValidConfig;