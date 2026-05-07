import { z } from 'zod';

export const CapabilityActionsDtoSchema = z
	.object({
		read: z.boolean(),
		cancel: z.boolean(),
		retry: z.boolean(),
		reschedule: z.boolean(),
		delete: z.boolean(),
	})
	.strict();

export type CapabilityActionsDto = z.infer<typeof CapabilityActionsDtoSchema>;

export const CapabilitiesDtoSchema = z
	.object({
		readOnly: z.boolean(),
		actions: CapabilityActionsDtoSchema,
	})
	.strict();

export type CapabilitiesDto = z.infer<typeof CapabilitiesDtoSchema>;
