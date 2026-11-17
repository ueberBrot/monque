/* oxlint-disable typescript/unbound-method -- Captured facade methods are always invoked with their original receiver via call. */
import type { CursorOptions, JobSelector } from "@monque/core";

import { attempt, fromPromise } from "./effects.js";
import type { ManagementEffects, NativeManagementOptions } from "./native.js";
import { createNativeManagementOperations } from "./orpc/operations.js";
import type {
  ManagementOptions,
  ManagementAuthorizationInput,
  ManagementPayloadSerializationInput,
} from "./surface/types.js";

/** Adapts only external callbacks; native operations never call Promise scheduler methods. */
const adaptScheduler = function adaptScheduler(
  monque: ManagementOptions["monque"],
): ManagementEffects {
  return {
    get isHealthy() {
      return attempt(() => monque.isHealthy());
    },
    get getProcessingState() {
      const method = monque.getProcessingState;

      return method === undefined
        ? undefined
        : (name?: string) => attempt(() => method.call(monque, name));
    },
    get pause() {
      const method = monque.pause;

      return method === undefined
        ? undefined
        : (name?: string) =>
            attempt(() => {
              method.call(monque, name);
            });
    },
    get resume() {
      const method = monque.resume;

      return method === undefined
        ? undefined
        : (name?: string) =>
            attempt(() => {
              method.call(monque, name);
            });
    },
    getQueueViewSummaries: (filter) =>
      fromPromise(async () => await monque.getQueueViewSummaries(filter)),
    getJobsWithCursor: (options?: CursorOptions) =>
      fromPromise(async () => await monque.getJobsWithCursor(options)),
    get getJobSummariesWithCursor() {
      const method = monque.getJobSummariesWithCursor;

      return method === undefined
        ? undefined
        : (options?: CursorOptions) => fromPromise(async () => await method.call(monque, options));
    },
    getJob: (id: string) => fromPromise(async () => await monque.getJob(id)),
    getQueueStats: (filter) => fromPromise(async () => await monque.getQueueStats(filter)),
    get cancelJob() {
      const method = monque.cancelJob;

      return method === undefined
        ? undefined
        : (id: string) => fromPromise(async () => await method.call(monque, id));
    },
    get retryJob() {
      const method = monque.retryJob;

      return method === undefined
        ? undefined
        : (id: string) => fromPromise(async () => await method.call(monque, id));
    },
    get rescheduleJob() {
      const method = monque.rescheduleJob;

      return method === undefined
        ? undefined
        : (id: string, runAt: Date) =>
            fromPromise(async () => await method.call(monque, id, runAt));
    },
    get setJobPriority() {
      const method = monque.setJobPriority;

      return method === undefined
        ? undefined
        : (id: string, priority: number) =>
            fromPromise(async () => await method.call(monque, id, priority));
    },
    get deleteJob() {
      const method = monque.deleteJob;

      return method === undefined
        ? undefined
        : (id: string) => fromPromise(async () => await method.call(monque, id));
    },
    get cancelJobs() {
      const method = monque.cancelJobs;

      return method === undefined
        ? undefined
        : (selector: JobSelector) => fromPromise(async () => await method.call(monque, selector));
    },
    get retryJobs() {
      const method = monque.retryJobs;

      return method === undefined
        ? undefined
        : (selector: JobSelector) => fromPromise(async () => await method.call(monque, selector));
    },
    get deleteJobs() {
      const method = monque.deleteJobs;

      return method === undefined
        ? undefined
        : (selector: JobSelector) => fromPromise(async () => await method.call(monque, selector));
    },
  };
};

const adaptSerializer =
  <TContext>(hook: NonNullable<ManagementOptions<TContext>["serializePayload"]>) =>
  (input: ManagementPayloadSerializationInput<TContext>) =>
    fromPromise(async () => await hook(input));

export const createManagementOperations = function createManagementOperations<TContext>(
  options: ManagementOptions<TContext>,
) {
  const nativeOptions: NativeManagementOptions<TContext> = {
    get readOnly() {
      return options.readOnly ?? false;
    },
    get parallelCapabilityChecks() {
      return options.parallelCapabilityChecks ?? false;
    },
    monque: adaptScheduler(options.monque),
    get authorize() {
      const hook = options.authorize;

      return hook === undefined
        ? undefined
        : (input: ManagementAuthorizationInput<TContext>) =>
            fromPromise(async () => await hook.call(options, input));
    },
    get serializePayload() {
      const hook = options.serializePayload;

      return hook === undefined
        ? undefined
        : (input: ManagementPayloadSerializationInput<TContext>) =>
            fromPromise(async () => await hook(input));
    },
    get serializePayloadByJobName() {
      const hooks = options.serializePayloadByJobName;

      if (hooks === undefined) {
        // oxlint-disable-next-line unicorn/no-useless-undefined -- Getter explicitly returns an absent optional map.
        return undefined;
      }

      const serializers: NonNullable<
        NativeManagementOptions<TContext>["serializePayloadByJobName"]
      > = {};

      for (const name of Object.getOwnPropertyNames(hooks)) {
        Object.defineProperty(serializers, name, {
          configurable: true,
          get: () => {
            const hook = hooks[name];

            return hook === undefined || hook === null ? undefined : adaptSerializer(hook);
          },
        });
      }

      return serializers;
    },
  };

  return createNativeManagementOperations(nativeOptions);
};
