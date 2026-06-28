# FeedbackOS PRD Implementation Audit

Date: 2026-06-27

Source: pasted PRD for "FeedbackOS - Forms, Surveys, Feedback & AI Insights Platform".

## Current Status

The workspace was empty at the start of the first pass. The repo now contains a working local product foundation with a Node API, SPA UI, public survey runtime, embed scripts, job queue, team/API/contact surfaces, tests, and documentation.

This audit does not claim the full PRD is production-complete. It separates implemented local behavior from remaining production work.

## Implemented MVP Coverage

| PRD area | Evidence | Status |
| --- | --- | --- |
| User signup/login | `POST /api/auth/signup`, terms/privacy consent, optional Google/OIDC OAuth start/callback with state and PKCE, platform-required email verification, `POST /api/auth/login`, remember-me sessions, session cookies in `src/server.js` | Implemented locally |
| Email verification and password reset | `POST /api/auth/email-verification/request`, `POST /api/auth/email-verification/confirm`, super-admin `requireEmailVerification` setting, `POST /api/auth/password-reset/request`, `POST /api/auth/password-reset/confirm`, expiring token records | Implemented locally |
| Profile/session management | `GET/PUT /api/profile`, `POST /api/profile/password`, optional TOTP-style 2FA setup/verify/disable, recovery codes, remembered-session metadata, `GET/DELETE /api/sessions` | Implemented locally |
| Workspace creation | `POST /api/workspaces`, onboarding signup workspace, switcher in `public/app.js` | Implemented locally |
| Role model | Workspace roles and `requireWorkspace` authorization checks | Basic implemented |
| Basic dashboard shell | `renderDashboard()` with metrics, checklist, notifications | Implemented |
| Database schema and runtime persistence | JSON-backed local collections, `migrations/0001_initial_postgres.sql` PostgreSQL baseline for users, workspaces, surveys, responses, jobs, billing, audit logs, and indexes, plus a `DATABASE_URL` PostgreSQL JSONB runtime state adapter using `platform_settings.value_json` | Implemented with PostgreSQL snapshot adapter |
| Survey CRUD | `GET/POST/PUT/DELETE /api/surveys` | Implemented |
| Question builder | Builder UI and schema normalization for many question types | Implemented |
| Draft/publish flow | Draft save, publish validation, immutable `survey_versions` snapshots | Implemented |
| Public survey renderer | `/s/:slug` SPA route plus public API | Implemented |
| Public submission API | `POST /api/public/surveys/:slug/responses`, password, expiry, response-limit, duplicate-prevention enforcement, and anonymous-mode identifier suppression/PII redaction | Implemented |
| Response table | `renderResponses()` and `GET /api/surveys/:id/responses` | Implemented |
| Response detail | `GET/PATCH/DELETE /api/surveys/:id/responses/:responseId`, detail UI, tags, notes, important flag, anonymize, archive, and single-response PDF export | Implemented locally |
| CSV and XLSX export | `GET /api/surveys/:id/export.csv` and `GET /api/surveys/:id/export.xlsx`; XLSX includes response and question-dictionary sheets | Implemented |
| QR generation | `/api/surveys/:id/qr.svg` returns a branded version-6 QR SVG encoding the public survey URL | Implemented locally |
| Basic analytics | Survey totals, completion rate, sentiment, source/device/branch/location breakdowns, question stats | Implemented |
| Funnel and drop-off analytics | View/start/completion funnel, channel conversion, and question-wise drop-off/answer-rate tables in analytics | Implemented locally |
| Date-range analytics and comparison | Analytics query filters plus comparison deltas | Basic implemented |
| Cross-survey benchmarking | Workspace benchmark endpoint and Analytics UI table comparing completions, completion rate, lead score, NPS, negative responses, sources, branches, and locations | Basic implemented |
| NPS/CSAT calculations | NPS formula and rating averages in `buildQuestionStat()` | Implemented |
| Email alerts | Alert rules create in-app notifications plus retryable email delivery jobs, SMTP provider delivery when configured, and email logs | Implemented with local fallback |
| Survey status management | Draft, published, paused, archived | Implemented |
| AI response summary, clustering, and intent | `POST /api/surveys/:id/ai-summary`, marked AI-generated, OpenAI-compatible provider when configured, workspace external-AI opt-out, model allowlist, explicit provider DPA/data-retention acceptance gate, bounded response excerpts, provider attempt logs, local intent classification, response clustering, and complaint clustering | Implemented with local fallback |
| AI survey generator | `POST /api/ai/generate-survey` creates a draft survey from goal/audience/industry/count through provider when available | Implemented with local fallback |
| AI question improvement | `POST /api/ai/improve-question` suggests cleaner wording/type/options through provider when available | Implemented with local fallback |
| AI monthly report | `POST /api/ai/monthly-report`, scheduled monthly report jobs, `GET /api/ai/monthly-reports/:workspaceId`, designed PDF download endpoint, provider-backed report content when configured | Implemented with local fallback and designed PDF export |
| Sentiment analysis | Local keyword classifier on submission | Basic implemented |
| Billing | Plans, subscriptions, usage meters, feature-limit checks, Stripe/Razorpay checkout session creation when configured, Stripe customer portal session creation, tax policy snapshots, and plan-change proration invoices | Implemented with local fallback |
| Billing invoices | Manual tax-aware invoices, provider-paid invoices from signed webhooks, payment failure state, graceful Starter downgrade | Implemented locally |
| Usage limits | Survey count, response/month, team-member, and AI-credit gates with super-admin workspace overrides | Implemented locally |
| Agency/client portal | `GET /api/agency/overview` plus the Agency UI tab aggregate visible client workspaces, plan mix, MRR, responses, contacts, reports, alerts, team seats, custom-domain status, and client health with Agency-plan gating for ordinary users | Implemented locally |
| Admin dashboard | `GET /api/admin/overview`, `GET /api/admin/readiness`, and UI, including recent server error logs and production-readiness checks for database, queue, email, OAuth, AI, billing, storage, custom-domain SSL, file scanning, SSO, monitoring, and backups | Implemented locally |
| Admin user/workspace management | Super admin user disable/role updates, workspace suspension/plan updates, and workspace AI-credit limit overrides | Implemented locally |
| Branding | Workspace/survey colors, logo URL, policy URLs, custom-domain manual TXT verification plus live DNS TXT polling, sanitized custom CSS, custom footer text, and public form branding | Implemented |
| Public distribution controls | Custom slug, password protection, expiry, response cap, completion redirect, and paid branding hide flag | Implemented locally |
| Survey scheduling | `opensAt` settings and public `survey_not_open` enforcement | Implemented locally |
| Multi-language public surveys | Schema translations, local assisted translation draft generation, and public `?lang=` rendering | Implemented locally |
| Error states and empty states | UI empty states, structured API errors | Basic implemented |
| Audit logs | Workspace, auth, survey, alert, integration, billing, AI, admin events plus filterable workspace/platform audit-log list and JSON export with metadata redaction | Implemented locally |
| Website embed | `/embed.js` inline and popup iframe embed | Implemented |
| In-app SDK | `/sdk.js` with `identify`, `trigger`, `showSurvey`, event-based survey resolution, page targeting, audience attributes, and local frequency controls | Implemented as browser SDK/API |
| Multi-page surveys | `question.settings.page` grouping in builder schema and public page navigation | Implemented locally |
| Webhooks | Webhook profile, HMAC signature, retryable job delivery, delivery logs, and API access to logs | Implemented locally |
| Google Sheets | Integration profile with encrypted config, retryable provider HTTP delivery when `webhookUrl`/env URL is configured, and simulated response-sync fallback logs | Implemented with local fallback |
| Slack/Teams/WhatsApp/CRM integrations | Provider profiles, encrypted config, retryable provider HTTP delivery when configured, WhatsApp Cloud API payload support, signed provider requests, and simulated local fallback logs | Implemented with local fallback |
| Templates and template marketplace | Four built-in templates, workspace-private saved templates, global custom templates, super-admin create/edit/publish/unpublish/archive controls, and usage tracking | Implemented locally |
| Conditional logic | Server validation, builder UI, public runtime visibility for show-question rules, forward skip-to-question branching, circular/backward path blocking, and response-side actions for tags, hidden fields, scoring, alerts, end messages, and redirects | Implemented locally |
| Team roles and permission policies | Invite tokens, member list, role assignment, role editing, member removal, invite acceptance, configurable workspace action policies, and policy enforcement for exports, billing, integrations, audit logs, privacy, retention, and AI reports | Implemented locally |
| Advanced publish approvals | Workspace `requirePublishApproval` policy, editor request route, admin approve/reject routes, approval-state UI, stale-approval detection after draft edits, audit logs, and editor/API-key publish gating | Implemented locally |
| SSO/SAML | Workspace SAML-style SSO settings, SP metadata XML, strict signed assertion consumer route, issuer/audience/recipient/timing/domain validation, domain enforcement, JIT provisioning, and local dev-mode SSO login | Implemented locally |
| API keys and external API | Hashed tokens, scopes, rate limiting, rotation, revocation, survey lifecycle, response, contact, webhook/log, and analytics `/api/v1` endpoints, docs | Implemented locally |
| Contact profiles | Response-driven contacts, contacts UI, CRM stage, owner assignment, next-follow-up tracking, API endpoint | Implemented locally |
| Partial responses | Public start/autosave/restore/complete endpoints plus debounced public SPA draft autosave, browser-local resume tokens, reload recovery, token-validated emailed cross-device resume links, and final completion of the same partial response | Implemented locally |
| File uploads | File upload question settings, public file input, type/size validation, scan-before-store local policy and antivirus-provider hook, quarantine-aware download blocking, S3/R2-compatible storage when configured, signed download URL endpoint, lifecycle retention metadata/sweep counts, local fallback upload records, storage metering, redacted workspace export | Implemented with local fallback |
| Duplicate prevention | One per browser, email, user ID, or IP hash | Implemented locally |
| Response dashboard filters | Search, status, sentiment, source, tag, date range, sorting, and pagination query support | Implemented locally |
| Email invite campaigns | Campaign create/list/send-now, scheduled jobs, SMTP delivery when configured, send counters, open tracking, click tracking, event history | Implemented locally |
| JSON and PDF export | Survey response JSON export with detail shape plus individual response PDF downloads | Implemented locally |
| Enterprise response exports | Filtered XLSX workbook export with response metadata, notes, tags, answer columns, and question dictionary | Implemented locally |
| Workspace privacy export/delete | Workspace JSON export, privacy deletion/anonymization request endpoint, answer-level PII redaction, and anonymous survey exports with personal answer/metadata redaction | Implemented locally |
| Compliance exports | Workspace and platform audit-log JSON exports with filters and secret-looking metadata redaction | Implemented locally |
| Data retention jobs | Immediate retention sweep endpoint, retryable retention job type, workspace next-run settings, local worker scheduled retention enqueueing, and `CRON_SECRET`-protected managed cron trigger | Implemented locally |
| Redis/BullMQ queue transport | Optional `REDIS_URL` BullMQ transport, `npm.cmd run worker` worker process, persisted job records mirrored into Redis, readiness reporting for queue mode/name, and local Docker Redis smoke | Implemented, production Redis verification pending |
| Security headers, CSRF baseline, error logs, and monitoring readiness | Security headers on JSON/static/export routes, same-origin checks for cookie-auth writes, local captured server exception logs, Sentry/PostHog error emission when configured, and protected readiness report for monitoring telemetry, uptime checks, alert routing, and provider cutover state | Basic implemented |
| Privacy and terms pages | `/privacy` and `/terms` first-party pages plus signup consent capture | Implemented locally |
| Automated visual smoke | `npm.cmd run visual:smoke` seeds a temporary workspace/survey, drives Chrome through DevTools Protocol, captures desktop/mobile screenshots, and fails on console errors, viewport mismatch, small screenshots, or horizontal overflow | Implemented locally |
| Performance and concurrency smoke | `npm.cmd run performance:smoke` verifies 100 concurrent public submissions, CSV/dashboard count consistency, and 10,000-response dashboard pagination under configured thresholds | Implemented locally |
| Railway deployment support | `railway.json`, `Procfile`, `.env.example`, deployment docs, PostgreSQL migration baseline, and `npm run migrations:check` | Scaffolded |
| Backup and restore plan | `scripts/backup-data.ps1` writes local JSON backups with checksum manifests, `scripts/restore-data.ps1` validates/restores backups with pre-restore safety copies, `npm.cmd run backup:smoke` verifies the procedure, and Railway/PostgreSQL backup notes cover managed backup cutover | Implemented locally; managed production backups pending |

