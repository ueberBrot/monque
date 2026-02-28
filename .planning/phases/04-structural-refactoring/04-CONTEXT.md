# Phase 4: Structural Refactoring - Context

**Gathered:** 2026-02-28
**Status:** Ready for planning

<domain>
## Phase Boundary

Reduce the Monque facade class (currently 1,294 lines) to improve maintainability without changing any public behavior. Two strategies: JSDoc deduplication via `@inheritdoc` and LifecycleManager extraction. Requirement REFR-01. Success criteria: 40% line reduction, zero test modifications for behavioral equivalence.

</domain>

<decisions>
## Implementation Decisions

### JSDoc deduplication strategy
- Move full JSDoc (all @param, @returns, @throws, @template, @example blocks) from facade methods to the corresponding service methods (JobScheduler, JobManager, JobQueryService, etc.)
- Use `@inheritdoc` on facade methods pointing to service methods — TypeScript resolves full docs through the chain for IDE hover
- Full transfer including @example blocks — service methods become the single source of truth
- Keep the class-level JSDoc on Monque (lines 51-113, the lifecycle example) — it's the entry point for library consumers and not duplicated

### LifecycleManager extraction scope
- Extract into LifecycleManager: poll interval, heartbeat interval, cleanup interval, and the `cleanupJobs()` method
- Timer interval IDs (pollIntervalId, heartbeatIntervalId, cleanupIntervalId) move to LifecycleManager
- LifecycleManager follows the same pattern as existing services: receives SchedulerContext, null-initialized, private getter throws if accessed before init
- File location: `packages/core/src/scheduler/services/lifecycle-manager.ts`, re-exported from services barrel
- **Stays on Monque:** shutdown wait/orchestration logic (Promise.race between active job completion and timeout), change stream setup (already delegated to ChangeStreamHandler), createIndexes(), recoverStaleJobs(), checkInstanceCollision()
- LifecycleManager extraction happens regardless of whether JSDoc dedup alone reaches 40%

### Public API surface preservation
- Behavioral equivalence is the bar — tests pass unchanged, public method signatures identical, events emit same payloads
- LifecycleManager is internal only — not exported from the package's public API
- Add both LifecycleManager unit tests and a facade equivalence test asserting the public API shape hasn't changed
- Declaration file changes are acceptable as long as behavioral contract holds

### Refactoring sequence
- Two separate plans with separate commit boundaries
- Plan 1: JSDoc deduplication (low-risk, purely subtractive, measurable)
- Plan 2: LifecycleManager extraction (always executed, not conditional on Plan 1 results)
- JSDoc first allows measuring reduction before structural changes

### Service JSDoc completeness
- Move facade's complete docs to service methods, replacing existing service docs where they exist
- Full transfer: @param, @returns, @throws, @example, @template — everything moves
- Service methods become the canonical source of documentation
- Facade methods become lean @inheritdoc one-liners

### Private method documentation
- Private methods on Monque keep their existing docs as-is (createIndexes index descriptions, recoverStaleJobs logic, etc.)
- When cleanupJobs() moves to LifecycleManager, its existing JSDoc moves with it unchanged
- Service accessor getters keep their one-line `@throws {ConnectionError}` annotations
- No trimming or restructuring of private method docs

### Claude's Discretion
- Exact @inheritdoc syntax and whether to add a brief summary line alongside it
- LifecycleManager internal API design (method names, how timer callbacks are passed)
- How to structure the facade equivalence test
- Whether to add any intermediate helper types for LifecycleManager

</decisions>

<specifics>
## Specific Ideas

- Two-plan approach: JSDoc dedup first (measurable, safe), LifecycleManager second (structural)
- LifecycleManager follows identical patterns to JobScheduler/JobManager/etc. — context injection, lazy init, private getter
- 40% is the target for line reduction, not a minimum to obsess over — stop at target
- cleanupJobs() moves with its docs to LifecycleManager since it's timer-driven behavior

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 04-structural-refactoring*
*Context gathered: 2026-02-28*
