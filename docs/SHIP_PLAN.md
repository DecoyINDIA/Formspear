# Formspear — Top 1% Ship Plan

Date: 2026-07-07
Status: active implementation

Execution evidence and remaining external gates are tracked in `docs/LAUNCH_CHECKLIST.md`. Operational response is defined in `docs/OPERATIONS_RUNBOOK.md`, and the engineering trust boundary is recorded in `docs/SECURITY_AND_PRIVACY.md`.
Current code boundaries and the incremental route-extraction convention are recorded in `docs/ARCHITECTURE.md`.

## The honest diagnosis

Formspear today is a remarkably complete *prototype*: nearly every PRD line item exists, but almost all of it at "implemented locally with fallback" depth. Top-1% products are not the ones with the most features — they are the ones where a narrow set of flows feel inevitable, fast, and trustworthy. The current shape (one 11.7k-line server file, one 3.7k-line SPA file, JSON persistence as the default, a single test file) is optimized for breadth of coverage, not for the depth, reliability, and polish that separates the top 1%.

The plan has one governing move: **stop widening, start deepening.** Cut the surface to a sharp wedge, make that wedge production-grade and delightful, and re-admit the parked features only when they can be excellent.

---

## Phase 0 — Pick the wedge (1 week, decision work)

Formspear's differentiated story is **"feedback in, decisions out"**: forms/surveys with genuinely useful AI insights (themes, intent, urgency, clustering, monthly reports). Typeform owns beautiful forms; SurveyMonkey owns enterprise surveys; nobody owns *AI-native feedback analysis for small teams*.

**Ship surface (v1):**
1. Survey builder → publish → public link/embed
2. Response collection (partial save, uploads, anonymous mode)
3. Analytics + AI insights (themes, intent, urgent flags, monthly report)
4. Alerts → Slack/email
5. Billing (Stripe only), workspaces, team invites

**Park behind a flag (not deleted, just not sold):** SAML/SSO, agency portal, custom plans, Razorpay, WhatsApp/Teams/CRM integrations, publish approvals, custom domains, campaigns, API v1. Each returns only when it can be top-1% on its own.

## Phase 1 — Foundation you can trust (3–4 weeks)

The prototype's biggest liability is that nothing has been proven under production conditions.

1. **Postgres becomes the only production path.** JSON persistence stays as a dev convenience only; boot refuses production mode without `DATABASE_URL`. Kill the dual-write compatibility snapshot once the backfill drill passes against real data.
2. **Break up the monolith.** Split `src/server.js` (11.7k lines) into route modules (`auth`, `surveys`, `responses`, `analytics`, `ai`, `billing`, `admin`) with a shared context object. Same zero-framework ethos, but reviewable, testable units. Same for `public/app.js`.
3. **Test pyramid + CI.** One test file → per-module unit tests, API integration tests against Postgres in CI (GitHub Actions), and a Playwright e2e covering the golden path: signup → build → publish → submit → see AI insight. Every merge runs it.
4. **Verify the "when configured" claims.** Stripe webhooks, SMTP, S3/R2, Redis/BullMQ, Sentry — each gets an end-to-end verification in a staging environment on Railway. "Local fallback" is no longer an acceptable terminal state for a shipped feature.
5. **Security hardening pass.** External review of auth/session/2FA/reset flows, remove dev-mode SSO login entirely from production builds, CSP + security headers, dependency and secrets audit, upload-scan policy verified against a real AV provider.

## Phase 2 — Product excellence in the wedge (4–6 weeks)

This is where top-1% is won or lost. The bar: a new user gets their first real response and first AI insight in **under 5 minutes**, and every screen they touch feels designed.

1. **Public form runtime as the crown jewel.** It is the most-seen surface (respondents outnumber customers 1000:1). Target: < 50KB initial payload, sub-second load, flawless mobile, WCAG 2.1 AA, keyboard-completable, beautiful defaults. This is also the growth engine — "Powered by Formspear" on free-tier forms.
2. **Builder UX rebuild.** The vanilla-DOM builder cannot reach Typeform-class feel. Adopt a component framework (React/Svelte) for the authenticated app only; keep the public runtime dependency-light. Drag-reorder, inline editing, live preview, undo, autosave — table stakes at the top.
3. **AI insights as the hero.** Move from "summary on demand" to insights that appear proactively: themes surface on the dashboard, urgent responses trigger alerts with the quote inline, the monthly report emails itself. Show provenance (which responses back each theme) — trust is the moat for AI features.
4. **Onboarding + empty states.** Template-first creation, sample data preview in analytics before the first response arrives, a checklist that actually drives activation.
5. **Performance budgets enforced in CI** (public runtime bundle size, p95 API latency from the existing performance smoke, dashboard with 100k responses).

## Phase 3 — Commercial and operational readiness (2–3 weeks, overlaps Phase 2)

1. **Billing done completely:** Stripe checkout, portal, webhooks, dunning, downgrade — tested with real test-mode money, including failure and refund paths.
2. **Operations:** staging + production environments, automated backups with a restore drill on a schedule (script exists — put it on cron and alert on failure), uptime monitoring, status page, error alerting to the team, on-call runbook.
3. **Trust surface:** privacy policy/DPA/subprocessor list reviewed, data-deletion SLA, GDPR export verified, security page. SOC 2 is post-launch but design the audit trail now (it mostly exists).
4. **Docs + marketing site:** real landing page with live demo form, honest pricing page, API docs for the parked API when it returns.

## Phase 4 — Launch and the feedback loop (ongoing)

1. Private beta with 10–20 design partners from the target segment; weekly interviews; instrument activation funnel (PostHog hooks exist — turn them on and define the metrics: signup→publish, publish→first response, response→insight viewed).
2. Public launch (Product Hunt + the free-tier embed loop) only after beta retention holds.
3. Re-admit parked features by pull, not push: when three paying customers ask for SSO, build SSO properly.

---

## What "top 1%" means as exit criteria

- Golden path e2e green on every commit; zero data stored in JSON files in production.
- Time-to-first-insight < 5 minutes for a new signup.
- Public form: < 1s load on 3G, WCAG AA, works with JS-heavy embeds.
- Every shipped feature verified against its real provider — no "simulated fallback" in the sold product.
- A stranger can sign up, pay, get value, and delete their data without a human in the loop.

## Biggest risks

1. **Scope gravity** — the codebase makes it easy to keep polishing breadth. The park-list is the defense; it needs to be enforced in the UI, not just the roadmap.
2. **Monolith refactor stalling feature work** — do it module-by-module behind passing tests, never a big-bang rewrite.
3. **AI insight quality** — the local fallback classifier is a demo, not a product. Budget real eval time with real feedback data from beta partners.
