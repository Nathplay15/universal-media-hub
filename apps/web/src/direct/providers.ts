import type { Library, ListOpts, ListResult, MediaItem, StreamInfo } from '@umh/types';
import { Capacitor } from '@capacitor/core';
import type { DirectSource } from './vault';
import { fetchJson, basicAuth, timeoutSignal } from './http';
import type { DirectProvider } from './types';
import { LanFiles, Dlna } from '../plugins';

const VIDEO_EXTS = new Set(['mkv', 'mp4', 'avi', 'mov', 'wmv', 'flv', 'webm', 'm4v', 'mpg', 'mpeg', 'ts', 'm2ts', 'ogv']);

function extOf(p: string): string {
  const i = p.lastIndexOf('.');
  return i < 0 ? '' : p.slice(i + 1).toLowerCase();
}

function parseName(fileName: string): { title: string; year?: number; season?: number; episode?: number; series?: string } {
  const base = fileName.replace(/\.[^.]+$/, '');
  const se = base.match(/^(.*?)[ ._\-]*[Ss](\d{1,2})[Ee](\d{1,3})/);
  let season: number | undefined;
  let episode: number | undefined;
  let series: string | undefined;
  let title = base;
  if (se) {
    series = se[1].replace(/[._]+/g, ' ').trim();
    season = parseInt(se[2], 10);
    episode = parseInt(se[3], 10);
    title = `${series} S${String(season).padStart(2, '0')}E${String(episode).padStart(2, '0')}`;
  }
  const ym = base.match(/\b(19\d{2}|20\d{2})\b/);
  const year = ym ? parseInt(ym[1], 10) : undefined;
  if (!se) {
    const clean = base
      .replace(/\b(19\d{2}|20\d{2})\b/g, ' ')
      .replace(/[._]+/g, ' ')
      .replace(/\[[^\]]*\]|\([^)]*\)/g, ' ')
      .replace(/\b(1080p|720p|2160p|4k|bluray|bdrip|webrip|web-dl|hdtv|x264|x265|hevc|remux)\b/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (clean) title = clean;
  }
  return { title, year, season, episode, series };
}

interface JfItem {
  Id: string;
  Name: string;
  Type: string;
  ProductionYear?: number;
  Overview?: string;
  CommunityRating?: number;
  Genres?: string[];
  RunTimeTicks?: number;
  PlaybackPositionTicks?: number;
  DateCreated?: string;
  SeriesName?: string;
  ParentIndexNumber?: number;
  IndexNumber?: number;
  MediaSources?: { Id: string; Container?: string; MediaStreams?: { Index: number; Type: string; Language?: string; DisplayTitle?: string; IsDefault?: boolean }[] }[];
  ImageTags?: Record<string, string>;
  BackdropImageTags?: string[];
}

class JellyfinDirect implements DirectProvider {
  private base = '';
  private token = '';
  private userId = '';

  constructor(public source: DirectSource) {}

  private headers(): Record<string, string> {
    return {
      'X-Emby-Token': this.token,
      'X-MediaBrowser-Token': this.token,
      'Authorization': `MediaBrowser Token="${this.token}"`,
    };
  }

