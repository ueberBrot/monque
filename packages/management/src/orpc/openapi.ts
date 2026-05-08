import { type OpenAPI, OpenAPIGenerator } from '@orpc/openapi';
import { ZodToJsonSchemaConverter } from '@orpc/zod/zod4';

import {
	BulkActionResultDtoSchema,
	CapabilitiesDtoSchema,
	JobCursorPageDtoSchema,
	JobDtoSchema,
	JobSelectorDtoSchema,
	ManagementErrorDtoSchema,
	QueueStatsDtoSchema,
	QueueViewSummaryListDtoSchema,
	SchedulerHealthDtoSchema,
} from '../schemas/index.js';
import { managementContract } from './contract.js';

export async function generateManagementOpenApiDocument(): Promise<OpenAPI.Document> {
	const generator = new OpenAPIGenerator({
		schemaConverters: [new ZodToJsonSchemaConverter()],
	});

	return generator.generate(managementContract, {
		info: {
			title: 'Monque Management API',
			version: '0.1.0',
		},
		customErrorResponseBodySchema: () => ({ $ref: '#/components/schemas/ManagementError' }),
		commonSchemas: {
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
			ManagementError: {
				schema: ManagementErrorDtoSchema,
			},
			QueueStats: {
				schema: QueueStatsDtoSchema,
			},
			QueueViewSummaryList: {
				schema: QueueViewSummaryListDtoSchema,
			},
			SchedulerHealth: {
				schema: SchedulerHealthDtoSchema,
			},
		},
	});
}
