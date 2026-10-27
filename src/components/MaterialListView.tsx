import React, { useState, useEffect } from 'react';
import { Material } from '../types';
import { auth, db, storage, appId } from '../firebase';
import { collection, query, onSnapshot, deleteDoc, doc, orderBy } from 'firebase/firestore';
import { ref, deleteObject } from 'firebase/storage';
import { Plus, Trash2, BookOpen, AlertCircle, User, Loader2 } from 'lucide-react';
import ConfirmDialog from './ConfirmDialog';
import Button from './ui/Button';
import IconButton from './ui/IconButton';
import ProgressBar from './ui/ProgressBar';
import { materialProgress } from '../utils/materialProgress';
import { deleteMaterialSightings } from '../services/sightings';

export default function MaterialListView({ onAddClick, onMaterialClick }: { onAddClick: () => void, onMaterialClick: (m: Material) => void }) {
    const [materials, setMaterials] = useState<Material[]>([]);
    const [loading, setLoading] = useState(true);
    const [uid, setUid] = useState<string | null | undefined>(undefined);
    const [deleteModal, setDeleteModal] = useState<{ isOpen: boolean; materialId: string | null; title: string }>({ isOpen: false, materialId: null, title: '' });
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        const currentUid = auth.currentUser?.uid;
        if (!currentUid) {
            setUid(null);
            setLoading(false);
            return;
        }
        setUid(currentUid);

        const q = query(
            collection(db, `artifacts/${appId}/users/${currentUid}/materials`),
            orderBy('createdAt', 'desc')
        );

        const unsubscribe = onSnapshot(q, (snapshot) => {
            const mats: Material[] = [];
            snapshot.forEach((doc) => {
                mats.push(doc.data() as Material);
            });
            setMaterials(mats);
            setLoading(false);
        }, (err) => {
            console.error("[監聽來源:MaterialListView-materials]", err);
            console.error("Error fetching materials: ", err);
            setError("無法讀取教材列表");
            setLoading(false);
        });

        return () => unsubscribe();
    }, []);

    const handleDelete = async () => {
        if (!deleteModal.materialId) return;
        const uid = auth.currentUser?.uid;
        if (!uid) return;
        
        setError(null);
        try {
            const targetMaterial = materials.find(m => m.id === deleteModal.materialId);

            // Delete Firestore doc
            await deleteDoc(doc(db, `artifacts/${appId}/users/${uid}/materials`, deleteModal.materialId));

            // 刪除這份教材的已學句型比對結果與重逢紀錄
            await deleteMaterialSightings(deleteModal.materialId);
            
            // Delete Storage file (mp3)
            const storageRef = ref(storage, `artifacts/${appId}/users/${uid}/materials/${deleteModal.materialId}.mp3`);
            try {
                await deleteObject(storageRef);
            } catch (storageErr: any) {
                // If the file doesn't exist, we can ignore the storage error
                if (storageErr.code !== 'storage/object-not-found') {
                    console.error("Storage delete error:", storageErr);
                }
            }

            // Delete cover image if exists
            if (targetMaterial?.coverPath) {
                const coverStorageRef = ref(storage, targetMaterial.coverPath);
                try {
                    await deleteObject(coverStorageRef);
                } catch (coverErr: any) {
                    if (coverErr.code !== 'storage/object-not-found') {
                        console.error("Cover delete error:", coverErr);
                    }
                }
            }
        } catch (err: any) {
            console.error("Error deleting material: ", err);
            setError("刪除失敗，請稍後再試: " + err.message);
        } finally {
            setDeleteModal({ isOpen: false, materialId: null, title: '' });
        }
    };

    if (loading) {
        return (
            <div className="flex flex-col h-full p-6 items-center justify-center text-muted" role="status">
                載入中...
            </div>
        );
    }

    if (uid === null) {
        return (
            <div className="flex flex-col h-full p-6 items-center justify-center text-center">
                <div className="size-20 rounded-full bg-surface-2 border border-line flex items-center justify-center mb-6 text-muted">
                    <User size={36} strokeWidth={1.6} aria-hidden="true" />
                </div>
                <h3 className="text-xl font-bold text-ink mb-2">請先登入</h3>
                <p className="text-muted max-w-sm leading-relaxed">
                    請先至「個人」頁面登入才能使用教材匯入與跟讀練習功能。
                </p>
            </div>
        );
    }

    return (
        <div className="flex flex-col h-full overflow-y-auto px-5 pt-6 pb-24 sm:px-8 lg:px-12 lg:pt-12 lg:pb-16">
            <div className="flex items-end justify-between gap-4 mb-6 lg:mb-8">
                <div className="flex flex-col gap-1 min-w-0">
                    <h2 className="text-2xl lg:text-[28px] font-bold tracking-wide text-ink">我的教材庫</h2>
                    {materials.length > 0 && <span className="text-[13px] lg:text-sm text-muted">{materials.length} 份教材</span>}
                </div>
                <Button onClick={onAddClick} icon={<Plus size={18} aria-hidden="true" />} className="shrink-0">
                    匯入新教材
                </Button>
            </div>

            {error && (
                <div role="alert" className="mb-6 flex items-center gap-2 rounded-xl bg-danger/10 px-4 py-3 text-sm font-medium text-danger">
                    <AlertCircle size={16} className="shrink-0" aria-hidden="true" />
                    <span className="leading-relaxed break-words">{error}</span>
                </div>
            )}

            {materials.length === 0 ? (
                <div className="flex flex-col items-center justify-center flex-1 py-20 text-center">
                    <div className="size-20 rounded-full bg-surface-2 border border-line flex items-center justify-center mb-6 text-muted">
                        <BookOpen size={36} strokeWidth={1.6} aria-hidden="true" />
                    </div>
                    <h3 className="text-xl font-bold text-ink mb-2">尚無任何教材</h3>
                    <p className="text-muted mb-8 max-w-sm leading-relaxed">
                        點擊上方按鈕匯入新教材，開始您的跟讀訓練與語言學習。
                    </p>
                    <Button onClick={onAddClick} size="lg" icon={<Plus size={20} aria-hidden="true" />}>
                        立即匯入
                    </Button>
                </div>
            ) : (
                <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 lg:gap-6">
                    {materials.map((m) => {
                        const { total, completed } = materialProgress(m.sentences);
                        const coverGenerating = m.coverStatus === 'generating' && m.coverRequestedAt && (Date.now() - m.coverRequestedAt < 5 * 60 * 1000);
                        return (
                            <article key={m.id} className="group relative overflow-hidden rounded-[18px] border border-line bg-surface transition-[border-color,box-shadow,transform] duration-[var(--dur-base)] has-[[data-card-link]:active]:scale-[0.985] hover:border-muted/40 hover:shadow-[0_12px_32px_-16px_rgb(0_0_0/0.25)]">
                                {/* 16:9 封面 */}
                                <div className="relative aspect-video w-full overflow-hidden bg-surface-2 flex items-center justify-center">
                                    {m.coverUrl && m.coverStatus !== 'generating' ? (
                                        <img
                                            src={m.coverUrl}
                                            alt=""
                                            loading="lazy"
                                            width={640}
                                            height={360}
                                            className="h-full w-full object-cover transition-transform duration-[600ms] ease-[var(--ease-out-soft)] group-hover:scale-[1.02]"
                                        />
                                    ) : coverGenerating ? (
                                        <div className="flex flex-col items-center justify-center gap-2 text-accent">
                                            <Loader2 size={22} className="animate-spin" aria-hidden="true" />
                                            <span className="text-xs text-muted">封面產生中</span>
                                        </div>
                                    ) : (
                                        <BookOpen size={32} strokeWidth={1.4} className="text-muted/50" aria-hidden="true" />
                                    )}
                                </div>
                                <div className="flex flex-col gap-3 px-4 pt-4 pb-4 lg:px-5">
                                    <div className="flex items-start gap-1">
                                        <h3 className="flex-1 min-w-0 font-reading text-[21px] leading-[1.25] text-ink line-clamp-2 break-words">
                                            {/* 標題按鈕的點擊範圍延伸到整張卡片（::after），刪除鈕疊在上層、與它同層而不是包在裡面 */}
                                            <button
                                                type="button"
                                                data-card-link
                                                onClick={() => onMaterialClick(m)}
                                                className="text-left after:absolute after:inset-0 after:rounded-[18px] after:content-[''] focus-visible:outline-hidden focus-visible:after:outline-2 focus-visible:after:-outline-offset-2 focus-visible:after:outline-accent"
                                            >
                                                {m.title}
                                            </button>
                                        </h3>
                                        <IconButton
                                            aria-label="刪除教材"
                                            title="刪除教材"
                                            onClick={() => setDeleteModal({ isOpen: true, materialId: m.id, title: m.title })}
                                            className="relative z-10 -mt-2 -mr-2 text-muted hover:text-danger hover:bg-danger/10"
                                        >
                                            <Trash2 size={17} strokeWidth={1.8} aria-hidden="true" />
                                        </IconButton>
                                    </div>
                                    <div className="flex flex-col gap-2">
                                        <div className="flex items-center justify-between text-[13px] text-muted">
                                            <span>{new Date(m.createdAt).toLocaleDateString()}</span>
                                            <span><span className="font-medium text-ink">{completed}</span> / {total} 句畢業</span>
                                        </div>
                                        <ProgressBar value={completed} max={total} label={`${m.title} 進度`} size="sm" />
                                    </div>
                                </div>
                            </article>
                        );
                    })}
                </div>
            )}

            <ConfirmDialog
                isOpen={deleteModal.isOpen}
                title="確認刪除"
                message={`確定要刪除教材「${deleteModal.title}」嗎？此動作將連同音檔一併刪除，無法復原。`}
                onConfirm={handleDelete}
                onCancel={() => setDeleteModal({ isOpen: false, materialId: null, title: '' })}
            />
        </div>
    );
}
