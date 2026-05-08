import { z } from 'zod';

/** Action support reported by the capabilities endpoint for the current request context. */
export const CapabilityActionsDtoSchema = z
	.object({
		read: z.boolean(),
		cancel: z.boolean(),
		retry: z.boolean(),
		reschedule: z.boolean(),
		delete: z.boolean(),
	})
	.strict();

/** Action support reported by the capabilities endpoint for the current request context. */
export type CapabilityActionsDto = z.infer<typeof CapabilityActionsDtoSchema>;

/**
 * Runtime capabilities for a management surface.
 *
 * Capabilities combine configured read-only mode, scheduler method support, and the optional
 * authorization hook for the current request context.
 */
export const CapabilitiesDtoSchema = z
	.object({
		readOnly: z.boolean(),
		actions: CapabilityActionsDtoSchema,
	})
	.strict();

/** Runtime capabilities for a management surface. */
export type CapabilitiesDto = z.infer<typeof CapabilitiesDtoSchema>;
