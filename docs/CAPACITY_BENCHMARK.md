# Capacity Benchmark: Postgres-Mode Save Cost & Memory

## Status: NOT RUN

This discovery benchmark was not executed because no live disposable PostgreSQL instance was provided (`POSTGRES_SAVE_BENCHMARK_DATABASE_URL` was unset) and the local Docker daemon was stopped (`//./pipe/dockerDesktopLinuxEngine` unreachable). In accordance with `T-P1-09` acceptance criteria, this document is marked **NOT RUN**.

## Environment & Machine Description

- **Operating System:** Windows 11 (win32, x64)
- **CPU:** Intel(R) Core(TM) Ultra 7 255H (16 physical/logical cores)
- **Total Memory:** 33.82 GB RAM
- **Node.js Version:** v24.16.0
- **Postgres Target Version:** PostgreSQL 16 (when run)
- **Script:** `scripts/postgres-save-benchmark.js` (`npm run postgres:save:benchmark`)

## Benchmark Methodology

The benchmark measures:
1. `bulkInsertMs`: Wall-clock time to insert `needed` synthetic responses (up to target N) on a single public submission save.
2. `steadySaveMs` (p50 and p95): Wall-clock duration across 20 sequential public API responses when `N` rows already reside in database.
3. `heapUsedMb` and `rssMb`: Node.js process memory after forced garbage collection (`global.gc()`).
4. `coldLoadMs`: Wall-clock time required to start a fresh server instance and serve the first public survey request from the database across restart.

Target sizes evaluated: 10,000, 100,000, and 300,000 stored responses.

## Results Table (Template)

| Target N | Bulk Insert (ms) | Steady Save p50 (ms) | Steady Save p95 (ms) | Heap Used (MB) | RSS (MB) | Cold Load (ms) | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 10,000 | - | - | - | - | - | - | NOT RUN |
| 100,000 | - | - | - | - | - | - | NOT RUN |
| 300,000 | - | - | - | - | - | - | NOT RUN |

## Plain-Language Observations

1. **Latency Threshold (p95 > 150 ms):** Measurement pending live PostgreSQL execution.
2. **Memory Threshold (Heap > 1 GB):** Measurement pending live PostgreSQL execution.
3. **Cold-Load Duration:** Measurement pending live PostgreSQL execution.

## Execution Instructions

To execute this benchmark on a host with a disposable PostgreSQL database:

```bash
export POSTGRES_SAVE_BENCHMARK_DATABASE_URL="postgres://postgres:password@localhost:5432/formspear_bench"
export POSTGRES_SAVE_BENCHMARK_CONFIRM="I_UNDERSTAND_THIS_RESETS_THE_DATABASE"
npm run postgres:save:benchmark
```

Update this document with the resulting measured table and observations once executed against PostgreSQL.
