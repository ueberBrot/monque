# @monque/dashboard

## 0.7.0

### Minor Changes

- [#610](https://github.com/ueberBrot/monque/pull/610) [`d437929`](https://github.com/ueberBrot/monque/commit/d4379297baf08da0e5e81158e23ecd50cbc6d93b) - Update Zod to 4.6.7 and the bundled oRPC clients to 1.16.1.

- [#617](https://github.com/ueberBrot/monque/pull/617) [`1f15718`](https://github.com/ueberBrot/monque/commit/1f15718464bc0dddd523bf637922e309a1dcf828) - Update the bundled Dashboard to React 19.3.1, Base UI 1.9.0, TanStack Table 9.3.1, TanStack Hotkeys 0.17.0, and cn 0.5.0.

### Patch Changes

- [#618](https://github.com/ueberBrot/monque/pull/618) [`4297519`](https://github.com/ueberBrot/monque/commit/4297519597af11483aebdf5f4fd5716b5573f868) - Keep cached Jobs, selections, open confirmations, and action failure feedback visible when a Jobs-list refresh fails transiently. Continue replacing cached content when either Jobs or capability reads report an authentication or authorization failure.

## 0.6.0

### Minor Changes

- [#597](https://github.com/ueberBrot/monque/pull/597) [`8f5c671`](https://github.com/ueberBrot/monque/commit/8f5c671d76f4510a3564adb4ef58282812da8186) - Display Job priority in Job lists, Queue Views, and Job details.

- [#597](https://github.com/ueberBrot/monque/pull/597) [`8f5c671`](https://github.com/ueberBrot/monque/commit/8f5c671d76f4510a3564adb4ef58282812da8186) - Change a pending Job's priority from its row menu or detail view, with confirmation.

- [#597](https://github.com/ueberBrot/monque/pull/597) [`8f5c671`](https://github.com/ueberBrot/monque/commit/8f5c671d76f4510a3564adb4ef58282812da8186) - Set one priority for up to 100 selected pending Jobs, with scope confirmation and feedback for partial failures.

### Patch Changes

- [#597](https://github.com/ueberBrot/monque/pull/597) [`8f5c671`](https://github.com/ueberBrot/monque/commit/8f5c671d76f4510a3564adb4ef58282812da8186) - Show keyboard shortcuts for the operator's platform: Command on macOS and Ctrl on Windows and Linux.

## 0.5.1

### Patch Changes

- [#590](https://github.com/ueberBrot/monque/pull/590) [`96c48a5`](https://github.com/ueberBrot/monque/commit/96c48a5917aa6bba37b585f8aace74fa298d43d0) - Keep loaded Job details and open action confirmations available when background refreshes fail. Authentication, permission, and missing-Job errors continue to block the detail view.

## 0.5.0

### Minor Changes

- [#589](https://github.com/ueberBrot/monque/pull/589) [`3fd5079`](https://github.com/ueberBrot/monque/commit/3fd50796372adf61d1b60ea3eb6b56ebe14212bd) - Update runtime dependencies.

## 0.4.0

### Minor Changes

- [#562](https://github.com/ueberBrot/monque/pull/562) [`70538f4`](https://github.com/ueberBrot/monque/commit/70538f45465e018717d1adaec8bc4533c7acbc28) - Update dependencies.

## 0.3.0

### Minor Changes

- [#543](https://github.com/ueberBrot/monque/pull/543) [`7c53658`](https://github.com/ueberBrot/monque/commit/7c5365873451968e15d14627efd8140dc656c15f) - Show renewable lease deadlines in job lifecycle details.

- [#543](https://github.com/ueberBrot/monque/pull/543) [`7c53658`](https://github.com/ueberBrot/monque/commit/7c5365873451968e15d14627efd8140dc656c15f) - Pause processing on the attached scheduler from Health, or pause a local worker from its Queue View. Controls show the target instance and respect permissions and read-only mode.

- [#543](https://github.com/ueberBrot/monque/pull/543) [`7c53658`](https://github.com/ueberBrot/monque/commit/7c5365873451968e15d14627efd8140dc656c15f) - Resume local processing from Health and Queue Views, with explanations when an instance-wide pause prevents a worker from resuming.

- [#543](https://github.com/ueberBrot/monque/pull/543) [`7c53658`](https://github.com/ueberBrot/monque/commit/7c5365873451968e15d14627efd8140dc656c15f) - Update the Management contract dependency to the 0.6 series for compatibility with worker policy and renewable lease metadata.

- [#543](https://github.com/ueberBrot/monque/pull/543) [`7c53658`](https://github.com/ueberBrot/monque/commit/7c5365873451968e15d14627efd8140dc656c15f) - Show local worker pause state in Queue Views and distinguish an instance-wide pause from a worker pause.

- [#543](https://github.com/ueberBrot/monque/pull/543) [`7c53658`](https://github.com/ueberBrot/monque/commit/7c5365873451968e15d14627efd8140dc656c15f) - Show worker concurrency and effective retry settings in Queue View details.

- [#543](https://github.com/ueberBrot/monque/pull/543) [`7c53658`](https://github.com/ueberBrot/monque/commit/7c5365873451968e15d14627efd8140dc656c15f) - Show whether a local worker uses Standard Schema payload validation in its Queue View.

## 0.2.0

### Minor Changes

- [#534](https://github.com/ueberBrot/monque/pull/534) [`eb8f455`](https://github.com/ueberBrot/monque/commit/eb8f455ef4c62c5a13613604a7b44b391d458c2b) - Show the schedule timezone beside a recurring job's cron expression in Job detail,
  separately from the browser timezone used to display timestamps. Upgrade Management
  alongside Dashboard so configured timezones are available in API responses.

## 0.1.0

### Minor Changes

- [#522](https://github.com/ueberBrot/monque/pull/522) [`75b43f4`](https://github.com/ueberBrot/monque/commit/75b43f4802587c8d32188d712c0750b6b5333571) - Initial release of the Monque dashboard: Queue Views, filterable and shareable job lists, payload and error inspection, individual and bulk job actions, and scheduler health. Includes responsive light and dark themes, prebuilt assets, and support for your application's authentication and permissions.
