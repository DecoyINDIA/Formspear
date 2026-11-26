# readme-art

Reproducible source for the README exhibition. Everything is generated from code; nothing is hand-exported.

```text
engine/engine.js   Canvas-2D pseudo-3D renderer: camera, lit convex polyhedra, fog, shadows, textured planes, splines
engine/kit.js      Shared geometry (the 23 verified question types as specimens), annotations, backdrop helpers
scenes/*.js        One pure function of time per animation (see _loader.js for the manifest)
stage.html         Headless stage that hosts a scene and exposes renderAt(t)
render.mjs         Frame capture (headless Chrome) -> ffmpeg -> animated WebP + static poster
lattice/generate.mjs  Node-only SVG generator for the Living Lattice (runs in CI every 6 h)
verify.mjs         Asset existence, alt text, animated-WebP and byte-budget gate for README.md
shot.mjs           Screenshot any SVG/HTML with headless Chrome (used to review the lattice)
```

## Reproduce

Requirements: Node ≥ 20, ffmpeg with libwebp, a Chromium-family browser (set `BROWSER_PATH` if it is not in a standard location).

```bash
cd tools/readme-art && npm install
node render.mjs                      # all scenes -> assets/readme/art/*.webp (+ static/*.webp posters)
node render.mjs hero --preview 2,6,11.5   # PNG previews in out/preview (no encode)
node render.mjs hero --q 30 --fps 20 --width 880   # tune delivery size
node render.mjs --sheet 6            # storyboard contact sheets -> docs/readme-art/storyboards
node lattice/generate.mjs            # Living Lattice from the GitHub API (uses GITHUB_TOKEN if set)
node verify.mjs                      # README compatibility + budget gate
```

Rendering is deterministic: the same scene code and engine produce the same frames. Orbit harmonics are integer multiples of the loop period, so every animation loops without a seam.

## Add a scene

Create `scenes/<id>.js` calling `registerScene('<id>', { w, h, fps, dur, poster, assets?, draw(ctx, t, S) })`, add `'<id>'` to `scenes/_loader.js`, preview with `--preview`, then render. Scenes may only depict things the repository really contains; mark illustrative content on the frame.