## V1 and V2 Areas Partially Covered

- Advanced analytics: date-range comparison, funnel conversion, question drop-off, channel conversion, and cross-survey/source/branch/location benchmarking exist; deeper statistical modeling remains limited.
- Partial responses: implemented for public submissions, public SPA autosave, browser-session recovery with resume tokens, and token-validated emailed resumable links for cross-device recovery.
- Contacts: contacts are upserted, visible, owner-assignable, and tracked through a lightweight CRM stage/follow-up pipeline; deeper CRM automation remains for provider integrations.
- Webhook retries: retryable jobs persist through JSON or the PostgreSQL JSONB state adapter and can be mirrored into BullMQ with `REDIS_URL`; local Docker Redis smoke passed, while production Redis deployment verification remains.
- Multi-language surveys: localized renderer and local assisted translation draft generation exist; production may still add provider-grade translation review workflows.
- Custom domain: workspace setting, pasted TXT verification, live DNS TXT polling, admin-triggered SSL provisioning through a configurable provider hook, provider/certificate metadata, failure capture, and readiness checks exist; production still needs the selected live DNS/hosting provider wired to `CUSTOM_DOMAIN_SSL_PROVIDER_URL`.
- Advanced permissions: workspace role ranks, invite UI, member removal/role editing, configurable workspace action policies, optional survey-level access grants, and publish approval workflows exist; future production work may add customer-specific policy templates.
- API access tokens: implemented locally with scoped hashed tokens, rotation, revocation, and documented `/api/v1` survey/response/contact/webhook endpoints; production needs provider-grade audit/reporting.
- Monthly PDF reports: designed generated PDF downloads and scheduled local delivery exist; future production work may add customer-specific brand templates and chart packs.
- AI provider: OpenAI-compatible chat-completions integration, bounded tenant-scoped prompts, workspace external-AI opt-out, model allowlists, provider DPA/data-retention acceptance gate, provider attempt logs, local intent classification, response clustering, complaint clustering, and AI-credit metering exist; production still needs final legal approval of the selected provider terms.
- Billing provider: Stripe hosted checkout, Razorpay order creation, signed webhook verification, subscription activation, Stripe customer portal session creation, tax-aware paid-invoice creation, tax/proration policy snapshots, local proration invoices, and payment-failure downgrade exist; production still needs live account setup and finance/legal approval of the configured tax policy.
- Slack/Teams/WhatsApp/CRM integrations: provider profiles, retryable provider HTTP delivery, signed provider requests, and local fallback logs exist; live provider account configuration and provider-specific production certification remain.
- SSO/SAML: local SAML-style configuration, SP metadata, enforced domains, strict signed assertion POST validation, and dev-mode assertions exist; production IdP certification and provider-specific XMLDSig profile testing remain.
- Data retention jobs: manual sweeps, local scheduled sweeps, upload lifecycle expiry metadata/counts, a managed cron trigger, and optional Redis/BullMQ transport are implemented; production Redis verification and live bucket lifecycle enforcement remain.

