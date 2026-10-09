/**
 * `@Job` method decorator
 *
 * Registers a method as a job handler. The method will be called when a job
 * with the matching name is picked up for processing.
 *
 * @param name - Job name (combined with controller namespace if present).
 * @param options - Job configuration options.
 *
 * @example
 * ```typescript
 * @JobController("notifications")
 * export class NotificationJobs {
 *   @Job("push", { concurrency: 10 })
 *   async sendPush(job: Job<PushPayload>) {
 *     await pushService.send(job.data);
 *   }
 * }
 * ```
 */
import { appendJobMetadata } from "./append-job-metadata.js";
import type { JobDecoratorOptions, JobDecoratorTarget, JobMetadata } from "./types.js";

/**
 * Method decorator that registers a method as a job handler.
 *
 * @param name - The job name (will be prefixed with controller namespace if present)
 * @param options - Optional job configuration (concurrency, replace, etc.)
 */
export const Job = function Job(name: string, options?: JobDecoratorOptions): MethodDecorator {
  return <T>(
    target: JobDecoratorTarget,
    propertyKey: string | symbol,
    _descriptor: TypedPropertyDescriptor<T>,
  ): void => {
    const methodName = String(propertyKey);

    const jobMetadata: JobMetadata = {
      name,
      method: methodName,
      opts: options ?? {},
    };

    appendJobMetadata(target, jobMetadata);
  };
};
