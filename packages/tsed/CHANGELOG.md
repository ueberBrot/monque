# @monque/tsed

## 2.0.0

### Minor Changes

- [#158](https://github.com/ueberBrot/monque/pull/158) [`2f83396`](https://github.com/ueberBrot/monque/commit/2f833966d7798307deaa7a1e655e0623cfb42a3e) Thanks [@renovate](https://github.com/apps/renovate)! - chore(deps): update dependencies

  - @monque/core: mongodb (^7.0.0 → ^7.1.0)
  - @monque/tsed: mongodb (^7.0.0 → ^7.1.0)

### Patch Changes

- Updated dependencies [[`b5fcaf8`](https://github.com/ueberBrot/monque/commit/b5fcaf8be2a49fb1ba97b8d3d9f28f00850f77a1), [`2f83396`](https://github.com/ueberBrot/monque/commit/2f833966d7798307deaa7a1e655e0623cfb42a3e)]:
  - @monque/core@1.3.0

## 1.0.0

### Major Changes

- [#113](https://github.com/ueberBrot/monque/pull/113) [`94a25d0`](https://github.com/ueberBrot/monque/commit/94a25d0f64f394af72c06a5457db5431df996c45) Thanks [@ueberBrot](https://github.com/ueberBrot)! - Rename `@Worker` and `@WorkerController` to `@Job` and `@JobController`.

  This is a breaking change that aligns the terminology with the core package and general job queue conventions.

  - Renamed `@Worker` decorator to `@Job`
  - Renamed `@WorkerController` decorator to `@JobController`
  - Renamed internal metadata types and store keys to use "Job" instead of "Worker" (e.g., `JobStore`, `JobMetadata`)
  - Updated logging and constants to reflect the change
  - Added `disableJobProcessing` option to run Ts.ED instances in producer-only mode. When enabled, the instance can enqueue jobs and manage schedules but will not process any jobs.

### Patch Changes

- Updated dependencies [[`9b7f44f`](https://github.com/ueberBrot/monque/commit/9b7f44f5c1f6b4aa4215e571189cc03cbaa49865)]:
  - @monque/core@1.2.0

## 0.1.0

### Minor Changes

- [#94](https://github.com/ueberBrot/monque/pull/94) [`2ff8c9c`](https://github.com/ueberBrot/monque/commit/2ff8c9c5e699d534ea7dc15229405db3688b961a) Thanks [@ueberBrot](https://github.com/ueberBrot)! - Initial release of @monque/tsed integration with @WorkerController, @Worker, and @Cron decorators.

### Patch Changes

- [#99](https://github.com/ueberBrot/monque/pull/99) [`2624dd0`](https://github.com/ueberBrot/monque/commit/2624dd0895846741bbacb958fa3305aed3013ae1) Thanks [@renovate](https://github.com/apps/renovate)! - chore(deps): update dependencies

  - @monque/tsed: @monque/core (^1.1.0 → ^1.1.2)

- [#106](https://github.com/ueberBrot/monque/pull/106) [`aef0361`](https://github.com/ueberBrot/monque/commit/aef0361e4ac2ecb219e8edcd07c462daab116826) Thanks [@renovate](https://github.com/apps/renovate)! - chore(deps): update dependencies

  - @monque/tsed: @tsed/core (^8.24.0 → ^8.24.1)
  - @monque/tsed: @tsed/di (^8.24.0 → ^8.24.1)
  - @monque/tsed: @tsed/mongoose (^8.24.0 → ^8.24.1)
