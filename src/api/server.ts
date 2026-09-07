import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import type { NextFunction, Request, Response } from 'express';
import { config } from '../config/index.js';
import { buildRouter } from './routes.js';

const here = dirname(fileURLToPath(import.meta.url));
const panelDist = join(here, '..', '..', 'panel', 'dist', 'panel', 'browser');

const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 240;
const hits = new Map<string, { count: number; resetAt: number }>();

function rateLimit(req: Request, res: Response, next: NextFunction): void {
  const key = req.ip ?? 'unknown';
  const now = Date.now();
  const entry = hits.get(key);

  if (!entry || entry.resetAt < now) {
    hits.set(key, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    next();
    return;
  }

  entry.count += 1;
  if (entry.count > RATE_LIMIT_MAX) {
    res.status(429).json({ error: 'demasiadas peticiones' });
    return;
  }

  next();
}

export function createApp(): express.Express {
  const app = express();

  app.disable('x-powered-by');
  app.use(express.json({ limit: '64kb' }));
  app.use('/api', rateLimit, buildRouter());

  if (existsSync(panelDist)) {
    app.use(express.static(panelDist));
    app.get(/^\/(?!api).*/, (_req, res) => {
      res.sendFile(join(panelDist, 'index.html'));
    });
  } else {
    app.get('/', (_req, res) => {
      res
        .status(200)
        .type('text/plain')
        .send(
          'panel sin compilar. ejecuta: cd panel && npm install && npm run build\n' +
            'la API esta disponible en /api/health\n',
        );
    });
  }

  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const message = error instanceof Error ? error.message : 'error desconocido';
    console.error('[api]', message);
    res.status(500).json({ error: message });
  });

  return app;
}

const app = createApp();

app.listen(config.API_PORT, config.API_HOST, () => {
  console.log(`api escuchando en http://${config.API_HOST}:${config.API_PORT}`);
  console.log(`  salud:      http://${config.API_HOST}:${config.API_PORT}/api/health`);
  console.log(`  scoreboard: http://${config.API_HOST}:${config.API_PORT}/api/scoreboard`);
});
