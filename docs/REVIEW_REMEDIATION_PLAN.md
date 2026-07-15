# Formspear — Review Remediation Plan

Implementation plan for the findings from the end-to-end review. Written to be executed by an autonomous coding agent with **no access to the review conversation**. Everything needed is here.

**Target repo:** this repository. Primary file under change: `src/server.js` (~11,300 lines, CommonJS, zero-framework Node HTTP server). Helpers in `src/security.js`. Tests in `tests/*.test.js`.

---

## 0. Ground rules (read before touching anything)

1. **Do not break the test suite.** Run `npm test` after every work item. All 9 tests must stay green. The heavy one (`FeedbackOS core MVP and V1 loops work over HTTP`) exercises the real request loop — treat it as the regression gate.
2. **Syntax gate:** `npm run check` (`node --check src/server.js`) must pass. Also `npm run migrations:check`.
3. **Two persistence modes coexist and both must keep working:**
   - **JSON mode (default, local-first):** whole DB is one in-memory object serialized to a JSON file. Chosen when no `DATABASE_URL`.
   - **Postgres mode:** chosen when `DATABASE_URL` is set. See §Appendix A for how it currently works.
   Never make a change that only works in one mode unless the item explicitly scopes to one.
4. **Style:** match surrounding code. No new runtime dependencies unless an item says so (current deps: `bullmq`, `pg`, `write-excel-file` only). No TypeScript. `require`, not `import`.
5. **One work item = one focused commit.** Commit message references the item ID (e.g. `fix(persistence): row-level Postgres writes [ITEM-1]`). Do not squash unrelated items.
6. **Order matters.** Implement in the sequence below. ITEM-1 and ITEM-2 are the same subsystem and share a commit boundary; do them together. Items 3–7 are independent and can be done in any order after that.
7. After each item, update the checkbox in §Progress at the bottom.

---

## ITEM-1 — Stop rewriting the entire database on every save (CRITICAL, throughput)

### Problem
In Postgres mode, `savePostgresRelationalCollections` (`src/server.js` ~line 4058) runs `DELETE FROM <table>` for **every** relational table, then re-`INSERT`s **every row** — on **every** `saveDb()` call. `saveDb()` is invoked ~100 times across the codebase, including on read-ish paths: a public survey view increments `survey.metrics.views` then saves (`src/server.js` ~2918), and read-only API-v1 GETs save just to stamp `apiKey.lastUsedAt` (~2478). At any real data volume this is O(total rows) writes per request with full-table lock contention.

### Fix strategy — diff-on-save (contained blast radius)
Do **not** try to instrument the ~100 mutation sites. Instead, localize the change to the save function:

Keep a per-process **shadow snapshot** of what was last written to each relational collection, keyed by row `id`. On save, diff the current in-memory collection against the shadow and emit only:
- `INSERT … ON CONFLICT (id) DO UPDATE SET …` for new/changed rows,
- `DELETE FROM <table> WHERE id = $1` for ids present in the shadow but gone from memory.

Then replace the shadow with a deep copy of what was just persisted.

### Steps
1. Add a shadow store on `state`. In `createServer` (`src/server.js` ~356) initialize `pgShadow: null` alongside the other `state` fields.
2. Rewrite `savePostgresRelationalCollections(client, db, state)` (add the `state` param; update its single caller in `savePostgresDb` ~3289 to pass `state`). New algorithm, per collection config in `POSTGRES_RELATIONAL_COLLECTIONS`:
   - Build `currentById = new Map(rows.map(r => [r.id, prepared row]))` where "prepared row" applies `config.prepare` if present (mirror existing logic at ~4064).
   - `shadowById = state.pgShadow?.[config.collection] ?? new Map()` (empty on first save after boot → everything inserts, which is correct).
   - For each `[id, row]` in `currentById`: if not in shadow, or serialized column values differ from shadow, emit upsert. Compare by the `{columns, values}` produced by `postgresObjectToRow` (JSON-stringify the values array for the equality check).
   - For each `id` in shadow not in `currentById`: emit `DELETE FROM <table> WHERE id = $1`.
   - Build the upsert SQL as `INSERT INTO <table> (<cols>) VALUES (<$n>) ON CONFLICT (id) DO UPDATE SET <col = EXCLUDED.col for every non-id col>`.