  async init(): Promise<void> {
    if (!this.source.baseUrl) throw new Error('URL du serveur requise (ex: http://192.168.1.10:8096)');
    this.base = this.source.baseUrl.replace(/\/+$/, '');

    try {
      const r = await fetch(`${this.base}/System/Info/Public`, { signal: timeoutSignal(10000) });
      if (r.status >= 500) throw new Error(`HTTP ${r.status}`);
    } catch (e) {
      throw new Error(`Serveur injoignable (${this.base}/System/Info/Public) : ${(e as Error).message} — vérifie http vs https, l'IP, le port (8096 en HTTP, 8920 en HTTPS) et le pare-feu`);
    }

    if (this.source.token) {
      this.token = this.source.token;
      const r = await fetch(`${this.base}/System/Info`, { headers: this.headers(), signal: timeoutSignal(10000) });
      if (!r.ok) {
        const t = await r.text().catch(() => '');
        throw new Error(`Clé API refusée : HTTP ${r.status}${t ? ' — ' + t.slice(0, 120) : ''} — crée une clé dans Tableau de bord → Clés API`);
      }
    } else if (this.source.username) {
      const body = JSON.stringify({ Username: this.source.username, Pw: this.source.password ?? '' });
      const variants: Record<string, string>[] = [
        { 'X-Emby-Authorization': 'MediaBrowser Client="MediaHub", Device="Android", DeviceId="mediahub-apk-1", Version="1.0.0"' },
        { 'Authorization': 'MediaBrowser Client="MediaHub", Device="Android", DeviceId="mediahub-apk-1", Version="1.0.0"' },
        {},
      ];
      let lastErr = '';
      let done = false;
      for (const h of variants) {
        try {
          const res = await fetch(`${this.base}/Users/AuthenticateByName`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...h },
            body,
            signal: timeoutSignal(15000),
          });
          if (res.ok) {
            const auth = (await res.json()) as { AccessToken: string; User: { Id: string } };
            this.token = auth.AccessToken;
            this.userId = auth.User.Id;
            done = true;
            break;
          }
          const t = await res.text().catch(() => '');
          lastErr = `HTTP ${res.status}${t ? ' — ' + t.slice(0, 120) : ''}`;
        } catch (e) {
          lastErr = (e as Error).message;
        }
      }
      if (!done) {
        throw new Error(`Authentification par identifiants échouée (${lastErr}). Astuce : utilise plutôt une Clé API (Tableau de bord → Clés API), plus fiable.`);
      }
    } else {
      throw new Error('Clé API (recommandée) ou identifiants requis');
    }
    if (!this.userId) {
      try {
        const users = await fetchJson<{ Id: string }[]>(`${this.base}/Users`, { headers: this.headers() });
        this.userId = users[0]?.Id ?? '';
      } catch {
        this.userId = '';
      }
    }
  }

  private itemsBase(): string {
    return this.userId ? `${this.base}/Users/${this.userId}/Items` : `${this.base}/Items`;
  }

  async health() {
    try {
      await this.init();
      const info = await fetchJson<{ ServerName?: string; Version?: string }>(`${this.base}/System/Info`, { headers: this.headers() });
      return { ok: true, detail: `${info.ServerName ?? this.source.type} ${info.Version ?? ''}`.trim() };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  }

  private mapType(t: string): MediaItem['type'] {
    return ({ Movie: 'movie', Series: 'show', Season: 'season', Episode: 'episode', Audio: 'track', TvChannel: 'channel' } as Record<string, MediaItem['type']>)[t] ?? 'video';
  }

  private img(item: JfItem, kind: 'Primary' | 'Backdrop'): string | undefined {
    if (kind === 'Primary' && !item.ImageTags?.Primary) return undefined;
    if (kind === 'Backdrop' && !item.BackdropImageTags?.length) return undefined;
    const tag = kind === 'Primary' ? item.ImageTags!.Primary : item.BackdropImageTags![0];
    return `${this.base}/Items/${item.Id}/Images/${kind}${kind === 'Backdrop' ? '/0' : ''}?maxWidth=${kind === 'Backdrop' ? 1280 : 500}&quality=90&tag=${tag}&apiKey=${this.token}`;
  }

  private toItem(it: JfItem): MediaItem {
    return {
      id: `${this.source.id}:${it.Id}`,
      provider: this.source.id,
      type: this.mapType(it.Type),
      title: it.Name,
      year: it.ProductionYear,
      overview: it.Overview,
      poster: this.img(it, 'Primary'),
      backdrop: this.img(it, 'Backdrop'),
      duration: it.RunTimeTicks ? Math.round(it.RunTimeTicks / 10_000_000) : undefined,
      genres: it.Genres,
      rating: it.CommunityRating,
      progress: it.RunTimeTicks && it.PlaybackPositionTicks ? it.PlaybackPositionTicks / it.RunTimeTicks : undefined,
      dateAdded: it.DateCreated,
      seriesTitle: it.SeriesName,
      seasonNumber: it.ParentIndexNumber,
      episodeNumber: it.IndexNumber,
    };
  }

  private libType(ct?: string): Library['type'] {
    return ct === 'movies' ? 'movie' : ct === 'tvshows' ? 'show' : ct === 'music' ? 'track' : ct === 'livetv' ? 'channel' : 'video';
  }

  async listLibraries(): Promise<Library[]> {
    await this.init();
    const errs: string[] = [];
    if (this.userId) {
      try {
        const views = await fetchJson<{ Items?: { Name: string; Id: string; CollectionType?: string }[] }>(`${this.base}/Users/${this.userId}/Views`, { headers: this.headers() });
        const libs = (views.Items ?? []).map((v) => ({ id: v.Id, provider: this.source.id, name: v.Name, type: this.libType(v.CollectionType) }));
        if (libs.length) return libs;
      } catch (e) {
        errs.push(`Views: ${(e as Error).message}`);
      }
    }
    try {
      const folders = await fetchJson<{ Name: string; ItemId?: string; CollectionType?: string }[]>(`${this.base}/Library/VirtualFolders`, { headers: this.headers() });
      return folders.map((f) => ({
        id: f.ItemId ?? f.Name,
        provider: this.source.id,
        name: f.Name,
        type: this.libType(f.CollectionType),
      }));
    } catch (e) {
      errs.push(`VirtualFolders: ${(e as Error).message}`);
      throw new Error(errs.join(' | '));
    }
  }

  async listItems(libraryId: string, opts: ListOpts = {}): Promise<ListResult> {
    await this.init();
    const sortMap: Record<string, string> = { title: 'SortName', dateAdded: 'DateCreated', rating: 'CommunityRating', duration: 'RunTimeTicks' };
    const params = new URLSearchParams({
      ParentId: libraryId,
      Recursive: 'true',
      Fields: 'Genres,Overview,CommunityRating,ProductionYear,MediaSources,ImageTags,BackdropImageTags,RunTimeTicks,PlaybackPositionTicks,DateCreated,SeriesName,ParentIndexNumber,IndexNumber',
      SortBy: sortMap[opts.sort ?? 'title'] ?? 'SortName',
      StartIndex: String(opts.offset ?? 0),
      Limit: String(opts.limit ?? 100),
    });
    const res = await fetchJson<{ Items: JfItem[]; TotalRecordCount: number }>(`${this.itemsBase()}?${params}`, { headers: this.headers() });
    return { items: (res.Items ?? []).map((i) => this.toItem(i)), total: res.TotalRecordCount ?? res.Items?.length ?? 0 };
  }

  private async itemById(id: string): Promise<JfItem> {
    return fetchJson<JfItem>(`${this.itemsBase()}/${id}`, { headers: this.headers() });
  }

  async getItem(localId: string): Promise<MediaItem | null> {
    try {
      await this.init();
      return this.toItem(await this.itemById(localId));
    } catch {
      return null;
    }
  }

  async getChildren(localId: string): Promise<MediaItem[]> {
    await this.init();
    const item = await this.itemById(localId);
    if (item.Type === 'Series') {
      const res = await fetchJson<{ Items: JfItem[] }>(`${this.itemsBase()}?ParentId=${localId}&IncludeItemTypes=Season&SortBy=SortName`, { headers: this.headers() });
      return (res.Items ?? []).map((i) => this.toItem(i));
    }
    if (item.Type === 'Season') {
      const res = await fetchJson<{ Items: JfItem[] }>(`${this.itemsBase()}?ParentId=${localId}&IncludeItemTypes=Episode&SortBy=IndexNumber&Fields=RunTimeTicks,MediaSources,SeriesName,ParentIndexNumber,IndexNumber`, { headers: this.headers() });
      return (res.Items ?? []).map((i) => this.toItem(i));
    }
    return [];
  }

  async search(q: string, limit = 40): Promise<MediaItem[]> {
    await this.init();
    const params = new URLSearchParams({ SearchTerm: q, Recursive: 'true', Limit: String(limit), IncludeItemTypes: 'Movie,Episode,Series,Audio', Fields: 'Genres,Overview,ProductionYear,ImageTags,BackdropImageTags,RunTimeTicks,SeriesName' });
    const res = await fetchJson<{ Items: JfItem[] }>(`${this.itemsBase()}?${params}`, { headers: this.headers() });
    return (res.Items ?? []).map((i) => this.toItem(i));
  }

  async getStreamInfo(localId: string): Promise<StreamInfo> {
    await this.init();
    const item = await this.itemById(localId);
    const ms = item.MediaSources?.[0];
    if (!ms) throw new Error('Aucune source média');
    const subtitles = (ms.MediaStreams ?? [])
      .filter((s) => s.Type === 'Subtitle')
      .map((s) => ({
        id: String(s.Index),
        label: s.DisplayTitle ?? s.Language ?? `Sous-titres ${s.Index}`,
        language: s.Language,
        url: `${this.base}/Videos/${localId}/${ms.Id}/Subtitles/${s.Index}/Stream.vtt?apiKey=${this.token}`,
        format: 'vtt' as const,
        default: s.IsDefault,
      }));
    const audioTracks = (ms.MediaStreams ?? [])
      .filter((s) => s.Type === 'Audio')
      .map((s) => ({ id: String(s.Index), label: s.DisplayTitle ?? s.Language ?? `Audio ${s.Index}`, language: s.Language, default: s.IsDefault }));
    return {
      kind: 'direct',
      url: `${this.base}/Videos/${localId}/stream?static=true&MediaSourceId=${ms.Id}&apiKey=${this.token}`,
      mimeType: 'video/mp4',
      duration: item.RunTimeTicks ? Math.round(item.RunTimeTicks / 10_000_000) : undefined,
      subtitles,
      audioTracks,
      qualities: [],
    };
  }
}

