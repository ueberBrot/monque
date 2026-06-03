# @monque/dashboard

`@monque/dashboard` is Monque's asset-only operator dashboard package.

It ships a Vite-built React SPA, file-based TanStack Router routes, runtime config validation,
and asset metadata helpers for serving adapters. The package does not mount HTTP routes, expose
a React component library, depend on `@monque/core`, or talk directly to MongoDB.

## Scripts

```bash
bun run dev
bun run test
bun run type-check
bun run build
```

## Runtime config

The dashboard boot script expects a `window.__MONQUE_DASHBOARD_CONFIG__` object with:

- `basePath`
- `apiBaseUrl`
- optional `pollingIntervalMs`

The package validates and normalizes this config at app boot.

## Package exports

The package root exports:

- runtime config schema and types
- asset metadata helpers for serving adapters

No public React component API is exported.
