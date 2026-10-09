import type { OpenAPI } from "@orpc/openapi";
import { afterEach, describe, expect, vi, it } from "vite-plus/test";

describe("management OpenAPI generation", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("shares concurrent generation and reuses the successful document", async () => {
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
      expect(generate).toHaveBeenCalledOnce();
    } finally {
      gate.resolve(generated);
      await Promise.all([first, second]);
    }

    await expect(first).resolves.toBe(generated);
    await expect(second).resolves.toBe(generated);
    await expect(generateManagementOpenApiDocument()).resolves.toBe(generated);
    expect(generate).toHaveBeenCalledOnce();
  });

  it("shares a failed generation without changing the error and retries the next call", async () => {
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
    const failures = Promise.allSettled([first, second]);
    try {
      expect(generate).toHaveBeenCalledOnce();
    } finally {
      gate.reject(failure);
      const results = await failures;
      expect(
        results.map((result) => result.status === "rejected" && result.reason === failure),
      ).toStrictEqual([true, true]);
    }

    const cached = await Promise.all([
      generateManagementOpenApiDocument(),
      generateManagementOpenApiDocument(),
    ]);
    expect(cached.map((document) => document === generated)).toStrictEqual([true, true]);
    expect(generate).toHaveBeenCalledTimes(2);
  });

  it.each([undefined, null, "External failure", { reason: "External failure" }])(
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
      expect(generate).toHaveBeenCalledOnce();
      const cached = await Promise.all([
        generateManagementOpenApiDocument(),
        generateManagementOpenApiDocument(),
      ]);
      expect(cached.map((document) => document === generated)).toStrictEqual([true, true]);
      expect(generate).toHaveBeenCalledTimes(2);
    },
  );
});
