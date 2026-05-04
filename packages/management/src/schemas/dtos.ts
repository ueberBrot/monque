import { Type } from '@sinclair/typebox';

export const SchedulerHealthSchema = Type.Object(
	{
		status: Type.Union([Type.Literal('ok'), Type.Literal('unavailable')]),
		scheduler: Type.Object({
			healthy: Type.Boolean(),
		}),
	},
	{ $id: 'SchedulerHealth' },
);

export const CapabilitiesSchema = Type.Object(
	{
		readOnly: Type.Boolean(),
		actions: Type.Object({
			read: Type.Boolean(),
			cancel: Type.Boolean(),
			retry: Type.Boolean(),
			reschedule: Type.Boolean(),
			delete: Type.Boolean(),
		}),
	},
	{ $id: 'Capabilities' },
);

export const ErrorSchema = Type.Object(
	{
		error: Type.String(),
	},
	{ $id: 'ManagementError' },
);
