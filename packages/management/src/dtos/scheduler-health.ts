import { Type } from '@sinclair/typebox';

import type { SchedulerHealthDto } from '../surface/index.js';

/**
 * TypeBox schema for the scheduler health response.
 */
export const SchedulerHealthSchema = Type.Object(
	{
		status: Type.Union([Type.Literal('ok'), Type.Literal('unavailable')]),
		scheduler: Type.Object({
			healthy: Type.Boolean(),
		}),
	},
	{ $id: 'SchedulerHealth', additionalProperties: false },
);

/**
 * Create the scheduler health response DTO.
 */
export function toSchedulerHealthDto(healthy: boolean): SchedulerHealthDto {
	return {
		status: healthy ? 'ok' : 'unavailable',
		scheduler: {
			healthy,
		},
	};
}
