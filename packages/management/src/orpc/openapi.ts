import { type OpenAPI, OpenAPIGenerator } from '@orpc/openapi';
import { ZodToJsonSchemaConverter } from '@orpc/zod/zod4';

import {
	CapabilitiesDtoSchema,
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
		commonSchemas: {
			Capabilities: {
				schema: CapabilitiesDtoSchema,
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
