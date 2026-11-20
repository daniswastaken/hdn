#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  CDN_DIR,
  LFS_SIZE_THRESHOLD_BYTES,
  REPO_CONFIG,
  REPO_ROOT,
  buildManifestData,
  formatBytes,
  sanitizeRelFolder,
  syncCdn,
  toKebabCaseFilename,
  toPosix,
} from './lib/cdn-core.mjs';

const HELP_TEXT = `
HDN CLI — Handaru Delivery Network Manager

Usage:
  pnpm hdn <command> [options]

Commands:
  add <files...>     Upload/import files into cdn/ (auto kebab-case, auto LFS >= 10MB)
                     Options:
                       --to <folder>       Target folder under cdn/ (default: auto-detect by ext)
                       --project <name>    Shortcut for --to projects/<name>
                       --lfs               Place into cdn/lfs/ and track via Git LFS
                       --force             Overwrite if destination exists
                       --commit [msg]      Stage & git commit changes
                       --push              Also git push after commit

  remove <targets>   Remove assets by vault path, cdn path, or filename (alias: rm, delete)
                     Options:
                       --commit [msg]      Stage & git commit removal
                       --push              Also git push after commit

  move <src> <dest>  Move/rename an asset inside cdn/ (alias: mv)
  list               List indexed assets (alias: ls)
                     Options:
                       --type <cat>        Filter: image | font | icon | svg | media
                       --project <name>    Filter by project name (e.g. grafika, prefect)
                       --search <query>    Search substring in path or filename
                       --json              Output JSON

  sync               Normalize filenames (with --normalize), update LFS rules, rebuild manifest & README
                     Options:
                       --normalize         Rename files to lowercase kebab-case
                       --auto-lfs          Update .gitattributes for files >= 10MB
                       --readme            Update README.md inventory table

  lfs [subcommand]   Inspect or fix Git LFS setup (status | track-large)
  doctor [--strict]  Validate Git LFS hooks, filenames, SVGs, hashes & duplicates
  help               Show this help text
`;

function parseArgs(argv) {
  const positionals = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token.startsWith('--')) {
      const key = token.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith('--')) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = true;
      }
    } else {
      positionals.push(token);
    }
  }
  return { positionals, flags };
}

function guessFolderForExt(ext, isLfs = false) {
  if (isLfs) return 'lfs';
  const e = ext.toLowerCase();
  if (['.woff2', '.woff', '.ttf', '.otf', '.eot'].includes(e)) return 'fonts';
  if (e === '.svg') return 'svg';
  if (['.png', '.jpg', '.jpeg', '.webp', '.avif', '.gif', '.ico', '.bmp'].includes(e)) return 'images';
  return 'media';
}

function runGitChecked(args) {
  execFileSync('git', args, { cwd: REPO_ROOT, stdio: 'inherit' });
}

function maybeCommitAndPush(flags, defaultMsg) {
  if (!flags.commit && !flags.push) return;
  const msg = typeof flags.commit === 'string' ? flags.commit : defaultMsg;
  runGitChecked(['add', 'cdn', '.gitattributes', 'src/data/manifest.json', 'README.md']);
  try {
    runGitChecked(['commit', '-m', msg]);
  } catch {
    console.log('[HDN] Nothing new to commit.');
    return;
  }
  if (flags.push) {
    runGitChecked(['push']);
  }
}

