import type {
	OpenAPIObject,
	OperationObject,
	ParameterObject,
	PathItemObject,
	SchemaObject,
} from 'openapi3-ts/oas31';
import { OpenApiBuilder } from 'openapi3-ts/oas31';

import { HttpMethod, OpenApiResponseStatus } from '../http/index.js';
import { getManagementRouteSchemas, MANAGEMENT_ROUTE_MAP } from '../routes/index.js';
import type { ManagementHttpMethod, ManagementRoute } from '../surface/index.js';

/**
 * Build the OpenAPI 3.1 document for the Monque Management API.
 *
 * The document is generated from the same route map and TypeBox schemas used by
 * request dispatch, keeping framework adapters and OpenAPI output aligned.
 */
export function getManagementOpenApiDocument(): OpenAPIObject {
	const builder = OpenApiBuilder.create().addOpenApiVersion('3.1.0').addInfo({
		title: 'Monque Management API',
		version: '0.1.0',
	});

	for (const schema of getManagementRouteSchemas()) {
		builder.addSchema(getSchemaId(schema), schema as SchemaObject);
	}

	const pathItemsByPath = new Map<string, PathItemObject>();

	for (const route of MANAGEMENT_ROUTE_MAP) {
		const pathItem = pathItemsByPath.get(route.path) ?? {};
		Object.assign(pathItem, createPathItem(route));
		pathItemsByPath.set(route.path, pathItem);
	}

	for (const [path, pathItem] of pathItemsByPath) {
		builder.addPath(path, pathItem);
	}

	return builder.getSpec();
}

function createPathItem(route: ManagementRoute): PathItemObject {
	const responses: NonNullable<OperationObject['responses']> = {
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
	};
	const operation: OperationObject = {
		operationId: route.operationId,
		responses,
	};

	for (const status of route.errorStatuses ?? []) {
		responses[String(status)] = {
			description: 'Error response',
			content: {
				'application/json': {
					schema: createSchemaReference(route.errorSchema),
				},
			},
		};
	}

	if (route.parameters) {
		operation.parameters = route.parameters.map((parameter): ParameterObject => {
			const openApiParameter: ParameterObject = {
				name: parameter.name,
				in: parameter.in,
				schema: parameter.schema as SchemaObject,
			};

			if (parameter.required !== undefined) {
				openApiParameter.required = parameter.required;
			}

			if (parameter.explode !== undefined) {
				openApiParameter.explode = parameter.explode;
			}

			return openApiParameter;
		});
	}

	if (route.requestSchema) {
		operation.requestBody = {
			required: true,
			content: {
				'application/json': {
					schema: createSchemaReference(route.requestSchema),
				},
			},
		};
	}

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
