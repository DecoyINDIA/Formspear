# Visual design system — "Axiom"

## Colour (README-specific; the application keeps its own UI palette)

| Token | Hex | Source |
| :-- | :-- | :-- |
| Ground | `#08110F` | `assets/readme/brand-identity.svg` background |
| Grid | `#16382E` | brand SVG |
| Emerald ramp | `#ECFDF5 #6EE7B7 #34D399 #10B981 #059669 #047857 #022C22` | brand SVG blade gradients |
| Sky | `#38BDF8` | brand SVG orbit |
| Amber | `#F59E0B` | brand SVG telemetry dot — used only for *attention* (rejection, trigger, new module) |
| App green | `#176B5B` | application UI brand colour (screenshots) |
| Ceramic bone / bone-2 | `#E8E2D4` / `#CFC8B8` | README-specific material colours |
| Steel / steel-2 | `#2A3A35` / `#3C4F49` | README-specific |

The emblem polygons (outline, left facet, right facet, spine) are copied verbatim from the brand SVG (`FS.EMBLEM`). The logo was not redrawn or recoloured.

## Materials

Matte ceramic (bone) for structure; emerald for the thing that matters now; brushed steel for infrastructure; translucent sky glass for "not yet real" (specimens in flight); amber only as signal. One key light from upper-left, a weaker fill from lower-right, a fresnel rim, depth fog toward the ground colour, soft projected shadows on a fine technical grid floor.

## Typography

Bahnschrift (DIN-style, condensed weights) for display; Cascadia Mono / Consolas for annotation. All type is rasterised into the frames, so there is no runtime font dependency. Catalogue furniture on every figure: `FIG. NN — TITLE` top-left, timecode top-right, scene caption bottom-left, progress hairline bottom-right, corner registration ticks.

## Composition

Large asymmetric emblem/typography splits (hero), centred monumental symmetry (closing), exploded isometric stacks (engineering), a 3×2 specimen exhibition grid (components), photographic planes in depth (workflow). Negative space is a material: scenes rest on dark ground rather than filling the frame.

## Motion language

Purposeful, never bouncy. See [MOTION_TIMING.md](MOTION_TIMING.md).

- **Magnetic assembly** — ease-in-out travel with a short *anticipation* pull-back and a damped *settle* on arrival.
- **Constraint snapping** — position and rotation lerp to grid values; a measurement line confirms.
- **Staggered construction** — groups move at different speeds; a per-module delay is derived from structure (floor index, distance, type).
- **Secondary motion** — lift arcs during travel, small wobble in rotation, arrival ripples.
- **Procedural variation** — orbits use integer harmonics of the loop period, so frame(T) equals frame(0) and every loop is seamless.
- **Camera** — slow dolly/orbit, never handheld; pitch changes explain depth.

## Accessibility

Every `<img>` has descriptive alt text; each animation has a static `prefers-reduced-motion` alternative (`assets/readme/art/static/*.webp`) wired through `<picture>`; the Living Lattice SVG has `<title>`/`<desc>` and an adjacent Markdown table with the exact numbers; the SVG disables its animation under `prefers-reduced-motion`.
