import { syncCdn } from './lib/cdn-core.mjs';

const args = new Set(process.argv.slice(2));
const normalize = args.has('--normalize');
const autoLfs = args.has('--auto-lfs');
const updateReadme = args.has('--readme');

const result = await syncCdn({
  syncPublic: true,
  normalize,
  autoLfs,
  updateReadme,
});

const { stats } = result.manifest;
console.log(
  `[HDN] Manifest synced: ${stats.totalAssets} assets (${stats.totalSizeFormatted}), ${stats.totalLfsAssets} LFS objects -> public/ & src/data/manifest.json`,
);
