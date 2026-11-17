# ADR-0001: Job Ownership And Stale Recovery

Use atomic database claims with a unique execution token so only the current owner
can mutate a Job, even when a Scheduler Instance identifier is reused. Support
absolute lock timeouts and renewable leases; MongoDB's clock governs renewable
ownership. Renewable leases require all schedulers sharing a collection to
understand that ownership model.
