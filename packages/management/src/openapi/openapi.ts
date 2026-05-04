import type {
	OpenAPIObject,
	OperationObject,
	PathItemObject,
	SchemaObject,
} from 'openapi3-ts/oas31';
import { OpenApiBuilder } from 'openapi3-ts/oas31';

import { HttpMethod, OpenApiResponseStatus } from '../http/index.js';
import { MANAGEMENT_ROUTE_MAP } from '../routes/index.js';
import { CapabilitiesSchema, ErrorSchema, SchedulerHealthSchema } from '../schemas/index.js';
import type { ManagementHttpMethod, ManagementRoute } from '../surface/index.js';

export function getManagementOpenApiDocument(): OpenAPIObject {
	const builder = OpenApiBuilder.create().addOpenApiVersion('3.1.0').addInfo({
		title: 'Monque Management API',
		version: '0.1.0',
	});

	for (const schema of [SchedulerHealthSchema, CapabilitiesSchema, ErrorSchema]) {
		builder.addSchema(getSchemaId(schema), schema as SchemaObject);
	}

	for (const route of MANAGEMENT_ROUTE_MAP) {
		builder.addPath(route.path, createPathItem(route));
	}

	return builder.getSpec();
}

function createPathItem(route: ManagementRoute): PathItemObject {
	const operation: OperationObject = {
		operationId: route.operationId,
		responses: {
			[OpenApiResponseStatus.OK]: {
				description: 'Successful response',
				content: {
					'application/json': {
						schema: createSchemaReference(route.responseSchema),
					},
				},
			},
			[OpenApiResponseStatus.DEFAULT]: {
				description: 'Error response',
				content: {
					'application/json': {
						schema: createSchemaReference(route.errorSchema),
					},
				},
			},
		},
	};

	switch (route.method) {
		case HttpMethod.GET:
			return { get: operation };
		case HttpMethod.POST:
			return { post: operation };
		case HttpMethod.DELETE:
			return { delete: operation };
		default:
			return assertNever(route.method);
	}
}

function createSchemaReference(schema: ManagementRoute['responseSchema']): { $ref: string } {
	return {
		$ref: `#/components/schemas/${getSchemaId(schema)}`,
	};
}

function getSchemaId(schema: ManagementRoute['responseSchema']): string {
	const schemaId = (schema as { $id?: string }).$id;

	if (!schemaId) {
		throw new Error('Management schemas must define $id');
	}

	return schemaId;
}

function assertNever(value: never): never {
	throw new Error(
		`Unsupported Management HTTP method: ${String(value satisfies ManagementHttpMethod)}`,
	);
}
