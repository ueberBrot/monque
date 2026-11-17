import { readFileSync } from "node:fs";
import path from "node:path";
import {
  getDashboardAssetDirectory,
  getDashboardHtmlEntrypointPath,
  parseDashboardRuntimeConfig,
  renderDashboardHtml,
  shouldServeDashboardHtml,
} from "@monque/dashboard";
import { Router, static as serveStatic } from "express";
import type { NextFunction, Request, Response } from "express";

import type { DashboardExpressRouterOptions } from "./types.js";

export const createDashboardExpressRouter = function createDashboardExpressRouter(
  options: DashboardExpressRouterOptions,
): Router {
  const router = Router();
  const assetDirectory = getDashboardAssetDirectory();
  const htmlTemplate = readFileSync(getDashboardHtmlEntrypointPath(), "utf-8");

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
    if ((req.method !== "GET" && req.method !== "HEAD") || !shouldServeDashboardHtml(req.path)) {
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
      res.type("html").send(renderDashboardHtml(htmlTemplate, runtimeConfig));
    } catch (error) {
      /* oxlint-disable node/callback-return -- The terminal Express error callback ends the handler. */
      next(error);
      /* oxlint-enable node/callback-return */
    }
  });

  return router;
};
