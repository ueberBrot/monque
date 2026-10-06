# Monque

## Agent skills

### Dependency skills

Before changing code that uses a dependency, run `vp run skills list` from the
repository root and load the most specific matching skill with
`vp run skills load <package>#<skill>`. The root `package.json` defines the
permitted package sources. Apply the installed skill before editing. If no skill
matches, use the installed source and first-party documentation.

### Effect

Before writing or reviewing Effect code, read
`packages/core/node_modules/effect/AGENTS.md`, the relevant examples in its
`ai-docs/src/`, and the source of the modules being used in its `src/`. Use these
installed files to check v4 APIs and behavior. Keep the public API's synchronous
and Promise contracts intact, and run `vp run lint:effect` after Effect changes.
For native Effect time tests, read
`packages/core/node_modules/@effect/vitest/AGENTS.md` and use `it.effect` with
`TestClock`. Exercise synchronous and Promise adapters with ordinary tests;
retain Vitest fake timers when asserting native timer cleanup or synchronous
callback delivery.

### Issue tracker

Issues, specs, and Wayfinder maps are tracked in GitHub Issues for `ueberBrot/monque`.
See `docs/agents/issue-tracker.md` for tracker commands and Wayfinding operations.

### Triage labels

Use the default five-label triage vocabulary. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context layout: root `GLOSSARY.md` plus `docs/adr/`. See `docs/agents/domain.md`.

### Reviewing uncommitted work

When `code-review` reviews work before a commit, compare the working tree against the
merge-base with the requested base: `git diff "$(git merge-base <base> HEAD)"`.
Also read relevant untracked files from `git ls-files --others --exclude-standard`.
The skill's `<base>...HEAD` comparison covers committed changes only; an empty commit
diff does not mean there is no work to review. Use the user's request as the spec when
it describes the work without a separate ticket or spec file.

## Testing

Test runtime behavior. Don't write tests for guarantees already enforced by the type system.
