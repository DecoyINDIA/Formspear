# Formspear Operations Runbook

## Service topology

- `web`: `node src/server.js` (Formspear currently runs a single writer instance. Do not scale `web` replicas above 1 until the row-level persistence refactor lands. Horizontal read-replica scaling is not yet supported. See docs/REVIEW_REMEDIATION_PLAN.md ITEM-2.)
- Queue consumer: runs inside the single `web` process when `REDIS_URL` is set.
- PostgreSQL: only production data path
- Redis/BullMQ: only production job path
- External scheduler: call `POST /api/cron/run` with `Authorization: Bearer <CRON_SECRET>` every minute

Production startup fails closed when any required durable provider or security setting is missing. Run `npm.cmd run production:check` against the exact deployment environment before releasing.

## Deploy procedure

1. Run `npm.cmd run migrate` against a backed-up database.
2. Run `npm.cmd run postgres:relational:smoke` against a disposable database on the same PostgreSQL version.
3. Run `npm.cmd run production:check` in the web environment.
4. Deploy one web instance and confirm it connects to PostgreSQL and Redis.
5. Confirm `/api/health`, authenticated `/api/admin/readiness`, signup, publish, public submission, AI insight, email, and Stripe test-mode checkout/webhook.
6. Watch error telemetry and queue failures for at least 15 minutes before completing rollout.

## Rollback

1. Stop new deploy traffic and pause the scheduler.
2. Roll back the web service to the previous image.
3. Do not reverse a database migration until its rollback has been tested on a restored backup.
4. Restore PostgreSQL only for confirmed data corruption; preserve the failed database for investigation.
5. Resume web traffic, then the scheduler. Verify one job and one public response end to end.

## Incident priorities

- P0: data exposure, authentication bypass, unrecoverable writes, billing corruption.
- P1: public response collection unavailable, queue stopped, email/alert delivery stopped.
- P2: degraded analytics, AI, exports, or admin operations.

For P0/P1: acknowledge within 15 minutes, assign an incident lead, preserve logs, rotate affected credentials, and post status updates every 30 minutes. Never paste secrets or respondent data into tickets or chat.

## Backup and restore

- Enable managed PostgreSQL backups and point-in-time recovery.
- Run a scheduled monthly restore into an isolated database.
- After restore, run migration verification and a read-only count reconciliation for workspaces, surveys, responses, users, jobs, invoices, and audit logs.
- Record date, backup identifier, restored target, row-count comparison, operator, and result.

## Routine checks

- Daily: uptime, failed jobs, error telemetry, SMTP/billing/provider failures.
- Weekly: dependency audit, storage lifecycle, queue depth, database growth.
- Monthly: restore drill, access review, secret age, deletion-SLA review, AI/provider policy review.
