import type { Library, ListOpts, ListResult, MediaItem, MediaProvider, ProviderConfig, StreamInfo } from '@umh/types';
import { httpJson } from './util.js';

interface KodiMovie {
  movieid: number;
  title: string;
  year?: number;
  file?: string;
  thumbnail?: string;
  rating?: number;
  playcount?: number;
  lastplayed?: string;
  streamdetails?: { video?: { duration?: number }[] };
}

interface KodiShow {
  tvshowid: number;
  title: string;
  year?: number;
  thumbnail?: string;
  playcount?: number;
}

interface KodiSeason {
  seasonid: number;
  season: number;
  label?: string;
}

interface KodiEpisode {
  episodeid: number;
  title: string;
  season: number;
  episode: number;
  file?: string;
  playcount?: number;
  streamdetails?: { video?: { duration?: number }[] };
}

export class KodiProvider implements MediaProvider {
  readonly type = 'kodi' as const;
  readonly label = 'Kodi';
  instanceId = 'kodi';
  private cfg!: ProviderConfig;
  private base = '';
  private seq = 1;

  async init(config: ProviderConfig): Promise<void> {
    if (!config.baseUrl) throw new Error('baseUrl requis (ex: http://192.168.1.10:8080)');
    this.cfg = config;
    this.instanceId = config.id;
    this.base = config.baseUrl.replace(/\/+$/, '');
    await this.rpc('JSONRPC.Ping');
  }

  private async rpc<T>(method: string, params?: Record<string, unknown>): Promise<T> {
    const basicAuth = this.cfg.username ? `${this.cfg.username}:${this.cfg.password ?? ''}` : undefined;
    const res = await httpJson<{ result?: T; error?: { message: string } }>(`${this.base}/jsonrpc`, {
      method: 'POST',
      basicAuth,
      body: { jsonrpc: '2.0', id: this.seq++, method, params: params ?? {} },
    });
    if (res.error) throw new Error(`Kodi: ${res.error.message}`);
    return res.result as T;
  }

