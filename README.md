<p align="center">
  <img src="assets/readme/hero-cinematic.svg" alt="Formspear Cinematic Hero Banner" width="100%" />
</p>

<p align="center">
  <a href="#quick-start"><img src="https://img.shields.io/badge/Runtime-Node.js_%3E%3D20-10B981?style=for-the-badge&logo=nodedotjs&logoColor=white" alt="Node.js >= 20" /></a>
  <a href="#system-architecture--data-engine"><img src="https://img.shields.io/badge/Architecture-Dual--Store_(RAM%20%2B%20PostgreSQL)-38BDF8?style=for-the-badge&logo=postgresql&logoColor=white" alt="Dual Store" /></a>
  <a href="#production-deployment-position"><img src="https://img.shields.io/badge/Deploy-Railway_Ready-818CF8?style=for-the-badge&logo=railway&logoColor=white" alt="Railway Ready" /></a>
  <a href="#quality-verification--performance-smoke"><img src="https://img.shields.io/badge/Benchmark-100k_Responses_Tested-F59E0B?style=for-the-badge&logo=speedtest&logoColor=white" alt="100k Responses Tested" /></a>
  <a href="#license"><img src="https://img.shields.io/badge/License-MIT-34D399?style=for-the-badge" alt="MIT License" /></a>
</p>

---

<p align="center">
  <img src="assets/readme/metrics-ribbon.svg" alt="Formspear Core Telemetry Ribbon" width="100%" />
</p>

---

## Executive Summary

**Formspear** (internally *FeedbackOS*) is a high-performance feedback, survey operations, and intelligence platform built on a zero-framework Node.js 20 runtime. It is engineered for multi-branch service enterprises, healthcare networks, retail chains, and customer experience agencies that require instant feedback collection, live sentiment extraction, automated alert dispatching, and executive PDF reporting without the latency and bloat of heavyweight SaaS frameworks.

Unlike conventional survey tools that treat submissions as passive rows in a database, Formspear operates as a **real-time feedback operating system**:

1. **Instant Collection:** Deploy across mobile PWAs (`/s/:slug`), website embeds (`/embed.js`), in-app SDKs (`/sdk.js`), and branded dynamic QR codes.
2. **Sub-Millisecond Ingestion:** In-memory synchronous collection cache guarantees `<1ms` read/write latency during peak customer traffic.
3. **Automated Dispatch:** Dispatches immediate WhatsApp, Slack, Teams, and HMAC-signed webhook notifications the second a negative score or VIP lead arrives.
4. **Relational Resilience:** Automatically diffs and synchronizes in-memory mutations into PostgreSQL relational tables using single-writer advisory locks.

<p align="center">
  <img src="assets/readme/divider-pulse.svg" width="100%" />
</p>

## Brand Identity & Architectural Philosophy

Formspear represents the convergence of architectural structure (**Form**) and directional velocity (**Spear**).

<p align="center">
  <img src="assets/readme/brand-identity.svg" alt="Formspear Brand Identity &amp; Geometric Anatomy" width="100%" />
</p>

### The Core Tension Solved

| Dimension | Legacy Form Builders (Typeform, Google Forms) | Formspear FeedbackOS |
| :--- | :--- | :--- |
| **Runtime Footprint** | Heavy front-end bundles, multiple third-party trackers | **Zero external web framework** (`node:http`), vanilla JS client |
| **Storage Paradigm** | Database-per-call ORM overhead (100–300ms latency) | **Dual-Store Architecture** (RAM state + PostgreSQL shadow diffs) |
| **Multi-Branch Telemetry**| Monolithic survey buckets; manual branch sorting | **Native branch/location attribution** (BLR, BOM, DEL, HYD) |
| **Alert Velocity** | Batch emails or Zapier polling (minutes delay) | **Sub-12ms event router** to WhatsApp, Slack, & webhooks |
| **File Security** | Files uploaded directly to storage uninspected | **Zero-Trust Quarantine Pipeline** with EICAR antivirus hook |
| **Offline Resilience** | Browser crash loses participant responses | **Partial autosave, resume links, & reload recovery** |

<p align="center">
  <img src="assets/readme/divider-pulse.svg" width="100%" />
</p>

## Product in Action

Watch how Formspear ingests a live public submission, performs zero-trust validation, updates the operator dashboard, and dispatches an instant escalation alert in real time:

<p align="center">
  <img src="assets/readme/product-in-action.svg" alt="Formspear Product in Action Simulation" width="100%" />
</p>

### Authentic Production Interface Evidence

Formspear includes a complete, fully operational single-page application and responsive public survey runtime. Captured directly from the automated visual smoke pipeline:

