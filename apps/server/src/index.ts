import path from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import { Vault } from './vault.js';
import { Registry } from './registry.js';
import { ProgressStore } from './progress.js';
import { registerRoutes } from './routes.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = process.env.UMH_DATA_DIR ?? path.join(__dirname, '..', 'data');
const port = parseInt(process.env.PORT ?? '4000', 10);

const vault = new Vault(dataDir);
const registry = new Registry(vault);
await registry.load();
const progress = new ProgressStore(dataDir);

const app = Fastify({ logger: true, maxParamLength: 5000 });
await app.register(cors, { origin: true });
registerRoutes(app, registry, progress);

const webDist = path.resolve(__dirname, '..', '..', 'web', 'dist');
if (existsSync(webDist)) {
  const { default: fastifyStatic } = await import('@fastify/static');
  await app.register(fastifyStatic, { root: webDist, prefix: '/', decorateReply: true });
  app.setNotFoundHandler((req, reply) => {
    if (req.raw.url?.startsWith('/api/')) {
      return reply.code(404).send({ error: 'Route API inconnue' });
    }
    return reply.sendFile('index.html');
  });
}

app.listen({ port, host: '0.0.0.0' }, (err) => {
  if (err) {
    app.log.error(err);
    process.exit(1);
  }
  app.log.info(`MediaHub API sur http://0.0.0.0:${port}`);
});
