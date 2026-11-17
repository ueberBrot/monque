# ADR-0005: oRPC Management Route Map

Use one oRPC contract with Zod-derived DTOs and generated OpenAPI to keep routing,
validation and client types aligned. Serve Dashboard RPC and versioned HTTP from
the same Management router, retaining OpenAPI for third-party clients. Scheduler
capabilities change operation availability, not the published contract.
