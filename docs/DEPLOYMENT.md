# Deployment And Operations

## Local

```powershell
npm.cmd start
```

Health check:

```powershell
Invoke-WebRequest -UseBasicParsing http://localhost:4173/api/health
```

Super-admin production-readiness report:

```http
GET /api/admin/readiness
```

## Railway MVP

The repo includes `railway.json` and `Procfile`.

Recommended Railway services from the PRD:

- Web service: this Node app
- PostgreSQL: production data store target
- Redis: queue target for BullMQ or compatible worker
- Worker service: can initially run the same start command while jobs are in-process
- Cron service: production trigger for retention/report scheduling, replacing the local in-process scheduler
- Object storage: production target for file-upload answers

Current local persistence is JSON-backed by default. The repo includes `migrations/0001_initial_postgres.sql` as the PostgreSQL baseline schema, `npm.cmd run migrations:check` as a static migration gate, and a `DATABASE_URL` runtime adapter that stores the current app state in `platform_settings.value_json` under a JSONB state key after the baseline migration is applied. Before paid launch, keep `DATABASE_URL` enabled and replace the JSONB snapshot adapter with fully relational PostgreSQL reads/writes for the core tables.
File uploads use local JSON records by default and S3/R2-compatible object storage when the S3 variables are configured. Before paid launch, keep remote payloads in object storage only and keep scan/lifecycle metadata in the database.

## Required Environment

Copy `.env.example` and configure at least:

- `APP_URL`
- `ENCRYPTION_KEY`
- `IP_HASH_SALT`
- `WEBHOOK_SIGNING_SECRET`
- `CRON_SECRET`

Production provider cutover variables are already listed in `.env.example`:

- `DATABASE_URL`
- `REDIS_URL`
- `SMTP_HOST`
- `SMTP_PORT`
- `SMTP_USER`
- `SMTP_PASSWORD`
- `SMTP_FROM`
- `SMTP_SECURE`
- `OPENAI_API_KEY`
- `OPENAI_BASE_URL`
- `OPENAI_MODEL`
- `OPENAI_ALLOWED_MODELS`
- `OPENAI_TIMEOUT_MS`
- `AI_PROVIDER_DPA_ACCEPTED`
- `AI_PROVIDER_DPA_URL`
- `AI_PROVIDER_DATA_RETENTION_DAYS`
- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `STRIPE_BASE_URL`
- `STRIPE_PORTAL_CONFIGURATION_ID`
- `STRIPE_AUTOMATIC_TAX`
- `STRIPE_TAX_ID_COLLECTION`
- `RAZORPAY_KEY_ID`
- `RAZORPAY_SECRET`
- `RAZORPAY_WEBHOOK_SECRET`
- `RAZORPAY_BASE_URL`
- `BILLING_TAX_MODE`
- `BILLING_TAX_PERCENT`
- `BILLING_PRORATION_POLICY`
- `S3_ACCESS_KEY`
- `S3_SECRET_KEY`
- `S3_BUCKET`
- `S3_REGION`
- `S3_ENDPOINT`
- `S3_PUBLIC_BASE_URL`
- `S3_LIFECYCLE_DAYS`
- `FILE_SCAN_MODE`
- `FILE_SCAN_PROVIDER_URL`
- `FILE_SCAN_PROVIDER_TOKEN`
- `FILE_SCAN_TIMEOUT_MS`
- `FILE_SCAN_FAIL_OPEN`
- `FILE_SCAN_BLOCKED_EXTENSIONS`
- `SENTRY_DSN`
- `POSTHOG_KEY`
- `POSTHOG_HOST`
- `MONITORING_TIMEOUT_MS`

## Backups

For the local JSON store:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts\backup-data.ps1
```

The command writes `backups\formspear-<timestamp>.json` plus a `.manifest.json` file with byte count, SHA-256 checksum, source path, backup path, and the restore command. Restore a local JSON backup with:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts\restore-data.ps1 -BackupFile backups\formspear-YYYYMMDD-HHMMSS.json -Force
```

The restore script validates that the backup is JSON, checks the manifest checksum when available, and writes a pre-restore copy beside the target data file before replacing it. Verify the local backup/restore procedure with:

```powershell
npm.cmd run backup:smoke
```

For Railway/PostgreSQL, configure automated database backups before paid launch and verify restore against a disposable database before paid traffic.

## Database Migrations

Static migration verification:

```powershell
npm.cmd run migrations:check
```

Production application order:

1. Provision Railway PostgreSQL and set `DATABASE_URL`.
2. Apply `migrations/0001_initial_postgres.sql` inside one transaction.
3. Confirm `schema_migrations` contains version `0001`.
4. Start the app with `DATABASE_URL` set; the runtime will create or update the JSONB state row in `platform_settings`.
5. Run app smoke tests against the PostgreSQL-backed runtime before paid traffic.

