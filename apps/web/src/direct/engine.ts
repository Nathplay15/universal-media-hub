import { splitRef } from '@umh/types';
import type { Library, ListOpts, ListResult, MediaItem, ProgressEntry, ProviderStatus, StreamInfo } from '@umh/types';
import { loadSources, saveSources, type DirectSource } from './vault';
import { makeProvider } from './providers';
import type { DirectProvider } from './types';

const cache = new Map<string, DirectProvider>();

export async function providerFor(id: string): Promise<DirectProvider> {
  const cached = cache.get(id);
  if (cached) return cached;
  const srcs = await loadSources();
  const src = srcs.find((s) => s.id === id);
  if (!src) throw new Error(`Source inconnue: ${id}`);
  const p = makeProvider(src);
  cache.set(id, p);
  return p;
}

export async function listSourceStatuses(): Promise<ProviderStatus[]> {
  const srcs = await loadSources();
  return Promise.all(
    srcs.map(async (s): Promise<ProviderStatus> => {
      let healthy = false;
      let error: string | undefined;
      let detail: string | undefined;
      if (s.enabled) {
        try {
          const h = await makeProvider(s).health();
          healthy = h.ok;
          error = h.error;
          detail = h.detail;
        } catch (e) {
          error = (e as Error).message;
        }
      }
      return { id: s.id, type: s.type as ProviderStatus['type'], name: s.name, enabled: s.enabled, healthy, error, detail };
    }),
  );
}

export async function saveSource(src: DirectSource): Promise<ProviderStatus> {
  const list = await loadSources();
  const i = list.findIndex((s) => s.id === src.id);
  if (i >= 0) list[i] = src;
  else list.push(src);
  await saveSources(list);
  cache.delete(src.id);
  const statuses = await listSourceStatuses();
  const st = statuses.find((s) => s.id === src.id);
  if (!st) throw new Error('Sauvegarde échouée');
  return st;
}

export async function deleteSource(id: string): Promise<void> {
  const list = await loadSources();
  await saveSources(list.filter((s) => s.id !== id));
  cache.delete(id);
}

export async function testSource(id: string): Promise<ProviderStatus> {
  cache.delete(id);
  const statuses = await listSourceStatuses();
  const st = statuses.find((s) => s.id === id);
  if (!st) throw new Error(`Source inconnue: ${id}`);
  return st;
}

async function enabledProviders(): Promise<DirectProvider[]> {
  const srcs = (await loadSources()).filter((s) => s.enabled);
  return Promise.all(srcs.map((s) => Promise.resolve(makeProvider(s))));
}

export const providerErrors = new Map<string, string>();

export async function listLibraries(): Promise<Library[]> {
  const out: Library[] = [];
  for (const p of await enabledProviders()) {
    try {
      const libs = await p.listLibraries();
      providerErrors.delete(p.source.id);
      out.push(...libs);
    } catch (e) {
      providerErrors.set(p.source.id, `${p.source.name}: ${(e as Error).message}`);
    }
  }
  return out;
}

export async function listItems(providerId: string, libraryId: string, opts: ListOpts = {}): Promise<ListResult> {
  return (await providerFor(providerId)).listItems(libraryId, opts);
}

export async function getItem(ref: string): Promise<MediaItem | null> {
  const { instanceId, localId } = splitRef(ref);
  return (await providerFor(instanceId)).getItem(localId);
}

export async function getChildren(ref: string): Promise<MediaItem[]> {
  const { instanceId, localId } = splitRef(ref);
  return (await providerFor(instanceId)).getChildren(localId);
}

export async function search(q: string, limit = 40): Promise<MediaItem[]> {
  const out: MediaItem[] = [];
  for (const p of await enabledProviders()) {
    try {
      out.push(...(await p.search(q, limit)));
    } catch {
      /* ignore */
    }
  }
  return out.slice(0, limit * 2);
}

export async function getStream(ref: string): Promise<StreamInfo & { ref: string }> {
  const { instanceId, localId } = splitRef(ref);
  const info = await (await providerFor(instanceId)).getStreamInfo(localId);
  return { ref, ...info };
}

export async function remoteControl(ref: string, action: string, value?: number): Promise<unknown> {
  const { instanceId, localId } = splitRef(ref);
  const p = await providerFor(instanceId);
  if (!p.control) throw new Error('Cette source ne supporte pas la télécommande');
  return p.control(localId, action, value);
}

const PROG_KEY = 'umh_progress';

interface StoredProg {
  position: number;
  duration: number;
  updatedAt: string;
}

export function getProgress(ref: string): ProgressEntry | null {
  try {
    const m = JSON.parse(localStorage.getItem(PROG_KEY) ?? '{}') as Record<string, StoredProg>;
    const e = m[ref];
    return e ? { ref, ...e } : null;
  } catch {
    return null;
  }
}

export function setProgress(ref: string, position: number, duration: number): ProgressEntry {
  const m = JSON.parse(localStorage.getItem(PROG_KEY) ?? '{}') as Record<string, StoredProg>;
  const entry: ProgressEntry = { ref, position, duration, updatedAt: new Date().toISOString() };
  m[ref] = { position, duration, updatedAt: entry.updatedAt };
  localStorage.setItem(PROG_KEY, JSON.stringify(m));
  return entry;
}

export async function continueWatching(limit = 50): Promise<{ items: ProgressEntry[] }> {
  const m = JSON.parse(localStorage.getItem(PROG_KEY) ?? '{}') as Record<string, StoredProg>;
  const entries = Object.entries(m)
    .map(([ref, e]) => ({ ref, ...e }))
    .filter((e) => e.duration > 0 && e.position > 5 && e.position < e.duration - 10)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, limit);
  const items: ProgressEntry[] = [];
  for (const e of entries) {
    try {
      const item = await getItem(e.ref);
      if (item) {
        item.progress = e.position / e.duration;
        items.push({ ...e, item });
      }
    } catch {
      /* ignore */
    }
  }
  return { items };
}
