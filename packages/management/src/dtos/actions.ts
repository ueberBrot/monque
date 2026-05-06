import type { BulkOperationResult } from '@monque/core';
import { Type } from '@sinclair/typebox';

import type { BulkActionResultDto, DeleteJobDto } from '../surface/index.js';

export const DeleteJobSchema = Type.Object(
	{
		deleted: Type.Literal(true),
	},
	{ $id: 'DeleteJob', additionalProperties: false },
);

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

export const ErrorSchema = Type.Object(
	{
		error: Type.String(),
	},
	{ $id: 'ManagementError', additionalProperties: false },
);

export function toDeleteJobDto(): DeleteJobDto {
	return { deleted: true };
}

export function toBulkActionResultDto(result: BulkOperationResult): BulkActionResultDto {
	return {
		count: result.count,
		errors: result.errors.map((error) => ({
			jobId: error.jobId,
			error: error.error,
		})),
	};
}
