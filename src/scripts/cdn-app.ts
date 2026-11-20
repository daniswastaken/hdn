interface AssetDimensions {
  width: number;
  height: number;
}

interface FontMeta {
  family: string;
  weight: number;
  style: string;
  format: string;
}

interface AssetRecord {
  id: string;
  name: string;
  stem: string;
  ext: string;
  category: 'image' | 'font' | 'icon' | 'svg' | 'media';
  directory: string;
  project: string | null;
  cdnPath: string;
  legacyPath: string | null;
  thumbPath: string | null;
  gitPath: string;
  bytes: number;
  sizeFormatted: string;
  mime: string;
  sha256: string;
  shortHash: string;
  integrity: string;
  lfs: boolean;
  dimensions: AssetDimensions | null;
  aspectRatio: number | null;
  viewBox: string | null;
  usesCurrentColor: boolean;
  inlineSvg: string | null;
  font: FontMeta | null;
  updatedAt: string;
}

interface DirectoryStat {
  path: string;
  count: number;
  bytes: number;
  sizeFormatted: string;
}

interface ManifestData {
  version: string;
  generatedAt: string;
  repo: {
    owner: string;
    name: string;
    branch: string;
    commit: string;
    shortCommit: string;
    customDomain: string;
    pagesBase: string;
    jsDelivrBase: string;
    rawBase: string;
    mediaBase: string;
    lfsAvailable: boolean;
  };
  stats: {
    totalAssets: number;
    totalBytes: number;
    totalSizeFormatted: string;
    totalLfsAssets: number;
    byCategory: Record<string, number>;
    directories: DirectoryStat[];
    projects: string[];
  };
  assets: AssetRecord[];
}

type EndpointKey = 'custom' | 'pages' | 'jsdelivr' | 'raw';
type SurfaceMode = 'checker' | 'dark' | 'light' | 'blueprint';
type ViewMode = 'grid' | 'table';
type SnippetTab = 'html' | 'css' | 'md' | 'fetch' | 'curl';

const manifestEl = document.getElementById('hdn-manifest');
if (!manifestEl) throw new Error('HDN manifest script tag missing.');

let manifest: ManifestData = JSON.parse(manifestEl.textContent || '{}');

const state = {
  search: '',
  category: 'all',
  directory: 'all',
  surface: 'checker' as SurfaceMode,
  sort: 'name-asc',
  view: 'grid' as ViewMode,
  endpoint: 'custom' as EndpointKey,
  pinCommit: false,
  fontSpecimen: 'Handaru Delivery Network — 0123456789 AaBbCcZz',
  fontSize: 26,
  selectedAssetId: null as string | null,
  activeSnippetTab: 'html' as SnippetTab,
  svgTint: 'current',
  localStudio: false,
  stagedFiles: [] as File[],
  deleteConfirmId: null as string | null,
};

const loadedFontFamilies = new Map<string, string>();
let toastTimer: number | undefined;
let lazyObserver: IntersectionObserver | null = null;
const PLACEHOLDER_IMG =
  'data:image/svg+xml;utf8,%3Csvg%20xmlns%3D%22http%3A//www.w3.org/2000/svg%22%20viewBox%3D%220%200%201%201%22/%3E';

function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing DOM element #${id}`);
  return node as T;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function activeRef(): string {
  return state.pinCommit ? manifest.repo.commit : manifest.repo.branch;
}

function buildEndpointUrl(asset: AssetRecord, endpoint: EndpointKey, ref = activeRef()): string {
  switch (endpoint) {
    case 'custom':
      return `${manifest.repo.customDomain}${asset.cdnPath}`;
    case 'pages':
      return `${manifest.repo.pagesBase}${asset.cdnPath}`;
    case 'jsdelivr':
      return `${manifest.repo.jsDelivrBase}@${ref}/${asset.gitPath}`;
    case 'raw': {
      const base = asset.lfs ? manifest.repo.mediaBase : manifest.repo.rawBase;
      return `${base}/${ref}/${asset.gitPath}`;
    }
  }
}

function activeAssetUrl(asset: AssetRecord): string {
  return buildEndpointUrl(asset, state.endpoint, activeRef());
}

function localPreviewSrc(asset: AssetRecord): string {
  return `.${asset.cdnPath}`;
}

function localThumbSrc(asset: AssetRecord): string {
  return asset.thumbPath ? `.${asset.thumbPath}` : localPreviewSrc(asset);
}

function renderLazyImg(
  src: string,
  alt: string,
  className: string,
  dims?: AssetDimensions | null,
): string {
  const dimAttrs = dims ? ` width="${dims.width}" height="${dims.height}"` : '';
  return `<img src="${PLACEHOLDER_IMG}" data-src="${escapeHtml(src)}" alt="${escapeHtml(alt)}" loading="lazy" decoding="async" fetchpriority="low"${dimAttrs} class="${className} opacity-0 transition-opacity duration-150" />`;
}

function revealImg(img: HTMLImageElement): void {
  const target = img.dataset.src;
  if (!target) return;
  delete img.dataset.src;
  const done = () => img.classList.remove('opacity-0');
  img.addEventListener('load', done, { once: true });
  img.addEventListener('error', done, { once: true });
  img.src = target;
  if (img.complete) done();
}

function observeLazyImages(root: ParentNode = document): void {
  const imgs = Array.from(root.querySelectorAll<HTMLImageElement>('img[data-src]'));
  if (imgs.length === 0) return;

  if (!('IntersectionObserver' in window)) {
    for (const img of imgs) revealImg(img);
    return;
  }

  if (!lazyObserver) {
    lazyObserver = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const img = entry.target as HTMLImageElement;
          lazyObserver?.unobserve(img);
          revealImg(img);
        }
      },
      { rootMargin: '160px 0px', threshold: 0.01 },
    );
  }

  for (const img of imgs) {
    lazyObserver.observe(img);
  }
}

function showToast(message: string, isError = false): void {
  const toast = el<HTMLDivElement>('hdn-toast');
  const text = el<HTMLSpanElement>('hdn-toast-text');
  text.textContent = message;
  toast.classList.remove('hidden', 'border-[var(--hdn-ok)]', 'border-[var(--hdn-danger)]');
  toast.classList.add(isError ? 'border-[var(--hdn-danger)]' : 'border-[var(--hdn-ok)]');
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    toast.classList.add('hidden');
  }, 2400);
}