  async health(): Promise<{ ok: boolean; error?: string; detail?: string }> {
    try {
      const v = await this.rpc<{ version?: { major?: number; minor?: number } }>('XBMC.GetInfoLabels', { labels: ['System.GetString(hostname)'] });
      return { ok: true, detail: `Kodi ${v.version?.major ?? ''}.${v.version?.minor ?? ''}`.trim() };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  }

  async listLibraries(): Promise<Library[]> {
    return [
      { id: 'movies', provider: this.instanceId, name: 'Films (Kodi)', type: 'movie' },
      { id: 'tvshows', provider: this.instanceId, name: 'Séries (Kodi)', type: 'show' },
    ];
  }

  private async movies(): Promise<MediaItem[]> {
    const res = await this.rpc<{ movies?: KodiMovie[]; limits?: { total: number } }>('VideoLibrary.GetMovies', {
      properties: ['title', 'year', 'file', 'thumbnail', 'rating', 'playcount', 'lastplayed', 'streamdetails'],
      limits: { start: 0, end: 2000 },
    });
    return (res.movies ?? []).map((m) => ({
      id: `${this.instanceId}:movie:${m.movieid}`,
      provider: this.instanceId,
      type: 'movie' as const,
      title: m.title,
      year: m.year,
      poster: m.thumbnail || undefined,
      rating: m.rating ? Math.round(m.rating * 10) / 10 : undefined,
      duration: m.streamdetails?.video?.[0]?.duration,
      progress: m.playcount && m.playcount > 0 ? 1 : undefined,
      dateAdded: m.lastplayed || undefined,
      libraryId: 'movies',
      libraryName: 'Films (Kodi)',
      extra: { file: m.file },
    }));
  }

  private async shows(): Promise<MediaItem[]> {
    const res = await this.rpc<{ tvshows?: KodiShow[] }>('VideoLibrary.GetTVShows', {
      properties: ['title', 'year', 'thumbnail', 'playcount'],
      limits: { start: 0, end: 2000 },
    });
    return (res.tvshows ?? []).map((s) => ({
      id: `${this.instanceId}:tvshow:${s.tvshowid}`,
      provider: this.instanceId,
      type: 'show' as const,
      title: s.title,
      year: s.year,
      poster: s.thumbnail || undefined,
      libraryId: 'tvshows',
      libraryName: 'Séries (Kodi)',
      extra: { tvshowid: s.tvshowid },
    }));
  }

  async listItems(libraryId: string, opts: ListOpts = {}): Promise<ListResult> {
    const all = libraryId === 'movies' ? await this.movies() : libraryId === 'tvshows' ? await this.shows() : [];
    const sorted = [...all].sort((a, b) => (opts.sort === 'dateAdded' ? (b.dateAdded ?? '').localeCompare(a.dateAdded ?? '') : a.title.localeCompare(b.title, 'fr')));
    const offset = opts.offset ?? 0;
    const limit = opts.limit ?? 100;
    return { items: sorted.slice(offset, offset + limit), total: sorted.length };
  }

  async getItem(localId: string): Promise<MediaItem | null> {
    const [kind, idStr] = localId.split(':');
    const id = parseInt(idStr, 10);
    if (kind === 'movie') {
      const all = await this.movies();
      return all.find((m) => m.id === `${this.instanceId}:movie:${id}`) ?? null;
    }
    if (kind === 'tvshow') {
      const all = await this.shows();
      return all.find((s) => s.id === `${this.instanceId}:tvshow:${id}`) ?? null;
    }
    if (kind === 'episode') {
      const res = await this.rpc<{ episodes?: KodiEpisode[] }>('VideoLibrary.GetEpisodes', {
        tvshowid: 0,
        properties: ['title', 'season', 'episode', 'file', 'playcount', 'streamdetails'],
      }).catch(() => ({ episodes: [] }));
      const ep = (res.episodes ?? []).find((e) => e.episodeid === id);
      if (!ep) return null;
      return {
        id: `${this.instanceId}:episode:${id}`,
        provider: this.instanceId,
        type: 'episode',
        title: ep.title,
        seasonNumber: ep.season,
        episodeNumber: ep.episode,
        duration: ep.streamdetails?.video?.[0]?.duration,
        extra: { file: ep.file },
      };
    }
    return null;
  }

  async getChildren(localId: string): Promise<MediaItem[]> {
    const [kind, idStr] = localId.split(':');
    const id = parseInt(idStr, 10);
    if (kind === 'tvshow') {
      const seasons = await this.rpc<{ seasons?: KodiSeason[] }>('VideoLibrary.GetSeasons', { tvshowid: id, properties: ['season', 'label'] });
      return (seasons.seasons ?? []).map((s) => ({
        id: `${this.instanceId}:season:${s.seasonid}`,
        provider: this.instanceId,
        type: 'season' as const,
        title: s.label ?? `Saison ${s.season}`,
        seasonNumber: s.season,
        extra: { tvshowid: id, season: s.season, seasonid: s.seasonid },
      }));
    }
    if (kind === 'season') {
      const showId = (await this.getItem(localId))?.extra?.tvshowid as number;
      const season = (await this.getItem(localId))?.seasonNumber ?? 0;
      const eps = await this.rpc<{ episodes?: KodiEpisode[] }>('VideoLibrary.GetEpisodes', {
        tvshowid: showId,
        season,
        properties: ['title', 'season', 'episode', 'file', 'playcount', 'streamdetails'],
      });
      return (eps.episodes ?? []).map((e) => ({
        id: `${this.instanceId}:episode:${e.episodeid}`,
        provider: this.instanceId,
        type: 'episode' as const,
        title: e.title,
        seasonNumber: e.season,
        episodeNumber: e.episode,
        duration: e.streamdetails?.video?.[0]?.duration,
        extra: { file: e.file, tvshowid: showId },
      }));
    }
    return [];
  }

  async search(query: string, limit = 40): Promise<MediaItem[]> {
    const q = query.toLowerCase();
    const [movies, shows] = await Promise.all([this.movies().catch(() => [] as MediaItem[]), this.shows().catch(() => [] as MediaItem[])]);
    return [...movies, ...shows].filter((m) => m.title.toLowerCase().includes(q)).slice(0, limit);
  }

  async getStreamInfo(localId: string): Promise<StreamInfo> {
    const item = await this.getItem(localId);
    const file = item?.extra?.file as string | undefined;
    if (!file) throw new Error('Aucun fichier associé (lecture distante uniquement)');
    return { kind: 'remote', subtitles: [], audioTracks: [], qualities: [], extra: { file } };
  }

  async control(localId: string, action: string, value?: number): Promise<unknown> {
    const item = await this.getItem(localId);
    const file = item?.extra?.file as string | undefined;
    switch (action) {
      case 'open':
        if (!file) throw new Error('Fichier inconnu');
        return this.rpc('Player.Open', { item: { file } });
      case 'pause': {
        const players = await this.rpc<{ playerid?: number }[]>('Player.GetActivePlayers');
        const pid = players[0]?.playerid ?? 1;
        return this.rpc('Player.PlayPause', { playerid: pid });
      }
      case 'stop': {
        const players = await this.rpc<{ playerid?: number }[]>('Player.GetActivePlayers');
        return this.rpc('Player.Stop', { playerid: players[0]?.playerid ?? 1 });
      }
      case 'state': {
        const players = await this.rpc<{ playerid?: number; type?: string }[]>('Player.GetActivePlayers');
        const p = players.find((x) => x.type === 'video') ?? players[0];
        if (!p?.playerid) return { active: false };
        const props = await this.rpc<{ percentage?: number; time?: { hours: number; minutes: number; seconds: number }; totaltime?: { hours: number; minutes: number; seconds: number } }>('Player.GetProperties', {
          playerid: p.playerid,
          properties: ['percentage', 'time', 'totaltime'],
        });
        const toSec = (t?: { hours: number; minutes: number; seconds: number }) => (t ? t.hours * 3600 + t.minutes * 60 + t.seconds : 0);
        return { active: true, percentage: props.percentage ?? 0, time: toSec(props.time), total: toSec(props.totaltime) };
      }
      case 'seek': {
        const players = await this.rpc<{ playerid?: number }[]>('Player.GetActivePlayers');
        const pid = players[0]?.playerid ?? 1;
        if (value !== undefined) return this.rpc('Player.Seek', { playerid: pid, value: { percentage: value } });
        return this.rpc('Player.Seek', { playerid: pid, value: { time: 0 } });
      }
      default:
        throw new Error(`Action inconnue: ${action}`);
    }
  }
}
