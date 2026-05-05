export const HttpMethod = {
	GET: 'GET',
	POST: 'POST',
	DELETE: 'DELETE',
} as const;

export type HttpMethodType = (typeof HttpMethod)[keyof typeof HttpMethod];

export const HttpStatus = {
	OK: 200,
	BAD_REQUEST: 400,
	FORBIDDEN: 403,
	NOT_FOUND: 404,
	CONFLICT: 409,
	INTERNAL_SERVER_ERROR: 500,
} as const;

export type HttpStatusType = (typeof HttpStatus)[keyof typeof HttpStatus];

export const OpenApiResponseStatus = {
	OK: '200',
	DEFAULT: 'default',
} as const;
