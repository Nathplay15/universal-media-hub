import { useContext, useEffect, useRef, useState } from 'react';
import type { MediaItem } from '@umh/types';
import { search } from '../api';
import { AppCtx } from '../App';
import MediaCard from './MediaCard';
import { Icon } from './icons';

export default function SearchOverlay({ onClose }: { onClose: () => void }) {
  const { openItem } = useContext(AppCtx);
  const [q, setQ] = useState('');
  const [results, setResults] = useState<MediaItem[] | null>(null);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const query = q.trim();
    if (!query) {
      setResults(null);
      return;
    }
    setLoading(true);
    const t = setTimeout(() => {
      search(query)
        .then((r) => setResults(r.items))
        .catch(() => setResults([]))
        .finally(() => setLoading(false));
    }, 280);
    return () => clearTimeout(t);
  }, [q]);

  const pick = (item: MediaItem) => {
    onClose();
    openItem(item);
  };

  return (
    <div className="search-overlay" onClick={onClose}>
      <div className="search-box" onClick={(e) => e.stopPropagation()}>
        <div className="search-input-row">
          <Icon name="search" size={24} />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Rechercher un film, une série, un épisode…"
            onKeyDown={(e) => {
              if (e.key === 'Escape') onClose();
              if (e.key === 'Enter' && results?.length) pick(results[0]);
            }}
          />
          <button className="icon-btn" onClick={onClose} aria-label="Fermer">
            <Icon name="x" size={18} />
          </button>
        </div>
        {!q.trim() && <div className="search-hint">La recherche fédère toutes vos sources connectées (Plex, Jellyfin, Emby, Kodi, fichiers locaux…). Appuyez sur Échap pour fermer.</div>}
        {loading && (
          <div className="loading-center">
            <div className="spinner" />
          </div>
        )}
        {results && !loading && results.length === 0 && <div className="empty">Aucun résultat pour « {q.trim()} »</div>}
        {results && results.length > 0 && (
          <div className="search-results">
            {results.map((it) => (
              <MediaCard key={it.id} item={it} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
