import { useContext, useEffect, useState } from 'react';
import type { MediaItem } from '@umh/types';
import { fetchLibraries, fetchLibraryItems } from '../backend';
import { AppCtx } from '../App';
import MediaCard from '../ui/MediaCard';
import { Icon } from '../ui/icons';

const SORTS = [
  { value: 'title', label: 'Titre A→Z' },
  { value: 'dateAdded', label: 'Récents' },
  { value: 'rating', label: 'Mieux notés' },
  { value: 'duration', label: 'Durée' },
];

export default function LibraryPage({ encoded }: { encoded: string }) {
  const { libraries } = useContext(AppCtx);
  const decoded = decodeURIComponent(encoded);
  const sep = decoded.indexOf('/');
  const provider = sep >= 0 ? decoded.slice(0, sep) : decoded;
  const libId = sep >= 0 ? decoded.slice(sep + 1) : '';
  const lib = libraries.find((l) => l.provider === provider && l.id === libId);
  const [items, setItems] = useState<MediaItem[] | null>(null);
  const [total, setTotal] = useState(0);
  const [sort, setSort] = useState('title');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!provider || !libId) return;
    setItems(null);
    setError(null);
    fetchLibraryItems(provider, libId, { limit: 200, sort })
      .then((r) => {
        setItems(r.items);
        setTotal(r.total);
      })
      .catch((e) => setError(e.message));
    fetchLibraries().catch(() => {});
  }, [provider, libId, sort]);

  return (
    <div>
      <div className="page-head">
        <h1>{lib?.name ?? 'Bibliothèque'}</h1>
        {total > 0 && <span className="count">{total} élément{total > 1 ? 's' : ''}</span>}
        <div className="sort-bar">
          <span>Trier :</span>
          <select value={sort} onChange={(e) => setSort(e.target.value)}>
            {SORTS.map((s) => (
              <option key={s.value} value={s.value}>{s.label}</option>
            ))}
          </select>
        </div>
      </div>
      {error && (
        <div className="error-box">
          <Icon name="alert" size={20} />
          <div>{error}</div>
        </div>
      )}
      {!items && !error && (
        <div className="loading-center">
          <div className="spinner" />
        </div>
      )}
      {items && items.length === 0 && (
        <div className="empty">
          <div className="big">📂</div>
          <p>Cette bibliothèque est vide.</p>
        </div>
      )}
      {items && items.length > 0 && (
        <div className="grid">
          {items.map((it) => (
            <MediaCard key={it.id} item={it} />
          ))}
        </div>
      )}
    </div>
  );
}
