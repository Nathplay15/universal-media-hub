import type { MediaProvider, ProviderConfig, ProviderType } from '@umh/types';
import { LocalProvider } from './local.js';
import { JellyfinLikeProvider } from './jellyfin.js';
import { PlexProvider } from './plex.js';
import { KodiProvider } from './kodi.js';
import { StreamioProvider } from './streamio.js';

export * from './util.js';
export { LocalProvider, JellyfinLikeProvider, PlexProvider, KodiProvider, StreamioProvider };

export function createProvider(type: ProviderType): MediaProvider {
  switch (type) {
    case 'local':
      return new LocalProvider();
    case 'jellyfin':
      return new JellyfinLikeProvider('jellyfin');
    case 'emby':
      return new JellyfinLikeProvider('emby');
    case 'plex':
      return new PlexProvider();
    case 'kodi':
      return new KodiProvider();
    case 'streamio':
      return new StreamioProvider();
    default:
      throw new Error(`Type de fournisseur inconnu: ${type as string}`);
  }
}

export function newProviderId(type: ProviderType, existing: ProviderConfig[]): string {
  let n = 1;
  const ids = new Set(existing.map((c) => c.id));
  while (ids.has(`${type}-${n}`)) n++;
  return `${type}-${n}`;
}
