# @monque/dashboard-effect

Serve the `@monque/dashboard` build through Effect 4.1.4 HTTP routes, as
`@monque/dashboard-express` does. Mount Management and start the listener in your host.

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

Supply application `Authentication` and `HostPlatformServices` layers.
Use `HttpRouter.middleware` to protect HTML, assets and deep links, with the same
identity policy as Management. Supply `FileSystem`, `Path` and `HttpPlatform`
through `HttpRouter.provideRequest`. Use Node or Bun services;
`HttpServer.layerServices` has a noop filesystem and cannot serve files.

`apiBaseUrl` accepts an `Effect<string, E, R>` evaluated per HTML request.
Host middleware handles its errors. Validation and script escaping match Express.
HTML uses `no-store`; assets use one-year immutable caching. GET and HEAD are
supported. Missing assets return 404; paths and symlinks cannot escape the asset
root. Express mounting and Promise-valued resolvers remain supported.

Effect HTTP is unstable, so Effect is pinned. Runtime dependencies are Dashboard
assets and peer Effect. See [coordinated release compatibility](../management/README.md#coordinated-release-compatibility).

Run `vp run @monque/dashboard-effect#test` with Docker Desktop and Chromium.
