import type { Library, ListOpts, ListResult, MediaItem, StreamInfo } from '@umh/types';
import type { DirectSource } from './vault';

export interface DirectProvider {
  source: DirectSource;
  health(): Promise<{ ok: boolean; error?: string; detail?: string }>;
  listLibraries(): Promise<Library[]>;
  listItems(libraryId: string, opts?: ListOpts): Promise<ListResult>;
  getItem(localId: string): Promise<MediaItem | null>;
  getChildren(localId: string): Promise<MediaItem[]>;
  search(q: string, limit?: number): Promise<MediaItem[]>;
  getStreamInfo(localId: string): Promise<StreamInfo>;
  control?(localId: string, action: string, value?: number): Promise<unknown>;
}
