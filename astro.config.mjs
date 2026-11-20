import fs from 'node:fs';
import path from 'node:path';
import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';
import {
  CDN_DIR,
  REPO_ROOT,
  sanitizeRelFolder,
  syncCdn,
  toKebabCaseFilename,
  toPosix,
} from './scripts/lib/cdn-core.mjs';

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on('data', (chunk) => {
      total += chunk.length;
      if (total > 80 * 1024 * 1024) {
        reject(new Error('Payload exceeds 80MB local studio limit.'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf8');
        resolve(raw ? JSON.parse(raw) : {});
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

function sendJson(res, status, data) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(data));
}

function hdnLocalStudioPlugin() {
  return {
    name: 'hdn-local-studio-api',
    configureServer(server) {
      server.middlewares.use('/__hdn_api', async (req, res) => {
        try {
          const reqPath = (req.url || '/').split('?')[0];

          if (req.method === 'GET' && reqPath === '/status') {
            return sendJson(res, 200, { localWriteEnabled: true, repoRoot: REPO_ROOT });
          }

          if (req.method === 'POST' && reqPath === '/upload') {
            const body = await readJsonBody(req);
            const rawFolder = typeof body.folder === 'string' ? body.folder : 'images';
            const folder = sanitizeRelFolder(rawFolder) || 'images';
            const files = Array.isArray(body.files) ? body.files : [];
            if (files.length === 0) {
              return sendJson(res, 400, { error: 'No files provided.' });
            }

            const added = [];
            for (const f of files) {
              if (!f || typeof f.name !== 'string' || typeof f.base64 !== 'string') continue;
              const safeName = toKebabCaseFilename(path.basename(f.name));
              const targetDir = path.resolve(CDN_DIR, folder);
              if (targetDir !== CDN_DIR && !targetDir.startsWith(CDN_DIR + path.sep)) {
                return sendJson(res, 400, { error: 'Invalid target folder path.' });
              }
              fs.mkdirSync(targetDir, { recursive: true });
              const targetPath = path.join(targetDir, safeName);
              const buffer = Buffer.from(f.base64, 'base64');
              fs.writeFileSync(targetPath, buffer);
              added.push(toPosix(path.relative(CDN_DIR, targetPath)));
            }

            const syncResult = await syncCdn({ syncPublic: true, autoLfs: true, updateReadme: true });
            return sendJson(res, 200, {
              ok: true,
              added,
              manifest: syncResult.manifest,
            });
          }

          if (req.method === 'POST' && reqPath === '/delete') {
            const body = await readJsonBody(req);
            const id = typeof body.id === 'string' ? toPosix(body.id).replace(/^\/+/, '') : '';
            if (!id) {
              return sendJson(res, 400, { error: 'Missing asset id.' });
            }
            const targetPath = path.resolve(CDN_DIR, id);
            if (!targetPath.startsWith(CDN_DIR + path.sep)) {
              return sendJson(res, 400, { error: 'Invalid asset path.' });
            }
            if (!fs.existsSync(targetPath) || !fs.statSync(targetPath).isFile()) {
              return sendJson(res, 404, { error: 'Asset not found on disk.' });
            }

            fs.unlinkSync(targetPath);
            const syncResult = await syncCdn({ syncPublic: true, autoLfs: true, updateReadme: true });
            return sendJson(res, 200, {
              ok: true,
              removed: id,
              manifest: syncResult.manifest,
            });
          }

          return sendJson(res, 404, { error: 'Unknown HDN local API route.' });
        } catch (err) {
          return sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) });
        }
      });
    },
  };
}

export default defineConfig({
  site: 'https://cdn.handaru.dev',
  output: 'static',
  build: {
    assets: '_astro',
  },
  vite: {
    plugins: [tailwindcss(), hdnLocalStudioPlugin()],
  },
});
