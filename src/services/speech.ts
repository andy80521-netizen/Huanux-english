import { doc, getDoc, setDoc, onSnapshot } from 'firebase/firestore';
import { db, auth, appId } from '../firebase';

const CACHE_VERSION = 'gcp1';
const MAX_TEXT_LENGTH = 500;
const MAX_BATCH = 30;                     // 預先產生一次最多 30 段
const QUEUED_STALE_MS = 10 * 60 * 1000;   // 「排隊中」超過 10 分鐘視為沒處理到，可重新排入
const STALE_MS = 2 * 60 * 1000;          // 「產生中」超過 2 分鐘視為卡住，重新請求
const ERROR_RETRY_MS = 10 * 60 * 1000;   // 失敗後 10 分鐘內不重試，避免一直重複請求
const WAIT_TIMEOUT_MS = 60 * 1000;       // 最多等 60 秒

// 含中文字用中文聲音，否則用英文聲音（netlify/functions/generate-speech.ts 有相同的判斷）
export function speechLang(text: string): 'zh' | 'en' {
  return /[\u3400-\u9fff\uf900-\ufaff]/.test(text) ? 'zh' : 'en';
}

// 快取 key：前後端必須用同一套規則計算（netlify/functions/generate-speech.ts 有相同的實作）
export async function speechCacheKey(text: string): Promise<string> {
  const clean = text.trim();
  const data = new TextEncoder().encode(`${CACHE_VERSION}|${speechLang(clean)}|${clean}`);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 40);
}

// 取得一段文字的語音網址：有快取直接回傳；沒有就請後端產生並等待完成。
// 失敗或逾時回傳 null，呼叫端略過播放即可。
export async function getSpeechUrl(text: string): Promise<string | null> {
  try {
    const user = auth.currentUser;
    const clean = (text || '').trim();
    if (!user || !clean || clean.length > MAX_TEXT_LENGTH) return null;

    const key = await speechCacheKey(clean);
    const ref = doc(db, `artifacts/${appId}/users/${user.uid}/ttsCache`, key);
    const snap = await getDoc(ref);
    const data: any = snap.exists() ? snap.data() : null;

    if (data?.status === 'done' && data.audioUrl) return data.audioUrl;
    if (data?.status === 'error' && typeof data.updatedAt === 'number' && Date.now() - data.updatedAt < ERROR_RETRY_MS) {
      return null;
    }

    const isGeneratingFresh = data?.status === 'generating'
      && typeof data.requestedAt === 'number'
      && Date.now() - data.requestedAt < STALE_MS;

    if (!isGeneratingFresh) {
      await setDoc(ref, { text: clean, status: 'generating', requestedAt: Date.now() }, { merge: true });
      const idToken = await user.getIdToken();
      fetch('/.netlify/functions/generate-speech', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken, text: clean })
      }).catch(err => console.error('[語音] 送出產生請求失敗:', err));
    }

    return await new Promise<string | null>((resolve) => {
      let finished = false;
      let unsubscribe: () => void = () => {};
      const finish = (url: string | null) => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        unsubscribe();
        resolve(url);
      };
      const timer = setTimeout(() => finish(null), WAIT_TIMEOUT_MS);
      unsubscribe = onSnapshot(ref, (s) => {
        const d: any = s.data();
        if (d?.status === 'done' && d.audioUrl) finish(d.audioUrl);
        else if (d?.status === 'error') finish(null);
      }, () => finish(null));
      if (finished) unsubscribe();
    });
  } catch (err) {
    console.error('[語音] 取得語音失敗:', err);
    return null;
  }
}

// 背景預先產生語音（不等待結果）：略過已完成、排隊或產生中、10 分鐘內失敗過的文字
export async function prefetchSpeech(texts: string[]): Promise<void> {
  try {
    const user = auth.currentUser;
    if (!user) return;
    const unique = Array.from(new Set(
      texts.map(t => (t || '').trim()).filter(t => t.length > 0 && t.length <= MAX_TEXT_LENGTH)
    ));
    const now = Date.now();
    const toRequest: string[] = [];
    for (const text of unique) {
      if (toRequest.length >= MAX_BATCH) break;
      const key = await speechCacheKey(text);
      const ref = doc(db, `artifacts/${appId}/users/${user.uid}/ttsCache`, key);
      const snap = await getDoc(ref);
      const d: any = snap.exists() ? snap.data() : null;
      if (d?.status === 'done' && d.audioUrl) continue;
      if ((d?.status === 'queued' || d?.status === 'generating') && typeof d.requestedAt === 'number' && now - d.requestedAt < QUEUED_STALE_MS) continue;
      if (d?.status === 'error' && typeof d.updatedAt === 'number' && now - d.updatedAt < ERROR_RETRY_MS) continue;
      await setDoc(ref, { text, status: 'queued', requestedAt: now }, { merge: true });
      toRequest.push(text);
    }
    if (toRequest.length === 0) return;
    const idToken = await user.getIdToken();
    fetch('/.netlify/functions/generate-speech', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken, texts: toRequest })
    }).catch(err => console.error('[語音] 送出預先產生請求失敗:', err));
    console.log(`[語音] 已排入預先產生 ${toRequest.length} 段`);
  } catch (err) {
    console.warn('[語音] 預先產生流程失敗:', err);
  }
}
