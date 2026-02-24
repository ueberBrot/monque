# External Integrations

**Analysis Date:** 2026-02-24

## APIs & External Services

**No external API integrations.** Monque is a self-contained library that only integrates with MongoDB. It does not call any third-party HTTP APIs, SaaS services, or cloud providers at runtime.

## Data Storage

**Database: MongoDB (Native Driver)**
- Driver: `mongodb` ^7.1.0 (peer dependency)
- Client: Native MongoDB Node.js driver — **NO Mongoose** in `@monque/core`
- Connection: Consumer provides a `Db` instance to the `Monque` constructor
- Collection: Configurable via `collectionName` option (default: `monque_jobs`)
- Required topology: Replica set or sharded cluster (for Change Streams); standalone works with polling-only fallback

**MongoDB Features Used:**
- `findOneAndUpdate` — Atomic job claiming with locking (`packages/core/src/scheduler/services/job-processor.ts`)
- `updateMany` — Bulk status updates, stale job recovery (`packages/core/src/scheduler/monque.ts`)
- `deleteMany` — Job retention cleanup (`packages/core/src/scheduler/monque.ts`)
- `collection.watch()` — Change Streams for real-time job notifications (`packages/core/src/scheduler/services/change-stream-handler.ts`)
- `createIndex` — 7 indexes created on initialization for efficient queries (`packages/core/src/scheduler/monque.ts`)
- `aggregate` — Queue statistics pipeline (`packages/core/src/scheduler/services/job-query.ts`)
- Upsert with `$setOnInsert` — Idempotent job creation with `uniqueKey`

**Indexes Created:**
1. `{ status: 1, nextRunAt: 1 }` — Job polling
2. `{ name: 1, uniqueKey: 1 }` — Partial unique index for deduplication (pending/processing only)
3. `{ name: 1, status: 1 }` — Job lookup by type
4. `{ claimedBy: 1, status: 1 }` — Instance-owned jobs
5. `{ lastHeartbeat: 1, status: 1 }` — Monitoring/debugging
6. `{ status: 1, nextRunAt: 1, claimedBy: 1 }` — Atomic claim queries
7. `{ status: 1, lockedAt: 1, lastHeartbeat: 1 }` — Recovery scans

**File Storage:** Not applicable (library does not handle files)

**Caching:** None (MongoDB is the sole data store)

## Ts.ED Framework Integration

**Package:** `@monque/tsed` (`packages/tsed/`)
- Integrates Monque with Ts.ED dependency injection framework
- Peer dependencies: `@tsed/core` ^8.25.1, `@tsed/di` ^8.25.1, `@tsed/mongoose` ^8.25.1 (optional)

**Database Resolution Strategies** (`packages/tsed/src/utils/resolve-database.ts`):
1. **Direct `db`**: Pre-connected `Db` instance passed in config
2. **Factory `dbFactory`**: Async factory function returning `Db`
3. **DI Token `dbToken`**: Resolve from Ts.ED DI container (supports native `Db`, Mongoose `Connection`, or `MongooseService`)

**Mongoose Compatibility** (`packages/tsed/src/utils/guards.ts`):
- Duck-typing guards for MongooseService and Mongoose Connection
- Extracts native `Db` from Mongoose connections when `dbToken` points to a Mongoose provider
- `mongooseConnectionId` config option (default: `"default"`)

**Decorator-based Job Registration:**
- `@JobController(namespace)` — Class-level decorator (`packages/tsed/src/decorators/`)
- `@Job(name)` — Method-level decorator for job handlers
- `@Cron(pattern)` — Method-level decorator for recurring jobs
- Metadata stored via `Store.from(target).set(MONQUE, ...)`, collected by `collectJobMetadata()` (`packages/tsed/src/utils/collect-job-metadata.ts`)

**Lifecycle:**
- `$onInit()` — Initializes Monque, registers jobs, starts processing
- `$onDestroy()` — Graceful shutdown via `monque.stop()`
- Supports `disableJobProcessing` for producer-only instances

## Authentication & Identity

**Auth Provider:** Not applicable
- Monque is a job queue library; it does not implement authentication
- MongoDB authentication is handled by the consumer's `MongoClient` connection

## Monitoring & Observability

