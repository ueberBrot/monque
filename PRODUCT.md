# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Scope

This product record covers the bundled Monque Dashboard and its integration with host
applications.

## Users

Monque operators use the Dashboard inside backend applications to inspect scheduler state,
browse Queue Views, investigate Jobs, review scheduler health, and run existing Management
actions without building custom tooling. Backend integrators use the Dashboard package and
serving adapters to mount the UI beside the Management API under their own authentication and
authorization middleware. Monque maintainers use the Dashboard as a first-party client that
exercises the same Management Route Map exposed to third-party clients.

## Product Purpose

The bundled Monque Dashboard is an asset/UI-only React package, `@monque/dashboard`, backed
by the browser-safe Management contract and served by framework-specific UI-only adapters. It
exists to give operators a reliable, type-safe interface for Queue Views, Jobs, Job detail,
Health, capabilities, local processing controls, and Job actions while preserving Monque
package boundaries.

Success means the Dashboard can be served from host backends under different mount paths,
uses the same REST-shaped Management Route Map as other clients, avoids any Dashboard-only
API, and gives operators clear, accessible workflows for inspection and deliberate mutation.
Queue Views are the landing experience.

## Brand Personality

Professional, minimal, modern. The interface should feel like a dependable operator tool:
calm under incident pressure, dense enough for real work, and familiar enough that experienced
users can trust it quickly. It should compose shadcn ecosystem primitives with Monque-specific
feature components instead of inventing a custom component language.

## Capabilities and Constraints

Operators inspect priorities in Job lists and details and change them for pending Jobs,
individually or for an explicit selection. Priorities are signed safe integers, default to
zero, and order due Jobs within a Job Name with higher values first. A recurring Job's edited
priority also applies to future runs.

Health exposes whole-instance pause and resume; Queue Views expose controls and policies for
registered local workers. These controls affect only the attached scheduler instance, leave
running Jobs to finish, and respect Management permissions and read-only mode. Pauses do not
survive process restarts. Resuming the instance preserves individual worker pauses.

The Dashboard is served by host applications. Standalone serving and Docker distribution
remain planned work.

Do not build a marketing-style analytics dashboard, synthetic KPI homepage, decorative SaaS
surface, deep theme editor, or public React component library. Do not add job creation, worker
registration, scheduler start/stop controls, payload editing, Dashboard-side payload redaction,
realtime protocols, or "select all matching filter" bulk actions. Do not import server-only Management Surface
code, core scheduler code, MongoDB code, adapter internals, or Management root exports into
the browser bundle.

## Product Principles

Start from operational groupings. Queue Views are the landing experience because Job Name
groupings are the operator's natural entry point.

Preserve the contract boundary. The Dashboard is one client of the Management Route Map, not
a special API consumer with private routes or direct data access.

Make state explicit. Loading, empty, unauthorized, forbidden, conflict, not-found, read-only,
disabled, and capability-limited states must be visible and understandable.

Treat mutation as deliberate. Single destructive actions and all bulk actions require
confirmation; bulk actions apply only to explicitly selected Jobs.

Keep views shareable without leaking intent. Filters, sort, cursor, and page size belong in
URL state; row selection remains local.

## Accessibility & Inclusion

The accessibility baseline is keyboard-navigable core workflows, visible focus states,
accessible action names, dialogs that trap and restore focus, and status communication that
does not rely on color alone. The Dashboard supports light, dark, and system theme modes,
browser credentials for host-owned authentication, distinct 401 and 403 states, and no
Dashboard login screen. Motion should be restrained, state-driven, and compatible with
reduced-motion preferences.

## Source Of Truth

- Current Dashboard workflows:
  [Dashboard configuration](apps/docs/src/content/docs/dashboard/configuration.mdx)
- Current processing and Job actions:
  [Management Surface](apps/docs/src/content/docs/management/surface.mdx)
- Available capabilities and planned additions:
  [Project Direction](apps/docs/src/content/docs/roadmap.mdx)
- GitHub PRD: https://github.com/ueberBrot/monque/issues/455
- Implementation issues: https://github.com/ueberBrot/monque/issues/456 through
  https://github.com/ueberBrot/monque/issues/468
- Architecture decision:
  https://github.com/ueberBrot/monque/blob/main/docs/adr/0006-dashboard-asset-package-and-serving-adapters.md
