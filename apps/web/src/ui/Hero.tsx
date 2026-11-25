import { useContext } from 'react';
import type { MediaItem } from '@umh/types';
import { AppCtx, navigate } from '../App';
import { absUrl } from '../backend';
import { Icon } from './icons';
import { formatDuration } from './MediaCard';

export default function Hero({ item }: { item: MediaItem }) {
  const { openItem } = useContext(AppCtx);
  return (
    <header className="hero">
      <div className="hero-bg">{item.backdrop && <img src={absUrl(item.backdrop)} alt="" referrerPolicy="no-referrer" />}</div>
      <div className="hero-content">
        <div className="hero-kicker">À la une</div>
        <h1 className="hero-title">{item.title}</h1>
        <div className="hero-meta">
          {item.year && <span>{item.year}</span>}
          {item.duration && <span>{formatDuration(item.duration)}</span>}
          {item.rating && <span>★ {item.rating.toFixed(1)}</span>}
          {item.genres?.slice(0, 3).map((g) => <span key={g}>{g}</span>)}
        </div>
        {item.overview && <p className="hero-overview">{item.overview}</p>}
        <div className="hero-actions">
          <button className="btn btn-accent" onClick={() => navigate(`/play?ref=${encodeURIComponent(item.id)}`)}>
            <Icon name="play" size={19} /> Lecture
          </button>
          <button className="btn btn-ghost" onClick={() => openItem(item)}>
            <Icon name="info" size={18} /> Détails
          </button>
        </div>
      </div>
    </header>
  );
}