interface PlexMeta {
  ratingKey: string;
  type: string;
  title: string;
  year?: number;
  summary?: string;
  thumb?: string;
  art?: string;
  duration?: number;
  viewOffset?: number;
  addedAt?: number;
  Genre?: { tag: string }[];
  Media?: { Part?: { key: string; Stream?: { id: string; streamType: number; displayTitle?: string; language?: string; selected?: boolean; key?: string; codec?: string }[] }[] }[];
}

class PlexDirect implements DirectProvider {
  private base = '';
  private token = '';

  constructor(public source: DirectSource) {}

  private headers(): Record<string, string> {
    return { 'X-Plex-Token': this.token, 'X-Plex-Client-Identifier': 'mediahub-apk', Accept: 'application/json' };
  }

  async init(): Promise<void> {
    if (!this.source.token) throw new Error('Token X-Plex-Token requis');
    this.token = this.source.token;
    if (this.source.baseUrl) {
      this.base = this.source.baseUrl.replace(/\/+$/, '');
    } else {
      const resources = await fetchJson<{ provides?: string; connections?: { uri: string; local?: boolean }[] }[]>('https://plex.tv/api/v2/resources?includeHttps=1&includeRelay=0', { headers: this.headers() });
      const server = resources.find((r) => r.provides?.includes('server'));
      const conn = server?.connections?.find((c) => c.local) ?? server?.connections?.[0];
      if (!conn) throw new Error('Aucun serveur Plex trouvé pour ce compte');
      this.base = conn.uri.replace(/\/+$/, '');
    }
  }

