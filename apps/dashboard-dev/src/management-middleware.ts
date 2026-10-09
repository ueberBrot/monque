import type { Connect } from "vite";

import { isString } from "../../../packages/dashboard/src/lib/type-guards.js";

const MANAGEMENT_MOUNT_PATH = "/api";
type ManagementRequestHandler = (request: Request) => Promise<Response | undefined>;
type ManagementMiddleware = (...args: Parameters<Connect.NextHandleFunction>) => Promise<void>;
const createFetchRequest = async (request: Connect.IncomingMessage): Promise<Request> => {
  const headers = new Headers();
  for (const [name, value] of Object.entries(request.headers)) {
    if (value === undefined) {
      continue;
    }
    for (const entry of Array.isArray(value) ? value : [value]) {
      headers.append(name, entry);
    }
  }
  const requestInit: RequestInit = { method: request.method ?? "GET", headers };
  if (requestInit.method !== "GET" && requestInit.method !== "HEAD") {
    const chunks: Uint8Array[] = [];
    for await (const requestChunk of request) {
      const chunk: unknown = requestChunk;
      if (isString(chunk)) {
        chunks.push(Buffer.from(chunk));
      } else if (chunk instanceof Uint8Array) {
        chunks.push(chunk);
      } else {
        throw new TypeError("Expected a byte chunk in the request body");
      }
    }
    if (chunks.length) {
      requestInit.body = new Blob([new Uint8Array(Buffer.concat(chunks))]);
    }
  }
  const path = request.url?.startsWith("/") === true ? request.url : `/${request.url ?? ""}`;
  return await Promise.resolve(
    new Request(`http://dashboard-dev.local${MANAGEMENT_MOUNT_PATH}${path}`, requestInit),
  );
};
/** Adapts a mounted Management handler to Vite's Connect middleware. */
const createManagementMiddleware =
  (handle: ManagementRequestHandler): ManagementMiddleware =>
  async (request, response, next) => {
    if (request.url === undefined || request.url === null || request.url === "") {
      next();
      return;
    }
    try {
      const result = await handle(await createFetchRequest(request));
      if (!result) {
        next();
        return;
      }
      const body = request.method === "HEAD" ? undefined : Buffer.from(await result.arrayBuffer());
      response.statusCode = result.status;
      for (const [name, value] of result.headers) {
        if (name !== "set-cookie") {
          response.setHeader(name, value);
        }
      }
      const cookies = result.headers.getSetCookie();
      if (cookies.length) {
        response.setHeader("set-cookie", cookies);
      }
      response.end(body);
    } catch (error) {
      // oxlint-disable-next-line node/callback-return -- This catch is the final path in the async handler.
      next(error);
    }
  };
export { createManagementMiddleware, MANAGEMENT_MOUNT_PATH };
