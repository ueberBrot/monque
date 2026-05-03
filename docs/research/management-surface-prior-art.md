# Management Surface Prior Art

This note records prior art for Monque's Management Surface, Management Adapters,
Dashboard, and future Docker distribution. It is research input for a PRD, not a normative
contract. Normative decisions live in `CONTEXT.md` and ADRs.

## Bull Board

Bull Board is the strongest architectural comparison for Monque.

Findings:

- It splits packages into a core API package, a UI package, queue adapters, and framework
  adapters such as Express, Fastify, Koa, Hapi, NestJS, Hono, H3, and Elysia.
- It mounts through framework adapters rather than making one server framework the only
  integration path.
- It expects host applications to provide authentication middleware, but it also exposes
  request-scoped visibility controls.
- It supports read-only mode and retry disabling at the queue adapter level.
- It supports payload formatting/redaction through field formatters. Its README shows
  `fast-redact` for fields such as cookies, passwords, and access tokens.
- It does not appear to publish a first-class OpenAPI contract for its dashboard API.
- It primarily documents embedded server integration. A first-party standalone Docker image
  is not the primary distribution model.

Implications for Monque:

- Use Bull Board's package split as the closest prior-art pattern:
  `@monque/management`, Management Adapters, Dashboard package, and later standalone/Docker.
- Keep authentication in the host application, but expose read-only mode, capabilities, and
  action-grained authorization hooks in the Management Surface.
- Include payload serialization/redaction from v1 to avoid exposing arbitrary job data by
  accident.
- Improve on Bull Board by making OpenAPI a first-class exported contract.

Sources:

- Bull Board repository: https://github.com/felixmosh/bull-board
- Bull Board README: https://raw.githubusercontent.com/felixmosh/bull-board/master/README.md

## Agendash / Agenda

Agendash is the older MongoDB-backed scheduler dashboard reference.

Findings:

- Legacy Agendash exposes middleware that can be mounted in Express, with additional
  framework modes such as Hapi and Fastify.
- It expects developers to protect the mounted path with their own authentication
  middleware.
- Legacy Agendash supports standalone CLI and Docker usage.
- It does not appear to expose first-class read-only, payload redaction, or OpenAPI
  contracts in the same way Monque is planning.
- Agenda v6 has moved into a monorepo containing Agenda, Agendash, `agenda-rest`, and
  backend packages.

Implications for Monque:

- Embedded middleware is useful, but the Management Surface should not be middleware-shaped.
  Framework middleware belongs in Management Adapters.
- Standalone and Docker distribution are valid future demand signals, but they should come
  after the Management Surface, at least one adapter, and the Dashboard package.
- Route-level auth alone is insufficient for modern dashboard safety; payload redaction and
  read-only/capability controls should be first-class.

Sources:

- Current Agenda monorepo: https://github.com/agenda/agenda
- Agendash package: https://github.com/agenda/agenda/tree/main/packages/agendash
- Legacy Agendash repository: https://github.com/agenda/agendash

## Pulse

Pulse is a related Agenda-derived scheduler ecosystem, but it is not a direct dashboard
package comparison.

Findings:

- The Pulse repository was archived and made read-only on October 27, 2025.
- The public materials focus on scheduling and Pulsecron services rather than a reusable
  open-source dashboard adapter architecture comparable to Bull Board or Agendash.

Implications for Monque:

- Pulse should not drive Monque's Management Surface architecture.
- Bull Board and Agendash are stronger prior-art references for package shape and dashboard
  integration.

Sources:

- Pulse repository: https://github.com/pulsecron/pulse
- Pulse docs: https://docs-pulse.pulsecron.com/
- Pulsecron site: https://www.pulsecron.com/

## Recommended Direction

The research supports the decisions already captured in ADR-0003 and ADR-0004:

- Build `@monque/management` as a framework-neutral Management Surface.
- Keep Express, Ts.ED, NestJS, and future adapters in separate Management Adapter packages.
- Make Express the first adapter.
- Keep the Dashboard separate from the Management Surface.
- Add Docker only after a standalone Dashboard/server shape exists.
- Treat host applications as responsible for authentication.
- Provide read-only mode, action-grained authorization, capabilities, and request-aware
  payload serialization/redaction in Monque's Management Surface.