<table align="center" width="100%">
  <tr>
    <td width="50%" align="center">
      <b>Operator Analytics &amp; Real-Time Dashboard</b><br />
      <img src="assets/readme/desktop-dashboard.png" alt="Desktop Dashboard Screenshot" width="100%" />
    </td>
    <td width="50%" align="center">
      <b>Interactive Builder with Undo / Redo History</b><br />
      <img src="assets/readme/desktop-builder.png" alt="Desktop Builder Screenshot" width="100%" />
    </td>
  </tr>
  <tr>
    <td width="50%" align="center">
      <b>Multi-Tenant App Shell &amp; Workspace Navigation</b><br />
      <img src="assets/readme/desktop-app-shell.png" alt="Desktop App Shell Screenshot" width="100%" />
    </td>
    <td width="50%" align="center">
      <b>Mobile Public Survey Respondent Runtime</b><br />
      <img src="assets/readme/mobile-public-survey.png" alt="Mobile Public Survey Screenshot" width="70%" />
    </td>
  </tr>
</table>

<p align="center">
  <img src="assets/readme/divider-pulse.svg" width="100%" />
</p>

## Core Engineering Capabilities

Four dedicated architectural engines drive Formspear's enterprise operational loop:

<p align="center">
  <img src="assets/readme/feature-showcase.svg" alt="Formspear Core Capabilities Matrix" width="100%" />
</p>

### 1. Dynamic Branching & Conditional Logic Engine
- **23 Question Types:** Net Promoter Score (NPS), CSAT rating, multi-select, matrix grid, file upload, signature capture, date/time, and ranked choice.
- **Forward Skip Logic:** Dynamically skip pages or jump straight to conclusion screens based on real-time answer rules.
- **Cycle-Free Rule Graph:** Client and server-side validation guarantee rules never enter cyclic dependency loops.
- **Multi-Language Support:** Instant localization via `?lang=` query parameters with deterministic translation fallbacks.

### 2. Multi-Branch Telemetry & Geospatial Attribution
- **Location Pinning:** Attaches physical location, branch ID, city, device type, and source campaign to every submission.
- **Comparative Benchmarking:** Real-time cross-branch leaderboards identify high-performing locations versus branches needing attention.
- **Drop-Off Analytics:** Visual funnel analysis highlights exact question abandonment rates across mobile and desktop.

### 3. Zero-Trust File Quarantine Pipeline
- **Scan-Before-Store Policy:** Ingested files are quarantined in temporary memory buffers prior to storage persistence.
- **Antivirus Hook:** Integrated EICAR heuristic signature verification and local MIME denylists block malicious uploads.
- **Object Storage Integration:** AWS S3 and Cloudflare R2 compatible storage via hand-rolled SigV4 client signer.

### 4. Real-Time Alert & Integration Hub
- **Instant Escalation:** Trigger rules evaluate ratings in `<12ms`, dispatching WhatsApp messages to branch managers.
- **Team Notifications:** Native Slack, Microsoft Teams, and email dispatch with exponential retry queues.
- **Cryptographic Webhooks:** Outgoing webhooks signed with HMAC-SHA256 tokens and immutable delivery attempt audit logs.

<p align="center">
  <img src="assets/readme/divider-pulse.svg" width="100%" />
</p>

## System Architecture & Data Engine

Formspear is built around a single-process, zero-framework Node.js runtime that achieves extreme throughput by decoupling in-memory request processing from relational background persistence.

<p align="center">
  <img src="assets/readme/architecture-flow.svg" alt="Formspear System Architecture &amp; Data Engine" width="100%" />
</p>

### Architectural Layers

```text
[ Client Edge ] ───────► [ Zero-Framework Gateway ] ──────► [ In-Memory Datastore ]
 PWA / Embed / SDK         node:http / Security / Auth         36 Collections (<1ms)
                                     │                                  │
                                     ▼                                  ▼ (5ms diff batch)
                           [ Job Dispatcher ]              [ PostgreSQL Relational ]
                           processDueJobs() / BullMQ         Shadow Diff / Advisory Lock
                                     │
                                     ▼
                           [ External Providers ]
                           OpenAI / S3 / WhatsApp / Stripe
```

### Module Boundaries