**Event-driven Observability:**
- Typed `EventEmitter` with `MonqueEventMap` (`packages/core/src/events/types.ts`)
- Events emitted:
  - `job:start` — Job begins processing
  - `job:complete` — Job finished (includes `duration` in ms)
  - `job:fail` — Job failed (includes `error` and `willRetry` flag)
  - `job:error` — Unexpected processing errors
  - `job:cancelled` / `job:retried` / `job:deleted` — Management events
  - `jobs:cancelled` / `jobs:retried` / `jobs:deleted` — Bulk operation events
  - `stale:recovered` — Stale jobs reset on startup
  - `changestream:connected` / `changestream:error` / `changestream:closed` / `changestream:fallback` — Change stream lifecycle

**Health Check:** `monque.isHealthy()` method returns `true` when running, initialized, and connected

**Queue Statistics:** `monque.getQueueStats()` — Aggregation pipeline for per-status counts and average processing duration

**Error Tracking:** None built-in (consumers wire events to their own systems)

**Logs:**
- `@monque/core`: No logging — events only
- `@monque/tsed`: Uses Ts.ED `LOGGER` injection for init/error/debug messages

**Coverage Reporting:**
- Codecov integration in CI (`.github/workflows/ci.yml`)
- Token: `secrets.CODECOV_TOKEN`

## CI/CD & Deployment

**Source Control:**
- GitHub: `github.com/ueberBrot/monque`
- Branch strategy: `main` as base branch

**CI Pipeline:** GitHub Actions (`.github/workflows/ci.yml`)
- **Lint & Format job:** Biome check + TypeScript type-check
- **Test & Coverage job:** Vitest run (with Testcontainers MongoDB), Codecov upload
- **Build job:** tsdown build + `publint` + `attw` export validation
- **Check Changeset job:** Validates changesets on PRs (currently skipped)
- Turbo filter on PRs: only tests changed packages and dependents
- Concurrency: cancel-in-progress per workflow/ref

**Release Pipeline:** GitHub Actions (`.github/workflows/publish.yml`)
- Triggered on push to `main` or manual dispatch
- Uses `changesets/action` to create release PRs or publish to npm
- Secrets: `CHANGESETS_TOKEN` (GitHub), `NPM_TOKEN` (npm registry)
- Publishes via `bunx changeset publish`
- Triggers docs deployment on successful publish

**Documentation Deployment:** GitHub Actions (`.github/workflows/deploy-docs.yml`)
- Deploys to GitHub Pages via `actions/deploy-pages`
- Builds with Astro via `withastro/action`
- Skips deployment if pending changesets exist (waits for release)
- Triggered on push to `main` (docs path changes), manual dispatch, or from release workflow

**Renovate Bot Changeset Generation:** GitHub Actions (`.github/workflows/renovate-changesets.yml`)
- Auto-generates changesets for Renovate dependency PRs
- Runs `scripts/renovate-generate-changeset.ts`

**Code Review:**
- CodeRabbit configured (`.coderabbit.yaml`) but auto-review disabled

## Environment Configuration

**Required env vars (CI only):**
- `CODECOV_TOKEN` — Coverage upload to Codecov
- `CHANGESETS_TOKEN` — GitHub token for changeset PRs (needs write access to contents + PRs)
- `NPM_TOKEN` / `NODE_AUTH_TOKEN` — npm registry authentication for publishing

**Required env vars (Runtime):** None
- Monque requires no environment variables at runtime
- MongoDB connection is provided programmatically via `Db` instance
- All configuration is via constructor options

**Development env vars:**
- `TESTCONTAINERS_REUSE_ENABLE=true` — Reuse MongoDB container across test runs in dev mode (`test:dev` script)

**No `.env` files present** in the repository.

## Webhooks & Callbacks

**Incoming:** None (library, not a service)

**Outgoing:** None

**Internal Reactive Mechanisms:**
- MongoDB Change Streams (`packages/core/src/scheduler/services/change-stream-handler.ts`): Real-time notifications when jobs are inserted or status changes to pending
  - Pipeline filters: insert operations + update operations where `status` field changes
  - Uses `fullDocument: 'updateLookup'` for complete document on updates
  - Debounced at 100ms to prevent claim storms
  - Automatic reconnection with exponential backoff (1s, 2s, 4s) up to 3 attempts
  - Graceful fallback to polling-only mode if Change Streams unavailable

## Third-Party Service Dependencies

**npm Registry:**
- Packages published as `@monque/core` and `@monque/tsed` (public access)

**GitHub:**
- Source hosting, CI/CD, GitHub Pages (docs), dependency management (Renovate)

**Codecov:**
- Coverage reporting and tracking

**CDN (docs only):**
- Mermaid.js loaded from `cdn.jsdelivr.net` for diagram rendering in docs site

---

*Integration audit: 2026-02-24*
