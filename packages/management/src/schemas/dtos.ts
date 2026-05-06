import { type Static, Type } from '@sinclair/typebox';

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

const JobStatusSchema = Type.Union([
	Type.Literal('pending'),
	Type.Literal('processing'),
	Type.Literal('completed'),
	Type.Literal('failed'),
	Type.Literal('cancelled'),
]);

export const JobSelectorSchema = Type.Object(
	{
		name: Type.Optional(Type.String()),
		status: Type.Optional(
			Type.Union([JobStatusSchema, Type.Array(JobStatusSchema, { minItems: 1 })]),
		),
		olderThan: Type.Optional(Type.String({ format: 'date-time' })),
		newerThan: Type.Optional(Type.String({ format: 'date-time' })),
	},
	{ $id: 'JobSelector', additionalProperties: false },
);

export const BulkActionResultSchema = Type.Object(
	{
		count: Type.Number(),
		errors: Type.Array(
			Type.Object({
				jobId: Type.String(),
				error: Type.String(),
			}),
		),
	},
	{ $id: 'BulkActionResult' },
);

export const QueueStatsSchema = Type.Object(
	{
		pending: Type.Number(),
		processing: Type.Number(),
		completed: Type.Number(),
		failed: Type.Number(),
		cancelled: Type.Number(),
		total: Type.Number(),
		avgProcessingDurationMs: Type.Optional(Type.Number()),
	},
	{ $id: 'QueueStats' },
);

export const QueueViewSummaryListSchema = Type.Object(
	{
		queueViews: Type.Array(
			Type.Object({
				name: Type.String(),
				hasPersistedJobs: Type.Boolean(),
				hasRegisteredWorker: Type.Boolean(),
				stats: Type.Unsafe<Static<typeof QueueStatsSchema>>(
					Type.Ref('#/components/schemas/QueueStats'),
				),
				worker: Type.Union([
					Type.Object({
						concurrency: Type.Number(),
						activeCount: Type.Number(),
					}),
					Type.Null(),
				]),
			}),
		),
	},
	{ $id: 'QueueViewSummaryList' },
);

export const JobSchema = Type.Object(
	{
		id: Type.String(),
		name: Type.String(),
		status: JobStatusSchema,
		payload: Type.Unknown(),
		nextRunAt: Type.String({ format: 'date-time' }),
		lockedAt: Type.Union([Type.String({ format: 'date-time' }), Type.Null()]),
		claimedBy: Type.Union([Type.String(), Type.Null()]),
		lastHeartbeat: Type.Union([Type.String({ format: 'date-time' }), Type.Null()]),
		heartbeatInterval: Type.Optional(Type.Number()),
		failCount: Type.Number(),
		failureReason: Type.Union([Type.String(), Type.Null()]),
		repeatInterval: Type.Optional(Type.String()),
		uniqueKey: Type.Optional(Type.String()),
		createdAt: Type.String({ format: 'date-time' }),
		updatedAt: Type.String({ format: 'date-time' }),
	},
	{ $id: 'Job' },
);

export const JobCursorPageSchema = Type.Object(
	{
		jobs: Type.Array(Type.Unsafe<Static<typeof JobSchema>>(Type.Ref('#/components/schemas/Job'))),
		cursor: Type.Union([Type.String(), Type.Null()]),
		hasNextPage: Type.Boolean(),
		hasPreviousPage: Type.Boolean(),
	},
	{ $id: 'JobCursorPage' },
);

export const DeleteJobSchema = Type.Object(
	{
		deleted: Type.Literal(true),
	},
	{ $id: 'DeleteJob' },
);

export const RescheduleJobRequestSchema = Type.Object(
	{
		nextRunAt: Type.String({ format: 'date-time' }),
	},
	{ $id: 'RescheduleJobRequest', additionalProperties: false },
);

export const ErrorSchema = Type.Object(
	{
		error: Type.String(),
	},
	{ $id: 'ManagementError' },
);
