const TIME_ZONE = 'Australia/Sydney';

/**
 * 取得「現在」或指定時間對應雪梨時區的日曆日期字串, 格式 YYYY-MM-DD
 */
export function getSydneyDateString(timestamp?: number): string {
    const date = timestamp ? new Date(timestamp) : new Date();
    // 使用 'en-CA' 可確保直接產出 YYYY-MM-DD 格式
    const formatter = new Intl.DateTimeFormat('en-CA', {
        timeZone: TIME_ZONE,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    });
    return formatter.format(date);
}

/**
 * 內部輔助函式：將一個雪梨 YYYY-MM-DD 日期字串，對應到一個絕對的 UTC 時間戳記 (指定當天 UTC 12:00:00)。
 * 這樣可以避開任何本地時區解析或日光節約時間(DST)跨越時導致的時間差問題，
 * 確保我們在做「日曆天」的數學運算時，每一天都精確相差 24 小時。
 */
function getUtcReferenceForSydneyDate(dateString: string): number {
    const [year, month, day] = dateString.split('-').map(Number);
    return Date.UTC(year, month - 1, day, 12, 0, 0);
}

/**
 * 計算兩個時間戳記之間, 以雪梨時區日曆日計算, 相差幾個日曆天
 */
export function getSydneyCalendarDaysDiff(timestamp1: number, timestamp2: number): number {
    const ref1 = getUtcReferenceForSydneyDate(getSydneyDateString(timestamp1));
    const ref2 = getUtcReferenceForSydneyDate(getSydneyDateString(timestamp2));
    return Math.round((ref2 - ref1) / (24 * 3600 * 1000));
}

/**
 * 計算某個時間戳記, 加上N個雪梨日曆天之後, 對應的時間戳記
 */
export function addSydneyCalendarDays(timestamp: number, days: number): number {
    const dateString = getSydneyDateString(timestamp);
    const [year, month, day] = dateString.split('-').map(Number);
    // 回傳 N 天後的 UTC 12:00 作為代表該天的時間戳記
    return Date.UTC(year, month - 1, day + days, 12, 0, 0);
}

/**
 * 判斷現在時刻, 是否已經過了某個目標時間戳記 (依雪梨日曆日判斷)
 */
export function isSydneyDateReached(targetTimestamp: number, nowTimestamp?: number): boolean {
    const now = nowTimestamp ?? Date.now();
    const nowRef = getUtcReferenceForSydneyDate(getSydneyDateString(now));
    const targetRef = getUtcReferenceForSydneyDate(getSydneyDateString(targetTimestamp));
    return nowRef >= targetRef;
}
