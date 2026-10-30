import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { googleLoginErrorMessage, resetPasswordErrorMessage, RESET_SENT_MESSAGE } from '../src/utils/authMessages';

// 登入方式改成 Google＋Email，加「忘記密碼」（擁有者 2026-10-30 核准，小級）
// 背景：CasHu 用 Google 登入同一個 Firebase 專案，Firebase 會移除未驗證 Gmail 帳號的密碼登入

const read = (f: string) => readFileSync(resolve(__dirname, '..', f), 'utf8');
const personal = read('src/components/PersonalMode.tsx');
const firebase = read('src/firebase.ts');
const err = (code: string) => ({ code, message: `Firebase: Error (${code}).` });

describe('移除 GitHub 登入', () => {
  it('個人頁沒有 GitHub 登入', () => {
    expect(personal).not.toMatch(/github/i);
  });
  it('firebase.ts 不再建立 GitHub provider', () => {
    expect(firebase).not.toMatch(/GithubAuthProvider|githubProvider/);
  });
});

describe('Google 登入', () => {
  it('firebase.ts 匯出 googleProvider', () => {
    expect(firebase).toMatch(/export const googleProvider = new GoogleAuthProvider\(\)/);
  });
  it('個人頁用 Google 彈出視窗登入', () => {
    expect(personal).toContain('使用 Google 登入');
    expect(personal).toMatch(/signInWithPopup\(auth, googleProvider\)/);
  });
  it('錯誤訊息', () => {
    expect(googleLoginErrorMessage(err('auth/account-exists-with-different-credential'))).toBe('此 Email 已用其他方式註冊，請改用 Email 登入');
    expect(googleLoginErrorMessage(err('auth/popup-closed-by-user'))).toBe('登入視窗已關閉');
    expect(googleLoginErrorMessage(err('auth/cancelled-popup-request'))).toBe('登入視窗已關閉');
    expect(googleLoginErrorMessage(err('auth/popup-blocked'))).toBe('彈出視窗被封鎖，請允許彈出視窗');
    expect(googleLoginErrorMessage(err('auth/operation-not-allowed'))).toBe('Firebase 尚未啟用 Google 登入');
    expect(googleLoginErrorMessage(err('auth/unauthorized-domain'))).toBe('網域未授權：請至 Firebase Console 新增此網域');
    expect(googleLoginErrorMessage(err('auth/network-request-failed'))).toBe('網路連線失敗，請檢查網路');
    expect(googleLoginErrorMessage(err('auth/internal-error'))).toBe('Google 登入失敗，請稍後再試');
    expect(googleLoginErrorMessage(null)).toBe('Google 登入失敗，請稍後再試');
  });
});

describe('忘記密碼', () => {
  it('個人頁有「忘記密碼？」並寄送重設信', () => {
    expect(personal).toContain('忘記密碼？');
    expect(personal).toMatch(/sendPasswordResetEmail\(auth,/);
    expect(personal).toContain('RESET_SENT_MESSAGE');
  });
  it('寄出後的提示不透露帳號是否存在', () => {
    expect(RESET_SENT_MESSAGE).toBe('如果這個 Email 有註冊，重設密碼信已寄出，請到信箱（含垃圾郵件）設定新密碼');
  });
  it('錯誤訊息', () => {
    expect(resetPasswordErrorMessage(err('auth/invalid-email'))).toBe('Email 格式不正確');
    expect(resetPasswordErrorMessage(err('auth/missing-email'))).toBe('請先輸入 Email');
    expect(resetPasswordErrorMessage(err('auth/too-many-requests'))).toBe('寄送次數過多，請稍後再試');
    expect(resetPasswordErrorMessage(err('auth/network-request-failed'))).toBe('網路連線失敗，請檢查網路');
    expect(resetPasswordErrorMessage(err('auth/internal-error'))).toBe('寄送失敗，請稍後再試');
  });
  it('使用者不存在時也顯示已寄出（不透露帳號是否存在）', () => {
    expect(resetPasswordErrorMessage(err('auth/user-not-found'))).toBeNull();
  });
});