3. **First-save safety / cold instance:** on the very first save of a process (`state.pgShadow === null`), the shadow is empty so all rows insert via `ON CONFLICT DO UPDATE` — safe and idempotent against rows another process wrote. Do **not** truncate.
4. After a successful `COMMIT` in `savePostgresDb`, set `state.pgShadow` to a fresh map-of-maps reflecting exactly what was persisted (the `currentById` maps you built). Build this **before** releasing the client but assign **after** commit succeeds, so a rolled-back transaction doesn't poison the shadow.
5. Also refresh the shadow after `loadPostgresRelationalCollections` (~4044) so a freshly loaded DB doesn't re-write every row on its first save. Populate `state.pgShadow` from the rows just read.
6. Delete the old truncate loop (the `[...POSTGRES_RELATIONAL_COLLECTIONS].reverse()` + `DELETE FROM` block).

### Reduce save frequency on read paths
7. Public survey view (`src/server.js` ~2918): the `survey.metrics.views += 1; await saveDb(state)` on every GET is a write on a read. Change to a **throttled/best-effort** save: increment in memory always, but only call `saveDb` at most once per N seconds per process (a simple `Map<surveyId, lastSavedMs>` gate), or move view-count persistence into the existing job/batch cycle. Never block the response on it — fire-and-forget is acceptable for a view counter.
8. API-v1 `lastUsedAt` stamps (~2478 and each read branch that calls `await saveDb`): stamp `apiKey.lastUsedAt` in memory but **remove the `await saveDb(state)` from read-only (GET) branches**. Let the value flush on the next real mutation or a periodic flush. Keep saves on write branches (POST/PUT/DELETE).

### Gotchas
- The `id` column is the primary key for every relational collection (see configs at ~3326). Confirm each table in `migrations/0001_initial_postgres.sql` has `id` as PRIMARY KEY or UNIQUE — `ON CONFLICT (id)` requires it. If any table lacks it, that's a migration bug to fix in the same item.
- `config.prepare` (e.g. `postgresPrepareMonthlyReport`, `postgresPrepareWebhook`) transforms the object before column mapping — always diff/insert the **prepared** form.
- Collections with FK relationships must still insert parents before children. Preserve the array order of `POSTGRES_RELATIONAL_COLLECTIONS` for inserts; do deletes in reverse order.

### Acceptance criteria
- `npm test` green; `npm run check` + `npm run migrations:check` pass.
- `npm run postgres:relational:smoke` passes (spins up disposable Postgres via Docker; this is the real proof). If Docker is unavailable in the agent environment, state that explicitly and rely on unit coverage + the new test below.
- **New test** (`tests/persistence.test.js`): with a mocked/fake pg client that records queries, assert that saving after mutating a single row of a many-row collection emits exactly one upsert and zero `DELETE FROM <table>` (no full-table statements). This is the finding's regression guard.

---

## ITEM-2 — Prevent multi-instance data clobber (CRITICAL, correctness)

### Problem
`getDb` (~3197) loads the DB into `state.db` once and treats that in-memory snapshot as authoritative for the process lifetime; saves overwrite Postgres from it. With two app instances (the advertised horizontal-scaling / Railway posture), each holds an independent stale snapshot and the last writer wins over the **entire dataset** → silent data loss. ITEM-1's diff-on-save reduces the write volume but does **not** fix this: two processes still diff against their own shadows and overwrite each other's rows.

### Decision: near-term correctness now, deeper fix documented
A correct multi-writer design means abandoning the global in-memory-authoritative snapshot in favor of per-request row reads — a large refactor out of scope for this pass. Ship a **safe, enforced single-writer** posture now and document the path to multi-writer.

### Steps (near-term, required)
1. **Enforce single instance in deploy config.** In `railway.json` set replicas to 1 (add/confirm `"deploy": { "numReplicas": 1 }` or the equivalent current schema key). In `Procfile`, ensure only one `web` process. Add a comment pointing at this document.
2. **Add a Postgres advisory-lock writer guard.** On Postgres-mode boot (in `ensurePostgresRuntime` or right after first `getDb`), attempt `pg_try_advisory_lock(<constant bigint key>)` on a dedicated long-lived connection. 
   - If acquired: this process is the writer. Proceed normally.
   - If **not** acquired: another writer exists. Fail fast and loud — log a fatal error `"Another Formspear writer instance holds the DB advisory lock; refusing to start a second writer (see docs/REVIEW_REMEDIATION_PLAN.md ITEM-2)."` and exit non-zero. This converts silent data loss into a visible, safe startup failure.
   - Release the lock on `server 'close'` (the existing close handler ~403).
