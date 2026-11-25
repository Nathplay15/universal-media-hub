const cache = new Map<string, string>();

export function srtToVtt(input: string): string {
  const normalized = input.replace(/\r/g, '').replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2');
  return `WEBVTT\n\n${normalized.trim()}\n`;
}

export function assToVtt(input: string): string {
  const lines = input.replace(/\r/g, '').split('\n');
  const out: string[] = ['WEBVTT', ''];
  let inEvents = false;
  for (const line of lines) {
    if (/^\s*\[Events\]/i.test(line)) {
      inEvents = true;
      continue;
    }
    if (/^\s*\[/i.test(line)) inEvents = false;
    if (!inEvents) continue;
    if (!/^\s*Dialogue:/i.test(line)) continue;
    const parts = line.replace(/^\s*Dialogue:\s*/i, '').split(',');
    if (parts.length < 10) continue;
    const start = parts[1].trim().replace(/(\d+):(\d{2}):(\d{2})\.(\d{2})/, '00:$1:$2.$3');
    const end = parts[2].trim().replace(/(\d+):(\d{2}):(\d{2})\.(\d{2})/, '00:$1:$2.$3');
    const text = parts.slice(9).join(',').replace(/\{[^}]*\}/g, '').replace(/\\N/gi, '\n').trim();
    if (text) out.push(`${start} --> ${end}`, text, '');
  }
  return out.join('\n');
}

export async function subtitleTrackUrl(url: string, format: string): Promise<string> {
  if (format === 'vtt') return url;
  const key = `${format}:${url}`;
  const cached = cache.get(key);
  if (cached) return cached;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Sous-titres illisibles (${res.status})`);
  const text = await res.text();
  const vtt = format === 'srt' ? srtToVtt(text) : assToVtt(text);
  const blobUrl = URL.createObjectURL(new Blob([vtt], { type: 'text/vtt' }));
  cache.set(key, blobUrl);
  return blobUrl;
}
