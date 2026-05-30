export * from './contract.js';
export {
	createManagementRouter,
	generateManagementOpenApiDocument,
	type ManagementRouter,
} from './orpc/index.js';
export type {
	ManagementAction,
	ManagementAuthorizationInput,
	ManagementAuthorize,
	ManagementMonque,
	ManagementOpenApiContext,
	ManagementOptions,
	ManagementPayloadSerializationInput,
	ManagementPayloadSerializer,
	ManagementSurface,
} from './surface/index.js';
export { createManagementSurface } from './surface/index.js';
