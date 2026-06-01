---
name: Monque Dashboard
description: Dark-first operator dashboard for Monque scheduler inspection and actions.
colors:
  bg: "#090c0d"
  bg-sidebar: "#0d1213"
  surface: "#111719"
  surface-raised: "#161d20"
  surface-muted: "#1d2629"
  border: "#2a3639"
  border-strong: "#3a4a4e"
  text: "#e3ebeb"
  text-muted: "#a8b5b5"
  text-subtle: "#7f8d8d"
  primary: "#11e167"
  primary-low: "#10291b"
  primary-muted: "#0f7a3d"
  primary-contrast: "#04100a"
  secondary: "#fc991b"
  secondary-low: "#31220d"
  secondary-high: "#ffd19a"
  danger: "#f05252"
  danger-low: "#321415"
  light-bg: "#f7faf8"
  light-surface: "#ffffff"
  light-border: "#d9e3df"
  light-text: "#17211d"
  light-muted: "#52635c"
typography:
  display:
    fontFamily: "Geist Variable, ui-sans-serif, system-ui, sans-serif"
    fontSize: "28px"
    fontWeight: 650
    lineHeight: 1.15
    letterSpacing: "0"
  headline:
    fontFamily: "Geist Variable, ui-sans-serif, system-ui, sans-serif"
    fontSize: "22px"
    fontWeight: 650
    lineHeight: 1.2
    letterSpacing: "0"
  title:
    fontFamily: "Geist Variable, ui-sans-serif, system-ui, sans-serif"
    fontSize: "16px"
    fontWeight: 600
    lineHeight: 1.35
    letterSpacing: "0"
  body:
    fontFamily: "Geist Variable, ui-sans-serif, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "0"
  label:
    fontFamily: "Geist Variable, ui-sans-serif, system-ui, sans-serif"
    fontSize: "12px"
    fontWeight: 500
    lineHeight: 1.35
    letterSpacing: "0"
  mono:
    fontFamily: "Geist Mono Variable, ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: 1.5
rounded:
  xs: "4px"
  sm: "6px"
  md: "8px"
  lg: "12px"
  pill: "999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "24px"
  xxl: "32px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.primary-contrast}"
    rounded: "{rounded.md}"
    padding: "0 12px"
    height: "32px"
  button-secondary:
    backgroundColor: "{colors.surface-raised}"
    textColor: "{colors.text}"
    rounded: "{rounded.md}"
    padding: "0 12px"
    height: "32px"
  button-danger:
    backgroundColor: "{colors.danger}"
    textColor: "#ffffff"
    rounded: "{rounded.md}"
    padding: "0 12px"
    height: "32px"
  nav-item-active:
    backgroundColor: "{colors.primary-low}"
    textColor: "{colors.primary}"
    rounded: "{rounded.md}"
    padding: "0 10px"
    height: "32px"
  chip-status:
    backgroundColor: "{colors.surface-muted}"
    textColor: "{colors.text}"
    rounded: "{rounded.pill}"
    padding: "2px 8px"
---

# Design System: Monque Dashboard

<!-- SEED: Dashboard package does not exist yet. Re-run impeccable document in scan mode once packages/dashboard exists. -->

## 1. Overview

**Creative North Star: "The Operator Console"**

Monque Dashboard is a dark-first product UI for operators who need to inspect scheduler state,
filter Jobs, read payloads, understand capabilities, and run deliberate Management actions. It
serves the product, not the brand page: dense enough for repeated operational work, quiet enough
for incident use, and familiar enough that a user can trust it without learning a new component
language.

The visual direction follows the selected probe 2: a table-first investigation surface with compact
filters, URL-backed state, local row selection, and a clear route from list scanning to Job detail.
Probe 3 contributes the Health, read-only, capability-disabled, and confirmation-state treatment.
The Dashboard should feel closer to Stripe Workbench, Linear, and Raycast than to the Astro docs
site, while still carrying Monque's green and orange brand colors.

This file is the design source for the Dashboard issues under GitHub PRD #455, especially #459
through #468. Architecture remains governed by ADR-0006: `@monque/dashboard` is an asset/UI-only
package, not a server, not a component library, and not a special API surface.

**Key Characteristics:**

- Dark-first, with light and system theme support.
- Table-first and route-first, not KPI-first.
- Restrained color with Monque green and orange used semantically.
- shadcn ecosystem primitives styled through Tailwind CSS variables and composed into
  Monque-specific feature components.
- Explicit loading, empty, unauthorized, forbidden, conflict, not-found, read-only, disabled, and
  capability-limited states.
- Keyboard navigable workflows with visible focus and no destructive hotkeys.

## 2. Colors

The palette is a restrained graphite system with Monque green as the active/primary signal and
Monque orange as caution or scheduled attention.

