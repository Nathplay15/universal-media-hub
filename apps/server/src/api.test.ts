import { beforeAll, describe, expect, it } from 'vitest';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import { mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { b64u } from '@umh/providers';
import { Vault } from './vault.js';
import { Registry } from './registry.js';
import { ProgressStore } from './progress.js';
import { registerRoutes } from './routes.js';

let app: ReturnType<typeof Fastify>;
let mediaRoot: string;

beforeAll(async () => {
  process.env.UMH_MASTER_KEY = 'cd'.repeat(32);
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'umh-data-'));
  mediaRoot = await mkdtemp(path.join(os.tmpdir(), 'umh-media-'));
  await writeFile(path.join(mediaRoot, 'Film Test 2021.mp4'), 'FAKEVIDEO');
  await writeFile(path.join(mediaRoot, 'Film Test 2021.srt'), '1\n00:00:01,000 --> 00:00:02,000\nHi\n');

  const registry = new Registry(new Vault(dataDir));
  await registry.load();
  const progress = new ProgressStore(dataDir);

  app = Fastify();
  await app.register(cors, { origin: true });
  registerRoutes(app, registry, progress);
  await app.ready();

  const res = await app.inject({
    method: 'PUT',
    url: '/api/providers',
    payload: { id: 'local-1', type: 'local', name: 'Test', paths: [mediaRoot], enabled: true },
  });
  expect(res.statusCode).toBe(200);
});

const getRef = async (): Promise<string> => {
  const libs = (await app.inject({ method: 'GET', url: '/api/libraries' })).json() as { id: string }[];
  const list = (await app.inject({ method: 'GET', url: `/api/library?provider=local-1&id=${encodeURIComponent(libs[0].id)}&limit=10` })).json() as { items: { id: string; title: string }[] };
  return list.items[0].id;
};

describe('API MediaHub (fastify inject)', () => {
  it('GET /api/health', async () => {
    const r = await app.inject({ method: 'GET', url: '/api/health' });
    expect(r.statusCode).toBe(200);
    expect(r.json().ok).toBe(true);
  });

  it('GET /api/providers → local-1 healthy', async () => {
    const ps = (await app.inject({ method: 'GET', url: '/api/providers' })).json() as { id: string; healthy: boolean }[];
    expect(ps.find((p) => p.id === 'local-1')?.healthy).toBe(true);
  });

  it('libraries → items → search', async () => {
    const libs = (await app.inject({ method: 'GET', url: '/api/libraries' })).json() as { id: string }[];
    expect(libs).toHaveLength(1);
    const list = (await app.inject({ method: 'GET', url: `/api/library?provider=local-1&id=${encodeURIComponent(libs[0].id)}&limit=10` })).json() as { total: number; items: { title: string }[] };
    expect(list.total).toBe(1);
    expect(list.items[0].title).toBe('Film Test');
    const s = (await app.inject({ method: 'GET', url: '/api/search?q=film' })).json() as { items: unknown[] };
    expect(s.items).toHaveLength(1);
  });

  it('stream + play 302 + fs Range 206 + sous-titres', async () => {
    const ref = await getRef();
    const st = (await app.inject({ method: 'GET', url: `/api/stream?ref=${encodeURIComponent(ref)}` })).json() as { kind: string; subtitles: unknown[] };
    expect(st.kind).toBe('direct');
    expect(st.subtitles).toHaveLength(1);

    const play = await app.inject({ method: 'GET', url: `/api/play?ref=${encodeURIComponent(ref)}` });
    expect(play.statusCode).toBe(302);
    const loc = play.headers.location as string;
    expect(loc).toMatch(/^\/api\/fs\//);

    const fs = await app.inject({ method: 'GET', url: loc, headers: { range: 'bytes=0-3' } });
    expect(fs.statusCode).toBe(206);
    expect(fs.headers['content-range']).toBe('bytes 0-3/9');
    expect(fs.body).toBe('FAKE');
  });

  it('fs refuse hors racines (403)', async () => {
    const r = await app.inject({ method: 'GET', url: `/api/fs/${b64u('/etc/passwd')}` });
    expect(r.statusCode).toBe(403);
  });

  it('progress PUT/GET + /api/continue', async () => {
    const ref = await getRef();
    await app.inject({ method: 'PUT', url: '/api/progress', payload: { ref, position: 42, duration: 100 } });
    const g = await app.inject({ method: 'GET', url: `/api/progress?ref=${encodeURIComponent(ref)}` });
    expect(g.json().position).toBe(42);
    const c = (await app.inject({ method: 'GET', url: '/api/continue' })).json() as { items: { item?: { title: string }; position: number }[] };
    expect(c.items).toHaveLength(1);
    expect(c.items[0].item?.title).toBe('Film Test');
  });

  it('PUT /api/providers sans id → 400', async () => {
    const r = await app.inject({ method: 'PUT', url: '/api/providers', payload: { type: 'local' } });
    expect(r.statusCode).toBe(400);
  });

  it('DELETE /api/providers/:id', async () => {
    const r = await app.inject({ method: 'DELETE', url: '/api/providers/local-1' });
    expect(r.statusCode).toBe(200);
    const ps = (await app.inject({ method: 'GET', url: '/api/providers' })).json() as unknown[];
    expect(ps).toHaveLength(0);
  });
});
