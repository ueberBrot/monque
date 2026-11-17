/* oxlint-disable unicorn/no-await-expression-member, eslint/no-await-in-loop -- Sequential HTTP responses assert state transitions at the public seam. */
/* oxlint-disable anti-slop/no-unknown-parameters, anti-slop/no-unknown-returns, anti-slop/no-conditional-empty-object-spread -- Requests intentionally carry different contract DTOs; assertions verify decoded protocol output. */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { MongoDBContainer } from "@testcontainers/mongodb";
import type { StartedMongoDBContainer } from "@testcontainers/mongodb";
import { Effect } from "effect";

import { Identity, startHost } from "./host";

let container: StartedMongoDBContainer;

beforeAll(async () => {
  container = await new MongoDBContainer("mongo:8").start();
}, 120_000);

afterAll(async () => {
  await container?.stop();
});

describe.each(["rpc", "http"] as const)("complete %s Management Surface", (transport) => {
  test("reads, authorizes and serializes jobs; single/selected/bulk actions and processing controls", async () => {
    const host = await startHost({
      uri: `${container.getConnectionString()}/?directConnection=true`,
      management: {
        authorize: ({ context }) =>
          Effect.gen(function* authorize() {
            return context === (yield* Identity);
          }),
        serializePayload: () => Effect.die("per-name must take precedence"),
        serializePayloadByJobName: {
          mail: ({ context }) =>
            Effect.gen(function* redact() {
              const identity = yield* Identity;
              yield* Effect.yieldNow;

              return { viewer: context, service: identity, resumed: yield* Identity };
            }),
        },
      },
    });

    const client = host.client("alice");

    const call = async (
      rpc: () => Promise<unknown>,
      path: string,
      method = "GET",
      body?: unknown,
    ) => {
      if (transport === "rpc") {
        return await rpc();
      }

      const response = await fetch(`${host.url}/api/v1${path}`, {
        method,
        headers: { "x-identity": "alice", "content-type": "application/json" },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });

      expect(response.status).toBe(200);

      return await response.json();
    };

    const seed = async () =>
      (
        await Effect.runPromise(host.monque.effects.now("mail", { secret: "hidden" }))
      )._id.toHexString();

    try {
      // A Promise scheduler path cannot satisfy any request in this matrix.
      host.monque.getJob = () => {
        throw new Error("Promise facade used");
      };

      const id = await seed();
      const params = { id };

      const concurrent = await Promise.all(
        ["alice", "bob"].map(async (identity) => {
          if (transport === "rpc") {
            return await host.client(identity).job({ params: { id } });
          }

          return await (
            await fetch(`${host.url}/api/v1/jobs/${id}`, { headers: { "x-identity": identity } })
          ).json();
        }),
      );

      expect(concurrent).toMatchObject([
        { payload: { viewer: "alice", service: "alice", resumed: "alice" } },
        { payload: { viewer: "bob", service: "bob", resumed: "bob" } },
      ]);

      expect(await call(async () => await client.health(), "/health")).toMatchObject({
        status: "unavailable",
        scheduler: { healthy: false },
      });
      expect(await call(async () => await client.capabilities(), "/capabilities")).toMatchObject({
        actions: { read: true, cancel: true, pause: true },
      });
      expect(await call(async () => await client.queueViews(), "/queue-views")).toMatchObject({
        queueViews: [{ name: "mail" }],
      });
      expect(await call(async () => await client.jobs({}), "/jobs")).toMatchObject({
        jobs: [{ id, payload: { viewer: "alice" } }],
      });
      expect(await call(async () => await client.jobStats({}), "/jobs/stats")).toMatchObject({
        pending: 1,
      });
      expect(await call(async () => await client.job({ params }), `/jobs/${id}`)).toMatchObject({
        id,
        payload: { viewer: "alice" },
      });
      expect(
        await call(
          async () => await client.setJobPriority({ params, body: { priority: 7 } }),
          `/jobs/${id}/actions/priority`,
          "POST",
          { priority: 7 },
        ),
      ).toMatchObject({ priority: 7 });
      const nextRunAt = "2030-01-01T00:00:00.000Z";
      expect(
        await call(
          async () => await client.rescheduleJob({ params, body: { nextRunAt } }),
          `/jobs/${id}/actions/reschedule`,
          "POST",
          { nextRunAt },
        ),
      ).toMatchObject({ nextRunAt });
      expect(
        await call(
          async () => await client.cancelJob({ params }),
          `/jobs/${id}/actions/cancel`,
          "POST",
        ),
      ).toMatchObject({ status: "cancelled" });
      expect(
        await call(
          async () => await client.retryJob({ params }),
          `/jobs/${id}/actions/retry`,
          "POST",
        ),
      ).toMatchObject({ status: "pending" });
      expect(
        await call(
          async () => await client.selectedJobActions({ action: "cancel", ids: [id] }),
          "/jobs/actions/selected",
          "POST",
          { action: "cancel", ids: [id] },
        ),
      ).toMatchObject({ count: 1, errors: [] });
      expect(
        await call(
          async () => await client.retryJobs({ name: "mail" }),
          "/jobs/actions/retry",
          "POST",
          {
            name: "mail",
          },
        ),
      ).toMatchObject({ count: 1 });
      expect(
        await call(
          async () => await client.cancelJobs({ name: "mail" }),
          "/jobs/actions/cancel",
          "POST",
          { name: "mail" },
        ),
      ).toMatchObject({ count: 1 });
      expect(
        await call(async () => await client.deleteJob({ params }), `/jobs/${id}`, "DELETE"),
      ).toEqual({ deleted: true });
      await seed();
      expect(
        await call(
          async () => await client.deleteJobs({ name: "mail" }),
          "/jobs/actions/delete",
          "POST",
          { name: "mail" },
        ),
      ).toMatchObject({ count: 1 });
      const input = { instanceId: "proof-686" };
      expect(
        await call(
          async () => await client.pauseProcessing(input),
          "/processing/actions/pause",
          "POST",
          input,
        ),
      ).toMatchObject({ paused: true });
      expect(await call(async () => await client.processingState(), "/processing")).toMatchObject({
        paused: true,
      });
      expect(
        await call(
          async () => await client.resumeProcessing(input),
          "/processing/actions/resume",
          "POST",
          input,
        ),
      ).toMatchObject({ paused: false });
    } finally {
      await host.close();
    }
  });
});

