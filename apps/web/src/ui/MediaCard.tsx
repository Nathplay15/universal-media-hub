import { useContext } from 'react';
import type { MediaItem } from '@umh/types';
import { AppCtx } from '../App';
import { absUrl } from '../backend';

export function formatDuration(sec?: number): string {
  if (!sec || !isFinite(sec)) return '';
  const h = Math.floor(sec / 3600);
  const m = Math.round((sec % 3600) / 60);
  return h > 0 ? `${h}h${String(m).padStart(2, '0')}` : `${m} min`;
}

export function typeLabel(t: string): string {
  return { movie: 'Film', show: 'Série', season: 'Saison', episode: 'Épisode', track: 'Musique', channel: 'Chaîne', video: 'Vidéo' }[t] ?? t;
}

export default function MediaCard({ item, progress }: { item: MediaItem; progress?: number }) {
  const { openItem } = useContext(AppCtx);
  const p = progress ?? item.progress;
  return (
    <button className="card" onClick={() => openItem(item)} title={item.title}>
      <div className="card-poster">
        {item.poster ? <img src={absUrl(item.poster)} loading="lazy" alt={item.title} referrerPolicy="no-referrer" /> : <div className="card-fallback"><span>{item.title}</span></div>}
        {p !== undefined && p > 0.01 && p < 0.99 && (
          <div className="card-progress">
            <div style={{ width: `${Math.min(100, Math.round(p * 100))}%` }} />
          </div>
        )}
      </div>
      <div className="card-title">{item.title}</div>
      <div className="card-meta">
        {[item.year, item.duration ? formatDuration(item.duration) : '', item.rating ? `★ ${item.rating.toFixed(1)}` : '', typeLabel(item.type)]
          .filter(Boolean)
          .join(' • ')}
      </div>
    </button>
  );
}
