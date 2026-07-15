# Agent Memory & Guidelines

## Core System Architecture
- Formspear backend uses a single-file composition design in `src/server.js`.
- It supports two modes of database storage:
  - In-memory database with local JSON serialization (default).
  - PostgreSQL relational mapping when `DATABASE_URL` is set.
- SSO / SAML uses manual XML building templates.
- Rates limits are managed per-process via Maps (`publicBuckets`, `authBuckets`, `apiBuckets`).

## Essential Rules & Guidelines for Antigravity
1. **Never use full-table truncates**: Always perform row-level inserts, updates, and deletes relative to `state.pgShadow` to optimize database round-trips and locking.
2. **SSRF Guard**: Always protect outbound webhook and integration calls by checking resolved DNS IP addresses. Never allow private or link-local ranges in production (bypassable for local testing using `WEBHOOK_ALLOW_PRIVATE_HOSTS=true`).
3. **Session Cookie**: Always set `Secure` on session cookies in production.
4. **Single-Writer Constraint**: Always enforce a single active web writer replica under the current in-memory model.
5. **Path Traversal Guard**: Always validate static file paths with `target !== resolvedPublicDir && !target.startsWith(resolvedPublicDir + path.sep)`.
