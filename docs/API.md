# FeedbackOS API

This document describes the workspace API implemented in `src/server.js`.

## Authentication

Create an API key in the app under **API**, or call:

```http
POST /api/workspaces/{workspaceId}/api-keys
Cookie: fo_session=...
Content-Type: application/json

{
  "name": "Production API key",
  "scopes": ["surveys:read", "surveys:write", "responses:read", "responses:write", "analytics:read", "contacts:read", "contacts:write", "webhooks:read", "webhooks:write"]
}
```

The raw token is returned once. Store it securely.

Rotate or revoke existing keys with:

```http
POST /api/workspaces/{workspaceId}/api-keys/{keyId}/rotate
DELETE /api/workspaces/{workspaceId}/api-keys/{keyId}
```

Rotation immediately invalidates the old token hash and returns the new raw token once.

Use it with:

```http
Authorization: Bearer fo_live_xxx
```

Tokens are stored hashed at rest. API errors use:

```json
{
  "error": {
    "code": "scope_required",
    "message": "API key requires responses:write."
  }
}
```

## Scopes

- `surveys:read`
- `surveys:write`
- `responses:read`
- `responses:write`
- `analytics:read`
- `contacts:read`
- `contacts:write`
- `webhooks:read`
- `webhooks:write`
- `*`

## Endpoints

### List Surveys

```http
GET /api/v1/surveys
Authorization: Bearer fo_live_xxx
```

### Create Survey

```http
POST /api/v1/surveys
Authorization: Bearer fo_live_xxx
Content-Type: application/json

{
  "title": "Customer Feedback",
  "description": "Short feedback survey",
  "templateId": "customer-feedback"
}
```

`templateId` can reference a built-in template, a published global custom template, or a workspace-private custom template available to the API key's workspace.

### Templates

Authenticated dashboard users can list available templates for a workspace:

```http
GET /api/templates?workspaceId={workspaceId}
Cookie: fo_session=...
```

The response includes built-in templates, published global templates, and custom templates saved inside that workspace.

Workspace editors can save an existing survey as a private workspace template:

```http
POST /api/surveys/{surveyId}/template
Cookie: fo_session=...
Content-Type: application/json

{
  "name": "Clinic saved feedback template",
  "category": "clinic",
  "industry": "Healthcare",
  "tags": "clinic, complaints, csat",
  "status": "draft"
}
```

### Agency Overview

Authenticated dashboard users on the Agency plan can fetch a central portfolio rollup for the workspaces visible to them:

```http
GET /api/agency/overview?workspaceId={agencyWorkspaceId}
Cookie: fo_session=...
```

The selected workspace must be on the Agency plan unless the caller is a platform super admin. The response includes `totals`, `planDistribution`, `agencyWorkspace`, and `clients` with per-client survey counts, completed responses, monthly responses, contacts, report count, open alerts, team seats, plan status, custom-domain status, and a simple health label.

### Get Survey

```http
GET /api/v1/surveys/{surveyId}
Authorization: Bearer fo_live_xxx
```

### Update Survey

```http
PUT /api/v1/surveys/{surveyId}
Authorization: Bearer fo_live_xxx
Content-Type: application/json

{
  "title": "Updated Customer Feedback",
  "schema": {
    "title": "Updated Customer Feedback",
    "questions": []
  }
}
```

### Publish, Pause, Or Archive Survey

```http
POST /api/v1/surveys/{surveyId}/publish
POST /api/v1/surveys/{surveyId}/pause
DELETE /api/v1/surveys/{surveyId}
Authorization: Bearer fo_live_xxx
```

If the workspace has `requirePublishApproval` enabled, API-key publishing returns `409 approval_required` until a workspace admin approves the current survey draft. Approval is tied to a draft fingerprint, so edits after approval make the approval stale.

Dashboard users can manage approval with cookie-authenticated routes:

```http
POST /api/surveys/{surveyId}/approval/request
POST /api/surveys/{surveyId}/approval/approve
POST /api/surveys/{surveyId}/approval/reject
Cookie: fo_session=...
Content-Type: application/json

{
  "note": "Ready for launch review."
}
```

Editors can request approval. Workspace admins and owners can approve or reject. Admins may publish directly; editor and API-key publish attempts must have a current `approved` state when the workspace policy requires review.

