import { z } from 'zod';

/** Health response returned by the management API. */
export const SchedulerHealthDtoSchema = z
	.object({
		status: z.union([z.literal('ok'), z.literal('unavailable')]),
		scheduler: z
			.object({
				healthy: z.boolean(),
			})
			.strict(),
	})
	.strict();

/** Health response returned by the management API. */
export type SchedulerHealthDto = z.infer<typeof SchedulerHealthDtoSchema>;
