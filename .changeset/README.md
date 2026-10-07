# Changesets

Add a changeset for each independent change that affects users of a published package,
even when several changes affect the same package. Describe what users gain or need to
know; keep implementation history out of release notes.

Keep each summary to one user-facing change in one or two sentences. Use a single
paragraph without manual line breaks or lists. List multiple packages only when the
same summary applies to each; otherwise, use separate changesets. Link to the
documentation for usage examples and detailed upgrade instructions.

- Use **minor** for features and dependency updates, including packages below version 1.0.
- Use **patch** for bug fixes and performance improvements.
- Discuss breaking public interface changes before choosing a release type.
- Documentation, tests, development tooling, and behavior-preserving internal refactors
  do not need a changeset.

Group routine dependency updates in one changeset covering all affected published
packages, each with a **minor** bump and the summary "Update runtime dependencies."
This includes `dependencies`, `optionalDependencies`, and `peerDependencies`, including
`@monque/*` dependencies, and excludes `devDependencies`. Add specific notes when an update drops
support for an existing version or requires consumer action. If a feature changeset
already covers that requirement, no separate dependency changeset is needed.

Renovate generates this changeset automatically for PRs without an existing changeset.

Run `bunx changeset` from the repository root to create one. Run `bunx changeset status`
to inspect the release plan and dependent package updates.
