# @monque/management

## 0.8.0

### Minor Changes

- [#587](https://github.com/ueberBrot/monque/pull/587) [`ef79f62`](https://github.com/ueberBrot/monque/commit/ef79f6235ad55b430fceb70b7354d923db5ebd2b) - Migrate management operations and OpenAPI generation to the Effect v4 runtime while preserving the public JavaScript API and HTTP contract.

### Patch Changes

- [#587](https://github.com/ueberBrot/monque/pull/587) [`ef79f62`](https://github.com/ueberBrot/monque/commit/ef79f6235ad55b430fceb70b7354d923db5ebd2b) - Simplify internal concurrent result collection while preserving early failures and continued execution of already-started operations.

- [#587](https://github.com/ueberBrot/monque/pull/587) [`ef79f62`](https://github.com/ueberBrot/monque/commit/ef79f6235ad55b430fceb70b7354d923db5ebd2b) - Share in-flight OpenAPI document generation across concurrent requests.

## 0.7.0

### Minor Changes

- [#567](https://github.com/ueberBrot/monque/pull/567) [`4f066c2`](https://github.com/ueberBrot/monque/commit/4f066c234d95a32890d232c1232b71ba67de340d) - Bound future wakeup memory during repeated rescheduling while preserving nearby scheduled runs and polling for later jobs.

- [#562](https://github.com/ueberBrot/monque/pull/562) [`70538f4`](https://github.com/ueberBrot/monque/commit/70538f45465e018717d1adaec8bc4533c7acbc28) - Update dependencies.

- [#572](https://github.com/ueberBrot/monque/pull/572) [`d9c9642`](https://github.com/ueberBrot/monque/commit/d9c96422dafe290c1f50d345d9f006a71425c371) - Update mongodb from ^7.6.0 to ^7.7.0.

### Patch Changes

- [#570](https://github.com/ueberBrot/monque/pull/570) [`d6ea22c`](https://github.com/ueberBrot/monque/commit/d6ea22c17b795d393316f1a4ff725b1ba6292fea) - Reject Management and Express request bodies over 64 KiB before job access, with a configurable `maxBodySize` limit.

- [#566](https://github.com/ueberBrot/monque/pull/566) [`d409afa`](https://github.com/ueberBrot/monque/commit/d409afa68790f5e66e94bbef7c1894c3924e34a4) - Reject browser mutations from untrusted origins. Configure `trustedOrigins` for cross-origin Dashboards; same-origin browsers and originless server clients remain supported.

## 0.6.0

### Minor Changes

- [#543](https://github.com/ueberBrot/monque/pull/543) [`7c53658`](https://github.com/ueberBrot/monque/commit/7c5365873451968e15d14627efd8140dc656c15f) - Require `@monque/core` 1.15 or later for worker policies and renewable lease metadata.

- [#543](https://github.com/ueberBrot/monque/pull/543) [`7c53658`](https://github.com/ueberBrot/monque/commit/7c5365873451968e15d14627efd8140dc656c15f) - Expose renewable claim deadlines as `leaseExpiresAt` in job details, listings, and action responses. The field is omitted for jobs without a renewable claim.

- [#543](https://github.com/ueberBrot/monque/pull/543) [`7c53658`](https://github.com/ueberBrot/monque/commit/7c5365873451968e15d14627efd8140dc656c15f) - Add authorized pause controls for the attached scheduler or a job name. Requests identify the intended scheduler, honor read-only mode, and leave running jobs uninterrupted.

- [#543](https://github.com/ueberBrot/monque/pull/543) [`7c53658`](https://github.com/ueberBrot/monque/commit/7c5365873451968e15d14627efd8140dc656c15f) - Add an authorized processing-state endpoint that reports the attached scheduler identity and local pause state.

- [#543](https://github.com/ueberBrot/monque/pull/543) [`7c53658`](https://github.com/ueberBrot/monque/commit/7c5365873451968e15d14627efd8140dc656c15f) - Add authorized resume controls for the attached scheduler or a job name. Resuming the whole instance preserves individually paused workers.

- [#543](https://github.com/ueberBrot/monque/pull/543) [`7c53658`](https://github.com/ueberBrot/monque/commit/7c5365873451968e15d14627efd8140dc656c15f) - Allow capability queries to specify a job name and authorize processing controls against the attached scheduler identity, so clients can show permissions for an individual worker.

- [#543](https://github.com/ueberBrot/monque/pull/543) [`7c53658`](https://github.com/ueberBrot/monque/commit/7c5365873451968e15d14627efd8140dc656c15f) - Include effective local worker pause state in queue view responses. Custom scheduler facades may omit unavailable state.

- [#543](https://github.com/ueberBrot/monque/pull/543) [`7c53658`](https://github.com/ueberBrot/monque/commit/7c5365873451968e15d14627efd8140dc656c15f) - Include effective local worker retry limits and backoff settings in queue view responses and their OpenAPI contract.

- [#543](https://github.com/ueberBrot/monque/pull/543) [`7c53658`](https://github.com/ueberBrot/monque/commit/7c5365873451968e15d14627efd8140dc656c15f) - Include Standard Schema validator presence in queue view responses without serializing validator functions.

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