  async health() {
    try {
      await this.init();
      const id = await fetchJson<{ MediaContainer?: { friendlyName?: string } }>(`${this.base}/identity`, { headers: this.headers() });
      return { ok: true, detail: id.MediaContainer?.friendlyName ?? 'Plex' };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  }

  private mapType(t: string): MediaItem['type'] {
    return ({ movie: 'movie', show: 'show', season: 'season', episode: 'episode' } as Record<string, MediaItem['type']>)[t] ?? 'video';
  }

  private img(path: string | undefined, w: number): string | undefined {
    if (!path) return undefined;
    return `${this.base}${path}${path.includes('?') ? '&' : '?'}X-Plex-Token=${this.token}&width=${w}`;
  }

  private toItem(m: PlexMeta): MediaItem {
    return {
      id: `${this.source.id}:${m.ratingKey}`,
      provider: this.source.id,
      type: this.mapType(m.type),
      title: m.title,
      year: m.year,
      overview: m.summary,
      poster: this.img(m.thumb, 500),
      backdrop: this.img(m.art, 1280),
      duration: m.duration ? Math.round(m.duration / 1000) : undefined,
      genres: m.Genre?.map((g) => g.tag),
      progress: m.duration && m.viewOffset ? m.viewOffset / m.duration : undefined,
      dateAdded: m.addedAt ? new Date(m.addedAt * 1000).toISOString() : undefined,
    };
  }

  async listLibraries(): Promise<Library[]> {
    await this.init();
    const res = await fetchJson<{ MediaContainer?: { Directory?: { key: string; title: string; type: string }[] } }>(`${this.base}/library/sections`, { headers: this.headers() });
    return (res.MediaContainer?.Directory ?? [])
      .filter((d) => d.type === 'movie' || d.type === 'show')
      .map((d) => ({ id: d.key, provider: this.source.id, name: d.title, type: this.mapType(d.type) }));
  }

  async listItems(libraryId: string, opts: ListOpts = {}): Promise<ListResult> {
    await this.init();
    const params = new URLSearchParams({ X_Plex_Container_Start: String(opts.offset ?? 0), X_Plex_Container_Size: String(opts.limit ?? 100) });
    const res = await fetchJson<{ Metadata?: PlexMeta[]; totalSize?: number }>(`${this.base}/library/sections/${libraryId}/all?${params}`, { headers: this.headers() });
    return { items: (res.Metadata ?? []).map((m) => this.toItem(m)), total: res.totalSize ?? res.Metadata?.length ?? 0 };
  }

  private async meta(rk: string): Promise<PlexMeta> {
    const res = await fetchJson<{ MediaContainer?: { Metadata?: PlexMeta[] } }>(`${this.base}/library/metadata/${rk}`, { headers: this.headers() });
    const m = res.MediaContainer?.Metadata?.[0];
    if (!m) throw new Error('Métadonnée introuvable');
    return m;
  }

  async getItem(localId: string): Promise<MediaItem | null> {
    try {
      await this.init();
      return this.toItem(await this.meta(localId));
    } catch {
      return null;
    }
  }

  async getChildren(localId: string): Promise<MediaItem[]> {
    await this.init();
    const res = await fetchJson<{ Metadata?: PlexMeta[] }>(`${this.base}/library/metadata/${localId}/children?X_Plex_Container_Size=500`, { headers: this.headers() });
    return (res.Metadata ?? []).map((m) => this.toItem(m));
  }

  async search(q: string, limit = 40): Promise<MediaItem[]> {
    await this.init();
    const res = await fetchJson<{ MediaContainer?: { SearchResult?: { Metadata?: PlexMeta[] }[] } }>(`${this.base}/hubs/search?query=${encodeURIComponent(q)}&limit=${limit}`, { headers: this.headers() });
    return (res.MediaContainer?.SearchResult?.flatMap((s) => s.Metadata ?? []) ?? []).filter((m) => ['movie', 'show', 'episode'].includes(m.type)).map((m) => this.toItem(m));
  }

  async getStreamInfo(localId: string): Promise<StreamInfo> {
    await this.init();
    const m = await this.meta(localId);
    const part = m.Media?.[0]?.Part?.[0];
    if (!part?.key) throw new Error('Aucune partie média');
    const url = `${this.base}${part.key}${part.key.includes('?') ? '&' : '?'}X-Plex-Token=${this.token}`;
    const subtitles = (part.Stream ?? [])
      .filter((s) => s.streamType === 3 && s.key)
      .map((s) => ({
        id: s.id,
        label: s.displayTitle ?? s.language ?? `Sous-titres ${s.id}`,
        language: s.language,
        url: `${this.base}${s.key}${s.key!.includes('?') ? '&' : '?'}X-Plex-Token=${this.token}`,
        format: (s.codec === 'srt' ? 'srt' : 'vtt') as 'vtt' | 'srt',
        default: s.selected,
      }));
    return { kind: 'direct', url, mimeType: 'video/mp4', duration: m.duration ? Math.round(m.duration / 1000) : undefined, subtitles, audioTracks: [], qualities: [] };
  }
}

class KodiDirect implements DirectProvider {
  private base = '';
  private seq = 1;

  constructor(public source: DirectSource) {}

  private async rpc<T>(method: string, params?: Record<string, unknown>): Promise<T> {
    const auth = this.source.username ? basicAuth(this.source.username, this.source.password ?? '') : undefined;
    return fetchJson<T>(`${this.base}/jsonrpc`, { method: 'POST', auth, body: { jsonrpc: '2.0', id: this.seq++, method, params: params ?? {} } });
  }

  private async rpcResult<T>(method: string, params?: Record<string, unknown>): Promise<T> {
    const res = await this.rpc<{ result?: T; error?: { message: string } }>(method, params);
    if (res.error) throw new Error(`Kodi: ${res.error.message}`);
    return res.result as T;
  }

