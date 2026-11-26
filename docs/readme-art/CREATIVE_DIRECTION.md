# Project AXIOM — Creative direction

**Brief:** make the Formspear README feel like a digital exhibition about *information architecture*, not a form-builder landing page. Central idea: **Order from Complexity**. Every animation shows a transformation — fragments → structure, input → organised information, rule → reorganised workflow.

## Repository intelligence (source of truth)

What the artwork is allowed to say was taken from the repository, not from the brief.

| Topic | Verified in | Used as |
| :-- | :-- | :-- |
| 23 question types | `QUESTION_TYPES`, `src/server.js` | Component specimens (FIG. 02/05) |
| Rule actions `show_question · skip_to_question · assign_tag · trigger_alert · set_hidden_field · calculate_score · end_survey · redirect` | `normalizeLogic`, `src/server.js` | Logic Machine (FIG. 04) |
| Publish validation: ≥2 options for choice questions, skip must point forward, circular paths blocked | `validateSurveyForPublish`, `src/server.js` | Precision (FIG. 06) |
| `validateAnswers` runs on public submit | `src/server.js` | Information Becomes Structure (FIG. 05) |
| Integrations: webhooks (HMAC-SHA256), Slack, Teams, WhatsApp, SMTP, Stripe, Razorpay, OpenAI, S3-compatible storage | `src/server.js`, `src/security.js` | Connected by Design (FIG. 09) |
| Layers: `public/`, `src/server.js`, `src/routes/*`, `src/lib/*`, `migrations/`, optional Redis/BullMQ | tree + `docs/ARCHITECTURE.md` | Engineering (FIG. 08) |
| MIT license | `LICENSE` | Open by Design (FIG. 10) |
| Railway config, Procfile, health check `/api/health`, `numReplicas: 1`; production requires PostgreSQL; **no Dockerfile** | `railway.json`, `Procfile`, `docs/ARCHITECTURE.md` | Deployment (FIG. 12) |
| 0 stars, 0 forks, 1 contributor, 0 releases/tags, first commit 2026-06-28 | GitHub API snapshot | Living Lattice (FIG. 11) |
| Real UI | `assets/readme/*.png` from the visual smoke pipeline | Form Architect, Information, Workflow |

**Corrections made to the previous README** (it contained claims the repository does not support): `src/repos/` does not exist; `<1.2 ms` ingestion, `<12 ms` alert routing and `191 ms` 100k pagination are not in any benchmark document (the documented figures are p95 ≈ 75–112 ms for 100 concurrent submissions and a 102 ms 100,000-row page in JSON mode; the 100,000 row in `docs/CAPACITY_BENCHMARK.md` reads *NOT RUN*); "13 optimised indexes" (the migration has 47 `CREATE INDEX` statements); "Docker deployment" (no Dockerfile); publishing a demo password. The new README states only what could be traced.

## Three concepts considered

1. **The Surveyor's Table** — a drafting-table scene: paper plans, rulers, a form drawn then built. Rejected: skeuomorphic and rear-looking; says "documents", not "systems".
2. **The Tessellation** — a flat, infinitely tiling pattern that resolves region by region. Rejected: beautiful but 2D; cannot carry depth, camera or the "architecture" metaphor.
3. **The Parametric Exhibition** *(chosen)* — modules as architecture. One shared geometry language (boxes, prisms, rings, lines) lit by a single key light, built from the product's own parts. Depth, camera and assembly are first-class, and every chapter is the same idea at a different scale (a form, a rule, a record, a repository).

## Influences (studied as principles, not reproduced)

Bauhaus and Swiss modernism (grid, asymmetry, mono + condensed sans); computational and parametric architecture (twisted, blade-clad towers; modular construction); generative art (rule-based variation with integer-periodic motion so loops are seamless); exhibition catalogue graphics (figure numbers, registration ticks, captions). Studio work from FIELD, Universal Everything, ManvsMachine, FutureDeluxe, BUCK and Zaha Hadid Architects informed the *standards* — controlled lighting, procedural rather than random motion, negative space — but no artwork, composition or asset from any of them is used.

## Production approach

A deterministic 3D rasteriser on Canvas 2D (`tools/readme-art/engine/`) replaces hand-keyframed SVG: perspective camera, convex-polyhedron faces, directional + fill lighting, depth fog, projected shadows, textured planes for real screenshots, 3D splines and glow. Each scene is a pure function of time. Headless Chrome captures frames; ffmpeg encodes animated WebP. The one SVG piece (the Living Lattice) is SVG because it must regenerate in CI with no browser.

Not used, and why: Blender and Three.js are not installed in this environment and would add heavy toolchains to a repository README; Remotion/Manim/Motion Canvas were not needed because the engine already renders video-grade frames from code.
