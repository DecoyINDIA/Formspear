# Formspear Project Handoff

## Session Summary

In this session, we completed the full implementation and verification of the remediation plan outlined in `docs/REVIEW_REMEDIATION_PLAN.md`.

## Key Implementations

1. **Row-Level Postgres Diff-on-Save & Fewer Read-Path Saves (ITEM-1)**:
   - Added `pgShadow` tracking on `state`.
   - Refactored `savePostgresRelationalCollections` to only emit row-level updates/deletes/inserts based on in-memory diffs against `state.pgShadow`.
   - Throttled view counts persistence to once every 10 seconds.
   - Removed all `saveDb(state)` writes on read-only (GET) API routes.
   - Added `tests/postgres-diff.test.js` to prevent truncate/rewrite regressions.

2. **Single-Writer Advisory Lock writer protection (ITEM-2)**:
   - Added Postgres advisory lock checks in `ensurePostgresRuntime`.
   - Set replicas limits in `railway.json`, `Procfile`, and updated architectural documentation in `README.md`, `docs/DEPLOYMENT.md`, and `docs/OPERATIONS_RUNBOOK.md`.

3. **Secure Cookie in Production (ITEM-3)**:
   - Added `Secure` flag condition to session cookies when `NODE_ENV === 'production'`.

4. **File-Upload Size Validation (ITEM-4)**:
   - Checked and stored exact decoded length from `dataUrl` payload instead of relying on client-supplied size declarations.

5. **CSV Formula-Injection Neutralization (ITEM-5)**:
   - Neutralized formula characters (`=`, `+`, `-`, `@`, `\t`, `\r`) in string exports by prepending a single quote `'`.

6. **Bounded Rate-Limit Maps (ITEM-6)**:
   - Scheduled periodic sweeps (every 5 minutes) of expired rate limits in `publicBuckets`, `authBuckets`, and `apiBuckets`.

7. **SSRF Outbound Guardrails (ITEM-7)**:
   - Added IP/DNS-resolved validation in `isSafeOutboundUrl` to protect webhook and integration endpoints.

8. **Hygiene Improvements (ITEM-8)**:
   - Added 300s timing signature checks for Stripe billing webhooks.
   - Hardened `routeRequest` static asset path-traversal check to strictly validate directories borders:
     `target !== resolvedPublicDir && !target.startsWith(resolvedPublicDir + path.sep)`.
   - Documented future SAML migration recommendation.
   - Created `LICENSE` file.

## Running Tests

Verify all gates and unit/integration tests remain passing:
```bash
npm run check
npm test
```
*(All 10/10 tests pass successfully).*
