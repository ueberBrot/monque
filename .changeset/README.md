# Changesets

Add a changeset for each independent change that affects users of a published package,
even when several changes affect the same package. Describe what users gain or need to
know; keep implementation history out of release notes.

- Use **minor** for features and dependency updates, including packages below version 1.0.
- Use **patch** for bug fixes and performance improvements.
- Discuss breaking public interface changes before choosing a release type.
- Documentation, tests, development tooling, and behavior-preserving internal refactors
  do not need a changeset.

Renovate PRs use one generated changeset covering all affected published packages, each
with a **minor** bump and the summary "Update runtime dependencies." This includes
`dependencies`, `optionalDependencies`, and `peerDependencies`, including `@monque/*`
dependencies, and excludes `devDependencies`. Provide a manual changeset with specific
notes when an update changes compatibility or requires consumer action; the generator
preserves PRs that already include a changeset.

Run `bunx changeset` from the repository root to create one. Run `bunx changeset status`
to inspect the release plan and dependent package updates.
