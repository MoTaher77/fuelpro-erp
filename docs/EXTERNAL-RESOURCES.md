# External resources — what FuelPro ships that it did not write

Rule (owner, 2026-11-27): anything from outside is pinned to an exact version, recorded here with the reason, and must work offline.
FuelPro copies such files **into the repository** (`public/`) instead of loading them from a CDN at run time: nothing leaves the
station's browser, the service worker caches them after the first visit, and a pinned copy cannot change under us (so SRI is not
needed for them). A run-time CDN file, if ever used, must carry an exact version and an `integrity` (SRI) attribute and be listed here.

| File(s) in `public/fonts/` | Face | Source (pinned) | Size | Licence | Why |
|---|---|---|---|---|---|
| `ibm-plex-sans-arabic-arabic-400-normal.woff2`, `…-latin-400-normal.woff2` | IBM Plex Sans Arabic Regular | npm `@fontsource/ibm-plex-sans-arabic@5.3.0` | 42.8 + 19.2 KB | SIL OFL 1.1 (`LICENSE-ibm-plex-sans-arabic.txt`) | printed text and figures: clearest of Plex / Noto Naskh / Cairo / Noto Sans Arabic in the side-by-side table test, tabular figures |
| `ibm-plex-sans-arabic-arabic-600-normal.woff2`, `…-latin-600-normal.woff2` | IBM Plex Sans Arabic SemiBold | same | 45.7 + 20.5 KB | same | headings of columns, totals |
| `noto-naskh-arabic-arabic-700-normal.woff2`, `…-latin-700-normal.woff2` | Noto Naskh Arabic Bold | npm `@fontsource/noto-naskh-arabic@5.3.0` | 53.0 + 12.0 KB | SIL OFL 1.1 (`LICENSE-noto-naskh-arabic.txt`) | document titles and the organisation's name: a formal Naskh, more legible than Amiri at title sizes |

Total added: **193 KB** (woff2). sha256 (first 16 hex): Plex 400 ar `6010e7fd0dce5d52`, lat `9ed8dcb02e6c7246`; Plex 600 ar `16734a5adb27b0f3`, lat `63f4757271e403f7`; Naskh 700 ar `d2d8e6b155248d67`, lat `f493b218ed5b638e`. Re-download with `npm pack <package>@<version>` to compare.
The screens keep their own fonts (Dubai first); these faces are used by printed documents (`public/print.css`). The Artifact edition cannot load font files (its page allows Google Fonts only), so its printouts fall back to the system font.
