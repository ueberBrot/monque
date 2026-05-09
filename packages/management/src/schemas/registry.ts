import {
	BulkActionResultDtoSchema,
	DeleteJobDtoSchema,
	JobSelectorDtoSchema,
	ManagementErrorDtoSchema,
	RescheduleJobRequestDtoSchema,
} from './actions.js';
import { CapabilitiesDtoSchema } from './capabilities.js';
import { JobCursorPageDtoSchema, JobDtoSchema } from './job.js';
import { QueueStatsDtoSchema, QueueViewSummaryListDtoSchema } from './queue-view.js';
import { SchedulerHealthDtoSchema } from './scheduler-health.js';

export const ManagementOpenApiSchemas = {
	CAPABILITIES: {
		schema: CapabilitiesDtoSchema,
	},
	JOB: {
		schema: JobDtoSchema,
	},
	JOB_CURSOR_PAGE: {
		schema: JobCursorPageDtoSchema,
	},
	JOB_SELECTOR: {
		schema: JobSelectorDtoSchema,
	},
	BULK_ACTION_RESULT: {
		schema: BulkActionResultDtoSchema,
	},
	DELETE_JOB: {
		schema: DeleteJobDtoSchema,
	},
	MANAGEMENT_ERROR: {
		schema: ManagementErrorDtoSchema,
	},
	QUEUE_STATS: {
		schema: QueueStatsDtoSchema,
	},
	QUEUE_VIEW_SUMMARY_LIST: {
		schema: QueueViewSummaryListDtoSchema,
	},
	RESCHEDULE_JOB_REQUEST: {
		schema: RescheduleJobRequestDtoSchema,
	},
	SCHEDULER_HEALTH: {
		schema: SchedulerHealthDtoSchema,
	},
} as const;

export const ManagementOpenApiComponentSchemas = {
	Capabilities: ManagementOpenApiSchemas.CAPABILITIES,
	Job: ManagementOpenApiSchemas.JOB,
	JobCursorPage: ManagementOpenApiSchemas.JOB_CURSOR_PAGE,
	JobSelector: ManagementOpenApiSchemas.JOB_SELECTOR,
	BulkActionResult: ManagementOpenApiSchemas.BULK_ACTION_RESULT,
	DeleteJob: ManagementOpenApiSchemas.DELETE_JOB,
	ManagementError: ManagementOpenApiSchemas.MANAGEMENT_ERROR,
	QueueStats: ManagementOpenApiSchemas.QUEUE_STATS,
	QueueViewSummaryList: ManagementOpenApiSchemas.QUEUE_VIEW_SUMMARY_LIST,
	RescheduleJobRequest: ManagementOpenApiSchemas.RESCHEDULE_JOB_REQUEST,
	SchedulerHealth: ManagementOpenApiSchemas.SCHEDULER_HEALTH,
};