## Production Architecture Gaps

The PRD calls for Railway, PostgreSQL, Redis/BullMQ, worker, cron/scheduler, object storage, email provider, billing provider, LLM provider, Cloudflare, monitoring, backups, and migration safety.

Current implementation:

- Uses a JSON file store at `data/formspear.db.json` by default.
- Includes a PostgreSQL baseline migration, static migration verifier, and `DATABASE_URL` runtime adapter that stores the app state in the baseline `platform_settings.value_json` JSONB column. A fully relational PostgreSQL repository layer for each core table remains future production hardening.
- Runs as one Node HTTP process.
- Has an in-process persistent job worker, managed cron trigger, PostgreSQL baseline migration, PostgreSQL JSONB runtime adapter, and optional Redis/BullMQ transport through `npm.cmd run worker`; local Docker Redis smoke passed, but Railway/production Redis verification remains.
- Stores file-upload payloads in S3/R2-compatible object storage when configured and falls back to JSON-backed local records otherwise; upload payloads are scanned before storage by local policy and optional external scan provider hooks.
- Provisions custom-domain SSL through a configurable provider hook after DNS verification and records provider, certificate id, status, timestamps, and last error on the workspace.
- Uses OpenAI-compatible AI when configured, legally accepted, and allowed by workspace settings, with deterministic local fallback when disabled or unavailable.
- Sends email through SMTP when configured and falls back to local simulated logs otherwise.
- Sends Google Sheets, Slack, Teams, WhatsApp, CRM, Zapier, and Make integration jobs to configured provider URLs with local simulated fallback logs when providers are absent.
- Generates designed local PDF monthly reports with metric cards, sentiment and lead-quality bars, trend chart, recommendations, issues/opportunities, quotes, headers, and footers.
- Delivers webhooks with signed HTTP POST jobs and retries.
- Creates Stripe/Razorpay checkout sessions when configured and processes signed billing webhooks, with tax/proration policy snapshots and local manual fallback when providers are absent.
- Has local SSO/SAML configuration, signed assertion consumer validation, and dev-mode assertions; live IdP certification still needs to be performed against the chosen provider.
- Has Railway scaffold files, local JSON backup/restore scripts with checksum manifests, and a backup/restore smoke verifier, but no live Railway project verification.
- Has local server error logs, protected readiness reporting, Sentry/PostHog error emission when configured, and uptime/alert-route readiness checks; production still needs the selected live monitoring provider to execute those checks.

