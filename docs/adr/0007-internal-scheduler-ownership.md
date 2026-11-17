# ADR-0007: Separate Instance And Processing Lifetimes

Separate the initialized Scheduler Instance lifetime from its processing
generations. The instance owns admitted work and shared operations; each
generation owns the resources used to find and schedule work. Stopping a
generation drains its captured executions while allowing a replacement to run,
so restarts cannot forget occupied capacity or abandon admitted side effects.
