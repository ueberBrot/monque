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
	Capabilities: {
		schema: CapabilitiesDtoSchema,
	},
	Job: {
		schema: JobDtoSchema,
	},
	JobCursorPage: {
		schema: JobCursorPageDtoSchema,
	},
	JobSelector: {
		schema: JobSelectorDtoSchema,
	},
	BulkActionResult: {
		schema: BulkActionResultDtoSchema,
	},
	DeleteJob: {
		schema: DeleteJobDtoSchema,
	},
	ManagementError: {
		schema: ManagementErrorDtoSchema,
	},
	QueueStats: {
		schema: QueueStatsDtoSchema,
	},
	QueueViewSummaryList: {
		schema: QueueViewSummaryListDtoSchema,
	},
	RescheduleJobRequest: {
		schema: RescheduleJobRequestDtoSchema,
	},
	SchedulerHealth: {
		schema: SchedulerHealthDtoSchema,
	},
} as const;
