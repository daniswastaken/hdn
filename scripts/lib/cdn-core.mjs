import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const REPO_ROOT = path.resolve(__dirname, '../..');
export const CDN_DIR = path.join(REPO_ROOT, 'cdn');
export const PUBLIC_DIR = path.join(REPO_ROOT, 'public');
export const THUMB_CACHE_DIR = path.join(REPO_ROOT, '.astro', 'thumb-cache');
export const SRC_DATA_DIR = path.join(REPO_ROOT, 'src', 'data');
export const SRC_MANIFEST_PATH = path.join(SRC_DATA_DIR, 'manifest.json');
export const GITATTRIBUTES_PATH = path.join(REPO_ROOT, '.gitattributes');
export const README_PATH = path.join(REPO_ROOT, 'README.md');

export const LFS_SIZE_THRESHOLD_BYTES = 10 * 1024 * 1024; // 10 MB

export const REPO_CONFIG = {
  owner: 'daniswastaken',
  name: 'hdn',
  defaultBranch: 'main',
  customDomain: 'https://cdn.handaru.dev',
  pagesBase: 'https://daniswastaken.github.io/hdn',
  jsDelivrBase: 'https://cdn.jsdelivr.net/gh/daniswastaken/hdn',
  rawBase: 'https://raw.githubusercontent.com/daniswastaken/hdn',
  mediaBase: 'https://media.githubusercontent.com/media/daniswastaken/hdn',
};

export const CANONICAL_DIRECTORIES = [
  'projects/grafika',
  'projects/prefect',
  'fonts',
  'icons',
  'svg',
  'images',
  'media',
  'lfs',
];

const IGNORE_NAMES = new Set(['.gitkeep', '.DS_Store', 'Thumbs.db', 'desktop.ini']);

const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.avif', '.gif', '.ico', '.bmp']);
const RASTER_THUMB_EXTS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.avif', '.gif', '.bmp']);
const FONT_EXTS = new Set(['.woff2', '.woff', '.ttf', '.otf', '.eot']);
const SVG_EXTS = new Set(['.svg']);

const MIME_MAP = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.bmp': 'image/bmp',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.eot': 'application/vnd.ms-fontobject',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.flac': 'audio/flac',
  '.json': 'application/json',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.pdf': 'application/pdf',
  '.zip': 'application/zip',
  '.7z': 'application/x-7z-compressed',
  '.gz': 'application/gzip',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.bin': 'application/octet-stream',
};

const LFS_TRACKED_EXTS = new Set([
  '.mp4', '.webm', '.mov', '.mkv', '.avi',
  '.wav', '.flac', '.mp3', '.ogg',
  '.zip', '.7z', '.rar', '.gz',
  '.psd', '.ai', '.blend', '.fbx', '.glb', '.gltf',
  '.hdr', '.exr', '.tif', '.tiff', '.tga',
  '.iso', '.dmg', '.exe', '.msi', '.apk', '.pdf', '.bin',
]);

export function toPosix(p) {
  return p.split(path.sep).join('/');
}

export function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const exp = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const val = bytes / 1024 ** exp;
  return `${val >= 10 || exp === 0 ? val.toFixed(exp === 0 ? 0 : 1) : val.toFixed(2)} ${units[exp]}`;
}

export function toKebabCaseFilename(filename) {
  const lower = filename.trim().toLowerCase();
  const multiExtMatch = lower.match(/^(.+?)(\.tar\.gz|\.d\.ts)$/);
  let stem;
  let ext;
  if (multiExtMatch) {
    stem = multiExtMatch[1];
    ext = multiExtMatch[2];
  } else {
    const parsed = path.parse(lower);
    stem = parsed.name;
    ext = parsed.ext;
  }

  const sanitizedStem = stem
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/['’`]/g, '-')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');

  const safeStem = sanitizedStem || 'asset';
  return `${safeStem}${ext}`;
}