Authenticated dashboard users can download a scannable QR SVG for a published survey:

```http
GET /api/surveys/{surveyId}/qr.svg
Cookie: fo_session=...
```

The QR encodes the public `/s/{slug}` URL and uses workspace/survey branding for the dark modules.

Multi-page public surveys are represented by `question.settings.page`. The public app groups questions by that page number and keeps a single final response payload.

Survey schema logic supports these actions:

- `show_question`: public runtime shows the target question only when the condition matches.
- `skip_to_question`: public runtime jumps forward to the target question when the condition matches; publish validation blocks missing, self-targeting, backward, or circular skip paths.
- `assign_tag`: completed matching responses receive the configured `actionValue` tag.
- `set_hidden_field`: completed matching responses store `actionValue` under `targetQuestionId`.
- `calculate_score`: matching responses adjust lead score by `scoreDelta`.
- `trigger_alert`: matching responses create an in-app logic alert notification.
- `end_survey`: matching responses use `actionValue` as the completion message.
- `redirect`: matching responses use `redirectUrl` as the completion redirect.

### Submit Response

```http
POST /api/v1/surveys/{surveyId}/responses
Authorization: Bearer fo_live_xxx
Content-Type: application/json

{
  "answers": {
    "q_123": "Great service",
    "q_456": "9"
  },
  "metadata": {
    "source": "api",
    "branch": "North Clinic",
    "location": "Pune",
    "userId": "external-user-123",
    "browserId": "optional-browser-id"
  }
}
```

Survey-level duplicate prevention is enforced for API submissions when configured on the survey. Supported modes are `allow_multiple`, `one_per_browser`, `one_per_email`, `one_per_user_id`, and `one_per_ip_hash`.
Analytics responses include `bySource`, `byDevice`, `byBranch`, `byLocation`, `funnel`, `channelConversion`, and `questionDropOff`. Public survey links can also pass `branch`, `branch_id`, `location`, `city`, or `region` query parameters into response metadata.

When `settings.anonymousMode` is enabled on a survey, submitted answers are still validated, but completed stored responses redact personal answer fields such as email, phone, name, contact, employee ID, and user ID. Anonymous completion also suppresses IP hash, user-agent, browser ID, user ID, external ID, and referrer metadata, and it skips respondent/contact profile creation. Aggregation fields such as source, branch, location, language, sentiment, lead score, and non-personal answer text remain available for analytics and exports.

File upload answers use the same JSON shape as the public form:

```json
{
  "answers": {
    "upload_question_id": {
      "name": "notes.txt",
      "type": "text/plain",
      "size": 12,
      "extension": "txt",
      "dataUrl": "data:text/plain;base64,SGVsbG8="
    }
  }
}
```

The server validates configured extensions and max size, performs a scan-before-store security check, stores upload records, and returns file metadata in response exports. Local policy scanning blocks dangerous extensions and the EICAR test signature. When `FILE_SCAN_PROVIDER_URL` is configured, uploads are also checked by the external scan provider before storage. Rejected files return `file_upload_rejected` and are not stored.

When `S3_ACCESS_KEY`, `S3_SECRET_KEY`, and `S3_BUCKET` are configured, upload payloads are written to an S3/R2-compatible endpoint with signed `PUT` requests and answers keep only metadata plus object key/URL, scan status, and lifecycle retention fields. Without object storage, local development stores the data URL in the JSON-backed upload record.

Authenticated workspace viewers can request a temporary file URL:

```http
GET /api/file-uploads/{uploadId}/download-url
```

S3/R2-backed uploads return a signed `GET` URL. Local JSON uploads return their stored data URL for development. Quarantined uploads return `file_upload_quarantined`; expired uploads return `file_upload_expired`.

### List Responses

```http
GET /api/v1/responses?surveyId={surveyId}
Authorization: Bearer fo_live_xxx
```

Response listing supports combined filters:

```http
GET /api/v1/responses?surveyId={surveyId}&status=completed&sentiment=negative&source=email&tag=needs-follow-up&q=delay&from=2026-06-01&to=2026-06-30&sort=lead_desc&limit=100&offset=0
```

The authenticated dashboard route supports the same query parameters:

```http
GET /api/surveys/{surveyId}/responses?...filters
```

### Get, Update, Or Delete Response

