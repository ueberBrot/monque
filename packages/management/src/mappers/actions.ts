import type { BulkOperationResult } from '@monque/core';

import type { BulkActionResultDto, DeleteJobDto } from '../schemas/index.js';

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
