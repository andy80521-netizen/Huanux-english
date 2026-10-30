// 登入相關的錯誤訊息（Google 登入、忘記密碼）

const codeOf = (err: unknown): string => {
    if (!err || typeof err !== 'object') return '';
    const e = err as { code?: unknown; message?: unknown };
    return `${typeof e.code === 'string' ? e.code : ''} ${typeof e.message === 'string' ? e.message : ''}`;
};

export const googleLoginErrorMessage = (err: unknown): string => {
    const c = codeOf(err);
    if (c.includes('account-exists-with-different-credential')) return '此 Email 已用其他方式註冊，請改用 Email 登入';
    if (c.includes('popup-closed-by-user') || c.includes('cancelled-popup-request')) return '登入視窗已關閉';
    if (c.includes('popup-blocked')) return '彈出視窗被封鎖，請允許彈出視窗';
    if (c.includes('operation-not-allowed') || c.includes('configuration-not-found')) return 'Firebase 尚未啟用 Google 登入';
    if (c.includes('unauthorized-domain')) return '網域未授權：請至 Firebase Console 新增此網域';
    if (c.includes('network-request-failed')) return '網路連線失敗，請檢查網路';
    return 'Google 登入失敗，請稍後再試';
};

// 不論帳號是否存在都顯示同一句，避免被拿來查詢某個 Email 有沒有註冊
export const RESET_SENT_MESSAGE = '如果這個 Email 有註冊，重設密碼信已寄出，請到信箱（含垃圾郵件）設定新密碼';

// 回傳 null 代表視為已寄出
export const resetPasswordErrorMessage = (err: unknown): string | null => {
    const c = codeOf(err);
    if (c.includes('user-not-found')) return null;
    if (c.includes('missing-email')) return '請先輸入 Email';
    if (c.includes('invalid-email')) return 'Email 格式不正確';
    if (c.includes('too-many-requests')) return '寄送次數過多，請稍後再試';
    if (c.includes('network-request-failed')) return '網路連線失敗，請檢查網路';
    return '寄送失敗，請稍後再試';
};
