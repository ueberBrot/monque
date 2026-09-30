import { describe, expect, test, vi } from "vite-plus/test";

import { createManagementSurface } from "@/index";
import { createManagementMonque } from "@tests/unit/management-test-utils";

const path = "/api/v1/jobs/507f1f77bcf86cd799439011/actions/cancel";

function streamedRequest(
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
}

describe("Management request body limits", () => {
  test("stops oversized chunked bodies before authorization or job access", async () => {
    let bytesRead = 0;
    const cancel = vi.fn();
    const getJob = vi.fn(async () => null);
    const cancelJob = vi.fn(async () => null);
    const authorize = vi.fn(() => false);
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

    expect(result.matched).toBe(true);
    expect(result.response?.status).toBe(413);
    expect(bytesRead).toBe(65 * 1024);
    expect(cancel).toHaveBeenCalledOnce();
    expect(body.locked).toBe(false);
    expect(getJob).not.toHaveBeenCalled();
    expect(cancelJob).not.toHaveBeenCalled();
    expect(authorize).not.toHaveBeenCalled();
  });

  test("cancels a stalled body when the request is aborted", async () => {
    const controller = new AbortController();
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>(
      { pull: () => controller.abort(), cancel },
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

  test.each(["70000", "1", "invalid"])(
    "enforces bytes independently of Content-Length %s",
    async (contentLength) => {
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new Uint8Array(70000));
          controller.close();
        },
      });
      const getJob = vi.fn(async () => null);
      const surface = createManagementSurface({ monque: createManagementMonque({ getJob }) });

      const result = await surface.openApiHandler.handle(
        streamedRequest(body, { "content-length": contentLength }),
        { context: { managementContext: {} } },
      );

      expect(result.response?.status).toBe(413);
      expect(getJob).not.toHaveBeenCalled();
    },
  );

  test("rejects an oversized declared body without pulling it", async () => {
    const pull = vi.fn();
    const cancel = vi.fn();
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

  test.each([undefined, "100000"])(
    "leaves unmatched request bodies available with declared length %s",
    async (contentLength) => {
      const pull = vi.fn((controller: ReadableStreamDefaultController<Uint8Array>) => {
        controller.enqueue(new TextEncoder().encode("body for the next handler"));
        controller.close();
      });
      const body = new ReadableStream<Uint8Array>({ pull }, { highWaterMark: 0 });
      const init: RequestInit & { duplex: "half" } = {
        method: "POST",
        body,
        duplex: "half",
      };
      if (contentLength) {
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
      expect(await request.text()).toBe("body for the next handler");
    },
  );

  test("accepts an approved small mutation at the configured byte limit", async () => {
    const deleteJobs = vi.fn(async () => ({ count: 1, errors: [] }));
    const authorize = vi.fn(() => true);
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

  test("counts UTF-8 bytes rather than characters", async () => {
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

  test("does not let oversized untrusted mutations bypass origin rejection", async () => {
    const pull = vi.fn();
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

  test("retains the size error when source cancellation fails", async () => {
    const body = new ReadableStream<Uint8Array>(
      {
        pull(controller) {
          controller.enqueue(new Uint8Array(65537));
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

  test("handles source read failures without retaining its reader", async () => {
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

  test.each([-1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])(
    "rejects invalid byte limits %s at construction",
    (maxBodySize) => {
      expect(() =>
        createManagementSurface({ monque: createManagementMonque(), maxBodySize }),
      ).toThrow("maxBodySize must be a nonnegative safe integer");
    },
  );
});
