# Formspear Launch Checklist

An unchecked item is a launch blocker. Provider and legal items require external evidence; repository tests alone cannot satisfy them.

## Current review blockers

The 7 November 2026 [production readiness review](PRODUCTION_READINESS_REVIEW.md) supersedes earlier readiness conclusions. Historical automated checks below do not clear these new gates. The [fix plan](PRODUCTION_FIX_PLAN.md) defines implementation and acceptance criteria.

- [ ] PR-01 credential serialization and production restart authentication verified.
- [ ] PR-02 single-owner web and queue topology verified with PostgreSQL and Redis.
- [ ] PR-03 through PR-06 paid-plan, bootstrap, OAuth, and sharing-policy gaps closed.
- [ ] PR-07 and PR-08 privacy operations and anonymous drafts verified across storage and delivery paths.
- [ ] PR-09 through PR-12 billing lifecycle, outbound destination checks, external browser collection, and SDK tenancy corrected.
- [ ] PR-13 through PR-15 portable backup/CI, API quotas, and suspension enforcement corrected.
- [ ] Current release evidence satisfies every applicable gate in the production fix plan.

## Automated engineering gates

- [x] Production refuses JSON persistence and missing durable providers.
- [x] Production compatibility snapshot is disabled and rejected when explicitly enabled.
- [x] Dedicated web and BullMQ worker commands exist.
- [x] CI runs syntax, migration, HTTP, dependency, performance, backup, and PostgreSQL drills.
- [x] Public initial payload is below the 50 KB gzip budget.
- [x] Desktop/mobile visual smoke checks console errors, overflow, and basic accessible labeling.
- [x] Builder browser smoke verifies edit, autosave, undo, persistence, and responsive layout.
- [x] AI themes carry validated supporting response IDs and excerpts; latest evidence-backed insight appears on the dashboard.
- [x] Dashboard exposes a four-step first-insight activation path with direct next actions.
- [x] Local PostgreSQL relational smoke and snapshot-backfill drill pass.
- [x] Disposable Redis/BullMQ worker smoke proves persisted email-job enqueue and completion.
- [ ] CI has passed on GitHub for the current commit.

## Staging provider gates

- [ ] Railway web and worker deploy successfully from the current commit.
- [ ] Managed PostgreSQL migration, relational smoke, backup, and isolated restore drill pass.
- [ ] Managed Redis processes a queued email and webhook job through the worker.
- [ ] SMTP delivers verification, reset, alert, invite, and monthly-report messages.
- [ ] Stripe test-mode checkout, portal, signed webhook, payment failure, refund, and downgrade flows pass.
- [ ] S3/R2 upload/download, external antivirus rejection, and lifecycle expiry pass.
- [ ] AI provider returns grounded themes with response provenance and acceptable evaluation quality.
- [ ] Sentry/PostHog receives an intentional test error; uptime and alert routing fire (recommended, not enforced for boot).
- [ ] Scheduler triggers retention and monthly reports using `CRON_SECRET`.

## Human approvals and launch gates

- [ ] AI DPA, retention, and subprocessor terms approved.
- [ ] Tax, invoicing, refund, and proration policy approved.
- [ ] Privacy policy, terms, deletion SLA, and subprocessor list approved.
- [ ] Security review of auth, tenant isolation, billing webhooks, uploads, and secrets completed.
- [ ] Ten to twenty beta partners complete the golden path; activation and retention targets are recorded.
- [ ] Time-to-first-insight is below five minutes for representative new users.
- [ ] On-call owner, incident contacts, status page, and release/rollback owner are assigned.
