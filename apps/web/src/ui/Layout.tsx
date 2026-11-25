import { useContext, type ReactNode } from 'react';
import { AppCtx, navigate } from '../App';
import { Icon } from './icons';

const TYPE_ICONS: Record<string, string> = {
  movie: 'film',
  show: 'tv',
  season: 'tv',
  episode: 'play',
  track: 'music',
  channel: 'tv',
  video: 'folder',
};

export default function Layout({ currentPath, children }: { currentPath: string; children: ReactNode }) {
  const { libraries, setSearchOpen } = useContext(AppCtx);
  const libPath = (lib: { provider: string; id: string }) => `#/library/${encodeURIComponent(`${lib.provider}/${lib.id}`)}`;

  return (
    <div className="app">
      <nav className="sidebar">
        <div className="logo">
          <span className="logo-badge">
            <Icon name="play" size={17} />
          </span>
          <span>MediaHub</span>
        </div>
        <button className={`nav-item ${currentPath === '/' ? 'active' : ''}`} onClick={() => navigate('/')}>
          <Icon name="home" size={20} />
          <span className="nav-label">Accueil</span>
        </button>
        <button className="nav-item" onClick={() => setSearchOpen(true)}>
          <Icon name="search" size={20} />
          <span className="nav-label">Rechercher</span>
        </button>
        <div className="nav-section">Bibliothèques</div>
        {libraries.length === 0 && (
          <button className="nav-item" onClick={() => navigate('/settings')}>
            <Icon name="plus" size={20} />
            <span className="nav-label">Ajouter une source…</span>
          </button>
        )}
        {libraries.map((lib) => (
          <button
            key={`${lib.provider}:${lib.id}`}
            className={`nav-item ${currentPath.startsWith('/library/') && currentPath.includes(encodeURIComponent(`${lib.provider}/${lib.id}`)) ? 'active' : ''}`}
            onClick={() => (window.location.hash = libPath(lib))}
            title={lib.name}
          >
            <Icon name={TYPE_ICONS[lib.type] ?? 'folder'} size={20} />
            <span className="nav-label">{lib.name}</span>
          </button>
        ))}
        <div className="nav-section">Général</div>
        <button className={`nav-item ${currentPath === '/settings' ? 'active' : ''}`} onClick={() => navigate('/settings')}>
          <Icon name="settings" size={20} />
          <span className="nav-label">Sources & réglages</span>
        </button>
      </nav>
      <main className="main">
        <div className="content">{children}</div>
      </main>
    </div>
  );
}
