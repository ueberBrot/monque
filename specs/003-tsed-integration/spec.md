# Feature Specification: Ts.ED Integration

**Feature Branch**: `003-tsed-integration`
**Created**: 2026-01-22
**Status**: Draft
**Input**: User description: Create a new integration for the ts.ed framework as a new package. Features: Decorator-based worker registration (@Worker, @Cron), Native lifecycle integration, Type-safe job definitions. Add plugin to Ts.ED marketplace via naming conventions.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Declarative Worker Controllers (Priority: P1)

As a Ts.ED developer, I want to group related job processors into a "Controller" class so that I can organize my background logic similar to how I organize HTTP endpoints.

**Why this priority**: Aligning with Ts.ED's controller pattern makes adoption easier and code more structured.

**Independent Test**: Create a class decorated with `@WorkerController`. Define methods decorated with `@Worker`. Verify the methods are invoked when matching jobs are processed.

**Acceptance Scenarios**:

1. **Given** a method decorated with `@Worker('send-email')` inside a `@WorkerController`, **When** a job is added to the 'send-email' queue, **Then** the method is executed with the job data.

---

### User Story 2 - Dependency Injection in Worker Controllers (Priority: P1)

As a developer, I want my Worker Controller classes to participate in the Ts.ED Dependency Injection (DI) system so that I can easily inject services.

**Why this priority**: Essential for building real-world applications.

**Independent Test**: Inject a Service into a `@WorkerController`. Verify use in `@Worker` method.

**Acceptance Scenarios**:

1. **Given** a Service `MyService`, **When** injected into a `@WorkerController`, **Then** it is usable within `@Worker` methods.

---

### User Story 3 - Scheduled Cron Jobs (Priority: P2)

As a developer, I want to define recurring tasks on controller methods using a `@Cron` decorator.

**Why this priority**: Convenience for scheduling.

**Independent Test**: Decorate a method with `@Cron('* * * * *')`. Verify execution.

**Acceptance Scenarios**:

1. **Given** a method decorated with `@Cron('*/5 * * * *')`, **When** the application runs, **Then** the method is executed every 5 minutes.

---

### User Story 4 - Marketplace Discovery (Priority: P3)

As a maintainer, I want the package to follow Ts.ED naming conventions so that it automatically appears in the Ts.ED marketplace.

**Why this priority**: Visibility and adoption.

**Independent Test**: Verify `package.json` name and keywords match Ts.ED requirements.

**Acceptance Scenarios**:

1. **Given** the package is built, **When** checking `package.json`, **Then** the name starts with `tsed-plugin-` or `@tsed/` and keywords/description include "Ts.ED".

---

### User Story 5 - Job Execution Isolation (Priority: P2)

As a developer, I want each job execution to run in its own unrelated context so that request-scoped services (like contexts or per-request caches) do not leak state between jobs.

**Why this priority**: Critical for stability in complex applications where workers rely on scoped dependency injection.

**Independent Test**: Inject a scoped service into a worker. Modify the service state in one job. Verify the state is reset in the next job.

**Acceptance Scenarios**:

1. **Given** a scoped service with a counter, **When** Job A increments the counter, **Then** Job B sees the counter at its initial state (new instance).

---

### Edge Cases

- When Monque connection fails during Ts.ED startup, the application MUST throw an error and fail to start.
- If dependency resolution fails during job execution, the job MUST be marked as failed, the error logged, and the worker MUST continue processing other jobs.
- If multiple classes register handlers for the same queue name, the system MUST fail at startup with a duplicate registration error.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The integration MUST be packaged as a separate NPM package (e.g., `packages/tsed` or `packages/tsed-plugin-monque`).
- **FR-002**: The package name MUST be `tsed-plugin-monque` (or similar compliant name) to ensure Marketplace discovery.
- **FR-003**: System MUST expose a `@WorkerController(options)` decorator that registers a class as a container for job handlers.
- **FR-003.1**: System MUST expose a `@Worker(queueName, options)` method decorator that registers the method as a handler for a specific queue.
- **FR-004**: System MUST expose a `@Cron(expression, options)` method decorator for recurring schedules.
- **FR-005**: Controllers MUST be instantiated via the Ts.ED Injector.
- **FR-006**: System MUST create a discrete Dependency Injection Context for every job execution to ensure state isolation.
- **FR-007**: System MUST integration with the framework's native `Init` and `Destroy` lifecycle phases to automatically manage connections.
- **FR-008**: System MUST allow type-safe job payload definitions (e.g., via Generics or DTO validation).

### Non-Functional Requirements

- **NFR-001**: The Ts.ED integration layer overhead MUST be <10ms per job execution (excluding user handler time).
- **NFR-002**: The integration MUST use Ts.ED's native logger for all logging (info, warn, error levels), not a custom logging solution.

### Key Entities

- **MonqueModule**: The main Ts.ED module configuration class that integrates Monque into the DI container.
- **WorkerController**: A user-defined class decorated with `@WorkerController` containing method handlers.
- **JobContext**: A distinct DI context created for each job execution to ensure isolation.

## Clarifications

### Session 2026-01-22

- Q: Should the integration support multi-tenancy? → A: No, v1.0 assumes a single Monque instance per application.
- Q: How are job payloads typed? → A: Via the generic `Job<T>` interface from `@monque/core`.
- Q: What happens if a controller method throws? → A: The job is marked as failed by the Monque worker (standard behavior).
- Q: Can I use `@Cron` on a non-controller class? → A: No, `@Cron` is only supported within the context of a `@WorkerController` or a registered Service.
- Q: What should happen when Monque connection fails during Ts.ED startup? → A: Fail startup (throw error).
- Q: What happens if multiple classes register handlers for the same queue? → A: Fail at startup (duplicate error).
- Q: What is the expected max job processing latency overhead from the Ts.ED integration layer? → A: <10ms per job.
- Q: What level of observability/logging should the integration provide? → A: Standard (use Ts.ED logger, info/warn/error).
- Q: How should the system handle DI resolution errors during worker instantiation? → A: Fail the job, log error, continue worker.

## Assumptions

### Environment
- Ts.ED v8+ is required.
- Access to a MongoDB instance is available and configured via `@monque/core`.

### Scope Boundaries (v1.0)
- **Multi-instance support**: Binding multiple Monque instances to different controllers is out of scope.
- **Dynamic Workers**: Workers must be statically defined via decorators at startup.
- **Custom Decorators**: Users are expected to use provided decorators, not create custom ones for registration.

## Glossary

- **Controller**: A class grouping related job handlers, similar to a REST Controller.
- **Metadata**: Information stored by decorators (queue name, cron expression) used during bootstrap.
- **DI Context**: A scoped container for Dependency Injection, ensuring services are fresh for each job.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A new Ts.ED project can install and configure the plugin with < 10 lines of config code.
- **SC-002**: 100% of standard Monque worker options (concurrency, etc.) can be configured via the `@Worker` decorator.
- **SC-003**: Package is successfully built and publishable to NPM with the name `tsed-plugin-monque`.