### Primary

- **Monque Operator Green** (`#11e167`): Primary actions, active navigation, selected filters,
  selected row emphasis, focus-visible rings, and successful low-risk status. Use it sparingly.
- **Green Low Field** (`#10291b`): Active nav backgrounds, selected row backgrounds, and subtle
  success or selection fills on dark surfaces.
- **Green Muted** (`#0f7a3d`): Borders or compact indicators when full green would overpower a
  dense table.

### Secondary

- **Scheduler Orange** (`#fc991b`): Pending, scheduled, warning, and time-sensitive attention.
  It is not a decoration color.
- **Orange Low Field** (`#31220d`): Warning banners, scheduled-state chips, and non-destructive
  caution backgrounds.
- **Orange High Text** (`#ffd19a`): Warning text on dark warning fields when contrast needs a
  lighter value.

### Tertiary

- **Conflict Red** (`#f05252`): Failed Jobs, destructive delete actions, hard errors, and conflict
  outcomes.
- **Red Low Field** (`#321415`): Destructive confirmation backgrounds and failed-state chips.

### Neutral

- **Console Black** (`#090c0d`): App background.
- **Sidebar Graphite** (`#0d1213`): Desktop sidebar and mobile drawer background.
- **Panel Graphite** (`#111719`): Primary content panels and table containers.
- **Raised Graphite** (`#161d20`): Toolbars, popovers, table headers, and elevated controls.
- **Muted Graphite** (`#1d2629`): Disabled fills, status chips, skeletons, and secondary panels.
- **Line Graphite** (`#2a3639`): Default borders and dividers.
- **Strong Line Graphite** (`#3a4a4e`): Focus-adjacent borders and selected-row outlines.
- **Operator Ink** (`#e3ebeb`): Primary text.
- **Muted Ink** (`#a8b5b5`): Secondary text, placeholders, and table metadata.
- **Subtle Ink** (`#7f8d8d`): Low-emphasis captions only when contrast remains accessible.
- **Light Theme Neutrals** (`#f7faf8`, `#ffffff`, `#d9e3df`, `#17211d`, `#52635c`): Light mode
  counterparts. Dark mode is the lead design; light mode should preserve the same density and
  semantic color rules.

### Named Rules

**The Green Rarity Rule.** Green marks the current path, a selected state, a safe primary action,
or focus. Do not use it as a page wash, chart fill default, or decorative glow.

**The Orange Means Attention Rule.** Orange means pending, scheduled, warning, or time-sensitive.
It should never appear on inactive navigation or decorative dividers.

**The Status Has Two Signals Rule.** Every status needs text plus an icon, count, shape, or label.
Color alone is never enough.

## 3. Typography

**Display Font:** Geist Variable, ui-sans-serif, system-ui, sans-serif
**Body Font:** Geist Variable, ui-sans-serif, system-ui, sans-serif
**Label/Mono Font:** Geist Mono Variable, ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas,
monospace

**Character:** Product-native, compact, and familiar. The docs site can keep Quicksand; the
Dashboard should use Geist Variable because it is data-friendly without carrying Inter's
overfamiliar product-SaaS tone. Install it through Fontsource variable packages:
`@fontsource-variable/geist` and `@fontsource-variable/geist-mono`. Import only the needed
axes/styles in the app entry, and do not rely on remote font loading.

### Hierarchy

- **Display** (650, 28px, 1.15): Route titles only, such as Queue Views, Jobs, Health, or a Job
  detail heading.
- **Headline** (650, 22px, 1.2): Detail page section headers and empty-state titles.
- **Title** (600, 16px, 1.35): Panel titles, dialog titles, table toolbar titles.
- **Body** (400, 14px, 1.5): Main UI copy, table cells, descriptions, and error text. Keep prose
  blocks under 75ch.
- **Label** (500, 12px, 1.35): Form labels, table header labels, chips, metadata labels, and
  compact helper text.
- **Mono** (400, 12px, 1.5): Job IDs, cursors, JSON keys, ISO dates, payload previews, and route
  or config values.

### Named Rules

**The Fixed Scale Rule.** Use fixed product UI sizes, not viewport-fluid headings. The Dashboard
is a tool surface, not a landing page.

**The Tabular Data Rule.** Numeric counts, timestamps, durations, attempts, and cursor-adjacent
values should use tabular numerals.

**The Sentence Case Rule.** Use sentence case for labels and actions. Reserve uppercase for very
short status tokens only when the component remains readable.

**The No Inter Rule.** Do not use Inter as the Dashboard typeface. If Geist cannot be bundled, fall
back to the system sans stack until a better bundled font is chosen.

## 4. Elevation