test("both transports preserve read-only policy, validation, conflicts, body limits and origin protection", async () => {
  const host = await startHost({ management: { readOnly: true, maxBodySize: 64 } });

  try {
    expect(await host.client("alice").capabilities()).toMatchObject({
      actions: { read: true, cancel: false, pause: false },
    });
    expect(
      await rejection(host.client("alice").pauseProcessing({ instanceId: "proof-686" })),
    ).toMatchObject({ code: "FORBIDDEN" });

    const post = async (path: string, body: string, headers: Record<string, string> = {}) =>
      await fetch(`${host.url}${path}`, {
        method: "POST",
        headers: { "content-type": "application/json", ...headers },
        body,
      });

    expect(
      (await post("/api/v1/processing/actions/pause", '{"instanceId":"proof-686"}')).status,
    ).toBe(403);

    for (const path of ["/api/v1/processing/actions/pause", "/rpc/pauseProcessing"]) {
      expect((await post(path, "{}", { origin: "https://evil.example" })).status).toBe(403);
      expect((await post(path, JSON.stringify({ x: "x".repeat(128) }))).status).toBe(413);
    }

    expect((await fetch(`${host.url}/rpc/pauseProcessing`)).status).toBe(404);
    const document = await (await fetch(`${host.url}/openapi.json`)).json();
    expect(document).toHaveProperty("paths./api/v1/processing");
    expect(document).toHaveProperty("servers");
    expect(document).toMatchObject({ servers: [{ url: "/" }] });
  } finally {
    await host.close();
  }

  const writable = await startHost();

  try {
    expect(
      await rejection(writable.client("alice").pauseProcessing({ instanceId: "other" })),
    ).toMatchObject({ code: "CONFLICT" });
    expect(
      await rejection(writable.client("alice").cancelJob({ params: { id: "bad" } })),
    ).toMatchObject({ code: "BAD_REQUEST" });
    expect(
      (await fetch(`${writable.url}/api/v1/jobs/bad/actions/cancel`, { method: "POST" })).status,
    ).toBe(400);
    expect(
      await rejection(
        writable.client("alice").cancelJob({ params: { id: "000000000000000000000000" } }),
      ),
    ).toMatchObject({ code: "INTERNAL_SERVER_ERROR" });
  } finally {
    await writable.close();
  }
});

const rejection = async (promise: Promise<unknown>): Promise<Error> => {
  try {
    await promise;
  } catch (error) {
    if (error instanceof Error) {
      return error;
    }

    throw error;
  }

  throw new Error("Expected failure");
};

test("optional facades deny unsupported actions consistently without hiding read capabilities", async () => {
  const owner = await startHost();

  const facade = {
    ...owner.monque.effects,
    cancelJob: undefined,
    getJob: () => Effect.succeed(null),
  };

  const host = await startHost({ management: { monque: facade } });

  try {
    expect(await host.client("alice").capabilities()).toMatchObject({
      actions: { read: true, cancel: false },
    });
    expect(
      await rejection(
        host.client("alice").cancelJob({ params: { id: "000000000000000000000000" } }),
      ),
    ).toMatchObject({ code: "FORBIDDEN", message: "Unsupported action" });

    const denied = await fetch(`${host.url}/api/v1/jobs/000000000000000000000000/actions/cancel`, {
      method: "POST",
    });

    expect(denied.status).toBe(403);
    expect(await denied.json()).toEqual({ error: "Unsupported action" });
    expect(
      await host
        .client("alice")
        .job({ params: { id: "000000000000000000000000" } })
        .catch((error: unknown) => error),
    ).toMatchObject({ code: "NOT_FOUND" });
  } finally {
    await host.close();
    await owner.close();
  }
});
