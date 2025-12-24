import { initializeApp } from 'firebase/app';
import { getAuth, GithubAuthProvider } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';

// Define global types for the injected variables
declare global {
  var __firebase_config: string | undefined;
  var __app_id: string | undefined;
}

// 預設配置 (由使用者提供)
const defaultFirebaseConfig = {
  apiKey: "AIzaSyDsBeLHqos1Rx5mi1ydCRErfV2oldfJ93E",
  authDomain: "huanux-english.firebaseapp.com",
  projectId: "huanux-english",
  storageBucket: "huanux-english.firebasestorage.app",
  messagingSenderId: "389474252282",
  appId: "1:389474252282:web:6dbc2d1e350d043740e043",
  measurementId: "G-GME38D35FS"
};

// 優先順序：1. 全域變數注入 2. 本地 LocalStorage 設定 3. 預設硬編碼配置
let configStr = typeof __firebase_config !== 'undefined' ? __firebase_config : '{}';
let firebaseConfig = { ...defaultFirebaseConfig };

// 1. 嘗試解析注入的變數 (若有)
if (configStr && configStr !== '{}') {
    try {
        firebaseConfig = JSON.parse(configStr);
    } catch (e) {
        console.warn("Failed to parse injected firebase config", e);
    }
} else {
    // 2. 嘗試從 LocalStorage 讀取 (開發者模式或使用者手動設定覆寫)
    const localConfig = localStorage.getItem('firebase_config');
    if (localConfig) {
        try {
            const parsedLocal = JSON.parse(localConfig);
            // 簡單驗證是否包含 apiKey
            if (parsedLocal && parsedLocal.apiKey) {
                firebaseConfig = parsedLocal;
            }
        } catch(e) {
             console.warn("Failed to parse local firebase config", e);
        }
    }
}

// 檢查是否為有效配置
const isValidConfig = Object.keys(firebaseConfig).length > 0 && (firebaseConfig as any).apiKey && (firebaseConfig as any).apiKey !== "dummy";

// Initialize Firebase
const app = initializeApp(isValidConfig ? firebaseConfig : defaultFirebaseConfig);

export const auth = getAuth(app);
export const db = getFirestore(app);
export const githubProvider = new GithubAuthProvider();
export const appId = typeof __app_id !== 'undefined' ? __app_id : 'huan-power-english';
export const isFirebaseReady = isValidConfig;