import type { BulkOperationResult } from '@monque/core';
import { Type } from '@sinclair/typebox';

import type { BulkActionResultDto, DeleteJobDto } from '../surface/index.js';

/**
 * TypeBox schema for a successful single-job delete response.
 */
export const DeleteJobSchema = Type.Object(
	{
		deleted: Type.Literal(true),
	},
	{ $id: 'DeleteJob', additionalProperties: false },
);

/**
 * TypeBox schema for a bulk job mutation response.
 */
export const BulkActionResultSchema = Type.Object(
	{
		count: Type.Number(),
		errors: Type.Array(
			Type.Object(
				{
					jobId: Type.String(),
					error: Type.String(),
				},
				{ additionalProperties: false },
			),
		),
	},
	{ $id: 'BulkActionResult', additionalProperties: false },
);

/**
 * TypeBox schema for Management error responses.
 */
export const ErrorSchema = Type.Object(
	{
		error: Type.String(),
	},
	{ $id: 'ManagementError', additionalProperties: false },
);

/**
 * Create the DTO returned after a single job is deleted.
 */
export function toDeleteJobDto(): DeleteJobDto {
	return { deleted: true };
}

/**
 * Convert a Monque bulk operation result to the Management HTTP DTO.
 */
export function toBulkActionResultDto(result: BulkOperationResult): BulkActionResultDto {
	return {
		count: result.count,
		errors: result.errors.map((error) => ({
			jobId: error.jobId,
			error: error.error,
		})),
	};
}
