import type { UnderlyingSource } from "node:stream/web";
import { describe, expect, vi, it } from "vite-plus/test";

import { createManagementSurface } from "@/index";
import type { ManagementMonque } from "@/surface";
import { createManagementMonque } from "@tests/unit/management-test-utils";

const path = "/api/v1/jobs/507f1f77bcf86cd799439011/actions/cancel";

const streamedRequest = function streamedRequest(
  body: ReadableStream<Uint8Array>,
  headers: Record<string, string> = {},
): Request {
  const init: RequestInit & { duplex: "half" } = {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body,
    duplex: "half",
  };
  return new Request(`https://management.example${path}`, init);
};

describe("Management request body limits", () => {
  it("stops oversized chunked bodies before authorization or job access", async () => {
    let bytesRead = 0;
    const cancel = vi.fn<NonNullable<UnderlyingSource<Uint8Array>["cancel"]>>();
    const getJob = vi.fn<NonNullable<ManagementMonque["getJob"]>>().mockResolvedValue(null);
    const cancelJob = vi.fn<NonNullable<ManagementMonque["cancelJob"]>>().mockResolvedValue(null);
    const authorize = vi.fn<() => boolean>(() => false);
    const body = new ReadableStream<Uint8Array>(
      {
        pull(controller) {
          if (bytesRead === 128 * 1024) {
            controller.close();
            return;
          }
          bytesRead += 1024;
          controller.enqueue(new Uint8Array(1024).fill(32));
        },
        cancel,
      },
      { highWaterMark: 0 },
    );
    const surface = createManagementSurface({
      monque: createManagementMonque({ getJob, cancelJob }),
      authorize,
    });

    const result = await surface.openApiHandler.handle(streamedRequest(body), {
      context: { managementContext: {} },
    });

    expect({ matched: result.matched, status: result.response?.status }).toStrictEqual({
      matched: true,
      status: 413,
    });
    expect(bytesRead).toBe(65 * 1024);
    expect(cancel).toHaveBeenCalledOnce();
    expect(body.locked).toBe(false);
    expect({
      getJob: getJob.mock.calls,
      cancelJob: cancelJob.mock.calls,
      authorize: authorize.mock.calls,
    }).toStrictEqual({ getJob: [], cancelJob: [], authorize: [] });
  });

  it("cancels a stalled body when the request is aborted", async () => {
    const controller = new AbortController();
    const cancel = vi.fn<NonNullable<UnderlyingSource<Uint8Array>["cancel"]>>();
    const body = new ReadableStream<Uint8Array>(
      {
        pull: () => {
          controller.abort();
        },
        cancel,
      },
      { highWaterMark: 0 },
    );
    const surface = createManagementSurface({ monque: createManagementMonque() });
    const request = new Request(streamedRequest(body), { signal: controller.signal });

    const result = await surface.openApiHandler.handle(request, {
      context: { managementContext: {} },
    });

    expect(result.response?.status).toBe(400);
    expect(cancel).toHaveBeenCalledOnce();
    expect(body.locked).toBe(false);
  }, 1000);

  it.each(["70000", "1", "invalid"])(
    "enforces bytes independently of Content-Length %s",
    async (contentLength) => {
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new Uint8Array(70_000));
          controller.close();
        },
      });
      const getJob = vi.fn<NonNullable<ManagementMonque["getJob"]>>().mockResolvedValue(null);
      const surface = createManagementSurface({ monque: createManagementMonque({ getJob }) });

      const result = await surface.openApiHandler.handle(
        streamedRequest(body, { "content-length": contentLength }),
        { context: { managementContext: {} } },
      );

      expect(result.response?.status).toBe(413);
      expect(getJob).not.toHaveBeenCalled();
    },
  );

  it("rejects an oversized declared body without pulling it", async () => {
    const pull = vi.fn<NonNullable<UnderlyingSource<Uint8Array>["pull"]>>();
    const cancel = vi.fn<NonNullable<UnderlyingSource<Uint8Array>["cancel"]>>();
    const body = new ReadableStream<Uint8Array>({ pull, cancel }, { highWaterMark: 0 });
    const surface = createManagementSurface({ monque: createManagementMonque() });

    const result = await surface.openApiHandler.handle(
      streamedRequest(body, { "content-length": "65537" }),
      { context: { managementContext: {} } },
    );

    expect(result.response?.status).toBe(413);
    expect(pull).not.toHaveBeenCalled();
    expect(cancel).toHaveBeenCalledOnce();
    expect(body.locked).toBe(false);
  });

  it.each([undefined, "100000"])(
    "leaves unmatched request bodies available with declared length %s",
    async (contentLength) => {
      const pull = vi.fn<NonNullable<UnderlyingSource<Uint8Array>["pull"]>>(
        (controller: ReadableStreamDefaultController<Uint8Array>) => {
          controller.enqueue(new TextEncoder().encode("body for the next handler"));
          controller.close();
        },
      );
      const body = new ReadableStream<Uint8Array>({ pull }, { highWaterMark: 0 });
      const init: RequestInit & { duplex: "half" } = {
        method: "POST",
        body,
        duplex: "half",
      };
      if (contentLength !== undefined) {
        init.headers = { "content-length": contentLength };
      }
      const request = new Request("https://management.example/other", init);
      const surface = createManagementSurface({ monque: createManagementMonque() });

      const result = await surface.openApiHandler.handle(request, {
        context: { managementContext: {} },
      });

      expect(result.matched).toBe(false);
      expect(pull).not.toHaveBeenCalled();
      expect(body.locked).toBe(false);
      expect(request.bodyUsed).toBe(false);
      await expect(request.text()).resolves.toBe("body for the next handler");
    },
  );

  it("accepts an approved small mutation at the configured byte limit", async () => {
    const deleteJobs = vi
      .fn<NonNullable<ManagementMonque["deleteJobs"]>>()
      .mockResolvedValue({ count: 1, errors: [] });
    const authorize = vi.fn<() => boolean>(() => true);
    const surface = createManagementSurface({
      monque: createManagementMonque({ deleteJobs }),
      maxBodySize: 2,
      trustedOrigins: ["https://ops.example"],
      authorize,
    });

    const result = await surface.openApiHandler.handle(
      new Request("https://management.example/api/v1/jobs/actions/delete", {
        method: "POST",
        headers: { "content-type": "application/json", origin: "https://ops.example" },
        body: "{}",
      }),
      { context: { managementContext: {} } },
    );

    expect(result.response?.status).toBe(200);
    expect(deleteJobs).toHaveBeenCalledWith({});
    expect(authorize).toHaveBeenCalledOnce();
  });

  it("counts UTF-8 bytes rather than characters", async () => {
    const surface = createManagementSurface({ monque: createManagementMonque(), maxBodySize: 6 });
    const result = await surface.openApiHandler.handle(
      new Request(`https://management.example${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify("ééé"),
      }),
      { context: { managementContext: {} } },
    );

    expect(result.response?.status).toBe(413);
  });

  it("does not let oversized untrusted mutations bypass origin rejection", async () => {
    const pull = vi.fn<NonNullable<UnderlyingSource<Uint8Array>["pull"]>>();
    const body = new ReadableStream<Uint8Array>({ pull }, { highWaterMark: 0 });
    const surface = createManagementSurface({ monque: createManagementMonque() });
    const result = await surface.openApiHandler.handle(
      streamedRequest(body, { origin: "https://evil.example", "content-length": "100000" }),
      { context: { managementContext: {} } },
    );

    expect(result.response?.status).toBe(403);
    expect(pull).not.toHaveBeenCalled();
    expect(body.locked).toBe(false);
  });

  it("retains the size error when source cancellation fails", async () => {
    const body = new ReadableStream<Uint8Array>(
      {
        pull(controller) {
          controller.enqueue(new Uint8Array(65_537));
        },
        cancel() {
          throw new Error("source cancellation failed");
        },
      },
      { highWaterMark: 0 },
    );
    const surface = createManagementSurface({ monque: createManagementMonque() });
    const result = await surface.openApiHandler.handle(streamedRequest(body), {
      context: { managementContext: {} },
    });

    expect(result.response?.status).toBe(413);
    expect(body.locked).toBe(false);
  });

  it("handles source read failures without retaining its reader", async () => {
    const body = new ReadableStream<Uint8Array>(
      {
        pull(controller) {
          controller.error(new Error("upload failed"));
        },
      },
      { highWaterMark: 0 },
    );
    const surface = createManagementSurface({ monque: createManagementMonque() });
    const result = await surface.openApiHandler.handle(streamedRequest(body), {
      context: { managementContext: {} },
    });

    expect(result.response?.status).toBe(400);
    expect(body.locked).toBe(false);
  });

  it.each([-1, 1.5, Number.NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])(
    "rejects invalid byte limits %s at construction",
    (maxBodySize) => {
      expect(() =>
        createManagementSurface({ monque: createManagementMonque(), maxBodySize }),
      ).toThrow("maxBodySize must be a nonnegative safe integer");
    },
  );
});
