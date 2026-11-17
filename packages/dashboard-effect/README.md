# @monque/dashboard-effect

Portable Effect 4.1.4 HTTP routes serving the same `@monque/dashboard` build as
`@monque/dashboard-express`. This package mounts neither Management nor a listener.

```ts
import { dashboardEffectLayer } from "@monque/dashboard-effect";
import { Layer } from "effect";
import { HttpRouter } from "effect/http";

const Dashboard = dashboardEffectLayer({
  basePath: "/ops/ui",
  apiBaseUrl: "/control", // independent Management mount; browser appends /rpc
  pollingIntervalMs: 5000,
}).pipe(Layer.provide(Authentication.layer), HttpRouter.provideRequest(HostPlatformServices));
```

`Authentication` and `HostPlatformServices` above are application-owned layers.
Use `HttpRouter.middleware` to authenticate all Dashboard routes, including HTML,
assets and deep links. Apply the same identity/session policy to Management.
Supply `FileSystem`, `Path` and `HttpPlatform` at the request seam (for example
using `HttpRouter.provideRequest`); choose Node or Bun platform services in the
host. Compose routes with the host router and run its chosen HTTP server/runtime.
Do not supply `HttpServer.layerServices` as a real filesystem: it includes a noop
filesystem suitable only for hosts that do not serve files.

`apiBaseUrl` also accepts an `Effect<string, E, R>` evaluated on each HTML request,
with the host's request services and identity. Errors remain in the route error
channel; host middleware owns their response policy. Configuration uses the same
validation and script escaping as Express. HTML is uncached (`no-store`); built
assets use one-year immutable caching. GET and HEAD are supported, missing assets
return 404, and asset paths cannot traverse or follow symlinks outside the asset
root. The Dashboard is still an asset-only package, and existing Express mounting
and Promise-valued resolver options remain supported.

Runtime dependencies are only the Dashboard asset package and peer Effect.
Express, MongoDB, Node platform and Playwright in this package are test-only.
Effect HTTP is an unstable Effect API: the Effect peer is deliberately pinned.

Run `vp run @monque/dashboard-effect#test` for public request and real MongoDB /
Chromium integration coverage against Express Management. Docker Desktop and the
workspace browser installation are required. The test fixture's cookie login is
only for disposable local tests, not a production authentication implementation.
