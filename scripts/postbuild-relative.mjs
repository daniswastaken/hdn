import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from './lib/cdn-core.mjs';

const DIST_DIR = path.join(REPO_ROOT, 'dist');
const INDEX_HTML = path.join(DIST_DIR, 'index.html');
const ASTRO_DIR = path.join(DIST_DIR, '_astro');

if (fs.existsSync(INDEX_HTML)) {
  let html = fs.readFileSync(INDEX_HTML, 'utf8');
  html = html
    .replace(/(href|src)="\/_astro\//g, '$1="./_astro/')
    .replace(/(href|src)="\/favicon\.svg"/g, '$1="./favicon.svg"')
    .replace(/(href|src)="\/api\//g, '$1="./api/');
  fs.writeFileSync(INDEX_HTML, html, 'utf8');
}

if (fs.existsSync(ASTRO_DIR)) {
  for (const name of fs.readdirSync(ASTRO_DIR)) {
    const filePath = path.join(ASTRO_DIR, name);
    if (name.endsWith('.css')) {
      const css = fs.readFileSync(filePath, 'utf8');
      const next = css.replace(/url\(\/_astro\//g, 'url(./');
      if (next !== css) fs.writeFileSync(filePath, next, 'utf8');
    } else if (name.endsWith('.js')) {
      const js = fs.readFileSync(filePath, 'utf8');
      const next = js.replace(/(['"])\/_astro\//g, '$1./');
      if (next !== js) fs.writeFileSync(filePath, next, 'utf8');
    }
  }
}

console.log('[HDN] Rewrote root-absolute _astro/ paths in dist/index.html & dist/_astro/* to portable relative paths.');