Depth is conveyed through tonal layering and borders first. Shadows are reserved for overlays that
must separate from dense content: command palette, dropdowns, popovers, dialogs, and toasts.
Resting panels, cards, table rows, and buttons should not combine a decorative border with a wide
soft shadow.

### Shadow Vocabulary

- **Popover lift** (`box-shadow: 0 8px 12px rgba(0, 0, 0, 0.36)`): Menus, dropdowns, tooltips,
  and compact floating surfaces.
- **Dialog lift** (`box-shadow: 0 18px 40px rgba(0, 0, 0, 0.5)`): Confirmation dialogs, command
  palette, and modal error details. Do not pair this with a visible 1px border.
- **Focus ring** (`0 0 0 2px #090c0d, 0 0 0 4px #11e167`): Keyboard focus on dark surfaces.

### Named Rules

**The Flat At Rest Rule.** Tables, panels, sidebars, and cards are flat at rest. Use borders,
background shifts, and typography for hierarchy.

**The Overlay Only Rule.** If an element does not escape the normal document flow, it usually does
not need a shadow.

## 5. Components

Components should compose shadcn ecosystem primitives with Monque-specific feature components.
Tailwind CSS is the styling layer for layout, tokens, state variants, and local composition. Prefer
standard affordances: buttons, inputs, tabs, dialogs, popovers, command palette, drawer, tables,
menus, and tooltips.

The package shell should include the normal shadcn setup: `components.json`, Tailwind config,
global CSS variables, a `cn` utility, and local primitive files generated or copied from the
shadcn ecosystem after source review. Do not hand-roll primitives that shadcn already covers.
Local code should focus on Dashboard-specific compositions such as Jobs tables, Queue View
summaries, action confirmations, payload panels, capability states, and route boundaries.

### Buttons

- **Shape:** Compact rectangle with 8px radius.
- **Primary:** Green fill, near-black text, 32px height, icon plus verb-object label when useful.
- **Secondary:** Raised graphite fill, Operator Ink text, Line Graphite border when needed.
- **Ghost:** Transparent at rest, graphite hover, used for toolbar actions and row actions.
- **Danger:** Red fill only for confirmed destructive actions. Delete confirmation buttons must say
  "Delete job" or "Delete selected jobs".
- **Hover / Focus:** Hover changes background or border tone. Focus uses the visible green ring.
- **Loading / Disabled:** Loading preserves width and label context. Disabled state includes text
  or tooltip explaining the capability or state limit.

### Chips

- **Style:** Pill radius for compact status and filter chips.
- **Status:** Include icon plus text for pending, processing, completed, failed, canceled,
  scheduled, read-only, unauthorized, and capability-disabled states.
- **Filters:** Active filter chips use green low field and green text. Removable chips use an
  accessible remove button with a label such as "Remove status filter".

### Cards / Containers

- **Corner Style:** 8px for tables, panels, route containers, and repeated items. 12px only for
  dialogs or large empty states.
- **Background:** Console Black for page, Panel Graphite for content, Raised Graphite for toolbar
  and table header layers.
- **Shadow Strategy:** No shadows at rest. See Elevation for overlay exceptions.
- **Border:** 1px Line Graphite for panels, tables, inputs, and separators.
- **Internal Padding:** 12px for dense toolbars, 16px for panels, 24px for route-level empty or
  error states.

### Inputs / Fields

- **Style:** 8px radius, dark raised fill, 1px border, 32px to 36px height.
- **Focus:** Green focus ring, no layout shift.
- **Placeholder:** Muted Ink, never low-contrast gray.
- **Error / Disabled:** Error uses red text plus icon and message. Disabled explains read-only,
  capability, or state restrictions when the control remains visible.
- **Date Filters:** Use explicit labels for created, updated, and next run ranges. Accept ISO-backed
  values through the Management contract.

### Navigation

- **Desktop:** Persistent left sidebar with Monque label, Queue Views, Jobs, Health, theme control,
  command palette trigger, and compact runtime/config status where needed.
- **Mobile:** Drawer navigation with the same destinations and action vocabulary. Main content
  should prioritize filters and rows over decorative headers.
- **Active State:** Green low background, green text, icon plus label.
- **Route Order:** Queue Views first and landing, Jobs second, Health third. Do not add a synthetic
  overview route in v1.

### Tables

- **Structure:** Toolbar, server-backed filters, manual cursor pagination, table body, selection
  bar, and refresh state.
- **Primitive Base:** Use TanStack Table for behavior and shadcn table, checkbox, dropdown menu,
  select, popover, calendar, command, tooltip, and skeleton primitives for interaction surfaces.
- **Sorting:** Show only Management-supported sort fields: identifier, created time, updated time,
  and next-run time. Never imply client-side sorting across only the current cursor page.
