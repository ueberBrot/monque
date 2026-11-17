---
"@monque/management": minor
---

Expose native Effect Management operations with host-service authorization and payload serialization. Share policy, DTO mapping, error classification, and optional capabilities with existing synchronous and Promise integrations while preserving the existing versioned HTTP behavior. Expose `createNativeManagementRouter` using the official oRPC Effect bridge and the same procedure map as compatibility integrations. Hosts supply Effect services, request scope, and cancellation. Keep parallel request work owned by the calling fiber.
