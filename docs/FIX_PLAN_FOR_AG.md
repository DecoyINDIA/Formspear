# Fix Plan for Antigravity (AG)

**Target:** `src/server.js` (single-file Node `http` backend, ~11.6k lines)
**Status date:** 2026-07-01
**Author of findings:** verified against source, not the original (partly inaccurate) review.

Each item below is **verified against the actual code**. Line numbers were accurate at audit time — re-`grep` before editing since the file is large and shifts. Items are ordered by priority. False/non-issues from the prior review are listed at the bottom so AG does **not** waste effort on them.

---

## P0 — Security (do these first)

### 1. Password reset token returned in HTTP response
- **Where:** `handlePasswordResetRequest`, [src/server.js:1166](../src/server.js#L1166)
- **Problem:** `sendJson(res, 200, { ok: true, resetToken: token })` leaks the raw reset token in the response body. The token is *already* emailed via `queueEmailJob` at line 1159, so the response leak is pure exposure (logs, proxies, browser history).
- **Fix:** Return only `{ ok: true }`.
```js
// line 1166
sendJson(res, 200, { ok: true });
```
- **Note:** Keep the always-`{ ok: true }` behavior for the non-existent-user branch (line 1170) so the endpoint does not reveal whether an email exists. Good already — don't regress it.

### 2. Email verification token returned in HTTP responses
- **Where:** three sites:
  - `handleSignup` — [src/server.js:750](../src/server.js#L750)
  - `handleSignup` (second path) — [src/server.js:782](../src/server.js#L782)
  - `handleEmailVerificationRequest` — [src/server.js:1208](../src/server.js#L1208)
  - `handleLogin` (email-verification-required branch) — [src/server.js:782](../src/server.js#L782)
- **Problem:** `verificationToken: verification.token` exposes the verification token in the response body. Token is delivered via email job; response copy is unnecessary exposure.
- **Fix:** Remove the `verificationToken` field from each of these `sendJson` payloads. Keep the surrounding fields (`email`, `error`, etc.).
- **Caveat:** If any smoke test (`scripts/*.js`, `tests/*.test.js`) reads `verificationToken`/`resetToken` from the API response to drive the flow, update those tests to read the token from the queued email job / DB instead. **Grep first:** `grep -rn "verificationToken\|resetToken" scripts tests`.

### 3. Weak default `ENCRYPTION_KEY`
- **Where:** [src/server.js:11292](../src/server.js#L11292) and [src/server.js:11305](../src/server.js#L11305)
- **Problem:** `crypto.createHash('sha256').update(process.env.ENCRYPTION_KEY || 'formspear-local-dev-key')` — if `ENCRYPTION_KEY` is unset in production, all `encryptConfig()` data is encrypted under a **hardcoded, public** key. `.env.example:4` ships `ENCRYPTION_KEY=replace-with-32-byte-secret`.
- **Fix:** Fail closed in production instead of silently falling back.
```js
function encryptionKey() {
  const raw = process.env.ENCRYPTION_KEY;
  if (!raw || raw === 'replace-with-32-byte-secret') {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('ENCRYPTION_KEY must be set to a strong secret in production.');
    }
  }
  return crypto.createHash('sha256').update(raw || 'formspear-local-dev-key').digest();
}
```
Route both call sites (11292, 11305) through this helper.

### 4. No rate limiting on auth endpoints (brute-force)
- **Where:** `handleLogin` [src/server.js:764](../src/server.js#L764); `handleSignup`; `handlePasswordResetRequest` [src/server.js:1142](../src/server.js#L1142).
- **Already OK — do NOT touch:** `handleTwoFactorVerify` already locks the challenge after 5 attempts ([src/server.js:837](../src/server.js#L837)). 2FA is **not** vulnerable.
- **Problem:** Login/signup/reset have no per-IP or per-email throttle. Password brute-force is unbounded.
- **Fix:** Reuse the existing bucket pattern (`publicBuckets`, [src/server.js:325](../src/server.js#L325); `apiRateAllowed` around line 11281). Add an `authRateAllowed(key)` helper and apply at the top of each auth handler, keyed on client IP + email.
```js
const authBuckets = new Map();
const AUTH_RATE_WINDOW_MS = 15 * 60 * 1000;
const AUTH_RATE_MAX = 10;
function authRateAllowed(key) {
  const now = Date.now();
  const bucket = authBuckets.get(key) || { count: 0, resetAt: now + AUTH_RATE_WINDOW_MS };
  if (now > bucket.resetAt) { bucket.count = 0; bucket.resetAt = now + AUTH_RATE_WINDOW_MS; }
  bucket.count += 1;
  authBuckets.set(key, bucket);
  return bucket.count <= AUTH_RATE_MAX;
}
```
Then at the start of each handler (after reading body/email):
```js
const rlKey = `${clientIp(req)}:${email}`;
if (!authRateAllowed(rlKey)) {
  sendJson(res, 429, { error: { code: 'rate_limited', message: 'Too many attempts. Try again later.' } });
  return;
}
```
Confirm/reuse whatever the codebase uses to derive client IP (check how `publicBuckets` keys are built near line 11269).

### 5. SSO dev-login has no production guard
- **Where:** `handleSsoDevLogin` [src/server.js:971](../src/server.js#L971) — gated only on `workspace.sso.devMode` (line 981).
- **Problem:** A config flag alone can enable passwordless login by email in production. There's a readiness *warning* ([src/server.js:10117](../src/server.js#L10117)) but no hard block.
- **Fix:** Add at the very top of `handleSsoDevLogin`:
```js
if (process.env.NODE_ENV === 'production') {
  sendJson(res, 404, { error: { code: 'not_found', message: 'Not found.' } });
  return;
}
```

---

## P1 — Hardening

### 6. Webhook secrets stored in plaintext at rest
- **Where:** created at [src/server.js:2218](../src/server.js#L2218) and [src/server.js:3213](../src/server.js#L3213); pushed to `db.webhooks`.
- **Already OK:** the secret is masked as `'[hidden]'` on all responses including creation (lines 2230, 3225) — the prior review's "returned raw" claim was wrong.
- **Problem:** Stored unencrypted in the JSON DB file, unlike integration configs which use `encryptConfig()`. If the DB file leaks, all webhook signing secrets leak.
- **Fix:** Store `secretEncrypted: encryptConfig(secret)` instead of `secret`, and decrypt only when signing outbound webhook deliveries. Follow the existing `integration.configEncrypted` pattern (`grep -n "configEncrypted\|encryptConfig" src/server.js`).

### 7. CSP allows `'unsafe-inline'`
- **Where:** `SECURITY_HEADERS`, [src/server.js:56](../src/server.js#L56)
- **Problem:** `script-src 'self' 'unsafe-inline'` defeats CSP's XSS protection.
- **Fix (lower priority, more work):** Move inline `<script>`/`<style>` in served HTML to external files or add per-request nonces. If nonces are too invasive for the prototype, at minimum drop `'unsafe-inline'` from `script-src` and inline-refactor the scripts. Track as follow-up if UI relies heavily on inline handlers.

### 8. Validate `timezone` input
- **Where:** signup / workspace creation (search `body.timezone`, `cleanText(... 60)`).
- **Fix:** Validate against `Intl.supportedValuesOf('timeZone')` (available on Node ≥20) and reject/fallback to a default if invalid.

---

## P2 — Quality / cleanup

### 9. `dev` script identical to `start`
- **Where:** `package.json` — `"dev": "node src/server.js"`.
- **Fix:** `"dev": "node --watch src/server.js"` (native, no new dep).

### 10. Replace `structuredCloneCompat` with native `structuredClone`
- **Where:** ~10 call sites (grep `structuredCloneCompat`). Engines require Node ≥20, which has native `structuredClone`.
- **Fix:** Replace calls and delete the compat helper. Verify the helper had no custom behavior (e.g. handling of `undefined`/functions) before swapping.

### 11. Unbounded `db.auditLogs` growth
- **Where:** `db.auditLogs.push(...)` throughout.
- **Fix (prototype-appropriate):** Cap in-memory audit log to last N entries on save, or note as a known limitation to resolve with the Postgres migration. Low urgency.

---

## Do NOT "fix" these — verified non-issues from the prior review

| Prior claim | Reality |
|---|---|
| CSRF check runs on GET requests | **False.** `sameOriginAllowed` ([src/server.js:10532](../src/server.js#L10532)) only applies to POST/PUT/PATCH/DELETE and exempts Bearer/cookieless requests. |
| BullMQ is wired but unused | **False.** Real `new Worker(...)` at [src/server.js:4708](../src/server.js#L4708), gated on `REDIS_URL`; in-memory fallback is intentional. |
| `saveDb` needs atomic write-then-rename | **Already done** — temp write + `fs.rename` at [src/server.js:3646-3647](../src/server.js#L3646). |
| Concurrent read→mutate→write race in JSON DB | **Overstated.** Node is single-threaded; mutations are synchronous, only the flush is debounced. Real risk is crash-before-flush data loss, not a race. |
| 2FA verify has no brute-force protection | **False.** Challenge locks after 5 attempts ([src/server.js:837](../src/server.js#L837)). |
| Stripe/Razorpay SDK dependencies | **False.** `package.json` has only `bullmq`, `pg`, `write-excel-file`; billing uses raw webhook-secret env vars. |
| Webhook secret returned raw once | **False.** Always masked `'[hidden]'`, even on creation. |

---

## Suggested execution order for AG
1. P0 items 1–5 (small, high-value, low-risk edits).
2. Run `npm run check` (`node --check src/server.js`) and `npm test` after each edit.
3. Update any smoke tests that read tokens from responses (P0 items 1–2 caveat).
4. P1 items 6–8.
5. P2 items 9–11 opportunistically.

**Verification per change:** `node --check src/server.js` must pass; `node --test tests/*.test.js` green; manually confirm reset/verify/login flows still complete using the emailed/queued token path rather than the response body.