3. **Document the constraint** in `docs/DEPLOYMENT.md` and `docs/OPERATIONS_RUNBOOK.md`: "Formspear currently runs a single writer instance. Do not scale `web` replicas above 1 until the row-level persistence refactor (ITEM-8 / future) lands. Horizontal read-replica scaling is not yet supported."
4. **Correct the README claim.** In `README.md`, the multi-tenant/Railway/scaling language currently implies horizontal scaling. Add an explicit note that production is single-writer today.

### Longer-term (document only, do NOT implement in this pass)
Add a section to this file (§Appendix B) sketching the row-level persistence refactor: drop `state.db` as global authority; load entities per request or via a short-TTL cache with row `updated_at` optimistic concurrency; make each handler read-modify-write the specific rows it touches inside a transaction. Flag as a separate epic.

### Acceptance criteria
- Booting a second process against the same `DATABASE_URL` exits non-zero with the advisory-lock message (manually verifiable; add a note in the runbook on how to test).
- `railway.json` and `Procfile` pin a single web instance.
- `npm test` green (advisory lock must be a no-op in JSON mode and in tests — guard it behind `state.databaseUrl` being set).

---

## ITEM-3 — Set `Secure` on the session cookie (HIGH)

### Problem
`setSessionCookie` (`src/server.js` ~11097) emits `HttpOnly; SameSite=Lax` but no `Secure`. Over production TLS an accidental plaintext request leaks the session id.

### Steps
1. In `setSessionCookie`, append `'Secure'` to the cookie parts when running in production. Detection: `process.env.NODE_ENV === 'production'` (matches how the rest of the codebase gates prod behavior, e.g. `handleSsoDevLogin` ~980).
2. Consider always-on `Secure` except when an explicit `INSECURE_COOKIES=true` escape hatch is set for local HTTP testing — but default to secure in production. Keep `SameSite=Lax` and `HttpOnly`.
3. Do the same for the logout cookie clear (~523) if it goes through a separate path — it reuses `setSessionCookie`, so one change covers it.

### Acceptance criteria
- With `NODE_ENV=production`, the `set-cookie` header for login contains `Secure`. Add a unit test asserting this (the security test file `tests/security.test.js` is the natural home, or extend the HTTP test).
- Local dev (no `NODE_ENV`) still works over plain HTTP — cookie has no `Secure` so the browser still stores it.
- `npm test` green.

---

## ITEM-4 — Validate file size against the actual payload, not the client claim (HIGH)

### Problem
`validateFileAnswer` (~6272) and the stored `upload.size` (~8975 in `prepareFileUpload`) both trust `Number(file.size)` from the request body. A respondent can declare `size: 1` while sending a multi-MB `dataUrl`, bypassing the per-question `maxSizeMB` cap (up to the 8 MB body limit) and under-reporting storage usage (`storageBytes += upload.size`, ~8950).

### Steps
1. In `prepareFileUpload` (~8963), the code already decodes the payload: `const payload = decodeDataUrlBuffer(file.dataUrl || '')`. Set `size: payload.length` instead of `Number(file.size || 0)`. This makes stored size and the storage meter honest.
2. In `validateFileAnswer` (~6272), validate against the decoded length, not `file.size`. Since this runs before `prepareFileUpload`, decode there too: compute `const actualBytes = file.dataUrl ? decodeDataUrlBuffer(file.dataUrl).length : Number(file.size||0)` and check `actualBytes > maxBytes`. (Reuse the existing `decodeDataUrlBuffer` helper ~9310.) Keep the existing extension/type checks.
3. Reject a declared `file.size` that disagrees with the payload by more than a small tolerance (defense-in-depth / catches malformed clients): if `file.dataUrl` present and `Math.abs(actualBytes - Number(file.size||0))` is large, treat as invalid metadata. Optional but recommended.
4. Confirm `MAX_BODY_BYTES` (default 8 MB, ~36) still bounds total request size so decoding can't blow memory — it does; no change needed.

### Acceptance criteria
- A submission with `{size: 1, dataUrl: <payload larger than maxSizeMB>}` is rejected with the existing "exceeds N MB" error.
- Stored `upload.size` and `response.fileUploadBytes` reflect real bytes (add/extend a test around the file-upload path if one exists; otherwise a focused unit test on `validateFileAnswer`).
- `npm test` green.

---

## ITEM-5 — Neutralize CSV formula injection in exports (MEDIUM)

### Problem
`formatCsvValue` / `csvEscape` (~9672, ~9703) quote for `" , \n` but don't neutralize a leading `=`, `+`, `-`, or `@`. A survey answer like `=HYPERLINK(...)` becomes a live formula when the exported CSV is opened in Excel/Sheets. (XLSX export is already safe — `write-excel-file` emits string cells, not formulas.)

