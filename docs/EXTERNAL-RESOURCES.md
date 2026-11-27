# External resources — what FuelPro ships that it did not write

Rule (owner, 2026-11-27): a resource from outside is pinned to an exact version, recorded here with the reason, and must keep working offline.
FuelPro copies such files **into the repository** (`public/`) instead of loading them from a CDN at run time: nothing leaves the
station's browser, the PWA cache holds them after the first visit, and the pinned copy cannot change under us (so no SRI is needed
for them). If a CDN is ever used at run time, it must be an exact version with an `integrity` (SRI) attribute and be listed here.

| File(s) | What | Source (pinned) | Licence | Why |
|---|---|---|---|---|
| `public/fonts/ibm-plex-sans-arabic-{arabic,latin}-{400,500,600,700}-normal.woff2` | IBM Plex Sans Arabic, 4 weights, Arabic + Latin subsets (~257 KB) | npm `@fontsource/ibm-plex-sans-arabic@5.3.0` | SIL OFL 1.1 (`public/fonts/LICENSE-ibm-plex-sans-arabic.txt`) | 0.30 UI: text and figures — a formal corporate face, clear at small sizes, tabular figures for tables |
| `public/fonts/noto-kufi-arabic-{arabic,latin}-wght-normal.woff2` | Noto Kufi Arabic, variable weight (~154 KB) | npm `@fontsource-variable/noto-kufi-arabic@5.3.0` | SIL OFL 1.1 (`public/fonts/LICENSE-noto-kufi-arabic.txt`) | 0.30 UI: page titles, brand, dialog titles — the owner asked for a formal face |

Checksums (sha256, first 16 hex) are in the PR that added them; re-download with `npm pack <package>@<version>` to compare.
Printing still uses `Dubai` first (Windows), unchanged. The Artifact edition cannot load font files (its page only allows Google Fonts),
so it falls back to the system font there.
