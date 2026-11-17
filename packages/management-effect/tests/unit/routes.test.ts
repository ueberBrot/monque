// @effect-diagnostics unstableApiUsage:off
import { describe, expect, it } from "@effect/vitest";
import { Monque } from "@monque/core/effect";
import { Effect } from "effect";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http";
import { MongoClient } from "mongodb";

import { createManagementEffectHandler, createManagementEffectRoutes } from "../../src/index.js";

const scheduler = (name: string) =>
  Effect.acquireRelease(
    Effect.sync(() => {
      const client = new MongoClient("mongodb://127.0.0.1:27017");
      const monque = new Monque(client.db(name), { schedulerInstanceId: name });

      return { client, monque };
    }),
    ({ client, monque }) =>
      monque.effects.dispose.pipe(
        Effect.orDie,
        Effect.andThen(
          Effect.promise(async () => {
            await client.close();
          }),
        ),
      ),
  );

describe("portable handler", () => {
  it.effect("mounts native processing and OpenAPI without owning the scheduler", () =>
    Effect.gen(function* mountRoutes() {
      const { monque } = yield* scheduler("native-691");

      const routes = yield* Effect.acquireRelease(
        Effect.sync(() =>
          HttpRouter.toWebHandler(
            createManagementEffectRoutes({ monque: monque.effects, prefix: "/ops/" }),
          ),
        ),
        (app) =>
          Effect.promise(async () => {
            await app.dispose();
          }),
      );

      const response = yield* Effect.promise(
        async () => await routes.handler(new Request("http://localhost/ops/api/v1/processing")),
      );

      expect(response.status).toBe(200);

      const document = yield* Effect.promise(async () => {
        const documentResponse = await routes.handler(
          new Request("http://localhost/ops/openapi.json"),
        );

        return await documentResponse.json();
      });

      expect(document).toMatchObject({ servers: [{ url: "/ops" }] });

      const result = yield* createManagementEffectHandler({
        monque: monque.effects,
        prefix: "/ops",
      }).pipe(
        Effect.provideService(
          HttpServerRequest.HttpServerRequest,
          HttpServerRequest.fromWeb(new Request("http://localhost/ops/api/v1/processing")),
        ),
      );

      const body: unknown = yield* Effect.promise(
        async () => await HttpServerResponse.toWeb(result).json(),
      );

      expect(body).toStrictEqual({
        instanceId: "native-691",
        paused: false,
        globallyPaused: false,
      });
    }),
  );
});

describe("host request modifications", () => {
  it.effect("uses the host URL and headers for dispatch and origin checks", () =>
    Effect.gen(function* requestModifications() {
      const { monque } = yield* scheduler("modified");

      const request = HttpServerRequest.fromWeb(
        new Request("http://localhost/original", {
          method: "POST",
          body: JSON.stringify({ instanceId: "modified" }),
          headers: { "content-type": "application/json", origin: "http://localhost" },
        }),
      ).modify({ url: "/ops/api/v1/processing/actions/pause" });

      const response = yield* createManagementEffectHandler({
        monque: monque.effects,
        prefix: "/ops",
      }).pipe(Effect.provideService(HttpServerRequest.HttpServerRequest, request));

      expect(response.status).toBe(200);
    }),
  );
});

describe("host failures", () => {
  it.effect("retains a context failure in the host Effect error channel", () =>
    Effect.gen(function* contextFailure() {
      const { monque } = yield* scheduler("context-error");
      const failure = new Error("host context failed");

      const result = yield* createManagementEffectHandler({
        monque: monque.effects,
        context: () => Effect.fail(failure),
      }).pipe(
        Effect.provideService(
          HttpServerRequest.HttpServerRequest,
          HttpServerRequest.fromWeb(new Request("http://localhost/api/v1/processing")),
        ),
        Effect.flip,
      );

      expect(result).toBe(failure);
    }),
  );
});
