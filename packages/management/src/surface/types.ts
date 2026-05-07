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
import type { TSchema } from '@sinclair/typebox';
import type { ObjectId } from 'mongodb';

import type { HttpMethodType, HttpStatusType } from '../http/index.js';

export type {
	CapabilitiesDto,
	CapabilityActionsDto,
	JobCursorPageDto,
	JobDetailInputDto,
	JobDetailParamsDto,
	JobDto,
	JobListQueryDto,
	JobStatusDto,
	QueueStatsDto,
	QueueViewSummaryDto,
	QueueViewSummaryListDto,
	QueueViewWorkerDto,
	SchedulerHealthDto,
} from '../schemas/index.js';

/**
 * High-level Management API action categories.
 *
 * Used by capability reporting and authorization hooks.
 */
export type ManagementAction = 'read' | 'cancel' | 'retry' | 'reschedule' | 'delete';

/**
 * HTTP methods supported by the framework-neutral Management surface.
 */
export type ManagementHttpMethod = HttpMethodType;

/**
 * Metadata describing how a Management route maps to scheduler behavior.
 *
 * Adapter authors can use this to inspect whether a route is read-only,
 * mutates one job, or mutates a selector of jobs.
 */
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

/**
 * Minimal scheduler contract required by the Management surface.
 *
 * Passing a full `Monque` instance satisfies the read APIs. Optional mutation
 * methods determine which write routes and capabilities are exposed.
 */
export interface ManagementMonque {
	/** Report whether the scheduler can currently reach its backing store. */
	isHealthy: Pick<Monque, 'isHealthy'>['isHealthy'];

	/** Return queue-view summaries for registered and persisted job names. */
	getQueueViewSummaries: Pick<Monque, 'getQueueViewSummaries'>['getQueueViewSummaries'];

	/** Return jobs using cursor-based pagination. */
	getJobsWithCursor(options?: CursorOptions): Promise<CursorPage>;

	/** Return a single persisted job by MongoDB identifier. */
	getJob(id: ObjectId): Promise<PersistedJob | null>;

	/** Return aggregate queue statistics, optionally scoped to a job name. */
	getQueueStats(filter?: { name?: string }): Promise<QueueStats>;

	/** Cancel one job. When absent, the single-job cancel route is not exposed. */
	cancelJob?(id: string): Promise<PersistedJob | null>;

	/** Retry one failed or cancelled job. When absent, the single-job retry route is not exposed. */
	retryJob?(id: string): Promise<PersistedJob | null>;

	/** Reschedule one job. When absent, the reschedule route is not exposed. */
	rescheduleJob?(id: string, runAt: Date): Promise<PersistedJob | null>;

	/** Delete one job. When absent, the single-job delete route is not exposed. */
	deleteJob?(id: string): Promise<boolean>;

	/** Cancel jobs matching a selector. When absent, the bulk cancel route is not exposed. */
	cancelJobs?(selector: JobSelector): Promise<BulkOperationResult>;

	/** Retry jobs matching a selector. When absent, the bulk retry route is not exposed. */
	retryJobs?(selector: JobSelector): Promise<BulkOperationResult>;

	/** Delete jobs matching a selector. When absent, the bulk delete route is not exposed. */
	deleteJobs?(selector: JobSelector): Promise<BulkOperationResult>;
}

/**
 * Input passed to the Management authorization hook.
 *
 * `job` is provided for single-job actions after the target job has been found.
 * `selector` is provided for bulk actions after request validation.
 */
export interface ManagementAuthorizationInput<TContext = unknown> {
	/** Management action being attempted. */
	action: ManagementAction;

	/** Framework-provided request context, such as a user or request object. */
	context: TContext;

	/** Target job for single-job reads or mutations. */
	job?: PersistedJob | undefined;

	/** Bulk selector for selector-based mutations. */
	selector?: JobSelector | undefined;
}

/**
 * Authorization hook for Management requests.
 *
 * Return `true` to allow the action and `false` to return a 403 response.
 */
export type ManagementAuthorize<TContext = unknown> = (
	input: ManagementAuthorizationInput<TContext>,
) => boolean | Promise<boolean>;

/**
 * Input passed to payload serialization hooks.
 *
 * Use this to redact or transform job payloads before they are returned from
 * Management read endpoints.
 */
export interface ManagementPayloadSerializationInput<TContext = unknown> {
	/** Persisted job being serialized. */
	job: PersistedJob;

	/** Raw job payload before Management serialization. */
	payload: unknown;

	/** Framework-provided request context. */
	context: TContext;
}

/**
 * Payload serializer used when returning jobs from Management read endpoints.
 */
export type ManagementPayloadSerializer<TContext = unknown> = (
	input: ManagementPayloadSerializationInput<TContext>,
) => Promise<unknown>;

