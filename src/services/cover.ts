import { auth, db, appId } from '../firebase';
import { doc, updateDoc } from 'firebase/firestore';
import { CoverStyle } from '../types';

export function buildCoverExcerpt(sentences: { text: string }[]): string {
    let result = '';
    for (const s of sentences) {
        if (!s.text) continue;
        const piece = (result ? ' ' : '') + s.text.trim();
        if (result.length + piece.length > 800) {
            const remaining = 800 - result.length;
            if (remaining > 0) {
                result += piece.slice(0, remaining);
            }
            break;
        }
        result += piece;
    }
    return result;
}

export async function startCoverGeneration(
    materialId: string,
    style: CoverStyle,
    title: string,
    excerpt: string
): Promise<void> {
    const user = auth.currentUser;
    if (!user) {
        console.error('[封面] 未登入，無法產生封面');
        return;
    }

    try {
        const idToken = await user.getIdToken();
        const res = await fetch('/.netlify/functions/generate-cover', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                idToken,
                materialId,
                style,
                title,
                excerpt
            })
        });

        if (!res.ok) {
            const errText = await res.text();
            throw new Error(`產生封面背景任務回應異常 (${res.status}): ${errText}`);
        }
    } catch (err: any) {
        console.error('[封面] 啟動封面產生失敗:', err);
        try {
            const materialRef = doc(db, 'artifacts', appId, 'users', user.uid, 'materials', materialId);
            await updateDoc(materialRef, {
                coverStatus: 'error',
                coverError: err?.message || '啟動封面產生失敗'
            });
        } catch (dbErr) {
            console.error('[封面] 更新錯誤狀態至 Firestore 失敗:', dbErr);
        }
    }
}