```http
GET /api/v1/responses/{responseId}
PATCH /api/v1/responses/{responseId}
DELETE /api/v1/responses/{responseId}
Authorization: Bearer fo_live_xxx
```

The authenticated dashboard API also supports downloading an individual response PDF:

```http
GET /api/surveys/{surveyId}/responses/{responseId}/export.pdf
```

Survey-level response exports use the same dashboard filters as the response table:

```http
GET /api/surveys/{surveyId}/export.csv?...filters
GET /api/surveys/{surveyId}/export.xlsx?...filters
GET /api/surveys/{surveyId}/export.json?...filters
```

The XLSX export returns a workbook with a `Responses` sheet and a `Questions` sheet that maps answer columns back to question IDs and types.

Response patches support tags, notes, importance, status changes, and anonymization:

```json
{
  "addTag": "vip",
  "note": "Follow up today.",
  "important": true,
  "anonymize": true
}
```

### Survey Analytics

```http
GET /api/v1/surveys/{surveyId}/analytics
Authorization: Bearer fo_live_xxx
```

Authenticated analytics supports date filtering and comparison:

```http
GET /api/surveys/{surveyId}/analytics?from=2026-06-01&to=2026-06-30&compareFrom=2026-05-01&compareTo=2026-05-31
```

Workspace benchmarking compares surveys with the same date filters:

```http
GET /api/analytics/benchmark?workspaceId={workspaceId}&from=2026-06-01&to=2026-06-30
Cookie: fo_session=...
```

Authenticated dashboard survey admins can restrict a survey to selected users and grant per-survey roles:

```http
PUT /api/surveys/{surveyId}/access
```

Body:

```json
{
  "accessMode": "selected",
  "accessRules": [{ "userId": "usr_xxx", "role": "analyst" }]
}
```

Use `"accessMode": "workspace"` to return to workspace-wide role access. Grant roles may be `viewer`, `analyst`, or `editor`; owners and admins retain access.

Authenticated editors can generate a local translation draft for a survey schema:

```http
POST /api/surveys/{surveyId}/translations/generate
Cookie: fo_session=...
Content-Type: application/json

{
  "language": "es"
}
```

The draft is saved under `schema.translations[language]` and can be edited before republishing.

### Contacts

```http
GET /api/v1/contacts
POST /api/v1/contacts
GET /api/v1/contacts/{contactId}
PUT /api/v1/contacts/{contactId}
Authorization: Bearer fo_live_xxx
```

Contact create/update bodies accept `name`, `email`, `phone`, `company`, `source`, `tags`, `leadScore`, `stage`, `ownerId`, and `nextFollowUpAt`. Valid stages are `new`, `qualified`, `contacted`, `proposal`, `won`, `lost`, and `nurture`. `ownerId` must be a user who belongs to the same workspace.

### Webhooks And Logs

```http
GET /api/v1/webhooks
POST /api/v1/webhooks
POST /api/v1/webhooks/{webhookId}/test
DELETE /api/v1/webhooks/{webhookId}
GET /api/v1/webhook-logs
Authorization: Bearer fo_live_xxx
```

Webhook create body:

```json
{
  "url": "https://example.com/feedbackos",
  "events": ["response.completed"]
}
```

## Public Survey API

Public survey pages use:

```http
GET /api/public/surveys/{slug}?password=optional&lang=hi
POST /api/public/surveys/{slug}/start
POST /api/public/surveys/{slug}/responses
POST /api/public/surveys/{slug}/responses/start
GET /api/public/surveys/{slug}/responses/{responseId}?resumeToken={resumeToken}
PATCH /api/public/surveys/{slug}/responses/{responseId}
POST /api/public/surveys/{slug}/responses/{responseId}/send-resume
```

`responses/start` returns `responseId`, `resumeToken`, and `resumeExpiresAt`. The public SPA stores those values in local browser storage and uses the `GET` route to restore partial answers across reloads. `PATCH` requires the matching `resumeToken` for tokenized partial responses and clears resume credentials once the response is completed.

Respondents can email themselves a cross-device resume link:

```json
{
  "email": "person@example.com",
  "resumeToken": "fo_resume_xxx",
  "password": "optional-survey-password"
}
```

