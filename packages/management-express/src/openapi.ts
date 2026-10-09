import { generateManagementOpenApiDocument } from "@monque/management";
import type { NextFunction, Request, Response, Router } from "express";

import type { ManagementExpressOpenApiOptions } from "./types.js";

const normalizeOpenApiPath = function normalizeOpenApiPath(path: string | undefined): string {
  if (path === undefined) {
    return "/openapi.json";
  }

  return path.startsWith("/") ? path : `/${path}`;
};

const normalizeServerUrl = function normalizeServerUrl(serverUrl: string): string {
  return serverUrl === "" ? "/" : serverUrl;
};

export const mountOpenApiRoute = function mountOpenApiRoute(
  router: Router,
  options: false | ManagementExpressOpenApiOptions | undefined,
): void {
  if (options === false) {
    return;
  }

  const openApiOptions: Required<ManagementExpressOpenApiOptions> = {
    path: normalizeOpenApiPath(options?.path),
    serverUrl: options?.serverUrl ?? (({ req }) => normalizeServerUrl(req.baseUrl)),
  };

  router.get(
    openApiOptions.path,
    // oxlint-disable-next-line oxc/no-async-endpoint-handlers -- Express 5 supports Promise-returning handlers.
    async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      try {
        // The management package caches the canonical document; clone before adding mount metadata.
        const document = structuredClone(await generateManagementOpenApiDocument());
        // oxlint-disable-next-line anti-slop/no-runtime-typeof -- Dispatch the documented string-or-resolver adapter option.
        const serverUrl = await (typeof openApiOptions.serverUrl === "string"
          ? openApiOptions.serverUrl
          : openApiOptions.serverUrl({ req, res }));
        document.servers = [{ url: normalizeServerUrl(serverUrl) }];
        res.json(document);
      } catch (error) {
        /* oxlint-disable node/callback-return -- The terminal Express error callback ends the handler. */
        next(error);
        /* oxlint-enable node/callback-return */
      }
    },
  );
};