- **Filters:** Job Name, status, created date, updated date, and next-run date. Queue View detail
  implies Job Name and should not show a duplicate editable Job Name filter.
- **Selection:** Local only. Selection must not serialize into the URL. Polling preserves selected
  rows that still exist and are still valid.
- **Empty:** Empty states say what filter or route produced the absence and provide safe actions:
  clear filters, refresh, copy URL.
- **Pagination:** Cursor controls should be explicit and compact. Page size defaults to 50 and caps
  at 100 because Management owns that behavior.

### Job Detail

- **Layout:** Full route with status, attempts, timestamps, schedule information, failure reason,
  copy controls, and read-only payload viewer.
- **Payload:** Structured JSON viewer after source review of the chosen shadcn-compatible component.
  Do not apply Dashboard-side redaction. Respect Management serialization and redaction output.
- **Copy Controls:** Job ID, payload, and shareable URL. Button labels or tooltips must name the
  copied value.

### Health And Capabilities

- **Health:** Show scheduler health, Management API reachability, polling state, runtime config,
  and capabilities in compact grouped panels.
- **Auth:** 401 and 403 are distinct route states. There is no Dashboard login screen.
- **Read-only:** Reads remain available. Mutations remain visible where useful but disabled with
  clear reason text.
- **Capabilities:** Downstream action controls read capability state rather than hardcoding action
  availability.

### Dialogs And Actions

- **Confirmation:** Single delete and all bulk actions require confirmation. Bulk actions operate
  only on explicitly selected Jobs.
- **Reschedule:** Use an ISO-backed date value and clear validation messages.
- **Conflict / Not Found:** Conflict means the Job changed before the action completed. Not found
  means stale data should disappear after refetch. Both states should trigger relevant refetches.
- **Focus:** Dialogs trap focus and restore it to the invoking control.

### Command Palette

- **Scope:** Navigation to Queue Views, Jobs, Health, plus safe view actions: refresh, clear
  filters, toggle theme, copy URL, and shortcut help.
- **No Mutations:** Destructive and state-changing Job actions are never palette actions and never
  hotkeys.
- **Behavior:** Fast open, keyboard-first, searchable, and safe to dismiss with Escape.

## 6. Do's and Don'ts

### Do:

- **Do** make Queue Views the landing route and first navigation item.
- **Do** use probe 2 as the main visual direction: table-first investigation, compact filters, and
  dense metadata.
- **Do** borrow probe 3 for Health, read-only, capability-disabled, and confirmation states.
- **Do** keep filters, sort, cursor, and page size in URL state.
- **Do** keep row selection local and never serialize it into a shareable URL.
- **Do** include browser credentials by default for Management API requests.
- **Do** show 401 and 403 as different states with different recovery language.
- **Do** show capability-disabled actions clearly instead of hiding every unsupported operation.
- **Do** require confirmation for single delete and every bulk action.
- **Do** use icons plus labels for status so color is never the only signal.
- **Do** use route pending, error, and not-found boundaries from the package shell onward.
- **Do** use screen-aware polling and a visible manual refresh action.
- **Do** validate runtime config at boot: base path, API base URL, and optional polling interval.
- **Do** keep the Dashboard asset package independent from serving adapters and Management API
  mounting.

### Don't:

- **Don't** build a marketing-style analytics dashboard.
- **Don't** build a synthetic KPI homepage.
- **Don't** build a decorative SaaS surface.
- **Don't** build a standalone server.
- **Don't** build Docker distribution.
- **Don't** build a deep theme editor.
- **Don't** build a public React component library for v1.
- **Don't** add job creation.
- **Don't** add worker registration.
- **Don't** add scheduler lifecycle controls.
- **Don't** add payload editing.
- **Don't** add Dashboard-side payload redaction.
- **Don't** add realtime protocols in v1.
- **Don't** add destructive hotkeys.
- **Don't** add "select all matching filter" bulk actions.
- **Don't** import server-only Management Surface code into the browser bundle.
- **Don't** import core scheduler code into the browser bundle.
- **Don't** import MongoDB code into the browser bundle.
- **Don't** import adapter internals into the browser bundle.
- **Don't** import Management root exports into the browser bundle.
- **Don't** hand-roll buttons, dialogs, drawers, tables, selects, popovers, tooltips, command
  palette, skeletons, or form primitives when shadcn ecosystem components cover the behavior.
- **Don't** bypass Tailwind tokens with one-off CSS values unless a component has a documented
  reason.
- **Don't** use Inter as the Dashboard font.
- **Don't** use client-only sorting or filtering while implying server-wide results.
- **Don't** use green or orange as decoration.
- **Don't** use glassmorphism, gradient text, decorative blobs, side-stripe borders, or a grid of
  identical cards as the main structure.
- **Don't** put destructive actions in the command palette.
