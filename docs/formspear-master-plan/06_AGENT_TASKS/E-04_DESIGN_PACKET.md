# E-04 Design & Discovery Packet: Server Test Suite Modularization

## 1. Context & Objective
`tests/server.test.js` is a 2,528-line monolithic integration test executing over 2,000 assertions sequentially inside a single `test('FeedbackOS core MVP and V1 loops work over HTTP', ...)` block.

While comprehensive, this monolithic structure has key drawbacks:
- Failures in early assertions (e.g. auth) halt execution of unrelated later tests (e.g. billing or exports).
- Test execution cannot be parallelized across CPU cores by the Node.js test runner.
- Diagnosing failures requires searching through a 2,500-line test log.
- Shared mock receivers (SMTP, OpenAI, Stripe, S3, Webhook, SAML) are defined in-line and duplicated across newer test files.

## 2. Discovery: Outline of the 2,528-Line Test & State Dependencies

| Section | Line Range | Operations & Assertions | Shared State Dependencies | Target Modular Suite |
|---------|------------|-------------------------|---------------------------|----------------------|
| **1. Auth & Credentials** | 500–710, 1060–1235, 2340–2390 | Signup, email verification tokens, password login, rate limiting, Google OAuth start/callback, SAML SSO start/assertion, session revocation, 2FA TOTP setup/verify/disable, password reset flow | `admin`, `oauthClient`, `ssoClient`, temp `db.json`, mock SMTP, mock OAuth, RSA keypair | `tests/server-auth.test.js` |
| **2. Workspaces & RBAC** | 880–1055, 2160–2260, 2450–2485 | Workspace CRUD, invitation creation, accept invitation, member roles (`admin`, `editor`, `viewer`), role-based permission gates, workspace deletion, timezone validation | `admin`, `invited`, `editor`, workspace ID | `tests/server-workspaces.test.js` |
| **3. Survey Lifecycle & Builder** | 710–880, 960–1025, 1310–1375, 1660–1850 | Survey CRUD, question schema validation, template instantiation, version publishing, question reordering, logic jump definitions | `admin`, `editor`, workspace ID, survey ID | `tests/server-surveys.test.js` |
| **4. Respondent Runtime & Submission** | 1400–1600, 1700–1800 | Public respondent session, partial saves (`/answers`), password verification, logic evaluation, completion redirect/message, submission quota decrement | Survey slug, public client, survey response ID | `tests/server-respondent.test.js` |
| **5. Integrations & Alerts** | 1235–1305, 1380–1405, 2050–2090, 2495–2510 | Webhook registrations, event delivery, encrypted secret persistence, alert rules, Slack/WhatsApp/Email notifications, campaign contacts | `admin`, mock webhook receiver, alert rules | `tests/server-integrations.test.js` |
| **6. Admin & Billing Operations** | 2260–2450, 2485–2525 | Admin overview, user management, workspace listing, plan management, system settings, readiness probe, audit logs, weak key warning | `admin`, `other`, mock Stripe receiver, admin token | `tests/server-admin.test.js` |

## 3. Shared Fixture Architecture (`tests/helpers/server-fixture.js`)
To enable modular test files without code duplication, `tests/helpers/server-fixture.js` provides:
1. `setupTestServer(t, options)`: Spins up an isolated instance of `createServer`, temp data file, port allocation, cleanup hooks.
2. `makeClient(baseUrl)`: HTTP client managing session cookies, bearer tokens, JSON parsing, error normalization.
3. Mock receivers:
   - `makeWebhookReceiver(t)`
   - `makeSmtpReceiver(t)`
   - `makeOAuthReceiver(t)`
   - `makeOpenAiReceiver(t)`
   - `makeStripeReceiver(t)`
   - `makeObjectStorageReceiver(t)`
   - `makeFileScanReceiver(t)`
   - `makeSslProvisionReceiver(t)`
   - `makeMonitoringReceiver(t)`
4. Helper token parsers:
   - `getVerificationToken(dataFile, email)`
   - `getPasswordResetToken(dataFile, email)`
5. Cryptographic helpers:
   - `signedSamlResponse(options)`
   - `stripeSignature(secret, body, timestamp)`
   - `providerContent(task)`

## 4. Playwright / Browser Golden Path
Formspear's built-in zero-dependency browser verification infrastructure (`scripts/visual-smoke.js`) drives headless Chromium / Edge via Chrome DevTools Protocol (CDP). A dedicated golden-path test (`tests/golden-path.test.js`) executes the complete survey respondent and builder loop.
