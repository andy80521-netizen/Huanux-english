// 交錯排列：各組內部先隨機打亂，再依序挑選，盡量讓相鄰兩項不屬於同一組
// initialLastKey：視為「上一項」的組別，讓第一個挑出的項目避開它
export function interleaveByKey<T>(items: T[], getKey: (item: T) => string, initialLastKey: string | null = null): T[] {
    const groups = new Map<string, T[]>();
    for (const item of items) {
        const k = getKey(item);
        if (!groups.has(k)) groups.set(k, []);
        groups.get(k)!.push(item);
    }

    for (const arr of groups.values()) {
        for (let i = arr.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [arr[i], arr[j]] = [arr[j], arr[i]];
        }
    }

    const result: T[] = [];
    let lastKey: string | null = initialLastKey;
    while (result.length < items.length) {
        let candidates = [...groups.entries()].filter(([k, arr]) => arr.length > 0 && k !== lastKey);
        if (candidates.length === 0) {
            candidates = [...groups.entries()].filter(([, arr]) => arr.length > 0);
        }
        // 優先挑剩餘最多的組，避免最後剩下同一組連續出現；數量相同時隨機
        const maxLen = Math.max(...candidates.map(([, arr]) => arr.length));
        const top = candidates.filter(([, arr]) => arr.length === maxLen);
        const [key, arr] = top[Math.floor(Math.random() * top.length)];
        result.push(arr.pop()!);
        lastKey = key;
    }
    return result;
}
