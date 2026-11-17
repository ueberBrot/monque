/* oxlint-disable vitest/max-expects -- Each transport case verifies one complete Management workflow. */
// @effect-diagnostics unstableApiUsage:off
/* oxlint-disable unicorn/no-await-expression-member, eslint/no-await-in-loop -- Sequential HTTP responses assert state transitions at the public seam. */
/* oxlint-disable anti-slop/no-unknown-parameters, anti-slop/no-unknown-returns, anti-slop/no-conditional-empty-object-spread -- Requests intentionally carry different contract DTOs; assertions verify decoded protocol output. */
import { afterAll, beforeAll, describe, expect, it } from "@effect/vitest";
import { MongoDBContainer } from "@testcontainers/mongodb";
import type { StartedMongoDBContainer } from "@testcontainers/mongodb";
import { Data, Effect } from "effect";

import { Identity, startHost } from "./host";

class PromiseFacadeUsed extends Data.TaggedError("PromiseFacadeUsed") {}

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

describe("Management integration", () => {
  let container: StartedMongoDBContainer;

  beforeAll(async () => {
    container = await new MongoDBContainer("mongo:8").start();
  }, 120_000);

  afterAll(async () => {
    await container?.stop();
  });

  describe.each(["rpc", "http"] as const)("complete %s Management Surface", (transport) => {
    it.live(
      "reads, authorizes and serializes jobs; single/selected/bulk actions and processing controls",
      () =>
        Effect.gen(function* exerciseOperations() {
          const host = yield* startHost({
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

          const seed = () =>
            host.monque.effects
              .now("mail", { secret: "hidden" })
              .pipe(Effect.map((job) => job._id.toHexString()));

          try {
            // A Promise scheduler path cannot satisfy any request in this matrix.
            host.monque.getJob = () => {
              throw new PromiseFacadeUsed();
            };

            const id = yield* seed();
            const params = { id };

            const concurrent = yield* Effect.tryPromise(
              async () =>
                await Promise.all(
                  ["alice", "bob"].map(async (identity) => {
                    if (transport === "rpc") {
                      return await host.client(identity).job({ params: { id } });
                    }

                    return await (
                      await fetch(`${host.url}/api/v1/jobs/${id}`, {
                        headers: { "x-identity": identity },
                      })
                    ).json();
                  }),
                ),
            );

            expect(concurrent).toMatchObject([
              { payload: { viewer: "alice", service: "alice", resumed: "alice" } },
              { payload: { viewer: "bob", service: "bob", resumed: "bob" } },
            ]);

            expect(
              yield* Effect.tryPromise(
                async () => await call(async () => await client.health(), "/health"),
              ),
            ).toMatchObject({
              status: "unavailable",
              scheduler: { healthy: false },
            });
            expect(
              yield* Effect.tryPromise(
                async () => await call(async () => await client.capabilities(), "/capabilities"),
              ),
            ).toMatchObject({
              actions: { read: true, cancel: true, pause: true },
            });
            expect(
              yield* Effect.tryPromise(
                async () => await call(async () => await client.queueViews(), "/queue-views"),
              ),
            ).toMatchObject({
              queueViews: [{ name: "mail" }],
            });
            expect(
              yield* Effect.tryPromise(
                async () => await call(async () => await client.jobs({}), "/jobs"),
              ),
            ).toMatchObject({
              jobs: [{ id, payload: { viewer: "alice" } }],
            });
            expect(
              yield* Effect.tryPromise(
                async () => await call(async () => await client.jobStats({}), "/jobs/stats"),
              ),
            ).toMatchObject({
              pending: 1,
            });
            expect(
              yield* Effect.tryPromise(
                async () => await call(async () => await client.job({ params }), `/jobs/${id}`),
              ),
            ).toMatchObject({
              id,
              payload: { viewer: "alice" },
            });
            expect(
              yield* Effect.tryPromise(
                async () =>
                  await call(
                    async () => await client.setJobPriority({ params, body: { priority: 7 } }),
                    `/jobs/${id}/actions/priority`,
                    "POST",
                    { priority: 7 },
                  ),
              ),
            ).toMatchObject({ priority: 7 });
            const nextRunAt = "2030-01-01T00:00:00.000Z";
            expect(
              yield* Effect.tryPromise(
                async () =>
                  await call(
                    async () => await client.rescheduleJob({ params, body: { nextRunAt } }),
                    `/jobs/${id}/actions/reschedule`,
                    "POST",
                    { nextRunAt },
                  ),
              ),
            ).toMatchObject({ nextRunAt });
            expect(
              yield* Effect.tryPromise(
                async () =>
                  await call(
                    async () => await client.cancelJob({ params }),
                    `/jobs/${id}/actions/cancel`,
                    "POST",
                  ),
              ),
            ).toMatchObject({ status: "cancelled" });
            expect(
              yield* Effect.tryPromise(
                async () =>
                  await call(
                    async () => await client.retryJob({ params }),
                    `/jobs/${id}/actions/retry`,
                    "POST",
                  ),
              ),
            ).toMatchObject({ status: "pending" });
            expect(
              yield* Effect.tryPromise(
                async () =>
                  await call(
                    async () => await client.selectedJobActions({ action: "cancel", ids: [id] }),
                    "/jobs/actions/selected",
                    "POST",
                    { action: "cancel", ids: [id] },
                  ),
              ),
            ).toMatchObject({ count: 1, errors: [] });
            expect(
              yield* Effect.tryPromise(
                async () =>
                  await call(
                    async () => await client.retryJobs({ name: "mail" }),
                    "/jobs/actions/retry",
                    "POST",
                    {
                      name: "mail",
                    },
                  ),
              ),
            ).toMatchObject({ count: 1 });
            expect(
              yield* Effect.tryPromise(
                async () =>
                  await call(
                    async () => await client.cancelJobs({ name: "mail" }),
                    "/jobs/actions/cancel",
                    "POST",
                    { name: "mail" },
                  ),
              ),
            ).toMatchObject({ count: 1 });
            expect(
              yield* Effect.tryPromise(
                async () =>
                  await call(
                    async () => await client.deleteJob({ params }),
                    `/jobs/${id}`,
                    "DELETE",
                  ),
              ),
            ).toStrictEqual({ deleted: true });
            yield* seed();
            expect(
              yield* Effect.tryPromise(
                async () =>
                  await call(
                    async () => await client.deleteJobs({ name: "mail" }),
                    "/jobs/actions/delete",
                    "POST",
                    { name: "mail" },
                  ),
              ),
            ).toMatchObject({ count: 1 });
            const input = { instanceId: "proof-686" };
            expect(
              yield* Effect.tryPromise(
                async () =>
                  await call(
                    async () => await client.pauseProcessing(input),
                    "/processing/actions/pause",
                    "POST",
                    input,
                  ),
              ),
            ).toMatchObject({ paused: true });
            expect(
              yield* Effect.tryPromise(
                async () => await call(async () => await client.processingState(), "/processing"),
              ),
            ).toMatchObject({
              paused: true,
            });
            expect(
              yield* Effect.tryPromise(
                async () =>
                  await call(
                    async () => await client.resumeProcessing(input),
                    "/processing/actions/resume",
                    "POST",
                    input,
                  ),
              ),
            ).toMatchObject({ paused: false });
          } finally {
            yield* host.close;
          }
        }),
    );
  });

  it.live(
    "both transports preserve read-only policy, validation, conflicts, body limits and origin protection",
    () =>
      Effect.gen(function* requestProtections() {
        const host = yield* startHost({ management: { readOnly: true, maxBodySize: 64 } });

        try {
          expect(
            yield* Effect.tryPromise(async () => await host.client("alice").capabilities()),
          ).toMatchObject({
            actions: { read: true, cancel: false, pause: false },
          });
          expect(
            yield* Effect.tryPromise(
              async () =>
                await rejection(host.client("alice").pauseProcessing({ instanceId: "proof-686" })),
            ),
          ).toMatchObject({ code: "FORBIDDEN" });

          const post = async (path: string, body: string, headers: Record<string, string> = {}) =>
            await fetch(`${host.url}${path}`, {
              method: "POST",
              headers: { "content-type": "application/json", ...headers },
              body,
            });

          expect(
            (yield* Effect.tryPromise(
              async () =>
                await post("/api/v1/processing/actions/pause", '{"instanceId":"proof-686"}'),
            )).status,
          ).toBe(403);

          for (const path of ["/api/v1/processing/actions/pause", "/rpc/pauseProcessing"]) {
            expect(
              (yield* Effect.tryPromise(
                async () => await post(path, "{}", { origin: "https://evil.example" }),
              )).status,
            ).toBe(403);
            expect(
              (yield* Effect.tryPromise(
                async () => await post(path, JSON.stringify({ x: "x".repeat(128) })),
              )).status,
            ).toBe(413);
          }

          expect(
            (yield* Effect.tryPromise(async () => await fetch(`${host.url}/rpc/pauseProcessing`)))
              .status,
          ).toBe(404);

          const document = yield* Effect.tryPromise(
            async () => await (await fetch(`${host.url}/openapi.json`)).json(),
          );

          expect(document).toHaveProperty("paths./api/v1/processing");
          expect(document).toHaveProperty("servers");
          expect(document).toMatchObject({ servers: [{ url: "/" }] });
        } finally {
          yield* host.close;
        }

        const writable = yield* startHost();

        try {
          expect(
            yield* Effect.tryPromise(
              async () =>
                await rejection(writable.client("alice").pauseProcessing({ instanceId: "other" })),
            ),
          ).toMatchObject({ code: "CONFLICT" });
          expect(
            yield* Effect.tryPromise(
              async () =>
                await rejection(writable.client("alice").cancelJob({ params: { id: "bad" } })),
            ),
          ).toMatchObject({ code: "BAD_REQUEST" });
          expect(
            (yield* Effect.tryPromise(
              async () =>
                await fetch(`${writable.url}/api/v1/jobs/bad/actions/cancel`, { method: "POST" }),
            )).status,
          ).toBe(400);
          expect(
            yield* Effect.tryPromise(
              async () =>
                await rejection(
                  writable
                    .client("alice")
                    .cancelJob({ params: { id: "000000000000000000000000" } }),
                ),
            ),
          ).toMatchObject({ code: "INTERNAL_SERVER_ERROR" });
        } finally {
          yield* writable.close;
        }
      }),
  );

  it.live(
    "optional facades deny unsupported actions consistently without hiding read capabilities",
    () =>
      Effect.gen(function* optionalCapabilities() {
        const owner = yield* startHost();

        const facade = {
          ...owner.monque.effects,
          cancelJob: undefined,
          getJob: () => Effect.succeed(null),
        };

        const host = yield* startHost({ management: { monque: facade } });

        try {
          expect(
            yield* Effect.tryPromise(async () => await host.client("alice").capabilities()),
          ).toMatchObject({
            actions: { read: true, cancel: false },
          });
          expect(
            yield* Effect.tryPromise(
              async () =>
                await rejection(
                  host.client("alice").cancelJob({ params: { id: "000000000000000000000000" } }),
                ),
            ),
          ).toMatchObject({ code: "FORBIDDEN", message: "Unsupported action" });

          const denied = yield* Effect.tryPromise(
            async () =>
              await fetch(`${host.url}/api/v1/jobs/000000000000000000000000/actions/cancel`, {
                method: "POST",
              }),
          );

          expect(denied.status).toBe(403);
          expect(yield* Effect.tryPromise(async () => await denied.json())).toStrictEqual({
            error: "Unsupported action",
          });
          expect(
            yield* Effect.tryPromise(
              async () =>
                await host
                  .client("alice")
                  .job({ params: { id: "000000000000000000000000" } })
                  .catch((error: unknown) => error),
            ),
          ).toMatchObject({ code: "NOT_FOUND" });
        } finally {
          yield* host.close;
          yield* owner.close;
        }
      }),
  );
});
