# @monque/tsed

## 1.5.1

### Patch Changes

- [#290](https://github.com/ueberBrot/monque/pull/290) [`cdfaa4b`](https://github.com/ueberBrot/monque/commit/cdfaa4b31489c4b5367f4a1ea364fc91e9715fcf) Thanks [@renovate](https://github.com/apps/renovate)! - chore(deps): update dependencies

  - @monque/tsed: @tsed/core (^8.25.2 → ^8.25.4)
  - @monque/tsed: @tsed/di (^8.25.2 → ^8.25.4)
  - @monque/tsed: @tsed/mongoose (^8.25.2 → ^8.25.4)

## 1.5.0

### Minor Changes

- [#246](https://github.com/ueberBrot/monque/pull/246) [`3f1459d`](https://github.com/ueberBrot/monque/commit/3f1459dacce2b4095ff00fc6cfb87e55229a082a) Thanks [@renovate](https://github.com/apps/renovate)! - chore(deps): update dependencies

  - @monque/tsed: @monque/core (^1.5.2 → ^1.6.0)

## 1.4.3

### Patch Changes

- [#238](https://github.com/ueberBrot/monque/pull/238) [`75e781a`](https://github.com/ueberBrot/monque/commit/75e781a088329e1f35e395d3737cf724d72d521e) Thanks [@renovate](https://github.com/apps/renovate)! - chore(deps): update dependencies

  - @monque/tsed: @tsed/core (^8.25.1 → ^8.25.2)
  - @monque/tsed: @tsed/di (^8.25.1 → ^8.25.2)
  - @monque/tsed: @tsed/mongoose (^8.25.1 → ^8.25.2)

## 1.4.2

### Patch Changes

- [#229](https://github.com/ueberBrot/monque/pull/229) [`623f622`](https://github.com/ueberBrot/monque/commit/623f622aa0fe8dc61504d4d8d278c5a74fc487a1) Thanks [@renovate](https://github.com/apps/renovate)! - chore(deps): update dependencies

  - @monque/tsed: @monque/core (^1.5.1 → ^1.5.2)

## 1.4.1

### Patch Changes

- [#222](https://github.com/ueberBrot/monque/pull/222) [`2c86bc6`](https://github.com/ueberBrot/monque/commit/2c86bc6fe4585e047570f6e13751cd1404022b20) Thanks [@renovate](https://github.com/apps/renovate)! - chore(deps): update dependencies

  - @monque/tsed: @monque/core (^1.5.0 → ^1.5.1)

## 1.4.0

### Minor Changes

- [#198](https://github.com/ueberBrot/monque/pull/198) [`47b6126`](https://github.com/ueberBrot/monque/commit/47b61264b7127fa8fd3c305b8b204a0e3a4bce6d) Thanks [@renovate](https://github.com/apps/renovate)! - chore(deps): update dependencies

  - @monque/tsed: @monque/core (^1.4.0 → ^1.5.0)

## 1.3.0

### Minor Changes

- [#192](https://github.com/ueberBrot/monque/pull/192) [`2cacd15`](https://github.com/ueberBrot/monque/commit/2cacd15b3be35563a2b7b64848dd0133cc062bca) Thanks [@ueberBrot](https://github.com/ueberBrot)! - Update @monque/core peer dependency form ^1.3.0 to ^1.4.0

## 1.2.0

### Minor Changes

- [#171](https://github.com/ueberBrot/monque/pull/171) [`3ddc358`](https://github.com/ueberBrot/monque/commit/3ddc3588fe89b73f4fe01cbfff5acd2051153a7a) Thanks [@renovate](https://github.com/apps/renovate)! - chore(deps): update dependencies

  - @monque/tsed: @monque/core (^1.2.0 → ^1.3.0)

## 1.1.0

### Minor Changes

- [#163](https://github.com/ueberBrot/monque/pull/163) [`2d542f6`](https://github.com/ueberBrot/monque/commit/2d542f6b78a8ff9b39ec06a7a5217a3bf05f3e02) Thanks [@ueberBrot](https://github.com/ueberBrot)! - mongodb (^7.0.0 → ^7.1.0)

- [#165](https://github.com/ueberBrot/monque/pull/165) [`a9b258e`](https://github.com/ueberBrot/monque/commit/a9b258e3191d96b6e1b5f75a8d99e014fb8d0853) Thanks [@renovate](https://github.com/apps/renovate)! - chore(deps): update dependencies

  - @monque/tsed: @tsed/core (^8.24.1 → ^8.25.1)
  - @monque/tsed: @tsed/di (^8.24.1 → ^8.25.1)
  - @monque/tsed: @tsed/mongoose (^8.24.1 → ^8.25.1)

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