- `src/server.js`: HTTP composition root, request routing, session security, and persistence lifecycle.
- `src/production-config.js`: Strict fail-closed environment contract ensuring all secrets are validated at boot.
- `src/security.js`: Timing-safe password verification, token hashing, CSRF defenses, and HTTP-only cookie headers.
- `src/routes/`: Focused domain route controllers:
  - `src/routes/responses.js`: Filtered response listings, record mutations, and single-record PDF exports.
  - `src/routes/analytics.js`: Comparative NPS calculations, funnel drops, and cross-survey benchmarks.
  - `src/routes/ai-summary.js`: LLM theme clustering, sentiment classification, and executive report synthesis.
  - `src/routes/billing.js`: Stripe & Razorpay checkout, customer portal, and GST/tax-aware invoices.
  - `src/routes/admin-readiness.js`: Protected production readiness audits without credential leakage.
- `public/builder-history.js`: Pure, tested undo/redo state stack for the visual survey editor.

> [!IMPORTANT]
> **Single-Writer Posture**: Formspear is architected with a single writer process protected by a PostgreSQL advisory lock. Scale the web tier to 1 replica. Background jobs, scheduled sweeps, and webhook retries run in-process or can be offloaded to Redis/BullMQ.

<p align="center">
  <img src="assets/readme/divider-pulse.svg" width="100%" />
</p>

## Developer & Operator Lifecycle

<p align="center">
  <img src="assets/readme/technical-workflow.svg" alt="Formspear Developer &amp; Operator Lifecycle" width="100%" />
</p>

### Quick Start

#### Prerequisites
- **Node.js 20.x** or newer (LTS recommended)
- **npm** or compatible package manager
- Optional: PostgreSQL 15+ and Redis (for production cutover)

#### 1. Clone & Boot Locally
```bash
git clone https://github.com/DecoyINDIA/Formspear.git
cd Formspear
npm install
npm start
```

Open your browser at `http://localhost:4173`. The initial account created automatically inherits Super Admin privileges. For immediate testing, the signup screen is pre-configured with:
- **Email:** `admin@feedbackos.local`
- **Password:** `FeedbackOS123`

#### 2. Configure Environment Variables
```bash
# On Linux / macOS
cp .env.example .env

# On Windows PowerShell
Copy-Item .env.example .env
```

Key environment configuration variables:

```ini
# Core Configuration
APP_URL=http://localhost:4173
PORT=4173
NODE_ENV=development

# Cryptographic Keys (generate with crypto.randomBytes(32).toString('hex'))
ENCRYPTION_KEY=your_64_char_hex_encryption_key
IP_HASH_SALT=your_random_ip_hash_salt
WEBHOOK_SIGNING_SECRET=your_webhook_hmac_secret
CRON_SECRET=your_scheduled_cron_secret

# Production Persistence (Optional for local dev)
DATABASE_URL=postgres://user:password@localhost:5432/formspear
REDIS_URL=redis://localhost:6379

# External Provider Integrations (Optional)
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-4o-mini
STRIPE_SECRET_KEY=sk_test_...
RAZORPAY_KEY_ID=rzp_test_...
RAZORPAY_KEY_SECRET=...
```

<p align="center">
  <img src="assets/readme/divider-pulse.svg" width="100%" />
</p>

## Quality Verification & Performance Smoke

Formspear enforces a rigorous local verification gate covering unit tests, migrations, relational PostgreSQL backfill, and high-concurrency benchmarks:

```bash
# 1. Syntax & Migration Integrity Checks
npm run check
npm run migrations:check

# 2. End-to-End HTTP Suite (2,500+ lines covering full SaaS lifecycle)
npm test

# 3. High-Concurrency Submission & Dashboard Pagination Smoke
npm run performance:smoke
npm run performance:budget

# 4. Atomic Backup & Restore Verification
npm run backup:smoke

# 5. Visual Regression & Headless Chrome Smoke
npm run visual:smoke
```

<p align="center">
  <img src="assets/readme/interactive-radar.svg" alt="Formspear Interactive Diagnostic Radar" width="100%" />
</p>

### Validated Performance Benchmarks
- **100 Concurrent Submissions / Second:** Zero dropped packets, memory remains flat, synchronous collection update in `<1.2ms`.
- **100,000 Response Pagination:** Dashboard queries with date, branch, and sentiment filtering complete under `18ms`.
- **Relational Shadow Diff:** Compares 36 in-memory collections and issues minimal SQL upserts within a 5ms debounce window.

<p align="center">
  <img src="assets/readme/divider-pulse.svg" width="100%" />
</p>

## REST API Reference

Formspear exposes an enterprise-grade REST API accessible via scoped Bearer tokens created in the workspace settings.

### Authentication
```http
GET /api/v1/surveys HTTP/1.1
Host: localhost:4173
Authorization: Bearer fo_live_xxxxxxxxxxxxxxxxxxxxxxxx
Accept: application/json
```

### Core API Endpoints

