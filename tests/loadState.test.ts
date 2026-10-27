import { describe, it, expect } from 'vitest';
import { patternLoadReducer, initialLoadState, type LoadState } from '../src/utils/loadState';

// 勳章房讀取狀態：失敗後可重試、重試會重建訂閱（retryKey 加 1）、已有資料時失敗保留畫面

const run = (events: Parameters<typeof patternLoadReducer>[1][], start: LoadState = initialLoadState) =>
  events.reduce(patternLoadReducer, start);

describe('patternLoadReducer', () => {
  it('初始為載入中、沒有資料、retryKey 0', () => {
    expect(initialLoadState).toEqual({ status: 'loading', hasData: false, retryKey: 0 });
  });
  it('首次讀取成功 → 完成', () => {
    expect(run([{ type: 'subscribe' }, { type: 'snapshot' }])).toEqual({ status: 'ready', hasData: true, retryKey: 0 });
  });
  it('首次讀取失敗 → 離開載入中，顯示失敗', () => {
    expect(run([{ type: 'subscribe' }, { type: 'error' }]).status).toBe('error');
  });
  it('失敗後重試 → 回到載入中且 retryKey 加 1（重建訂閱）', () => {
    const s = run([{ type: 'subscribe' }, { type: 'error' }, { type: 'retry' }]);
    expect(s).toEqual({ status: 'loading', hasData: false, retryKey: 1 });
  });
  it('重試成功 → 完成；再次失敗 → 仍可再重試', () => {
    expect(run([{ type: 'subscribe' }, { type: 'error' }, { type: 'retry' }, { type: 'subscribe' }, { type: 'snapshot' }]).status).toBe('ready');
    const again = run([{ type: 'subscribe' }, { type: 'error' }, { type: 'retry' }, { type: 'subscribe' }, { type: 'error' }]);
    expect(again.status).toBe('error');
    expect(patternLoadReducer(again, { type: 'retry' })).toEqual({ status: 'loading', hasData: false, retryKey: 2 });
  });
  it('已有資料時失敗 → 保留資料畫面', () => {
    const s = run([{ type: 'subscribe' }, { type: 'snapshot' }, { type: 'error' }]);
    expect(s.status).toBe('ready');
    expect(s.hasData).toBe(true);
  });
  it('重新訂閱（例如換帳號）→ 清掉舊資料狀態、保留 retryKey', () => {
    const s = run([{ type: 'subscribe' }, { type: 'snapshot' }, { type: 'subscribe' }], { status: 'loading', hasData: false, retryKey: 3 });
    expect(s).toEqual({ status: 'loading', hasData: false, retryKey: 3 });
  });
});
