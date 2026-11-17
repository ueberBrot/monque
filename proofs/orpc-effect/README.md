# oRPC v2 / Effect compatibility gate (#686)

**Verdict: PASS for the focused compatibility gate in #686.** The exact candidate is
`2.0.0-beta.45` for all participating oRPC packages, with Effect and
`@effect/platform-bun` `4.1.4`, executed using Bun `1.4.4`. npm reported beta.45 as
`@orpc/effect`'s available version at selection; its Effect peer is `>=4.0.0`.
The private manifest and separate lockfile pin the complete proof graph. This
folder is outside workspace discovery. No shipped dependency was upgraded.

This proves compatibility of the execution seam, not completion of #685. Later
migration must retain these guarantees and run the complete Management Route Map,
Dashboard/TanStack Query, package portability, MongoDB and subprocess suites.
If any required gate fails on a later run or with a different version, **block the
dependent migration** and record that failure for an architecture decision.

## Reproduce

Run from the repository root, with loopback networking permitted:

```sh
vp install --frozen-lockfile
bun install --cwd proofs/orpc-effect --frozen-lockfile
bun test proofs/orpc-effect/proof.test.ts
(cd proofs/orpc-effect && bun run type-check)
node_modules/.bin/effect-tsgo diagnostics --project proofs/orpc-effect/tsconfig.json
vp run lint:effect
vp lint proofs/orpc-effect/host.ts proofs/orpc-effect/proof.test.ts --type-aware --type-check --deny-warnings
vp fmt --check proofs/orpc-effect
```

Use the repository's Bun 1.4.4 toolchain. No database process, Docker, Express,
application server, or global dependency installation is needed. Each case owns
an ephemeral loopback listener; cleanup runs in `finally`. The two-second native
timer is a failure deadline for real I/O, not a simulated Effect time assertion.
The checked-in execution transcript is in `evidence.txt`.

## What ran

One small router, built with official `.effect` handlers and the v2 route
extension, is mounted through both official Fetch `RPCHandler` and
`OpenAPIHandler`. The host request implementation uses portable `effect/http`
interfaces; only private listener composition imports `BunHttpServer`. RPC uses
actual `RPCLink` client requests over TCP, not an in-process router client or a
mock fetch. OpenAPI uses real HTTP requests at `/api/v1/processing`.

The native operation is the real Scheduler Instance's
`monque.effects.getProcessingState()`, supplied by the host through Context.
It returns the existing `ProcessingStateDtoSchema` from the repository. This
operation is deliberately local and works before database initialization. A real
MongoClient supplies the borrowed Db handle, but never connects. The proof does
not substitute a fake scheduler or route through the Promise Management facade.

Fourteen cases verify:

- Typed RPC invocation and the existing HTTP success DTO and `200` status.
- A host Identity service and service-backed Effect authorization, on both
  transports; distinct identities before and after overlapping work resumes.
- Authorization failures: RPC decodes `FORBIDDEN`; HTTP keeps status `403` and
  `{ "error": "Denied" }`. Only HTTP gets the custom error encoder.
- Defects remain failures, release resources, and expose no private defect
  message. RPC retains its native internal-error encoding; HTTP retains the
  existing `500` / `{ "error": "Internal server error" }` representation.
- Request finalizers on success, denial, defect, client abort and shutdown.
- Actual client abort interrupts pending Effect authorization. A separately
  held runner finalizer proves host request scope cleanup waits for oRPC runner
  termination rather than abandoning a detached Promise.
- An operation span has the host request's span as parent, with the same trace ID.
- Shutdown during active work waits for a held request finalizer before disposing
  the scheduler and closing the borrowed client; the listener then rejects calls.
- Listener startup failure closes the already acquired shared-resource scope.

## Execution and ownership

