import {
  getDashboardAssetDirectory,
  getDashboardHtmlEntrypointPath,
  parseDashboardRuntimeConfig,
  renderDashboardHtml,
  shouldServeDashboardHtml,
} from "@monque/dashboard";
import { Effect, FileSystem, Path } from "effect";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http";

import type { DashboardEffectOptions } from "./options.js";

/** Portable routes only. The host supplies platform services, authentication and listener. */
export const dashboardEffectLayer = <E = never, R = never>(
  options: DashboardEffectOptions<E, R>,
) => {
  const config = parseDashboardRuntimeConfig({ ...options, apiBaseUrl: "/" });
  const mount = config.basePath === "/" ? "" : config.basePath;

  const handler = Effect.gen(function* serveDashboard() {
    const request = yield* HttpServerRequest.HttpServerRequest;

    if (request.method !== "GET" && request.method !== "HEAD") {
      return HttpServerResponse.empty({ status: 404 });
    }

    const rawPath = request.url.split("?")[0] ?? "/";

    const decoded = yield* Effect.try(() => decodeURIComponent(rawPath)).pipe(
      Effect.orElseSucceed(() => "\0"),
    );

    if (
      /[\\\0]/u.test(decoded) ||
      decoded.split("/").some((part) => part === "." || part === "..")
    ) {
      return HttpServerResponse.empty({ status: 404 });
    }

    const pathname = decoded || "/";

    if (pathname.startsWith("/assets/")) {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;

      return yield* Effect.gen(function* serveAsset() {
        const root = yield* fs.realPath(path.join(getDashboardAssetDirectory(), "assets"));
        const target = yield* fs.realPath(path.join(root, pathname.slice(8)));
        const relative = path.relative(root, target);

        if (relative.startsWith("..") || path.isAbsolute(relative) || relative === "") {
          return HttpServerResponse.empty({ status: 404 });
        }

        return yield* HttpServerResponse.file(target, {
          headers: { "cache-control": "public, max-age=31536000, immutable" },
        });
      }).pipe(
        Effect.catchTag("PlatformError", () =>
          Effect.succeed(HttpServerResponse.empty({ status: 404 })),
        ),
      );
    }

    if (!shouldServeDashboardHtml(pathname)) {
      return HttpServerResponse.empty({ status: 404 });
    }

    const apiBaseUrl = Effect.isEffect(options.apiBaseUrl)
      ? yield* options.apiBaseUrl
      : options.apiBaseUrl;

    const runtimeConfig = parseDashboardRuntimeConfig({ ...config, apiBaseUrl });
    const fs = yield* FileSystem.FileSystem;
    const template = yield* fs.readFileString(getDashboardHtmlEntrypointPath());

    return HttpServerResponse.text(renderDashboardHtml(template, runtimeConfig), {
      contentType: "text/html",
      headers: { "cache-control": "no-store" },
    });
  });

  return HttpRouter.addAll([HttpRouter.route("*", "/*", handler)], { prefix: mount });
};
