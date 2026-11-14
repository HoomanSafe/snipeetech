import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  handleImg,
  handlePapi,
  handlePons,
  handlePsearch,
  handleRelay,
} from './src/server/proxy.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 3000);
const isProd = process.env.NODE_ENV === 'production';

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '1mb' }));

  app.get('/api/pons', async (_req, res) => {
    await handlePons(res);
  });

  app.get('/papi/:addr', async (req, res) => {
    const idx = req.originalUrl.indexOf('?');
    const rawQuery = idx >= 0 ? req.originalUrl.slice(idx + 1) : '';
    await handlePapi(req.params.addr, rawQuery, res);
  });

  app.get('/psearch', async (req, res) => {
    const q = String(req.query.q || '');
    const limit = String(req.query.limit || '8');
    await handlePsearch(q, limit, res);
  });

  app.all('/api/relay', async (req, res) => {
    const ep = String(req.query.ep || '');
    const requestId = String(req.query.requestId || '');
    await handleRelay(ep, requestId, req.method, req.body, res);
  });

  app.get('/api/img', async (req, res) => {
    await handleImg(String(req.query.src || ''), res);
  });

  if (!isProd) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`SNIPETECH server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer();
