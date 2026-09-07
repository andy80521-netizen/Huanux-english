import React, { useState, useEffect } from 'react';
import { Material } from '../types';
import { auth, db, storage, appId } from '../firebase';
import { collection, query, onSnapshot, deleteDoc, doc, orderBy } from 'firebase/firestore';
import { ref, deleteObject } from 'firebase/storage';
import { Plus, Trash2, AlertTriangle, BookOpen, AlertCircle, User } from 'lucide-react';

const ConfirmDialog: React.FC<{
  isOpen: boolean;
  title: string;
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
  confirmText?: string;
  cancelText?: string;
}> = ({ isOpen, title, message, onConfirm, onCancel, confirmText = "確定", cancelText = "取消" }) => {
  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 backdrop-blur-sm p-4 animate-in fade-in duration-200">
      <div className="bg-white dark:bg-slate-900 rounded-[2rem] p-8 w-full max-w-xs shadow-2xl animate-in zoom-in-95 duration-200 text-center border border-slate-100 dark:border-slate-800">
        <div className="w-16 h-16 bg-red-50 dark:bg-red-900/20 rounded-full flex items-center justify-center mx-auto mb-6">
          <AlertTriangle className="text-red-500 dark:text-red-400" size={32} />
        </div>
        <h3 className="text-2xl font-black text-slate-800 dark:text-white mb-2">{title}</h3>
        <p className="text-slate-500 dark:text-slate-400 mb-8 leading-relaxed">{message}</p>
        <div className="flex gap-4">
          <button 
            onClick={onCancel} 
            className="flex-1 py-3.5 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 font-bold rounded-2xl hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
          >
            {cancelText}
          </button>
          <button 
            onClick={onConfirm} 
            className="flex-1 py-3.5 bg-red-500 text-white font-bold rounded-2xl shadow-lg shadow-red-200 dark:shadow-none hover:bg-red-600 transition-all active:scale-95"
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
};

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
            // Delete Firestore doc
            await deleteDoc(doc(db, `artifacts/${appId}/users/${uid}/materials`, deleteModal.materialId));
            
            // Delete Storage file
            const storageRef = ref(storage, `artifacts/${appId}/users/${uid}/materials/${deleteModal.materialId}.mp3`);
            try {
                await deleteObject(storageRef);
            } catch (storageErr: any) {
                // If the file doesn't exist, we can ignore the storage error
                if (storageErr.code !== 'storage/object-not-found') {
                    console.error("Storage delete error:", storageErr);
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
            <div className="flex flex-col h-full bg-slate-50 dark:bg-slate-950 p-6 items-center justify-center text-slate-400">
                載入中...
            </div>
        );
    }

    if (uid === null) {
        return (
            <div className="flex flex-col h-full bg-slate-50 dark:bg-slate-950 p-6 items-center justify-center text-center">
                <div className="w-20 h-20 bg-slate-200 dark:bg-slate-800 rounded-full flex items-center justify-center mb-6 text-slate-400 dark:text-slate-500">
                    <User size={40} />
                </div>
                <h3 className="text-xl font-bold text-slate-700 dark:text-slate-300 mb-2">請先登入</h3>
                <p className="text-slate-500 dark:text-slate-400 max-w-sm">
                    請先至「個人」頁面登入才能使用教材匯入與跟讀練習功能。
                </p>
            </div>
        );
    }

    return (
        <div className="flex flex-col h-full bg-slate-50 dark:bg-slate-950 p-6 overflow-y-auto pb-20">
            <div className="flex items-center justify-between mb-8">
                <h2 className="text-2xl font-black text-slate-800 dark:text-white">我的教材庫</h2>
                <button 
                    onClick={onAddClick}
                    className="px-4 py-2 bg-indigo-600 text-white font-bold rounded-xl shadow-md hover:bg-indigo-700 transition-colors flex items-center gap-2"
                >
                    <Plus size={18} />
                    匯入新教材
                </button>
            </div>

            {error && (
                <div className="mb-6 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 text-sm px-4 py-3 rounded-xl flex items-center gap-2 shadow-sm border border-red-100 dark:border-red-800">
                    <AlertCircle size={16} className="shrink-0" />
                    <span className="font-bold leading-relaxed">{error}</span>
                </div>
            )}

            {materials.length === 0 ? (
                <div className="flex flex-col items-center justify-center flex-1 py-20 text-center">
                    <div className="w-20 h-20 bg-slate-200 dark:bg-slate-800 rounded-full flex items-center justify-center mb-6 text-slate-400 dark:text-slate-500">
                        <BookOpen size={40} />
                    </div>
                    <h3 className="text-xl font-bold text-slate-700 dark:text-slate-300 mb-2">尚無任何教材</h3>
                    <p className="text-slate-500 dark:text-slate-400 mb-8 max-w-sm">
                        點擊上方按鈕匯入新教材，開始您的跟讀訓練與語言學習。
                    </p>
                    <button 
                        onClick={onAddClick}
                        className="px-6 py-3 bg-indigo-600 text-white font-bold rounded-xl shadow-lg shadow-indigo-200 dark:shadow-none hover:bg-indigo-700 transition-all active:scale-95 flex items-center gap-2"
                    >
                        <Plus size={20} />
                        立即匯入
                    </button>
                </div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {materials.map((m) => {
                        const completedCount = m.sentences.filter(s => s.mastery >= 1000).length;
                        return (
                            <div key={m.id} className="bg-white dark:bg-slate-900 rounded-2xl p-5 shadow-sm border border-slate-200 dark:border-slate-800 hover:shadow-md transition-shadow flex flex-col group cursor-pointer" onClick={() => onMaterialClick(m)}>
                                <div className="flex justify-between items-start mb-4">
                                    <h3 className="text-lg font-bold text-slate-800 dark:text-white line-clamp-2 pr-4">{m.title}</h3>
                                    <button 
                                        onClick={(e) => { e.stopPropagation(); setDeleteModal({ isOpen: true, materialId: m.id, title: m.title }); }}
                                        className="p-2 text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/30 rounded-lg transition-colors shrink-0 md:opacity-0 group-hover:opacity-100 focus:opacity-100"
                                        title="刪除教材"
                                    >
                                        <Trash2 size={18} />
                                    </button>
                                </div>
                                
                                <div className="mt-auto pt-4 flex items-center justify-between text-sm">
                                    <div className="text-slate-500 dark:text-slate-400 font-medium">
                                        {new Date(m.createdAt).toLocaleDateString()}
                                    </div>
                                    <div className="bg-slate-100 dark:bg-slate-800 px-3 py-1 rounded-full font-bold text-slate-700 dark:text-slate-300 text-xs">
                                        進度 {completedCount}/{m.sentences.length} 句
                                    </div>
                                </div>
                            </div>
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
