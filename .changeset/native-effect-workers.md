---
"@monque/core": minor
---

Support native Effect Workers with captured application services, per-attempt resource scopes, and the existing retry and Claim fencing rules. Terminal disposal interrupts native Workers that outlive the drain timeout and waits for their finalizers.
