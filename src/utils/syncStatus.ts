// 個人頁的同步狀態：已同步／同步中／離線／同步失敗
// 優先順序：同步失敗 > 離線 > 同步中 > 已同步

export type SyncStatus = 'synced' | 'pending' | 'offline' | 'error';

export const resolveSyncStatus = (s: { online: boolean; pending: boolean; error: string | null }): SyncStatus => {
    if (s.error) return 'error';
    if (!s.online) return 'offline';
    if (s.pending) return 'pending';
    return 'synced';
};

export interface ConnectionState {
    online: boolean;
    pending: boolean;   // 恢復連線後，離線時存下的寫入還在上傳
}

// 監聽網路狀態；恢復連線時等 Firestore 把離線時的寫入上傳完成。回傳停止監聽的函式
export const createConnectionWatcher = (opts: {
    win: Window;
    waitForPendingWrites: () => Promise<void>;
    onChange: (state: ConnectionState) => void;
}): (() => void) => {
    const { win, waitForPendingWrites, onChange } = opts;
    let state: ConnectionState = { online: win.navigator.onLine !== false, pending: false };
    let round = 0;          // 每次恢復連線遞增，舊的上傳結果不再生效
    let stopped = false;

    const set = (next: ConnectionState) => {
        if (stopped) return;
        state = next;
        onChange(state);
    };

    const handleOnline = () => {
        const mine = ++round;
        set({ online: true, pending: true });
        const done = () => {
            if (mine === round) set({ online: true, pending: false });
        };
        waitForPendingWrites().then(done, done);   // 上傳失敗也結束同步中，錯誤由資料監聽回報
    };
    const handleOffline = () => {
        round++;
        set({ online: false, pending: false });
    };

    win.addEventListener('online', handleOnline);
    win.addEventListener('offline', handleOffline);
    onChange(state);

    return () => {
        stopped = true;
        win.removeEventListener('online', handleOnline);
        win.removeEventListener('offline', handleOffline);
    };
};
