# Formspear

![Node.js >= 20](https://img.shields.io/badge/Node.js-%3E%3D20-339933)
![Local first](https://img.shields.io/badge/runtime-local--first-2563eb)
![Railway ready](https://img.shields.io/badge/deploy-Railway-7c3aed)
![Status](https://img.shields.io/badge/status-working%20SaaS%20foundation-f59e0b)

Formspear is a full-stack forms, surveys, feedback, analytics, automation, AI-insights, billing, and admin-operations platform. It is built as a local-first Node.js SaaS prototype: it runs immediately with JSON persistence, can attach to PostgreSQL through `DATABASE_URL`, and includes the scaffolding needed for Railway, providers, monitoring, backups, and production cutover. One web process handles HTTP and background jobs; Redis is optional and only changes the in-process queue transport.

The product is intentionally broad. It covers the full feedback lifecycle: build a survey, publish it, collect responses through public links or embeds, analyze results, trigger alerts and integrations, manage teams and billing, export compliance data, and review operational readiness from a super-admin console.

## Why It Is Interesting

- Multi-tenant SaaS foundation with workspaces, roles, invitations, permissions, billing plans, usage meters, and super-admin controls.
- Advanced survey builder with templates, pages, translations, conditional logic, branching, scoring, alerts, redirects, approvals, and version snapshots.
- Public response collection with password protection, scheduling, expiry, response limits, duplicate prevention, anonymous mode, file uploads, partial autosave, and resumable links.
- Analytics workspace that combines response tables, detailed records, exports, NPS, funnels, drop-off, source/device/branch/location breakdowns, benchmarking, and AI-marked insights.
- Production-aware operations layer with migrations, worker jobs, cron triggers, backups, readiness checks, Sentry/PostHog hooks, Redis/BullMQ support, S3/R2 uploads, SMTP, billing providers, and integration retries.

## Feature Map

### Accounts, Workspaces, And Access

- Email/password signup and login with terms/privacy consent.
- Optional Google/OIDC OAuth signup and login with state and PKCE.
- Platform-required email verification, resend flow, and password reset tokens.
- HTTP-only session cookies, remember-this-device sessions, profile editing, password changes, and session/device management.
- TOTP-style local 2FA setup, challenge verification, disable flow, and hashed recovery codes.
- Workspace creation, workspace switching, membership checks, and role-based access.
- Team invites with expiring invite tokens, invite acceptance, role edits, and member removal.
- Workspace-level permission policy for exports, privacy operations, retention operations, audit logs, integration management, billing, and AI reports.
- Survey-level access grants for selected users.
- Agency-plan portfolio overview for client workspaces with plan mix, response volume, contacts, reports, alerts, team seats, custom-domain state, and health labels.
- Workspace SSO/SAML settings, SP metadata, signed assertion consumer endpoint, enforced domains, JIT provisioning, and local dev-mode SSO login.

### Survey Builder And Publishing

- Built-in templates, workspace-private saved templates, and super-admin global template management.
- Survey CRUD with draft saving, publish, pause, archive, and immutable version snapshots.
- Multi-page question grouping and many question types.
- Validation for required fields, publish readiness, and branching safety.
- Workspace publish-approval policy with editor request, admin approve/reject, stale approval detection, and API-key publish gating.
- Custom slugs, public survey links, branded QR SVGs, password protection, expiry dates, response caps, duplicate-prevention modes, completion redirects, and scheduled open times.
- Conditional logic for show-question rules, forward skip branching, tag assignment, hidden fields, lead scoring, alert triggers, end messages, and redirects.
- Workspace branding with logo URL, colors, custom CSS, custom footer, privacy and terms URLs.
- Custom-domain TXT verification through pasted or live DNS checks, plus configurable SSL provisioning hook.
- Multi-language public rendering from schema translations through `?lang=`.
- Local assisted translation draft generation.
- AI survey generation and AI question improvement through an OpenAI-compatible provider when configured, with deterministic local fallback.

### Public Collection, Embeds, And SDK

- Public survey runtime at `/s/:slug`.
- Public API for survey fetch, start, response submit, partial response restore, partial patching, and resume-link email.
- Metadata capture for source, branch, location, city, region, user ID, browser ID, device, browser, OS, IP hash, and user agent.
- Anonymous mode with personal-answer redaction and suppressed identifying metadata.
- Public file-upload questions with extension and size validation.
- Scan-before-store upload policy with local denylist/EICAR checks and optional antivirus-provider hook.
- Quarantine-aware download blocking, lifecycle retention metadata, and storage usage metering.
- S3/R2-compatible object storage when configured, with local upload records as the development fallback.
- Partial response autosave, browser-local resume tokens, reload recovery, emailed cross-device resume links, and final completion of the same draft.
- Website embed script at `/embed.js` for inline and popup iframe embeds.
- In-app SDK at `/sdk.js` with `identify`, event triggers, path targeting, audience targeting, and local frequency controls.

### Responses, Analytics, Contacts, And Exports

- Response table with search, date, status, tag, source, sentiment, sorting, and pagination filters.
- Response detail with answer summary, notes, tags, important flag, archive, anonymize, and individual PDF export.
- CSV, XLSX, JSON, and single-response PDF exports.
- XLSX workbook export with response data and a question dictionary sheet.
- Anonymous survey exports with personal answer and metadata redaction.
- Workspace JSON export, audit-log export, and privacy delete/anonymize request handling.
- Contact profiles created from non-anonymous responses, with searchable contacts UI, CRM stage, owner assignment, lead score, tags, and next follow-up.
- Analytics for completions, completion rate, average rating, NPS, sentiment, lead scores, source, device, branch, location, and question-level stats.
- Funnel conversion, channel conversion, and question drop-off analysis.
- Date-range comparison and cross-survey benchmarking.
- Verified performance smoke for 100 concurrent public submissions and 100,000-response dashboard pagination.

### AI Insights And Reports

- AI-marked response summaries with key themes, urgent responses, recommended actions, lead-quality summary, and important quotes.
- Intent classification across high intent, medium intent, low intent, support request, complaint, and spam.
- Response clustering and complaint clustering.
- OpenAI-compatible provider support through `OPENAI_BASE_URL`, `OPENAI_API_KEY`, and `OPENAI_MODEL`.
- Workspace external-AI opt-out, model allowlist, DPA/data-retention acceptance gate, provider attempt logs, timeout handling, and deterministic local fallback.
- AI credit metering with plan limits and super-admin overrides.
- Manual and scheduled monthly AI reports.
- Designed monthly report PDF generation with metric cards, charts, trends, recommendations, issues, opportunities, quotes, headers, and footers.

### Alerts, Campaigns, Integrations, And Webhooks

- Alert rules for negative feedback, low NPS, and high-intent leads.
- In-app notifications and retryable SMTP email delivery jobs.
- Email invite campaigns with recipient lists, scheduling, send-now, send counts, open tracking, click tracking, and recent event history.
- Signed webhooks with HMAC signatures, retry state, and delivery logs.
- Provider integration profiles for Google Sheets, Slack, Teams, WhatsApp, CRM, Zapier, Make, and email.
- Encrypted local integration config storage.
- Retryable provider delivery when URLs or credentials are configured.
- Simulated local fallback logs for development when providers are absent.

### Billing And Commercial Controls

- Starter, Growth, Pro, and Agency plans, plus super-admin custom plan create/edit/archive controls.
- Survey, response, team-seat, and AI-credit usage meters.
- Plan switching with local fallback.
- Stripe checkout session creation when configured.
- Razorpay order creation when configured.
- Stripe customer portal sessions.
- Signed Stripe and Razorpay billing webhooks.
- Tax-aware invoices, provider-paid invoices, proration policy snapshots, and local proration invoices.
- Payment-failure handling with graceful Starter downgrade.
- Super-admin workspace suspension/deletion, custom billing-plan controls, and AI-credit limit overrides.

### Admin, Security, And Operations

- Super-admin overview with users, workspaces, editable plans, responses, jobs, errors, alerts, templates, and readiness signals.
- User disable and role controls.
- Workspace suspension, deletion, and plan assignment controls.
- Global template create, edit, publish, unpublish, and archive controls.
- Filterable workspace and platform audit logs with secret-looking metadata redaction.
- Hashed API keys with scopes, revocation, rotation, one-time raw token display, rate limiting, and documented `/api/v1` endpoints.
- Security headers across JSON, static, and export routes.
- Same-origin checks for cookie-authenticated writes.
- Public and API rate limits.
- Local captured server error logs, with Sentry and PostHog emission when configured.
- Protected production-readiness report for database, queue, email, OAuth, AI, billing, storage, file scanning, SSO, custom-domain SSL, monitoring, backups, and uptime checks.
- JSON-backed local persistence by default.
- PostgreSQL baseline migration and `DATABASE_URL` runtime state adapter.
- Optional Redis/BullMQ queue transport with an in-process consumer owned by the single web process.
- Retryable job records for email alerts, webhooks, integrations, monthly reports, retention sweeps, and provider delivery.
- `CRON_SECRET`-protected managed cron trigger.
- Local JSON backup and restore scripts with checksum manifests and smoke verification.
- Railway deployment scaffold through `railway.json` and `Procfile`.

## Repository Tour

```text
src/server.js                         Node HTTP server, API, auth, data layer, jobs, analytics, AI, billing, exports
public/index.html                     App shell
public/app.js                         Single-page dashboard and public survey runtime
public/styles.css                     Responsive product UI
public/embed.js                       Website embed script
public/sdk.js                         In-app survey SDK
public/privacy.html                   First-party privacy page
public/terms.html                     First-party terms page
tests/server.test.js                  End-to-end HTTP coverage for the product loop
scripts/worker.js                     Legacy local worker entry point (not used in production)
scripts/performance-smoke.js          Concurrent submission and 100,000-response pagination smoke
scripts/visual-smoke.js               Chrome DevTools visual smoke for app shell and public survey
scripts/backup-data.ps1               Local JSON backup with manifest
scripts/restore-data.ps1              Manifest-aware local JSON restore
scripts/backup-restore-smoke.js       Backup and restore smoke test
scripts/verify-migrations.js          Static migration gate
migrations/0001_initial_postgres.sql  PostgreSQL baseline schema
docs/API.md                           API key, public API, workspace API, billing, admin, and provider docs
docs/DEPLOYMENT.md                    Railway, env, providers, worker, cron, backup, and pre-launch notes
docs/PRD_IMPLEMENTATION_AUDIT.md      Implemented versus production-hardening audit
docs/VISUAL_SMOKE.md                  Visual smoke workflow and latest local evidence
```

## Run Locally

Requirements:

- Node.js 20 or newer
- PowerShell on Windows for the provided backup scripts

Install dependencies:

```powershell
npm.cmd install
```

Start the app:

```powershell
npm.cmd start
```

Open:

```text
http://localhost:4173
```

The first account you create becomes the local super admin. For a quick demo, the signup form is prefilled with:

```text
admin@feedbackos.local
FeedbackOS123
```

## Environment

Copy `.env.example` and configure the values needed for your mode:

```powershell
Copy-Item .env.example .env
```

Minimum local-production style secrets:

- `APP_URL`
- `ENCRYPTION_KEY`
- `IP_HASH_SALT`
- `WEBHOOK_SIGNING_SECRET`
- `CRON_SECRET`

Provider cutover variables are documented in `.env.example` and `docs/DEPLOYMENT.md`, including PostgreSQL, Redis, SMTP, OpenAI-compatible AI, Stripe, Razorpay, S3/R2, file scanning, Sentry, PostHog, custom-domain SSL, uptime checks, and integration-provider webhooks.

## Verification

Fast checks:

```powershell
npm.cmd run check
npm.cmd run migrations:check
npm.cmd test
```

Additional local gates:

```powershell
npm.cmd run backup:smoke
npm.cmd run performance:budget
npm.cmd run performance:smoke
npm.cmd run redis:worker:smoke
npm.cmd run visual:smoke
```

Syntax checks for browser and worker scripts:

```powershell
node --check public\app.js
node --check public\embed.js
node --check public\sdk.js
node --check scripts\worker.js
```

## API

Create a scoped API key in the app, then call:

```http
GET /api/v1/surveys
Authorization: Bearer fo_live_xxx
```

Core API surfaces include:

- Survey lifecycle
- Response submission, listing, detail, update, delete, and analytics
- Contacts
- Webhooks and webhook logs
- Public survey fetch and response flows
- Partial response autosave and resume
- Workspace branding, privacy, retention, team, SSO, API keys, and audit logs
- Billing checkout, portal, invoices, payment-failure handling, and signed provider webhooks
- AI summaries, survey generation, question improvement, and monthly reports
- Evidence-backed AI themes with direct supporting-response links and proactive dashboard insights
- Builder autosave, undo/redo, live preview, and browser-regression verification
- Super-admin users, workspaces, settings, readiness, audit logs, and global templates

See `docs/API.md` for route details and request examples.

## Deployment Position

The [7 November 2026 production review](docs/PRODUCTION_READINESS_REVIEW.md) found release blockers in credential persistence, worker topology, billing, authorization, privacy, and external collection. Follow the [production fix plan](docs/PRODUCTION_FIX_PLAN.md) and [validation record](docs/PRODUCTION_REVIEW_VALIDATION.md) before launch.

Formspear is a working local SaaS foundation, not a finished production SaaS deployment. The repo includes serious production scaffolding, but paid launch still needs live provider setup and verification.

> [!IMPORTANT]
> **Single-Writer Posture**: Formspear currently runs a single writer instance. Do not scale `web` replicas above 1 until the row-level persistence refactor (documented in `docs/REVIEW_REMEDIATION_PLAN.md` ITEM-8 / future epic) lands. Horizontal read-replica scaling is not yet supported.

Current production-oriented support:

- Railway config and Procfile.
- PostgreSQL baseline migration.
- `DATABASE_URL` adapter that persists migration-backed runtime collections into relational PostgreSQL tables. Development can retain a compatibility JSONB snapshot for backfill drills; production disables and removes it.
- `postgres:relational:smoke` for disposable Docker PostgreSQL by default, with a guarded `POSTGRES_RELATIONAL_SMOKE_DATABASE_URL` mode for disposable Railway/PostgreSQL verification when Docker is unavailable.
- `postgres:backfill:drill` for proving that a compatibility snapshot can repopulate the relational tables on a disposable PostgreSQL target before the snapshot is retired.
- Optional Redis/BullMQ queue mode in the single web process.
- SMTP, AI provider, billing provider, object storage, file scan, monitoring, custom-domain SSL, and integration hooks.
- Protected readiness report that exposes missing production configuration without leaking secrets.
- Backup and restore scripts for the local JSON store.

Remaining external verification before paid traffic:

- Run the guarded relational smoke and backfill drill against a disposable database on the selected managed PostgreSQL provider, then complete an isolated managed-backup restore drill.
- Verify the app against a live Railway project with Postgres, Redis, SMTP, object storage, monitoring, billing, AI, backups, cron, and custom-domain SSL automation.
- Certify SSO against the selected live IdP.
- Confirm legal approval for AI provider DPA and data retention.
- Confirm finance/legal approval for tax and proration settings.
- Connect a production antivirus/file-scanning provider and enforce bucket lifecycle policies.

## Documentation

- `docs/API.md`: endpoint documentation and examples.
- `docs/DEPLOYMENT.md`: local, Railway, providers, worker, cron, monitoring, backups, and pre-launch checks.
- `docs/PRD_IMPLEMENTATION_AUDIT.md`: implemented coverage, verification evidence, and remaining production gaps.
- `docs/VISUAL_SMOKE.md`: automated visual-smoke workflow and latest local result.
- `docs/SHIP_PLAN.md`: active path from prototype breadth to a focused production product.
- `docs/ARCHITECTURE.md`: current module boundaries and incremental route-extraction convention.
- `docs/LAUNCH_CHECKLIST.md`: automated, provider, and human launch gates.
- `docs/OPERATIONS_RUNBOOK.md`: deployment, rollback, incident, backup, and routine operations.
- `docs/SECURITY_AND_PRIVACY.md`: implemented controls, deletion boundary, and approval requirements.

## License

No license has been declared yet. Add one before distributing the project publicly.
