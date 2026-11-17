import { describe, expect, it } from "@effect/vitest";
// @effect-diagnostics unstableApiUsage:off
import { InvalidCursorError, JobStateError } from "@monque/core";
import { Effect, Exit, Cause, Data, Deferred, Fiber } from "effect";

import type { ManagementEffects } from "@/index";
import { createNativeManagementOperations } from "@/index";
import { createManagementJob } from "@tests/unit/management-test-utils";

class HostFailure extends Data.TaggedError("HostFailure")<{ message: string }> {}

const nativeScheduler = function nativeScheduler(
  overrides: Partial<ManagementEffects> = {},
): ManagementEffects {
  return {
    isHealthy: Effect.succeed(true),
    getQueueViewSummaries: () => Effect.succeed([]),
    getJobsWithCursor: () =>
      Effect.succeed({ jobs: [], cursor: null, hasNextPage: false, hasPreviousPage: false }),
    getJob: () => Effect.succeed(null),
    getQueueStats: () =>
      Effect.succeed({
        pending: 0,
        processing: 0,
        completed: 0,
        failed: 0,
        cancelled: 0,
        total: 0,
      }),
    ...overrides,
  };
};

describe("native policy and hooks", () => {
  it.effect("reports only supported actions and enforces read-only before authorization", () =>
    Effect.gen(function* capabilityPolicy() {
      const operations = createNativeManagementOperations({
        monque: nativeScheduler(),
        authorize: () => Effect.succeed(true),
      });

      expect(yield* operations.capabilities(undefined, {})).toMatchObject({
        actions: { read: true, cancel: false, pause: false, cancelBulk: false },
      });
      expect(
        yield* Effect.flip(operations.mutateJob({ action: "cancel" }, "invalid", {})),
      ).toMatchObject({ code: "FORBIDDEN", message: "Unsupported action" });

      const readOnly = createNativeManagementOperations({
        monque: nativeScheduler(),
        readOnly: true,
        authorize: () => Effect.die("must not authorize a mutation"),
      });

      expect(
        yield* Effect.flip(readOnly.mutateJob({ action: "cancel" }, "invalid", {})),
      ).toMatchObject({ code: "FORBIDDEN", message: "Management surface is read-only" });
    }),
  );

  it.effect(
    "preserves single, selected and bulk authorization targets and domain classification",
    () =>
      Effect.gen(function* mutationTargets() {
        const job = createManagementJob();
        const id = job._id.toHexString();
        const targets: unknown[] = [];

        const operations = createNativeManagementOperations({
          monque: nativeScheduler({
            getJob: () => Effect.succeed(job),
            cancelJob: () =>
              Effect.fail(new JobStateError("Already completed", id, "completed", "cancel")),
            cancelJobs: () => Effect.succeed({ count: 2, errors: [] }),
          }),
          authorize: (input) =>
            Effect.sync(() => {
              targets.push(input);

              return true;
            }),
        });

        expect(
          yield* Effect.flip(operations.mutateJob({ action: "cancel" }, id, "operator")),
        ).toMatchObject({ code: "CONFLICT", message: "Already completed" });
        expect(
          yield* operations.selectedJobActions({ action: "cancel", ids: [id, id] }, "operator"),
        ).toStrictEqual({
          count: 0,
          errors: [{ jobId: id, status: 409, error: "Already completed" }],
        });
        expect(
          yield* operations.bulkJobMutation("cancelBulk", { name: "send-email" }, "operator"),
        ).toStrictEqual({ count: 2, errors: [] });
        expect(targets).toStrictEqual(
          expect.arrayContaining([
            expect.objectContaining({ action: "cancel", context: "operator", job }),
            expect.objectContaining({ action: "cancelBulk", context: "operator", ids: [id] }),
            expect.objectContaining({
              action: "cancelBulk",
              context: "operator",
              selector: { name: "send-email" },
            }),
          ]),
        );

        const invalid = createNativeManagementOperations({
          monque: nativeScheduler({
            // oxlint-disable-next-line effecttsgo/global-error-in-effect-failure -- Exercise the existing public untagged domain error contract.
            // @effect-diagnostics-next-line globalErrorInEffectFailure:off
            getJobsWithCursor: () => Effect.fail(new InvalidCursorError("Invalid cursor")),
          }),
        });

        expect(yield* Effect.flip(invalid.jobs({}, {}))).toMatchObject({
          code: "BAD_REQUEST",
        });
      }),
  );

  it.effect.each(["denial", "failure", "defect"] as const)(
    "does not grant access after authorization %s",
    (mode) =>
      Effect.gen(function* authorizationFailure() {
        const failure = new HostFailure({ message: "Host authorization failed" });

        const operations = createNativeManagementOperations({
          monque: nativeScheduler({
            getJobsWithCursor: () => Effect.die("scheduler must not execute"),
          }),
          authorize: () => {
            if (mode === "denial") {
              return Effect.succeed(false);
            }

            return mode === "failure" ? Effect.fail(failure) : Effect.die(failure);
          },
        });

        const exit = yield* Effect.exit(operations.jobs({}, {}));
        expect(Exit.isFailure(exit)).toBe(true);

        if (!Exit.isFailure(exit)) {
          throw new Error("Expected authorization failure");
        }

        const error = Cause.squash(exit.cause);
        expect(error).toMatchObject(
          mode === "denial" ? { code: "FORBIDDEN" } : { _tag: "HostFailure" },
        );
        expect(mode === "denial" || error === failure).toBe(true);
        expect(Cause.hasDies(exit.cause)).toBe(mode === "defect");
      }),
  );

  it.effect("interrupts parallel host authorization and joins its finalizers", () =>
    Effect.gen(function* parallelAuthorization() {
      const started = yield* Deferred.make<undefined>();
      let released = 0;
      let checks = 0;

      const operations = createNativeManagementOperations({
        monque: nativeScheduler({
          cancelJob: () => Effect.succeed(null),
          retryJob: () => Effect.succeed(null),
        }),
        parallelCapabilityChecks: true,
        authorize: () =>
          Effect.gen(function* authorize() {
            checks += 1;

            if (checks === 3) {
              yield* Deferred.succeed(started, undefined);
            }

            return yield* Effect.never;
          }).pipe(
            Effect.ensuring(
              Effect.sync(() => {
                released += 1;
              }),
            ),
          ),
      });

      const pending = yield* Effect.forkChild(operations.capabilities(undefined, {}));
      yield* Deferred.await(started);
      yield* Fiber.interrupt(pending);
      const exit = yield* Fiber.await(pending);
      expect(released).toBe(3);
      expect(Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause)).toBe(true);
    }),
  );
});
