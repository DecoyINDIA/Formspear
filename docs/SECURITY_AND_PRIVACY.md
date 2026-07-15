# Security and Privacy Readiness

## Implemented controls

- Passwords use salted `scrypt`; sessions are revocable and support expiry and optional 2FA.
- Verification and password-reset credentials are delivered by email jobs and never returned by HTTP.
- Auth endpoints are rate-limited; production SSO development login is blocked.
- Provider and webhook secrets are encrypted at rest; production refuses placeholder encryption secrets.
- Cookie-authenticated writes require same-origin requests. Security headers and a script CSP are applied globally.
- File uploads are type/size checked and production requires a fail-closed external scanner and object storage.
- Workspace isolation and role/policy checks cover tenant operations. Audit exports redact secret-looking metadata.
- Production requires PostgreSQL, Redis, provider credentials, monitoring, and HTTPS; JSON/provider simulations cannot boot as production.

## Data-subject operations

- Workspace export: `GET /api/workspaces/{workspaceId}/export`
- Privacy deletion/anonymization: `POST /api/workspaces/{workspaceId}/privacy/delete`
- Response anonymization and deletion are available in the response API/UI.
- Target operational SLA: acknowledge verified deletion requests within 2 business days and complete them within 30 days unless a documented legal hold applies.

## Subprocessors to approve before launch

Record the selected legal entity, service, purpose, processing region, DPA URL, retention, and transfer mechanism for:

- Railway or selected compute/PostgreSQL/Redis provider
- S3/R2 object-storage provider
- SMTP/email provider
- OpenAI-compatible AI provider
- Stripe
- Sentry or PostHog
- File-scanning provider

This file is engineering evidence, not legal approval. Legal owners must approve the final privacy policy, DPA, subprocessors, retention schedule, tax policy, and incident notification terms.

## Release evidence

Attach the CI run, production configuration check, PostgreSQL drill, backup restore record, provider test receipts, accessibility smoke manifest, dependency audit, and authenticated readiness JSON to each production release record.

## Future SSO (SAML) Migration Note

The current SAML implementation uses custom XML template compilation for SSO responses. While functional, production enterprise deployments should migrate to an industry-standard, audited library (such as `@node-saml/node-saml` or `saml2-js`). This transition will ensure robust handling of XML signature verification, assertion encryption, and XML parsing safety (preventing potential XML External Entity/XXE issues).
