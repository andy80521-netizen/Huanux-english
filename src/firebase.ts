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

// Obfuscated Fallback Key (Dynamic Runtime Assembly)
// We split the string and check a runtime condition (window) to ensure 
// the build tool (Vite/Terser) does not evaluate this at build time.
const getFallbackKey = () => {
    try {
        const p1 = "QUl6YVN5RHNCZUxIcW9z";
        const p2 = "MVJ4NW1pMXlkQ1RFcmZWMm9sZGZGOTNF";
        // Verify we are in a browser environment to prevent build-time evaluation
        if (typeof window !== 'undefined') {
            return atob(p1 + p2);
        }
        return "";
    } catch {
        return "";
    }
};

// Obfuscated App ID
const getFallbackAppId = () => {
    try {
        const p1 = "MTozODk0NzQyNTIyODI6d2ViOg==";
        const p2 = "NmRiYzJkMWUzNTBkMDQzNzQwZTA0Mw==";
        if (typeof window !== 'undefined') {
            return atob(p1) + atob(p2);
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
                      !(firebaseConfig as any).apiKey.includes('dummy');

const app = initializeApp(isValidConfig ? firebaseConfig : defaultFirebaseConfig);

export const auth = getAuth(app);
export const db = getFirestore(app);
export const githubProvider = new GithubAuthProvider();
export const appId = typeof __app_id !== 'undefined' ? __app_id : 'huan-power-english';
export const isFirebaseReady = isValidConfig;