async function copyText(content: string, btn?: HTMLElement | null, customToast?: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(content);
  } catch {
    const area = document.createElement('textarea');
    area.value = content;
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    document.execCommand('copy');
    area.remove();
  }

  if (btn) {
    const original = btn.dataset.origLabel || btn.textContent || 'Copy';
    btn.dataset.origLabel = original;
    btn.textContent = 'COPIED ✓';
    btn.classList.add('border-[var(--hdn-ok)]', 'text-[var(--hdn-ok)]');
    window.setTimeout(() => {
      btn.textContent = original;
      btn.classList.remove('border-[var(--hdn-ok)]', 'text-[var(--hdn-ok)]');
    }, 1200);
  }

  showToast(customToast || `COPIED: ${content.length > 72 ? content.slice(0, 72) + '…' : content}`);
}

async function ensureFontLoaded(asset: AssetRecord): Promise<string | null> {
  if (asset.category !== 'font' || !asset.font) return null;
  const cached = loadedFontFamilies.get(asset.id);
  if (cached) return cached;

  const safeId = asset.id.replace(/[^a-z0-9]/gi, '-');
  const familyName = `hdn-preview-${safeId}`;
  loadedFontFamilies.set(asset.id, familyName);

  try {
    const face = new FontFace(familyName, `url("${localPreviewSrc(asset)}")`, {
      weight: String(asset.font.weight),
      style: asset.font.style,
    });
    const loaded = await face.load();
    document.fonts.add(loaded);
    document.querySelectorAll<HTMLElement>(`[data-font-preview="${asset.id}"]`).forEach((node) => {
      node.style.fontFamily = `"${familyName}", monospace`;
      node.style.fontWeight = String(asset.font?.weight || 400);
      node.style.fontStyle = asset.font?.style || 'normal';
    });
    return familyName;
  } catch {
    return null;
  }
}

function buildSnippet(asset: AssetRecord, tab: SnippetTab): string {
  const url = activeAssetUrl(asset);
  switch (tab) {
    case 'html': {
      if (asset.category === 'font') {
        return `<link rel="preload" href="${url}" as="font" type="${asset.mime}" crossorigin />`;
      }
      if (asset.category === 'icon' || asset.category === 'svg') {
        return `<img src="${url}" alt="${asset.stem}"${asset.dimensions ? ` width="${asset.dimensions.width}" height="${asset.dimensions.height}"` : ''} />`;
      }
      if (asset.category === 'image') {
        const dims = asset.dimensions ? ` width="${asset.dimensions.width}" height="${asset.dimensions.height}"` : '';
        return `<img src="${url}" alt="${asset.stem}" loading="lazy"${dims} />`;
      }
      return `<a href="${url}" download="${asset.name}">${asset.name}</a>`;
    }
    case 'css': {
      if (asset.category === 'font' && asset.font) {
        return `@font-face {\n  font-family: '${asset.font.family}';\n  src: url('${url}') format('${asset.font.format}');\n  font-weight: ${asset.font.weight};\n  font-style: ${asset.font.style};\n  font-display: swap;\n}`;
      }
      if (asset.category === 'icon' && asset.usesCurrentColor) {
        return `.icon-${asset.stem} {\n  mask: url('${url}') no-repeat center / contain;\n  background-color: currentColor;\n}`;
      }
      return `.asset-${asset.stem} {\n  background-image: url('${url}');\n  background-size: contain;\n  background-repeat: no-repeat;\n}`;
    }
    case 'md': {
      if (asset.category === 'image' || asset.category === 'svg' || asset.category === 'icon') {
        return `![${asset.stem}](${url})`;
      }
      return `[${asset.name}](${url})`;
    }
    case 'fetch': {
      return `const res = await fetch('${url}');\n// Integrity: ${asset.integrity}`;
    }
    case 'curl': {
      return `curl -fsSLO "${url}"`;
    }
  }
}

