import { once } from "node:events";
import { NodeFileSystem } from "@effect/platform-node";
import { Monque } from "@monque/core";
import { dashboardEffectLayer } from "@monque/dashboard-effect";
import { createManagementExpressRouter } from "@monque/management-express";
import { MongoDBContainer } from "@testcontainers/mongodb";
import { Effect, Layer, Path, Predicate } from "effect";
import { Etag, HttpPlatform, HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http";
import express from "express";
import { MongoClient } from "mongodb";

export const startDashboardHost = async () => {
  const container = await new MongoDBContainer("mongo:8").start();
  const client = new MongoClient(`${container.getConnectionString()}?directConnection=true`);
  await client.connect();
  const monque = new Monque(client.db("dashboard_692"));
  await monque.initialize();
  const job = await monque.enqueue("receipt", { message: "Dashboard Effect" });

  const authentication = HttpRouter.middleware((next) =>
    Effect.gen(function* authenticate() {
      const request = yield* HttpServerRequest.HttpServerRequest;

      if (request.headers["cookie"]?.includes("monque-role=") !== true) {
        return HttpServerResponse.empty({ status: 401 });
      }

      return yield* next;
    }),
  );

  const portable = HttpRouter.toWebHandler(
    dashboardEffectLayer({
      basePath: "/custom/ui",
      apiBaseUrl: "/custom/control",
      pollingIntervalMs: 1000,
    }).pipe(
      Layer.provide(authentication.layer),
      HttpRouter.provideRequest(
        Layer.mergeAll(
          NodeFileSystem.layer,
          Path.layer,
          HttpPlatform.layer.pipe(Layer.provide([NodeFileSystem.layer, Etag.layerWeak])),
        ),
      ),
    ),
  );

  const app = express();
  app.disable("x-powered-by");
  app.get("/login/:role", (req, res) => {
    res.cookie("monque-role", req.params["role"]);
    res.redirect(`/custom/ui/jobs/${job._id.toString()}`);
  });
  app.use(
    "/custom/control",
    (req, res, next) => {
      if (req.headers.cookie?.includes("monque-role=") !== true) {
        res.sendStatus(401);

        return;
      }

      next();
    },
    createManagementExpressRouter({
      monque,
      context: ({ req }) => ({ operator: req.headers.cookie?.includes("monque-role=operator") }),
      authorize: ({ action, context }) => action === "read" || context.operator === true,
    }),
  );
  // oxlint-disable-next-line oxc/no-async-endpoint-handlers -- Express 5 forwards async failures.
  app.use(async (req, res) => {
    const headers = new Headers();

    if (req.headers.cookie !== undefined) {
      headers.set("cookie", req.headers.cookie);
    }

    const response = await portable.handler(
      new Request(`http://${req.headers.host}${req.originalUrl}`, { method: req.method, headers }),
    );

    res.status(response.status);

    for (const [key, value] of response.headers) {
      res.setHeader(key, value);
    }

    res.end(Buffer.from(await response.arrayBuffer()));
  });
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();

  if (address === null || Predicate.isString(address)) {
    throw new Error("Missing address");
  }

  return {
    url: `http://127.0.0.1:${address.port}`,
    jobId: job._id.toString(),
    close: async () => {
      await server[Symbol.asyncDispose]();
      await portable.dispose();
      await monque.dispose();
      await client.close();
      await container.stop();
    },
  };
};
