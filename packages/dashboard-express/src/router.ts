import { readFileSync } from "node:fs";
import path from "node:path";
import {
  getDashboardAssetDirectory,
  getDashboardAssetMetadata,
  getDashboardHtmlEntrypointPath,
  parseDashboardRuntimeConfig,
} from "@monque/dashboard";
import type { DashboardRuntimeConfig } from "@monque/dashboard";
import { Router, static as serveStatic } from "express";
import type { NextFunction, Request, Response } from "express";

import type { DashboardExpressRouterOptions } from "./types.js";

interface RuntimeConfigInjectionOptions {
  readonly runtimeConfig: DashboardRuntimeConfig;
  readonly runtimeConfigGlobal: string;
  readonly runtimeConfigScriptId: string;
}

const shouldServeDashboardHtml = function shouldServeDashboardHtml(req: Request): boolean {
  if (req.method !== "GET" && req.method !== "HEAD") {
    return false;
  }

  if (
    req.path === "/api" ||
    req.path.startsWith("/api/") ||
    req.path === "/assets" ||
    req.path.startsWith("/assets/")
  ) {
    return false;
  }

  if (
    req.path === "/index.html" ||
    req.path.startsWith("/queue-views/") ||
    req.path.startsWith("/jobs/")
  ) {
    return true;
  }

  return !req.path.includes(".");
};

const escapeRegularExpression = function escapeRegularExpression(value: string): string {
  return value.replaceAll(/[.*+?^${}()|[\]\\]/gu, "\\$&");
};

const injectRuntimeConfig = function injectRuntimeConfig(
  htmlTemplate: string,
  options: RuntimeConfigInjectionOptions,
): string {
  const assetBasePath = `${options.runtimeConfig.basePath.replace(/\/$/u, "")}/assets/`
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
  // Relative Vite assets otherwise resolve below a deep-link route (for example /jobs/:id).
  const mountAwareHtml = htmlTemplate.replaceAll(
    /\b(?<attribute>src|href)=(?<quote>['"])\.\/assets\//gu,
    (_match, attribute: string, quote: string) => `${attribute}=${quote}${assetBasePath}`,
  );
  const runtimeConfigJson = JSON.stringify(options.runtimeConfig).replaceAll("<", "\\u003c");
  const runtimeConfigScript = [
    `<script id="${options.runtimeConfigScriptId}">`,
    `window.${options.runtimeConfigGlobal} = ${runtimeConfigJson};`,
    "</script>",
  ].join("");

  return mountAwareHtml.replace(
    new RegExp(
      `<script\\s+id=["']${escapeRegularExpression(options.runtimeConfigScriptId)}["'][^>]*>[\\s\\S]*?<\\/script>`,
      "u",
    ),
    () => runtimeConfigScript,
  );
};

export const createDashboardExpressRouter = function createDashboardExpressRouter(
  options: DashboardExpressRouterOptions,
): Router {
  const router = Router();
  const assetDirectory = getDashboardAssetDirectory();
  const htmlTemplate = readFileSync(getDashboardHtmlEntrypointPath(), "utf-8");
  const { runtimeConfigGlobal, runtimeConfigScriptId } = getDashboardAssetMetadata();

  router.use(
    "/assets",
    serveStatic(path.join(assetDirectory, "assets"), {
      immutable: true,
      index: false,
      maxAge: "1y",
    }),
  );
  // oxlint-disable-next-line oxc/no-async-endpoint-handlers -- Express 5 supports Promise-returning handlers.
  router.use(async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (!shouldServeDashboardHtml(req)) {
      next();
      return;
    }

    try {
      const { apiBaseUrl } = options;
      const runtimeConfig = parseDashboardRuntimeConfig({
        // oxlint-disable-next-line anti-slop/no-runtime-typeof -- Dispatch the documented string-or-resolver adapter option.
        apiBaseUrl: await (typeof apiBaseUrl === "string" ? apiBaseUrl : apiBaseUrl({ req, res })),
        basePath: req.baseUrl || "/",
        pollingIntervalMs: options.pollingIntervalMs,
      });

      res.setHeader("Cache-Control", "no-store");
      res.type("html").send(
        injectRuntimeConfig(htmlTemplate, {
          runtimeConfig,
          runtimeConfigGlobal,
          runtimeConfigScriptId,
        }),
      );
    } catch (error) {
      /* oxlint-disable node/callback-return -- The terminal Express error callback ends the handler. */
      next(error);
      /* oxlint-enable node/callback-return */
    }
  });

  return router;
};
