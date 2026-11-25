import type { Library, ListResult, MediaItem, ProgressEntry, ProviderConfig, ProviderStatus, StreamInfo } from '@umh/types';

export function apiBase(): string {
  try {
    return (localStorage.getItem('umh_api_base') ?? '').replace(/\/+$/, '');
  } catch {
    return '';
  }
}

export function setApiBase(v: string): void {
  try {
    localStorage.setItem('umh_api_base', v.trim().replace(/\/+$/, ''));
  } catch {
    /* stockage indisponible */
  }
}

export function apiUrl(path: string): string {
  return `${apiBase()}/api${path}`;
}

export function absUrl(u?: string): string | undefined {
  if (!u) return u;
  if (u.startsWith('/api/')) return `${apiBase()}${u}`;
  return u;
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(apiUrl(path), {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    let msg = `Erreur ${res.status}`;
    try {
      const j = (await res.json()) as { error?: string };
      if (j.error) msg = j.error;
    } catch {
      msg = res.statusText || msg;
    }
    throw new Error(msg);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const fetchHealth = () => api<{ ok: boolean }>('/health');
export const fetchProviders = () => api<ProviderStatus[]>('/providers');
export const saveProvider = (cfg: ProviderConfig) => api<ProviderStatus>('/providers', { method: 'PUT', body: JSON.stringify(cfg) });
export const deleteProvider = (id: string) => api<{ ok: boolean }>(`/providers/${encodeURIComponent(id)}`, { method: 'DELETE' });
export const testProvider = (id: string) => api<ProviderStatus>(`/providers/${encodeURIComponent(id)}/test`, { method: 'POST' });
export const fetchLibraries = () => api<Library[]>('/libraries');
export const fetchLibraryItems = (provider: string, id: string, opts: { offset?: number; limit?: number; sort?: string } = {}) =>
  api<ListResult>(`/library?provider=${encodeURIComponent(provider)}&id=${encodeURIComponent(id)}${opts.offset !== undefined ? `&offset=${opts.offset}` : ''}&limit=${opts.limit ?? 100}${opts.sort ? `&sort=${opts.sort}` : ''}`);
export const fetchItem = (ref: string) => api<MediaItem>(`/item?ref=${encodeURIComponent(ref)}`);
export const fetchChildren = (ref: string) => api<MediaItem[]>(`/item/children?ref=${encodeURIComponent(ref)}`);
export const search = (q: string, limit = 40) => api<{ items: MediaItem[] }>(`/search?q=${encodeURIComponent(q)}&limit=${limit}`);
export const fetchStream = (ref: string) => api<StreamInfo & { ref: string }>(`/stream?ref=${encodeURIComponent(ref)}`);
export const fetchProgress = (ref: string) => api<ProgressEntry | null>(`/progress?ref=${encodeURIComponent(ref)}`);
export const saveProgress = (ref: string, position: number, duration: number) =>
  api<ProgressEntry>('/progress', { method: 'PUT', body: JSON.stringify({ ref, position, duration }) });
export const fetchContinue = () => api<{ items: ProgressEntry[] }>('/continue');
export const remoteControl = (ref: string, action: string, value?: number) =>
  api<{ ok: boolean }>('/remote', { method: 'POST', body: JSON.stringify({ ref, action, value }) });

export function playUrl(ref: string): string {
  return `${apiBase()}/api/play?ref=${encodeURIComponent(ref)}`;
}