`send-resume` validates the same resume token before queueing the email. The emailed public URL includes `resumeResponseId` and `resumeToken`; opening it restores the draft in a new browser and then stores the token locally for continued autosave.

In-app SDK event resolution uses:

```http
POST /api/public/in-app/resolve
Content-Type: application/json

{
  "eventName": "onboarding_done",
  "path": "/app/onboarding/complete",
  "userId": "user_123",
  "attributes": {
    "plan": "pro"
  }
}
```

Matching published in-app surveys return `survey.slug` and `frequencyDays`; non-matches return `"survey": null`. Survey settings can configure `inAppTriggerEvent`, `inAppTargetPath`, `inAppAudienceProperty`, `inAppAudienceValue`, and `inAppFrequencyDays`.

Configured public controls are enforced by these routes:

- `passwordProtected`: include `?password=...` on `GET /api/public/surveys/{slug}` and `"password": "..."` in write bodies.
- `opensAt`: surveys scheduled for the future return `425 survey_not_open`.
- `expiresAt`: expired surveys return `410 survey_expired`.
- `responseLimit`: full surveys return `409 response_limit_reached`.
- `duplicatePrevention`: duplicate submissions return `409 duplicate_response`.
- `completionRedirectUrl`: returned in the completion payload.
- `lang`: applies schema translations from `schema.translations`.

Partial responses are completed by sending:

```json
{
  "answers": {
    "q_123": "Updated value"
  },
  "replaceAnswers": true,
  "complete": true
}
```

`replaceAnswers` is useful for public form autosave flows where conditional logic can hide a previously answered question. When omitted, partial patches merge into the existing draft answers.

### Workspace Branding

Authenticated workspace admins can update branding and white-label fields with:

```http
PUT /api/workspaces/{workspaceId}
```

Supported branding and workspace policy fields include `logoUrl`, `brandColor`, `buttonColor`, `customDomain`, `defaultSenderEmail`, `privacyPolicyUrl`, `termsUrl`, `customFooterText`, `requirePublishApproval`, `permissionPolicy`, `retentionDays`, `retentionScheduleEnabled`, `retentionNextRunAt`, and sanitized `customCss`. Public survey payloads return the sanitized CSS and footer text in `survey.branding`.

`permissionPolicy` lets workspace admins set minimum roles for sensitive actions while preserving workspace isolation and per-survey grants:

```json
{
  "permissionPolicy": {
    "responseExport": "analyst",
    "workspaceExport": "admin",
    "privacyOperations": "admin",
    "retentionOperations": "admin",
    "auditLogs": "admin",
    "integrationManagement": "admin",
    "billingManagement": "owner",
    "aiReports": "analyst"
  }
}
```

Allowed role values are `owner`, `admin`, `editor`, `analyst`, and `viewer`. `responseExport` is enforced on CSV, XLSX, JSON, and individual response PDF exports; `aiReports` is enforced on monthly report list, PDF download, generation, and scheduling.

When `customDomain` is set, the workspace response includes `customDomainVerificationToken`, `customDomainStatus`, `customDomainVerifiedAt`, `customDomainDnsCheckedAt`, `customDomainObservedTxt`, `customDomainSslStatus`, `customDomainSslProvider`, `customDomainSslCertificateId`, `customDomainSslProvisionedAt`, `customDomainSslLastError`, and `customDomainSslUpdatedAt`. Verify the DNS setup record with:

```http
POST /api/workspaces/{workspaceId}/custom-domain/verify
```

Body:

```json
{
  "txtRecord": "feedbackos-site-verification=TOKEN"
}
```

If `txtRecord` is present, the endpoint performs a manual/pasted TXT check and marks the domain `verified_local`. If the body is empty, the endpoint resolves live TXT records for the configured domain and marks the domain `verified_dns` when the expected value is present. Both paths return `expectedTxt`, `observedTxtRecords`, and `dnsCheckedAt`; SSL moves to `pending_provider` until certificate provisioning succeeds.

After DNS verification, provision the certificate through the configured hosting/DNS provider hook:

```http
POST /api/workspaces/{workspaceId}/custom-domain/provision-ssl
```

