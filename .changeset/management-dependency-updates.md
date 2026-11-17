---
"@monque/management": minor
"@monque/management-express": minor
---

Pin the coordinated oRPC contract, server, OpenAPI, Zod, and official Effect integration to 2.0.0-beta.45. Preserve the versioned public HTTP contract and synchronous/Promise facades. Direct oRPC consumers must use the matching beta and v2 imports and error-code status mapping. Allow compatible Effect 4 releases instead of requiring an exact patch version.

Expose protected official RPC and OpenAPI handlers from one shared router. Mount RPC at `/rpc` beneath the Express Management mount while retaining the public HTTP contract and transport-specific error envelopes.
