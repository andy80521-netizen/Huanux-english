import React, { useEffect, useRef, useState } from 'react';
import { collection, onSnapshot } from 'firebase/firestore';
import { db, auth, appId } from '../firebase';
import { Library, Play, Pause } from 'lucide-react';

interface Sighting {
  id: string;
  materialId: string;
  materialTitle?: string;
  sentenceId: string;
  text: string;
  translation?: string;
  audioUrl?: string;
  startTime?: number;
  endTime?: number;
  activeCount?: number;
  updatedAt?: number;
}

// 句型詳情頁：這個句型在哪些教材裡出現過（真實語料），可直接播放原音片段
export default function PatternSightingsSection({ patternId }: { patternId: string }) {
  const [sightings, setSightings] = useState<Sighting[]>([]);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const endTimeRef = useRef<number>(0);

  useEffect(() => {
    const uid = auth.currentUser?.uid;
    if (!uid) return;
    const ref = collection(db, `artifacts/${appId}/users/${uid}/languagePatterns/${patternId}/sightings`);
    const unsubscribe = onSnapshot(ref, (snapshot) => {
      const list = snapshot.docs.map(d => ({ ...(d.data() as Omit<Sighting, 'id'>), id: d.id }));
      list.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
      setSightings(list);
    }, (error) => {
      console.error('[監聽來源:PatternSightingsSection-sightings]', error);
    });
    return () => unsubscribe();
  }, [patternId]);

  useEffect(() => {
    return () => { audioRef.current?.pause(); };
  }, []);

  const handlePlay = (s: Sighting) => {
    const el = audioRef.current;
    if (!el || !s.audioUrl) return;
    if (playingId === s.id) {
      el.pause();
      setPlayingId(null);
      return;
    }
    const start = Math.max(0, s.startTime || 0);
    const end = s.endTime || 0;
    endTimeRef.current = end;
    el.src = `${s.audioUrl}#t=${start}${end > start ? `,${end}` : ''}`;
    el.play().then(() => setPlayingId(s.id)).catch(() => setPlayingId(null));
  };

  const handleTimeUpdate = () => {
    const el = audioRef.current;
    if (el && endTimeRef.current > 0 && el.currentTime >= endTimeRef.current) {
      el.pause();
      setPlayingId(null);
    }
  };

  const materialCount = new Set(sightings.map(s => s.materialId)).size;
  const activeTotal = sightings.reduce((sum, s) => sum + (s.activeCount || 0), 0);

  return (
    <div className="space-y-4 mt-8">
      <audio ref={audioRef} className="hidden" preload="none" onTimeUpdate={handleTimeUpdate} onEnded={() => setPlayingId(null)} onPause={() => setPlayingId(null)} />
      <div>
        <h3 className="text-lg font-black text-slate-800 dark:text-white flex items-center gap-2">
          <Library size={20} className="text-purple-500" />
          在教材中出現
        </h3>
        {sightings.length > 0 && (
          <p className="text-xs font-bold text-slate-500 dark:text-slate-400 mt-1">
            在 {materialCount} 份教材出現 {sightings.length} 次，親口念過 {activeTotal} 次
          </p>
        )}
      </div>

      {sightings.length === 0 ? (
        <p className="text-sm font-bold text-slate-400 dark:text-slate-500 py-4 text-center">
          還沒有在其他教材遇到這個句型。匯入新教材後會自動比對，舊教材可以在教材頁按「比對已學句型」。
        </p>
      ) : (
        <div className="space-y-3">
          {sightings.map(s => (
            <div key={s.id} className="bg-white dark:bg-slate-900 rounded-xl p-4 shadow-xs border border-slate-200 dark:border-slate-800 flex items-start gap-3">
              <button
                onClick={() => handlePlay(s)}
                disabled={!s.audioUrl}
                className="shrink-0 w-10 h-10 rounded-xl flex items-center justify-center bg-purple-50 text-purple-600 dark:bg-purple-900/30 dark:text-purple-300 hover:bg-purple-100 dark:hover:bg-purple-900/50 transition-colors disabled:opacity-40"
                title="播放原音"
              >
                {playingId === s.id ? <Pause size={18} className="fill-current" /> : <Play size={18} className="fill-current ml-0.5" />}
              </button>
              <div className="flex-1 min-w-0">
                <p className="font-bold text-slate-800 dark:text-slate-200 leading-relaxed">{s.text}</p>
                {s.translation && <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">{s.translation}</p>}
                <div className="flex flex-wrap items-center gap-2 mt-2">
                  <span className="text-[11px] font-bold text-slate-400 dark:text-slate-500 truncate max-w-[200px]">
                    {s.materialTitle || '教材'}
                  </span>
                  {(s.activeCount || 0) > 0 && (
                    <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">
                      親口念過 {s.activeCount} 次
                    </span>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
