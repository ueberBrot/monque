---
name: changeset-management
description: Instructions for managing releases using Changesets. Use this when the user wants to create a new release version or document changes.
---

# Changeset Management Skill

This skill explains how to manage versions and changelogs using Changesets.

## When to use this skill

- When the user has made changes that require a release (feature, fix, breaking change).
- When the user asks to "create a changeset" or "prepare a release".

## How to use it

### Creating a Changeset

1.  Run `bun changeset` in the root directory.
2.  Select the packages that have changed.
3.  Choose the appropriate bump type:
    - **major**: Breaking changes.
    - **minor**: New features (backward compatible).
    - **patch**: Bug fixes (backward compatible).
4.  Write a summary of the changes.

### Empty Changesets

If you have made changes to the codebase (e.g., tests, internal refactors) that *do not* require a version bump but are being flagged by CI as "changed packages without changeset":

1.  Run `bun changeset --empty`.
2.  This creates a changeset file that acknowledges the changes without triggering a version bump.
3.  **Crucial**: This prevents the CI workflow from crashing due to missing changesets for detected changes.

### Release Workflow

To publish a release:
1.  Ensure all changes are committed.
2.  Run `bun run build` to ensure artifacts are up to date.
3.  Run `bun run release` (which runs `changeset publish`).
    - *Note*: Usually, releases are handled by CI/CD, but this command can be used locally if needed.

### Best Practices

- Always include a changeset for user-facing changes.
- Group related changes into a single changeset if appropriate.
- Be descriptive in the summary—this text goes into the CHANGELOG.md.
