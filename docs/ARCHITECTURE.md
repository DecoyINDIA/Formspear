# Formspear Architecture

## Runtime boundaries

- `src/server.js`: composition root, shared domain behavior, persistence adapter, and legacy routes awaiting extraction.
- `src/production-config.js`: fail-closed production environment contract.
- `src/security.js`: encryption, password verification, token hashing, webhook masking, signatures, and browser security headers.
- `src/routes/ai-summary.js`: latest/generated AI insight HTTP behavior.
- `src/routes/analytics.js`: filtered and comparative survey analytics HTTP behavior.
- `src/routes/responses.js`: response list/detail/update/delete/PDF behavior.
- `src/routes/billing.js`: billing overview, invoice, checkout, portal, and failure behavior.
- `src/routes/admin-readiness.js`: protected production-readiness HTTP behavior.
- `src/routes/auth-credentials.js`: rate-limited password-reset and email-verification request/confirmation behavior.
- `public/builder-history.js`: bounded, independently tested builder undo/redo state.
- `public/app.js`: current authenticated/public SPA composition root.

## Route extraction convention

Extracted route modules receive one explicit context object containing the request, response, scoped records, and domain functions they are allowed to call. They return `true` when a nested route was handled, allowing `src/server.js` to compose modules without global mutable imports or a framework rewrite.

New route behavior belongs in a focused module. Existing auth, survey lifecycle, export, integration, and admin-management blocks should move incrementally behind the green HTTP suite; avoid a big-bang rewrite.

## Persistence

Development may use the atomic JSON store. Production startup requires PostgreSQL and Redis. PostgreSQL relational tables are authoritative in production; the development compatibility snapshot is disabled and removed. The web process schedules/enqueues durable jobs and the dedicated worker consumes BullMQ jobs.

## Verification boundary

- Focused unit tests cover extracted pure modules.
- `tests/server.test.js` covers cross-module HTTP behavior and permissions.
- PostgreSQL, Redis worker, performance, backup, and browser smokes cover runtime boundaries.
- `.github/workflows/ci.yml` runs these gates for every pull request and main-branch push.
