# @monque/management

## 0.5.0

### Minor Changes

- [#534](https://github.com/ueberBrot/monque/pull/534) [`eb8f455`](https://github.com/ueberBrot/monque/commit/eb8f455ef4c62c5a13613604a7b44b391d458c2b) - Include a recurring job's configured `timezone` in job detail, list, summary, and action
  responses, and describe the optional field in OpenAPI. Jobs without an explicit timezone
  continue to omit the field.

## 0.4.1

### Patch Changes

- [#525](https://github.com/ueberBrot/monque/pull/525) [`3fb1233`](https://github.com/ueberBrot/monque/commit/3fb1233231c636680eda4628007432df125934e2) - Return HTTP 400 for empty Job Name filters in listings, statistics, Queue Views,
  and bulk actions. Omit the name filter to include all Job Names.

## 0.4.0

### Minor Changes

- [#522](https://github.com/ueberBrot/monque/pull/522) [`75b43f4`](https://github.com/ueberBrot/monque/commit/75b43f4802587c8d32188d712c0750b6b5333571) - - Add `view=summary` to job listings to skip payload serialization and return `payload: null`. Full payloads remain the default.
  - Add `POST /api/v1/jobs/actions/selected` to cancel, retry, reschedule, or delete up to 100 selected job IDs, with per-job authorization and individual failure details. Authorization callbacks receive the selected `ids`. Selected actions keep progressing when individual jobs are slow.
  - Add an optional exact `name` filter to `GET /api/v1/queue-views` to retrieve summaries for a single Queue View. Requests without a filter continue to return all Queue Views.
  - Add `parallelCapabilityChecks` to run independent authorization checks concurrently; sequential checks remain the default.
  - Fix job responses when optional heartbeat intervals, recurring schedules, or unique keys are stored as `null` in MongoDB. These fields are omitted from responses so affected jobs load correctly.
  - Require `@monque/core` 1.12.0 or newer within version 1 so job details and actions can look up jobs by string ID. Upgrade core alongside Management.

## 0.3.1

### Patch Changes

- [#520](https://github.com/ueberBrot/monque/pull/520) [`c6d3f36`](https://github.com/ueberBrot/monque/commit/c6d3f3680b7af1cebcfc2c461bcfd1c693c777ab) - Only use explicitly defined per-job payload serializers. This prevents job names such as `constructor` from bypassing payload redaction and exposing raw job data or request context in management responses.

## 0.3.0

### Minor Changes

- [#515](https://github.com/ueberBrot/monque/pull/515) [`16070f6`](https://github.com/ueberBrot/monque/commit/16070f63406160f35e892c82442016540daf0639) - Require MongoDB driver ^7.6.0 instead of ^7.2.0.

- [#515](https://github.com/ueberBrot/monque/pull/515) [`16070f6`](https://github.com/ueberBrot/monque/commit/16070f63406160f35e892c82442016540daf0639) - Update @orpc/contract, @orpc/openapi, @orpc/server, and @orpc/zod from 1.14.4 to 1.15.1.

- [#515](https://github.com/ueberBrot/monque/pull/515) [`16070f6`](https://github.com/ueberBrot/monque/commit/16070f63406160f35e892c82442016540daf0639) - Update Zod from 4.4.3 to 4.6.5.

## 0.2.2

### Patch Changes

- [#494](https://github.com/ueberBrot/monque/pull/494) [`e5076bf`](https://github.com/ueberBrot/monque/commit/e5076bf6df19abc06e7861a5f27c28bfd8f7cb8d) Thanks [@renovate](https://github.com/apps/renovate)! - chore(deps): update dependencies

  - @monque/management-express: @monque/core (^1.10.0 → ^1.10.1)
  - @monque/management: @monque/core (^1.10.0 → ^1.10.1)

## 0.2.1

### Patch Changes

- [#481](https://github.com/ueberBrot/monque/pull/481) [`0a28767`](https://github.com/ueberBrot/monque/commit/0a287672e9813dfa78bdab5f0193a7800600238a) Thanks [@renovate](https://github.com/apps/renovate)! - chore(deps): update dependencies

  - @monque/management: @orpc/contract (^1.14.2 → ^1.14.4)
  - @monque/management: @orpc/openapi (^1.14.2 → ^1.14.4)
  - @monque/management: @orpc/server (^1.14.2 → ^1.14.4)
  - @monque/management: @orpc/zod (^1.14.2 → ^1.14.4)

## 0.2.0

### Minor Changes

- [#476](https://github.com/ueberBrot/monque/pull/476) [`67fa0f3`](https://github.com/ueberBrot/monque/commit/67fa0f36f1fef7eb3b6e9b0b257c92e9043979f9) Thanks [@ueberBrot](https://github.com/ueberBrot)! - Add browser-safe management contract exports for dashboard clients.

## 0.1.0

### Minor Changes

- [#429](https://github.com/ueberBrot/monque/pull/429) [`161b1f0`](https://github.com/ueberBrot/monque/commit/161b1f00bc89886d182d0306ce666003ddf56910) Thanks [@ueberBrot](https://github.com/ueberBrot)! - Release the framework-neutral Management package with scheduler health, capability
  introspection, queue views, job inspection, single and bulk Job actions, OpenAPI
  document generation, DTO schemas, and adapter-facing TypeScript contracts.
