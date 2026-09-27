import { z } from 'zod';

/** Local scheduler identity and effective pause state for a requested scope. */
export const ProcessingStateDtoSchema = z.strictObject({
	instanceId: z.string(),
	name: z.string().optional(),
	paused: z.boolean(),
	globallyPaused: z.boolean(),
});
export type ProcessingStateDto = z.infer<typeof ProcessingStateDtoSchema>;

/** Omit name to inspect the scheduler-wide pause. */
export const ProcessingQueryDtoSchema = z.strictObject({ name: z.string().min(1).optional() });
export type ProcessingQueryDto = z.infer<typeof ProcessingQueryDtoSchema>;

/** Identify the scheduler observed before changing its local pause state. */
export const ProcessingActionDtoSchema = ProcessingQueryDtoSchema.extend({
	instanceId: z.string().min(1),
});
export type ProcessingActionDto = z.infer<typeof ProcessingActionDtoSchema>;
