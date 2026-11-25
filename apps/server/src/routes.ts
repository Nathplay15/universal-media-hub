import { createReadStream, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { realpathSync } from 'node:fs';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { ListOpts, MediaItem, ProgressEntry, ProviderConfig, StreamInfo } from '@umh/types';
import { splitRef } from '@umh/types';
import { unb64u, mimeOf } from '@umh/providers';
import { Registry } from './registry.js';
import { ProgressStore } from './progress.js';

interface ListQuery {
  provider: string;
  id: string;
  offset?: string;
  limit?: string;
  sort?: ListOpts['sort'];
}

interface RefQuery {
  ref: string;
}

interface ProgressBody {
  ref: string;
  position: number;
  duration: number;
}

interface RemoteBody {
  ref: string;
  action: string;
  value?: number;
}

export function registerRoutes(app: FastifyInstance, registry: Registry, progress: ProgressStore): void {
  const providerOf = (ref: string) => registry.get(splitRef(ref).instanceId);

  app.get('/api/health', async () => ({ ok: true, now: new Date().toISOString() }));

  app.get('/api/providers', async () => registry.statuses());

  app.put<{ Body: ProviderConfig }>('/api/providers', async (req, reply) => {
    const cfg = req.body;
    if (!cfg?.type || !cfg?.id) return reply.code(400).send({ error: 'type et id requis' });
    try {
      const status = await registry.upsert(cfg);
      return status;
    } catch (e) {
      return reply.code(400).send({ error: (e as Error).message });
    }
  });

  app.delete<{ Params: { id: string } }>('/api/providers/:id', async (req, reply) => {
    await registry.remove(req.params.id);
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>('/api/providers/:id/test', async (req, reply) => {
    const status = await registry.refreshHealth(req.params.id);
    if (!status) return reply.code(404).send({ error: 'Fournisseur inconnu' });
    return status;
  });

  app.get('/api/libraries', async () => {
    const out: unknown[] = [];
    for (const p of registry.all()) {
      try {
        out.push(...(await p.listLibraries()));
      } catch (e) {
        out.push({ id: '', provider: p.instanceId, name: `${p.label} (erreur: ${(e as Error).message})`, type: 'video' });
      }
    }
    return out;
  });

  app.get<{ Querystring: ListQuery }>('/api/library', async (req, reply) => {
    const { provider, id, offset, limit, sort } = req.query;
    if (!provider || !id) return reply.code(400).send({ error: 'provider et id requis' });
    try {
      const p = registry.get(provider);
      return await p.listItems(id, {
        offset: offset ? parseInt(offset, 10) : undefined,
        limit: limit ? parseInt(limit, 10) : undefined,
        sort,
      });
    } catch (e) {
      return reply.code(502).send({ error: (e as Error).message });
    }
  });

  app.get<{ Querystring: RefQuery }>('/api/item', async (req, reply) => {
    const { ref } = req.query;
    if (!ref) return reply.code(400).send({ error: 'ref requis' });
    try {
      const { instanceId, localId } = splitRef(ref);
      const item = await providerOf(ref).getItem(localId);
      if (!item) return reply.code(404).send({ error: 'Média introuvable' });
      void instanceId;
      return item;
    } catch (e) {
      return reply.code(502).send({ error: (e as Error).message });
    }
  });

  app.get<{ Querystring: RefQuery }>('/api/item/children', async (req, reply) => {
    const { ref } = req.query;
    if (!ref) return reply.code(400).send({ error: 'ref requis' });
    try {
      const { localId } = splitRef(ref);
      return await providerOf(ref).getChildren(localId);
    } catch (e) {
      return reply.code(502).send({ error: (e as Error).message });
    }
  });

  app.get<{ Querystring: { q?: string; limit?: string } }>('/api/search', async (req, reply) => {
    const q = (req.query.q ?? '').trim();
    if (!q) return { items: [] };
    const limit = req.query.limit ? parseInt(req.query.limit, 10) : 40;
    const results = await Promise.allSettled(registry.all().map((p) => p.search(q, limit)));
    const items: MediaItem[] = [];
    for (const r of results) if (r.status === 'fulfilled') items.push(...r.value);
    items.sort((a, b) => a.title.localeCompare(b.title, 'fr'));
    return { items: items.slice(0, limit * 2) };
  });

  app.get<{ Querystring: RefQuery }>('/api/stream', async (req, reply) => {
    const { ref } = req.query;
    if (!ref) return reply.code(400).send({ error: 'ref requis' });
    try {
      const { localId } = splitRef(ref);
      const info: StreamInfo = await providerOf(ref).getStreamInfo(localId);
      return { ref, ...info };
    } catch (e) {
      return reply.code(502).send({ error: (e as Error).message });
    }
  });

  app.get<{ Querystring: RefQuery }>('/api/play', async (req, reply) => {
    const { ref } = req.query;
    if (!ref) return reply.code(400).send({ error: 'ref requis' });
    try {
      const { localId } = splitRef(ref);
      const info = await providerOf(ref).getStreamInfo(localId);
      if (info.kind === 'remote') return reply.code(302).redirect(`#/remote?ref=${encodeURIComponent(ref)}`);
      if (!info.url) return reply.code(502).send({ error: 'Aucune URL de lecture' });
      return reply.code(302).redirect(info.url);
    } catch (e) {
      return reply.code(502).send({ error: (e as Error).message });
    }
  });

  app.post<{ Body: RemoteBody }>('/api/remote', async (req, reply) => {
    const { ref, action, value } = req.body ?? ({} as RemoteBody);
    if (!ref || !action) return reply.code(400).send({ error: 'ref et action requis' });
    try {
      const { localId } = splitRef(ref);
      const p = providerOf(ref);
      if (!p.control) return reply.code(400).send({ error: 'Ce fournisseur ne supporte pas la télécommande' });
      return { ok: true, result: await p.control(localId, action, value) };
    } catch (e) {
      return reply.code(502).send({ error: (e as Error).message });
    }
  });

  app.get<{ Querystring: RefQuery }>('/api/progress', async (req) => {
    const { ref } = req.query;
    return progress.get(ref ?? '') ?? null;
  });

  app.put<{ Body: ProgressBody }>('/api/progress', async (req, reply) => {
    const { ref, position, duration } = req.body ?? ({} as ProgressBody);
    if (!ref || typeof position !== 'number') return reply.code(400).send({ error: 'ref et position requis' });
    return progress.set(ref, position, duration ?? 0);
  });

  app.get('/api/continue', async () => {
    const entries: ProgressEntry[] = [];
    for (const e of progress.list(50)) {
      if (e.duration > 0 && e.position > 5 && e.position < e.duration - 10) {
        try {
          const { localId } = splitRef(e.ref);
          const item = await providerOf(e.ref).getItem(localId);
          if (item) {
            item.progress = e.duration > 0 ? e.position / e.duration : 0;
            entries.push({ ...e, item });
          }
        } catch {
          entries.push(e);
        }
      }
    }
    return { items: entries };
  });

  app.get<{ Params: { enc: string } }>('/api/fs/:enc', async (req, reply) => {
    const roots = registry.fsRoots().map((r) => path.resolve(r));
    let decoded: string;
    try {
      decoded = unb64u(req.params.enc);
    } catch {
      return reply.code(400).send({ error: 'Chemin invalide' });
    }
    const abs = path.resolve(decoded);
    const allowed = roots.some((r) => abs === r || abs.startsWith(r + path.sep));
    if (!allowed) return reply.code(403).send({ error: 'Accès refusé' });
    if (!existsSync(abs)) return reply.code(404).send({ error: 'Fichier introuvable' });
    let real: string;
    try {
      real = realpathSync(abs);
    } catch {
      return reply.code(404).send({ error: 'Fichier introuvable' });
    }
    const inRoot = roots.some((r) => real === r || real.startsWith(r + path.sep));
    if (!inRoot) return reply.code(403).send({ error: 'Accès refusé' });
    const st = statSync(real);
    if (!st.isFile()) return reply.code(400).send({ error: 'Pas un fichier' });
    reply.header('Content-Type', mimeOf(real));
    reply.header('Accept-Ranges', 'bytes');
    reply.header('Cache-Control', 'public, max-age=3600');
    const range = req.headers.range;
    if (range) {
      const m = range.match(/bytes=(\d*)-(\d*)/);
      if (m) {
        const size = st.size;
        let start = m[1] ? parseInt(m[1], 10) : 0;
        let end = m[2] ? parseInt(m[2], 10) : size - 1;
        if (m[1] === '' && m[2]) {
          start = Math.max(0, size - parseInt(m[2], 10));
          end = size - 1;
        }
        end = Math.min(end, size - 1);
        if (start > end || start >= size) {
          reply.header('Content-Range', `bytes */${size}`);
          return reply.code(416).send({ error: 'Range invalide' });
        }
        reply.code(206);
        reply.header('Content-Range', `bytes ${start}-${end}/${size}`);
        reply.header('Content-Length', end - start + 1);
        return reply.send(createReadStream(real, { start, end }));
      }
    }
    reply.header('Content-Length', st.size);
    return reply.send(createReadStream(real));
  });
}

export type { FastifyRequest, FastifyReply };
