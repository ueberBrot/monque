# ADR-0003: Framework-Neutral Management Surface

Place Management contracts, operations and policy in `@monque/management` so server
integrations expose the same behavior. Framework-specific Management Adapters own
mounting within the host application. This lets third-party adapters reuse the
Surface without copying its contracts or operations.
