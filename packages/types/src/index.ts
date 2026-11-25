export type MediaType = 'movie' | 'show' | 'season' | 'episode' | 'track' | 'channel' | 'video';

export type ProviderType = 'local' | 'jellyfin' | 'emby' | 'plex' | 'kodi' | 'streamio';

export const PROVIDER_TYPES: ProviderType[] = ['local', 'jellyfin', 'emby', 'plex', 'kodi', 'streamio'];

export interface MediaItem {
  id: string;
  provider: string;
  type: MediaType;
  title: string;
  originalTitle?: string;
  year?: number;
  overview?: string;
  poster?: string;
  backdrop?: string;
  logo?: string;
  duration?: number;
  genres?: string[];
  rating?: number;
  progress?: number;
  libraryId?: string;
  libraryName?: string;
  seriesTitle?: string;
  seasonNumber?: number;
  episodeNumber?: number;
  dateAdded?: string;
  extra?: Record<string, unknown>;
}

export interface Library {
  id: string;
  provider: string;
  name: string;
  type: MediaType;
  itemCount?: number;
}

export interface ListOpts {
  offset?: number;
  limit?: number;
  sort?: 'title' | 'dateAdded' | 'rating' | 'duration';
}

export interface ListResult {
  items: MediaItem[];
  total: number;
}

export interface SubtitleTrack {
  id: string;
  label: string;
  language?: string;
  url: string;
  format: 'vtt' | 'srt' | 'ass';
  default?: boolean;
}

export interface AudioTrack {
  id: string;
  label: string;
  language?: string;
  default?: boolean;
}

export interface QualityLevel {
  id: string;
  label: string;
  height?: number;
  width?: number;
  bitrate?: number;
}

export type StreamKind = 'direct' | 'hls' | 'remote';

export interface StreamInfo {
  kind: StreamKind;
  url?: string;
  mimeType?: string;
  duration?: number;
  width?: number;
  height?: number;
  subtitles: SubtitleTrack[];
  audioTracks: AudioTrack[];
  qualities: QualityLevel[];
  extra?: Record<string, unknown>;
}

export interface ProviderConfig {
  id: string;
  type: ProviderType;
  name: string;
  baseUrl?: string;
  token?: string;
  username?: string;
  password?: string;
  paths?: string[];
  addons?: string[];
  enabled: boolean;
  options?: Record<string, unknown>;
}

export interface ProviderStatus {
  id: string;
  type: ProviderType;
  name: string;
  enabled: boolean;
  healthy: boolean;
  error?: string;
  detail?: string;
}

export interface ProgressEntry {
  ref: string;
  position: number;
  duration: number;
  updatedAt: string;
  item?: MediaItem;
}

export interface MediaProvider {
  readonly instanceId: string;
  readonly type: ProviderType;
  readonly label: string;
  init(config: ProviderConfig): Promise<void>;
  health(): Promise<{ ok: boolean; error?: string; detail?: string }>;
  listLibraries(): Promise<Library[]>;
  listItems(libraryId: string, opts?: ListOpts): Promise<ListResult>;
  getItem(localId: string): Promise<MediaItem | null>;
  getChildren(localId: string): Promise<MediaItem[]>;
  search(query: string, limit?: number): Promise<MediaItem[]>;
  getStreamInfo(localId: string): Promise<StreamInfo>;
  control?(localId: string, action: string, value?: number): Promise<unknown>;
}

export function makeRef(instanceId: string, localId: string): string {
  return `${instanceId}:${localId}`;
}

export function splitRef(ref: string): { instanceId: string; localId: string } {
  const i = ref.indexOf(':');
  if (i < 0) throw new Error(`Référence invalide: ${ref}`);
  return { instanceId: ref.slice(0, i), localId: ref.slice(i + 1) };
}
