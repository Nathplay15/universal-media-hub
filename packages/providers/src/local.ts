import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { Library, ListOpts, ListResult, MediaItem, MediaProvider, ProviderConfig, StreamInfo, SubtitleTrack } from '@umh/types';
import { VIDEO_EXTS, IMAGE_EXTS, SUB_EXTS, b64u, extOf, mimeOf, parseFileName } from './util.js';

const MAX_DEPTH = 6;

interface CacheEntry {
  at: number;
  items: MediaItem[];
}

export class LocalProvider implements MediaProvider {
  readonly type = 'local' as const;
  readonly label = 'Stockage local';
  instanceId = 'local';
  private cfg!: ProviderConfig;
  private cache = new Map<string, CacheEntry>();

  async init(config: ProviderConfig): Promise<void> {
    if (!config.paths?.length) throw new Error('Aucun chemin configuré');
    for (const p of config.paths) {
      const st = await fs.stat(p).catch(() => null);
      if (!st?.isDirectory()) throw new Error(`Chemin invalide ou illisible: ${p}`);
    }
    this.cfg = config;
    this.instanceId = config.id;
    this.cache.clear();
  }

  private roots(): string[] {
    return this.cfg.paths ?? [];
  }

  private resolveSafe(p: string): string | null {
    const abs = path.resolve(p);
    for (const r of this.roots()) {
      const root = path.resolve(r);
      if (abs === root || abs.startsWith(root + path.sep)) return abs;
    }
    return null;
  }

  async health(): Promise<{ ok: boolean; error?: string; detail?: string }> {
    for (const r of this.roots()) {
      const ok = !!(await fs.stat(r).catch(() => null));
      if (!ok) return { ok: false, error: `Chemin inaccessible: ${r}` };
    }
    return { ok: true, detail: `${this.roots().length} dossier(s) monté(s)` };
  }

  async listLibraries(): Promise<Library[]> {
    return this.roots().map((p) => ({
      id: b64u(path.resolve(p)),
      provider: this.instanceId,
      name: path.basename(path.resolve(p)) || p,
      type: 'video',
    }));
  }

