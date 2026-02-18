---
name: core-development
description: Guidelines for developing within the @monque/core package. Use when implementing new features, fixing bugs, refactoring code, or writing tests in the core package (packages/core).
---

# Core Development

## File Structure

- `src/index.ts`: Public API exports.
- `src/jobs/`: Job definitions and logic.
- `src/scheduler/`: Scheduler implementation.
- `src/events/`: Event definitions and handling.

## Coding Guidelines

- **Types**: Strict TypeScript. No `any`. Define interfaces for all data structures.
- **Async/Await**: Use `async/await` for all asynchronous operations.
- **Error Handling**: Use typed custom errors where possible.
- **TSDoc**: All exported functions, classes, and interfaces MUST have `/** ... */` comments with `@param`, `@returns`, and `@example` tags. Required for TypeDoc API generation.
- **No Barrel Exports**: Do not use `export * from '...'`. Always use explicit named exports.
- **Path Aliases**: Use `@/` for `src/` imports, `@test-utils/` for `tests/setup/` imports.

## Testing

### Unit Tests

- Located alongside source files or in `tests/unit/`.
- Mock external dependencies (e.g., MongoDB).
- Run with `bun run test:unit`.

### Integration Tests

- Located in `integration/`.
- Use `testcontainers` for real MongoDB instances.
- Verify database interactions.
- Run with `bun run test:integration`.

### Strictness

- Do NOT use non-null assertions (`!`). Use explicit checks or safe access.
- Do NOT use `any` even in tests.

## Core Logic Patterns

For detailed MongoDB query patterns (atomic locking, idempotency upserts, heartbeats, stale recovery, graceful shutdown, expected indexes), see [references/core-logic.md](references/core-logic.md). Consult this when modifying job scheduling, claiming, or recovery logic.

## Adding a New Feature

1. Define interfaces/types in a relevant file.
2. Implement logic in `src/`.
3. Create unit test to verify logic in isolation.
4. Create integration test to verify database interactions.
5. Export necessary symbols in `src/index.ts`.
