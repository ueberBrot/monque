---
name: core-development
description: Guidelines for adding functionality to the @monque/core package. Use this when implementing new features, fixing bugs, or refactoring code in the core package.
---

# Core Development Skill

This skill provides guidelines for developing within the `@monque/core` package.

## When to use this skill

- When adding new features to `@monque/core` (e.g., new job types, scheduling logic, event handling).
- When modifying existing core functionality.
- When writing tests for `@monque/core`.

## How to use it

### File Structure

All source code should reside in the `src/` directory.
- `src/index.ts`: Public API exports.
- `src/jobs/`: Job definitions and logic.
- `src/scheduler/`: Scheduler implementation.
- `src/events/`: Event definitions and handling.

### Coding Guidelines

- **Types**: Use strict TypeScript. Avoid `any`. Define interfaces for all data structures.
- **Async/Await**: Use `async/await` for asynchronous operations.
- **Error Handling**: Use typed custom errors where possible.
- **Documentation**:
  - **MANDATORY**: All exported functions, classes, and interfaces MUST have TSDoc comments (`/** ... */`).
  - This is required for TypeDoc to generate the API documentation.
  - Include `@param`, `@returns`, and `@example` tags where appropriate.
- **Exports**:
  - **NO Barrel Exports**: Do not use `export * from '...'`.
  - **Explicit Exports**: Always use named exports (e.g., `export { MyClass } from './MyClass'`).
  - This ensures better tree-shaking and clarity in the API surface.
- **Path Aliases**:
  - Use `@/` for imports from `src/`.
  - Use `@test-utils/` for imports from `tests/setup/`.

### Testing Requirements

- **Unit Tests**:
  - Located alongside source files or in `tests/unit/`.
  - Must mock external dependencies (e.g., MongoDB).
  - Run with `bun run test:unit`.
- **Strictness**:
  - Do NOT use the non-null assertion operator (`!`). Use explicit checks or safe access.
  - Do NOT use `any` even in tests. Define proper mock types or usage of unknown/casting with care.

- **Integration Tests**:
  - Located in `integration/`.
  - Use `testcontainers` for real MongoDB instances (handled by the test setup).
  - verification of database interactions is required.
  - Run with `bun run test:integration`.

### Adding a New Feature

1.  **Define Interface**: Create types/interfaces in a relevant file.
2.  **Implement Logic**: Write the core logic in `src/`.
3.  **Unit Test**: Create a unit test to verify logic in isolation.
4.  **Integration Test**: Create an integration test to verify database interactions.
5.  **Export**: Export necessary symbols in `src/index.ts`.
