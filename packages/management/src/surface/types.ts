import type { Monque } from '@monque/core';
import type { TSchema } from '@sinclair/typebox';

import type { HttpMethodType, HttpStatusType } from '../http/index.js';

export type ManagementAction = 'read' | 'cancel' | 'retry' | 'reschedule' | 'delete';

export type ManagementHttpMethod = HttpMethodType;

export type ManagementMonque = Pick<Monque, 'isHealthy'>;

export interface ManagementAuthorizationInput<TContext = unknown> {
	action: ManagementAction;
	context: TContext;
}

export type ManagementAuthorize<TContext = unknown> = (
	input: ManagementAuthorizationInput<TContext>,
) => boolean | Promise<boolean>;

export interface ManagementOptions<TContext = unknown> {
	monque: ManagementMonque;
	readOnly?: boolean;
	authorize?: ManagementAuthorize<TContext>;
}

export interface ManagementRequest<TContext = unknown> {
	method: ManagementHttpMethod;
	path: string;
	context: TContext;
}

export interface ManagementResponse<TBody = unknown> {
	status: HttpStatusType;
	body: TBody;
}

export interface ManagementRoute {
	method: ManagementHttpMethod;
	path: string;
	operationId: string;
	responseSchema: TSchema;
	errorSchema: TSchema;
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

export interface ManagementSurface<TContext = unknown> {
	readonly routes: readonly ManagementRoute[];
	handle(request: ManagementRequest<TContext>): Promise<ManagementResponse>;
}
