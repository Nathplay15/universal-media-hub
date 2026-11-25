import { Capacitor } from '@capacitor/core';
import type { Library, ListOpts, ListResult, MediaItem, ProgressEntry, ProviderStatus, StreamInfo } from '@umh/types';

export * from './api';
import * as api from './api';
import * as direct from './direct/engine';

export function isDirectMode(): boolean {
  try {
    const m = localStorage.getItem('umh_mode');
    if (m === 'direct' || m === 'server') return m === 'direct';
  } catch {
    /* ignore */
  }
  return Capacitor.isNativePlatform();
}

export function setMode(m: 'direct' | 'server'): void {
  try {
    localStorage.setItem('umh_mode', m);
  } catch {
    /* ignore */
  }
}

export async function fetchProviders(): Promise<ProviderStatus[]> {
  return isDirectMode() ? direct.listSourceStatuses() : api.fetchProviders();
}

export async function fetchLibraries(): Promise<Library[]> {
  return isDirectMode() ? direct.listLibraries() : api.fetchLibraries();
}

export async function fetchLibraryItems(provider: string, id: string, opts: { offset?: number; limit?: number; sort?: string } = {}): Promise<ListResult> {
  return isDirectMode() ? direct.listItems(provider, id, { ...opts, sort: opts.sort as ListOpts['sort'] }) : api.fetchLibraryItems(provider, id, opts);
}

export async function fetchItem(ref: string): Promise<MediaItem> {
  return isDirectMode() ? (direct.getItem(ref) as Promise<MediaItem>) : api.fetchItem(ref);
}

export async function fetchChildren(ref: string): Promise<MediaItem[]> {
  return isDirectMode() ? direct.getChildren(ref) : api.fetchChildren(ref);
}

export async function search(q: string, limit?: number): Promise<{ items: MediaItem[] }> {
  return isDirectMode() ? { items: await direct.search(q, limit) } : api.search(q, limit);
}

export async function fetchStream(ref: string): Promise<StreamInfo & { ref: string }> {
  return isDirectMode() ? direct.getStream(ref) : api.fetchStream(ref);
}

export async function fetchProgress(ref: string): Promise<ProgressEntry | null> {
  return isDirectMode() ? direct.getProgress(ref) : api.fetchProgress(ref);
}

export async function saveProgress(ref: string, position: number, duration: number): Promise<ProgressEntry> {
  return isDirectMode() ? direct.setProgress(ref, position, duration) : api.saveProgress(ref, position, duration);
}

export async function fetchContinue(): Promise<{ items: ProgressEntry[] }> {
  return isDirectMode() ? direct.continueWatching() : api.fetchContinue();
}

export async function remoteControl(ref: string, action: string, value?: number): Promise<{ ok: boolean }> {
  if (isDirectMode()) {
    await direct.remoteControl(ref, action, value);
    return { ok: true };
  }
  return api.remoteControl(ref, action, value);
}
