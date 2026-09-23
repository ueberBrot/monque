# @monque/management-express

## 0.4.0

### Minor Changes

- [#522](https://github.com/ueberBrot/monque/pull/522) [`75b43f4`](https://github.com/ueberBrot/monque/commit/75b43f4802587c8d32188d712c0750b6b5333571) - Support Management 0.4, including summary job listings, Queue Views filtered by job name, and actions on selected job IDs, through the existing Express router.
  
  Require `@monque/core` 1.12.0 or newer within version 1 for string job-ID lookup. Upgrade core alongside the adapter.

### Patch Changes

- Updated dependencies [[`75b43f4`](https://github.com/ueberBrot/monque/commit/75b43f4802587c8d32188d712c0750b6b5333571)]:
  - @monque/management@0.4.0

## 0.3.0

### Minor Changes

- [#515](https://github.com/ueberBrot/monque/pull/515) [`16070f6`](https://github.com/ueberBrot/monque/commit/16070f63406160f35e892c82442016540daf0639) - Require MongoDB driver ^7.6.0 instead of ^7.2.0.

### Patch Changes

- [#515](https://github.com/ueberBrot/monque/pull/515) [`16070f6`](https://github.com/ueberBrot/monque/commit/16070f63406160f35e892c82442016540daf0639) - Accept management 0.3.x alongside 0.1.x and 0.2.x.

## 0.2.1

### Patch Changes

- [#494](https://github.com/ueberBrot/monque/pull/494) [`e5076bf`](https://github.com/ueberBrot/monque/commit/e5076bf6df19abc06e7861a5f27c28bfd8f7cb8d) Thanks [@renovate](https://github.com/apps/renovate)! - chore(deps): update dependencies

  - @monque/management-express: @monque/core (^1.10.0 → ^1.10.1)
  - @monque/management: @monque/core (^1.10.0 → ^1.10.1)

## 0.2.0

### Minor Changes

- [#476](https://github.com/ueberBrot/monque/pull/476) [`67fa0f3`](https://github.com/ueberBrot/monque/commit/67fa0f36f1fef7eb3b6e9b0b257c92e9043979f9) Thanks [@ueberBrot](https://github.com/ueberBrot)! - Add browser-safe management contract exports for dashboard clients.

## 0.1.0

### Minor Changes

- [#450](https://github.com/ueberBrot/monque/pull/450) [`a872e79`](https://github.com/ueberBrot/monque/commit/a872e797d5d9072f9fa4ed6b683573d05aca654b) Thanks [@ueberBrot](https://github.com/ueberBrot)! - Release the Express adapter for the Monque management surface with mounted OpenAPI
  routes, Express-derived management context, and mount-specific OpenAPI server metadata.
