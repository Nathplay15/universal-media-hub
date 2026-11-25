import type { Library, ListOpts, ListResult, MediaItem, ProgressEntry, ProviderStatus, StreamInfo } from '@umh/types';
import * as direct from './direct/engine';

export function isDirectMode(): boolean {
  return true;
}

export async function fetchProviders(): Promise<ProviderStatus[]> {
  return direct.listSourceStatuses();
}

export async function fetchLibraries(): Promise<Library[]> {
  return direct.listLibraries();
}

export async function fetchLibraryItems(provider: string, id: string, opts: { offset?: number; limit?: number; sort?: string } = {}): Promise<ListResult> {
  return direct.listItems(provider, id, { ...opts, sort: opts.sort as ListOpts['sort'] });
}

export async function fetchItem(ref: string): Promise<MediaItem> {
  const item = await direct.getItem(ref);
  if (!item) throw new Error('Média introuvable');
  return item;
}

export async function fetchChildren(ref: string): Promise<MediaItem[]> {
  return direct.getChildren(ref);
}

export async function search(q: string, limit?: number): Promise<{ items: MediaItem[] }> {
  return { items: await direct.search(q, limit) };
}

export async function fetchStream(ref: string): Promise<StreamInfo & { ref: string }> {
  return direct.getStream(ref);
}

export async function fetchProgress(ref: string): Promise<ProgressEntry | null> {
  return direct.getProgress(ref);
}

export async function saveProgress(ref: string, position: number, duration: number): Promise<ProgressEntry> {
  return direct.setProgress(ref, position, duration);
}

export async function fetchContinue(): Promise<{ items: ProgressEntry[] }> {
  return direct.continueWatching();
}

export async function remoteControl(ref: string, action: string, value?: number): Promise<{ ok: boolean }> {
  await direct.remoteControl(ref, action, value);
  return { ok: true };
}

export function apiBase(): string {
  return '';
}

export function absUrl(u?: string): string | undefined {
  return u;
}
