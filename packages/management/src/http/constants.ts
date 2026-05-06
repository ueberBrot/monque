/**
 * HTTP methods used by the Management API route map.
 */
export const HttpMethod = {
	GET: 'GET',
	POST: 'POST',
	DELETE: 'DELETE',
} as const;

/**
 * Union type of HTTP method values supported by Management routes.
 */
export type HttpMethodType = (typeof HttpMethod)[keyof typeof HttpMethod];

/**
 * HTTP status codes returned by the Management surface.
 */
export const HttpStatus = {
	OK: 200,
	BAD_REQUEST: 400,
	FORBIDDEN: 403,
	NOT_FOUND: 404,
	CONFLICT: 409,
	INTERNAL_SERVER_ERROR: 500,
} as const;

/**
 * Union type of HTTP status code values returned by Management responses.
 */
export type HttpStatusType = (typeof HttpStatus)[keyof typeof HttpStatus];

/**
 * OpenAPI response status keys used when generating operation responses.
 */
export const OpenApiResponseStatus = {
	OK: '200',
	DEFAULT: 'default',
} as const;
