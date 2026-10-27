// 監聽讀取狀態（UI 改版 ④ 勳章房）：讓「重試」的行為可以測試
// subscribe：開始（或重新）訂閱；snapshot：收到資料；error：監聽失敗（Firestore 會結束這個監聽）；retry：使用者按重試

export interface LoadState {
  status: 'loading' | 'ready' | 'error';
  hasData: boolean;
  /** 放進訂閱 effect 的依賴，遞增就會重建訂閱 */
  retryKey: number;
}

/** snapshot 的 empty：收到的是空集合（沒有任何句型）。空集合不算「已有資料」，之後失敗仍要顯示失敗與重試 */
export type LoadEvent = { type: 'subscribe' } | { type: 'snapshot'; empty?: boolean } | { type: 'error' } | { type: 'retry' };

export const initialLoadState: LoadState = { status: 'loading', hasData: false, retryKey: 0 };

export function patternLoadReducer(state: LoadState, event: LoadEvent): LoadState {
  switch (event.type) {
    case 'subscribe':
      return { status: 'loading', hasData: false, retryKey: state.retryKey };
    case 'snapshot':
      return { ...state, status: 'ready', hasData: !event.empty };
    case 'error':
      // 已有資料就保留畫面，不打斷使用者
      return state.hasData ? { ...state, status: 'ready' } : { ...state, status: 'error' };
    case 'retry':
      return { status: 'loading', hasData: false, retryKey: state.retryKey + 1 };
    default:
      return state;
  }
}
