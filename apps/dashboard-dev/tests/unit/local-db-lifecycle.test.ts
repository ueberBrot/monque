import { IncomingMessage, ServerResponse } from 'node:http';
import { Socket } from 'node:net';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const runtime = vi.hoisted(() => ({
	connect: vi.fn(),
	close: vi.fn(),
	initialize: vi.fn(),
	stop: vi.fn(),
	startDemo: vi.fn(),
}));

vi.mock('mongodb', () => ({
	MongoClient: class {
		connect = runtime.connect;
		close = runtime.close;
		db() {
			return { collection: () => ({ findOne: async () => ({ version: 'seeded' }) }) };
		}
	},
}));
vi.mock('@monque/core', () => ({
	Monque: class {
		initialize = runtime.initialize;
		stop = runtime.stop;
	},
}));
vi.mock('@monque/management', () => ({ createManagementSurface: () => ({}) }));
vi.mock('../../src/local-db/scenarios.js', () => ({
	createScenario: () => [],
	registerScenarioWorkers: vi.fn(),
}));
vi.mock('../../src/local-db/demo-workload.js', () => ({ startDemoWorkload: runtime.startDemo }));

import { createLocalDbManagementServer } from '../../src/local-db/management-server.js';

beforeEach(() => {
	vi.resetAllMocks();
});

describe('local MongoDB development lifecycle', () => {
	it('keeps connection credentials out of startup messages and HTTP failures', async () => {
		const mongoUri = 'mongodb://operator:private-password@localhost:27018';
		const cause = new Error(`Authentication failed for ${mongoUri}`);
		runtime.connect.mockRejectedValue(cause);
		const server = createLocalDbManagementServer({ mongoUri });
		await expect(server.start()).rejects.toMatchObject({
			message: expect.stringContaining('Check MONQUE_DASHBOARD_DEV_MONGO_URI'),
			cause,
		});
		await expect(server.start()).rejects.toMatchObject({
			message: expect.not.stringContaining(mongoUri),
		});

		const request = new IncomingMessage(new Socket());
		request.method = 'GET';
		request.url = '/v1/health';
		const response = new ServerResponse(request);
		const ended = vi.spyOn(response, 'end').mockImplementation(() => response);
		const next = vi.fn();
		await server.middleware(request, response, next);
		expect(next).not.toHaveBeenCalled();
		expect(response.statusCode).toBe(503);
		const body = String(ended.mock.calls[0]?.[0]);
		expect(JSON.parse(body)).toEqual({
			error: 'dashboard_dev_db_unavailable',
			message: expect.stringContaining('Check MONQUE_DASHBOARD_DEV_MONGO_URI'),
		});
		expect(body).not.toContain('operator');
		expect(body).not.toContain('private-password');
		expect(body).not.toContain(mongoUri);
		await server.close();
	});

	it('waits for an immediately interrupted startup and releases its scheduler and connection', async () => {
		const connection = Promise.withResolvers<void>();
		runtime.connect.mockReturnValue(connection.promise);
		const server = createLocalDbManagementServer();
		const starting = server.start();
		let closed = false;
		const closing = server.close().then(() => {
			closed = true;
		});
		for (let index = 0; index < 5; index++) await Promise.resolve();
		expect(closed).toBe(false);
		connection.resolve();
		await Promise.all([starting, closing]);
		expect(runtime.connect).toHaveBeenCalledTimes(1);
		expect(runtime.stop).toHaveBeenCalledTimes(1);
		expect(runtime.close).toHaveBeenCalledTimes(1);
	});

	it('shares concurrent startups and shutdowns, then creates a fresh runtime on restart', async () => {
		const server = createLocalDbManagementServer();
		await Promise.all([server.start(), server.start()]);
		expect(runtime.connect).toHaveBeenCalledTimes(1);
		await Promise.all([server.close(), server.close()]);
		expect(runtime.stop).toHaveBeenCalledTimes(1);
		expect(runtime.close).toHaveBeenCalledTimes(1);
		await server.start();
		expect(runtime.connect).toHaveBeenCalledTimes(2);
		await server.close();
		expect(runtime.stop).toHaveBeenCalledTimes(2);
		expect(runtime.close).toHaveBeenCalledTimes(2);
	});

	it('waits for shutdown before restarting and recovers from a failed connection', async () => {
		const server = createLocalDbManagementServer();
		runtime.connect.mockRejectedValueOnce(new Error('MongoDB unavailable'));
		await expect(server.start()).rejects.toThrow('Could not connect');
		expect(runtime.close).toHaveBeenCalledTimes(1);
		await server.start();
		const stopped = Promise.withResolvers<void>();
		runtime.stop.mockReturnValueOnce(stopped.promise);
		const closing = server.close();
		const restarting = server.start();
		await Promise.resolve();
		expect(runtime.connect).toHaveBeenCalledTimes(2);
		stopped.resolve();
		await Promise.all([closing, restarting]);
		expect(runtime.connect).toHaveBeenCalledTimes(3);
		await server.close();
		expect(runtime.close).toHaveBeenCalledTimes(3);
	});
});
