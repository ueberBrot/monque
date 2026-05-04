export const HttpMethod = {
	GET: 'GET',
	POST: 'POST',
	DELETE: 'DELETE',
} as const;

export type HttpMethodType = (typeof HttpMethod)[keyof typeof HttpMethod];

export const HttpStatus = {
	OK: 200,
	NOT_FOUND: 404,
} as const;

export type HttpStatusType = (typeof HttpStatus)[keyof typeof HttpStatus];

export const OpenApiResponseStatus = {
	OK: '200',
	DEFAULT: 'default',
} as const;
