import { generateManagementOpenApiDocument } from "@monque/management";
import type { NextFunction, Request, Response, Router } from "express";

import type { ManagementExpressOpenApiOptions } from "./types.js";

export function mountOpenApiRoute(
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
    async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      try {
        // The management package caches the canonical document; clone before adding mount metadata.
        const document = structuredClone(await generateManagementOpenApiDocument());
        const serverUrl = await (typeof openApiOptions.serverUrl === "string"
          ? openApiOptions.serverUrl
          : openApiOptions.serverUrl({ req, res }));
        document.servers = [{ url: normalizeServerUrl(serverUrl) }];
        res.json(document);
      } catch (error) {
        next(error);
      }
    },
  );
}

function normalizeOpenApiPath(path: string | undefined): string {
  if (path === undefined) {
    return "/openapi.json";
  }

  return path.startsWith("/") ? path : `/${path}`;
}

function normalizeServerUrl(serverUrl: string): string {
  return serverUrl === "" ? "/" : serverUrl;
}