### Steps
1. In `csvEscape` (or a new `neutralizeCsvFormula` applied inside `buildCsv`'s value pipeline), if the string value's first character is one of `= + - @` (also guard Tab `\t` and CR `\r`), prefix the cell with a single quote `'` (Excel's "treat as text" convention) **or** prepend a Tab — the leading-apostrophe approach is standard and least surprising. Apply this before the existing quote-wrapping logic so the prefixed value still gets quoted if it contains delimiters.
2. Only apply to string-typed values (numbers/booleans are safe). Keep behavior identical for benign strings.
3. Do **not** change the XLSX path — verify `sanitizeXlsxCell` still just truncates; confirm `write-excel-file` writes these as inline strings (it does). No change there.

### Acceptance criteria
- Exporting a response whose answer is `=1+1` yields a CSV cell that Excel shows literally as `=1+1`, not `2`.
- Existing CSV structure/columns unchanged for normal data.
- Add a unit test on `buildCsv` (or `csvEscape`) covering a `=`-leading value.
- `npm test` green.

---

## ITEM-6 — Bound the in-memory rate-limit maps (MEDIUM)

### Problem
`publicBuckets` (keyed `slug:ip`), `authBuckets` (keyed `ip:email`), `apiBuckets` (keyed apiKey.id) — declared ~337 — are never pruned. Unique-key growth leaks memory indefinitely.

### Steps
1. Add periodic eviction of expired buckets. Simplest: in each `*RateAllowed` function, opportunistically sweep — but that's O(n) per call. Better: a single `setInterval` (unref'd, like the job timer ~398) that iterates the three maps every 5 minutes and deletes entries whose `resetAt < Date.now()`. Register it in `createServer`'s `listening` handler and clear it in the `close` handler.
2. Alternatively cap each map size (e.g. 50k entries) and drop the oldest/expired when exceeded. The interval sweep is cleaner; prefer it.
3. Note in a code comment that these limits are **per-process** and reset on restart — acceptable under the single-writer posture (ITEM-2), and the natural place to later swap in a shared store (Redis) if multi-instance lands.

### Acceptance criteria
- Buckets with `resetAt` in the past are removed within one sweep interval (unit-testable by invoking the sweep function directly with a controllable clock, or by asserting map size drops).
- Timer is `unref()`'d so it never keeps the process alive; cleared on server close (no open-handle leaks in tests — `npm test` must still exit cleanly).
- `npm test` green.

---

## ITEM-7 — SSRF guardrails on outbound webhooks/integrations (MEDIUM)

### Problem
`runWebhookJob` (~4395) and the integration delivery path (`deliverIntegrationPayload` ~4657 / `buildIntegrationRequest`) `fetch()` workspace-admin-supplied URLs with no block on internal/link-local destinations (`169.254.169.254`, `127.0.0.1`, `localhost`, private RFC-1918 ranges, IPv6 ULA/loopback). Admin-gated, but in a cloud host this reaches the metadata service and internal services.

### Steps
1. Add a helper `isSafeOutboundUrl(rawUrl)` (near `cleanUrl` ~11051): parse the URL; require `http:`/`https:`; resolve/inspect the hostname; reject if it is `localhost`, an IP in loopback/link-local/private ranges, `.internal`/`.local` suffixes, or a bare IP in those ranges. Use `node:dns` `lookup` to resolve hostnames and re-check the resolved IP (prevents DNS-rebinding of a benign-looking hostname to a private IP). Cache/timeout the lookup.
2. Enforce at **send time** (in `runWebhookJob` and `deliverIntegrationPayload`), not just at config time, because DNS can change after configuration. On rejection: mark the webhook/integration log with a clear error (`"destination blocked by SSRF policy"`) and do not fetch.
3. Also enforce at **config time** (where webhook/integration URLs are saved — search for `cleanUrl` usage in `handleIntegrations`/webhook create routes) to give admins immediate feedback, but treat send-time as the authoritative gate.
4. Provide an allowlist escape hatch for legitimate internal testing: env `WEBHOOK_ALLOW_PRIVATE_HOSTS=true` bypasses the check (default off). Document it.
5. Keep the existing 8s `AbortController` timeout.

### Acceptance criteria
- A webhook configured to `http://169.254.169.254/latest/meta-data/` is refused at send time and the delivery log records the block; no outbound request is made.
- Normal public HTTPS webhooks still deliver.
- Unit test on `isSafeOutboundUrl` covering: public host (allow), `127.0.0.1` (block), `169.254.169.254` (block), `10.x`/`192.168.x`/`172.16.x` (block), `localhost` (block), `.internal` (block).
- `npm test` green.

---

## ITEM-8 — Low / hygiene (batch into one commit)

Do these together; each is small.

1. **Stripe webhook replay window.** In `verifyBillingWebhookSignature` (~8547, Stripe branch), after signature match, reject if `|now - timestamp| > 300s`. Parse `timestamp` (unix seconds) from the `t=` field. Prevents replay of a captured valid webhook. (Effects are mostly idempotent, hence low, but cheap to fix.)
2. **Static-file guard trailing separator.** In `routeRequest` (~441), `target.startsWith(PUBLIC_DIR)` can match a sibling dir like `public-secret`. Change to `target === PUBLIC_DIR || target.startsWith(PUBLIC_DIR + path.sep)`.
3. **LICENSE.** Add a license file (the README notes none is declared). Pick per owner intent — if unknown, add a `LICENSE` placeholder and flag it in the PR description for the owner to choose; do not guess a permissive license silently.
4. **SAML library follow-up (document, do not implement).** Add a note in `docs/SECURITY_AND_PRIVACY.md`: the hand-rolled regex SAML parsing (`src/server.js` ~5444–5562) validates signature/InResponseTo/destination/recipient/issuer/audience/timebounds/subject and is sound as reviewed, but should be replaced with a vetted SAML library before certifying against a live IdP. File as a tracked task.

### Acceptance criteria
- `npm test` green; `npm run check` passes.
- Replay: a Stripe webhook with a `t=` timestamp older than 5 minutes is rejected as invalid signature/expired.

---

## Verification checklist (run after each item, and all at the end)

```powershell
npm.cmd run check
npm.cmd run migrations:check
npm.cmd test
```

Full gates before declaring done:

```powershell
npm.cmd run backup:smoke
npm.cmd run performance:budget
npm.cmd run performance:smoke
npm.cmd run postgres:relational:smoke   # requires Docker; the real proof for ITEM-1
npm.cmd run redis:worker:smoke
```

If any smoke needs a service the agent environment lacks (Docker, Redis), **say so explicitly** in the PR/summary rather than silently skipping — a skipped gate is not a passed gate.

---

## Appendix A — How Postgres persistence works today (context for ITEM-1/2)

- `getDb(state)` (~3197): loads once into `state.db`, caches for process lifetime.
- JSON mode: `loadJsonDb`/`saveJsonDb` (~3238) — whole object ↔ one file, atomic temp+rename.
- Postgres mode: `loadPostgresDb`/`savePostgresDb` (~3255/3274). A "compatibility snapshot" (whole DB as one JSONB row in `platform_settings`) is written **only** when `postgresCompatibilitySnapshotEnabled()` is true (default: non-production). In production the snapshot is disabled and relational collections are the source of truth.
- `POSTGRES_RELATIONAL_COLLECTIONS` (~3326): array of `{collection, table, orderBy, fields, prepare?, hydrate?}`. `fields` maps JS property → column (string) or descriptor `{column, type, fallback}`. Every table's PK is `id`.
- `saveDb(state)` (~3215): marks dirty, coalesces writes through `state.writeQueue` with a small batch delay. This batching stays — ITEM-1 changes *what* the flush emits, not the coalescing.

## Appendix B — Future epic: row-level persistence (out of scope, do not implement now)

Sketch only. Replace the global-authoritative `state.db` with per-request row access: read the specific entities a handler needs (optionally through a short-TTL cache), mutate, and write those rows back inside a transaction using `updated_at` optimistic concurrency (reject/retry on version mismatch). This removes the single-writer constraint from ITEM-2 and the last-writer-wins clobber entirely. Large refactor touching every handler; schedule as its own project.

---

## Progress

- [x] ITEM-1 — row-level Postgres writes (diff-on-save) + fewer read-path saves
- [x] ITEM-2 — single-writer enforcement (advisory lock + deploy pin + docs)
- [x] ITEM-3 — `Secure` session cookie in production
- [x] ITEM-4 — validate file size against decoded payload
- [x] ITEM-5 — CSV formula-injection neutralization
- [x] ITEM-6 — bounded rate-limit maps (periodic eviction)
- [x] ITEM-7 — SSRF guardrails on webhooks/integrations
- [x] ITEM-8 — hygiene batch (Stripe replay window, static-path guard, LICENSE, SAML note)
