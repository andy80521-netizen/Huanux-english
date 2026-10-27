import React, { useEffect, useRef, useState } from 'react';
import { collection, onSnapshot } from 'firebase/firestore';
import { db, auth, appId } from '../firebase';
import { Play, Pause } from 'lucide-react';

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
    <section className="flex flex-col gap-3">
      <audio ref={audioRef} className="hidden" preload="none" onTimeUpdate={handleTimeUpdate} onEnded={() => setPlayingId(null)} onPause={() => setPlayingId(null)} />
      <div className="flex flex-col gap-1">
        <h2 className="text-[15px] font-bold text-ink">在教材中出現</h2>
        {sightings.length > 0 && (
          <p className="text-xs text-muted">
            在 {materialCount} 份教材出現 {sightings.length} 次，親口念過 {activeTotal} 次
          </p>
        )}
      </div>

      {sightings.length === 0 ? (
        <p className="py-4 text-sm leading-relaxed text-muted">
          還沒有在其他教材遇到這個句型。匯入新教材後會自動比對，舊教材可以在教材頁按「比對已學句型」。
        </p>
      ) : (
        <ul className="flex flex-col gap-2.5">
          {sightings.map(s => (
            <li key={s.id} className="flex items-start gap-3 rounded-2xl border border-line bg-surface p-3.5">
              <button
                type="button"
                onClick={() => handlePlay(s)}
                disabled={!s.audioUrl}
                aria-label={playingId === s.id ? '暫停原音' : '播放原音'}
                title="播放原音"
                className="flex size-10 shrink-0 items-center justify-center rounded-full bg-accent-soft text-ink transition-[filter] hover:brightness-[0.97] disabled:opacity-40 dark:hover:brightness-110 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
              >
                {playingId === s.id ? <Pause size={15} className="fill-current" aria-hidden="true" /> : <Play size={15} className="ml-0.5 fill-current" aria-hidden="true" />}
              </button>
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <p lang="en" className="font-reading text-[17px] leading-snug text-ink break-words">{s.text}</p>
                {s.translation && <p className="text-[13px] text-muted">{s.translation}</p>}
                <p className="text-[11px] text-muted break-words">
                  {s.materialTitle || '教材'}
                  {(s.activeCount || 0) > 0 && <span className="text-ink">・親口念過 {s.activeCount} 次</span>}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