/**
 * Options for creating a framework-neutral Management surface.
 *
 * @template TContext - Framework request context carried through authorization
 * and serialization hooks.
 *
 * @example
 * ```typescript
 * const surface = createManagementSurface({
 *   monque,
 *   readOnly: false,
 *   authorize: ({ action, context }) => context.user.can(`jobs:${action}`),
 *   serializePayload: async ({ payload }) => redactSecrets(payload),
 * });
 * ```
 */
export interface ManagementOptions<TContext = unknown> {
	/** Scheduler capability contract used by Management routes. */
	monque: ManagementMonque;

	/**
	 * Disable write actions while keeping read endpoints available.
	 *
	 * @default false
	 */
	readOnly?: boolean;

	/** Optional per-request authorization hook. */
	authorize?: ManagementAuthorize<TContext>;

	/** Default serializer for job payloads returned by read endpoints. */
	serializePayload?: ManagementPayloadSerializer<TContext>;

	/** Job-name-specific payload serializers, overriding `serializePayload`. */
	serializePayloadByJobName?: Record<string, ManagementPayloadSerializer<TContext>>;
}

/**
 * Context object supplied to the oRPC OpenAPI handler.
 *
 * oRPC requires an object-shaped context, while Management keeps the adapter
 * request context generic.
 */
export type ManagementOpenApiContext<TContext = unknown> = Record<PropertyKey, unknown> & {
	managementContext?: TContext;
};

/**
 * Query-string value shape accepted from framework adapters.
 */
export type ManagementQueryValue = string | readonly string[] | undefined;

/**
 * Normalized framework-neutral request handled by a Management surface.
 *
 * Framework adapters convert their native request into this shape and pass it to
 * `ManagementSurface.handle()`.
 */
export interface ManagementRequest<TContext = unknown> {
	/** HTTP method. */
	method: ManagementHttpMethod;

	/** Route path. Concrete IDs may be normalized to templated route paths. */
	path: string;

	/** Path parameters, usually populated by `normalizeManagementRequest()`. */
	params?: Readonly<Record<string, string | undefined>>;

	/** Parsed query-string values. */
	query?: Readonly<Record<string, ManagementQueryValue>>;

	/** Parsed JSON request body, when the route accepts one. */
	body?: unknown;

	/** Framework-provided context carried to auth and serialization hooks. */
	context: TContext;
}

/**
 * Framework-neutral response returned by a Management surface.
 */
export interface ManagementResponse<TBody = unknown> {
	/** HTTP status code. */
	status: HttpStatusType;

	/** JSON-serializable response body. */
	body: TBody;
}

/**
 * OpenAPI-compatible route parameter metadata.
 */
export interface ManagementRouteParameter {
	/** Parameter name. */
	name: string;

	/** Parameter location. */
	in: 'path' | 'query';

	/** Whether the parameter is required. */
	required?: boolean;

	/** OpenAPI explode behavior for array-like query values. */
	explode?: boolean;

	/** TypeBox schema for the parameter value. */
	schema: TSchema;
}

/**
 * Route metadata used by Management dispatch, capabilities, and OpenAPI generation.
 */
export interface ManagementRoute {
	/** HTTP method used by the route. */
	method: ManagementHttpMethod;

	/** Templated Management API path. */
	path: string;

	/** Stable OpenAPI operation identifier. */
	operationId: string;

	/** Scheduler operation represented by the route. */
	operation: ManagementRouteOperation;

	/** TypeBox response schema for successful responses. */
	responseSchema: TSchema;

	/** TypeBox response schema for error responses. */
	errorSchema: TSchema;

	/** TypeBox request-body schema for routes that accept JSON bodies. */
	requestSchema?: TSchema;

	/** OpenAPI parameter metadata. */
	parameters?: readonly ManagementRouteParameter[];

	/** Explicit non-200 error statuses documented for this route. */
	errorStatuses?: readonly HttpStatusType[];
}

/**
 * Delete-job response DTO.
 */
export interface DeleteJobDto {
	/** Literal confirmation that the job was deleted. */
	deleted: true;
}

/**
 * Bulk job action response DTO.
 */
export type BulkActionResultDto = BulkOperationResult;

/**
 * Framework-neutral Management surface.
 *
 * Adapters expose `routes` for registration/introspection and call `handle()`
 * for each incoming request.
 */
export interface ManagementSurface<TContext = unknown> {
	/** Routes supported by the supplied scheduler capability contract. */
	readonly routes: readonly ManagementRoute[];

	/** oRPC OpenAPI handler mounted by framework adapters. */
	readonly openApiHandler: OpenAPIHandler<ManagementOpenApiContext<TContext>>;

	/** Handle one normalized Management request. */
	handle(request: ManagementRequest<TContext>): Promise<ManagementResponse>;
}