  async init(): Promise<void> {
    if (!this.source.baseUrl) throw new Error('baseUrl requis (ex http://192.168.1.10:8080)');
    this.base = this.source.baseUrl.replace(/\/+$/, '');
    await this.rpcResult('JSONRPC.Ping');
  }

  async health() {
    try {
      await this.init();
      return { ok: true, detail: 'Kodi JSON-RPC OK' };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  }

  async listLibraries(): Promise<Library[]> {
    return [
      { id: 'movies', provider: this.source.id, name: 'Films (Kodi)', type: 'movie' },
      { id: 'tvshows', provider: this.source.id, name: 'Séries (Kodi)', type: 'show' },
    ];
  }

  private async movies(): Promise<MediaItem[]> {
    const res = await this.rpcResult<{ movies?: { movieid: number; title: string; year?: number; thumbnail?: string; file?: string }[] }>('VideoLibrary.GetMovies', { properties: ['title', 'year', 'thumbnail', 'file'], limits: { start: 0, end: 2000 } });
    return (res.movies ?? []).map((m) => ({ id: `${this.source.id}:movie:${m.movieid}`, provider: this.source.id, type: 'movie' as const, title: m.title, year: m.year, poster: m.thumbnail || undefined, extra: { file: m.file } }));
  }

  private async shows(): Promise<MediaItem[]> {
    const res = await this.rpcResult<{ tvshows?: { tvshowid: number; title: string; year?: number; thumbnail?: string }[] }>('VideoLibrary.GetTVShows', { properties: ['title', 'year', 'thumbnail'], limits: { start: 0, end: 2000 } });
    return (res.tvshows ?? []).map((s) => ({ id: `${this.source.id}:tvshow:${s.tvshowid}`, provider: this.source.id, type: 'show' as const, title: s.title, year: s.year, poster: s.thumbnail || undefined, extra: { tvshowid: s.tvshowid } }));
  }

  async listItems(libraryId: string, opts: ListOpts = {}): Promise<ListResult> {
    const all = libraryId === 'movies' ? await this.movies() : libraryId === 'tvshows' ? await this.shows() : [];
    const sorted = [...all].sort((a, b) => a.title.localeCompare(b.title, 'fr'));
    const offset = opts.offset ?? 0;
    const limit = opts.limit ?? 100;
    return { items: sorted.slice(offset, offset + limit), total: sorted.length };
  }

  async getItem(localId: string): Promise<MediaItem | null> {
    const [kind, idStr] = localId.split(':');
    const id = parseInt(idStr, 10);
    if (kind === 'movie') return (await this.movies()).find((m) => m.id === `${this.source.id}:movie:${id}`) ?? null;
    if (kind === 'tvshow') return (await this.shows()).find((s) => s.id === `${this.source.id}:tvshow:${id}`) ?? null;
    if (kind === 'season') {
      const res = await this.rpcResult<{ episodes?: { episodeid: number; title: string; season: number; episode: number; file?: string }[] }>('VideoLibrary.GetEpisodes', { tvshowid: id, properties: ['title', 'season', 'episode', 'file'] }).catch(() => ({ episodes: [] }));
      const eps = res.episodes ?? [];
      return { id: localId, provider: this.source.id, type: 'episode', title: `Épisodes`, extra: { episodes: eps } } as MediaItem;
    }
    return null;
  }

  async getChildren(localId: string): Promise<MediaItem[]> {
    const [kind, idStr] = localId.split(':');
    const id = parseInt(idStr, 10);
    if (kind === 'tvshow') {
      const seasons = await this.rpcResult<{ seasons?: { seasonid: number; season: number; label?: string }[] }>('VideoLibrary.GetSeasons', { tvshowid: id, properties: ['season', 'label'] });
      return (seasons.seasons ?? []).map((s) => ({ id: `${this.source.id}:season:${s.seasonid}`, provider: this.source.id, type: 'season' as const, title: s.label ?? `Saison ${s.season}`, seasonNumber: s.season, extra: { tvshowid: id, season: s.season } }));
    }
    if (kind === 'season') {
      const parent = await this.getItem(localId);
      const showId = (parent?.extra?.tvshowid as number) ?? 0;
      const season = parent?.seasonNumber ?? 0;
      const eps = await this.rpcResult<{ episodes?: { episodeid: number; title: string; season: number; episode: number; file?: string }[] }>('VideoLibrary.GetEpisodes', { tvshowid: showId, season, properties: ['title', 'season', 'episode', 'file'] });
      return (eps.episodes ?? []).map((e) => ({ id: `${this.source.id}:episode:${e.episodeid}`, provider: this.source.id, type: 'episode' as const, title: e.title, seasonNumber: e.season, episodeNumber: e.episode, extra: { file: e.file } }));
    }
    return [];
  }

  async search(q: string, limit = 40): Promise<MediaItem[]> {
    const ql = q.toLowerCase();
    const [m, s] = await Promise.all([this.movies().catch(() => []), this.shows().catch(() => [])]);
    return [...m, ...s].filter((x) => x.title.toLowerCase().includes(ql)).slice(0, limit);
  }

  async getStreamInfo(localId: string): Promise<StreamInfo> {
    const item = await this.getItem(localId);
    const file = item?.extra?.file as string | undefined;
    if (!file) throw new Error('Lecture distante Kodi uniquement (pas de flux HTTP)');
    return { kind: 'remote', subtitles: [], audioTracks: [], qualities: [], extra: { file } };
  }

  async control(localId: string, action: string, value?: number): Promise<unknown> {
    const item = await this.getItem(localId);
    const file = item?.extra?.file as string | undefined;
    switch (action) {
      case 'open':
        if (!file) throw new Error('Fichier inconnu');
        return this.rpcResult('Player.Open', { item: { file } });
      case 'pause': {
        const players = await this.rpcResult<{ playerid?: number }[]>('Player.GetActivePlayers');
        return this.rpcResult('Player.PlayPause', { playerid: players[0]?.playerid ?? 1 });
      }
      case 'stop': {
        const players = await this.rpcResult<{ playerid?: number }[]>('Player.GetActivePlayers');
        return this.rpcResult('Player.Stop', { playerid: players[0]?.playerid ?? 1 });
      }
      case 'seek': {
        const players = await this.rpcResult<{ playerid?: number }[]>('Player.GetActivePlayers');
        return this.rpcResult('Player.Seek', { playerid: players[0]?.playerid ?? 1, value: { percentage: value ?? 0 } });
      }
      case 'state': {
        const players = await this.rpcResult<{ playerid?: number; type?: string }[]>('Player.GetActivePlayers');
        const p = players.find((x) => x.type === 'video') ?? players[0];
        if (!p?.playerid) return { active: false };
        const props = await this.rpcResult<{ percentage?: number; time?: { hours: number; minutes: number; seconds: number }; totaltime?: { hours: number; minutes: number; seconds: number } }>('Player.GetProperties', { playerid: p.playerid, properties: ['percentage', 'time', 'totaltime'] });
        const toSec = (t?: { hours: number; minutes: number; seconds: number }) => (t ? t.hours * 3600 + t.minutes * 60 + t.seconds : 0);
        return { active: true, percentage: props.percentage ?? 0, time: toSec(props.time), total: toSec(props.totaltime) };
      }
      default:
        throw new Error(`Action inconnue: ${action}`);
    }
  }
}

class WebDavDirect implements DirectProvider {
  constructor(public source: DirectSource) {}

