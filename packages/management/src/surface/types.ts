import type {
	BulkOperationResult,
	CursorOptions,
	CursorPage,
	JobSelector,
	Monque,
	PersistedJob,
	QueueStats,
} from '@monque/core';
import type { OpenAPIHandler } from '@orpc/openapi/fetch';
import type { ObjectId } from 'mongodb';

export type {
	BulkActionErrorDto,
	BulkActionResultDto,
	CapabilitiesDto,
	CapabilityActionsDto,
	DeleteJobDto,
	JobCursorPageDto,
	JobDetailInputDto,
	JobDetailParamsDto,
	JobDto,
	JobListQueryDto,
	JobSelectorDto,
	JobStatusDto,
	ManagementErrorDto,
	QueueStatsDto,
	QueueViewSummaryDto,
	QueueViewSummaryListDto,
	QueueViewWorkerDto,
	RescheduleJobInputDto,
	RescheduleJobRequestDto,
	SchedulerHealthDto,
} from '../schemas/index.js';

export type ManagementAction = 'read' | 'cancel' | 'retry' | 'reschedule' | 'delete';

export interface ManagementMonque {
	isHealthy: Pick<Monque, 'isHealthy'>['isHealthy'];
	getQueueViewSummaries: Pick<Monque, 'getQueueViewSummaries'>['getQueueViewSummaries'];
	getJobsWithCursor(options?: CursorOptions): Promise<CursorPage>;
	getJob(id: ObjectId): Promise<PersistedJob | null>;
	getQueueStats(filter?: { name?: string }): Promise<QueueStats>;
	cancelJob?(id: string): Promise<PersistedJob | null>;
	retryJob?(id: string): Promise<PersistedJob | null>;
	rescheduleJob?(id: string, runAt: Date): Promise<PersistedJob | null>;
	deleteJob?(id: string): Promise<boolean>;
	cancelJobs?(selector: JobSelector): Promise<BulkOperationResult>;
	retryJobs?(selector: JobSelector): Promise<BulkOperationResult>;
	deleteJobs?(selector: JobSelector): Promise<BulkOperationResult>;
}

export interface ManagementAuthorizationInput<TContext = unknown> {
	action: ManagementAction;
	context: TContext;
	job?: PersistedJob | undefined;
	selector?: JobSelector | undefined;
}

export type ManagementAuthorize<TContext = unknown> = (
	input: ManagementAuthorizationInput<TContext>,
) => boolean | Promise<boolean>;

export interface ManagementPayloadSerializationInput<TContext = unknown> {
	job: PersistedJob;
	payload: unknown;
	context: TContext;
}

export type ManagementPayloadSerializer<TContext = unknown> = (
	input: ManagementPayloadSerializationInput<TContext>,
) => Promise<unknown>;

export interface ManagementOptions<TContext = unknown> {
	monque: ManagementMonque;
	readOnly?: boolean;
	authorize?: ManagementAuthorize<TContext>;
	serializePayload?: ManagementPayloadSerializer<TContext>;
	serializePayloadByJobName?: Record<string, ManagementPayloadSerializer<TContext>>;
}

export type ManagementOpenApiContext<TContext = unknown> = Record<PropertyKey, unknown> & {
	managementContext?: TContext;
};

export interface ManagementSurface<TContext = unknown> {
	readonly openApiHandler: OpenAPIHandler<ManagementOpenApiContext<TContext>>;
}
