import { createServer, IncomingMessage, type Server, ServerResponse } from 'node:http';
import { Socket } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createManagementMiddleware } from '../../src/management-middleware.js';

const servers: Server[] = [];
afterEach(async () => {
	await Promise.all(
		servers.splice(0).map(
			(server) =>
				new Promise<void>((resolve, reject) => {
					server.closeAllConnections();
					server.close((error) => (error ? reject(error) : resolve()));
				}),
		),
	);
});

async function serve(handler: Parameters<typeof createManagementMiddleware>[0]): Promise<string> {
	const middleware = createManagementMiddleware(handler);
	const server = createServer((request, response) => {
		request.url = request.url?.replace(/^\/api/, '') ?? '/';
		middleware(request, response, (error?: unknown) => {
			response.statusCode = error ? 500 : 404;
			response.end(error instanceof Error ? error.message : 'Not found');
		});
	});
	servers.push(server);
	await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
	const address = server.address();
	if (!address || typeof address === 'string') throw new Error('Expected TCP address');
	return `http://127.0.0.1:${address.port}`;
}

describe('Management Connect adapter', () => {
	it('preserves the mounted route, query, method, headers and JSON body', async () => {
		const origin = await serve(async (request) =>
			Response.json(
				{
					url: request.url,
					method: request.method,
					scenario: request.headers.get('x-monque-dev-scenario'),
					body: await request.json(),
				},
				{ status: 201, headers: { 'x-result': 'created' } },
			),
		);
		const response = await fetch(`${origin}/api/v1/jobs?name=email`, {
			method: 'POST',
			headers: { 'content-type': 'application/json', 'x-monque-dev-scenario': 'mixed' },
			body: JSON.stringify({ text: 'café 日本語' }),
		});
		expect(response.status).toBe(201);
		expect(response.headers.get('x-result')).toBe('created');
		expect(await response.json()).toEqual({
			url: 'http://dashboard-dev.local/api/v1/jobs?name=email',
			method: 'POST',
			scenario: 'mixed',
			body: { text: 'café 日本語' },
		});
	});

	it('preserves binary responses and separate cookie headers', async () => {
		const headers = new Headers();
		headers.append('set-cookie', 'session=one; Path=/; HttpOnly');
		headers.append('set-cookie', 'preference=two; Path=/');
		const origin = await serve(
			async () => new Response(new Uint8Array([0, 128, 255]), { headers }),
		);
		const response = await fetch(`${origin}/api/v1/data`);
		expect([...new Uint8Array(await response.arrayBuffer())]).toEqual([0, 128, 255]);
		expect(response.headers.getSetCookie()).toEqual(headers.getSetCookie());
	});

	it('does not consume response bodies for HEAD requests', async () => {
		const response = new Response('hidden', { headers: { 'x-result': 'head' } });
		const readBody = vi.spyOn(response, 'arrayBuffer');
		const origin = await serve(async (request) => {
			expect(request.method).toBe('HEAD');
			return response;
		});
		const result = await fetch(`${origin}/api/v1/health`, { method: 'HEAD' });
		expect(result.status).toBe(200);
		expect(result.headers.get('x-result')).toBe('head');
		expect(await result.text()).toBe('');
		expect(readBody).not.toHaveBeenCalled();
	});

	it('passes unmatched requests and handler errors to the next middleware', async () => {
		const origin = await serve(async (request) => {
			if (request.url.endsWith('/failure')) throw new Error('Handler failed');
			return undefined;
		});
		expect((await fetch(`${origin}/api/missing`)).status).toBe(404);
		const failure = await fetch(`${origin}/api/failure`);
		expect(failure.status).toBe(500);
		expect(await failure.text()).toBe('Handler failed');
	});

	it('forwards request stream failures without invoking the handler', async () => {
		const request = new IncomingMessage(new Socket());
		request.method = 'POST';
		request.url = '/v1/jobs';
		const response = new ServerResponse(request);
		const handler = vi.fn(async () => new Response('unexpected'));
		const middleware = createManagementMiddleware(handler);
		const failure = new Error('Request stream failed');
		const forwarded = new Promise<unknown>((resolve) => middleware(request, response, resolve));
		request.destroy(failure);
		expect(await forwarded).toBe(failure);
		expect(handler).not.toHaveBeenCalled();
	});
});