  private get base(): string {
    return (this.source.baseUrl ?? '').replace(/\/+$/, '');
  }

  private auth(): string | undefined {
    return this.source.username ? basicAuth(this.source.username, this.source.password ?? '') : undefined;
  }

  async health() {
    try {
      if (Capacitor.isNativePlatform()) {
        const r = await LanFiles.propfind({ url: this.base + '/', auth: this.auth(), depth: 0 });
        if (r.status >= 400) return { ok: false, error: `HTTP ${r.status}` };
      } else {
        const res = await fetch(this.base + '/', { method: 'PROPFIND', headers: { Depth: '0', ...(this.auth() ? { Authorization: 'Basic ' + this.auth() } : {}) } });
        if (res.status >= 400 && res.status !== 401) return { ok: false, error: `HTTP ${res.status}` };
      }
      return { ok: true, detail: this.base };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  }

  private async listPath(path: string): Promise<{ name: string; path: string; isDir: boolean; size: number }[]> {
    if (Capacitor.isNativePlatform()) {
      const r = await LanFiles.propfind({ url: this.base + path, auth: this.auth(), depth: 1 });
      return parsePropfind(r.xml, path);
    }
    const res = await fetch(this.base + path, {
      method: 'PROPFIND',
      headers: { Depth: '1', 'Content-Type': 'application/xml', ...(this.auth() ? { Authorization: 'Basic ' + this.auth() } : {}) },
      body: '<?xml version="1.0"?><D:propfind xmlns:D="DAV:"><D:prop><D:displayname/><D:resourcetype/><D:getcontentlength/></D:prop></D:propfind>',
    });
    if (!res.ok) throw new Error(`PROPFIND HTTP ${res.status}`);
    return parsePropfind(await res.text(), path);
  }

  private toItem(e: { name: string; path: string; isDir: boolean; size: number }): MediaItem {
    const isVideo = !e.isDir && VIDEO_EXTS.has(extOf(e.name));
    const parsed = isVideo ? parseName(e.name) : { title: e.name };
    return {
      id: `${this.source.id}:${encodeURIComponent(e.path)}`,
      provider: this.source.id,
      type: e.isDir ? 'video' : isVideo ? (parsed.season !== undefined ? 'episode' : 'movie') : 'video',
      title: e.isDir ? e.name : parsed.title,
      year: parsed.year,
      seriesTitle: parsed.series,
      seasonNumber: parsed.season,
      episodeNumber: parsed.episode,
      extra: { path: e.path, isDir: e.isDir },
    };
  }

  async listLibraries(): Promise<Library[]> {
    return [{ id: '/', provider: this.source.id, name: `WebDAV — ${this.base}`, type: 'video' }];
  }

  async listItems(libraryId: string, opts: ListOpts = {}): Promise<ListResult> {
    const entries = (await this.listPath(libraryId || '/')).filter((e) => e.name !== '.DS_Store');
    const items = entries.map((e) => this.toItem(e)).sort((a, b) => Number(b.extra?.isDir) - Number(a.extra?.isDir) || a.title.localeCompare(b.title, 'fr'));
    const offset = opts.offset ?? 0;
    const limit = opts.limit ?? 100;
    return { items: items.slice(offset, offset + limit), total: items.length };
  }

  async getItem(localId: string): Promise<MediaItem | null> {
    const path = decodeURIComponent(localId);
    const parent = path.slice(0, path.lastIndexOf('/') + 1) || '/';
    const entries = await this.listPath(parent);
    const e = entries.find((x) => x.path === path);
    return e ? this.toItem(e) : null;
  }

  async getChildren(localId: string): Promise<MediaItem[]> {
    const path = decodeURIComponent(localId);
    const entries = await this.listPath(path);
    return entries.map((e) => this.toItem(e));
  }

  async search(q: string, limit = 40): Promise<MediaItem[]> {
    const ql = q.toLowerCase();
    const walk = async (path: string, depth: number, out: MediaItem[]): Promise<void> => {
      if (depth > 4 || out.length >= limit) return;
      for (const e of await this.listPath(path)) {
        if (out.length >= limit) return;
        if (e.isDir) await walk(e.path, depth + 1, out);
        else if (VIDEO_EXTS.has(extOf(e.name)) && e.name.toLowerCase().includes(ql)) out.push(this.toItem(e));
      }
    };
    const out: MediaItem[] = [];
    await walk('/', 0, out);
    return out;
  }

  async getStreamInfo(localId: string): Promise<StreamInfo> {
    const path = decodeURIComponent(localId);
    const url = this.base + path;
    if (Capacitor.isNativePlatform()) {
      const r = await LanFiles.openStream({ type: 'http', url, user: this.source.username, pass: this.source.password });
      return { kind: 'direct', url: r.url, mimeType: undefined, subtitles: [], audioTracks: [{ id: '0', label: 'Piste par défaut', default: true }], qualities: [], extra: { streamId: r.id } };
    }
    return { kind: 'direct', url, subtitles: [], audioTracks: [{ id: '0', label: 'Piste par défaut', default: true }], qualities: [] };
  }
}

function parsePropfind(xml: string, basePath: string): { name: string; path: string; isDir: boolean; size: number }[] {
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  const out: { name: string; path: string; isDir: boolean; size: number }[] = [];
  const responses = doc.getElementsByTagName('response');
  for (let i = 0; i < responses.length; i++) {
    const r = responses[i];
    const hrefEl = r.getElementsByTagName('href')[0];
    if (!hrefEl) continue;
    let href = decodeURIComponent(hrefEl.textContent ?? '');
    if (!href.startsWith('/')) href = '/' + href;
    if (href === basePath || href === basePath.replace(/\/$/, '') + '/') continue;
    const name = href.replace(/\/$/, '').split('/').pop() ?? href;
    const isDir = r.getElementsByTagName('collection').length > 0;
    const lenEl = r.getElementsByTagName('getcontentlength')[0];
    out.push({ name, path: href, isDir, size: lenEl ? parseInt(lenEl.textContent ?? '0', 10) : 0 });
  }
  return out;
}

class LanDirect implements DirectProvider {
  constructor(public source: DirectSource) {}