export function sanitizeRelFolder(folder) {
  return toPosix(folder || '')
    .replace(/^\/+|\/+$/g, '')
    .replace(/^cdn\/+/, '')
    .split('/')
    .filter(Boolean)
    .map((seg) =>
      seg
        .toLowerCase()
        .replace(/[^a-z0-9._-]+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, ''),
    )
    .filter((seg) => seg && seg !== '.' && seg !== '..')
    .join('/');
}

export function parseImageDimensions(buffer, ext) {
  try {
    if (ext === '.png' && buffer.length >= 24) {
      if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) {
        return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
      }
    }

    if (ext === '.gif' && buffer.length >= 10) {
      const sig = buffer.toString('ascii', 0, 6);
      if (sig === 'GIF87a' || sig === 'GIF89a') {
        return { width: buffer.readUInt16LE(6), height: buffer.readUInt16LE(8) };
      }
    }

    if (ext === '.bmp' && buffer.length >= 26) {
      if (buffer[0] === 0x42 && buffer[1] === 0x4d) {
        return { width: buffer.readInt32LE(18), height: Math.abs(buffer.readInt32LE(22)) };
      }
    }

    if (ext === '.ico' && buffer.length >= 8) {
      if (buffer.readUInt16LE(0) === 0 && buffer.readUInt16LE(2) === 1) {
        const count = buffer.readUInt16LE(4);
        let maxW = 0;
        let maxH = 0;
        for (let i = 0; i < count && 6 + i * 16 + 2 < buffer.length; i++) {
          const w = buffer[6 + i * 16] || 256;
          const h = buffer[6 + i * 16 + 1] || 256;
          if (w * h > maxW * maxH) {
            maxW = w;
            maxH = h;
          }
        }
        if (maxW && maxH) return { width: maxW, height: maxH };
      }
    }

    if ((ext === '.jpg' || ext === '.jpeg') && buffer.length >= 4) {
      if (buffer[0] === 0xff && buffer[1] === 0xd8) {
        let offset = 2;
        while (offset + 4 < buffer.length) {
          if (buffer[offset] !== 0xff) break;
          const marker = buffer[offset + 1];
          if (marker === 0xd9 || marker === 0xda) break;
          if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
            offset += 2;
            continue;
          }
          const length = buffer.readUInt16BE(offset + 2);
          if (
            (marker >= 0xc0 && marker <= 0xc3) ||
            (marker >= 0xc5 && marker <= 0xc7) ||
            (marker >= 0xc9 && marker <= 0xcb) ||
            (marker >= 0xcd && marker <= 0xcf)
          ) {
            if (offset + 8 < buffer.length) {
              return {
                height: buffer.readUInt16BE(offset + 5),
                width: buffer.readUInt16BE(offset + 7),
              };
            }
          }
          offset += 2 + length;
        }
      }
    }

    if (ext === '.webp' && buffer.length >= 30) {
      if (buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') {
        const chunk = buffer.toString('ascii', 12, 16);
        if (chunk === 'VP8X') {
          const width = 1 + buffer.readUIntLE(24, 3);
          const height = 1 + buffer.readUIntLE(27, 3);
          return { width, height };
        }
        if (chunk === 'VP8 ' && buffer.length >= 30) {
          const width = buffer.readUInt16LE(26) & 0x3fff;
          const height = buffer.readUInt16LE(28) & 0x3fff;
          return { width, height };
        }
        if (chunk === 'VP8L' && buffer.length >= 25) {
          const bits = buffer.readUInt32LE(21);
          const width = (bits & 0x3fff) + 1;
          const height = ((bits >> 14) & 0x3fff) + 1;
          return { width, height };
        }
      }
    }
  } catch {
    return null;
  }
  return null;
}

