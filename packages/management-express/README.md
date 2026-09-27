# @monque/management-express

Mount the Monque Management API in Express. Inspect jobs, perform job actions, and
control local processing through the scheduler already running in your application.
The router also serves an OpenAPI document.

To add the browser dashboard, use [@monque/dashboard-express](../dashboard-express).

## Installation

```bash
bun add @monque/management-express @monque/management @monque/core express mongodb
```

These four dependencies are peers. Requires core 1.15 or newer within version 1,
Management 0.6.x, and the Express and MongoDB versions listed in
[package.json](./package.json).

## Mount the API

Use your existing Express app and initialized `Monque` instance:

```typescript
import { createManagementExpressRouter } from '@monque/management-express';

app.use('/ops', createManagementExpressRouter({ monque, readOnly: true }));
```

This exposes reads under `/ops/api/v1`, such as `/ops/api/v1/jobs` and
`/ops/api/v1/queue-views`. `readOnly: true` rejects mutations, including pause and resume.
Omit it to enable supported actions.

## Authentication and authorization

The router does not authenticate requests. Mount your application's authentication
middleware before it, including when using read-only mode:

```typescript
app.use('/ops', requireOperator);
app.use('/ops', createManagementExpressRouter({ monque }));
```

`requireOperator` is middleware supplied by your application. The `/ops` mount also
protects the OpenAPI document and a Dashboard mounted under `/ops/dashboard`.

For per-action permissions, use `context` to pass authenticated request data into the
Management `authorize` callback. Derive identity and roles from your trusted session or
authentication middleware, not unchecked request headers. Job authorization receives
the relevant job or selector; processing controls receive the target instance ID and
optional job name. See [Management authorization](https://ueberBrot.github.io/monque/management/surface/).

## OpenAPI

The router serves `/openapi.json` relative to its mount path by default. With the example
above, open `/ops/openapi.json`. The document includes the mount URL in `servers`.

```typescript
app.use(
  '/internal/management',
  createManagementExpressRouter({
    monque,
    openApi: {
      path: '/docs/openapi.json',
      serverUrl: 'https://ops.example.com/internal/management',
    },
  }),
);
```

Set `openApi: false` to disable that route. You can load the document into an API viewer
such as Scalar, installed separately.

See [@monque/management](../management) for routes, response formats, processing-control
semantics, and authorization options.
