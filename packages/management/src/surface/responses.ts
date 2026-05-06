import { HttpStatus } from '../http/index.js';
import type { ManagementResponse } from './types.js';

export function ok<TBody>(body: TBody): ManagementResponse<TBody> {
	return {
		status: HttpStatus.OK,
		body,
	};
}

export function badRequest(error: string): ManagementResponse<{ error: string }> {
	return {
		status: HttpStatus.BAD_REQUEST,
		body: { error },
	};
}

export function forbidden(error: string): ManagementResponse<{ error: string }> {
	return {
		status: HttpStatus.FORBIDDEN,
		body: { error },
	};
}

export function unsupportedAction(): ManagementResponse<{ error: string }> {
	return forbidden('Management action is unsupported');
}

export function notFound(error: string): ManagementResponse<{ error: string }> {
	return {
		status: HttpStatus.NOT_FOUND,
		body: { error },
	};
}

export function conflict(error: string): ManagementResponse<{ error: string }> {
	return {
		status: HttpStatus.CONFLICT,
		body: { error },
	};
}

export function internalServerError(): ManagementResponse<{ error: string }> {
	return {
		status: HttpStatus.INTERNAL_SERVER_ERROR,
		body: { error: 'Internal server error' },
	};
}
