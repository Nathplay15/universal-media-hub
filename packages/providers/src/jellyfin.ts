import type { Library, ListOpts, ListResult, MediaItem, MediaProvider, ProviderConfig, StreamInfo, ProviderType, SubtitleTrack } from '@umh/types';
import { httpJson } from './util.js';

interface JfItem {
  Id: string;
  Name: string;
  Type: string;
  ProductionYear?: number;
  Overview?: string;
  CommunityRating?: number;
  OfficialRating?: string;
  Genres?: string[];
  RunTimeTicks?: number;
  PlaybackPositionTicks?: number;
  DateCreated?: string;
  SeriesName?: string;
  ParentIndexNumber?: number;
  IndexNumber?: number;
  MediaSources?: { Id: string; Container?: string; MediaStreams?: JfStream[] }[];
  ImageTags?: Record<string, string>;
  BackdropImageTags?: string[];
}

interface JfStream {
  Index: number;
  Type: 'Audio' | 'Video' | 'Subtitle';
  Language?: string;
  DisplayTitle?: string;
  IsDefault?: boolean;
  Codec?: string;
}

interface JfList {
  Items: JfItem[];
  TotalRecordCount: number;
}

export class JellyfinLikeProvider implements MediaProvider {
  readonly label: string;
  instanceId = 'jellyfin';
  private cfg!: ProviderConfig;
  private base = '';
  private token = '';
  private userId = '';

  constructor(readonly type: ProviderType) {
    this.label = type === 'emby' ? 'Emby' : 'Jellyfin';
  }

  private headers(): Record<string, string> {
    return { 'X-Emby-Token': this.token, 'X-MediaBrowser-Token': this.token };
  }

  async init(config: ProviderConfig): Promise<void> {
    if (!config.baseUrl) throw new Error('baseUrl requis');
    this.cfg = config;
    this.instanceId = config.id;
    this.base = config.baseUrl.replace(/\/+$/, '');
    if (config.token) {
      this.token = config.token;
    } else if (config.username) {
      const auth = await httpJson<{ AccessToken: string; User: { Id: string } }>(`${this.base}/Users/AuthenticateByName`, {
        method: 'POST',
        headers: {
          'X-Emby-Authorization': `MediaBrowser Client="UMH", Device="universal-media-hub", DeviceId="umh-1", Version="0.1.0"`,
        },
        body: { Username: config.username, Pw: config.password ?? '' },
      });
      this.token = auth.AccessToken;
      this.userId = auth.User.Id;
    } else {
      throw new Error('Clé API (token) ou identifiants requis');
    }
    if (!this.userId) {
      const users = await httpJson<{ Id: string }[]>(`${this.base}/Users`, { headers: this.headers() });
      this.userId = users[0]?.Id ?? '';
    }
  }

