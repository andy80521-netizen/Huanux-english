// 判斷是否為「暫時忙碌」類錯誤：只有這類錯誤才換備用模型，其他錯誤（例如請求格式錯誤）換模型也沒用
export const isRetryableGeminiError = (err: any): boolean => {
    const status = err?.status ?? err?.statusCode ?? err?.code ?? err?.error?.code;
    if ([429, 500, 502, 503, 504].includes(Number(status))) return true;
    const msg = String(err?.message || '');
    return /\b(429|500|502|503|504)\b|RESOURCE_EXHAUSTED|UNAVAILABLE|overloaded|high demand|quota/i.test(msg);
};

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// 依序嘗試模型清單：遇到忙碌類錯誤就等待後換下一個模型；其他錯誤直接拋出
export async function callWithModelFallback<T>(
    models: string[],
    call: (model: string) => Promise<T>,
    options: { delayMs?: number } = {}
): Promise<T> {
    const delayMs = options.delayMs ?? 1000;
    let lastError: any;
    for (let i = 0; i < models.length; i++) {
        try {
            return await call(models[i]);
        } catch (err: any) {
            lastError = err;
            if (!isRetryableGeminiError(err)) throw err;
            const next = i < models.length - 1 ? `改用 ${models[i + 1]}` : '已無備用模型';
            console.warn(`[模型備援] ${models[i]} 暫時忙碌，${next}`, err?.message);
            if (i < models.length - 1) await sleep(delayMs);
        }
    }
    const busyError: any = new Error('AI 服務暫時忙碌，請稍後再試');
    busyError.isAllModelsBusy = true;
    busyError.cause = lastError;
    throw busyError;
}
