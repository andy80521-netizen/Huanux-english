import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { resolveSyncStatus, createConnectionWatcher } from '../src/utils/syncStatus';

// 個人頁同步狀態改成真實狀態（擁有者 2026-10-30 核准：已同步／同步中／離線／同步失敗，小級）

describe('resolveSyncStatus：優先順序 失敗 > 離線 > 同步中 > 已同步', () => {
  it('有錯誤時一律顯示同步失敗', () => {
    expect(resolveSyncStatus({ online: true, pending: false, error: '資料同步失敗' })).toBe('error');
    expect(resolveSyncStatus({ online: false, pending: true, error: 'x' })).toBe('error');
  });
  it('沒有網路時顯示離線', () => {
    expect(resolveSyncStatus({ online: false, pending: false, error: null })).toBe('offline');
    expect(resolveSyncStatus({ online: false, pending: true, error: null })).toBe('offline');
  });
  it('有網路、還在上傳時顯示同步中', () => {
    expect(resolveSyncStatus({ online: true, pending: true, error: null })).toBe('pending');
  });
  it('有網路、沒有待上傳、沒有錯誤時顯示已同步', () => {
    expect(resolveSyncStatus({ online: true, pending: false, error: null })).toBe('synced');
  });
});

// 假的 window：可以觸發 online／offline 事件
const fakeWindow = (online: boolean) => {
  const target = new EventTarget();
  const nav = { onLine: online };
  return {
    win: Object.assign(target, { navigator: nav }) as unknown as Window,
    go(next: boolean) { nav.onLine = next; target.dispatchEvent(new Event(next ? 'online' : 'offline')); },
    listeners: target,
  };
};
const deferred = () => {
  let resolveFn!: () => void;
  let rejectFn!: (e: unknown) => void;
  const promise = new Promise<void>((res, rej) => { resolveFn = res; rejectFn = rej; });
  return { promise, resolve: resolveFn, reject: rejectFn };
};
const flush = () => new Promise(r => setTimeout(r, 0));

describe('createConnectionWatcher：網路狀態與恢復連線後的上傳', () => {
  it('一開始依 navigator.onLine 回報，且不顯示同步中', () => {
    const states: Array<{ online: boolean; pending: boolean }> = [];
    const w = fakeWindow(false);
    const stop = createConnectionWatcher({ win: w.win, waitForPendingWrites: () => Promise.resolve(), onChange: s => states.push(s) });
    expect(states[0]).toEqual({ online: false, pending: false });
    stop();
  });

  it('斷線 → 離線；恢復連線 → 同步中，上傳完成 → 已同步', async () => {
    const states: Array<{ online: boolean; pending: boolean }> = [];
    const w = fakeWindow(true);
    const d = deferred();
    const stop = createConnectionWatcher({ win: w.win, waitForPendingWrites: () => d.promise, onChange: s => states.push(s) });
    w.go(false);
    expect(states.at(-1)).toEqual({ online: false, pending: false });
    w.go(true);
    expect(states.at(-1)).toEqual({ online: true, pending: true });
    d.resolve();
    await flush();
    expect(states.at(-1)).toEqual({ online: true, pending: false });
    stop();
  });

  it('上傳失敗時也結束同步中（錯誤由資料監聽回報）', async () => {
    const states: Array<{ online: boolean; pending: boolean }> = [];
    const w = fakeWindow(false);
    const d = deferred();
    const stop = createConnectionWatcher({ win: w.win, waitForPendingWrites: () => d.promise, onChange: s => states.push(s) });
    w.go(true);
    d.reject(new Error('user changed'));
    await flush();
    expect(states.at(-1)).toEqual({ online: true, pending: false });
    stop();
  });

  it('舊的上傳結果在又斷線、再連線後不會提早結束同步中', async () => {
    const states: Array<{ online: boolean; pending: boolean }> = [];
    const w = fakeWindow(false);
    const first = deferred();
    const second = deferred();
    const queue = [first, second];
    const stop = createConnectionWatcher({ win: w.win, waitForPendingWrites: () => queue.shift()!.promise, onChange: s => states.push(s) });
    w.go(true);
    w.go(false);
    w.go(true);
    first.resolve();
    await flush();
    expect(states.at(-1)).toEqual({ online: true, pending: true });
    second.resolve();
    await flush();
    expect(states.at(-1)).toEqual({ online: true, pending: false });
    stop();
  });

  it('停止後不再回報（包含停止前已開始的上傳）', async () => {
    const states: Array<{ online: boolean; pending: boolean }> = [];
    const w = fakeWindow(false);
    const d = deferred();
    const stop = createConnectionWatcher({ win: w.win, waitForPendingWrites: () => d.promise, onChange: s => states.push(s) });
    w.go(true);
    const count = states.length;
    stop();
    d.resolve();
    await flush();
    w.go(false);
    expect(states.length).toBe(count);
  });
});

describe('個人頁顯示真實同步狀態', () => {
  const personal = readFileSync(resolve(__dirname, '..', 'src/components/PersonalMode.tsx'), 'utf8');
  const app = readFileSync(resolve(__dirname, '..', 'src/App.tsx'), 'utf8');
  it('四種狀態的文案', () => {
    for (const w of ['資料已同步', '資料同步中…', '離線中，恢復連線後會自動上傳', '同步失敗']) expect(personal).toContain(w);
  });
  it('不再固定顯示「資料同步中」', () => {
    expect(personal).not.toContain('/>資料同步中</p>');
  });
  it('App 把同步狀態傳給個人頁', () => {
    expect(app).toMatch(/<PersonalMode[^>]*syncStatus=\{/);
  });
});
