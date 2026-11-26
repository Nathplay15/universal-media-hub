import type { Library, ListOpts, ListResult, MediaItem, MediaProvider, ProviderConfig, StreamInfo, SubtitleTrack } from '@umh/types';
import { httpJson } from './util.js';

interface PlexDirectory {
  key: string;
  title: string;
  type: string;
}

interface PlexMetadata {
  ratingKey: string;
  type: string;
  title: string;
  originalTitle?: string;
  year?: number;
  summary?: string;
  thumb?: string;
  art?: string;
  duration?: number;
  viewOffset?: number;
  addedAt?: number;
  Genre?: { tag: string }[];
  Media?: { Part?: { key: string; Stream?: PlexStream[] }[] }[];
}

interface PlexStream {
  id: string;
  streamType: number;
  codec?: string;
  displayTitle?: string;
  language?: string;
  selected?: boolean;
  key?: string;
}

interface PlexCollection {
  Metadata?: PlexMetadata[];
  totalSize?: number;
}

const CLIENT_ID = 'universal-media-hub-492aab';

export class PlexProvider implements MediaProvider {
  readonly type = 'plex' as const;
  readonly label = 'Plex';
  instanceId = 'plex';
  private cfg!: ProviderConfig;
  private base = '';
  private token = '';

  private headers(): Record<string, string> {
    return { 'X-Plex-Token': this.token, 'X-Plex-Client-Identifier': CLIENT_ID, Accept: 'application/json' };
  }

  async init(config: ProviderConfig): Promise<void> {
    if (!config.token) throw new Error('Token X-Plex-Token requis');
    this.cfg = config;
    this.instanceId = config.id;
    this.token = config.token;
    if (config.baseUrl) {
      this.base = config.baseUrl.replace(/\/+$/, '');
    } else {
      const resources = await httpJson<{ provides?: string; connections?: { uri: string; local?: boolean }[] }[]>(
        'https://plex.tv/api/v2/resources?includeHttps=1&includeRelay=0',
        { headers: this.headers() },
      );
      const server = resources.find((r) => r.provides?.includes('server'));
      const conn = server?.connections?.find((c) => c.local) ?? server?.connections?.[0];
      if (!conn) throw new Error('Aucun serveur Plex trouvé pour ce compte plex.tv');
      this.base = conn.uri.replace(/\/+$/, '');
    }
  }

