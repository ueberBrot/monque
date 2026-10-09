import type { Request, Response } from "express";

const createHeaders = function createHeaders(req: Request, omitContentLength: boolean): Headers {
  const headers = new Headers();

  for (const [name, value] of Object.entries(req.headers)) {
    if (value === undefined) {
      continue;
    }

    if (omitContentLength && name.toLowerCase() === "content-length") {
      continue;
    }

    if (Array.isArray(value)) {
      for (const entry of value) {
        headers.append(name, entry);
      }
      continue;
    }

    headers.set(name, value);
  }

  return headers;
};

type FetchRequestBody = string | Buffer | URLSearchParams;
const isFetchRequestBody = function isFetchRequestBody(value: unknown): value is FetchRequestBody {
  return typeof value === "string" || Buffer.isBuffer(value) || value instanceof URLSearchParams;
};

export const createRequest = function createRequest(req: Request): globalThis.Request {
  const url = new URL(req.url, `${req.protocol}://${req.get("host") ?? "localhost"}`);
  const parsedBody: unknown = req.body;
  const init: RequestInit & { duplex?: "half" } = {
    method: req.method,
    headers: createHeaders(req, parsedBody !== undefined),
  };

  if (req.method !== "GET" && req.method !== "HEAD") {
    if (parsedBody === undefined) {
      init.body = req;
      // Node fetch requires this flag when a request body is a stream.
      init.duplex = "half";
    } else {
      init.body = isFetchRequestBody(parsedBody) ? parsedBody : JSON.stringify(parsedBody);
    }
  }

  return new globalThis.Request(url, init);
};

export const sendResponse = async function sendResponse(
  res: Response,
  response: globalThis.Response,
): Promise<void> {
  res.status(response.status);
  for (const [key, value] of response.headers) {
    res.setHeader(key, value);
  }

  res.send(Buffer.from(await response.arrayBuffer()));
};