  private conn(path: string) {
    return {
      type: this.source.type as 'smb' | 'ftp' | 'sftp',
      host: this.source.host,
      port: this.source.port ?? (this.source.type === 'smb' ? 445 : this.source.type === 'ftp' ? 21 : 22),
      domain: this.source.domain,
      share: this.source.share,
      user: this.source.username,
      pass: this.source.password,
      path,
    };
  }

  async health() {
    try {
      if (!Capacitor.isNativePlatform()) return { ok: false, error: 'Disponible uniquement dans l\'APK Android' };
      const r = await LanFiles.ping(this.conn(this.source.path ?? '/'));
      return r.ok ? { ok: true, detail: `${this.source.host}` } : { ok: false, error: r.error };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  }

  async listLibraries(): Promise<Library[]> {
    return [{ id: this.source.path ?? '/', provider: this.source.id, name: `${this.source.type.toUpperCase()} — ${this.source.host}${this.source.share ? '/' + this.source.share : ''}`, type: 'video' }];
  }

  private toItem(e: { name: string; path: string; isDir: boolean; size: number }): MediaItem {
    const isVideo = !e.isDir && VIDEO_EXTS.has(extOf(e.name));
    const parsed = isVideo ? parseName(e.name) : { title: e.name };
    return {
      id: `${this.source.id}:${encodeURIComponent(e.path)}`,
      provider: this.source.id,
      type: e.isDir ? 'video' : isVideo ? (parsed.season !== undefined ? 'episode' : 'movie') : 'video',
      title: e.isDir ? e.name : parsed.title,
      year: parsed.year,
      seriesTitle: parsed.series,
      seasonNumber: parsed.season,
      episodeNumber: parsed.episode,
      extra: { path: e.path, isDir: e.isDir },
    };
  }

  async listItems(libraryId: string, opts: ListOpts = {}): Promise<ListResult> {
    const r = await LanFiles.browse(this.conn(libraryId || '/'));
    const items = r.items.filter((e) => !e.name.startsWith('.')).map((e) => this.toItem(e)).sort((a, b) => Number(b.extra?.isDir) - Number(a.extra?.isDir) || a.title.localeCompare(b.title, 'fr'));
    const offset = opts.offset ?? 0;
    const limit = opts.limit ?? 100;
    return { items: items.slice(offset, offset + limit), total: items.length };
  }

  async getItem(localId: string): Promise<MediaItem | null> {
    const path = decodeURIComponent(localId);
    const parent = path.slice(0, Math.max(path.lastIndexOf('/'), 0) + (path.includes('/') ? 1 : 0)) || '/';
    const r = await LanFiles.browse(this.conn(parent));
    const e = r.items.find((x) => x.path === path);
    return e ? this.toItem(e) : null;
  }

  async getChildren(localId: string): Promise<MediaItem[]> {
    const r = await LanFiles.browse(this.conn(decodeURIComponent(localId)));
    return r.items.map((e) => this.toItem(e));
  }

  async search(q: string, limit = 40): Promise<MediaItem[]> {
    const ql = q.toLowerCase();
    const out: MediaItem[] = [];
    const walk = async (path: string, depth: number): Promise<void> => {
      if (depth > 4 || out.length >= limit) return;
      try {
        const r = await LanFiles.browse(this.conn(path));
        for (const e of r.items) {
          if (out.length >= limit) return;
          if (e.isDir) await walk(e.path, depth + 1);
          else if (VIDEO_EXTS.has(extOf(e.name)) && e.name.toLowerCase().includes(ql)) out.push(this.toItem(e));
        }
      } catch {
        /* dossier illisible */
      }
    };
    await walk(this.source.path ?? '/', 0);
    return out;
  }

  async getStreamInfo(localId: string): Promise<StreamInfo> {
    const path = decodeURIComponent(localId);
    if (!Capacitor.isNativePlatform()) throw new Error('Streaming réseau natif : APK Android requise');
    const r = await LanFiles.openStream(this.conn(path));
    return { kind: 'direct', url: r.url, subtitles: [], audioTracks: [{ id: '0', label: 'Piste par défaut', default: true }], qualities: [], extra: { streamId: r.id } };
  }
}

class DlnaDirect implements DirectProvider {
  private deviceId = '';

