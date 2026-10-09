import { createServer, IncomingMessage, ServerResponse } from "node:http";
import type { Server } from "node:http";
import { Socket } from "node:net";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { z } from "zod";

import { isString } from "../../../../packages/dashboard/src/lib/type-guards.js";
import { createManagementMiddleware } from "../../src/management-middleware.js";

const servers: Server[] = [];
const serve = async (
  handler: Parameters<typeof createManagementMiddleware>[0],
): Promise<string> => {
  const middleware = createManagementMiddleware(handler);
  const server = createServer((request, response) => {
    request.url = request.url?.replace(/^\/api/u, "") ?? "/";
    void middleware(request, response, (failure) => {
      const hasError = Boolean(failure);
      response.statusCode = hasError ? 500 : 404;
      response.end(failure instanceof Error ? failure.message : "Not found");
    });
  });
  servers.push(server);
  const listening: PromiseWithResolvers<void> = Promise.withResolvers();
  server.listen(0, "127.0.0.1", () => {
    listening.resolve();
  });
  await listening.promise;
  const address = server.address();
  if (address === null || isString(address)) {
    throw new Error("Expected TCP address");
  }
  return `http://127.0.0.1:${address.port}`;
};
describe("management middleware", () => {
  afterEach(async () => {
    await Promise.all(
      servers.splice(0).map(async (server) => {
        const closed: PromiseWithResolvers<void> = Promise.withResolvers();
        server.closeAllConnections();
        server.close((error) => {
          if (error) {
            closed.reject(error);
          } else {
            closed.resolve();
          }
        });
        await closed.promise;
      }),
    );
  });
  describe("Management Connect adapter", () => {
    it("preserves the mounted route, query, method, headers and JSON body", async () => {
      const origin = await serve(async (request) =>
        Response.json(
          {
            url: request.url,
            method: request.method,
            scenario: request.headers.get("x-monque-dev-scenario"),
            body: z.object({ text: z.string() }).parse(await request.json()),
          },
          { status: 201, headers: { "x-result": "created" } },
        ),
      );
      const response = await fetch(`${origin}/api/v1/jobs?name=email`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-monque-dev-scenario": "mixed" },
        body: JSON.stringify({ text: "café 日本語" }),
      });
      expect(response.status).toBe(201);
      expect(response.headers.get("x-result")).toBe("created");
      await expect(response.json()).resolves.toStrictEqual({
        url: "http://dashboard-dev.local/api/v1/jobs?name=email",
        method: "POST",
        scenario: "mixed",
        body: { text: "café 日本語" },
      });
    });

    it("preserves binary responses and separate cookie headers", async () => {
      const headers = new Headers();
      headers.append("set-cookie", "session=one; Path=/; HttpOnly");
      headers.append("set-cookie", "preference=two; Path=/");
      const origin = await serve(
        async () => await Promise.resolve(new Response(new Uint8Array([0, 128, 255]), { headers })),
      );
      const response = await fetch(`${origin}/api/v1/data`);
      expect([...new Uint8Array(await response.arrayBuffer())]).toStrictEqual([0, 128, 255]);
      expect(response.headers.getSetCookie()).toStrictEqual(headers.getSetCookie());
    });

    it("does not consume response bodies for HEAD requests", async () => {
      const response = new Response("hidden", { headers: { "x-result": "head" } });
      const readBody = vi.spyOn(response, "arrayBuffer");
      const origin = await serve(async (request) => {
        expect(request.method).toBe("HEAD");
        return await Promise.resolve(response);
      });
      const result = await fetch(`${origin}/api/v1/health`, { method: "HEAD" });
      expect(result.status).toBe(200);
      expect(result.headers.get("x-result")).toBe("head");
      await expect(result.text()).resolves.toBe("");
      expect(readBody).not.toHaveBeenCalled();
    });

    it("passes unmatched requests and handler errors to the next middleware", async () => {
      const origin = await serve(async (request) => {
        await Promise.resolve();
        if (request.url.endsWith("/failure")) {
          throw new Error("Handler failed");
        }
      });
      const awaitedResult1 = await fetch(`${origin}/api/missing`);
      expect(awaitedResult1.status).toBe(404);
      const failure = await fetch(`${origin}/api/failure`);
      expect(failure.status).toBe(500);
      await expect(failure.text()).resolves.toBe("Handler failed");
    });

    it("forwards request stream failures without invoking the handler", async () => {
      const request = new IncomingMessage(new Socket());
      request.method = "POST";
      request.url = "/v1/jobs";
      const response = new ServerResponse(request);
      const handler = vi.fn<Parameters<typeof createManagementMiddleware>[0]>(
        async () => await Promise.resolve(new Response("unexpected")),
      );
      const middleware = createManagementMiddleware(handler);
      const failure = new Error("Request stream failed");
      const { promise: forwarded, resolve: forward }: PromiseWithResolvers<unknown> =
        Promise.withResolvers();
      void middleware(request, response, forward);
      request.destroy(failure);
      await expect(forwarded).resolves.toBe(failure);
      expect(handler).not.toHaveBeenCalled();
    });
  });
});
