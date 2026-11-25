import { useContext, useEffect, useState } from 'react';
import type { Library, MediaItem, ProgressEntry } from '@umh/types';
import { fetchContinue, fetchLibraryItems, fetchProviders } from '../backend';
import { AppCtx, navigate } from '../App';
import Hero from '../ui/Hero';
import Row from '../ui/Row';
import { Icon } from '../ui/icons';

export default function Home() {
  const { libraries, refreshLibraries } = useContext(AppCtx);
  const [continueWatching, setContinueWatching] = useState<ProgressEntry[]>([]);
  const [rows, setRows] = useState<{ lib: Library; items: MediaItem[] }[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchProviders()
      .then((ps) => {
        if (ps.length === 0) setError('Aucune source configurée');
      })
      .catch(() => {});
    fetchContinue()
      .then((r) => setContinueWatching(r.items.filter((e) => e.item)))
      .catch(() => {});
    refreshLibraries();
  }, [refreshLibraries]);

  useEffect(() => {
    if (!libraries.length) return;
    let cancelled = false;
    Promise.all(
      libraries.slice(0, 12).map((lib) =>
        fetchLibraryItems(lib.provider, lib.id, { limit: 18, sort: 'dateAdded' })
          .then((r) => ({ lib, items: r.items }))
          .catch(() => ({ lib, items: [] as MediaItem[] })),
      ),
    ).then((rs) => {
      if (!cancelled) setRows(rs.filter((r) => r.items.length > 0));
    });
    return () => {
      cancelled = true;
    };
  }, [libraries]);

  const heroItem = continueWatching[0]?.item ?? rows[0]?.items.find((i) => i.backdrop) ?? rows[0]?.items[0];

  return (
    <div>
      {heroItem && <Hero item={heroItem} />}
      {error && (
        <div className="error-box">
          <Icon name="alert" size={20} />
          <div>
            {error}. <button className="btn btn-accent btn-small" onClick={() => navigate('/settings')}>Connecter une source</button>
          </div>
        </div>
      )}
      {!error && !heroItem && rows.length === 0 && (
        <div className="empty">
          <div className="big">🎬</div>
          <p>Bienvenue dans MediaHub.<br />Connectez Plex, Jellyfin, Emby, Kodi, Streamio ou un dossier local pour commencer.</p>
          <button className="btn btn-accent" onClick={() => navigate('/settings')}>
            <Icon name="plus" size={18} /> Ajouter ma première source
          </button>
        </div>
      )}
      {continueWatching.length > 0 && (
        <Row title="Reprendre la lecture" items={continueWatching.map((e) => e.item!).filter(Boolean)} />
      )}
      {rows.map(({ lib, items }) => (
        <Row
          key={`${lib.provider}:${lib.id}`}
          title={
            <a
              href={`#/library/${encodeURIComponent(`${lib.provider}/${lib.id}`)}`}
              onClick={(e) => {
                e.preventDefault();
                window.location.hash = `#/library/${encodeURIComponent(`${lib.provider}/${lib.id}`)}`;
              }}
            >
              {lib.name}
            </a>
          }
          items={items}
        />
      ))}
    </div>
  );
}
