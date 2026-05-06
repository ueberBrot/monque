import type {
	BulkOperationResult,
	CursorOptions,
	CursorPage,
	JobSelector,
	JobStatusType,
	Monque,
	PersistedJob,
	QueueStats,
} from '@monque/core';
import type { TSchema } from '@sinclair/typebox';
import type { ObjectId } from 'mongodb';

import type { HttpMethodType, HttpStatusType } from '../http/index.js';

export type ManagementAction = 'read' | 'cancel' | 'retry' | 'reschedule' | 'delete';

export type ManagementHttpMethod = HttpMethodType;

export type ManagementRouteOperation =
	| { kind: 'read' }
	| {
			kind: 'single-job-action';
			action: Exclude<ManagementAction, 'read'>;
			method: 'cancelJob' | 'retryJob' | 'rescheduleJob' | 'deleteJob';
	  }
	| {
			kind: 'bulk-job-action';
			action: Exclude<ManagementAction, 'read' | 'reschedule'>;
			method: 'cancelJobs' | 'retryJobs' | 'deleteJobs';
	  };

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

export type ManagementQueryValue = string | readonly string[] | undefined;

export interface ManagementRequest<TContext = unknown> {
	method: ManagementHttpMethod;
	path: string;
	params?: Readonly<Record<string, string | undefined>>;
	query?: Readonly<Record<string, ManagementQueryValue>>;
	body?: unknown;
	context: TContext;
}

export interface ManagementResponse<TBody = unknown> {
	status: HttpStatusType;
	body: TBody;
}

export interface ManagementRouteParameter {
	name: string;
	in: 'path' | 'query';
	required?: boolean;
	explode?: boolean;
	schema: TSchema;
}

export interface ManagementRoute {
	method: ManagementHttpMethod;
	path: string;
	operationId: string;
	operation: ManagementRouteOperation;
	responseSchema: TSchema;
	errorSchema: TSchema;
	requestSchema?: TSchema;
	parameters?: readonly ManagementRouteParameter[];
	errorStatuses?: readonly HttpStatusType[];
}

export interface SchedulerHealthDto {
	status: 'ok' | 'unavailable';
	scheduler: {
		healthy: boolean;
	};
}

export type CapabilityActionsDto = Record<ManagementAction, boolean>;

export interface CapabilitiesDto {
	readOnly: boolean;
	actions: CapabilityActionsDto;
}

export type QueueStatsDto = QueueStats;

export interface QueueViewWorkerDto {
	concurrency: number;
	activeCount: number;
}

export interface QueueViewSummaryDto {
	name: string;
	hasPersistedJobs: boolean;
	hasRegisteredWorker: boolean;
	stats: QueueStatsDto;
	worker: QueueViewWorkerDto | null;
}

export interface QueueViewSummaryListDto {
	queueViews: QueueViewSummaryDto[];
}

export interface JobDto {
	id: string;
	name: string;
	status: JobStatusType;
	payload: unknown;
	nextRunAt: string;
	lockedAt: string | null;
	claimedBy: string | null;
	lastHeartbeat: string | null;
	heartbeatInterval?: number;
	failCount: number;
	failureReason: string | null;
	repeatInterval?: string;
	uniqueKey?: string;
	createdAt: string;
	updatedAt: string;
}

export interface JobCursorPageDto {
	jobs: JobDto[];
	cursor: string | null;
	hasNextPage: boolean;
	hasPreviousPage: boolean;
}

export interface DeleteJobDto {
	deleted: true;
}

export type BulkActionResultDto = BulkOperationResult;

export interface ManagementSurface<TContext = unknown> {
	readonly routes: readonly ManagementRoute[];
	handle(request: ManagementRequest<TContext>): Promise<ManagementResponse>;
}
