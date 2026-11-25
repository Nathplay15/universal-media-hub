import { useCallback, useEffect, useRef, useState } from 'react';
import type { MediaItem } from '@umh/types';
import { remoteControl } from '../backend';
import { Icon } from '../ui/icons';

function fmtTime(sec: number): string {
  if (!isFinite(sec) || sec < 0) return '0:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

export default function RemotePlayer({ refId, item, onExit }: { refId: string; item: MediaItem | null; onExit: () => void }) {
  const [pct, setPct] = useState(0);
  const [time, setTime] = useState(0);
  const [total, setTotal] = useState(0);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const timer = useRef<number | undefined>(undefined);

  const send = useCallback(
    async (action: string, value?: number) => {
      setBusy(true);
      setMsg(null);
      try {
        await remoteControl(refId, action, value);
        if (action === 'open') setMsg('Lecture lancée sur Kodi ▶');
      } catch (e) {
        setMsg((e as Error).message);
      } finally {
        setBusy(false);
      }
    },
    [refId],
  );

  useEffect(() => {
    const poll = async () => {
      try {
        const r = (await remoteControl(refId, 'state')) as unknown as { result?: { active?: boolean; percentage?: number; time?: number; total?: number } };
        const res = r.result;
        if (res?.active) {
          setPct(res.percentage ?? 0);
          setTime(res.time ?? 0);
          setTotal(res.total ?? 0);
        }
      } catch {
        /* état indisponible */
      }
    };
    void poll();
    timer.current = window.setInterval(() => void poll(), 3000);
    return () => window.clearInterval(timer.current);
  }, [refId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onExit();
      if (e.key === ' ') {
        e.preventDefault();
        void send('pause');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onExit, send]);

  return (
    <div className="remote">
      <div className="player-top" style={{ position: 'relative', background: 'none' }}>
        <button className="pbtn" onClick={onExit} aria-label="Retour">
          <Icon name="arrow-left" size={24} />
        </button>
        <div className="player-title">{item?.title ?? 'Télécommande Kodi'}</div>
      </div>
      <div className="remote-body">
        <div className="remote-progress">
          <div className="seek-track" style={{ position: 'relative', width: '100%', height: 6, borderRadius: 3, background: 'rgba(255,255,255,.15)' }}>
            <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${pct}%`, background: 'var(--accent)', borderRadius: 3 }} />
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--text-faint)', fontSize: '0.8rem', marginTop: 6 }}>
            <span>{fmtTime(time)}</span>
            <span>{fmtTime(total)}</span>
          </div>
        </div>
        <div className="remote-pad">
          <button className="remote-btn" disabled={busy} onClick={() => send('seek', Math.max(0, pct - 2))} title="-10 s">
            <Icon name="rotate-ccw" size={26} />
          </button>
          <button className="remote-btn primary" disabled={busy} onClick={() => send('open')} title="Lire sur Kodi">
            <Icon name="play" size={30} />
          </button>
          <button className="remote-btn" disabled={busy} onClick={() => send('seek', Math.min(100, pct + 2))} title="+10 s">
            <Icon name="rotate-cw" size={26} />
          </button>
          <button className="remote-btn" disabled={busy} onClick={() => send('pause')} title="Pause / Reprendre (Espace)">
            <Icon name="pause" size={26} />
          </button>
          <button className="remote-btn" disabled={busy} onClick={() => send('stop')} title="Arrêter">
            <Icon name="x" size={26} />
          </button>
          <span />
        </div>
        {msg && <div className="remote-note">{msg}</div>}
        <p className="remote-note">
          Kodi ne partage pas de flux HTTP direct : la lecture est lancée sur l'appareil Kodi lui-même et pilotée depuis ici (lecture, pause, avance, arrêt).
        </p>
      </div>
    </div>
  );
}
