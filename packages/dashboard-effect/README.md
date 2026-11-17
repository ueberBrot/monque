# @monque/dashboard-effect

Serve the built Monque Dashboard through Effect HTTP routes. Mount the Management
API separately and start the listener in your host.

## Installation

```sh
bun add @monque/dashboard-effect effect@4.1.4
```

The package includes the built Dashboard. Requires Effect 4.1.4 and your host's
Node or Bun platform services. See [compatibility](../management/README.md#compatibility).

## Usage

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
Host middleware handles its errors.
HTML uses `no-store`; assets use one-year immutable caching. GET and HEAD are
supported. Missing assets return 404; paths and symlinks cannot escape the asset
root.

See the [Effect host example](../../examples/effect-host) for a complete application.