  async health(): Promise<{ ok: boolean; error?: string; detail?: string }> {
    try {
      const info = await httpJson<{ ServerName?: string; Version?: string }>(`${this.base}/System/Info/Public`);
      return { ok: true, detail: `${info.ServerName ?? this.label} ${info.Version ?? ''}`.trim() };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  }

  private mapType(t: string): MediaItem['type'] {
    switch (t) {
      case 'Movie': return 'movie';
      case 'Series': return 'show';
      case 'Season': return 'season';
      case 'Episode': return 'episode';
      case 'Audio': return 'track';
      case 'TvChannel': return 'channel';
      default: return 'video';
    }
  }

  private img(item: JfItem, kind: 'Primary' | 'Backdrop', maxWidth = 500): string | undefined {
    if (kind === 'Primary' && !item.ImageTags?.Primary) return undefined;
    if (kind === 'Backdrop' && !item.BackdropImageTags?.length) return undefined;
    const tag = kind === 'Primary' ? '' : `/0`;
    return `${this.base}/Items/${item.Id}/Images/${kind}${tag}?maxWidth=${maxWidth}&quality=90&tag=${kind === 'Primary' ? item.ImageTags!.Primary : item.BackdropImageTags![0]}&apiKey=${this.token}`;
  }

  private toItem(it: JfItem): MediaItem {
    const dur = it.RunTimeTicks ? Math.round(it.RunTimeTicks / 10_000_000) : undefined;
    return {
      id: `${this.instanceId}:${it.Id}`,
      provider: this.instanceId,
      type: this.mapType(it.Type),
      title: it.Name,
      year: it.ProductionYear,
      overview: it.Overview,
      poster: this.img(it, 'Primary'),
      backdrop: this.img(it, 'Backdrop', 1280),
      duration: dur,
      genres: it.Genres,
      rating: it.CommunityRating,
      progress: it.RunTimeTicks && it.PlaybackPositionTicks ? it.PlaybackPositionTicks / it.RunTimeTicks : undefined,
      dateAdded: it.DateCreated,
      seriesTitle: it.SeriesName,
      seasonNumber: it.ParentIndexNumber,
      episodeNumber: it.IndexNumber,
      extra: { rawId: it.Id },
    };
  }

  async listLibraries(): Promise<Library[]> {
    const folders = await httpJson<{ Name: string; ItemId?: string; CollectionType?: string }[]>(`${this.base}/Library/VirtualFolders`, { headers: this.headers() });
    return folders.map((f) => ({
      id: f.ItemId ?? f.Name,
      provider: this.instanceId,
      name: f.Name,
      type: this.mapType(f.CollectionType === 'tvshows' ? 'Series' : f.CollectionType === 'movies' ? 'Movie' : 'video'),
    }));
  }

  async listItems(libraryId: string, opts: ListOpts = {}): Promise<ListResult> {
    const sortMap: Record<string, string> = { title: 'SortName', dateAdded: 'DateCreated', rating: 'CommunityRating', duration: 'RunTimeTicks' };
    const params = new URLSearchParams({
      ParentId: libraryId,
      Recursive: 'true',
      Fields: 'Genres,Overview,CommunityRating,ProductionYear,MediaSources,ImageTags,BackdropImageTags,RunTimeTicks,PlaybackPositionTicks,DateCreated,SeriesName,ParentIndexNumber,IndexNumber',
      SortBy: sortMap[opts.sort ?? 'title'] ?? 'SortName',
      SortOrder: opts.sort === 'rating' ? 'Descending' : 'Ascending',
      StartIndex: String(opts.offset ?? 0),
      Limit: String(opts.limit ?? 100),
    });
    const res = await httpJson<JfList>(`${this.base}/Users/${this.userId}/Items?${params}`, { headers: this.headers() });
    return { items: (res.Items ?? []).map((i) => this.toItem(i)), total: res.TotalRecordCount ?? res.Items?.length ?? 0 };
  }

  private async itemById(id: string): Promise<JfItem> {
    return httpJson<JfItem>(`${this.base}/Users/${this.userId}/Items/${id}`, { headers: this.headers() });
  }

  async getItem(localId: string): Promise<MediaItem | null> {
    try {
      return this.toItem(await this.itemById(localId));
    } catch {
      return null;
    }
  }

  async getChildren(localId: string): Promise<MediaItem[]> {
    const item = await this.itemById(localId);
    if (item.Type === 'Series') {
      const params = new URLSearchParams({ ParentId: localId, IncludeItemTypes: 'Season', Fields: 'Overview,ImageTags', SortBy: 'SortName' });
      const res = await httpJson<JfList>(`${this.base}/Users/${this.userId}/Items?${params}`, { headers: this.headers() });
      return (res.Items ?? []).map((i) => this.toItem(i));
    }
    if (item.Type === 'Season') {
      const params = new URLSearchParams({ ParentId: localId, IncludeItemTypes: 'Episode', Fields: 'Overview,ImageTags,RunTimeTicks,PlaybackPositionTicks,MediaSources,SeriesName,ParentIndexNumber,IndexNumber', SortBy: 'IndexNumber' });
      const res = await httpJson<JfList>(`${this.base}/Users/${this.userId}/Items?${params}`, { headers: this.headers() });
      return (res.Items ?? []).map((i) => this.toItem(i));
    }
    return [];
  }

  async search(query: string, limit = 40): Promise<MediaItem[]> {
    const params = new URLSearchParams({
      SearchTerm: query,
      Recursive: 'true',
      Limit: String(limit),
      IncludeItemTypes: 'Movie,Episode,Series,Audio',
      Fields: 'Genres,Overview,CommunityRating,ProductionYear,ImageTags,BackdropImageTags,RunTimeTicks,SeriesName,ParentIndexNumber,IndexNumber',
    });
    const res = await httpJson<JfList>(`${this.base}/Users/${this.userId}/Items?${params}`, { headers: this.headers() });
    return (res.Items ?? []).map((i) => this.toItem(i));
  }

  async getStreamInfo(localId: string): Promise<StreamInfo> {
    const item = await this.itemById(localId);
    const ms = item.MediaSources?.[0];
    if (!ms) throw new Error('Aucune source média');
    const url = `${this.base}/Videos/${localId}/stream?static=true&MediaSourceId=${ms.Id}&apiKey=${this.token}`;
    const subtitles: SubtitleTrack[] = (ms.MediaStreams ?? [])
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
      url,
      mimeType: ms.Container ? `video/${ms.Container === 'mp4' ? 'mp4' : 'x-matroska'}` : 'video/mp4',
      duration: item.RunTimeTicks ? Math.round(item.RunTimeTicks / 10_000_000) : undefined,
      subtitles,
      audioTracks,
      qualities: [],
    };
  }
}