The installed official integration's `handlerGen` calls `runPromise`, which uses
`Effect.runPromiseExitWith(effect/context)(effect, { signal })`. This starts a
separate root fiber. It does **not** attach execution to the HTTP request fiber.
It unwraps successful exits, preserves abort reasons for interrupt-only causes,
and squashes other causes into transport failures. Check the selected package's
`dist/shared/effect.C3k3V95E.mjs`, SHA-256:

```text
7f1fb780230d9c4890fd67d1e4b832950fb13e32b16a4bd2f36b90cd1abeba85
```

The proof deliberately bridges the obligations together in one host adapter:

1. Capture the host request Context, including its Scope and tracing provider,
   and add request Identity, authorization and native scheduler operations.
2. Supply this exact Context using official `effect/context`. Its ParentSpan is
   present in Effect 4.1.4; the actual request tests verify child parentage. No
   claim is made about arbitrary fiber-local state or other Effect versions.
3. Mark HTTP work interruptible; Effect HTTP otherwise starts it uninterruptibly.
4. Combine the source request signal with the signal provided by `tryPromise`.
   Always construct a new Web Request: installed `HttpServerRequest.toWebResult`
   returns its existing Web Request unchanged when one exists, so passing only
   its conversion options would miss host-fiber shutdown interruption.
5. On every exit, join the transport Promise in an uninterruptible finalizer
   before the HTTP-owned request scope closes. Provide that scope to oRPC's
   separately started runner rather than creating application layers per call.
6. Acquire shared resources before the server, so scope teardown finishes HTTP
   work before scheduler disposal and client close. Startup failure closes the
   same scope. The host owns the listener and shared resources.

The proof-local `TransportFailure` preserves failures of the Promise transport
edge separately from native authorization failure and interruption. Defects are
not authorization grants; cancellation remains interruption in the Effect runner.

## Limits and migration constraints

Cancellation is **not rollback**. This proof makes no claim about stopping MongoDB
writes, transactionality, or exactly-once behavior. Core's admitted native I/O is
intentionally uninterruptible and owned by the initialized Scheduler Instance;
disposal waits for it (ADR-0007). A write already started may finish after a client
aborts. The blocked authorization case proves cancellation of interruptible
request work, not cancellation of admitted external effects.

This is a Bun-hosted compatibility run of a portable request implementation, not
an isolated packed Node consumer test. Native Worker execution, real MongoDB,
process signals, payload serializers, every Management operation and protection,
OpenAPI document generation, Dashboard assets and TanStack Query behavior remain
required in the corresponding downstream tickets. The coordinated Query/Zod/
contract packages are pinned here to establish available versions; this gate
is not their full migration regression suite. Do not infer cross-major RPC
interoperability. No application-owned external telemetry provider is created or
closed; tracing assertions use Effect's host tracer and span context.

## Architecture passes

Both passes used fresh exploration agents, codebase-design vocabulary, the
GLOSSARY and ADRs 0003–0007. No HTML was generated, as instructed.

1. **Before implementation:** the current Management router and hooks cross
   Promise adapters and cannot establish native execution. Keep a disposable
   proof outside workspace discovery and call native scheduler Effects directly.
   Concentrate context, cancellation, scope, tracing and termination joining in
   one adapter with two real transports. The deletion test shows this module
   earns its depth: deleting it redistributes these obligations across adapters.
   Applied. No speculative shared-operation abstraction or shipped refactor.
2. **After execution:** remove the redundant `restoreParent` control and explicit
   parent reinjection; captured Context already carries ParentSpan in 4.1.4.
   Read Identity again after suspension, and hold runner cleanup independently
   of request-scope cleanup. Applied all three. Locality improves by keeping
   these observations at the existing request/lifecycle seam; no new module is
   justified by the deletion test.

TDD began with a failing public RPC call, then established the smallest host.
Startup cleanup and delayed runner cleanup each had an observed red test before
its implementation. Initial v1-style route and URL usage failed against v2;
selected-release imports and `RPCLink({ origin, url: "/rpc" })` fixed them.
Existing HTTP internal-error wording required an HTTP-only encoder. These were
corrected integration attempts, not unresolved required-gate failures.
