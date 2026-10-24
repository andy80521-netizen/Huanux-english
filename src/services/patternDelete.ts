import { collection, doc, getDocs, deleteDoc } from 'firebase/firestore';
import { db, auth, appId } from '../firebase';

// 刪除句型：先刪重逢紀錄子集合（Firestore 刪除文件時不會自動刪除子集合），再刪句型文件
export async function deletePattern(patternId: string): Promise<void> {
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error('請先登入');
  const base = `artifacts/${appId}/users/${uid}/languagePatterns`;
  const sightingsSnap = await getDocs(collection(db, `${base}/${patternId}/sightings`));
  await Promise.all(sightingsSnap.docs.map(d => deleteDoc(d.ref)));
  await deleteDoc(doc(db, base, patternId));
}

// 依序刪除多個句型；回傳成功與失敗的數量（一個失敗不影響其他）
export async function deletePatterns(
  patternIds: string[],
  onProgress?: (done: number, total: number) => void
): Promise<{ deleted: number; failed: number }> {
  let deleted = 0;
  let failed = 0;
  for (const id of patternIds) {
    try {
      await deletePattern(id);
      deleted++;
    } catch (err) {
      console.error('刪除句型失敗:', id, err);
      failed++;
    }
    onProgress?.(deleted + failed, patternIds.length);
  }
  return { deleted, failed };
}