export function parseSvgMetadata(content) {
  const viewBoxMatch = content.match(/viewBox=["']([^"']+)["']/i);
  const widthMatch = content.match(/<svg[^>]*\swidth=["']([0-9.]+)(?:px)?["']/i);
  const heightMatch = content.match(/<svg[^>]*\sheight=["']([0-9.]+)(?:px)?["']/i);

  let width = widthMatch ? Number(widthMatch[1]) : null;
  let height = heightMatch ? Number(heightMatch[1]) : null;
  const viewBox = viewBoxMatch ? viewBoxMatch[1].trim() : null;

  if (viewBox && (width === null || height === null)) {
    const parts = viewBox.split(/[\s,]+/).map(Number);
    if (parts.length === 4 && parts.every((n) => !Number.isNaN(n))) {
      if (width === null) width = parts[2];
      if (height === null) height = parts[3];
    }
  }

  return {
    viewBox,
    width,
    height,
    usesCurrentColor: /currentColor/i.test(content),
  };
}

export function parseFontMetadata(filename, ext) {
  const stem = path.basename(filename, ext);
  const isItalic = /italic/i.test(stem);

  const weightNameMap = [
    ['thin', 100],
    ['hairline', 100],
    ['extralight', 200],
    ['ultralight', 200],
    ['light', 300],
    ['regular', 400],
    ['normal', 400],
    ['medium', 500],
    ['semibold', 600],
    ['demibold', 600],
    ['extrabold', 800],
    ['ultrabold', 800],
    ['bold', 700],
    ['black', 900],
    ['heavy', 900],
  ];

  let weight = 400;
  const numMatch = stem.match(/(?:^|[-_])(100|200|300|400|500|600|700|800|900)(?:$|[-_])/);
  if (numMatch) {
    weight = Number(numMatch[1]);
  } else {
    const lower = stem.toLowerCase();
    for (const [token, val] of weightNameMap) {
      if (lower.includes(token)) {
        weight = val;
        break;
      }
    }
  }

  const rawFamily = stem
    .replace(/[-_](100|200|300|400|500|600|700|800|900|italic|regular|normal|bold|semibold|extrabold|medium|light|extralight|thin|black|heavy|latin|variable)/gi, '')
    .replace(/[-_]+/g, ' ')
    .trim();

  const titleWords = (rawFamily || stem)
    .split(/\s+/)
    .map((word) => {
      if (word.toLowerCase() === 'jetbrains') return 'JetBrains';
      return word.charAt(0).toUpperCase() + word.slice(1);
    });

  const family = titleWords.join(' ');
  const formatMap = {
    '.woff2': 'woff2',
    '.woff': 'woff',
    '.ttf': 'truetype',
    '.otf': 'opentype',
    '.eot': 'embedded-opentype',
  };

  return {
    family,
    weight,
    style: isItalic ? 'italic' : 'normal',
    format: formatMap[ext] || 'woff2',
  };
}

export function classifyAsset(relFromCdn, ext) {
  const parts = relFromCdn.split('/');
  const topDir = parts[0] || '';

  if (topDir === 'icons' || parts.includes('icons')) {
    if (SVG_EXTS.has(ext) || IMAGE_EXTS.has(ext)) return 'icon';
  }
  if (SVG_EXTS.has(ext)) return 'svg';
  if (FONT_EXTS.has(ext)) return 'font';
  if (IMAGE_EXTS.has(ext)) return 'image';
  return 'media';
}

export function runGit(args) {
  try {
    return execFileSync('git', args, {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return '';
  }
}

export function getGitInfo() {
  const branch = runGit(['rev-parse', '--abbrev-ref', 'HEAD']) || REPO_CONFIG.defaultBranch;
  const commit = runGit(['rev-parse', 'HEAD']) || REPO_CONFIG.defaultBranch;
  const shortCommit = runGit(['rev-parse', '--short', 'HEAD']) || 'local';
  const lfsAvailable = Boolean(runGit(['lfs', 'version']));

  return {
    branch: branch === 'HEAD' ? REPO_CONFIG.defaultBranch : branch,
    commit,
    shortCommit,
    lfsAvailable,
  };
}

export function getLfsTrackedSet(gitPaths) {
  const tracked = new Set();
  if (!gitPaths.length) return tracked;

  const lsFilesOut = runGit(['lfs', 'ls-files', '--name-only']);
  if (lsFilesOut) {
    for (const line of lsFilesOut.split(/\r?\n/)) {
      const clean = line.trim();
      if (clean) tracked.add(clean);
    }
  }

  try {
    const out = execFileSync('git', ['check-attr', 'filter', '--', ...gitPaths], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    for (const line of out.split(/\r?\n/)) {
      const m = line.match(/^(.+?):\s+filter:\s+(\S+)/);
      if (m && m[2] === 'lfs') {
        tracked.add(m[1].trim());
      }
    }
  } catch {
    // Fallback handled by size/extension rules below
  }

  return tracked;
}

export function walkCdnFiles(dir = CDN_DIR, out = []) {
  if (!fs.existsSync(dir)) return out;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (IGNORE_NAMES.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkCdnFiles(full, out);
    } else if (entry.isFile()) {
      out.push(full);
    }
  }
  return out;
}

export function walkCdnDirectories(dir = CDN_DIR, out = []) {
  if (!fs.existsSync(dir)) return out;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const full = path.join(dir, entry.name);
    const rel = toPosix(path.relative(CDN_DIR, full));
    out.push(rel);
    walkCdnDirectories(full, out);
  }
  return out;
}

export function normalizeCdnFilenames() {
  const renamed = [];
  const files = walkCdnFiles();
  for (const absPath of files) {
    const dir = path.dirname(absPath);
    const base = path.basename(absPath);
    const normalized = toKebabCaseFilename(base);
    if (base === normalized) continue;

    const targetPath = path.join(dir, normalized);
    if (fs.existsSync(targetPath) && targetPath.toLowerCase() !== absPath.toLowerCase()) {
      continue;
    }

    const relOld = toPosix(path.relative(REPO_ROOT, absPath));
    const relNew = toPosix(path.relative(REPO_ROOT, targetPath));
    const tracked = Boolean(runGit(['ls-files', '--error-unmatch', relOld]));
    if (tracked) {
      if (targetPath.toLowerCase() === absPath.toLowerCase()) {
        const tmpPath = path.join(dir, `__tmp_${Date.now()}_${normalized}`);
        runGit(['mv', '-f', relOld, toPosix(path.relative(REPO_ROOT, tmpPath))]);
        runGit(['mv', '-f', toPosix(path.relative(REPO_ROOT, tmpPath)), relNew]);
      } else {
        runGit(['mv', '-f', relOld, relNew]);
      }
    } else {
      fs.renameSync(absPath, targetPath);
    }
    renamed.push({ from: relOld, to: relNew });
  }
  return renamed;
}

export function updateGitAttributesAutoLfs(entries) {
  if (!fs.existsSync(GITATTRIBUTES_PATH)) return { updated: false, trackedPaths: [] };

  const startMarker = '# --- HDN AUTO-LFS LARGE FILES (>=10MB) ---';
  const endMarker = '# --- HDN AUTO-LFS END ---';

  const largeFiles = entries
    .filter((item) => item.bytes >= LFS_SIZE_THRESHOLD_BYTES)
    .filter((item) => !item.relFromCdn.startsWith('lfs/') && !LFS_TRACKED_EXTS.has(item.ext))
    .map((item) => item.gitPath)
    .sort();

  const current = fs.readFileSync(GITATTRIBUTES_PATH, 'utf8');
  const startIdx = current.indexOf(startMarker);
  const endIdx = current.indexOf(endMarker);

  const bodyLines = largeFiles.length
    ? largeFiles.map((p) => `${p} filter=lfs diff=lfs merge=lfs -text`)
    : ['# Managed automatically by `pnpm hdn sync` / `pnpm hdn add` (none >= 10 MB)'];

  const replacement = `${startMarker}\n${bodyLines.join('\n')}\n${endMarker}`;

  let next;
  if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
    next = current.slice(0, startIdx) + replacement + current.slice(endIdx + endMarker.length);
  } else {
    next = `${current.trimEnd()}\n\n${replacement}\n`;
  }

  if (next !== current) {
    fs.writeFileSync(GITATTRIBUTES_PATH, next, 'utf8');
    return { updated: true, trackedPaths: largeFiles };
  }
  return { updated: false, trackedPaths: largeFiles };
}

export function buildManifestData() {
  const files = walkCdnFiles().sort((a, b) => a.localeCompare(b));
  const gitPaths = files.map((abs) => toPosix(path.relative(REPO_ROOT, abs)));
  const gitInfo = getGitInfo();
  const lfsSet = getLfsTrackedSet(gitPaths);

  const assets = [];
  const byCategory = { image: 0, font: 0, icon: 0, svg: 0, media: 0 };
  const directoryStats = new Map();
  const projectsSet = new Set();

  for (const dirName of CANONICAL_DIRECTORIES) {
    directoryStats.set(dirName, { path: dirName, count: 0, bytes: 0 });
  }
  for (const discoveredDir of walkCdnDirectories()) {
    if (!directoryStats.has(discoveredDir)) {
      directoryStats.set(discoveredDir, { path: discoveredDir, count: 0, bytes: 0 });
    }
  }

  let totalBytes = 0;
  let totalLfsAssets = 0;

  for (const absPath of files) {
    const relFromCdn = toPosix(path.relative(CDN_DIR, absPath));
    const gitPath = `cdn/${relFromCdn}`;
    const ext = path.extname(absPath).toLowerCase();
    const filename = path.basename(absPath);
    const stat = fs.statSync(absPath);
    const buffer = fs.readFileSync(absPath);

    const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');
    const integrity = `sha256-${crypto.createHash('sha256').update(buffer).digest('base64')}`;

    const category = classifyAsset(relFromCdn, ext);
    byCategory[category] = (byCategory[category] || 0) + 1;

    const directory = toPosix(path.dirname(relFromCdn)) === '.' ? '' : toPosix(path.dirname(relFromCdn));
    if (directory) {
      const curr = directoryStats.get(directory) || { path: directory, count: 0, bytes: 0 };
      curr.count += 1;
      curr.bytes += stat.size;
      directoryStats.set(directory, curr);
    }

    const project = relFromCdn.startsWith('projects/') ? relFromCdn.split('/')[1] || null : null;
    if (project) projectsSet.add(project);

    const isLfs =
      lfsSet.has(gitPath) ||
      relFromCdn.startsWith('lfs/') ||
      LFS_TRACKED_EXTS.has(ext) ||
      stat.size >= LFS_SIZE_THRESHOLD_BYTES;

    if (isLfs) totalLfsAssets += 1;
    totalBytes += stat.size;

    const legacyPath = relFromCdn.startsWith('projects/')
      ? `/${relFromCdn.slice('projects/'.length)}`
      : null;

    let dimensions = null;
    let viewBox = null;
    let inlineSvg = null;
    let usesCurrentColor = false;
    let font = null;

    if (SVG_EXTS.has(ext)) {
      const svgText = buffer.toString('utf8');
      const svgMeta = parseSvgMetadata(svgText);
      viewBox = svgMeta.viewBox;
      usesCurrentColor = svgMeta.usesCurrentColor;
      if (svgMeta.width && svgMeta.height) {
        dimensions = { width: svgMeta.width, height: svgMeta.height };
      }
      if (buffer.length <= 32 * 1024) {
        inlineSvg = svgText.trim();
      }
    } else if (IMAGE_EXTS.has(ext)) {
      dimensions = parseImageDimensions(buffer, ext);
    } else if (FONT_EXTS.has(ext)) {
      font = parseFontMetadata(filename, ext);
    }

    const aspectRatio =
      dimensions && dimensions.width && dimensions.height
        ? Number((dimensions.width / dimensions.height).toFixed(3))
        : null;

    assets.push({
      id: relFromCdn,
      name: filename,
      stem: path.basename(filename, ext),
      ext,
      category,
      directory,
      project,
      cdnPath: `/${relFromCdn}`,
      legacyPath,
      thumbPath: category === 'image' && RASTER_THUMB_EXTS.has(ext) ? `/_thumbs/${relFromCdn}.webp` : null,
      gitPath,
      bytes: stat.size,
      sizeFormatted: formatBytes(stat.size),
      mime: MIME_MAP[ext] || 'application/octet-stream',
      sha256,
      shortHash: sha256.slice(0, 12),
      integrity,
      lfs: isLfs,
      dimensions,
      aspectRatio,
      viewBox,
      usesCurrentColor,
      inlineSvg,
      font,
      updatedAt: stat.mtime.toISOString(),
    });
  }

  const directories = Array.from(directoryStats.values())
    .filter((d) => d.path !== 'projects')
    .sort((a, b) => a.path.localeCompare(b.path))
    .map((d) => ({
      ...d,
      sizeFormatted: formatBytes(d.bytes),
    }));

  return {
    version: '2.0.0',
    generatedAt: new Date().toISOString(),
    repo: {
      ...REPO_CONFIG,
      ...gitInfo,
    },
    stats: {
      totalAssets: assets.length,
      totalBytes,
      totalSizeFormatted: formatBytes(totalBytes),
      totalLfsAssets,
      byCategory,
      directories,
      projects: Array.from(projectsSet).sort(),
    },
    assets,
  };
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function copyFileSafe(src, dest) {
  ensureDir(path.dirname(dest));
  fs.copyFileSync(src, dest);
}

export function updateReadmeStats(manifest) {
  if (!fs.existsSync(README_PATH)) return false;
  const startMarker = '<!-- HDN:STATS:START -->';
  const endMarker = '<!-- HDN:STATS:END -->';
  const current = fs.readFileSync(README_PATH, 'utf8');
  const startIdx = current.indexOf(startMarker);
  const endIdx = current.indexOf(endMarker);
  if (startIdx === -1 || endIdx === -1 || endIdx <= startIdx) return false;

  const { stats, repo } = manifest;
  const rows = stats.directories
    .map(
      (d) =>
        `| \`cdn/${d.path}/\` | ${d.count} | ${d.sizeFormatted} | \`https://cdn.handaru.dev/${d.path}/...\` |`,
    )
    .join('\n');

  const block = [
    startMarker,
    '',
    `> **Live Inventory**: **${stats.totalAssets} assets** · **${stats.totalSizeFormatted}** total payload · **${stats.totalLfsAssets}** Git LFS objects · Branch \`${repo.branch}\` (\`${repo.shortCommit}\`)`,
    '',
    '| Vault Directory | Assets | Payload | Canonical Edge Route |',
    '| --- | ---: | ---: | --- |',
    rows,
    '',
    endMarker,
  ].join('\n');

  const next = current.slice(0, startIdx) + block + current.slice(endIdx + endMarker.length);
  if (next !== current) {
    fs.writeFileSync(README_PATH, next, 'utf8');
    return true;
  }
  return false;
}

async function ensureThumbnail(srcAbs, destAbs, sha256) {
  ensureDir(THUMB_CACHE_DIR);
  ensureDir(path.dirname(destAbs));
  const cachePath = path.join(THUMB_CACHE_DIR, `${sha256}.webp`);
  if (!fs.existsSync(cachePath)) {
    try {
      await sharp(srcAbs)
        .rotate()
        .resize({ width: 360, height: 220, fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 68, effort: 4 })
        .toFile(cachePath);
    } catch {
      fs.copyFileSync(srcAbs, destAbs);
      return;
    }
  }
  fs.copyFileSync(cachePath, destAbs);
}

export async function syncCdn({
  syncPublic = true,
  normalize = false,
  autoLfs = false,
  updateReadme = false,
} = {}) {
  const renamed = normalize ? normalizeCdnFilenames() : [];
  let manifest = buildManifestData();

  const lfsUpdate = autoLfs ? updateGitAttributesAutoLfs(manifest.assets) : { updated: false, trackedPaths: [] };
  if (lfsUpdate.updated) {
    manifest = buildManifestData();
  }

  ensureDir(SRC_DATA_DIR);
  fs.writeFileSync(SRC_MANIFEST_PATH, JSON.stringify(manifest, null, 2) + '\n', 'utf8');

  if (syncPublic) {
    fs.rmSync(PUBLIC_DIR, { recursive: true, force: true });
    ensureDir(PUBLIC_DIR);

    fs.writeFileSync(path.join(PUBLIC_DIR, '.nojekyll'), '', 'utf8');
    fs.writeFileSync(
      path.join(PUBLIC_DIR, '_headers'),
      [
        '/*',
        '  Access-Control-Allow-Origin: *',
        '  Access-Control-Allow-Methods: GET, HEAD, OPTIONS',
        '  X-Content-Type-Options: nosniff',
        '',
        '/fonts/*',
        '  Cache-Control: public, max-age=31536000, immutable',
        '',
        '/_thumbs/*',
        '  Cache-Control: public, max-age=31536000, immutable',
        '',
        '/projects/*',
        '  Cache-Control: public, max-age=604800, stale-while-revalidate=86400',
        '',
        '/icons/*',
        '  Cache-Control: public, max-age=604800, stale-while-revalidate=86400',
        '',
        '/svg/*',
        '  Cache-Control: public, max-age=604800, stale-while-revalidate=86400',
        '',
      ].join('\n'),
      'utf8',
    );

    const markSrc = path.join(CDN_DIR, 'svg', 'handaru-grid-mark.svg');
    if (fs.existsSync(markSrc)) {
      copyFileSafe(markSrc, path.join(PUBLIC_DIR, 'favicon.svg'));
    }

    const thumbTasks = [];
    for (const asset of manifest.assets) {
      const srcAbs = path.join(CDN_DIR, asset.id);
      copyFileSafe(srcAbs, path.join(PUBLIC_DIR, asset.id));
      copyFileSafe(srcAbs, path.join(PUBLIC_DIR, 'cdn', asset.id));
      if (asset.legacyPath) {
        copyFileSafe(srcAbs, path.join(PUBLIC_DIR, asset.legacyPath.slice(1)));
      }
      if (asset.thumbPath) {
        const destThumb = path.join(PUBLIC_DIR, asset.thumbPath.slice(1));
        thumbTasks.push(() => ensureThumbnail(srcAbs, destThumb, asset.sha256));
      }
    }

    const CONCURRENCY = 6;
    for (let i = 0; i < thumbTasks.length; i += CONCURRENCY) {
      await Promise.all(thumbTasks.slice(i, i + CONCURRENCY).map((run) => run()));
    }

    ensureDir(path.join(PUBLIC_DIR, 'api'));
    fs.writeFileSync(
      path.join(PUBLIC_DIR, 'api', 'manifest.json'),
      JSON.stringify(manifest, null, 2) + '\n',
      'utf8',
    );
    fs.writeFileSync(
      path.join(PUBLIC_DIR, 'api', 'stats.json'),
      JSON.stringify(
        {
          version: manifest.version,
          generatedAt: manifest.generatedAt,
          repo: manifest.repo,
          stats: manifest.stats,
        },
        null,
        2,
      ) + '\n',
      'utf8',
    );
  }

  const readmeUpdated = updateReadme ? updateReadmeStats(manifest) : false;

  return {
    manifest,
    renamed,
    lfsUpdate,
    readmeUpdated,
  };
}
