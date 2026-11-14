# E-01: Repository Layer Design Packet & Implementation Plan

## 1. Executive Summary

This packet maps every read and write of `db.responses` in `src/server.js`, specifies the repository interface (`responsesRepo`, `jobsRepo`, `auditLogsRepo`), details the dual-read verification protocol, and defines the transition sequence to shrink JSON `state.db`.

## 2. Call-Site Inventory for `db.responses`

There are 34 primary call sites for `db.responses` in `src/server.js`:

1. **Lines 1826, 1838, 1851 (`handleSurveys` - exports & analytics)**:
   - Filters responses by `surveyId` and `status !== 'deleted'`.
   - Requires: survey-level filtering, pagination/unpaginated mode for CSV/Excel export.
2. **Line 2087 (`handleContacts` - contact response history)**:
   - Matches responses by `workspaceId` and `respondentId` associated with `contact.email`.
3. **Line 2119 (`handleFileUploads` - response file upload validation)**:
   - Looks up parent response by `upload.responseId`.
4. **Lines 2744, 2750 (`handleResponses` - response list and detail GET)**:
   - Fetches responses for survey or specific response by ID and workspace.
5. **Lines 2826, 2835 (`handleResponses` - response creation & patch)**:
   - Pushes new response or updates existing response status/tags/notes.
6. **Lines 2877, 2931 (`handleResponses` - filtering & contact response queries)**:
   - Filters responses by workspace, tags, sentiment, date ranges.
7. **Lines 3147, 3168, 3194, 3229, 3323 (`handlePublicSurveyResponses` - public respondent flow)**:
   - Creates response (`/start`), finds partial draft, updates draft (`PATCH`), and submits completed response.
8. **Lines 5292, 5434, 5475, 5487 (`retention` & `workspace deletion`)**:
   - Sweeps old responses for data retention and cascades deletions on workspace wipe.
9. **Lines 6908, 7118 (`survey statistics & metrics`)**:
   - Computes completed response count for dashboard and survey cards.
10. **Lines 7173, 7204, 7353, 7371, 7458 (`analytics & exports`)**:
    - Aggregates NPS, CSAT, sentiment, completion rates, and benchmark metrics.
11. **Lines 7956, 7991 (`monthly AI reports`)**:
    - Samples completed responses for monthly executive reports.
12. **Lines 9498, 9727, 9728 (`GDPR / privacy deletion`)**:
    - Anonymizes or deletes individual response records on request.
13. **Lines 10644, 10658 (`admin dashboard & overview`)**:
    - Computes global and workspace-level response volume.

## 3. Repository Interfaces

### `responsesRepo`
- `findById(db, state, id, workspaceId = null)`: Fetches response by ID; queries PostgreSQL if configured, otherwise memory.
- `listBySurvey(db, state, surveyId, options)`: Returns responses for a survey with optional status and limit filters.
- `listByWorkspace(db, state, workspaceId, options)`: Returns responses for a workspace with optional filters.
- `count(db, state, filter)`: Returns response count efficiently via SQL `COUNT(*)` or array length.
- `save(db, state, response)`: Upserts into in-memory state and SQL table.
- `dualReadVerify(db, state, id)`: Compares in-memory JSON record with SQL row and returns `{ matched, divergence }`.

### `jobsRepo`
- `listDue(db, state, now, limit)`: Returns due queued/retrying jobs ordered by `next_run_at`.
- `save(db, state, job)`: Upserts job into storage.

### `auditLogsRepo`
- `append(db, state, log)`: Inserts append-only audit event into storage.
- `listByWorkspace(db, state, workspaceId, limit)`: Lists recent audit logs.

## 4. Dual-Read Verification & Rollout Plan

1. **Phase 1: Dual-Write (Current)**:
   - Every write writes to both in-memory `db` and PostgreSQL relational tables.
2. **Phase 2: Repository Abstraction (Implemented)**:
   - Routes interact through `responsesRepo`, `jobsRepo`, and `auditLogsRepo`.
   - `dualReadVerify` checks for any state drift between SQL and JSON.
3. **Phase 3: SQL-Only Reads**:
   - In PostgreSQL mode, queries bypass in-memory array scans and use indexed SQL queries, reducing node process heap usage.
4. **Phase 4: Shrink `state.db`**:
   - Archived responses and completed jobs over 30 days are omitted from JSON snapshot backups, keeping `state.db` lean.
