import type { OpenAPI } from "@orpc/openapi";
import { afterEach, describe, expect, test, vi } from "vite-plus/test";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("management OpenAPI generation", () => {
  test("shares concurrent generation and reuses the successful document", async () => {
    vi.resetModules();
    const { OpenAPIGenerator } = await import("@orpc/openapi");
    const generated: OpenAPI.Document = {
      openapi: "3.1.1",
      info: { title: "Monque Management API", version: "0.0.0" },
      paths: {},
    };
    const gate = Promise.withResolvers<OpenAPI.Document>();
    const generate = vi.spyOn(OpenAPIGenerator.prototype, "generate").mockReturnValue(gate.promise);
    const { generateManagementOpenApiDocument } = await import("@/index");

    const first = generateManagementOpenApiDocument();
    const second = generateManagementOpenApiDocument();
    try {
      expect(generate).toHaveBeenCalledTimes(1);
    } finally {
      gate.resolve(generated);
      await Promise.all([first, second]);
    }

    expect(await first).toBe(generated);
    expect(await second).toBe(generated);
    expect(await generateManagementOpenApiDocument()).toBe(generated);
    expect(generate).toHaveBeenCalledTimes(1);
  });

  test("shares a failed generation without changing the error and retries the next call", async () => {
    vi.resetModules();
    const { OpenAPIGenerator } = await import("@orpc/openapi");
    const generated: OpenAPI.Document = {
      openapi: "3.1.1",
      info: { title: "Monque Management API", version: "0.0.0" },
      paths: {},
    };
    const failure = new Error("OpenAPI generation failed");
    const gate = Promise.withResolvers<OpenAPI.Document>();
    const generate = vi
      .spyOn(OpenAPIGenerator.prototype, "generate")
      .mockReturnValueOnce(gate.promise)
      .mockResolvedValue(generated);
    const { generateManagementOpenApiDocument } = await import("@/index");

    const first = generateManagementOpenApiDocument();
    const second = generateManagementOpenApiDocument();
    const failures = Promise.all([
      expect(first).rejects.toBe(failure),
      expect(second).rejects.toBe(failure),
    ]);
    try {
      expect(generate).toHaveBeenCalledTimes(1);
    } finally {
      gate.reject(failure);
      await failures;
    }

    expect(await generateManagementOpenApiDocument()).toBe(generated);
    expect(await generateManagementOpenApiDocument()).toBe(generated);
    expect(generate).toHaveBeenCalledTimes(2);
  });

  test.each([undefined, null, "External failure", { reason: "External failure" }])(
    "preserves arbitrary generation failures %j and retries",
    async (failure) => {
      vi.resetModules();
      const { OpenAPIGenerator } = await import("@orpc/openapi");
      const generated: OpenAPI.Document = {
        openapi: "3.1.1",
        info: { title: "Monque Management API", version: "0.0.0" },
        paths: {},
      };
      const generate = vi
        .spyOn(OpenAPIGenerator.prototype, "generate")
        .mockRejectedValueOnce(failure)
        .mockResolvedValue(generated);
      const { generateManagementOpenApiDocument } = await import("@/index");

      const first = generateManagementOpenApiDocument();
      const second = generateManagementOpenApiDocument();
      await Promise.all([
        expect(first).rejects.toBe(failure),
        expect(second).rejects.toBe(failure),
      ]);
      expect(generate).toHaveBeenCalledTimes(1);
      expect(await generateManagementOpenApiDocument()).toBe(generated);
      expect(await generateManagementOpenApiDocument()).toBe(generated);
      expect(generate).toHaveBeenCalledTimes(2);
    },
  );
});