## Verification Evidence

Commands run:

```powershell
npm.cmd run check
npm.cmd run migrations:check
npm.cmd test
npm.cmd audit --omit=dev
npm.cmd run performance:smoke
npm.cmd run backup:smoke
node --check public/app.js
node --check public/embed.js
node --check public/sdk.js
node --check scripts/worker.js
node --check scripts/performance-smoke.js
node --check scripts/verify-migrations.js
node --check scripts/visual-smoke.js
node -e "const { Pool } = require('pg'); console.log(typeof Pool)"
node -e "const { Queue, Worker } = require('bullmq'); const IORedis = require('ioredis'); console.log(typeof Queue, typeof Worker, typeof IORedis)"
docker run --rm -d -p 127.0.0.1::6379 --name formspear-redis-smoke redis:7-alpine
node -e "... BullMQ smoke: create email_delivery job, enqueue via processDueJobs, process through BullMQ worker, confirm job completed ..."
docker stop formspear-redis-smoke
docker run --rm -d -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=formspear -p 127.0.0.1::5432 --name formspear-postgres-smoke postgres:16-alpine
node -e "... apply migrations/0001_initial_postgres.sql, run createServer({ databaseUrl }), perform signup/session smoke, confirm platform_settings JSONB state row persisted ..."
docker rm -f formspear-postgres-smoke
node -e "... route smoke for /api/health, /, /sdk.js ..."
npm.cmd run visual:smoke
```

