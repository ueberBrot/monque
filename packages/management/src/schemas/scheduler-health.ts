import { z } from 'zod';

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

export type SchedulerHealthDto = z.infer<typeof SchedulerHealthDtoSchema>;