Set `CUSTOM_DOMAIN_SSL_PROVIDER_URL` to an internal Cloudflare/Railway/reverse-proxy automation endpoint. FeedbackOS sends `workspaceId`, `customDomain`, `appUrl`, `verificationToken`, and `expectedTxt` as JSON, with `Authorization: Bearer CUSTOM_DOMAIN_SSL_PROVIDER_TOKEN` when the token is configured. Provider responses should return a status such as `active`, `pending_validation`, or `failed`, plus optional `provider`, `certificateId`, `provisionedAt`, and `message`. The workspace stores the provider, certificate id, latest SSL status, provisioned timestamp, and last error for operator review.

### Workspace Team

```http
GET /api/workspaces/{workspaceId}/members
POST /api/workspaces/{workspaceId}/invites
PUT /api/workspaces/{workspaceId}/members/{memberId}
DELETE /api/workspaces/{workspaceId}/members/{memberId}
```

Admins can invite members as `admin`, `editor`, `analyst`, or `viewer`, update non-owner member roles, and remove non-owner members. Owner role changes and owner removal are blocked.

### Workspace Privacy And Export

```http
GET /api/workspaces/{workspaceId}/export.json
GET /api/workspaces/{workspaceId}/audit-logs
GET /api/workspaces/{workspaceId}/audit-logs/export.json
POST /api/workspaces/{workspaceId}/privacy/delete
POST /api/workspaces/{workspaceId}/retention/run
```

Deletion request body:

```json
{
  "email": "person@example.com",
  "mode": "anonymize"
}
```

Use `"mode": "delete"` to mark matched responses deleted instead of anonymizing them.

Retention sweeps can be run immediately with `POST /api/workspaces/{workspaceId}/retention/run`. Workspaces also carry `retentionScheduleEnabled`, `retentionLastRunAt`, and `retentionNextRunAt`; the local worker enqueues one due scheduled retention sweep per workspace when `/api/jobs/drain`, the in-process worker, or the `CRON_SECRET`-protected `POST /api/cron/run` endpoint runs.

Audit-log endpoints accept `action`, `entityType`, `userId`, `q`, `from`, `to`, `offset`, and `limit` query parameters. Returned metadata redacts keys that look like tokens, secrets, passwords, API keys, or certificates.

## Account API

```http
GET /api/profile
PUT /api/profile
POST /api/profile/password
POST /api/profile/2fa/setup
POST /api/profile/2fa/enable
POST /api/profile/2fa/disable
GET /api/sessions
DELETE /api/sessions/{sessionId}
POST /api/auth/email-verification/request
POST /api/auth/email-verification/confirm
POST /api/auth/2fa/verify
POST /api/auth/password-reset/request
POST /api/auth/password-reset/confirm
POST /api/auth/oauth/google/start
GET /api/auth/oauth/google/callback
POST /api/auth/sso/start
POST /api/auth/sso/assertion
POST /api/auth/sso/dev-login
GET /api/auth/sso/metadata/{workspaceId}
```

The local development response includes the reset token because email delivery is simulated. In production, send only via the email provider.

Email verification can be required with the super-admin platform setting. When enabled, new password signups return `emailVerificationRequired` and a local `verificationToken` instead of a session. Confirm it with `POST /api/auth/email-verification/confirm`; unverified password login returns `email_verification_required` and a local resend token in development.

Password login accepts `rememberMe: true` to issue an extended remembered session. `GET /api/sessions` returns `remembered`, `createdAt`, `expiresAt`, and `current` for device/session management.

Two-factor setup returns a local TOTP-style secret, an `otpauthUrl`, and one current local code for zero-dependency setup. After `POST /api/profile/2fa/enable`, recovery codes are returned once and stored hashed. A password login for a 2FA-enabled user returns `requiresTwoFactor`, `challengeId`, and `challengeToken`; complete login with `POST /api/auth/2fa/verify`.

