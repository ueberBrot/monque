# CI checks and merge queues

CI Gate is the aggregate status required by the main branch's protection rules.
It requires package builds, quality checks, app builds, and the expected runtime
results. Pull requests and main-branch pushes may omit runtime checks for the
documentation paths recognized by `scripts/ci/scope.sh`. Missing comparison
history runs the runtime checks.

Merge groups always run every runtime check, including docs-only groups. The
gate rejects skipped runtime checks on `merge_group` events, so a combined merge
commit must pass the full suite.

To enable a merge queue:

1. Merge workflow support for `merge_group` before changing repository rules.
2. Keep CI Gate required in the main branch's active ruleset and require the
   merge queue. Keep direct-push and protection bypasses disabled.
3. Enqueue a pull request and confirm that its combined merge commit runs the
   full CI workflow and reports CI Gate before the queue merges it.

Full PR tests remain required independently of queue configuration. Any early
affected-test check supplements those tests. Replacing the full PR suite with
selection requires a separate rollout after the queue has been verified.
