import { doc, getDoc, setDoc, onSnapshot } from 'firebase/firestore';
import { db, auth, appId } from '../firebase';

const VOICE_NAME = 'Aoede';
const MAX_TEXT_LENGTH = 500;
const STALE_MS = 2 * 60 * 1000;          // 「產生中」超過 2 分鐘視為卡住，重新請求
const ERROR_RETRY_MS = 10 * 60 * 1000;   // 失敗後 10 分鐘內不重試，避免一直重複請求
const WAIT_TIMEOUT_MS = 60 * 1000;       // 最多等 60 秒

// 快取 key：前後端必須用同一套規則計算（netlify/functions/generate-speech.ts 有相同的實作）
export async function speechCacheKey(text: string): Promise<string> {
  const data = new TextEncoder().encode(`${VOICE_NAME}|${text.trim()}`);
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
