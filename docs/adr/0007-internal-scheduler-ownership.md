# ADR-0007: Internal Scheduler Ownership

## Status

Accepted

## Context

Public synchronous controls, reads after stop, and Promise Workers that survive a shutdown
timeout require different resource lifetimes. A shared scheduler context obscured those
boundaries; a processing-run scope alone would interrupt work or forget occupied capacity.

## Decision

Compose focused internal Effect services once per initialized Scheduler Instance. The Node
facade owns its private ManagedRuntime and publishes it only after successful acquisition.
Failed initialization releases acquired resources and permits a fresh attempt. Recovery and
its synchronous notification precede the instance collision check; acquisition starts no
processing run.

The constructor creates the sole WorkerAdmission owner, preserving immediate registration,
pause controls, fairness, generation identity, and execution capacity before initialization
and across restarts. JobOwnership alone implements durable Claims, fenced transitions,
Heartbeats and stale recovery using the native driver. JobQueries owns shared read loads and
caches independently of processing generations. JobExecution supervises Promise Workers in
the initialized scope; admission retains their records until identity-checked release.

ProcessingResources retains the notification, Change Stream and maintenance handles needed
by synchronous facade controls. Each processing generation owns its polls, wakeups, cursors,
listeners and schedules. A stop captures its execution snapshot and MaintenanceRun before
waiting; renewable Heartbeats continue during that drain. An earlier stop or late callback
cannot close a replacement generation. Started native maintenance writes remain owned by
the initialized instance, with cross-generation serialization.

OperationTelemetry is captured by intake, ownership and execution. Its default Layer acquires
a fresh metric registry for each instance. The internal Layer seam accepts test observers;
reporting failures do not replace application outcomes. There is no public telemetry setup,
exporter transport or automatic caller Effect-context propagation.

Retain native-driver and caller-owned Db/session boundaries, Promise Workers and Standard
Schema validation, synchronous EventEmitter delivery, and the callback runners that bridge
native listeners and immediate controls. Management delegates to the public facade through
its request-level Effect/Promise boundary; Express and Ts.ED retain framework lifecycles.
The Dashboard and asset-serving adapters keep ADR-0006's browser and hosting boundaries.

## Consequences

Core operations compose Effects without calling public Promise adapters. Narrow dependency
records replace unrestricted shared-context access without introducing a service per helper
or another scheduler policy. Public stop closes processing resources without disposing the
initialized runtime, cancelling arbitrary Promise side effects, or closing borrowed clients
and sessions. Public exports, signatures, options, events and storage contracts stay unchanged.