Google OAuth is optional. Configure `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, and optionally the redirect/auth/token/userinfo URLs. `POST /api/auth/oauth/google/start` returns a provider authorization URL with state and PKCE challenge. The callback validates state, exchanges the code, fetches the verified email profile, signs in an existing user, or creates a new workspace-backed account when the original start request used `mode: "signup"` and accepted terms. For API tests or local clients, `responseMode: "json"` on the start request makes the callback return the normal session JSON instead of redirecting to `/`.

Workspace admins can configure local SAML-style SSO with:

```http
GET /api/workspaces/{workspaceId}/sso
PUT /api/workspaces/{workspaceId}/sso
```

SSO settings include `enabled`, `providerName`, `entityId`, `ssoUrl`, `x509Certificate`, `allowedDomains`, `enforce`, `jitProvisioning`, `defaultRole`, and `devMode`. Password login is rejected with `sso_required` when SSO is enforced for a member's email domain.

`POST /api/auth/sso/assertion` is the strict SAML assertion consumer endpoint advertised in SP metadata. It requires a pending `RelayState`, a base64 `SAMLResponse`, and a detached RSA-SHA256 `Signature` over that exact base64 response using the configured `x509Certificate` or public key. The server validates request binding, issuer, audience, destination, recipient, assertion timing, subject email domain, and optional JIT provisioning before creating a session. `devMode` and `POST /api/auth/sso/dev-login` are for local verification only.

## AI Tools

```http
POST /api/surveys/{surveyId}/ai-summary
POST /api/ai/generate-survey
POST /api/ai/improve-question
POST /api/ai/monthly-report
POST /api/ai/monthly-report/schedule
GET /api/ai/monthly-reports/{workspaceId}
GET /api/ai/monthly-reports/{workspaceId}/{reportId}.pdf
```

Outputs are marked AI-generated and scoped by workspace permissions. Survey summaries include key themes, sentiment, lead quality, urgent responses, response clusters, complaint clusters, and per-response intent classification across high intent, medium intent, low intent, support request, complaint, and spam. If `OPENAI_API_KEY` is configured, the workspace `allowExternalAi` setting is enabled, `OPENAI_MODEL` is allowed by `OPENAI_ALLOWED_MODELS`, and `AI_PROVIDER_DPA_ACCEPTED=true` has been set after legal review, AI summaries, survey generation, question improvement, and monthly reports call the OpenAI-compatible chat-completions provider from `OPENAI_BASE_URL`; otherwise they use the local deterministic fallback. Provider prompts send tenant-scoped survey metadata and bounded response excerpts, not global workspace data. `AI_PROVIDER_DPA_URL` and `AI_PROVIDER_DATA_RETENTION_DAYS` are surfaced in readiness for operator review. Admin overview includes sanitized AI provider attempt logs with task, model, status, latency, and token counts, including skipped privacy/model/policy gates. Monthly reports include a `pdfUrl` for a designed PDF download with metric cards, sentiment and lead-quality bars, trend chart, recommended actions, issues, opportunities, quotes, headers, and page footers. Scheduled report jobs generate the same report shape and use SMTP delivery when configured or local email logs otherwise.

## Campaigns

```http
GET /api/campaigns?workspaceId={workspaceId}
POST /api/campaigns
POST /api/campaigns/{campaignId}/send-now
```

Campaigns enqueue retryable email jobs for each recipient.

Campaign links include public tracking URLs:

```http
GET /api/public/campaigns/{campaignId}/open.gif?recipient={recipientHash}
GET /api/public/campaigns/{campaignId}/click?recipient={recipientHash}&url={encodedSurveyUrl}
```

The campaign list returns `openedCount`, `clickedCount`, and recent `events`.

Queued email alerts, verification/reset emails, invite campaigns, and scheduled report emails use SMTP when `SMTP_HOST` is configured. Supported SMTP settings are `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM`, and `SMTP_SECURE`. When SMTP is not configured, the local build writes simulated email logs.

## Billing

```http
GET /api/billing?workspaceId={workspaceId}
POST /api/billing/{workspaceId}/checkout
POST /api/billing/{workspaceId}/portal
POST /api/billing/{workspaceId}/invoices
POST /api/billing/{workspaceId}/payment-failed
POST /api/billing/webhook/{stripe|razorpay}
```

`checkout` creates a Stripe hosted checkout session or Razorpay order when provider credentials are configured. If no billing provider is configured, it returns a local manual checkout object so local demos can still switch plans. Billing amounts include the configured policy snapshot from `BILLING_TAX_MODE`, `BILLING_TAX_PERCENT`, `BILLING_PRORATION_POLICY`, `STRIPE_AUTOMATIC_TAX`, and `STRIPE_TAX_ID_COLLECTION`. Workspace plan changes can create proration invoices when the policy is `create_prorations` or `always_invoice`.

`portal` creates a Stripe customer portal session for Stripe-backed subscriptions and returns a local fallback otherwise. Provider webhooks are unauthenticated but require a valid `STRIPE_WEBHOOK_SECRET` or `RAZORPAY_WEBHOOK_SECRET` signature before they update subscriptions, create tax-aware paid invoices, or apply graceful payment-failure downgrades. Payment failure marks the subscription `past_due` and applies a graceful Starter downgrade.

## Admin

Super admin only:

```http
GET /api/admin/overview
GET /api/admin/readiness
GET /api/admin/settings
PUT /api/admin/settings
GET /api/admin/users
PUT /api/admin/users/{userId}
GET /api/admin/workspaces
PUT /api/admin/workspaces/{workspaceId}
GET /api/admin/audit-logs
GET /api/admin/audit-logs/export.json
GET /api/admin/templates
POST /api/admin/templates
PUT /api/admin/templates/{templateId}
```

`GET /api/admin/overview` includes `totals.errorLogs` and `recentErrorLogs` for locally captured server exceptions, plus failed job/webhook error counts. When `SENTRY_DSN` or `POSTHOG_KEY` is configured, captured server exceptions are also emitted to the monitoring provider.

`GET /api/admin/readiness` returns a protected production-readiness report with no secret values. It reports migration presence, local/runtime mode, provider-variable booleans for PostgreSQL, Redis, SMTP, Google OAuth, LLM, billing, S3/R2, monitoring telemetry, uptime checks, and alert routing, plus pass/warn/fail checks for launch blockers.

`PUT /api/admin/workspaces/{workspaceId}` supports `suspended`, `planId`, and `aiCreditLimitOverride`. Set `aiCreditLimitOverride` to a non-negative integer to override the plan AI-credit limit for that workspace, or `null`/blank to return to the plan default. AI endpoints return `402` with `error.code = "ai_credit_limit"` when the current month is exhausted.

Super admins can create, edit, publish, unpublish, or archive global custom templates. Published global templates appear in `GET /api/templates?workspaceId=...`; draft or archived global templates stay out of the workspace marketplace.

## Webhooks

Integration profiles are managed through the same authenticated integrations API:

```http
GET /api/integrations?workspaceId={workspaceId}
POST /api/integrations
```

Provider profile body:

```json
{
  "workspaceId": "wks_xxx",
  "type": "google_sheets",
  "name": "Response sheet sync",
  "config": {
    "sheetId": "sheet_123"
  },
  "events": ["response.completed"]
}
```

Supported non-webhook `type` values are `google_sheets`, `slack`, `teams`, `whatsapp`, `crm`, `zapier`, `make`, and `email`. Config is encrypted locally. Completed responses enqueue retryable provider delivery jobs and appear in the `integrationLogs` array returned by `GET /api/integrations`.

Provider delivery uses the first configured URL from `config.webhookUrl`, `config.url`, `config.apiUrl`, or the matching environment fallback such as `SLACK_WEBHOOK_URL`, `TEAMS_WEBHOOK_URL`, `GOOGLE_SHEETS_WEBHOOK_URL`, `CRM_WEBHOOK_URL`, `ZAPIER_WEBHOOK_URL`, or `MAKE_WEBHOOK_URL`. If no provider URL is configured, the local runtime records simulated delivery logs. Provider requests include `x-feedbackos-event` and `x-feedbackos-integration`; when `config.signingSecret` is present, requests also include `x-feedbackos-signature`.

Slack example:

```json
{
  "workspaceId": "wks_xxx",
  "type": "slack",
  "name": "Slack complaint alerts",
  "config": {
    "channel": "#feedback",
    "webhookUrl": "https://hooks.slack.com/services/...",
    "signingSecret": "shared-secret"
  }
}
```

Webhook jobs deliver:

```json
{
  "event": "response.completed",
  "workspaceId": "wks_xxx",
  "data": {
    "surveyId": "srv_xxx",
    "responseId": "rsp_xxx",
    "sentiment": "negative",
    "leadScore": 85
  },
  "deliveredAt": "2026-06-26T00:00:00.000Z"
}
```

Headers:

```http
x-feedbackos-event: response.completed
x-feedbackos-signature: sha256=...
```

The signature is HMAC-SHA256 over the request body using the webhook secret.
