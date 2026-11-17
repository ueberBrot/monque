// @effect-diagnostics unstableApiUsage:off
import { Monque } from "@monque/core/effect";
import { Effect } from "effect";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http";
import { MongoClient } from "mongodb";
import { expect, describe, it } from "vite-plus/test";

import { createManagementEffectHandler, createManagementEffectRoutes } from "../src/index.js";

describe("portable handler", () => {
  it("mounts native processing and OpenAPI without owning the scheduler", async () => {
    const client = new MongoClient("mongodb://127.0.0.1:27017");
    const monque = new Monque(client.db("routes"), { schedulerInstanceId: "native-691" });

    try {
      const routes = HttpRouter.toWebHandler(
        createManagementEffectRoutes({ monque: monque.effects, prefix: "/ops/" }),
      );

      try {
        const response = await routes.handler(
          new Request("http://localhost/ops/api/v1/processing"),
        );

        expect(response.status).toBe(200);
        const document = await routes.handler(new Request("http://localhost/ops/openapi.json"));
        await expect(document.json()).resolves.toMatchObject({ servers: [{ url: "/ops" }] });
      } finally {
        await routes.dispose();
      }

      const handler = createManagementEffectHandler({ monque: monque.effects, prefix: "/ops" });

      const response = await Effect.runPromise(
        handler.pipe(
          Effect.provideService(
            HttpServerRequest.HttpServerRequest,
            HttpServerRequest.fromWeb(new Request("http://localhost/ops/api/v1/processing")),
          ),
          Effect.scoped,
        ),
      );

      await expect(HttpServerResponse.toWeb(response).json()).resolves.toStrictEqual({
        instanceId: "native-691",
        paused: false,
        globallyPaused: false,
      });
    } finally {
      await monque.dispose();
      await client.close();
    }
  });
});

describe("host request modifications", () => {
  it("uses the host URL and headers for dispatch and origin checks", async () => {
    const client = new MongoClient("mongodb://127.0.0.1:27017");
    const monque = new Monque(client.db("modified"), { schedulerInstanceId: "modified" });

    try {
      const request = HttpServerRequest.fromWeb(
        new Request("http://localhost/original", {
          method: "POST",
          body: JSON.stringify({ instanceId: "modified" }),
          headers: { "content-type": "application/json", origin: "http://localhost" },
        }),
      ).modify({ url: "/ops/api/v1/processing/actions/pause" });

      const response = await Effect.runPromise(
        createManagementEffectHandler({ monque: monque.effects, prefix: "/ops" }).pipe(
          Effect.provideService(HttpServerRequest.HttpServerRequest, request),
          Effect.scoped,
        ),
      );

      expect(response.status).toBe(200);
    } finally {
      await monque.dispose();
      await client.close();
    }
  });
});

describe("host failures", () => {
  it("retains a context failure in the host Effect error channel", async () => {
    const client = new MongoClient("mongodb://127.0.0.1:27017");
    const monque = new Monque(client.db("context-error"));
    const failure = new Error("host context failed");

    try {
      const result = await Effect.runPromise(
        createManagementEffectHandler({
          monque: monque.effects,
          context: () => Effect.fail(failure),
        }).pipe(
          Effect.provideService(
            HttpServerRequest.HttpServerRequest,
            HttpServerRequest.fromWeb(new Request("http://localhost/api/v1/processing")),
          ),
          Effect.scoped,
          Effect.flip,
        ),
      );

      expect(result).toBe(failure);
    } finally {
      await monque.dispose();
      await client.close();
    }
  });
});
