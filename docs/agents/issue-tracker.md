# Issue tracker: GitHub

Issues, specs, and Wayfinder maps for this repo live in `ueberBrot/monque` GitHub Issues.
Use the `gh` CLI for all operations.

## Conventions

- **Create an issue**: `gh issue create --title "..." --body-file <body-file>`. Write multiline bodies to a file first.
- **Read an issue**: `gh issue view <number> --comments`, filtering comments by `jq` and also fetching labels.
- **List issues**: `gh issue list --state open --json number,title,body,labels,comments --jq '[.[] | {number, title, body, labels: [.labels[].name], comments: [.comments[].body]}]'` with appropriate `--label` and `--state` filters.
- **Comment on an issue**: `gh issue comment <number> --body-file <body-file>`
- **Apply / remove labels**: `gh issue edit <number> --add-label "..."` / `--remove-label "..."`
- **Close**: `gh issue close <number> --comment "..."`

Infer the repo from `git remote -v` -- `gh` does this automatically when run inside a clone.

## Pull requests as a triage surface

**PRs as a request surface: no.** External PRs are not part of the feature-request triage queue.

## When a skill says "publish to the issue tracker"

Create a GitHub issue.

## When a skill says "fetch the relevant ticket"

Run `gh issue view <number> --comments`.

## Wayfinding operations

Used by `/wayfinder`. A **map** is a parent issue; its **tickets** are child issues
that resolve decisions. The map body follows the skill's template: Destination,
Notes, Decisions so far, Not yet specified, and Out of scope.

### Labels

Use `wayfinder:map` for maps and one of `wayfinder:research`, `wayfinder:prototype`,
`wayfinder:grilling`, or `wayfinder:task` for tickets. These classify planning work;
the five triage labels in `triage-labels.md` retain their existing meanings.

Before creating a map or ticket, check existing labels with
`gh label list --limit 1000 --json name`. Create only missing Wayfinder labels using
`gh label create <label> --description "..." --color 5319E7`.

### Maps, tickets, and dependencies

- **Create a map**: `gh issue create --title "..." --label wayfinder:map --body-file <body-file>`.
- **Create a ticket**: create an issue with its `wayfinder:<type>` label and question.
  Link it as a sub-issue with `gh api --method POST repos/{owner}/{repo}/issues/<map>/sub_issues -F issue_id=<ticket-db-id>`.
- **Resolve database IDs**: `gh api repos/{owner}/{repo}/issues/<number> --jq .id`.
  Relationship endpoints take this numeric database ID, not the issue number or GraphQL node ID.
- **Add a blocker**: `gh api --method POST repos/{owner}/{repo}/issues/<ticket>/dependencies/blocked_by -F issue_id=<blocker-db-id>`.
  Create tickets before wiring their dependencies.

Use native sub-issues and dependencies where available. If sub-issues are unavailable,
keep an ordered task list of ticket links in the map and add `Part of #<map>` to each
ticket. If native dependencies are unavailable, add `Blocked by: #<number>, ...` to
the ticket body. Surface authentication and permission errors instead of treating them
as missing feature support.

### Find and claim the next ticket

List the map's children with
`gh api --paginate 'repos/{owner}/{repo}/issues/<map>/sub_issues?per_page=100'`.
For each open, unassigned child, list its blockers with
`gh api --paginate 'repos/{owner}/{repo}/issues/<ticket>/dependencies/blocked_by?per_page=100'`.
The **frontier** contains children with no open blockers. Pick the first in map order;
use the ordered task list and `Blocked by` issue references when using the fallbacks.
Missing dependency data is not proof that a ticket is unblocked.

Claim the ticket before working with `gh issue edit <ticket> --add-assignee @me`.
Use issue titles with links when referring to maps and tickets in user-facing text.

### Resolve a ticket

Post the answer with `gh issue comment <ticket> --body-file <answer-file>`, close the
ticket with `gh issue close <ticket>`, then add a short linked entry to the map's
Decisions so far. Fetch the latest map body before editing it and preserve other
contributors' changes; update it with `gh issue edit <map> --body-file <map-body-file>`.
Keep the detailed answer on the ticket. Link any research or prototype artifacts there.

See GitHub's [sub-issue API](https://docs.github.com/en/rest/issues/sub-issues) and
[issue dependency API](https://docs.github.com/en/rest/issues/issue-dependencies).
