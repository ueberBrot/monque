import type { Connect } from 'vite';

const MANAGEMENT_MOUNT_PATH = '/api';

type ManagementRequestHandler = (request: Request) => Promise<Response | undefined>;

/** Adapts a mounted Management handler to Vite's Connect middleware. */
function createManagementMiddleware(handle: ManagementRequestHandler): Connect.NextHandleFunction {
	return async (request, response, next) => {
		if (!request.url) {
			next();
			return;
		}

		try {
			const result = await handle(await createFetchRequest(request));
			if (!result) {
				next();
				return;
			}

			const body = request.method === 'HEAD' ? undefined : Buffer.from(await result.arrayBuffer());
			response.statusCode = result.status;
			result.headers.forEach((value, name) => {
				if (name !== 'set-cookie') response.setHeader(name, value);
			});
			const cookies = result.headers.getSetCookie();
			if (cookies.length) response.setHeader('set-cookie', cookies);
			response.end(body);
		} catch (error) {
			next(error);
		}
	};
}

async function createFetchRequest(request: Connect.IncomingMessage): Promise<Request> {
	const headers = new Headers();
	for (const [name, value] of Object.entries(request.headers)) {
		if (value === undefined) continue;
		for (const entry of Array.isArray(value) ? value : [value]) headers.append(name, entry);
	}

	const requestInit: RequestInit = { method: request.method ?? 'GET', headers };
	if (requestInit.method !== 'GET' && requestInit.method !== 'HEAD') {
		const chunks: Uint8Array[] = [];
		for await (const chunk of request) {
			chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
		}
		if (chunks.length) requestInit.body = new Blob([new Uint8Array(Buffer.concat(chunks))]);
	}

	const path = request.url?.startsWith('/') ? request.url : `/${request.url ?? ''}`;
	return new Request(`http://dashboard-dev.local${MANAGEMENT_MOUNT_PATH}${path}`, requestInit);
}

export { createManagementMiddleware, MANAGEMENT_MOUNT_PATH };