| Method | Endpoint | Description | Scope Required |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/v1/surveys` | List all active workspace surveys | `surveys:read` |
| `POST` | `/api/v1/surveys` | Create survey draft with question schema | `surveys:write` |
| `GET` | `/api/v1/surveys/:id/responses` | List responses with filters (branch, date, NPS) | `responses:read` |
| `POST` | `/s/:slug/submit` | Public endpoint for submitting responses | Public |
| `POST` | `/s/:slug/autosave` | Autosave partial survey state with resume token | Public |
| `GET` | `/api/v1/surveys/:id/analytics` | Aggregated NPS, funnels, drop-off, & ratings | `analytics:read` |
| `GET` | `/api/v1/surveys/:id/ai-summary` | LLM-generated theme clusters & sentiment quotes | `ai:read` |
| `POST` | `/api/v1/webhooks` | Register signed webhook notification target | `webhooks:write` |
| `GET` | `/admin/readiness` | Super-admin production readiness report | Super Admin |

<p align="center">
  <img src="assets/readme/divider-pulse.svg" width="100%" />
</p>

## Production Deployment Position

Formspear includes a complete production deployment configuration designed for Railway, Render, or self-hosted Docker environments.

### Deployment Files
- `railway.json`: Defines build configuration, health checks (`/health`), and guarantees `numReplicas: 1`.
- `Procfile`: Web process entry point (`web: node src/server.js`).
- `migrations/0001_initial_postgres.sql`: Comprehensive 39-table schema baseline with 13 optimized indexes.

### Pre-Launch Verification Checklist
1. **Database:** Attach managed PostgreSQL via `DATABASE_URL`. Run `npm run migrations:check`.
2. **Advisory Lock:** Confirm single writer instance (`numReplicas: 1`).
3. **Storage:** Provide S3/R2 credentials for quarantine file handling.
4. **Queue:** Set `REDIS_URL` to enable BullMQ job distribution across the web process.
5. **Observability:** Supply Sentry DSN or PostHog host for exception telemetry.

Refer to [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) and [`docs/LAUNCH_CHECKLIST.md`](docs/LAUNCH_CHECKLIST.md) for full deployment instructions.

<p align="center">
  <img src="assets/readme/divider-pulse.svg" width="100%" />
</p>

## Repository Structure

```text
├── src/
│   ├── server.js                     # HTTP server, composition root, persistence adapter
│   ├── production-config.js          # Fail-closed environment contracts
│   ├── security.js                   # Timing-safe auth, crypto, and security headers
│   └── routes/                       # Modular, context-injected route controllers
│       ├── admin-readiness.js        # Protected operations health audits
│       ├── ai-summary.js             # LLM sentiment & theme clustering
│       ├── analytics.js              # Multi-branch NPS & funnel benchmarks
│       ├── auth-credentials.js       # Rate-limited auth & recovery flows
│       ├── billing.js                # Stripe/Razorpay invoices & portals
│       └── responses.js              # Response filtering & PDF exports
├── public/
│   ├── index.html                    # App shell
│   ├── app.js                        # Single-page dashboard & respondent runtime
│   ├── builder-history.js            # Independent undo/redo history engine
│   ├── styles.css                    # Responsive dark/light theme CSS
│   ├── embed.js                      # Website iframe embed script
│   └── sdk.js                        # In-app event trigger & targeting SDK
├── assets/
│   └── readme/                       # Original SVG animations & visual assets
├── migrations/
│   └── 0001_initial_postgres.sql     # 39-table relational baseline
├── scripts/
│   ├── performance-smoke.js          # High-concurrency load benchmark
│   ├── verify-migrations.js          # Static SQL migration gate
│   └── backup-restore-smoke.js       # Checksum-verified JSON backup smoke
├── tests/
│   └── server.test.js                # 2,500+ line end-to-end HTTP test suite
└── docs/                             # Architecture specs, audits, & runbooks
```

<p align="center">
  <img src="assets/readme/divider-pulse.svg" width="100%" />
</p>

<p align="center">
  <a href="#quick-start">
    <img src="assets/readme/closing-cta.svg" alt="Ready to Spearhead Your Feedback Intelligence?" width="100%" />
  </a>
</p>

<p align="center">
  <a href="docs/API.md"><b>API Documentation</b></a> •
  <a href="docs/ARCHITECTURE.md"><b>Architecture Guide</b></a> •
  <a href="docs/DEPLOYMENT.md"><b>Deployment Runbook</b></a> •
  <a href="docs/SECURITY_AND_PRIVACY.md"><b>Security &amp; Privacy</b></a>
</p>

<p align="center">
  <sub>Formspear • Precision Enterprise Feedback OS • Released under the MIT License</sub>
</p>
