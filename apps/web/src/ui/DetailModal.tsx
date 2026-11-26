import { useContext, useEffect, useState } from 'react';
import type { MediaItem } from '@umh/types';
import { absUrl, fetchChildren, fetchItem } from '../backend';
import { AppCtx, navigate } from '../App';
import { Icon } from './icons';
import { formatDuration, typeLabel } from './MediaCard';

export default function DetailModal({ item, onClose }: { item: MediaItem; onClose: () => void }) {
  const { openItem } = useContext(AppCtx);
  const [detail, setDetail] = useState<MediaItem>(item);
  const [children, setChildren] = useState<MediaItem[]>([]);
  const [seasonChildren, setSeasonChildren] = useState<Record<string, MediaItem[]>>({});
  const [openSeason, setOpenSeason] = useState<string | null>(null);

  useEffect(() => {
    fetchItem(item.id).then(setDetail).catch(() => {});
    fetchChildren(item.id)
      .then((c) => {
        setChildren(c);
        if (c.length && c[0].type === 'season') setOpenSeason(c[0].id);
      })
      .catch(() => {});
  }, [item.id]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const loadSeason = (seasonId: string) => {
    if (seasonChildren[seasonId]) {
      setOpenSeason(openSeason === seasonId ? null : seasonId);
      return;
    }
    fetchChildren(seasonId)
      .then((eps) => {
        setSeasonChildren((m) => ({ ...m, [seasonId]: eps }));
        setOpenSeason(seasonId);
      })
      .catch(() => {});
  };

  const play = (it: MediaItem) => {
    onClose();
    navigate(`/play?ref=${encodeURIComponent(it.id)}`);
  };

  const isShow = detail.type === 'show' && children.length > 0;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-hero">
          {detail.backdrop && <img src={absUrl(detail.backdrop)} alt="" referrerPolicy="no-referrer" />}
          <button className="modal-close" onClick={onClose} aria-label="Fermer">
            <Icon name="x" size={20} />
          </button>
        </div>
        <div className="modal-body">
          <div className="modal-poster">
            {detail.poster ? <img src={absUrl(detail.poster)} alt={detail.title} referrerPolicy="no-referrer" /> : <div className="card-fallback"><span>{detail.title}</span></div>}
          </div>
          <div className="modal-info">
            <h2>{detail.title}</h2>
            <div className="modal-meta">
              {detail.year && <span>{detail.year}</span>}
              {detail.duration && <span>{formatDuration(detail.duration)}</span>}
              {detail.rating && <span>★ {detail.rating.toFixed(1)}</span>}
              <span>{typeLabel(detail.type)}</span>
              {detail.libraryName && <span>{detail.libraryName}</span>}
            </div>
            {detail.genres && detail.genres.length > 0 && (
              <div className="chips">
                {detail.genres.map((g) => <span className="chip" key={g}>{g}</span>)}
              </div>
            )}
            {detail.overview && <p className="modal-overview">{detail.overview}</p>}
            <div className="modal-actions">
              {detail.type !== 'show' && detail.type !== 'season' && (
                <button className="btn btn-accent" onClick={() => play(detail)}>
                  <Icon name="play" size={18} /> Lecture
                </button>
              )}
              <button className="btn btn-ghost" onClick={() => openItem(detail)}>
                <Icon name="search" size={17} /> Ouvrir
              </button>
            </div>
            {isShow && (
              <div className="episode-list">
                <h3>Épisodes</h3>
                {children.map((s) => (
                  <div key={s.id}>
                    <button className="episode" onClick={() => loadSeason(s.id)}>
                      <span className="ep-num">S{s.seasonNumber ?? '?'}</span>
                      <span className="ep-body">
                        <span className="ep-title">{s.title}</span>
                      </span>
                      <Icon name={openSeason === s.id ? 'chevron-down' : 'chevron-right'} size={18} />
                    </button>
                    {openSeason === s.id && (seasonChildren[s.id] ?? []).map((ep) => (
                      <button className="episode" key={ep.id} style={{ paddingLeft: 56 }} onClick={() => play(ep)}>
                        <span className="ep-num">E{ep.episodeNumber ?? '?'}</span>
                        <span className="ep-body">
                          <span className="ep-title">{ep.title}</span>
                          <span className="ep-meta">{ep.duration ? formatDuration(ep.duration) : ''}</span>
                        </span>
                        <span className="ep-play"><Icon name="play" size={18} /></span>
                      </button>
                    ))}
                  </div>
                ))}
              </div>
            )}
            {!isShow && children.length > 0 && (
              <div className="episode-list">
                {children.map((c) => (
                  <button className="episode" key={c.id} onClick={() => play(c)}>
                    <span className="ep-body">
                      <span className="ep-title">{c.title}</span>
                    </span>
                    <span className="ep-play"><Icon name="play" size={18} /></span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