## Worker Jobs

The app now persists retryable jobs for:

- Email alert delivery through SMTP when configured, with local simulated logs otherwise
- Webhook delivery
- Integration provider delivery
- Monthly AI reports
- Retention sweeps, including an immediate protected workspace endpoint and local scheduled due-run enqueueing

Without `REDIS_URL`, the in-process worker drains jobs every `JOB_POLL_INTERVAL_MS`. With `REDIS_URL`, due jobs remain persisted in the app state and are mirrored into BullMQ. Run a separate worker service:

```powershell
npm.cmd run worker
```

`BULLMQ_QUEUE_NAME` defaults to `feedbackos-jobs`, and `BULLMQ_WORKER_CONCURRENCY` controls worker concurrency. Super admins can force a drain or BullMQ enqueue pass:

```http
POST /api/jobs/drain
```

Managed cron services can trigger due jobs without a user session:

```http
POST /api/cron/run
x-cron-secret: <CRON_SECRET>
```

In local mode this processes due queued/retrying jobs. In BullMQ mode this enqueues due jobs into Redis for the worker and records `queued_external` status on the persisted job record. It does not force future jobs.

## AI Provider

AI summaries, survey generation, question improvement, and monthly reports use an OpenAI-compatible chat-completions endpoint when `OPENAI_API_KEY` is set, the workspace `allowExternalAi` setting is enabled, `OPENAI_MODEL` is included in `OPENAI_ALLOWED_MODELS` when an allowlist is configured, and `AI_PROVIDER_DPA_ACCEPTED=true` is set after legal review. Configure `OPENAI_BASE_URL` for non-OpenAI gateways, `OPENAI_MODEL` for the selected model, and `OPENAI_TIMEOUT_MS` for the request timeout. Record the reviewed DPA or data-processing terms in `AI_PROVIDER_DPA_URL` and the provider retention commitment in `AI_PROVIDER_DATA_RETENTION_DAYS`.

Provider prompts are limited to tenant-scoped survey metadata and bounded response excerpts. The runtime records sanitized provider attempt logs for admin observability. If the provider is absent, disabled for the workspace, blocked by model policy, blocked by the legal/DPA gate, or returns an invalid response, the runtime falls back to deterministic local AI output so the product remains usable in local development.

## Monitoring And Uptime

Configure `SENTRY_DSN` or `POSTHOG_KEY` for server error telemetry. Configure `UPTIME_CHECK_PROVIDER`, `UPTIME_CHECK_URL`, and `MONITORING_ALERT_WEBHOOK_URL` to document the live uptime monitor and alert route that watches `/api/health` or the public app URL. `GET /api/admin/readiness` reports these values only as booleans plus the provider name, never as secret URLs.

## Custom Domains

Workspace custom domains require a TXT record in the form `feedbackos-site-verification=<token>`. Admins can paste the observed TXT value for manual verification or run live DNS TXT polling from the branding screen. Successful live verification marks the domain `verified_dns`; successful pasted verification marks it `verified_local`.

Configure `CUSTOM_DOMAIN_SSL_PROVIDER_URL` to an internal certificate automation endpoint before paid launch. The branding screen can then call `POST /api/workspaces/{workspaceId}/custom-domain/provision-ssl`, which sends the verified domain and token to the provider and stores `active`, `pending_validation`, or `failed` SSL status with provider/certificate metadata. Set `CUSTOM_DOMAIN_SSL_PROVIDER_TOKEN`, `CUSTOM_DOMAIN_SSL_PROVIDER_NAME`, and `CUSTOM_DOMAIN_SSL_TIMEOUT_MS` as needed for the Cloudflare/Railway/reverse-proxy workflow. Readiness reports `custom_domain_ssl` as a launch blocker until the provider URL is configured.

## SSO Provider

Workspace SSO metadata advertises `POST /api/auth/sso/assertion` as the assertion consumer service. Configure each SSO workspace with the IdP `entityId`, `ssoUrl`, allowed email domains, and the IdP signing certificate or public key in `x509Certificate`. The assertion endpoint fails closed unless a pending `RelayState`, signed `SAMLResponse`, issuer, audience, recipient, destination, assertion expiry, and subject email domain all validate. Disable `devMode` before paid launch; readiness reports warn when any enabled SSO workspace still allows local dev-mode login.

## Integration Providers

