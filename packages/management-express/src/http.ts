import type { Request, Response } from 'express';

type ParsedRequestBody = NonNullable<RequestInit['body']>;
type RequestWithParsedBody = Request & { body: unknown };

export function createRequest(req: Request): globalThis.Request {
	const url = new URL(req.url, `${req.protocol}://${req.get('host') ?? 'localhost'}`);
	const parsedBody = getParsedBody(req);
	const init: RequestInit & { duplex?: 'half' } = {
		method: req.method,
		headers: createHeaders(req, parsedBody !== undefined),
	};

	if (req.method !== 'GET' && req.method !== 'HEAD') {
		if (parsedBody !== undefined) {
			init.body = createParsedBody(parsedBody);
		} else {
			init.body = req;
			// Node fetch requires this flag when a request body is a stream.
			init.duplex = 'half';
		}
	}

	return new globalThis.Request(url, init);
}

export async function sendResponse(res: Response, response: globalThis.Response): Promise<void> {
	res.status(response.status);
	response.headers.forEach((value, key) => {
		res.setHeader(key, value);
	});

	res.send(Buffer.from(await response.arrayBuffer()));
}

function createHeaders(req: Request, omitContentLength: boolean): Headers {
	const headers = new Headers();

	for (const [name, value] of Object.entries(req.headers)) {
		if (value === undefined) {
			continue;
		}

		if (omitContentLength && name.toLowerCase() === 'content-length') {
			continue;
		}

		if (Array.isArray(value)) {
			for (const entry of value) {
				headers.append(name, entry);
			}
			continue;
		}

		headers.set(name, value);
	}

	return headers;
}

function getParsedBody(req: Request): unknown {
	return (req as RequestWithParsedBody).body;
}

function createParsedBody(body: unknown): ParsedRequestBody {
	if (typeof body === 'string') {
		return body;
	}

	if (Buffer.isBuffer(body)) {
		return body;
	}

	if (body instanceof URLSearchParams) {
		return body;
	}

	return JSON.stringify(body);
}
