import type { Library, ListOpts, ListResult, MediaItem, MediaProvider, ProviderConfig, StreamInfo } from '@umh/types';
import { httpJson } from './util.js';

interface AddonManifest {
  id: string;
  name: string;
  version?: string;
  catalogs?: { id: string; name: string; type: string }[];
  resources?: string[];
}

interface AddonMeta {
  id: string;
  type: string;
  name: string;
  poster?: string;
  description?: string;
  year?: string;
}

interface AddonStream {
  name?: string;
  title?: string;
  url?: string;
  infoHash?: string;
  behaviorHints?: { notWebReady?: boolean; bingeGroup?: string; proxyHeaders?: unknown };
}

interface CachedAddon {
  url: string;
  manifest: AddonManifest;
  at: number;
}

export class StreamioProvider implements MediaProvider {
  readonly type = 'streamio' as const;
  readonly label = 'Streamio (addons Stremio)';
  instanceId = 'streamio';
  private cfg!: ProviderConfig;
  private addons: CachedAddon[] = [];

  async init(config: ProviderConfig): Promise<void> {
    const urls = (config.addons ?? []).map((u) => u.trim()).filter(Boolean);
    if (!urls.length) throw new Error('Aucune URL d\'addon configurée');
    this.cfg = config;
    this.instanceId = config.id;
    this.addons = [];
    for (const url of urls) {
      const manifest = await httpJson<AddonManifest>(url);
      if (!manifest.id) throw new Error(`Manifest invalide: ${url}`);
      this.addons.push({ url: url.replace(/\/manifest\.json$/, '').replace(/\/$/, ''), manifest, at: Date.now() });
    }
  }

  async health(): Promise<{ ok: boolean; error?: string; detail?: string }> {
    try {
      if (!this.addons.length) await this.init(this.cfg);
      return { ok: true, detail: `${this.addons.length} addon(s): ${this.addons.map((a) => a.manifest.name).join(', ')}` };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  }

  async listLibraries(): Promise<Library[]> {
    const libs: Library[] = [];
    this.addons.forEach((a, idx) => {
      for (const c of a.manifest.catalogs ?? []) {
        libs.push({
          id: `${idx}:${c.id}:${c.type}`,
          provider: this.instanceId,
          name: `${a.manifest.name} — ${c.name}`,
          type: c.type === 'series' ? 'show' : c.type === 'movie' ? 'movie' : 'video',
        });
      }
    });
    return libs;
  }

  private parseLib(libraryId: string): { addon: CachedAddon; catalogId: string; type: string } {
    const [idxStr, catalogId, ...rest] = libraryId.split(':');
    const addon = this.addons[parseInt(idxStr, 10)];
    if (!addon) throw new Error('Addon inconnu');
    return { addon, catalogId, type: rest.join(':') };
  }

  async listItems(libraryId: string, opts: ListOpts = {}): Promise<ListResult> {
    const { addon, catalogId, type } = this.parseLib(libraryId);
    const skip = opts.offset ?? 0;
    const res = await httpJson<{ metas?: AddonMeta[] }>(`${addon.url}/catalog/${type}/${catalogId}.json${skip > 0 ? `?skip=${skip}` : ''}`);
    const metas = res.metas ?? [];
    const limit = opts.limit ?? 100;
    return {
      items: metas.slice(0, limit).map((m) => ({
        id: `${this.instanceId}:s:${addon.url}:${m.type}:${m.id}`,
        provider: this.instanceId,
        type: m.type === 'series' ? 'show' : m.type === 'movie' ? 'movie' : 'video',
        title: m.name,
        overview: m.description,
        poster: m.poster,
        year: m.year ? parseInt(m.year, 10) : undefined,
        libraryId,
        extra: { addonUrl: addon.url, contentType: m.type, contentId: m.id },
      })),
      total: metas.length,
    };
  }

  async getItem(localId: string): Promise<MediaItem | null> {
    return null;
  }

  async getChildren(localId: string): Promise<MediaItem[]> {
    const [kind, addonUrl, contentType, ...idParts] = localId.split(':');
    if (kind !== 's') return [];
    const addon = this.addons.find((a) => a.url === addonUrl);
    if (!addon || contentType !== 'series') return [];
    const contentId = idParts.join(':');
    try {
      const res = await httpJson<{ metas?: { id: string; name: string }[] }>(`${addon.url}/meta/series/${encodeURIComponent(contentId)}.json`);
      const videos = (res as { videos?: { id: string; name: string; season?: number; episode?: number }[] }).videos ?? [];
      return videos.map((v) => ({
        id: `${this.instanceId}:s:${addonUrl}:series:${v.id}`,
        provider: this.instanceId,
        type: 'episode' as const,
        title: v.name,
        seasonNumber: v.season,
        episodeNumber: v.episode,
        extra: { addonUrl, contentType: 'series', contentId: v.id },
      }));
    } catch {
      return [];
    }
  }

  async search(query: string, limit = 40): Promise<MediaItem[]> {
    const out: MediaItem[] = [];
    const q = query.toLowerCase();
    for (const lib of await this.listLibraries()) {
      try {
        const res = await this.listItems(lib.id, { limit: 100 });
        for (const it of res.items) if (it.title.toLowerCase().includes(q)) out.push(it);
        if (out.length >= limit) break;
      } catch {
        continue;
      }
    }
    return out.slice(0, limit);
  }

  async getStreamInfo(localId: string): Promise<StreamInfo> {
    const [kind, addonUrl, contentType, ...idParts] = localId.split(':');
    if (kind !== 's') throw new Error('Référence streamio invalide');
    const addon = this.addons.find((a) => a.url === addonUrl);
    if (!addon) throw new Error('Addon introuvable');
    const contentId = idParts.join(':');
    const res = await httpJson<{ streams?: AddonStream[] }>(`${addon.url}/stream/${contentType}/${encodeURIComponent(contentId)}.json`);
    const streams = (res.streams ?? []).filter((s) => s.url && s.url.startsWith('http'));
    if (!streams.length) throw new Error('Aucun flux disponible (essayez un autre addon ou média)');
    const score = (s: AddonStream): number => {
      const name = `${s.name ?? ''} ${s.title ?? ''}`;
      let sc = 0;
      if (/web-?dl|webrip|bluray|remux|1080p|2160p|4k/i.test(name)) sc += 2;
      if (!s.behaviorHints?.notWebReady) sc += 1;
      if (/debrid|real-?debrid|premiumize|alldebrid|torbox/i.test(name)) sc += 3;
      if (/torrent|magnet|infoHash/i.test(name) && !s.url) sc -= 10;
      return sc;
    };
    streams.sort((a, b) => score(b) - score(a));
    const best = streams[0];
    const isHls = /\.m3u8(\?|$)/i.test(best.url!);
    return {
      kind: isHls ? 'hls' : 'direct',
      url: best.url,
      mimeType: isHls ? 'application/vnd.apple.mpegurl' : undefined,
      subtitles: [],
      audioTracks: [{ id: '0', label: 'Piste par défaut', default: true }],
      qualities: [],
      extra: {
        allStreams: streams.map((s, i) => ({ index: i, label: `${s.name ?? 'Flux'} — ${(s.title ?? '').split('\n')[0]}`.trim(), url: s.url })),
      },
    };
  }
}
