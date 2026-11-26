export type DirectSourceType = 'jellyfin' | 'emby' | 'plex' | 'kodi' | 'webdav' | 'smb' | 'ftp' | 'sftp' | 'dlna';

export interface DirectSource {
  id: string;
  type: DirectSourceType;
  name: string;
  enabled: boolean;
  baseUrl?: string;
  host?: string;
  port?: number;
  domain?: string;
  share?: string;
  path?: string;
  username?: string;
  password?: string;
  token?: string;
}

const SRC_KEY = 'umh_direct_sources';
const KEY_KEY = 'umh_device_key';

async function deviceKey(): Promise<CryptoKey> {
  const existing = localStorage.getItem(KEY_KEY);
  if (existing) {
    const raw = Uint8Array.from(atob(existing), (c) => c.charCodeAt(0));
    return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
  }
  const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
  const raw = new Uint8Array(await crypto.subtle.exportKey('raw', key));
  let bin = '';
  raw.forEach((b) => (bin += String.fromCharCode(b)));
  localStorage.setItem(KEY_KEY, btoa(bin));
  return key;
}

export async function encryptText(s: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deviceKey();
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(s)));
  const toB64 = (b: Uint8Array) => btoa(String.fromCharCode(...b));
  return `${toB64(iv)}:${toB64(ct)}`;
}

export async function decryptText(s: string): Promise<string> {
  const [ivB64, ctB64] = s.split(':');
  const iv = Uint8Array.from(atob(ivB64), (c) => c.charCodeAt(0));
  const ct = Uint8Array.from(atob(ctB64), (c) => c.charCodeAt(0));
  const key = await deviceKey();
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
  return new TextDecoder().decode(plain);
}

interface StoredSource {
  config: DirectSource;
  secrets: Record<string, string>;
}

export async function loadSources(): Promise<DirectSource[]> {
  try {
    const raw = localStorage.getItem(SRC_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw) as StoredSource[];
    const out: DirectSource[] = [];
    for (const e of arr) {
      const s = { ...e.config };
      for (const [k, v] of Object.entries(e.secrets ?? {})) {
        (s as unknown as Record<string, string>)[k] = await decryptText(v);
      }
      out.push(s);
    }
    return out;
  } catch {
    return [];
  }
}

export async function saveSources(list: DirectSource[]): Promise<void> {
  const stored: StoredSource[] = [];
  for (const s of list) {
    const secrets: Record<string, string> = {};
    const copy = { ...s };
    for (const f of ['token', 'password'] as const) {
      const v = s[f];
      if (v) {
        secrets[f] = await encryptText(v);
        (copy as unknown as Record<string, string>)[f] = '';
      }
    }
    stored.push({ config: copy, secrets });
  }
  localStorage.setItem(SRC_KEY, JSON.stringify(stored));
}
