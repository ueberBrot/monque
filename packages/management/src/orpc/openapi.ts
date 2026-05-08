import { type OpenAPI, OpenAPIGenerator } from '@orpc/openapi';
import { ZodToJsonSchemaConverter } from '@orpc/zod/zod4';

import { ManagementOpenApiSchemas } from '../schemas/registry.js';
import { managementContract } from './contract.js';

declare const __MONQUE_MANAGEMENT_PACKAGE_VERSION__: string;

const MANAGEMENT_OPENAPI_VERSION =
	typeof __MONQUE_MANAGEMENT_PACKAGE_VERSION__ === 'string'
		? __MONQUE_MANAGEMENT_PACKAGE_VERSION__
		: '0.0.0';

/**
 * Generate an OpenAPI 3.1 document for the Monque management API.
 *
 * The document includes every v1 route, including mutation routes that may return `403`
 * at runtime when the configured scheduler facade does not support them.
 */
export async function generateManagementOpenApiDocument(): Promise<OpenAPI.Document> {
	const generator = new OpenAPIGenerator({
		schemaConverters: [new ZodToJsonSchemaConverter()],
	});

	return generator.generate(managementContract, {
		info: {
			title: 'Monque Management API',
			version: MANAGEMENT_OPENAPI_VERSION,
		},
		customErrorResponseBodySchema: () => ({ $ref: '#/components/schemas/ManagementError' }),
		commonSchemas: ManagementOpenApiSchemas,
	});
}
