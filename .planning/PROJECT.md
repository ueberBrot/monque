# Monque — Hardening Milestone

## What This Is

A quality, performance, and test coverage hardening pass for Monque, an open-source MongoDB-backed job scheduler library for Node.js. This milestone addresses all non-breaking concerns identified in the codebase audit — no public API changes, no major version bump required.

## Core Value

Every concern resolved reduces risk for production consumers and improves maintainability for contributors, without breaking existing integrations.

## Requirements

### Validated

- ✓ Job scheduling with cron and one-time jobs — existing
- ✓ Atomic job claiming via findOneAndUpdate — existing
- ✓ Exponential backoff retry with configurable limits — existing
- ✓ Change stream reactive notification + polling fallback — existing
- ✓ Graceful shutdown with configurable timeout — existing
- ✓ Heartbeat monitoring for processing jobs — existing
- ✓ Job retention/cleanup with configurable TTLs — existing
- ✓ Stale job recovery on startup — existing
- ✓ Type-safe EventEmitter with MonqueEventMap — existing
- ✓ Cursor-based pagination for job queries — existing
- ✓ Queue statistics via aggregation pipeline — existing
- ✓ Ts.ED framework integration with decorators — existing
- ✓ Batch index creation with skipIndexCreation option — #188
- ✓ Safe error normalization via toError() utility — #186
- ✓ Atomic status transitions in completeJob/failJob — #187
- ✓ documentToPersistedJob round-trip test + extraction — #189

### Active

- [ ] Unit tests for MonqueModule.registerJobs() in tsed package
- [ ] getQueueStats aggregation timeout path test
- [ ] Cleanup/retention concurrent instance test
- [ ] Bulk operation optimization for cancelJobs/retryJobs
- [ ] getQueueStats TTL-based caching
- [ ] Optional maxPayloadSize validation on job data
- [ ] schedulerInstanceId collision startup check
- [ ] Monque class size reduction (extract lifecycle/timers or deduplicate JSDoc)
- [ ] documentToPersistedJob mapper robustness (schema-driven or generated)

### Out of Scope

- Deprecated option removal (defaultConcurrency/maxConcurrency) — requires major version bump
- Dead-letter queue mechanism — separate feature milestone
- Job progress tracking — separate feature milestone
- Job timeout enforcement during processing — separate feature milestone
- Job priority system — separate feature milestone
- Authentication/authorization middleware — library consumers' responsibility

## Context

- Brownfield: mature library at v1.3.0, published to npm
- Codebase audit completed 2026-02-24 (see `.planning/codebase/`)
- 4 of 13 original concerns already resolved in PRs #186-#189
- 9 remaining concerns are all non-breaking (minor/patch releases)
- Existing test coverage: 85%+ lines/functions/statements, 75%+ branches
- Tech stack: TypeScript, Bun, Vitest, MongoDB native driver, Turborepo monorepo

## Constraints

- **Non-breaking**: Zero public API changes — all work must be backward-compatible
- **Test-first**: Every source change must have corresponding test coverage
- **Style**: Follow existing Biome config, naming conventions, and patterns documented in `.planning/codebase/CONVENTIONS.md`
- **Perf claims**: Performance optimizations must be validated with before/after measurements or reasoning about reduced DB round-trips

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Non-breaking only | Avoid major version bump, ship improvements incrementally | — Pending |
| Address all 9 remaining concerns | Complete the audit cleanup in one milestone | — Pending |
| Test gaps first | Low effort, immediate risk reduction, no source changes | — Pending |

---
*Last updated: 2026-02-27 after initialization*