Result:

- `src/server.js` syntax check passed.
- PostgreSQL migration static check passed.
- `public/app.js` syntax check passed.
- `public/embed.js`, `public/sdk.js`, `scripts/worker.js`, `scripts/performance-smoke.js`, `scripts/verify-migrations.js`, and `scripts/visual-smoke.js` syntax checks passed.
- `npm.cmd audit --omit=dev` found 0 vulnerabilities after adding the XLSX workbook writer.
- `npm.cmd run performance:smoke` passed the PRD performance smoke: 100 concurrent public submissions accepted, p95 response submission latency was 81 ms against the 500 ms target, CSV export returned 100 response rows matching the dashboard total, and the 10,000-response dashboard pagination query returned 100 rows with total 10,000 in 5 ms against the 3,000 ms target. Details are in `artifacts/performance-smoke/manifest.json`.
- `npm.cmd run backup:smoke` passed: a disposable JSON data file was backed up with a manifest, SHA-256 checksum was verified, the data file was mutated, `scripts/restore-data.ps1` restored the original content, and a pre-restore safety copy was created.
- The `pg` runtime dependency loaded successfully for the `DATABASE_URL` adapter.
- Local Docker PostgreSQL smoke passed: the baseline migration applied to `postgres:16-alpine`, `createServer({ databaseUrl })` started against the live `DATABASE_URL`, signup/session worked, and the `platform_settings` JSONB runtime state row persisted the created user/workspace.
- BullMQ and ioredis dependencies loaded successfully.
- Local Docker Redis/BullMQ smoke passed: a persisted `email_delivery` job was mirrored into BullMQ with `enqueuedExternal: 1`, processed by the worker, completed, and wrote a local email log. The disposable Redis container was stopped afterward.
- Route smoke passed for `/api/health`, `/`, and `/sdk.js`.
- Automated Chrome DevTools visual smoke passed for the desktop app shell and mobile public survey route. It captured `artifacts/visual-smoke/desktop-app-shell.png` at 1280 x 720 and `artifacts/visual-smoke/mobile-public-survey.png` at 390 x 844 with no console errors, exact viewport matches, and no horizontal overflow; details are in `docs/VISUAL_SMOKE.md`.
- Designed monthly report PDF render verification passed with Poppler: a disposable API-generated report rendered as a 2-page Letter PDF with visible header, metric cards, sentiment/lead bars, trend chart, action list, issues/opportunities, quotes, and page footers, with no observed clipping or overlap. Temporary render files were removed after inspection.
- The PostgreSQL adapter has a local live `DATABASE_URL` smoke against Docker Postgres; a real Railway/Postgres deployment smoke is still needed before paid launch.
- `tests/server.test.js` passed the core MVP/V1 HTTP loop:
  - signup
  - platform-required email verification, resend, confirm, and login gating
  - password reset
