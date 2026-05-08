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

/**
 * Authorization action names used by the management surface.
 *
 * `read` covers all read endpoints. Mutation actions map to their matching single-job
 * and bulk-job endpoints where supported by the configured scheduler facade.
 */
export type ManagementAction = 'read' | 'cancel' | 'retry' | 'reschedule' | 'delete';

/**
 * Scheduler API required by `@monque/management`.
 *
 * Pass a `Monque` instance directly for full support, or provide a facade that implements
 * only the methods you want exposed. Missing mutation methods make the matching endpoints
 * return `403 Unsupported action`.
 */
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

/**
 * Input passed to the optional authorization callback.
 *
 * Single-job mutations include `job`; bulk mutations include `selector`. Read checks omit
 * both and should decide from `action` and `context`.
 *
 * @template TContext - Application context supplied through the OpenAPI handler call.
 */
export interface ManagementAuthorizationInput<TContext = unknown> {
	action: ManagementAction;
	context: TContext;
	job?: PersistedJob | undefined;
	selector?: JobSelector | undefined;
}

/**
 * Authorizes one management read or mutation operation.
 *
 * Return `false` to reject the request with `403`. Throwing is left to the caller and will
 * be handled as a normal oRPC error.
 */
export type ManagementAuthorize<TContext = unknown> = (
	input: ManagementAuthorizationInput<TContext>,
) => boolean | Promise<boolean>;

/**
 * Input passed to a payload serializer before a job is returned from the API.
 *
 * Use this hook to redact secrets, normalize binary-like values, or project large payloads
 * into a management-safe shape.
 *
 * @template TContext - Application context supplied through the OpenAPI handler call.
 */
export interface ManagementPayloadSerializationInput<TContext = unknown> {
	job: PersistedJob;
	payload: unknown;
	context: TContext;
}

/**
 * Converts a persisted job payload into an API-safe value.
 *
 * The returned value must be serializable by the HTTP framework that sends the response.
 */
export type ManagementPayloadSerializer<TContext = unknown> = (
	input: ManagementPayloadSerializationInput<TContext>,
) => Promise<unknown>;

/**
 * Options used to create a management router or OpenAPI handler.
 *
 * @template TContext - Application context supplied through the OpenAPI handler call.
 */
export interface ManagementOptions<TContext = unknown> {
	/** Scheduler instance or facade backing the management endpoints. */
	monque: ManagementMonque;
	/** When true, all mutation endpoints return `403` even if the scheduler supports them. */
	readOnly?: boolean;
	/** Optional authorization hook invoked before reads and mutations. */
	authorize?: ManagementAuthorize<TContext>;
	/** Default payload serializer for returned jobs. */
	serializePayload?: ManagementPayloadSerializer<TContext>;
	/** Payload serializers keyed by job name, taking precedence over `serializePayload`. */
	serializePayloadByJobName?: Record<string, ManagementPayloadSerializer<TContext>>;
}

/**
 * oRPC/OpenAPI request context accepted by the management handler.
 *
 * Framework adapters can attach their own request state in `managementContext`; that value
 * is passed to authorization and payload serialization hooks.
 */
export type ManagementOpenApiContext<TContext = unknown> = Record<PropertyKey, unknown> & {
	managementContext?: TContext;
};

/**
 * Framework-neutral management surface.
 *
 * Call `openApiHandler.handle(request, options)` from your HTTP framework adapter.
 */
export interface ManagementSurface<TContext = unknown> {
	readonly openApiHandler: OpenAPIHandler<ManagementOpenApiContext<TContext>>;
}
