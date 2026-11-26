export interface HttpOpts {
  method?: string;
  headers?: Record<string, string>;
  body?: unknown;
  timeoutMs?: number;
  basicAuth?: string;
}

export async function httpJson<T>(url: string, opts: HttpOpts = {}): Promise<T> {
  const res = await httpFetch(url, opts);
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText} pour ${url}`);
  return (await res.json()) as T;
}

export async function httpText(url: string, opts: HttpOpts = {}): Promise<string> {
  const res = await httpFetch(url, opts);
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText} pour ${url}`);
  return res.text();
}

async function httpFetch(url: string, opts: HttpOpts): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 20000);
  try {
    const headers: Record<string, string> = { Accept: 'application/json', ...opts.headers };
    if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
    if (opts.basicAuth) headers['Authorization'] = 'Basic ' + Buffer.from(opts.basicAuth).toString('base64');
    return await fetch(url, {
      method: opts.method ?? 'GET',
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      signal: ctrl.signal,
    });
  } finally {
    clearTimeout(t);
  }
}

export const VIDEO_EXTS = new Set(['mkv', 'mp4', 'avi', 'mov', 'wmv', 'flv', 'webm', 'm4v', 'mpg', 'mpeg', 'ts', 'm2ts', 'ogv', '3gp']);
export const IMAGE_EXTS = new Set(['jpg', 'jpeg', 'png', 'webp', 'gif']);
export const SUB_EXTS = new Set(['vtt', 'srt', 'ass', 'ssa']);

export function extOf(p: string): string {
  const i = p.lastIndexOf('.');
  return i < 0 ? '' : p.slice(i + 1).toLowerCase();
}

export function mimeOf(p: string): string {
  const e = extOf(p);
  const map: Record<string, string> = {
    mkv: 'video/x-matroska', mp4: 'video/mp4', m4v: 'video/mp4', mov: 'video/quicktime',
    webm: 'video/webm', avi: 'video/x-msvideo', wmv: 'video/x-ms-wmv', flv: 'video/x-flv',
    mpg: 'video/mpeg', mpeg: 'video/mpeg', ts: 'video/mp2t', m2ts: 'video/mp2t', ogv: 'video/ogg',
    jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif',
    vtt: 'text/vtt', srt: 'application/x-subrip', ass: 'text/x-ssa', ssa: 'text/x-ssa',
    mp3: 'audio/mpeg', flac: 'audio/flac', m4a: 'audio/mp4', ogg: 'audio/ogg', wav: 'audio/wav', opus: 'audio/ogg',
  };
  return map[e] ?? 'application/octet-stream';
}

export function b64u(s: string): string {
  return Buffer.from(s, 'utf8').toString('base64url');
}

export function unb64u(s: string): string {
  return Buffer.from(s, 'base64url').toString('utf8');
}

export interface ParsedName {
  title: string;
  year?: number;
  season?: number;
  episode?: number;
  seriesTitle?: string;
}

export function parseFileName(fileName: string): ParsedName {
  const base = fileName.replace(/\.[^.]+$/, '');
  let season: number | undefined;
  let episode: number | undefined;
  let seriesTitle: string | undefined;
  let title = base;
  const se = base.match(/^(.*?)[ ._\-]*[Ss](\d{1,2})[Ee](\d{1,3})/);
  if (se) {
    seriesTitle = se[1].replace(/[._]+/g, ' ').trim();
    season = parseInt(se[2], 10);
    episode = parseInt(se[3], 10);
    title = `${seriesTitle} S${String(season).padStart(2, '0')}E${String(episode).padStart(2, '0')}`;
  }
  let year: number | undefined;
  const ym = base.match(/\b(19\d{2}|20\d{2})\b/);
  if (ym) year = parseInt(ym[1], 10);
  const cleanTitle = base
    .replace(/\b(19\d{2}|20\d{2})\b/g, ' ')
    .replace(/[ ._\-]*[Ss]\d{1,2}[Ee]\d{1,3}.*$/i, ' ')
    .replace(/[._]+/g, ' ')
    .replace(/\[[^\]]*\]|\([^)]*\)/g, ' ')
    .replace(/\b(1080p|720p|2160p|4k|bluray|bdrip|webrip|web-dl|hdtv|x264|x265|hevc|hdrip|dvdrip|aac|dts|hdr|remux)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!se && cleanTitle) title = cleanTitle;
  return { title: title || base, year, season, episode, seriesTitle };
}

export function formatDuration(sec?: number): string {
  if (!sec || !isFinite(sec)) return '';
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return h > 0 ? `${h}h ${String(m).padStart(2, '0')}min` : `${m} min`;
}

export function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}