- profile/session management and remember-me session expiry
- optional Google/OIDC OAuth signup and existing-user login through a fake local provider with state, PKCE, token exchange, userinfo fetch, provider linkage, and readiness reporting
- two-factor setup, failed-code rejection, challenge login, verification, and disable flow
  - tenant isolation
  - sanitized custom CSS, public footer branding, custom-domain pasted TXT verification, and live DNS verification failure handling
  - custom-domain SSL provider gating, provider call authorization, active certificate status, provider/certificate metadata, and readiness reporting
  - team invite and invite signup
  - workspace-required publish approval, editor request/rejection/approval flow, stale approvals after edits, and API-key publish gating
  - configurable workspace action policy enforcement for response exports
  - SSO/SAML settings, metadata, enforced password-login blocking, strict signed assertion login, invalid-signature rejection, and local dev-mode JIT login
  - API key creation, rotation, revocation, and `/api/v1`
  - AI survey generation
  - AI question improvement
  - OpenAI-compatible AI provider calls through a local fake provider
  - workspace external-AI opt-out fallback
  - AI provider attempt logs, model allowlist fallback, and provider legal/DPA gate fallback
  - built-in template read
  - workspace-private template save/use/tenant isolation
  - super-admin global template create/edit/publish/unpublish and API-key creation from a custom template
  - survey creation
  - multi-page survey schema and public payload
  - conditional skip-to-question branching and backward-skip publish rejection
  - alert creation
  - publish
  - scannable QR SVG generation
  - partial response start and completion
  - partial response resume-token restore and invalid-token rejection
  - partial response emailed resume-link delivery with token validation
  - public survey fetch
  - response submission
  - API response submission
  - response detail actions and individual response PDF export
  - response table read
  - 100-concurrent-submission and 10,000-response performance smoke
  - analytics
  - funnel analytics, channel conversion, and question-wise drop-off
  - AI summary
  - AI intent classification, response clustering, and complaint clustering
  - CSV, XLSX, and JSON export
  - contact creation/read
  - email invite campaign jobs
  - notification creation
  - SMTP-backed email delivery through a local fake SMTP provider
  - signed webhook job delivery
  - provider-backed and simulated integration delivery logs
  - campaign open/click tracking
  - protected public links
  - Agency-plan client-workspace portfolio overview and non-Agency access gating
  - anonymous survey response redaction without respondent/contact creation
  - scheduled public-link enforcement
  - translated public-link rendering
  - file upload validation and storage records
  - scan-before-store upload provider call and local EICAR rejection
  - S3/R2-compatible object-storage upload through a local fake provider
  - signed file upload download URL generation
  - duplicate prevention
  - response filtering
  - analytics date comparison
  - response-limit enforcement
  - workspace export
  - workspace and platform audit-log filtering/export
  - privacy anonymization with answer redaction
  - retention sweep execution
  - `CRON_SECRET`-protected managed cron trigger for due jobs
  - security headers
  - local server error logging
  - Sentry/PostHog monitoring emission through a local fake provider
  - monitoring uptime-check and alert-route readiness checks
  - local JSON backup manifest and restore smoke verification
  - admin production-readiness report
  - AI provider DPA/data-retention readiness checks
  - billing tax/proration policy readiness checks
  - object-storage lifecycle, custom-domain SSL provider, and file-scan readiness checks
  - SSO strict assertion readiness and dev-mode warnings
  - monthly AI report and PDF export
  - scheduled monthly AI report delivery
  - tax-aware invoice creation, local proration invoice creation, and payment-failure downgrade
  - Stripe checkout creation through a local fake provider
  - Stripe customer portal creation through a local fake provider
  - signed Stripe billing webhooks for subscription activation and paid invoices
  - admin user/workspace controls
  - AI credit limit enforcement and super-admin override
  - admin overview

## Completion Position

The current repo is a working local FeedbackOS product foundation and covers a broad MVP plus several V1 surfaces. The full PRD is not yet completely finished because several requirements require production services, deployment verification, richer UI surfaces, and deeper compliance hardening.

Recommended next completion pass:

1. Replace the PostgreSQL JSONB snapshot adapter with fully relational PostgreSQL repositories for the core PRD tables.
2. Verify the BullMQ worker against a live Redis service and decide whether to make Redis required for production.
3. Verify deployment on a real Railway project with Postgres, Redis, managed backups/restore drills, SMTP credentials, LLM provider credentials, billing provider credentials, object-storage credentials, custom-domain SSL provider automation, live monitoring/uptime checks, `CRON_SECRET`, and environment variables.
4. Certify SSO against the selected live IdP and prepare any customer-specific permission policy templates required by enterprise buyers.
5. Get final legal approval for the selected live AI provider terms and record the accepted DPA/retention settings in production env.
6. Get finance/legal approval for the live tax configuration and verify it in real Stripe/Razorpay accounts.
7. Connect a production antivirus provider and enforce live S3/R2 bucket lifecycle policies for file uploads.
