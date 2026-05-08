import type { SchedulerHealthDto } from '../schemas/index.js';

export function toSchedulerHealthDto(healthy: boolean): SchedulerHealthDto {
	return {
		status: healthy ? 'ok' : 'unavailable',
		scheduler: {
			healthy,
		},
	};
}
