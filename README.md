# HDN — Handaru Delivery Network

A self-hosted, Git-backed Content Delivery Network (CDN) powered by **Astro 5**, **Tailwind CSS v4**, **Git LFS**, and **GitHub Actions**. Built for fast browsing, instant 1-click asset URL & snippet copying (images, web fonts, SVG vectors, icons, and large binaries), and effortless upload/removal from both the CLI and GitHub.

---

## Live Delivery Endpoints

| Endpoint | URL Pattern | Best For |
| --- | --- | --- |
| **Custom Edge (Live)** | `https://cdn.handaru.dev/<path>` | Production apps & websites |
| **GitHub Pages** | `https://daniswastaken.github.io/hdn/<path>` | Direct web, font & LFS asset serving |
| **jsDelivr CDN** | `https://cdn.jsdelivr.net/gh/daniswastaken/hdn@main/cdn/<path>` | Global edge caching & `@commit` pinning |
| **GitHub Raw / Media** | `https://raw.githubusercontent.com/daniswastaken/hdn/main/cdn/<path>` | Direct raw fetch (`media.githubusercontent.com` for LFS) |

> **Backward compatibility**: Legacy project URLs such as `/grafika/2-0-hd.png` and `/prefect/demo-1.png` remain active as top-level static aliases on GitHub Pages / `cdn.handaru.dev`, while the canonical vault lives in `cdn/projects/<project>/`.

---

## Vault Inventory

<!-- HDN:STATS:START -->

> **Live Inventory**: **65 assets** · **37.4 MB** total payload · **0** Git LFS objects · Branch `main` (`89e711c`)

| Vault Directory | Assets | Payload | Canonical Edge Route |
| --- | ---: | ---: | --- |
| `cdn/fonts/` | 7 | 135.9 KB | `https://cdn.handaru.dev/fonts/...` |
| `cdn/icons/` | 16 | 4.14 KB | `https://cdn.handaru.dev/icons/...` |
| `cdn/images/` | 0 | 0 B | `https://cdn.handaru.dev/images/...` |
| `cdn/lfs/` | 0 | 0 B | `https://cdn.handaru.dev/lfs/...` |
| `cdn/media/` | 0 | 0 B | `https://cdn.handaru.dev/media/...` |
| `cdn/projects/grafika/` | 35 | 34.7 MB | `https://cdn.handaru.dev/projects/grafika/...` |
| `cdn/projects/prefect/` | 3 | 2.15 MB | `https://cdn.handaru.dev/projects/prefect/...` |
| `cdn/reforged/` | 1 | 435.5 KB | `https://cdn.handaru.dev/reforged/...` |
| `cdn/svg/` | 3 | 1.69 KB | `https://cdn.handaru.dev/svg/...` |

<!-- HDN:STATS:END -->

---

## Directory Layout

```text
hdn/
├── cdn/                      # Source of truth for all CDN assets
│   ├── projects/             # Project-scoped screenshots, banners, media
│   │   ├── grafika/          # Grafika project assets
│   │   └── prefect/          # Prefect project assets
│   ├── fonts/                # Production web fonts (.woff2, .woff, .ttf)
│   ├── icons/                # UI & developer SVG icon library
│   ├── svg/                  # Logos, badges, illustrations
│   ├── images/               # General shared raster assets
│   ├── media/                # Audio, video, documents, 3D assets
│   └── lfs/                  # Drop-zone unconditionally tracked by Git LFS
├── scripts/                  # HDN CLI (`hdn.mjs`), manifest indexer & postbuild
├── src/                      # Astro 5 + Tailwind v4 Registry Browser UI
└── .github/workflows/        # Automated LFS sync, validation, build & Pages deploy
```

---

## Quick Start (Local Development & Studio Mode)

```powershell
# 1. Install dependencies
pnpm install

# 2. Start the Astro Registry + Live Local Upload/Delete Studio
pnpm dev
```

When running `pnpm dev`, the browser UI connects to the local dev server so you can **drag-and-drop files directly into `cdn/`** or **delete assets** with a single click—automatically normalizing filenames, configuring Git LFS if needed, and regenerating the manifest.

---

## Easy Upload & Removal via CLI (`pnpm hdn`)

```powershell
# Upload assets (auto-routes by extension or to a specific folder/project)
pnpm hdn add ./my-banner.png --project grafika
pnpm hdn add ./custom-font.woff2 --to fonts
pnpm hdn add ./archive.zip --lfs --commit --push

# Remove assets cleanly by path or filename
pnpm hdn remove grafika/old-banner.png --commit --push

# Move/rename an asset inside cdn/
pnpm hdn move images/logo.svg svg/

# List & filter assets
pnpm hdn list --type font
pnpm hdn list --project prefect

# Normalize filenames to kebab-case, update LFS rules & rebuild manifest/README
pnpm hdn sync --normalize --auto-lfs --readme

# Check Git LFS hooks, SVG validity, zero-byte files & duplicates
pnpm hdn doctor --strict
```

---

## Git LFS Setup

Git LFS is pre-configured in `.gitattributes` to automatically track:
- Any file placed inside `cdn/lfs/**`
- Heavy binary extensions (`*.mp4`, `*.webm`, `*.zip`, `*.7z`, `*.psd`, `*.blend`, `*.glb`, `*.pdf`, `*.bin`, etc.)
- Any individual file **`>= 10 MB`** anywhere in `cdn/` (automatically added to `.gitattributes` by `pnpm hdn add` / `pnpm hdn sync` / GitHub Actions)

If setting up on a fresh Windows machine:
```powershell
scoop install git-lfs
git lfs install
git lfs install --local
```