function getFilteredAssets(): AssetRecord[] {
  const q = state.search.trim().toLowerCase();
  const filtered = manifest.assets.filter((asset) => {
    if (state.category !== 'all' && asset.category !== state.category) return false;
    if (state.directory !== 'all' && asset.directory !== state.directory) return false;
    if (q) {
      const hay = `${asset.id} ${asset.name} ${asset.category} ${asset.project || ''} ${asset.shortHash} ${asset.font?.family || ''}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  filtered.sort((a, b) => {
    switch (state.sort) {
      case 'size-desc':
        return b.bytes - a.bytes;
      case 'size-asc':
        return a.bytes - b.bytes;
      case 'recent':
        return b.updatedAt.localeCompare(a.updatedAt);
      case 'name-asc':
      default:
        return a.id.localeCompare(b.id);
    }
  });

  return filtered;
}

function surfaceClass(): string {
  switch (state.surface) {
    case 'dark':
      return 'stage-dark';
    case 'light':
      return 'stage-light';
    case 'blueprint':
      return 'stage-blueprint';
    case 'checker':
    default:
      return 'stage-checker';
  }
}

function formatMetaBadge(asset: AssetRecord): string {
  if (asset.category === 'font' && asset.font) {
    return `${asset.font.weight} ${asset.font.style.toUpperCase()}`;
  }
  if (asset.dimensions) {
    return `${asset.dimensions.width}×${asset.dimensions.height}`;
  }
  if (asset.viewBox) {
    return `VB ${asset.viewBox}`;
  }
  return asset.ext.replace('.', '').toUpperCase();
}

function renderCardPreview(asset: AssetRecord): string {
  const surf = surfaceClass();

  if (asset.category === 'font' && asset.font) {
    const family = loadedFontFamilies.get(asset.id);
    const fontCss = family ? `font-family:'${family}', monospace;` : '';
    ensureFontLoaded(asset);
    return `
      <div class="${surf} h-36 p-4 border-b hdn-border flex flex-col justify-between overflow-hidden">
        <div class="flex items-center justify-between font-[var(--font-mono)] text-[10px] opacity-70">
          <span>${escapeHtml(asset.font.family)}</span>
          <span>${asset.font.format.toUpperCase()} · ${asset.font.weight}</span>
        </div>
        <div
          data-font-preview="${escapeHtml(asset.id)}"
          class="truncate leading-tight select-none"
          style="${fontCss} font-size:${state.fontSize}px; font-weight:${asset.font.weight}; font-style:${asset.font.style};"
        >
          ${escapeHtml(state.fontSpecimen || 'Handaru Delivery Network')}
        </div>
        <div class="font-[var(--font-mono)] text-[10px] opacity-60 tracking-widest truncate">
          ABCDEFGHIJKLMNOPQRSTUVWXYZ 0123456789
        </div>
      </div>
    `;
  }

  if (asset.category === 'icon' || asset.category === 'svg') {
    const pad = asset.category === 'icon' ? 'p-6' : 'p-4';
    if (asset.inlineSvg) {
      const iconSizing = asset.category === 'icon' ? '[&>svg]:w-11 [&>svg]:h-11' : '[&>svg]:max-w-full [&>svg]:max-h-28 [&>svg]:w-auto [&>svg]:h-auto';
      return `
        <div class="${surf} h-36 ${pad} border-b hdn-border flex items-center justify-center overflow-hidden">
          <div class="${iconSizing} flex items-center justify-center">${asset.inlineSvg}</div>
        </div>
      `;
    }
    return `
      <div class="${surf} h-36 ${pad} border-b hdn-border flex items-center justify-center overflow-hidden">
        ${renderLazyImg(localThumbSrc(asset), asset.name, 'max-h-full max-w-full object-contain', asset.dimensions)}
      </div>
    `;
  }

  if (asset.category === 'image') {
    return `
      <div class="${surf} h-36 border-b hdn-border flex items-center justify-center overflow-hidden relative">
        ${renderLazyImg(localThumbSrc(asset), asset.name, 'w-full h-full object-contain p-1.5', asset.dimensions)}
        ${
          asset.thumbPath
            ? '<span class="pointer-events-none absolute bottom-1.5 right-1.5 px-1.5 py-0.5 bg-[var(--hdn-bg)]/85 border hdn-border font-[var(--font-mono)] text-[9px] text-[var(--hdn-ink-muted)]">360p PREVIEW</span>'
            : ''
        }
      </div>
    `;
  }

  return `
    <div class="${surf} h-36 border-b hdn-border flex flex-col items-center justify-center gap-2 p-4 font-[var(--font-mono)]">
      <span class="px-2.5 py-1 border hdn-border bg-[var(--hdn-bg)]/90 text-xs font-bold uppercase text-[var(--hdn-accent)]">
        ${escapeHtml(asset.ext.replace('.', '') || 'BIN')}
      </span>
      <span class="text-[10px] opacity-75">${asset.lfs ? 'GIT LFS OBJECT' : 'BINARY PAYLOAD'}</span>
    </div>
  `;
}

function renderGrid(items: AssetRecord[]): string {
  return `
    <div class="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-px bg-[var(--hdn-border)] border-b hdn-border">
      ${items
        .map((asset) => {
          const isFont = asset.category === 'font';
          const spanClass = isFont ? 'sm:col-span-2' : '';
          const quickSnippetBtn =
            asset.category === 'icon' || asset.category === 'svg'
              ? `<button type="button" data-action="copy-inline" data-id="${escapeHtml(asset.id)}" class="px-2 py-1 border hdn-border hover:border-[var(--hdn-accent)] font-[var(--font-mono)] text-[10px] uppercase cursor-pointer">&lt;svg&gt;</button>`
              : asset.category === 'font'
                ? `<button type="button" data-action="copy-css" data-id="${escapeHtml(asset.id)}" class="px-2 py-1 border hdn-border hover:border-[var(--hdn-accent)] font-[var(--font-mono)] text-[10px] uppercase cursor-pointer">@font</button>`
                : `<button type="button" data-action="copy-html" data-id="${escapeHtml(asset.id)}" class="px-2 py-1 border hdn-border hover:border-[var(--hdn-accent)] font-[var(--font-mono)] text-[10px] uppercase cursor-pointer">&lt;img&gt;</button>`;

          return `
            <article class="${spanClass} bg-[var(--hdn-bg)] flex flex-col justify-between group">
              <div role="button" tabindex="0" data-action="inspect" data-id="${escapeHtml(asset.id)}" class="cursor-pointer focus:outline-none">
                ${renderCardPreview(asset)}
              </div>

              <div class="p-3 space-y-2.5">
                <div class="flex items-start justify-between gap-2">
                  <div class="min-w-0">
                    <button
                      type="button"
                      data-action="inspect"
                      data-id="${escapeHtml(asset.id)}"
                      class="block w-full text-left font-[var(--font-mono)] text-xs font-semibold text-[var(--hdn-ink)] hover:text-[var(--hdn-accent)] truncate cursor-pointer"
                      title="${escapeHtml(asset.gitPath)}"
                    >
                      ${escapeHtml(asset.name)}
                    </button>
                    <div class="font-[var(--font-mono)] text-[10px] text-[var(--hdn-ink-subtle)] truncate mt-0.5">
                      ${escapeHtml(asset.directory || 'cdn')}
                    </div>
                  </div>
                  ${
                    asset.lfs
                      ? `<span class="shrink-0 px-1.5 py-0.5 border border-[var(--hdn-accent)]/50 bg-[var(--hdn-accent)]/10 text-[var(--hdn-accent)] font-[var(--font-mono)] text-[9px] font-bold">LFS</span>`
                      : `<span class="shrink-0 px-1.5 py-0.5 border hdn-border text-[var(--hdn-ink-subtle)] font-[var(--font-mono)] text-[9px] uppercase">${escapeHtml(asset.category)}</span>`
                  }
                </div>

                <div class="flex items-center justify-between font-[var(--font-mono)] text-[10px] text-[var(--hdn-ink-muted)] tabular-nums">
                  <span>${escapeHtml(formatMetaBadge(asset))}</span>
                  <span>${escapeHtml(asset.sizeFormatted)}</span>
                </div>

                <div class="flex items-center gap-1.5 pt-1">
                  <button
                    type="button"
                    data-action="copy-url"
                    data-id="${escapeHtml(asset.id)}"
                    class="flex-1 px-2.5 py-1 bg-[var(--hdn-surface)] border hdn-border hover:border-[var(--hdn-accent)] hover:text-[var(--hdn-ink)] font-[var(--font-mono)] text-[10px] uppercase font-semibold cursor-pointer text-center"
                  >
                    Copy URL
                  </button>
                  ${quickSnippetBtn}
                  <button
                    type="button"
                    data-action="inspect"
                    data-id="${escapeHtml(asset.id)}"
                    class="px-2 py-1 border hdn-border hover:border-[var(--hdn-border-strong)] font-[var(--font-mono)] text-[10px] uppercase text-[var(--hdn-ink-muted)] cursor-pointer"
                  >
                    Spec
                  </button>
                </div>
              </div>
            </article>
          `;
        })
        .join('')}
    </div>
  `;
}

function renderTable(items: AssetRecord[]): string {
  return `
    <div class="overflow-x-auto border-b hdn-border">
      <table class="w-full border-collapse text-left font-[var(--font-mono)] text-xs">
        <thead>
          <tr class="border-b hdn-border bg-[var(--hdn-surface)] text-[10px] uppercase tracking-wider text-[var(--hdn-ink-subtle)]">
            <th class="px-3 py-2 w-12">Prev</th>
            <th class="px-3 py-2">Vault Path</th>
            <th class="px-3 py-2">Type</th>
            <th class="px-3 py-2">Spec</th>
            <th class="px-3 py-2 text-right">Size</th>
            <th class="px-3 py-2">Store</th>
            <th class="px-3 py-2 text-right">Actions</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-[var(--hdn-border)]">
          ${items
            .map((asset) => {
              let thumb = `<span class="text-[10px] text-[var(--hdn-accent)]">${escapeHtml(asset.ext)}</span>`;
              if (asset.category === 'image') {
                thumb = renderLazyImg(localThumbSrc(asset), '', 'w-8 h-8 object-contain', asset.dimensions);
              } else if ((asset.category === 'icon' || asset.category === 'svg') && asset.inlineSvg) {
                thumb = `<div class="w-6 h-6 [&>svg]:w-full [&>svg]:h-full">${asset.inlineSvg}</div>`;
              } else if (asset.category === 'font') {
                ensureFontLoaded(asset);
                const fam = loadedFontFamilies.get(asset.id);
                thumb = `<span data-font-preview="${escapeHtml(asset.id)}" class="text-sm font-bold" style="${fam ? `font-family:'${fam}',monospace;` : ''}">Aa</span>`;
              }

              return `
                <tr class="hover:bg-[var(--hdn-surface)]/70">
                  <td class="px-3 py-1.5">
                    <div class="${surfaceClass()} w-9 h-9 border hdn-border flex items-center justify-center overflow-hidden">
                      ${thumb}
                    </div>
                  </td>
                  <td class="px-3 py-1.5">
                    <button type="button" data-action="inspect" data-id="${escapeHtml(asset.id)}" class="text-left text-[var(--hdn-ink)] hover:text-[var(--hdn-accent)] cursor-pointer font-medium">
                      ${escapeHtml(asset.gitPath)}
                    </button>
                  </td>
                  <td class="px-3 py-1.5 uppercase text-[11px] text-[var(--hdn-ink-muted)]">${escapeHtml(asset.category)}</td>
                  <td class="px-3 py-1.5 text-[11px] text-[var(--hdn-ink-muted)] tabular-nums">${escapeHtml(formatMetaBadge(asset))}</td>
                  <td class="px-3 py-1.5 text-right tabular-nums text-[var(--hdn-ink)]">${escapeHtml(asset.sizeFormatted)}</td>
                  <td class="px-3 py-1.5 text-[10px]">
                    ${
                      asset.lfs
                        ? `<span class="px-1.5 py-0.5 bg-[var(--hdn-accent)]/15 text-[var(--hdn-accent)] font-bold">LFS</span>`
                        : `<span class="text-[var(--hdn-ink-subtle)]">GIT</span>`
                    }
                  </td>
                  <td class="px-3 py-1.5 text-right whitespace-nowrap">
                    <div class="inline-flex items-center gap-1">
                      <button type="button" data-action="copy-url" data-id="${escapeHtml(asset.id)}" class="px-2 py-1 border hdn-border hover:border-[var(--hdn-accent)] text-[10px] uppercase cursor-pointer">
                        URL
                      </button>
                      <button type="button" data-action="inspect" data-id="${escapeHtml(asset.id)}" class="px-2 py-1 border hdn-border hover:border-[var(--hdn-border-strong)] text-[10px] uppercase cursor-pointer">
                        Spec
                      </button>
                    </div>
                  </td>
                </tr>
              `;
            })
            .join('')}
        </tbody>
      </table>
    </div>
  `;
}

function updateCountsAndSidebar(): void {
  el('header-telemetry').textContent = `${manifest.stats.totalAssets} ASSETS · ${manifest.stats.totalSizeFormatted} · ${manifest.stats.totalLfsAssets} LFS`;
  el('dir-count-all').textContent = String(manifest.stats.totalAssets);
  el('cat-count-all').textContent = String(manifest.stats.totalAssets);
  el('cat-count-image').textContent = String(manifest.stats.byCategory.image || 0);
  el('cat-count-font').textContent = String(manifest.stats.byCategory.font || 0);
  el('cat-count-icon').textContent = String(manifest.stats.byCategory.icon || 0);
  el('cat-count-svg').textContent = String(manifest.stats.byCategory.svg || 0);
  el('cat-count-media').textContent = String(manifest.stats.byCategory.media || 0);

  const projectDirs = manifest.stats.directories.filter((d) => d.path.startsWith('projects/'));
  const vaultDirs = manifest.stats.directories.filter((d) => !d.path.startsWith('projects/'));

  const renderDirBtn = (dir: DirectoryStat, label: string, showSize = false) => `
    <button
      type="button"
      data-dir-filter="${escapeHtml(dir.path)}"
      class="dir-btn ${state.directory === dir.path ? 'active-dir' : ''} w-full flex items-center justify-between px-2.5 py-1.5 text-left font-[var(--font-mono)] text-xs border border-transparent hover:bg-[var(--hdn-surface)] cursor-pointer"
    >
      <span class="flex items-center gap-1.5 truncate text-[var(--hdn-ink)]">
        <span>${escapeHtml(label)}</span>
        ${dir.path === 'lfs' ? '<span class="px-1 py-0.2 bg-[var(--hdn-accent)]/15 text-[var(--hdn-accent)] text-[9px] font-bold">LFS</span>' : ''}
      </span>
      <span class="text-[11px] text-[var(--hdn-ink-muted)] tabular-nums">
        ${dir.count}${showSize ? ` <span class="text-[var(--hdn-ink-subtle)]">· ${escapeHtml(dir.sizeFormatted)}</span>` : ''}
      </span>
    </button>
  `;

  el('dir-list-projects').innerHTML = projectDirs.map((d) => renderDirBtn(d, `${d.path.replace('projects/', '')}/`, true)).join('');
  el('dir-list-vaults').innerHTML = vaultDirs.map((d) => renderDirBtn(d, `${d.path}/`, false)).join('');
}

function render(): void {
  const items = getFilteredAssets();
  const stage = el<HTMLDivElement>('asset-stage');

  el('match-counter').textContent = `${items.length}/${manifest.stats.totalAssets}`;
  const scopeParts: string[] = [];
  if (state.directory !== 'all') scopeParts.push(`cdn/${state.directory}/`);
  else scopeParts.push('cdn/**');
  if (state.category !== 'all') scopeParts.push(`[${state.category.toUpperCase()}]`);
  if (state.search.trim()) scopeParts.push(`"${state.search.trim()}"`);
  el('active-scope-label').textContent = scopeParts.join(' · ');

  const hasFilters = state.category !== 'all' || state.directory !== 'all' || state.search.trim().length > 0;
  el('reset-filters-btn').classList.toggle('hidden', !hasFilters);

  const showFontBar = state.category === 'font' || (state.directory === 'fonts');
  el('font-tester-bar').classList.toggle('hidden', !showFontBar);
  el('font-tester-bar').classList.toggle('flex', showFontBar);

  document.querySelectorAll<HTMLElement>('.cat-btn').forEach((btn) => {
    const active = btn.dataset.catFilter === state.category;
    btn.classList.toggle('active-cat', active);
    btn.classList.toggle('bg-[var(--hdn-accent)]', active);
    btn.classList.toggle('text-[var(--hdn-accent-ink)]', active);
    btn.classList.toggle('border-[var(--hdn-accent)]', active);
    btn.classList.toggle('font-bold', active);
    btn.classList.toggle('bg-[var(--hdn-bg)]', !active);
    btn.classList.toggle('text-[var(--hdn-ink-muted)]', !active);
  });

  document.querySelectorAll<HTMLElement>('.dir-btn').forEach((btn) => {
    const active = btn.dataset.dirFilter === state.directory;
    btn.classList.toggle('bg-[var(--hdn-surface)]', active);
    btn.classList.toggle('border-[var(--hdn-accent)]', active);
  });

  document.querySelectorAll<HTMLElement>('.surface-btn').forEach((btn) => {
    const active = btn.dataset.surface === state.surface;
    btn.classList.toggle('bg-[var(--hdn-accent)]', active);
    btn.classList.toggle('text-[var(--hdn-accent-ink)]', active);
    btn.classList.toggle('font-bold', active);
  });

  document.querySelectorAll<HTMLElement>('.view-btn').forEach((btn) => {
    const active = btn.dataset.viewMode === state.view;
    btn.classList.toggle('bg-[var(--hdn-accent)]', active);
    btn.classList.toggle('text-[var(--hdn-accent-ink)]', active);
    btn.classList.toggle('font-bold', active);
  });

  if (items.length === 0) {
    stage.innerHTML = `
      <div class="p-12 text-center font-[var(--font-mono)] space-y-3">
        <div class="text-sm text-[var(--hdn-ink)]">NO ASSETS MATCH CURRENT FILTER</div>
        <div class="text-xs text-[var(--hdn-ink-muted)]">
          ${state.directory !== 'all' ? `Folder <code>cdn/${escapeHtml(state.directory)}/</code> currently has no matching files.` : 'Try clearing your search or switching category.'}
        </div>
        <div class="flex items-center justify-center gap-2 pt-2">
          <button type="button" id="empty-reset-btn" class="px-3 py-1.5 border hdn-border bg-[var(--hdn-surface)] text-xs uppercase cursor-pointer hover:border-[var(--hdn-accent)]">
            Reset Filters
          </button>
          <button type="button" id="empty-upload-btn" class="px-3 py-1.5 bg-[var(--hdn-accent)] text-[var(--hdn-accent-ink)] text-xs font-bold uppercase cursor-pointer">
            + Upload Here
          </button>
        </div>
      </div>
    `;
    document.getElementById('empty-reset-btn')?.addEventListener('click', resetAllFilters);
    document.getElementById('empty-upload-btn')?.addEventListener('click', () => openUploadModal(state.directory === 'all' ? undefined : state.directory));
    return;
  }

  stage.innerHTML = state.view === 'grid' ? renderGrid(items) : renderTable(items);
  observeLazyImages(stage);
}

function resetAllFilters(): void {
  state.search = '';
  state.category = 'all';
  state.directory = 'all';
  el<HTMLInputElement>('search-input').value = '';
  render();
}

function renderInspector(asset: AssetRecord): void {
  state.selectedAssetId = asset.id;
  state.deleteConfirmId = null;

  el('insp-cat-badge').textContent = asset.category.toUpperCase();
  const lfsBadge = el('insp-lfs-badge');
  lfsBadge.textContent = asset.lfs ? 'GIT LFS' : 'GIT OBJECT';
  lfsBadge.classList.toggle('text-[var(--hdn-accent)]', asset.lfs);
  lfsBadge.classList.toggle('border-[var(--hdn-accent)]', asset.lfs);

  el('insp-size-badge').textContent = asset.sizeFormatted;
  el('insp-title').textContent = asset.gitPath;

  const inspStage = el('insp-stage');
  inspStage.className = `${surfaceClass()} min-h-[210px] max-h-[340px] flex items-center justify-center p-4 overflow-auto`;

  const inspStageLabel = el('insp-stage-label');
  if (asset.category === 'image' && asset.thumbPath && asset.dimensions) {
    inspStageLabel.textContent = `THUMBNAIL PREVIEW (360p) · RAW ${asset.dimensions.width}×${asset.dimensions.height}`;
  } else {
    inspStageLabel.textContent = 'LIVE PREVIEW';
  }

  const tintsWrap = el('insp-svg-tints');
  if (asset.category === 'icon' || asset.category === 'svg') {
    tintsWrap.classList.remove('hidden');
    tintsWrap.classList.add('flex');
  } else {
    tintsWrap.classList.add('hidden');
    tintsWrap.classList.remove('flex');
  }

  if (asset.category === 'font' && asset.font) {
    ensureFontLoaded(asset);
    const fam = loadedFontFamilies.get(asset.id);
    const sizes = [14, 20, 28, 40];
    inspStage.innerHTML = `
      <div
        data-font-preview="${escapeHtml(asset.id)}"
        class="w-full space-y-3 text-left"
        style="${fam ? `font-family:'${fam}',monospace;` : ''} font-weight:${asset.font.weight}; font-style:${asset.font.style};"
      >
        ${sizes
          .map(
            (sz) => `
          <div class="border-b hdn-border/40 pb-1.5">
            <span class="font-[var(--font-mono)] text-[9px] opacity-60 mr-2">${sz}PX</span>
            <span style="font-size:${sz}px;">${escapeHtml(state.fontSpecimen)}</span>
          </div>
        `,
          )
          .join('')}
      </div>
    `;
  } else if ((asset.category === 'icon' || asset.category === 'svg') && asset.inlineSvg) {
    const colorStyle = state.svgTint === 'current' ? '' : `color:${state.svgTint};`;
    inspStage.innerHTML = `
      <div class="max-w-full max-h-64 [&>svg]:max-h-56 [&>svg]:max-w-full [&>svg]:min-w-[80px] [&>svg]:min-h-[80px] flex items-center justify-center" style="${colorStyle}">
        ${asset.inlineSvg}
      </div>
    `;
  } else if (asset.category === 'image' || asset.category === 'svg' || asset.category === 'icon') {
    inspStage.innerHTML = renderLazyImg(
      localThumbSrc(asset),
      asset.name,
      'max-w-full max-h-[300px] object-contain',
      asset.dimensions,
    );
    inspStage.querySelectorAll<HTMLImageElement>('img[data-src]').forEach(revealImg);
  } else {
    inspStage.innerHTML = `
      <div class="text-center font-[var(--font-mono)] space-y-2">
        <div class="text-lg font-bold text-[var(--hdn-accent)]">${escapeHtml(asset.ext.toUpperCase())}</div>
        <div class="text-xs opacity-80">${escapeHtml(asset.mime)} · ${escapeHtml(asset.sizeFormatted)}</div>
      </div>
    `;
  }

  const ref = activeRef();
  const urls: Array<{ label: string; url: string }> = [
    { label: 'CUSTOM DOMAIN', url: buildEndpointUrl(asset, 'custom', ref) },
    { label: 'GITHUB PAGES', url: buildEndpointUrl(asset, 'pages', ref) },
    { label: `JSDELIVR (@${state.pinCommit ? manifest.repo.shortCommit : manifest.repo.branch})`, url: buildEndpointUrl(asset, 'jsdelivr', ref) },
    { label: asset.lfs ? 'GITHUB LFS MEDIA' : 'GITHUB RAW', url: buildEndpointUrl(asset, 'raw', ref) },
  ];
  if (asset.legacyPath) {
    urls.push({ label: 'LEGACY ALIAS', url: `${manifest.repo.customDomain}${asset.legacyPath}` });
  }
  urls.push({ label: 'RELATIVE ROUTE', url: asset.cdnPath });

  el('insp-url-matrix').innerHTML = urls
    .map(
      (row) => `
      <div class="flex items-center justify-between gap-2 px-3 py-2">
        <div class="min-w-0">
          <div class="font-[var(--font-mono)] text-[9px] uppercase tracking-wider text-[var(--hdn-ink-subtle)]">${escapeHtml(row.label)}</div>
          <div class="font-[var(--font-mono)] text-[11px] text-[var(--hdn-ink)] truncate" title="${escapeHtml(row.url)}">${escapeHtml(row.url)}</div>
        </div>
        <button
          type="button"
          data-copy-text="${escapeHtml(row.url)}"
          class="shrink-0 px-2 py-1 border hdn-border hover:border-[var(--hdn-accent)] font-[var(--font-mono)] text-[10px] uppercase cursor-pointer"
        >
          COPY
        </button>
      </div>
    `,
    )
    .join('');

  updateInspectorSnippet(asset);

  const specs: Array<[string, string]> = [
    ['Vault File', asset.gitPath],
    ['MIME Type', asset.mime],
    ['Payload Size', `${asset.sizeFormatted} (${asset.bytes.toLocaleString()} bytes)`],
    ['Dimensions / Spec', formatMetaBadge(asset)],
    ['SHA-256', asset.sha256],
    ['SRI Integrity', asset.integrity],
    ['Storage Mode', asset.lfs ? 'Git LFS Pointer' : 'Standard Git Object'],
  ];

  el('insp-specs').innerHTML = specs
    .map(
      ([k, v]) => `
      <div class="flex items-center justify-between gap-3 px-3 py-1.5">
        <dt class="text-[var(--hdn-ink-subtle)] shrink-0">${escapeHtml(k)}</dt>
        <dd class="m-0 text-right text-[var(--hdn-ink)] truncate" title="${escapeHtml(v)}">${escapeHtml(v)}</dd>
      </div>
    `,
    )
    .join('');

  const dl = el<HTMLAnchorElement>('insp-download-link');
  dl.href = localPreviewSrc(asset);
  dl.download = asset.name;

  const ghDel = el<HTMLAnchorElement>('insp-github-delete-link');
  ghDel.href = `https://github.com/${manifest.repo.owner}/${manifest.repo.name}/delete/${manifest.repo.branch}/${asset.gitPath}`;

  const localDelBtn = el<HTMLButtonElement>('insp-local-delete-btn');
  localDelBtn.classList.toggle('hidden', !state.localStudio);
  localDelBtn.textContent = 'Delete From Disk';

  el('insp-delete-feedback').classList.add('hidden');

  el('inspector-backdrop').classList.remove('hidden');
  el('inspector-drawer').classList.remove('translate-x-full');
}

function updateInspectorSnippet(asset: AssetRecord): void {
  document.querySelectorAll<HTMLElement>('.snip-tab').forEach((btn) => {
    const active = btn.dataset.snip === state.activeSnippetTab;
    btn.classList.toggle('bg-[var(--hdn-accent)]', active);
    btn.classList.toggle('text-[var(--hdn-accent-ink)]', active);
    btn.classList.toggle('font-bold', active);
  });
  el('insp-snippet-code').textContent = buildSnippet(asset, state.activeSnippetTab);
}

function closeInspector(): void {
  state.selectedAssetId = null;
  state.deleteConfirmId = null;
  el('inspector-backdrop').classList.add('hidden');
  el('inspector-drawer').classList.add('translate-x-full');
}

function getSelectedUploadFolder(): string {
  const sel = el<HTMLSelectElement>('upload-folder-select').value;
  if (sel === '__custom__') {
    const custom = el<HTMLInputElement>('upload-custom-folder-input').value.trim().replace(/^\/+|\/+$/g, '').replace(/^cdn\//, '');
    return custom || 'images';
  }
  return sel;
}

function updateUploadPreview(): void {
  const folder = getSelectedUploadFolder();
  const isCustom = el<HTMLSelectElement>('upload-folder-select').value === '__custom__';
  el('upload-custom-folder-wrap').classList.toggle('hidden', !isCustom);

  const ghLink = el<HTMLAnchorElement>('upload-github-web-link');
  ghLink.href = `https://github.com/${manifest.repo.owner}/${manifest.repo.name}/upload/${manifest.repo.branch}/cdn/${folder}`;

  const fileListArg = state.stagedFiles.length
    ? state.stagedFiles.map((f) => `"./${f.name}"`).join(' ')
    : './my-asset.png';
  el('upload-cli-preview').textContent = `pnpm hdn add ${fileListArg} --to ${folder} --commit --push`;

  const queueWrap = el('upload-queue-wrap');
  const queueList = el('upload-queue-list');
  const submitBtn = el<HTMLButtonElement>('upload-local-submit-btn');

  if (state.stagedFiles.length === 0) {
    queueWrap.classList.add('hidden');
    submitBtn.disabled = true;
    return;
  }

  queueWrap.classList.remove('hidden');
  submitBtn.disabled = false;
  queueList.innerHTML = state.stagedFiles
    .map((f) => {
      const mb = f.size / (1024 * 1024);
      const willLfs = folder === 'lfs' || f.size >= 10 * 1024 * 1024;
      const sizeText = mb >= 1 ? `${mb.toFixed(2)} MB` : `${Math.max(1, Math.round(f.size / 1024))} KB`;
      return `
        <li class="px-3 py-1.5 flex items-center justify-between gap-2">
          <span class="truncate text-[var(--hdn-ink)]">${escapeHtml(f.name)}</span>
          <span class="shrink-0 flex items-center gap-2 text-[10px]">
            ${willLfs ? '<span class="text-[var(--hdn-accent)] font-bold">AUTO-LFS</span>' : ''}
            <span class="text-[var(--hdn-ink-muted)] tabular-nums">${sizeText}</span>
          </span>
        </li>
      `;
    })
    .join('');
}

function openUploadModal(preselectFolder?: string): void {
  if (preselectFolder) {
    const sel = el<HTMLSelectElement>('upload-folder-select');
    const match = Array.from(sel.options).some((opt) => opt.value === preselectFolder);
    if (match) sel.value = preselectFolder;
  }
  el('upload-local-submit-btn').classList.toggle('hidden', !state.localStudio);
  el('upload-mode-subtitle').textContent = state.localStudio
    ? 'Local Studio Active: drop files to write straight to cdn/ on disk and sync manifest.'
    : 'Drop files to generate upload commands, or upload directly via GitHub Web UI.';
  el('upload-status-msg').classList.add('hidden');
  updateUploadPreview();
  el('upload-modal-backdrop').classList.remove('hidden');
}

function closeUploadModal(): void {
  el('upload-modal-backdrop').classList.add('hidden');
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || '');
      const idx = result.indexOf(',');
      resolve(idx >= 0 ? result.slice(idx + 1) : result);
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

async function handleLocalUpload(): Promise<void> {
  if (!state.localStudio || state.stagedFiles.length === 0) return;
  const submitBtn = el<HTMLButtonElement>('upload-local-submit-btn');
  const statusEl = el<HTMLParagraphElement>('upload-status-msg');
  const folder = getSelectedUploadFolder();

  submitBtn.disabled = true;
  submitBtn.textContent = 'Writing & Syncing...';

  try {
    const payloadFiles = [];
    for (const file of state.stagedFiles) {
      const base64 = await fileToBase64(file);
      payloadFiles.push({ name: file.name, base64 });
    }

    const res = await fetch('./__hdn_api/upload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ folder, files: payloadFiles }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Upload failed');

    manifest = data.manifest;
    state.stagedFiles = [];
    updateCountsAndSidebar();
    updateUploadPreview();
    render();

    statusEl.textContent = `Uploaded ${data.added.length} file(s) to cdn/${folder}/ and updated manifest.`;
    statusEl.className = 'm-0 font-[var(--font-mono)] text-xs text-[var(--hdn-ok)]';
    statusEl.classList.remove('hidden');
    showToast(`UPLOADED ${data.added.length} ASSET(S)`);
  } catch (err) {
    statusEl.textContent = err instanceof Error ? err.message : String(err);
    statusEl.className = 'm-0 font-[var(--font-mono)] text-xs text-[var(--hdn-danger)]';
    statusEl.classList.remove('hidden');
  } finally {
    submitBtn.textContent = 'Write Directly to cdn/ Vault';
    submitBtn.disabled = state.stagedFiles.length === 0;
  }
}

async function handleLocalDelete(): Promise<void> {
  if (!state.localStudio || !state.selectedAssetId) return;
  const assetId = state.selectedAssetId;
  const btn = el<HTMLButtonElement>('insp-local-delete-btn');

  if (state.deleteConfirmId !== assetId) {
    state.deleteConfirmId = assetId;
    btn.textContent = 'Click Again to Confirm Delete';
    return;
  }

  btn.disabled = true;
  btn.textContent = 'Deleting...';

  try {
    const res = await fetch('./__hdn_api/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: assetId }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Delete failed');

    manifest = data.manifest;
    updateCountsAndSidebar();
    closeInspector();
    render();
    showToast(`DELETED cdn/${assetId}`);
  } catch (err) {
    const fb = el('insp-delete-feedback');
    fb.textContent = err instanceof Error ? err.message : String(err);
    fb.className = 'm-0 font-[var(--font-mono)] text-[11px] text-[var(--hdn-danger)]';
    fb.classList.remove('hidden');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Delete From Disk';
  }
}

async function probeLocalStudio(): Promise<void> {
  try {
    const res = await fetch('./__hdn_api/status', { cache: 'no-store' });
    const ct = res.headers.get('content-type') || '';
    if (!res.ok || !ct.includes('application/json')) return;
    const data = await res.json();
    if (data && data.localWriteEnabled) {
      state.localStudio = true;
      el('studio-status-label').textContent = 'LOCAL STUDIO (R/W)';
    }
  } catch {
    // Static GitHub Pages mode
  }
}

function bindEvents(): void {
  el<HTMLInputElement>('search-input').addEventListener('input', (e) => {
    state.search = (e.target as HTMLInputElement).value;
    render();
  });

  el<HTMLSelectElement>('sort-select').addEventListener('change', (e) => {
    state.sort = (e.target as HTMLSelectElement).value;
    render();
  });

  el<HTMLSelectElement>('endpoint-select').addEventListener('change', (e) => {
    state.endpoint = (e.target as HTMLSelectElement).value as EndpointKey;
    if (state.selectedAssetId) {
      const asset = manifest.assets.find((a) => a.id === state.selectedAssetId);
      if (asset) renderInspector(asset);
    }
    showToast(`ENDPOINT: ${state.endpoint.toUpperCase()}`);
  });

  el('pin-ref-btn').addEventListener('click', () => {
    state.pinCommit = !state.pinCommit;
    el('pin-ref-btn').textContent = `@${state.pinCommit ? manifest.repo.shortCommit : manifest.repo.branch}`;
    el('pin-ref-btn').classList.toggle('text-[var(--hdn-accent)]', state.pinCommit);
    if (state.selectedAssetId) {
      const asset = manifest.assets.find((a) => a.id === state.selectedAssetId);
      if (asset) renderInspector(asset);
    }
  });

  el('theme-toggle-btn').addEventListener('click', () => {
    const isLight = document.documentElement.classList.toggle('theme-light');
    try {
      localStorage.setItem('hdn-theme', isLight ? 'light' : 'dark');
    } catch {}
  });

  el('reset-filters-btn').addEventListener('click', resetAllFilters);

  document.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;

    const catBtn = target.closest<HTMLElement>('.cat-btn');
    if (catBtn?.dataset.catFilter) {
      state.category = catBtn.dataset.catFilter;
      render();
      return;
    }

    const dirBtn = target.closest<HTMLElement>('.dir-btn');
    if (dirBtn?.dataset.dirFilter) {
      state.directory = dirBtn.dataset.dirFilter;
      el('sidebar-nav').classList.add('-translate-x-full');
      render();
      return;
    }

    const surfBtn = target.closest<HTMLElement>('.surface-btn');
    if (surfBtn?.dataset.surface) {
      state.surface = surfBtn.dataset.surface as SurfaceMode;
      render();
      if (state.selectedAssetId) {
        const asset = manifest.assets.find((a) => a.id === state.selectedAssetId);
        if (asset) renderInspector(asset);
      }
      return;
    }

    const viewBtn = target.closest<HTMLElement>('.view-btn');
    if (viewBtn?.dataset.viewMode) {
      state.view = viewBtn.dataset.viewMode as ViewMode;
      render();
      return;
    }

    const actionEl = target.closest<HTMLElement>('[data-action]');
    if (actionEl?.dataset.action && actionEl.dataset.id) {
      const asset = manifest.assets.find((a) => a.id === actionEl.dataset.id);
      if (!asset) return;
      switch (actionEl.dataset.action) {
        case 'inspect':
          renderInspector(asset);
          return;
        case 'copy-url':
          copyText(activeAssetUrl(asset), actionEl);
          return;
        case 'copy-inline':
          copyText(asset.inlineSvg || buildSnippet(asset, 'html'), actionEl, 'COPIED INLINE <svg>');
          return;
        case 'copy-html':
          copyText(buildSnippet(asset, 'html'), actionEl, 'COPIED HTML SNIPPET');
          return;
        case 'copy-css':
          copyText(buildSnippet(asset, 'css'), actionEl, 'COPIED @font-face CSS');
          return;
      }
    }

    const copyBtn = target.closest<HTMLElement>('[data-copy-text]');
    if (copyBtn?.dataset.copyText) {
      copyText(copyBtn.dataset.copyText, copyBtn);
      return;
    }

    const snipTab = target.closest<HTMLElement>('.snip-tab');
    if (snipTab?.dataset.snip && state.selectedAssetId) {
      state.activeSnippetTab = snipTab.dataset.snip as SnippetTab;
      const asset = manifest.assets.find((a) => a.id === state.selectedAssetId);
      if (asset) updateInspectorSnippet(asset);
      return;
    }

    const tintBtn = target.closest<HTMLElement>('[data-tint]');
    if (tintBtn?.dataset.tint && state.selectedAssetId) {
      state.svgTint = tintBtn.dataset.tint;
      const asset = manifest.assets.find((a) => a.id === state.selectedAssetId);
      if (asset) renderInspector(asset);
      return;
    }

    const modalTab = target.closest<HTMLElement>('.modal-tab');
    if (modalTab?.dataset.modalTab) {
      const tab = modalTab.dataset.modalTab;
      document.querySelectorAll<HTMLElement>('.modal-tab').forEach((t) => {
        const active = t.dataset.modalTab === tab;
        t.classList.toggle('bg-[var(--hdn-bg)]', active);
        t.classList.toggle('text-[var(--hdn-accent)]', active);
        t.classList.toggle('font-bold', active);
      });
      el('modal-panel-upload').classList.toggle('hidden', tab !== 'upload');
      el('modal-panel-cli').classList.toggle('hidden', tab !== 'cli');
    }
  });

  // Font tester
  el<HTMLInputElement>('font-specimen-input').addEventListener('input', (e) => {
    state.fontSpecimen = (e.target as HTMLInputElement).value;
    document.querySelectorAll<HTMLElement>('[data-font-preview]').forEach((node) => {
      if (!node.closest('#insp-stage')) {
        node.textContent = state.fontSpecimen || 'Handaru Delivery Network';
      }
    });
  });

  el<HTMLInputElement>('font-size-slider').addEventListener('input', (e) => {
    state.fontSize = Number((e.target as HTMLInputElement).value);
    el('font-size-readout').textContent = `${state.fontSize}px`;
    document.querySelectorAll<HTMLElement>('[data-font-preview]').forEach((node) => {
      if (!node.closest('#insp-stage')) {
        node.style.fontSize = `${state.fontSize}px`;
      }
    });
  });

  // Inspector controls
  el('insp-close-btn').addEventListener('click', closeInspector);
  el('inspector-backdrop').addEventListener('click', closeInspector);
  el('insp-copy-snippet-btn').addEventListener('click', (e) => {
    if (!state.selectedAssetId) return;
    const asset = manifest.assets.find((a) => a.id === state.selectedAssetId);
    if (asset) copyText(buildSnippet(asset, state.activeSnippetTab), e.currentTarget as HTMLElement);
  });
  el('insp-copy-rm-cmd').addEventListener('click', (e) => {
    if (!state.selectedAssetId) return;
    copyText(`pnpm hdn remove "${state.selectedAssetId}" --commit --push`, e.currentTarget as HTMLElement);
  });
  el('insp-local-delete-btn').addEventListener('click', handleLocalDelete);

  // Mobile nav
  el('mobile-nav-toggle').addEventListener('click', () => el('sidebar-nav').classList.remove('-translate-x-full'));
  el('mobile-nav-close').addEventListener('click', () => el('sidebar-nav').classList.add('-translate-x-full'));

  // Upload modal
  el('open-upload-btn').addEventListener('click', () => openUploadModal());
  el('upload-modal-close').addEventListener('click', closeUploadModal);
  el('upload-modal-backdrop').addEventListener('click', (e) => {
    if (e.target === el('upload-modal-backdrop')) closeUploadModal();
  });
  el('upload-folder-select').addEventListener('change', updateUploadPreview);
  el('upload-custom-folder-input').addEventListener('input', updateUploadPreview);
  el<HTMLInputElement>('upload-file-input').addEventListener('change', (e) => {
    const files = Array.from((e.target as HTMLInputElement).files || []);
    if (files.length) {
      state.stagedFiles = [...state.stagedFiles, ...files];
      updateUploadPreview();
    }
  });

  const dropzone = el('upload-dropzone');
  dropzone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropzone.classList.add('border-[var(--hdn-accent)]');
  });
  dropzone.addEventListener('dragleave', () => {
    dropzone.classList.remove('border-[var(--hdn-accent)]');
  });
  dropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropzone.classList.remove('border-[var(--hdn-accent)]');
    const files = Array.from(e.dataTransfer?.files || []);
    if (files.length) {
      state.stagedFiles = [...state.stagedFiles, ...files];
      updateUploadPreview();
    }
  });

  el('upload-clear-btn').addEventListener('click', () => {
    state.stagedFiles = [];
    el<HTMLInputElement>('upload-file-input').value = '';
    updateUploadPreview();
  });

  el('upload-copy-cli-btn').addEventListener('click', (e) => {
    copyText(el('upload-cli-preview').textContent || '', e.currentTarget as HTMLElement);
  });

  el('upload-local-submit-btn').addEventListener('click', handleLocalUpload);

  // Keyboard shortcuts
  document.addEventListener('keydown', (e) => {
    const activeTag = document.activeElement?.tagName;
    if (e.key === '/' && activeTag !== 'INPUT' && activeTag !== 'TEXTAREA' && activeTag !== 'SELECT') {
      e.preventDefault();
      el<HTMLInputElement>('search-input').focus();
    } else if (e.key === 'Escape') {
      closeInspector();
      closeUploadModal();
      el('sidebar-nav').classList.add('-translate-x-full');
    }
  });
}

bindEvents();
render();
probeLocalStudio();
