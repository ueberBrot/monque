# ADR-0005: oRPC Management Route Map

Use one oRPC contract with Zod-derived DTOs and generated OpenAPI to keep routing,
validation and client types aligned. Serve Dashboard RPC and versioned HTTP from
one Management router. Generate OpenAPI for third-party HTTP clients. Scheduler
capabilities change operation availability, not the published contract.