function resolveAssetMatches(manifest, target) {
  const clean = toPosix(target).replace(/^\/+/, '').replace(/^cdn\//, '');
  const exact = manifest.assets.filter(
    (a) =>
      a.id === clean ||
      a.gitPath === toPosix(target) ||
      a.cdnPath === `/${clean}` ||
      a.legacyPath === `/${clean}`,
  );
  if (exact.length > 0) return exact;
  return manifest.assets.filter((a) => a.name === clean || a.id.endsWith(`/${clean}`));
}

async function cmdAdd(args, flags) {
  if (args.length === 0) {
    console.error('Error: specify one or more file paths to add.');
    process.exit(1);
  }

  let explicitFolder = null;
  if (flags.lfs) explicitFolder = 'lfs';
  else if (typeof flags.project === 'string') explicitFolder = `projects/${sanitizeRelFolder(flags.project)}`;
  else if (typeof flags.to === 'string') explicitFolder = sanitizeRelFolder(flags.to);

  const added = [];
  for (const inputPath of args) {
    const absSrc = path.resolve(process.cwd(), inputPath);
    if (!fs.existsSync(absSrc)) {
      console.error(`Error: file not found -> ${inputPath}`);
      process.exit(1);
    }
    const stat = fs.statSync(absSrc);
    if (!stat.isFile()) {
      console.error(`Error: expected file, got directory -> ${inputPath}`);
      process.exit(1);
    }

    const ext = path.extname(absSrc).toLowerCase();
    const safeName = toKebabCaseFilename(path.basename(absSrc));
    const folder = explicitFolder || guessFolderForExt(ext, stat.size >= LFS_SIZE_THRESHOLD_BYTES);
    const destDir = path.join(CDN_DIR, folder);
    const destPath = path.join(destDir, safeName);

    if (fs.existsSync(destPath) && !flags.force) {
      console.error(`Error: destination already exists (${toPosix(path.relative(REPO_ROOT, destPath))}). Pass --force to overwrite.`);
      process.exit(1);
    }

    fs.mkdirSync(destDir, { recursive: true });
    fs.copyFileSync(absSrc, destPath);
    const relFromCdn = toPosix(path.relative(CDN_DIR, destPath));
    added.push({ relFromCdn, bytes: stat.size });
    console.log(`[ADD] cdn/${relFromCdn} (${formatBytes(stat.size)})`);
  }

  const syncRes = await syncCdn({ syncPublic: true, autoLfs: true, updateReadme: true });
  for (const item of added) {
    const record = syncRes.manifest.assets.find((a) => a.id === item.relFromCdn);
    if (record) {
      console.log(`  Custom : ${REPO_CONFIG.customDomain}${record.cdnPath}`);
      console.log(`  Pages  : ${REPO_CONFIG.pagesBase}${record.cdnPath}`);
      console.log(`  jsDelivr: ${REPO_CONFIG.jsDelivrBase}@${syncRes.manifest.repo.branch}/${record.gitPath}`);
      console.log(`  Storage: ${record.lfs ? 'Git LFS' : 'Git Object'}`);
    }
  }

  maybeCommitAndPush(flags, `feat(cdn): add ${added.map((a) => a.relFromCdn).join(', ')}`);
}

async function cmdRemove(args, flags) {
  if (args.length === 0) {
    console.error('Error: specify one or more asset paths or filenames to remove.');
    process.exit(1);
  }

  const manifest = buildManifestData();
  const removed = [];

  for (const target of args) {
    const matches = resolveAssetMatches(manifest, target);
    if (matches.length === 0) {
      console.error(`Error: no matching asset found for "${target}".`);
      process.exit(1);
    }
    if (matches.length > 1) {
      console.error(`Error: "${target}" is ambiguous and matched ${matches.length} assets:`);
      for (const m of matches) console.error(`  - ${m.gitPath}`);
      process.exit(1);
    }

    const asset = matches[0];
    const absPath = path.join(REPO_ROOT, asset.gitPath);
    if (fs.existsSync(absPath)) {
      fs.unlinkSync(absPath);
      removed.push(asset.id);
      console.log(`[DEL] ${asset.gitPath}`);
    }
  }

  await syncCdn({ syncPublic: true, autoLfs: true, updateReadme: true });
  maybeCommitAndPush(flags, `chore(cdn): remove ${removed.join(', ')}`);
}

async function cmdMove(args, flags) {
  if (args.length < 2) {
    console.error('Usage: pnpm hdn move <source-asset> <dest-folder-or-path>');
    process.exit(1);
  }
  const [srcQuery, destRaw] = args;
  const manifest = buildManifestData();
  const matches = resolveAssetMatches(manifest, srcQuery);
  if (matches.length !== 1) {
    console.error(`Error: expected exactly 1 match for "${srcQuery}", found ${matches.length}.`);
    process.exit(1);
  }

  const srcAsset = matches[0];
  const absSrc = path.join(REPO_ROOT, srcAsset.gitPath);
  const cleanDest = sanitizeRelFolder(destRaw);
  const hasExt = Boolean(path.extname(cleanDest));
  const destPath = hasExt
    ? path.join(CDN_DIR, path.dirname(cleanDest), toKebabCaseFilename(path.basename(cleanDest)))
    : path.join(CDN_DIR, cleanDest, srcAsset.name);

  fs.mkdirSync(path.dirname(destPath), { recursive: true });
  fs.renameSync(absSrc, destPath);
  const newRel = toPosix(path.relative(CDN_DIR, destPath));
  console.log(`[MV] ${srcAsset.gitPath} -> cdn/${newRel}`);

  await syncCdn({ syncPublic: true, autoLfs: true, updateReadme: true });
  maybeCommitAndPush(flags, `chore(cdn): move ${srcAsset.id} -> ${newRel}`);
}

function cmdList(flags) {
  const manifest = buildManifestData();
  let items = manifest.assets;

  if (typeof flags.type === 'string') {
    items = items.filter((a) => a.category === flags.type.toLowerCase());
  }
  if (typeof flags.project === 'string') {
    items = items.filter((a) => a.project === flags.project.toLowerCase());
  }
  if (typeof flags.search === 'string') {
    const q = flags.search.toLowerCase();
    items = items.filter((a) => a.id.toLowerCase().includes(q) || a.name.toLowerCase().includes(q));
  }

  if (flags.json) {
    console.log(JSON.stringify(items, null, 2));
    return;
  }

  console.log(`HDN Registry — ${items.length} / ${manifest.stats.totalAssets} assets (${manifest.stats.totalSizeFormatted})`);
  console.log('─'.repeat(92));
  for (const a of items) {
    const dim = a.dimensions ? `${a.dimensions.width}x${a.dimensions.height}` : a.font ? `${a.font.weight}` : '-';
    const lfsBadge = a.lfs ? 'LFS' : 'GIT';
    console.log(
      `${a.category.toUpperCase().padEnd(6)} ${lfsBadge.padEnd(4)} ${a.sizeFormatted.padStart(9)}  ${dim.padEnd(11)}  cdn/${a.id}`,
    );
  }
}

async function cmdSync(flags) {
  const res = await syncCdn({
    syncPublic: true,
    normalize: Boolean(flags.normalize),
    autoLfs: flags['auto-lfs'] !== false,
    updateReadme: flags.readme !== false,
  });

  if (res.renamed.length > 0) {
    console.log(`[SYNC] Normalized ${res.renamed.length} filename(s):`);
    for (const r of res.renamed) console.log(`  ${r.from} -> ${r.to}`);
  }
  if (res.lfsUpdate.updated) {
    console.log(`[SYNC] Updated .gitattributes auto-LFS rules (${res.lfsUpdate.trackedPaths.length} files >= 10MB).`);
  }
  console.log(
    `[SYNC] Manifest ready: ${res.manifest.stats.totalAssets} assets · ${res.manifest.stats.totalSizeFormatted} · ${res.manifest.stats.totalLfsAssets} LFS`,
  );
}

async function cmdLfs(args) {
  const sub = args[0] || 'status';
  if (sub === 'track-large') {
    const res = await syncCdn({ syncPublic: true, autoLfs: true });
    console.log(`[LFS] Auto-tracked ${res.lfsUpdate.trackedPaths.length} file(s) >= 10MB in .gitattributes.`);
    return;
  }

  try {
    const ver = execFileSync('git', ['lfs', 'version'], { cwd: REPO_ROOT, encoding: 'utf8' }).trim();
    console.log(`Git LFS: ${ver}`);
    const hooksExist = fs.existsSync(path.join(REPO_ROOT, '.git', 'hooks', 'pre-push'));
    console.log(`Local pre-push hook: ${hooksExist ? 'INSTALLED' : 'MISSING (run git lfs install --local)'}`);
    const manifest = buildManifestData();
    const lfsAssets = manifest.assets.filter((a) => a.lfs);
    console.log(`Tracked LFS assets in cdn/: ${lfsAssets.length}`);
    for (const a of lfsAssets) {
      console.log(`  - ${a.gitPath} (${a.sizeFormatted})`);
    }
  } catch {
    console.error('Git LFS is not installed on PATH. Install via: scoop install git-lfs && git lfs install --local');
    process.exit(1);
  }
}

function cmdDoctor(flags) {
  const strict = Boolean(flags.strict);
  const manifest = buildManifestData();
  const warnings = [];
  const errors = [];

  if (!manifest.repo.lfsAvailable) {
    errors.push('git-lfs is not available in PATH.');
  }
  if (!fs.existsSync(path.join(REPO_ROOT, '.git', 'hooks', 'pre-push'))) {
    warnings.push('Local .git/hooks/pre-push missing (expected in CI if hooks skipped; run `git lfs install --local` locally).');
  }

  const hashMap = new Map();
  for (const a of manifest.assets) {
    if (a.bytes === 0) {
      errors.push(`Zero-byte asset: ${a.gitPath}`);
    }
    const expectedName = toKebabCaseFilename(a.name);
    if (a.name !== expectedName) {
      warnings.push(`Non-kebab filename: ${a.gitPath} (expected ${expectedName}; run pnpm hdn sync --normalize)`);
    }
    if (a.bytes >= LFS_SIZE_THRESHOLD_BYTES && !a.lfs) {
      errors.push(`File >= 10MB not tracked by Git LFS: ${a.gitPath}`);
    }
    if (a.ext === '.svg') {
      const content = fs.readFileSync(path.join(REPO_ROOT, a.gitPath), 'utf8');
      if (!content.includes('<svg') || !content.includes('</svg>')) {
        errors.push(`Invalid SVG markup: ${a.gitPath}`);
      }
    }
    const existing = hashMap.get(a.sha256);
    if (existing) {
      warnings.push(`Duplicate content SHA-256: ${a.gitPath} == ${existing}`);
    } else {
      hashMap.set(a.sha256, a.gitPath);
    }
  }

  console.log(`[DOCTOR] Checked ${manifest.stats.totalAssets} assets (${manifest.stats.totalSizeFormatted})`);
  for (const w of warnings) console.log(`  [WARN] ${w}`);
  for (const e of errors) console.error(`  [ERR]  ${e}`);

  if (errors.length > 0 || (strict && warnings.some((w) => w.includes('Non-kebab')))) {
    process.exit(1);
  }
  console.log('[DOCTOR] Passed.');
}

const [command = 'help', ...rest] = process.argv.slice(2);
const { positionals, flags } = parseArgs(rest);

switch (command) {
  case 'add':
    await cmdAdd(positionals, flags);
    break;
  case 'remove':
  case 'rm':
  case 'delete':
    await cmdRemove(positionals, flags);
    break;
  case 'move':
  case 'mv':
    await cmdMove(positionals, flags);
    break;
  case 'list':
  case 'ls':
    cmdList(flags);
    break;
  case 'sync':
    await cmdSync(flags);
    break;
  case 'lfs':
    await cmdLfs(positionals);
    break;
  case 'doctor':
    cmdDoctor(flags);
    break;
  case 'help':
  case '--help':
  case '-h':
  default:
    console.log(HELP_TEXT.trim());
    break;
}
