export async function fetchJson<T>(
  url: string,
  opts: { method?: string; headers?: Record<string, string>; body?: unknown; auth?: string; timeoutMs?: number } = {},
): Promise<T> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 20000);
  try {
    const headers: Record<string, string> = { Accept: 'application/json', ...opts.headers };
    if (opts.auth) headers['Authorization'] = 'Basic ' + btoa(opts.auth);
    if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
    const res = await fetch(url, {
      method: opts.method ?? 'GET',
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      signal: ctrl.signal,
    });
    if (!res.ok) {
      let detail = '';
      try {
        detail = (await res.text()).slice(0, 300);
      } catch {
        /* pas de corps */
      }
      throw new Error(`HTTP ${res.status} ${res.statusText} — ${url}${detail ? ` — ${detail}` : ''}`);
    }
    return (await res.json()) as T;
  } finally {
    clearTimeout(t);
  }
}

export function basicAuth(user: string, pass: string): string {
  return btoa(`${user}:${pass}`);
}
