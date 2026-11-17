import { InvalidCursorError, JobStateError } from "@monque/core";
import { Effect, Exit, Cause, Data } from "effect";
import { describe, expect, it } from "vite-plus/test";

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
  it("reports only supported actions and enforces read-only before authorization", async () => {
    const operations = createNativeManagementOperations({
      monque: nativeScheduler(),
      authorize: () => Effect.succeed(true),
    });

    await expect(Effect.runPromise(operations.capabilities(undefined, {}))).resolves.toMatchObject({
      actions: { read: true, cancel: false, pause: false, cancelBulk: false },
    });
    await expect(
      Effect.runPromise(operations.mutateJob({ action: "cancel" }, "invalid", {})),
    ).rejects.toMatchObject({ code: "FORBIDDEN", message: "Unsupported action" });

    const readOnly = createNativeManagementOperations({
      monque: nativeScheduler(),
      readOnly: true,
      authorize: () => Effect.die("must not authorize a mutation"),
    });

    await expect(
      Effect.runPromise(readOnly.mutateJob({ action: "cancel" }, "invalid", {})),
    ).rejects.toMatchObject({ code: "FORBIDDEN", message: "Management surface is read-only" });
  });

  it("preserves single, selected and bulk authorization targets and domain classification", async () => {
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

    await expect(
      Effect.runPromise(operations.mutateJob({ action: "cancel" }, id, "operator")),
    ).rejects.toMatchObject({ code: "CONFLICT", message: "Already completed" });
    await expect(
      Effect.runPromise(
        operations.selectedJobActions({ action: "cancel", ids: [id, id] }, "operator"),
      ),
    ).resolves.toStrictEqual({
      count: 0,
      errors: [{ jobId: id, status: 409, error: "Already completed" }],
    });
    await expect(
      Effect.runPromise(
        operations.bulkJobMutation("cancelBulk", { name: "send-email" }, "operator"),
      ),
    ).resolves.toStrictEqual({ count: 2, errors: [] });
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

    await expect(Effect.runPromise(invalid.jobs({}, {}))).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
  });

  it.each(["denial", "failure", "defect"] as const)(
    "does not grant access after authorization %s",
    async (mode) => {
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

      const exit = await Effect.runPromiseExit(operations.jobs({}, {}));
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
    },
  );

  it("interrupts parallel host authorization and joins its finalizers", async () => {
    const started: PromiseWithResolvers<void> = Promise.withResolvers();
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
            started.resolve();
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

    const controller = new AbortController();

    const pending = Effect.runPromiseExit(operations.capabilities(undefined, {}), {
      signal: controller.signal,
    });

    await started.promise;
    controller.abort();
    const exit = await pending;
    expect(released).toBe(3);
    expect(Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause)).toBe(true);
  });
});
