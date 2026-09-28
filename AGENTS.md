# Monque

## Agent skills

### Issue tracker

Issues, specs, and Wayfinder maps are tracked in GitHub Issues for `ueberBrot/monque`.
See `docs/agents/issue-tracker.md` for tracker commands and Wayfinding operations.

### Triage labels

Use the default five-label triage vocabulary. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context layout: root `CONTEXT.md` plus `docs/adr/`. See `docs/agents/domain.md`.

### Reviewing uncommitted work

When `code-review` reviews work before a commit, compare the working tree against the
merge-base with the requested base: `git diff "$(git merge-base <base> HEAD)"`.
Also read relevant untracked files from `git ls-files --others --exclude-standard`.
The skill's `<base>...HEAD` comparison covers committed changes only; an empty commit
diff does not mean there is no work to review. Use the user's request as the spec when
it describes the work without a separate ticket or spec file.

## Testing

Test runtime behavior. Don't write tests for guarantees already enforced by the type system.
