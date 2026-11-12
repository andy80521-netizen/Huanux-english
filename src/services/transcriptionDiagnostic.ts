import { collection, deleteDoc, doc, getDoc, getDocs, onSnapshot } from 'firebase/firestore';
import { auth, db, appId } from '../firebase';
import type { Material } from '../types';

// 時間軸診斷（前端）：觸發、監聽、下載、刪除
// 規劃：docs/plans/timestamp-baseline.md（擁有者 2026-11-12 核准）

export interface DiagnosticProviderSummary {
    status: 'done' | 'error';
    model?: string;
    wordsStatus?: 'ok' | 'missing' | 'unsupported-word' | 'unsupported-param' | null;
    notes?: string[];
    error?: string | null;
    durationMs?: number | null;
    segmentCount?: number;
    wordCount?: number;
    parts?: number;
}

export interface TranscriptionDiagnostic {
    status?: 'running' | 'done' | 'error';
    startedAt?: number;
    finishedAt?: number | null;
    error?: string | null;
    title?: string | null;
    providers?: Record<string, DiagnosticProviderSummary>;
}

interface SegmentRow { t: string; s: number; e: number }
interface WordColumns { w: string[]; s: number[]; e: number[] }
interface ProviderPart { segments?: SegmentRow[]; words?: WordColumns }

/** 同 netlify/shared/transcribeDiagnostic.ts：分塊資料依序組回 */
export function reassembleProviderData(parts: ProviderPart[]): { segments: SegmentRow[]; words: WordColumns | null } {
    const segments: SegmentRow[] = [];
    let words: WordColumns | null = null;
    for (const p of parts) {
        if (p.segments) segments.push(...p.segments);
        if (p.words) {
            if (!words) words = { w: [], s: [], e: [] };
            words.w.push(...p.words.w);
            words.s.push(...p.words.s);
            words.e.push(...p.words.e);
        }
    }
    return { segments, words };
}

const PROVIDERS = ['openai', 'groq'] as const;

const basePath = (uid: string, materialId: string) => `artifacts/${appId}/users/${uid}/transcriptionDiagnostics/${materialId}`;
const requireUid = () => {
    const uid = auth.currentUser?.uid;
    if (!uid) throw new Error('請先登入');
    return uid;
};

export function subscribeTranscriptionDiagnostic(materialId: string, cb: (d: TranscriptionDiagnostic | null) => void): () => void {
    const uid = auth.currentUser?.uid;
    if (!uid) { cb(null); return () => {}; }
    return onSnapshot(doc(db, basePath(uid, materialId)), (snap) => cb(snap.exists() ? (snap.data() as TranscriptionDiagnostic) : null), () => cb(null));
}

/** 請伺服器開始診斷（背景執行；同一份教材 10 分鐘內只會執行一次） */
export async function startTranscriptionDiagnostic(materialId: string): Promise<void> {
    const user = auth.currentUser;
    if (!user) throw new Error('請先登入');
    const idToken = await user.getIdToken();
    const res = await fetch('/.netlify/functions/transcribe-diagnostic', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken, materialId }),
    });
    if (!res.ok) throw new Error(`沒有叫到伺服器（HTTP ${res.status}），請稍後再試`);
}

/** 下載：兩家原始資料＋這份教材目前每一句的時間（含原始時間、是否刪除） */
export async function downloadTranscriptionDiagnostic(material: Material): Promise<void> {
    const uid = requireUid();
    const base = basePath(uid, material.id);
    const main = await getDoc(doc(db, base));
    if (!main.exists()) throw new Error('還沒有診斷資料');
    const d = main.data() as TranscriptionDiagnostic;
    const providers: Record<string, unknown> = {};
    for (const name of PROVIDERS) {
        const summary = d.providers?.[name];
        if (!summary) continue;
        const parts: ProviderPart[] = [];
        for (let i = 0; i < (summary.parts ?? 0); i++) {
            const p = await getDoc(doc(db, `${base}/parts/${name}-${i}`));
            if (!p.exists()) throw new Error(`診斷資料不完整（${name} 第 ${i + 1} 塊），請重新診斷`);
            parts.push(p.data() as ProviderPart);
        }
        providers[name] = { summary, ...reassembleProviderData(parts) };
    }
    const payload = {
        format: 'huanux-timeline-diagnostic',
        version: 1,
        exportedAt: new Date().toISOString(),
        diagnostic: { status: d.status, startedAt: d.startedAt, finishedAt: d.finishedAt },
        material: {
            id: material.id,
            title: material.title,
            sentences: material.sentences.map((s, index) => ({
                index,
                id: s.id,
                text: s.text,
                startTime: s.startTime,
                endTime: s.endTime,
                originalStartTime: s.originalStartTime ?? null,
                originalEndTime: s.originalEndTime ?? null,
                deleted: !!s.deleted,
                lowConfidence: !!(s as any).lowConfidence,
            })),
        },
        providers,
    };
    const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `timeline-diagnostic-${material.id}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** 刪除診斷資料（含所有分塊） */
export async function deleteTranscriptionDiagnostic(materialId: string): Promise<void> {
    const uid = requireUid();
    const base = basePath(uid, materialId);
    const parts = await getDocs(collection(db, `${base}/parts`));
    await Promise.all(parts.docs.map((p) => deleteDoc(p.ref)));
    await deleteDoc(doc(db, base));
}
