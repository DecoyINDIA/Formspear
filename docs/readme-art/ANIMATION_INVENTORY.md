# Animation inventory

All assets live in `assets/readme/art/` (static posters in `static/`). Sizes are as delivered. Every scene is a reproducible source in `tools/readme-art/scenes/` (see [its README](../../tools/readme-art/README.md)). Level = target sophistication from the brief.

| Fig | Scene id | Level | Length | Frames | Size | Real product material used | Illustrative content (labelled) |
| :-- | :-- | :-: | --: | :-: | --: | :-- | :-- |
| 01 | `hero` | 5 | 9.0 s loop | 216 @ 24 fps | 7.5 MB | Emblem polygons (brand SVG), brand palette | — |
| 04 | `form-architect` | 5 | 12 s | 288 @ 24 fps | 4.6 MB | 9 real question types; real builder screenshot | — |
| 05 | `components` | 4 | 14 s seamless loop | 336 @ 24 fps | 4.2 MB | 7 of the 23 real question types; full `QUESTION_TYPES` index | sample text "Ada Lovelace" |
| 06 | `logic-machine` | 5 | 12 s | 288 @ 24 fps | 4.1 MB | Real rule actions + real refusal message | score thresholds |
| 07 | `information-structure` | 5 | 12 s | 288 @ 24 fps | 4.2 MB | Real mobile survey + real dashboard screenshots; `validateAnswers` stage | stream volume |
| 08 | `precision` | 4 | 12 s | 288 @ 24 fps | 4.5 MB | 4 real validation rules | deviation readout |
| 09 | `workflow-continuum` | 4 | 12 s | 288 @ 24 fps | 3.1 MB | Dashboard's own 4-step path; `/s/` public route | response values |
| 10 | `engineering` | 4 | 12 s | 288 @ 24 fps | 4.6 MB | Real files/directories/boundaries | request path |
| 11 | `integrations` | 4 | 12 s | 288 @ 24 fps | 5.0 MB | 9 integrations present in `src/server.js` | event timing |
| 12 | `open-by-design` | 4 | 12 s | 288 @ 24 fps | 3.3 MB | Real top-level directories; MIT text | — |
| 13 | `living-lattice` (SVG) | 5 | looped CSS | — | 15 KB | Official GitHub API metrics, regenerated every 6 h | — |
| 14 | `deployment` | 4 | 12 s | 288 @ 24 fps | 4.6 MB | Documented commands and config only | — |
| 17 | `perfect-structure` | 5 | 13 s | 312 @ 24 fps | 4.8 MB | Emblem, specimens, record slabs; colophon of 4 verified facts | — |

**Count:** 12 rendered animations + 1 data-driven SVG = 13 compositions; Level 5 ×6 (including the lattice), Level 4 ×7. Total referenced weight ≈ 57 MB (budget gate: `node tools/readme-art/verify.mjs`).

**Not produced (by design):** *Release evolution* — the repository has no releases or tags, so the chapter is text only and says so. A Docker deployment animation — no Dockerfile exists.

**Static alternatives:** `assets/readme/art/static/<id>.webp` for every rendered animation, delivered through `<picture>` with a `prefers-reduced-motion` source. The Living Lattice has a Markdown table of exact values beside it and disables its own animation under reduced motion.

**Storyboards:** [`storyboards/`](storyboards) — six evenly spaced frames per scene.