  constructor(public source: DirectSource) {
    this.deviceId = source.baseUrl ?? '';
  }

  async health() {
    try {
      if (!Capacitor.isNativePlatform()) return { ok: false, error: 'DLNA : APK Android requise' };
      const r = await Dlna.discover();
      const found = r.devices.find((d) => d.id === this.deviceId || d.name === this.source.name);
      if (!found) return { ok: false, error: 'Périphérique non trouvé (relance la découverte)' };
      this.deviceId = found.id;
      return { ok: true, detail: found.name };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  }

  async listLibraries(): Promise<Library[]> {
    if (!Capacitor.isNativePlatform()) return [];
    const r = await Dlna.discover();
    return r.devices.map((d) => ({ id: d.id, provider: this.source.id, name: `📺 ${d.name}`, type: 'video' as const }));
  }

  private toItem(e: { id: string; title: string; isDir: boolean; url?: string; mime?: string; size?: number }): MediaItem {
    const isVideo = !e.isDir && !!e.url;
    const parsed = isVideo ? parseName(e.title) : { title: e.title };
    return {
      id: `${this.source.id}:${e.id}`,
      provider: this.source.id,
      type: e.isDir ? 'video' : 'video',
      title: e.isDir ? e.title : parsed.title || e.title,
      extra: { objectId: e.id, isDir: e.isDir, url: e.url, mime: e.mime },
    };
  }

  async listItems(libraryId: string, opts: ListOpts = {}): Promise<ListResult> {
    const r = await Dlna.browse({ deviceId: libraryId || this.deviceId, objectId: '0' });
    const items = r.items.map((e) => this.toItem(e));
    const offset = opts.offset ?? 0;
    const limit = opts.limit ?? 100;
    return { items: items.slice(offset, offset + limit), total: items.length };
  }

  async getItem(localId: string): Promise<MediaItem | null> {
    const libs = await this.listLibraries();
    for (const lib of libs) {
      try {
        const r = await Dlna.browse({ deviceId: lib.id, objectId: localId });
        if (r.items.length) return this.toItem(r.items[0]);
      } catch {
        continue;
      }
    }
    return null;
  }

  async getChildren(localId: string): Promise<MediaItem[]> {
    const libs = await this.listLibraries();
    for (const lib of libs) {
      try {
        const r = await Dlna.browse({ deviceId: lib.id, objectId: localId });
        return r.items.map((e) => this.toItem(e));
      } catch {
        continue;
      }
    }
    return [];
  }

  async search(q: string, limit = 40): Promise<MediaItem[]> {
    return [];
  }

  async getStreamInfo(localId: string): Promise<StreamInfo> {
    const item = await this.getItem(localId);
    const url = item?.extra?.url as string | undefined;
    if (!url) throw new Error('Élément sans URL de lecture (dossier ?)');
    return { kind: 'direct', url, mimeType: (item?.extra?.mime as string) ?? 'video/mp4', subtitles: [], audioTracks: [{ id: '0', label: 'Piste par défaut', default: true }], qualities: [] };
  }
}

export function makeProvider(source: DirectSource): DirectProvider {
  switch (source.type) {
    case 'jellyfin':
    case 'emby':
      return new JellyfinDirect(source);
    case 'plex':
      return new PlexDirect(source);
    case 'kodi':
      return new KodiDirect(source);
    case 'webdav':
      return new WebDavDirect(source);
    case 'smb':
    case 'ftp':
    case 'sftp':
      return new LanDirect(source);
    case 'dlna':
      return new DlnaDirect(source);
    default:
      throw new Error(`Type inconnu: ${source.type}`);
  }
}
