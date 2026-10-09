import type { CronDecoratorOptions, CronMetadata, JobDecoratorTarget } from "@/decorators/types.js";

import { appendJobMetadata } from "./append-job-metadata.js";

/**
 * Method decorator that registers a method as a scheduled cron job.
 *
 * @param pattern - Cron expression (e.g., "* * * * *", "@daily")
 * @param options - Optional cron configuration (name, timezone, etc.)
 *
 * @example
 * ```typescript
 * @JobController()
 * class ReportJobs {
 *   @Cron("@daily", { timezone: "UTC" })
 *   async generateDailyReport() {
 *     // ...
 *   }
 * }
 * ```
 */
export const Cron = function Cron(
  pattern: string,
  options?: CronDecoratorOptions,
): MethodDecorator {
  return <T>(
    target: JobDecoratorTarget,
    propertyKey: string | symbol,
    _descriptor: TypedPropertyDescriptor<T>,
  ): void => {
    const methodName = String(propertyKey);

    const cronMetadata: CronMetadata = {
      pattern,
      // Default name to method name if not provided
      name: options?.name === undefined || options.name === "" ? methodName : options.name,
      method: methodName,
      opts: options ?? {},
    };

    appendJobMetadata(target, cronMetadata);
  };
};
