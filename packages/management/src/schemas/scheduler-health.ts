import { z } from 'zod';

/** Health response returned by the management API. */
export const SchedulerHealthDtoSchema = z
	.object({
		status: z.enum(['ok', 'unavailable']),
		scheduler: z
			.object({
				healthy: z.boolean(),
			})
			.strict(),
	})
	.strict();

export type SchedulerHealthDto = z.infer<typeof SchedulerHealthDtoSchema>;
