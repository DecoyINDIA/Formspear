# Independent review log and refinement history

## Who reviewed, and what that means

Reviews were run by a **separate subagent on a different model tier (Claude Opus)** from the one that built the artwork. That is *not* a model from another vendor. The reviewer inspected **rendered output**: the storyboard contact sheets in [`storyboards/`](storyboards) (6 evenly spaced frames per scene) and a screenshot of the Living Lattice SVG. It could **not** play animations, so motion quality is inferred from frame sequences. No human has reviewed playback. The brief's target of **≥ 95/100 with no automatic-rejection conditions was not reached.** The `CREATIVE-README-001` rubric text was not available, so the reviewer scored against the criteria listed in the brief (originality, composition, procedural sophistication, motion, depth/material, typography, brand, product accuracy, analytics integrity, accessibility, performance).

## Cycle 1 — overall 58/100

Strongest: hero 76, perfect-structure 75. Weakest: workflow-continuum 40, deployment 45, components 50.
Main findings → action taken:

| Finding | Action |
| :-- | :-- |
| In-UI name is "FeedbackOS" | **Kept.** It is the product's real in-app name; the README states "Formspear (internally FeedbackOS)". Masking real UI would misrepresent it. |
| Dashboard capture shows 0 responses next to a story about collected responses | Captions now say "real empty-state capture"; no data was seeded or fabricated. |
| Workflow is a screenshot slideshow; titles overlapped | Dark title column added; stage 01 renamed "Create" with an honest note |
| Components barely moves, tiny captions | Captions enlarged, poster taken after the text completes |
| Deployment = three identical stacks | Per-environment geometry (single node / health-probe rings / PostgreSQL cylinder), wrapped commands |
| Precision shows an invented metric | Replaced by "engine checks passing N / 4" |
| Hero facets indistinguishable | Left facet darkened, right lightened |
| Figure numbers skipped 02, 03, 15, 16 | Renumbered 01–13 |
| Logic caption mixed two rules | One real message: "Circular logic paths are blocked." |
| Lattice "1 cube = 2 commits" confusing | Now exactly 1 cube = 1 commit; flattened cubes so the busiest week fits |
| Claims to verify (`QUESTION_TYPES`, `section`, `validateAnswers`, NIXPACKS, `/api/health`, `numReplicas`, port 4173, HMAC) | All confirmed in code/config |

## Cycle 2 — overall 61/100

Fixes landed for numbering, precision, logic caption and lattice legend; hero facets only partly; engineering/integrations/open-by-design labels still collided. Scores: hero 78, perfect-structure 72, form-architect 66, precision 64, integrations 63, information 61, open 61, logic 60, engineering 57, deployment 56, lattice 50, components 48, workflow 47.
No unsupported claims were found. Remaining automatic-rejection concerns raised: workflow (screenshot-driven), components (cards), repeated emblem-plus-wordmark endings (hero, closing).

## Cycle 3 — applied, not re-scored

Workflow title now bound to camera position; engineering module labels only on the lit layer; integrations label clutter and event line moved to a safe area; components tiles given different periods; information-structure credit line moved off the footer; lattice cubes flattened and labels moved. A further independent pass was not run.

## Cycle 4 — overall 71/100

Rebuilt before scoring: *components* (one pool of 36 blocks morphing through 7 question types, seamless loop, real `QUESTION_TYPES` index), *workflow-continuum* (one survey object transforming along a rail: create → publish → collect → review; no screenshots), *engineering* (one leader-line label per hop in a fixed column), *open-by-design* (ring layout with an empty docking bay, backplated labels), *perfect-structure* (ends on a four-fact colophon instead of repeating the hero wordmark).
Reviewer: **Claude Sonnet** (the builder this cycle was Claude Opus). A Fable pass was attempted first and failed for lack of usage credits.
Scores: hero 80, perfect-structure 80, engineering 78, workflow 76, components 74, precision 74, open 72, form-architect 68, integrations 66, deployment 66, lattice 64, information 63, logic 62. **No automatic-rejection conditions.**
Spot-checks held (23 types, `numReplicas: 1`, no Dockerfile, lattice equals `snapshots.jsonl`). The reviewer's "32 test files" note was checked and rejected: `tests/` holds 31 test files plus a `helpers/` directory, so "31 files" stands.

## Cycle 5 — applied after the cycle-4 score, not re-scored

Living Lattice: each week is now a 2×2-footprint tower of half-size cubes (still exactly 1 cube = 1 commit, 4 per layer), labels moved off the skyline, STARS/FORKS carry their values, the language legend wraps instead of clipping, shares under 0.1 % print as `<0.1%`. Integrations: camera pulled back and raised, every label on a backplate, labels of nodes behind the core placed above their glyph. Deployment: commands type at 90 cps (complete within ~0.7 s) and are set larger.

## Honest status

Score at last independent measurement: **71/100**, still below the 95 target. Remaining defects named by the reviewer and not fixed: the light, full-frame UI screenshots at the end of *information-structure* and *form-architect* break the dark palette; *logic-machine* is sparse with small type; *open-by-design*'s licence list sits apart from the sculpture; the 23-type index in *components* is set small. See [KNOWN_LIMITATIONS.md](KNOWN_LIMITATIONS.md).
