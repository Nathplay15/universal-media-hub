import { beforeAll, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { splitRef } from '@umh/types';
import { LocalProvider } from './local.js';
import { b64u } from './util.js';

let root: string;

beforeAll(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'umh-media-'));
  await mkdir(path.join(root, 'série'), { recursive: true });
  await writeFile(path.join(root, 'Film Test 2021.mp4'), 'FAKEVIDEO');
  await writeFile(path.join(root, 'série', 'Ma.Serie.S01E01.Pilote.2023.mkv'), 'VID');
  await writeFile(path.join(root, 'série', 'Ma.Serie.S01E01.Pilote.2023.jpg'), 'IMG');
  await writeFile(path.join(root, 'série', 'Ma.Serie.S01E01.Pilote.2023.srt'), '1\n00:00:01,000 --> 00:00:02,000\nSalut\n');
  await writeFile(path.join(root, '.hidden.mp4'), 'X');
  await writeFile(path.join(root, 'notes.txt'), 'X');
});

const make = async () => {
  const p = new LocalProvider();
  await p.init({ id: 'local-1', type: 'local', name: 'Test', paths: [root], enabled: true });
  return p;
};

describe('LocalProvider', () => {
  it('init refuse un chemin invalide', async () => {
    const p = new LocalProvider();
    await expect(p.init({ id: 'x', type: 'local', name: 'x', paths: ['/chemin/inexistant-xyz-123'], enabled: true })).rejects.toThrow();
  });

  it('health ok', async () => {
    expect((await (await make()).health()).ok).toBe(true);
  });

  it('listLibraries → 1 bibliothèque', async () => {
    const libs = await (await make()).listLibraries();
    expect(libs).toHaveLength(1);
    expect(libs[0].provider).toBe('local-1');
    expect(libs[0].id).toBe(b64u(root));
  });

  it('listItems : récursif, ignore fichiers cachés et non-vidéo', async () => {
    const p = await make();
    const libs = await p.listLibraries();
    const res = await p.listItems(libs[0].id, { limit: 50 });
    expect(res.total).toBe(2);
    const ep = res.items.find((i) => i.type === 'episode');
    expect(ep).toBeDefined();
    expect(ep?.seriesTitle).toBe('Ma Serie');
    expect(ep?.seasonNumber).toBe(1);
    expect(ep?.episodeNumber).toBe(1);
    expect(ep?.year).toBe(2023);
    expect(ep?.poster).toMatch(/^\/api\/fs\//);
    const film = res.items.find((i) => i.type === 'movie');
    expect(film?.title).toBe('Film Test');
    expect(film?.poster).toBeUndefined();
  });

  it('search trouve la série', async () => {
    const p = await make();
    const r = await p.search('serie');
    expect(r).toHaveLength(1);
    expect(r[0].title).toContain('S01E01');
  });

  it('getStreamInfo : url /api/fs + sous-titre sidecar détecté', async () => {
    const p = await make();
    const libs = await p.listLibraries();
    const res = await p.listItems(libs[0].id, { limit: 50 });
    const ep = res.items.find((i) => i.type === 'episode')!;
    const { localId } = splitRef(ep.id);
    const st = await p.getStreamInfo(localId);
    expect(st.kind).toBe('direct');
    expect(st.url).toMatch(/^\/api\/fs\//);
    expect(st.mimeType).toBe('video/x-matroska');
    expect(st.subtitles).toHaveLength(1);
    expect(st.subtitles[0].format).toBe('srt');
  });

  it('refuse un fichier hors des racines', async () => {
    const p = await make();
    await expect(p.getStreamInfo(b64u('/etc/passwd'))).rejects.toThrow();
  });
});
