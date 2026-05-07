import { type OpenAPI, OpenAPIGenerator } from '@orpc/openapi';
import { ZodToJsonSchemaConverter } from '@orpc/zod/zod4';

import { SchedulerHealthDtoSchema } from '../schemas/index.js';
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
			SchedulerHealth: {
				schema: SchedulerHealthDtoSchema,
			},
		},
	});
}