Webhook integrations use signed FeedbackOS webhook delivery. Non-webhook providers use retryable integration jobs and can post to configured provider URLs. Configure provider URLs per workspace in the encrypted integration `config` (`webhookUrl`, `url`, or `apiUrl`) or through environment fallbacks such as `SLACK_WEBHOOK_URL`, `TEAMS_WEBHOOK_URL`, `GOOGLE_SHEETS_WEBHOOK_URL`, `CRM_WEBHOOK_URL`, `ZAPIER_WEBHOOK_URL`, and `MAKE_WEBHOOK_URL`. Optional provider auth can use `*_TOKEN` or `*_API_KEY` env values, or `accessToken`, `token`, and `apiKey` in the encrypted integration config. `INTEGRATION_TIMEOUT_MS` bounds provider calls.

WhatsApp delivery requires `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_ACCESS_TOKEN`, and a recipient `WHATSAPP_TO` or per-integration `to` value. When no provider URL or required WhatsApp settings are configured, local development records simulated provider logs instead of sending external traffic.

## Billing Provider

Plan checkout uses Stripe when `STRIPE_SECRET_KEY` is configured, otherwise Razorpay when `RAZORPAY_KEY_ID` and `RAZORPAY_SECRET` are configured. Signed provider webhooks at `/api/billing/webhook/stripe` and `/api/billing/webhook/razorpay` require `STRIPE_WEBHOOK_SECRET` or `RAZORPAY_WEBHOOK_SECRET`; these webhooks activate subscriptions, create paid invoices, and apply graceful Starter downgrades on payment failure. Stripe-backed workspaces can create customer portal sessions through `POST /api/billing/{workspaceId}/portal`; `STRIPE_PORTAL_CONFIGURATION_ID` is optional. `STRIPE_BASE_URL` and `RAZORPAY_BASE_URL` are available for non-production gateways and local fake-provider tests.

Configure `BILLING_TAX_MODE` as `none`, `exclusive`, or `inclusive`, set `BILLING_TAX_PERCENT`, and choose `BILLING_PRORATION_POLICY` as `none`, `create_prorations`, or `always_invoice`. Stripe checkout can also enable `STRIPE_AUTOMATIC_TAX` and `STRIPE_TAX_ID_COLLECTION`. Local invoices, local plan changes, checkout sessions, subscriptions, and provider-paid invoices store the policy snapshot so tax and proration decisions are auditable.

## Object Storage

File upload answers use local JSON-backed upload records by default. Configure `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `S3_BUCKET`, `S3_REGION`, and `S3_ENDPOINT` to store payloads in S3/R2-compatible object storage through signed `PUT` requests. `GET /api/file-uploads/{uploadId}/download-url` returns signed temporary `GET` URLs for stored objects. `S3_PUBLIC_BASE_URL` is optional and is used only for the metadata URL stored with the upload record.

Uploads are scanned before storage. `FILE_SCAN_MODE=local` uses the built-in denylist/EICAR policy for development; `FILE_SCAN_MODE=provider` plus `FILE_SCAN_PROVIDER_URL` sends payload metadata and content to an antivirus scanning service before storing. Leave `FILE_SCAN_FAIL_OPEN=false` for production so unavailable scanners fail closed. `FILE_SCAN_BLOCKED_EXTENSIONS` should include executable/script extensions even if a survey owner misconfigures allowed file types.

Set `S3_LIFECYCLE_DAYS` to the bucket retention policy you have configured. Workspace retention sweeps mark expired upload records, clear local payloads, and expose `fileUploadsExpired` in job results, but S3/R2 bucket lifecycle rules are still required to delete remote objects at the storage layer.

## Monitoring

Server exceptions are always captured in local admin error logs. Configure `SENTRY_DSN` to emit Sentry store events and `POSTHOG_KEY` plus optional `POSTHOG_HOST` to emit PostHog `server_error` capture events. `MONITORING_TIMEOUT_MS` bounds provider delivery so local error handling remains fast.

## Pre-Launch Checks

```powershell
npm.cmd run check
npm.cmd run migrations:check
node --check public\app.js
node --check public\embed.js
node --check public\sdk.js
npm.cmd test
npm.cmd run performance:smoke
npm.cmd run visual:smoke
```

`npm.cmd run performance:smoke` starts a disposable local server, verifies at least 100 concurrent public submissions against the configured rate limit, checks CSV/dashboard count consistency, seeds a 10,000-response set, and asserts the paginated dashboard API returns within the configured threshold. Tuning knobs are `PUBLIC_RATE_LIMIT_MAX`, `DB_SAVE_BATCH_DELAY_MS`, `PERF_SMOKE_CONCURRENCY`, `PERF_SMOKE_LARGE_RESPONSES`, `PERF_SMOKE_SUBMISSION_P95_MAX_MS`, and `PERF_SMOKE_DASHBOARD_MAX_MS`.

After signing in as a super admin, review `GET /api/admin/readiness`. It intentionally reports missing provider variables as launch blockers instead of treating simulated local services as production-ready.

Do not treat the current JSON store, simulated SMTP fallback, or unconfigured local AI fallback as production-complete.
