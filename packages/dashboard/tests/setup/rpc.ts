import { COMMON_ERROR_STATUS_MAP } from "@orpc/client";
import { z } from "zod";

/** Native RPC wire fixtures; no Management implementation is imported into UI tests. */
// oxlint-disable-next-line anti-slop/no-unknown-parameters -- Wire fixtures intentionally accept arbitrary valid or invalid response bodies.
export const rpcResponse = (body: unknown, init?: ResponseInit): Response => {
  const status = init?.status ?? 200;
  const error = z.object({ error: z.string() }).safeParse(body);

  const json =
    status >= 400 && error.success
      ? {
          defined: false,
          code:
            Object.entries(COMMON_ERROR_STATUS_MAP).find(([, value]) => value === status)?.[0] ??
            "INTERNAL_SERVER_ERROR",
          message: error.data.error,
          data: body,
        }
      : body;

  return Response.json({ json }, init);
};

export const rpcInput = async (request: Request) => {
  const text = await request.clone().text();

  if (text === "") {
    return null;
  }

  return z
    .object({
      json: z
        .object({
          params: z.object({ id: z.string() }).optional(),
          body: z.unknown().optional(),
          name: z.string().optional(),
          status: z.string().optional(),
          sortBy: z.string().optional(),
          sortDirection: z.string().optional(),
          limit: z.string().optional(),
          view: z.string().optional(),
        })
        .loose()
        .optional(),
    })
    .parse(JSON.parse(text)).json;
};
