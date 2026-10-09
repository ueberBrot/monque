import { IncomingMessage, ServerResponse } from "node:http";
import { Socket } from "node:net";
import type * as CoreModule from "@monque/core";
import type * as ManagementModule from "@monque/management";
import { fromPartial } from "@total-typescript/shoehorn";
import type * as MongodbModule from "mongodb";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { z } from "zod";

import type * as DemoWorkloadJsModule from "../../src/local-db/demo-workload.js";
import { createLocalDbManagementServer } from "../../src/local-db/management-server.js";
import type * as ScenariosJsModule from "../../src/local-db/scenarios.js";
import type { createManagementMiddleware } from "../../src/management-middleware.js";
import { forEachSequential } from "../setup/sequential.js";

const runtime = vi.hoisted(() => ({
  connect: vi.fn<() => Promise<void>>(),
  close: vi.fn<() => Promise<void>>(),
  initialize: vi.fn<() => Promise<void>>(),
  stop: vi.fn<() => Promise<void>>(),
  startDemo: vi.fn<() => () => void>(),
}));
vi.mock(import("mongodb"), async () => {
  const { createMongoClientDouble } = await import("../setup/mock-mongo-client.js");
  return fromPartial<typeof MongodbModule>({
    MongoClient: createMongoClientDouble(runtime.connect, runtime.close),
  });
});
vi.mock(import("@monque/core"), () =>
  fromPartial<typeof CoreModule>({
    Monque: class {
      initialize = runtime.initialize;
      stop = runtime.stop;
    },
  }),
);
vi.mock(import("@monque/management"), () =>
  fromPartial<typeof ManagementModule>({ createManagementSurface: () => ({}) }),
);
vi.mock(import("../../src/local-db/scenarios.js"), () =>
  fromPartial<typeof ScenariosJsModule>({
    createScenario: () => [],
    registerScenarioWorkers: vi.fn<() => void>(),
  }),
);
vi.mock(import("../../src/local-db/demo-workload.js"), () =>
  fromPartial<typeof DemoWorkloadJsModule>({ startDemoWorkload: runtime.startDemo }),
);
const captureFailure = async (operation: Promise<unknown>): Promise<Error> => {
  try {
    await operation;
  } catch (error) {
    return z.instanceof(Error).parse(error);
  }
  throw new Error("Expected the operation to fail");
};
describe("local db lifecycle", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });
  describe("local MongoDB development lifecycle", () => {
    it("keeps connection credentials out of startup messages and HTTP failures", async () => {
      const mongoUri = "mongodb://operator:private-password@localhost:27018";
      const cause = new Error(`Authentication failed for ${mongoUri}`);
      runtime.connect.mockRejectedValue(cause);
      const server = createLocalDbManagementServer({ mongoUri });
      const firstFailure = await captureFailure(server.start());
      expect({
        help: firstFailure.message.includes("Check MONQUE_DASHBOARD_DEV_MONGO_URI"),
        sameCause: Object.is(firstFailure.cause, cause),
      }).toStrictEqual({ help: true, sameCause: true });
      const secondFailure = await captureFailure(server.start());
      expect(secondFailure.message).not.toContain(mongoUri);
      const request = new IncomingMessage(new Socket());
      request.method = "GET";
      request.url = "/v1/health";
      const response = new ServerResponse(request);
      const ended = vi.spyOn(response, "end").mockReturnValue(response);
      const next = vi.fn<Parameters<ReturnType<typeof createManagementMiddleware>>[2]>();
      await server.middleware(request, response, next);
      const body = String(ended.mock.calls[0]?.[0]);
      const parsed = z.object({ error: z.string(), message: z.string() }).parse(JSON.parse(body));
      expect({
        calls: next.mock.calls.length,
        status: response.statusCode,
        error: parsed.error,
        help: parsed.message.includes("Check MONQUE_DASHBOARD_DEV_MONGO_URI"),
      }).toStrictEqual({
        calls: 0,
        status: 503,
        error: "dashboard_dev_db_unavailable",
        help: true,
      });
      expect({
        operator: body.includes("operator"),
        password: body.includes("private-password"),
        uri: body.includes(mongoUri),
      }).toStrictEqual({ operator: false, password: false, uri: false });
      await server.close();
    });

    it("waits for an immediately interrupted startup and releases its scheduler and connection", async () => {
      const connection: PromiseWithResolvers<void> = Promise.withResolvers();
      runtime.connect.mockReturnValue(connection.promise);
      const server = createLocalDbManagementServer();
      const starting = server.start();
      let closed = false;
      const closing = server.close().then(() => {
        closed = true;
      });
      await forEachSequential(
        Array.from({ length: 5 }, (_, index) => index),
        async () => {
          await Promise.resolve();
        },
      );
      expect(closed).toBe(false);
      connection.resolve();
      await Promise.all([starting, closing]);
      expect(runtime.connect).toHaveBeenCalledOnce();
      expect(runtime.stop).toHaveBeenCalledOnce();
      expect(runtime.close).toHaveBeenCalledOnce();
    });

    it("shares concurrent startups and shutdowns, then creates a fresh runtime on restart", async () => {
      const server = createLocalDbManagementServer();
      await Promise.all([server.start(), server.start()]);
      expect(runtime.connect).toHaveBeenCalledOnce();
      await Promise.all([server.close(), server.close()]);
      expect(runtime.stop).toHaveBeenCalledOnce();
      expect(runtime.close).toHaveBeenCalledOnce();
      await server.start();
      expect(runtime.connect).toHaveBeenCalledTimes(2);
      await server.close();
      expect({
        stop: runtime.stop.mock.calls.length,
        close: runtime.close.mock.calls.length,
      }).toStrictEqual({ stop: 2, close: 2 });
    });

    it("waits for shutdown before restarting and recovers from a failed connection", async () => {
      const server = createLocalDbManagementServer();
      runtime.connect.mockRejectedValueOnce(new Error("MongoDB unavailable"));
      await expect(server.start()).rejects.toThrow("Could not connect");
      expect(runtime.close).toHaveBeenCalledOnce();
      await server.start();
      const stopped: PromiseWithResolvers<void> = Promise.withResolvers();
      runtime.stop.mockReturnValueOnce(stopped.promise);
      const closing = server.close();
      const restarting = server.start();
      await Promise.resolve();
      expect(runtime.connect).toHaveBeenCalledTimes(2);
      stopped.resolve();
      await Promise.all([closing, restarting]);
      expect(runtime.connect).toHaveBeenCalledTimes(3);
      await server.close();
      expect(runtime.close).toHaveBeenCalledTimes(3);
    });
  });
});
