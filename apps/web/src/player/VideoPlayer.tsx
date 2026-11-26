import { useCallback, useEffect, useRef, useState } from 'react';
import Hls from 'hls.js';
import { Capacitor } from '@capacitor/core';
import type { MediaItem, StreamInfo, SubtitleTrack } from '@umh/types';
import { fetchProgress, saveProgress } from '../backend';
import { Cast } from '../plugins';
import { subtitleTrackUrl } from './srt';
import { Icon } from '../ui/icons';
import { formatDuration } from '../ui/MediaCard';

interface Props {
  refId: string;
  item: MediaItem | null;
  stream: StreamInfo & { ref: string };
  onExit: () => void;
}

type MenuKind = 'subs' | 'audio' | 'speed' | 'quality' | null;

const SPEEDS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 3];

function fmtTime(sec: number): string {
  if (!isFinite(sec) || sec < 0) return '0:00';
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}

interface SubTrack {
  track: SubtitleTrack;
  url: string;
}

export default function VideoPlayer({ refId, item, stream, onExit }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const hideTimer = useRef<number | undefined>(undefined);
  const tapTimer = useRef<number | undefined>(undefined);
  const lastTap = useRef<{ t: number; x: number }>({ t: 0, x: 0 });
  const gesture = useRef<{ x: number; y: number; startTime: number; startVol: number; startBright: number; seeking: boolean; moved: boolean } | null>(null);
  const resumed = useRef(false);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [dur, setDur] = useState(0);
  const [buffered, setBuffered] = useState(0);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [rate, setRate] = useState(1);
  const [visible, setVisible] = useState(true);
  const [locked, setLocked] = useState(false);
  const [isFs, setIsFs] = useState(false);
  const [pipOn, setPipOn] = useState(false);
  const [menu, setMenu] = useState<MenuKind>(null);
  const [subTracks, setSubTracks] = useState<SubTrack[]>([]);
  const [curSub, setCurSub] = useState(-1);
  const [audioTracks, setAudioTracks] = useState<{ id: string; label: string }[]>([]);
  const [curAudio, setCurAudio] = useState(0);
  const [levels, setLevels] = useState<{ height?: number; bitrate?: number }[]>([]);
  const [curLevel, setCurLevel] = useState(-1);
  const [hoverTip, setHoverTip] = useState<{ x: number; t: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const [dragPct, setDragPct] = useState(0);
  const [flash, setFlash] = useState<{ key: number; icon: string } | null>(null);
  const [gestureInd, setGestureInd] = useState<{ icon: string; text: string } | null>(null);
  const [brightness, setBrightness] = useState(1);
  const [allStreams, setAllStreams] = useState<{ index: number; label: string; url: string }[]>([]);
  const [castOn, setCastOn] = useState(false);

  const v = () => videoRef.current;

  const showUi = useCallback(() => {
    setVisible(true);
    window.clearTimeout(hideTimer.current);
    hideTimer.current = window.setTimeout(() => {
      if (!locked && menu === null) setVisible(false);
    }, 3200);
  }, [locked, menu]);

  const togglePlay = useCallback(() => {
    const el = v();
    if (!el) return;
    if (el.paused) void el.play().catch(() => {});
    else el.pause();
  }, []);

  const seekBy = useCallback((delta: number) => {
    const el = v();
    if (!el) return;
    el.currentTime = Math.min(Math.max(0, el.currentTime + delta), el.duration || Infinity);
    setFlash({ key: Date.now(), icon: delta < 0 ? 'rotate-ccw' : 'rotate-cw' });
    showUi();
  }, [showUi]);

  const seekTo = useCallback((pct: number) => {
    const el = v();
    if (!el || !el.duration) return;
    el.currentTime = pct * el.duration;
  }, []);

  useEffect(() => {
    const el = v();
    if (!el || !stream.url) return;
    let cancelled = false;
    const url = stream.url;
    const isHls = stream.kind === 'hls' || /\.m3u8(\?|$)/i.test(url);
    if (isHls && Hls.isSupported()) {
      const hls = new Hls({ maxBufferLength: 30, enableWorker: true });
      hlsRef.current = hls;
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        setLevels(hls.levels.map((l) => ({ height: l.height, bitrate: l.bitrate })));
        setAudioTracks(hls.audioTracks.map((a, i) => ({ id: String(i), label: a.name ?? a.lang ?? `Piste ${i + 1}` })));
        setLoading(false);
        void el.play().catch(() => {});
      });
      hls.on(Hls.Events.ERROR, (_e, data) => {
        if (data.fatal) {
          if (data.type === Hls.ErrorTypes.NETWORK_ERROR) hls.startLoad();
          else setError(`Erreur de lecture : ${data.details}`);
        }
      });
      hls.loadSource(url);
      hls.attachMedia(el);
    } else if (isHls && el.canPlayType('application/vnd.apple.mpegurl')) {
      el.src = url;
      setLoading(false);
      void el.play().catch(() => {});
    } else {
      el.src = url;
      setLoading(false);
      void el.play().catch(() => {});
    }
    if (stream.extra?.allStreams) setAllStreams(stream.extra.allStreams as { index: number; label: string; url: string }[]);
    return () => {
      cancelled = true;
      void cancelled;
      hlsRef.current?.destroy();
      hlsRef.current = null;
    };
  }, [stream.url, stream.kind, stream.extra]);

  useEffect(() => {
    let cancelled = false;
    const subs = stream.subtitles ?? [];
    Promise.all(
      subs.map(async (t) => ({ track: t, url: await subtitleTrackUrl(t.url, t.format).catch(() => t.url) })),
    ).then((tracks) => {
      if (cancelled) return;
      setSubTracks(tracks);
      const def = tracks.findIndex((t) => t.track.default);
      setCurSub(def >= 0 ? def : -1);
    });
    return () => {
      cancelled = true;
    };
  }, [stream.subtitles]);

  useEffect(() => {
    const el = v();
    if (!el) return;
    const tracks = el.textTracks;
    for (let i = 0; i < tracks.length; i++) {
      tracks[i].mode = i === curSub ? 'showing' : 'hidden';
    }
  }, [curSub, subTracks]);

  useEffect(() => {
    const el = v();
    if (!el || resumed.current) return;
    resumed.current = true;
    fetchProgress(refId)
      .then((p) => {
        if (p && p.position > 5 && (!p.duration || p.position < p.duration - 15)) {
          el.currentTime = p.position;
        }
      })
      .catch(() => {});
  }, [refId]);

  useEffect(() => {
    const el = v();
    if (!el) return;
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    const onTime = () => {
      setTime(el.currentTime);
      if (el.buffered.length) setBuffered(el.buffered.end(el.buffered.length - 1));
    };
    const onDur = () => setDur(el.duration || 0);
    const onWait = () => setLoading(true);
    const onPlaying = () => { setLoading(false); setPlaying(true); };
    const onEnded = () => setPlaying(false);
    const onErr = () => setError(el.error ? `Erreur média (code ${el.error.code})` : 'Erreur de lecture');
    el.addEventListener('play', onPlay);
    el.addEventListener('pause', onPause);
    el.addEventListener('timeupdate', onTime);
    el.addEventListener('durationchange', onDur);
    el.addEventListener('loadedmetadata', onDur);
    el.addEventListener('waiting', onWait);
    el.addEventListener('playing', onPlaying);
    el.addEventListener('ended', onEnded);
    el.addEventListener('error', onErr);
    return () => {
      el.removeEventListener('play', onPlay);
      el.removeEventListener('pause', onPause);
      el.removeEventListener('timeupdate', onTime);
      el.removeEventListener('durationchange', onDur);
      el.removeEventListener('loadedmetadata', onDur);
      el.removeEventListener('waiting', onWait);
      el.removeEventListener('playing', onPlaying);
      el.removeEventListener('ended', onEnded);
      el.removeEventListener('error', onErr);
    };
  }, []);

  useEffect(() => {
    const el = v();
    if (!el) return;
    const id = window.setInterval(() => {
      if (!el.paused && el.duration) saveProgress(refId, el.currentTime, el.duration).catch(() => {});
    }, 5000);
    const onUnload = () => {
      if (el.duration) saveProgress(refId, el.currentTime, el.duration).catch(() => {});
    };
    window.addEventListener('beforeunload', onUnload);
    return () => {
      window.clearInterval(id);
      window.removeEventListener('beforeunload', onUnload);
    };
  }, [refId]);

  useEffect(() => {
    const onFs = () => setIsFs(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onFs);
    const onPip = () => setPipOn(!!document.pictureInPictureElement);
    document.addEventListener('enterpictureinpicture', onPip);
    document.addEventListener('leavepictureinpicture', onPip);
    return () => {
      document.removeEventListener('fullscreenchange', onFs);
      document.removeEventListener('enterpictureinpicture', onPip);
      document.removeEventListener('leavepictureinpicture', onPip);
    };
  }, []);


  const toggleFs = useCallback(() => {
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    else void wrapRef.current?.requestFullscreen().catch(() => {});
  }, []);

  const toggleMute = useCallback(() => {
    const el = v();
    if (!el) return;
    el.muted = !el.muted;
    setMuted(el.muted);
  }, []);

  const togglePip = useCallback(async () => {
    const el = v();
    if (!el) return;
    try {
      if (document.pictureInPictureElement) await document.exitPictureInPicture();
      else if (document.pictureInPictureEnabled) await el.requestPictureInPicture();
    } catch {
      /* PiP non disponible */
    }
  }, []);

  const cycleSub = useCallback(() => {
    setCurSub((c) => (c + 1 >= subTracks.length ? -1 : c + 1));
  }, [subTracks.length]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
      switch (e.key) {
        case ' ':
        case 'k':
          e.preventDefault();
          togglePlay();
          break;
        case 'j': seekBy(-10); break;
        case 'l': seekBy(10); break;
        case 'ArrowLeft': e.preventDefault(); seekBy(-5); break;
        case 'ArrowRight': e.preventDefault(); seekBy(5); break;
        case 'ArrowUp': {
          e.preventDefault();
          const el = v();
          if (el) {
            el.volume = Math.min(1, el.volume + 0.05);
            el.muted = false;
            setVolume(el.volume);
            setMuted(false);
          }
          showUi();
          break;
        }
        case 'ArrowDown': {
          e.preventDefault();
          const el = v();
          if (el) {
            el.volume = Math.max(0, el.volume - 0.05);
            setVolume(el.volume);
          }
          showUi();
          break;
        }
        case 'f': toggleFs(); break;
        case 'm': toggleMute(); break;
        case 'c': cycleSub(); break;
        case 'p': togglePip(); break;
        case 'Escape': if (!document.fullscreenElement) onExit(); break;
        default: return;
      }
      showUi();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [togglePlay, seekBy, showUi, onExit, toggleFs, toggleMute, togglePip, cycleSub]);

  const changeSource = useCallback((url: string, kind: string) => {
    const el = v();
    if (!el) return;
    hlsRef.current?.destroy();
    hlsRef.current = null;
    setError(null);
    setLoading(true);
    if (kind === 'hls' || /\.m3u8(\?|$)/i.test(url)) {
      if (Hls.isSupported()) {
        const hls = new Hls({ maxBufferLength: 30 });
        hlsRef.current = hls;
        hls.on(Hls.Events.MANIFEST_PARSED, () => {
          setLevels(hls.levels.map((l) => ({ height: l.height, bitrate: l.bitrate })));
          void el.play().catch(() => {});
          setLoading(false);
        });
        hls.on(Hls.Events.ERROR, (_e, d) => {
          if (d.fatal && d.type !== Hls.ErrorTypes.NETWORK_ERROR) setError(`Erreur de lecture : ${d.details}`);
          else if (d.fatal) hls.startLoad();
        });
        hls.loadSource(url);
        hls.attachMedia(el);
      } else el.src = url;
    } else {
      el.src = url;
      setLoading(false);
      void el.play().catch(() => {});
    }
  }, []);

  const setAudio = (idx: number) => {
    setCurAudio(idx);
    const hls = hlsRef.current;
    if (hls) hls.audioTrack = idx;
    else {
      const el = v();
      const at = el ? (el as unknown as { audioTracks?: { length: number; enabled: boolean }[] }).audioTracks : undefined;
      if (at) {
        for (let i = 0; i < at.length; i++) at[i].enabled = i === idx;
      }
    }
  };

  const setQuality = (lvl: number) => {
    setCurLevel(lvl);
    if (hlsRef.current) hlsRef.current.currentLevel = lvl;
  };

  const setSpeed = (s: number) => {
    setRate(s);
    if (v()) v()!.playbackRate = s;
  };

  const onSeekPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dur) return;
    setDragging(true);
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    const rect = e.currentTarget.getBoundingClientRect();
    const pct = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    setDragPct(pct);
    seekTo(pct);
    showUi();
  };
  const onSeekPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const pct = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    if (dragging) {
      setDragPct(pct);
      seekTo(pct);
    } else if (dur) {
      setHoverTip({ x: e.clientX - rect.left, t: pct * dur });
    }
  };
  const onSeekPointerUp = () => {
    setDragging(false);
    showUi();
  };
  const onSeekPointerLeave = () => setHoverTip(null);

  const onWrapPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (locked) return;
    const target = e.target as HTMLElement;
    if (target.closest('.player-controls') || target.closest('.player-top') || target.closest('.pmenu')) return;
    gesture.current = {
      x: e.clientX,
      y: e.clientY,
      startTime: v()?.currentTime ?? 0,
      startVol: v()?.volume ?? 1,
      startBright: brightness,
      seeking: false,
      moved: false,
    };
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
  };

  const onWrapPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const g = gesture.current;
    if (!g || locked) return;
    const dx = e.clientX - g.x;
    const dy = e.clientY - g.y;
    if (Math.abs(dx) > 10 || Math.abs(dy) > 10) g.moved = true;
    if (!g.moved) return;
    const width = wrapRef.current?.clientWidth ?? 1;
    if (Math.abs(dx) > Math.abs(dy)) {
      g.seeking = true;
      const delta = (dx / width) * (dur || 0) * 0.6;
      setGestureInd({ icon: dx > 0 ? 'rotate-cw' : 'rotate-ccw', text: `${dx > 0 ? '+' : ''}${fmtTime(delta)}` });
    } else {
      const isVol = g.x > width / 2;
      if (isVol) {
        const nv = Math.min(1, Math.max(0, g.startVol - dy / 180));
        if (v()) {
          v()!.volume = nv;
          v()!.muted = false;
          setVolume(nv);
          setMuted(false);
        }
        setGestureInd({ icon: 'volume', text: `${Math.round(nv * 100)}%` });
      } else {
        const nb = Math.min(2, Math.max(0.3, g.startBright - dy / 160));
        setBrightness(nb);
        setGestureInd({ icon: 'gauge', text: `${Math.round(nb * 100)}%` });
      }
    }
    showUi();
  };

  const onWrapPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const g = gesture.current;
    gesture.current = null;
    if (!g) return;
    if (g.seeking && dur) {
      const width = wrapRef.current?.clientWidth ?? 1;
      const dx = e.clientX - g.x;
      seekTo(Math.min(1, Math.max(0, (g.startTime + (dx / width) * dur * 0.6) / dur)));
    }
    setGestureInd(null);
    if (locked) return;
    if (!g.moved) {
      const now = Date.now();
      const isDouble = now - lastTap.current.t < 300 && Math.abs(e.clientX - lastTap.current.x) < 50;
      if (isDouble) {
        window.clearTimeout(tapTimer.current);
        const width = wrapRef.current?.clientWidth ?? 1;
        seekBy(e.clientX < width / 2 ? -10 : 10);
        lastTap.current = { t: 0, x: 0 };
      } else {
        lastTap.current = { t: now, x: e.clientX };
        window.clearTimeout(tapTimer.current);
        tapTimer.current = window.setTimeout(() => {
          setVisible((v) => !v);
          showUi();
        }, 260);
      }
    }
  };

  const pctPlayed = dur ? (time / dur) * 100 : 0;
  const pctBuffered = dur ? (buffered / dur) * 100 : 0;
  const shownPct = dragging ? dragPct * 100 : pctPlayed;
  const title = item ? (item.seriesTitle ? `${item.seriesTitle} — ${item.title}` : item.title) : 'Lecture';

  return (
    <div
      ref={wrapRef}
      className={`player ${visible ? '' : 'hidden-ui'}`}
      onPointerDown={onWrapPointerDown}
      onPointerMove={(e) => {
        onWrapPointerMove(e);
        showUi();
      }}
      onPointerUp={onWrapPointerUp}
      onPointerLeave={() => setHoverTip(null)}
    >
      <video
        ref={videoRef}
        playsInline
        crossOrigin="anonymous"
        style={{ filter: `brightness(${brightness})` }}
        onClick={() => {
          togglePlay();
          showUi();
        }}
      >
        {subTracks.map((st, i) => (
          <track key={st.track.id ?? i} kind="subtitles" src={st.url} srcLang={st.track.language ?? 'fr'} label={st.track.label} default={i === curSub} />
        ))}
      </video>

      <div className="player-top">
        <button className="pbtn" onClick={onExit} aria-label="Retour" title="Retour (Échap)">
          <Icon name="arrow-left" size={24} />
        </button>
        <div className="player-title">{title}</div>
        <div className="spacer" />
        <button className={`pbtn ${locked ? 'active' : ''}`} onClick={() => { setLocked((l) => !l); showUi(); }} title="Verrouiller les contrôles">
          <Icon name={locked ? 'lock' : 'unlock'} size={20} />
        </button>
      </div>

      <div className="player-center">
        {loading && <div className="spinner" />}
        {flash && (
          <div className="flash-icon" key={flash.key}>
            <Icon name={flash.icon} size={44} />
          </div>
        )}
        {gestureInd && !loading && (
          <div className="gesture-indicator">
            <Icon name={gestureInd.icon} size={22} />
            {gestureInd.text}
          </div>
        )}
        {error && (
          <div style={{ background: 'rgba(0,0,0,.8)', padding: '18px 26px', borderRadius: 14, color: '#fca5a5', maxWidth: 420, textAlign: 'center' }}>
            <Icon name="alert" size={30} />
            <p style={{ margin: '10px 0' }}>{error}</p>
            <button className="btn btn-ghost btn-small" onClick={() => stream.url && changeSource(stream.url, stream.kind)}>Réessayer</button>
          </div>
        )}
      </div>

      {!locked && (
        <div className="player-controls">
          <div
            className="seek"
            onPointerDown={onSeekPointerDown}
            onPointerMove={onSeekPointerMove}
            onPointerUp={onSeekPointerUp}
            onPointerLeave={onSeekPointerLeave}
          >
            <div className="seek-track">
              <div className="seek-buffered" style={{ width: `${pctBuffered}%` }} />
              <div className="seek-played" style={{ width: `${shownPct}%` }} />
              <div className="seek-thumb" style={{ left: `${shownPct}%` }} />
            </div>
            {hoverTip && !dragging && <div className="seek-tip" style={{ left: hoverTip.x }}>{fmtTime(hoverTip.t)}</div>}
          </div>
          <div className="controls-row">
            <button className="pbtn" onClick={() => seekBy(-10)} title="-10 s (J)"><Icon name="rotate-ccw" size={22} /></button>
            <button className="pbtn" onClick={togglePlay} title={playing ? 'Pause (Espace)' : 'Lecture (Espace)'}>
              <Icon name={playing ? 'pause' : 'play'} size={26} />
            </button>
            <button className="pbtn" onClick={() => seekBy(10)} title="+10 s (L)"><Icon name="rotate-cw" size={22} /></button>
            <div className="vol-group">
              <button className="pbtn" onClick={toggleMute} title="Muet (M)">
                <Icon name={muted || volume === 0 ? 'volume-x' : 'volume'} size={22} />
              </button>
              <input
                className="vol-slider"
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={muted ? 0 : volume}
                onChange={(e) => {
                  const nv = parseFloat(e.target.value);
                  if (v()) {
                    v()!.volume = nv;
                    v()!.muted = false;
                  }
                  setVolume(nv);
                  setMuted(false);
                }}
              />
            </div>
            <span className="time">{fmtTime(dragging ? dragPct * dur : time)} / {fmtTime(dur)}</span>
            <div className="spacer" />
            {subTracks.length > 0 && (
              <button className={`pbtn ${curSub >= 0 ? 'active' : ''}`} onClick={() => { setMenu(menu === 'subs' ? null : 'subs'); showUi(); }} title="Sous-titres (C)">
                <Icon name="cc" size={22} />
              </button>
            )}
            {audioTracks.length > 1 && (
              <button className="pbtn" onClick={() => { setMenu(menu === 'audio' ? null : 'audio'); showUi(); }} title="Piste audio">
                <Icon name="music" size={22} />
              </button>
            )}
            <button className={`pbtn ${rate !== 1 ? 'active' : ''}`} onClick={() => { setMenu(menu === 'speed' ? null : 'speed'); showUi(); }} title="Vitesse de lecture">
              <Icon name="gauge" size={22} />
            </button>
            {(levels.length > 1 || allStreams.length > 1) && (
              <button className="pbtn" onClick={() => { setMenu(menu === 'quality' ? null : 'quality'); showUi(); }} title="Qualité / flux">
                <Icon name="layers" size={22} />
              </button>
            )}
            {Capacitor.isNativePlatform() && stream.url && !stream.url.startsWith('http://127.0.0.1') && (
              <button
                className={`pbtn ${castOn ? 'active' : ''}`}
                title="Caster sur Chromecast (connecte d'abord un Chromecast via le menu Cast d'Android)"
                onClick={async () => {
                  try {
                    if (castOn) {
                      await Cast.stop();
                      setCastOn(false);
                    } else {
                      await Cast.cast({ url: stream.url!, contentType: stream.mimeType ?? 'video/mp4', title });
                      setCastOn(true);
                    }
                  } catch (e) {
                    setError((e as Error).message);
                  }
                  showUi();
                }}
              >
                <Icon name="cast" size={22} />
              </button>
            )}
            {document.pictureInPictureEnabled && (
              <button className={`pbtn ${pipOn ? 'active' : ''}`} onClick={togglePip} title="Picture-in-Picture (P)">
                <Icon name="pip" size={22} />
              </button>
            )}
            <button className="pbtn" onClick={toggleFs} title="Plein écran (F)">
              <Icon name={isFs ? 'minimize' : 'maximize'} size={22} />
            </button>
          </div>

          {menu === 'subs' && (
            <div className="pmenu" style={{ right: 150 }}>
              <div className="pmenu-title">Sous-titres</div>
              <button className={`pmenu-item ${curSub === -1 ? 'active' : ''}`} onClick={() => { setCurSub(-1); setMenu(null); }}>Désactivés {curSub === -1 && <Icon name="check" size={16} />}</button>
              {subTracks.map((st, i) => (
                <button key={st.track.id ?? i} className={`pmenu-item ${curSub === i ? 'active' : ''}`} onClick={() => { setCurSub(i); setMenu(null); }}>
                  {st.track.label} {curSub === i && <Icon name="check" size={16} />}
                </button>
              ))}
            </div>
          )}
          {menu === 'audio' && (
            <div className="pmenu" style={{ right: 108 }}>
              <div className="pmenu-title">Piste audio</div>
              {audioTracks.map((a, i) => (
                <button key={a.id} className={`pmenu-item ${curAudio === i ? 'active' : ''}`} onClick={() => { setAudio(i); setMenu(null); }}>
                  {a.label} {curAudio === i && <Icon name="check" size={16} />}
                </button>
              ))}
            </div>
          )}
          {menu === 'speed' && (
            <div className="pmenu" style={{ right: 66 }}>
              <div className="pmenu-title">Vitesse</div>
              {SPEEDS.map((s) => (
                <button key={s} className={`pmenu-item ${rate === s ? 'active' : ''}`} onClick={() => { setSpeed(s); setMenu(null); }}>
                  {s === 1 ? 'Normale' : `${s}×`} {rate === s && <Icon name="check" size={16} />}
                </button>
              ))}
            </div>
          )}
          {menu === 'quality' && (
            <div className="pmenu" style={{ right: 16 }}>
              {levels.length > 1 && (
                <>
                  <div className="pmenu-title">Qualité</div>
                  <button className={`pmenu-item ${curLevel === -1 ? 'active' : ''}`} onClick={() => { setQuality(-1); setMenu(null); }}>
                    Auto {curLevel === -1 && <Icon name="check" size={16} />}
                  </button>
                  {levels.map((l, i) => (
                    <button key={i} className={`pmenu-item ${curLevel === i ? 'active' : ''}`} onClick={() => { setQuality(i); setMenu(null); }}>
                      {l.height ? `${l.height}p` : `Niveau ${i + 1}`}{l.bitrate ? ` (${Math.round(l.bitrate / 1000)} kb/s)` : ''} {curLevel === i && <Icon name="check" size={16} />}
                    </button>
                  ))}
                </>
              )}
              {allStreams.length > 1 && (
                <>
                  <div className="pmenu-title">Flux</div>
                  {allStreams.map((s) => (
                    <button key={s.index} className="pmenu-item" onClick={() => { changeSource(s.url, /\.m3u8(\?|$)/i.test(s.url) ? 'hls' : 'direct'); setMenu(null); }}>
                      {s.label}
                    </button>
                  ))}
                </>
              )}
            </div>
          )}
        </div>
      )}
      {locked && (
        <div className="player-controls" style={{ padding: '10px 22px' }}>
          <div className="controls-row">
            <span className="time">{title} — {fmtTime(time)}</span>
          </div>
        </div>
      )}
    </div>
  );
}
