---
name: Monque Dashboard
description: Compact, responsive operator workspace built with shadcn Base UI components.
---

# Dashboard design

Mode: Operate. Operators inspect queues, investigate failed jobs, and perform explicit job
actions. Prioritize readable state, predictable navigation, and compact controls.

## Visual system

Use the semantic tokens in `packages/dashboard/src/styles.css`. Follow the system theme by
default, with persistent light and dark overrides. Neutral surfaces and quiet borders frame
the content; Monque green identifies navigation and primary actions. Amber and red communicate
warning and failure states alongside text. Geist is the interface face; Geist Mono is for IDs,
schedules, and payloads. Numeric metrics use tabular figures.

Processing uses blue, completed uses green, and failed uses red across status badges and
Queue View icons. Pending, cancelled, and total remain neutral. Highlight nonzero failed
counts in red. Use the Monque logo for application branding and the browser favicon.

## Layout

The application root owns the viewport height. The development toolbar shares that height;
the main content scrolls independently while navigation and the theme control remain visible.
A 224px desktop sidebar contains Queue Views, Jobs, Health, and theme selection. Small screens
use a header and navigation dialog. Main content has 16px mobile and 32px desktop padding.
Queue Views are compact linked rows, with aligned status counts on desktop and labeled counts
on mobile. Jobs keeps name, status, selection, and actions visible on phones; short IDs and relative creation times distinguish runs on phones. Secondary table
columns appear at wider breakpoints. Date filters and bulk controls appear when needed.
The development toolbar collapses in document flow.

Job detail puts status, identity and failure reason first, then recovery actions, compact
summary metadata, payload and lifecycle metadata. Copy utilities sit beside their targets.
Preserve list filters, cursor and sort through detail navigation; queue-origin links return
to the same queue page. Show the last successful update and fetching or paused state.
Disabled actions have explanations accessible by keyboard and touch.
Payload content is top-aligned and can scroll horizontally without widening the page.
Commands supports search and keyboard selection, with no direct destructive-action hotkeys.

## Components

Generate UI primitives with `bunx shadcn@latest add <component>` from `packages/dashboard`.
Use the configured `base-nova` registry. Keep generated Base UI behavior, named exports, and
Biome formatting. Status badge variants are a project extension. Command uses the registry's
cmdk implementation inside a Base UI dialog. Use shadcn controls for forms, menus, dialogs,
tables, and collapsibles. Avoid native confirm/prompt dialogs.
Use `class-variance-authority` (CVA) for component variants, matching the installed shadcn components.

## Interaction and accessibility

Support keyboard focus, Escape dismissal, status feedback, and reduced motion. Show explicit
confirmation for delete and bulk changes. Preserve filters in the URL. Poll visible views,
refresh after mutations, and expose useful API errors. Keep mock changes persistent for the
life of the development server. Never describe stopped development workers as healthy.

Use shadcn's destructive variant for Delete, including bulk deletion and confirmation.
Keep Cancel, Retry, and Reschedule neutral in the bulk toolbar.

## Dates and time

Use shared date-fns utilities with `@date-fns/tz` for dashboard parsing and formatting.
Display and edit in the operator's browser timezone, label that zone, and send UTC ISO
timestamps to the Management API. Reject invalid dates and nonexistent daylight-saving
times. Date inputs use the shadcn Calendar and Popover composition.

Show relative time alongside the exact timestamp. Update relative labels every 30 seconds
while visible and immediately when returning to the tab, independently of API polling.
