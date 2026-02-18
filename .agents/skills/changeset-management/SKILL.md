---
name: changeset-management
description: Manage releases and changelogs using Changesets. Use when creating a new release version, documenting changes, preparing a changeset, or when CI flags changed packages without a changeset.
---

# Changeset Management

## Creating a Changeset

1. Run `bun changeset` in the root directory.
2. Select the packages that have changed.
3. Choose the bump type:
   - **major**: Breaking changes.
   - **minor**: New features (backward compatible).
   - **patch**: Bug fixes (backward compatible).
4. Write a descriptive summary — this text goes into CHANGELOG.md.

## Empty Changesets

For changes that do not require a version bump (tests, internal refactors) but are flagged by CI:

1. Run `bun changeset --empty`.
2. This acknowledges changes without triggering a version bump and prevents CI from crashing.

## Release Workflow

1. Ensure all changes are committed.
2. Run `bun run build` to ensure artifacts are up to date.
3. Run `bun run release` (runs `changeset publish`).
   - Releases are usually handled by CI/CD, but this can be used locally if needed.

## Best Practices

- Always include a changeset for user-facing changes.
- Group related changes into a single changeset if appropriate.
- Be descriptive in the summary.
