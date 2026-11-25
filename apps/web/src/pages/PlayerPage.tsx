import { useEffect, useState } from 'react';
import type { MediaItem, StreamInfo } from '@umh/types';
import { fetchItem, fetchStream } from '../api';
import { navigate } from '../App';
import VideoPlayer from '../player/VideoPlayer';
import RemotePlayer from '../player/RemotePlayer';
import { Icon } from '../ui/icons';

export default function PlayerPage({ refParam }: { refParam: string }) {
  const [stream, setStream] = useState<(StreamInfo & { ref: string }) | null>(null);
  const [item, setItem] = useState<MediaItem | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!refParam) {
      setError('Aucun média sélectionné');
      return;
    }
    fetchItem(refParam).then(setItem).catch(() => {});
    fetchStream(refParam)
      .then(setStream)
      .catch((e) => setError(e.message));
  }, [refParam]);

  if (error) {
    return (
      <div className="player" style={{ display: 'grid', placeItems: 'center' }}>
        <div style={{ textAlign: 'center', color: '#fff' }}>
          <Icon name="alert" size={40} />
          <p style={{ margin: '14px 0 20px' }}>{error}</p>
          <button className="btn btn-ghost" onClick={() => navigate('/')}>
            <Icon name="arrow-left" size={18} /> Retour à l'accueil
          </button>
        </div>
      </div>
    );
  }

  if (!stream) {
    return (
      <div className="player" style={{ display: 'grid', placeItems: 'center' }}>
        <div className="spinner" />
      </div>
    );
  }

  if (stream.kind === 'remote') {
    return <RemotePlayer refId={refParam} item={item} onExit={() => (window.location.hash = '#/')} />;
  }

  return <VideoPlayer refId={refParam} item={item} stream={stream} onExit={() => (window.location.hash = '#/')} />;
}
