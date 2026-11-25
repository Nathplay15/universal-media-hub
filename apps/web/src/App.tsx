import { createContext, useCallback, useEffect, useMemo, useState } from 'react';
import type { Library, MediaItem } from '@umh/types';
import { fetchLibraries } from './api';
import Layout from './ui/Layout';
import Home from './pages/Home';
import LibraryPage from './pages/LibraryPage';
import SettingsPage from './pages/SettingsPage';
import PlayerPage from './pages/PlayerPage';
import DetailModal from './ui/DetailModal';
import SearchOverlay from './ui/SearchOverlay';

export interface AppCtxValue {
  libraries: Library[];
  refreshLibraries: () => void;
  openItem: (item: MediaItem) => void;
  searchOpen: boolean;
  setSearchOpen: (v: boolean) => void;
}

export const AppCtx = createContext<AppCtxValue>({} as AppCtxValue);

function useHash(): string {
  const [hash, setHash] = useState(window.location.hash);
  useEffect(() => {
    const onChange = () => setHash(window.location.hash);
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return hash;
}

export function navigate(to: string): void {
  window.location.hash = to;
}

export default function App() {
  const hash = useHash();
  const [libraries, setLibraries] = useState<Library[]>([]);
  const [selected, setSelected] = useState<MediaItem | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);

  const refreshLibraries = useCallback(() => {
    fetchLibraries()
      .then(setLibraries)
      .catch(() => setLibraries([]));
  }, []);

  useEffect(() => {
    refreshLibraries();
  }, [refreshLibraries]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const typing = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
      if (e.key === '/' && !typing) {
        e.preventDefault();
        setSearchOpen((v) => !v);
      }
      if (e.key === 'Escape' && !typing) setSearchOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const ctx = useMemo<AppCtxValue>(
    () => ({ libraries, refreshLibraries, openItem: setSelected, searchOpen, setSearchOpen }),
    [libraries, refreshLibraries, searchOpen],
  );

  const clean = hash.replace(/^#/, '') || '/';
  const qIndex = clean.indexOf('?');
  const path = qIndex >= 0 ? clean.slice(0, qIndex) : clean;
  const params = new URLSearchParams(qIndex >= 0 ? clean.slice(qIndex + 1) : '');

  let page: JSX.Element;
  if (path.startsWith('/library/')) {
    page = <LibraryPage key={path} encoded={path.slice('/library/'.length)} />;
  } else if (path === '/settings') {
    page = <SettingsPage />;
  } else if (path === '/play') {
    page = <PlayerPage refParam={params.get('ref') ?? ''} />;
  } else {
    page = <Home />;
  }

  return (
    <AppCtx.Provider value={ctx}>
      <Layout currentPath={path}>
        {page}
      </Layout>
      {selected && <DetailModal item={selected} onClose={() => setSelected(null)} />}
      {searchOpen && <SearchOverlay onClose={() => setSearchOpen(false)} />}
    </AppCtx.Provider>
  );
}