  private async walk(dir: string, depth: number, out: { file: string; rel: string }[]): Promise<void> {
    if (depth > MAX_DEPTH) return;
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name.startsWith('.')) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) await this.walk(full, depth + 1, out);
      else if (e.isFile() && VIDEO_EXTS.has(extOf(e.name))) out.push({ file: full, rel: path.relative(dir, full) });
    }
  }

  private async itemsFor(root: string): Promise<MediaItem[]> {
    const cached = this.cache.get(root);
    if (cached && Date.now() - cached.at < 60_000) return cached.items;
    const files: { file: string; rel: string }[] = [];
    await this.walk(root, 0, files);
    const items: MediaItem[] = [];
    for (const f of files) {
      const parsed = parseFileName(path.basename(f.file));
      const st = await fs.stat(f.file).catch(() => null);
      const baseNoExt = f.file.replace(/\.[^.]+$/, '');
      let poster: string | undefined;
      for (const img of ['.jpg', '.jpeg', '.png', '.webp']) {
        if (await fs.stat(baseNoExt + img).then((s) => s.isFile()).catch(() => false)) {
          poster = `/api/fs/${b64u(baseNoExt + img)}`;
          break;
        }
      }
      const isEpisode = parsed.season !== undefined && parsed.episode !== undefined;
      items.push({
        id: `${this.instanceId}:${b64u(f.file)}`,
        provider: this.instanceId,
        type: isEpisode ? 'episode' : 'movie',
        title: parsed.title,
        year: parsed.year,
        seriesTitle: parsed.seriesTitle,
        seasonNumber: parsed.season,
        episodeNumber: parsed.episode,
        poster,
        dateAdded: st ? st.mtime.toISOString() : undefined,
        libraryId: b64u(root),
        libraryName: path.basename(root) || root,
        duration: undefined,
        extra: { path: f.file },
      });
    }
    this.cache.set(root, { at: Date.now(), items });
    return items;
  }

  private rootForLibrary(libraryId: string): string | null {
    const abs = this.resolveSafe(unb64uSafe(libraryId));
    return abs;
  }

  async listItems(libraryId: string, opts: ListOpts = {}): Promise<ListResult> {
    const root = this.rootForLibrary(libraryId);
    if (!root) throw new Error('Bibliothèque inconnue');
    let items = await this.itemsFor(root);
    const sort = opts.sort ?? 'title';
    items = [...items].sort((a, b) => {
      if (sort === 'dateAdded') return (b.dateAdded ?? '').localeCompare(a.dateAdded ?? '');
      if (sort === 'rating') return (b.rating ?? 0) - (a.rating ?? 0);
      return a.title.localeCompare(b.title, 'fr');
    });
    const total = items.length;
    const offset = opts.offset ?? 0;
    const limit = opts.limit ?? 100;
    return { items: items.slice(offset, offset + limit), total };
  }

  async getItem(localId: string): Promise<MediaItem | null> {
    const file = unb64uSafe(localId);
    const safe = this.resolveSafe(file);
    if (!safe || !VIDEO_EXTS.has(extOf(safe))) return null;
    const root = this.rootOf(safe) ?? path.dirname(safe);
    const all = await this.itemsFor(root);
    return all.find((i) => i.extra?.path === safe) ?? null;
  }

  private rootOf(file: string): string | null {
    for (const r of this.roots()) {
      const root = path.resolve(r);
      if (file === root || file.startsWith(root + path.sep)) return root;
    }
    return null;
  }

  async getChildren(localId: string): Promise<MediaItem[]> {
    return [];
  }

  async search(query: string, limit = 40): Promise<MediaItem[]> {
    const q = query.toLowerCase();
    const out: MediaItem[] = [];
    for (const root of this.roots()) {
      const items = await this.itemsFor(root);
      for (const it of items) {
        if (it.title.toLowerCase().includes(q) || it.seriesTitle?.toLowerCase().includes(q)) out.push(it);
        if (out.length >= limit) return out;
      }
    }
    return out;
  }

  async getStreamInfo(localId: string): Promise<StreamInfo> {
    const file = this.resolveSafe(unb64uSafe(localId));
    if (!file) throw new Error('Fichier hors des racines autorisées');
    const st = await fs.stat(file).catch(() => null);
    if (!st?.isFile()) throw new Error('Fichier introuvable');
    const baseNoExt = file.replace(/\.[^.]+$/, '');
    const subtitles: SubtitleTrack[] = [];
    for (const ext of ['vtt', 'srt', 'ass']) {
      const sub = `${baseNoExt}.${ext}`;
      if (await fs.stat(sub).then((s) => s.isFile()).catch(() => false)) {
        subtitles.push({
          id: ext,
          label: `Sous-titres (${ext.toUpperCase()})`,
          url: `/api/fs/${b64u(sub)}`,
          format: ext as 'vtt' | 'srt' | 'ass',
        });
      }
    }
    const dirSubs = ['subs', 'subtitles'];
    for (const d of dirSubs) {
      const subDir = path.join(path.dirname(file), d);
      const entries = await fs.readdir(subDir).catch(() => [] as string[]);
      for (const e of entries) {
        const eExt = extOf(e).toLowerCase();
        if (!SUB_EXTS.has(eExt)) continue;
        const base = path.basename(file, path.extname(file)).toLowerCase();
        if (e.toLowerCase().startsWith(base.slice(0, Math.min(base.length, 20)))) {
          subtitles.push({
            id: e,
            label: e,
            url: `/api/fs/${b64u(path.join(subDir, e))}`,
            format: eExt as 'vtt' | 'srt' | 'ass',
          });
        }
      }
    }
    return {
      kind: 'direct',
      url: `/api/fs/${b64u(file)}`,
      mimeType: mimeOf(file),
      duration: undefined,
      subtitles,
      audioTracks: [{ id: '0', label: 'Piste par défaut', default: true }],
      qualities: [],
    };
  }
}

function unb64uSafe(s: string): string {
  try {
    return Buffer.from(s, 'base64url').toString('utf8');
  } catch {
    return s;
  }
}