  async health(): Promise<{ ok: boolean; error?: string; detail?: string }> {
    try {
      const id = await httpJson<{ MediaContainer?: { machineIdentifier?: string; friendlyName?: string } }>(`${this.base}/identity`, { headers: this.headers() });
      const sections = await httpJson<{ MediaContainer?: { Directory?: unknown[] } }>(`${this.base}/library/sections`, { headers: this.headers() });
      return { ok: true, detail: `${id.MediaContainer?.friendlyName ?? 'Plex'} — ${sections.MediaContainer?.Directory?.length ?? 0} bibliothèque(s)` };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  }

  private mapType(t: string): MediaItem['type'] {
    switch (t) {
      case 'movie': return 'movie';
      case 'show': return 'show';
      case 'season': return 'season';
      case 'episode': return 'episode';
      default: return 'video';
    }
  }

  private img(path: string | undefined, w: number): string | undefined {
    if (!path) return undefined;
    return `${this.base}${path}${path.includes('?') ? '&' : '?'}X-Plex-Token=${this.token}&width=${w}`;
  }

  private toItem(m: PlexMetadata, libraryId?: string, libraryName?: string): MediaItem {
    return {
      id: `${this.instanceId}:${m.ratingKey}`,
      provider: this.instanceId,
      type: this.mapType(m.type),
      title: m.title,
      originalTitle: m.originalTitle,
      year: m.year,
      overview: m.summary,
      poster: this.img(m.thumb, 500),
      backdrop: this.img(m.art, 1280),
      duration: m.duration ? Math.round(m.duration / 1000) : undefined,
      genres: m.Genre?.map((g) => g.tag),
      rating: undefined,
      progress: m.duration && m.viewOffset ? m.viewOffset / m.duration : undefined,
      dateAdded: m.addedAt ? new Date(m.addedAt * 1000).toISOString() : undefined,
      libraryId,
      libraryName,
      extra: { ratingKey: m.ratingKey },
    };
  }

  async listLibraries(): Promise<Library[]> {
    const res = await httpJson<{ MediaContainer?: { Directory?: PlexDirectory[] } }>(`${this.base}/library/sections`, { headers: this.headers() });
    return (res.MediaContainer?.Directory ?? [])
      .filter((d) => d.type === 'movie' || d.type === 'show')
      .map((d) => ({ id: d.key, provider: this.instanceId, name: d.title, type: this.mapType(d.type) }));
  }

  async listItems(libraryId: string, opts: ListOpts = {}): Promise<ListResult> {
    const sortMap: Record<string, string> = { title: 'titleSort', dateAdded: 'addedAt', rating: 'rating', duration: 'duration' };
    const params = new URLSearchParams({
      sort: `${sortMap[opts.sort ?? 'title']}:desc`.replace(':desc', opts.sort === 'rating' ? ':desc' : ':asc'),
      X_Plex_Container_Start: String(opts.offset ?? 0),
      X_Plex_Container_Size: String(opts.limit ?? 100),
    });
    const res = await httpJson<PlexCollection>(`${this.base}/library/sections/${libraryId}/all?${params}`, { headers: this.headers() });
    const libs = await this.listLibraries().catch(() => []);
    const lib = libs.find((l) => l.id === libraryId);
    return {
      items: (res.Metadata ?? []).map((m) => this.toItem(m, libraryId, lib?.name)),
      total: res.totalSize ?? res.Metadata?.length ?? 0,
    };
  }

  private async meta(ratingKey: string): Promise<PlexMetadata> {
    const res = await httpJson<{ MediaContainer?: { Metadata?: PlexMetadata[] } }>(`${this.base}/library/metadata/${ratingKey}`, { headers: this.headers() });
    const m = res.MediaContainer?.Metadata?.[0];
    if (!m) throw new Error(`Métadonnée introuvable: ${ratingKey}`);
    return m;
  }

  async getItem(localId: string): Promise<MediaItem | null> {
    try {
      return this.toItem(await this.meta(localId));
    } catch {
      return null;
    }
  }

  async getChildren(localId: string): Promise<MediaItem[]> {
    const res = await httpJson<PlexCollection>(`${this.base}/library/metadata/${localId}/children?X_Plex_Container_Size=500`, { headers: this.headers() });
    return (res.Metadata ?? []).map((m) => this.toItem(m));
  }

  async search(query: string, limit = 40): Promise<MediaItem[]> {
    const res = await httpJson<{ MediaContainer?: { SearchResult?: { Metadata?: PlexMetadata[] }[] } }>(
      `${this.base}/hubs/search?query=${encodeURIComponent(query)}&limit=${limit}`,
      { headers: this.headers() },
    );
    const metas = res.MediaContainer?.SearchResult?.flatMap((s) => s.Metadata ?? []) ?? [];
    return metas.filter((m) => m.type === 'movie' || m.type === 'show' || m.type === 'episode').map((m) => this.toItem(m));
  }

  async getStreamInfo(localId: string): Promise<StreamInfo> {
    const m = await this.meta(localId);
    const part = m.Media?.[0]?.Part?.[0];
    if (!part?.key) throw new Error('Aucune partie média (fichier) disponible');
    const url = `${this.base}${part.key}${part.key.includes('?') ? '&' : '?'}X-Plex-Token=${this.token}`;
    const subtitles: SubtitleTrack[] = (part.Stream ?? [])
      .filter((s) => s.streamType === 3 && s.key)
      .map((s) => ({
        id: s.id,
        label: s.displayTitle ?? s.language ?? `Sous-titres ${s.id}`,
        language: s.language,
        url: `${this.base}${s.key}${s.key!.includes('?') ? '&' : '?'}X-Plex-Token=${this.token}`,
        format: (s.codec === 'srt' ? 'srt' : 'vtt') as 'vtt' | 'srt',
        default: s.selected,
      }));
    const audioTracks = (part.Stream ?? [])
      .filter((s) => s.streamType === 2)
      .map((s) => ({ id: s.id, label: s.displayTitle ?? s.language ?? `Audio ${s.id}`, language: s.language, default: s.selected }));
    return {
      kind: 'direct',
      url,
      mimeType: 'video/mp4',
      duration: m.duration ? Math.round(m.duration / 1000) : undefined,
      subtitles,
      audioTracks,
      qualities: [],
    };
  }
}
