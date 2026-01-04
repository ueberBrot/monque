import type { Monque } from '@monque/core';
import type { Db, MongoClient } from 'mongodb';
import { describe, expect, it, vi } from 'vitest';

import { createMonqueProxy, resolveDatabase } from '@/services/helpers.js';
import type { MonqueSettings } from '@/services/types.js';

describe('MonqueService Helpers', () => {
	describe('resolveDatabase()', () => {
		it('should resolve direct Db instance', async () => {
			const mockDb = { name: 'test-db' } as unknown as Db;
			const opts: MonqueSettings = { enabled: true, db: mockDb };

			const result = await resolveDatabase(opts);

			expect(result).toBe(mockDb);
		});

		it('should resolve async Db factory function', async () => {
			const mockDb = { name: 'test-db' } as unknown as Db;
			const dbFactory = vi.fn().mockResolvedValue(mockDb);
			const opts: MonqueSettings = { enabled: true, db: dbFactory };

			const result = await resolveDatabase(opts);

			expect(result).toBe(mockDb);
			expect(dbFactory).toHaveBeenCalledOnce();
		});

		it('should resolve from MongoClient instance', async () => {
			const mockDb = { name: 'test-db' } as unknown as Db;
			const mockClient = {
				db: vi.fn().mockReturnValue(mockDb),
			} as unknown as MongoClient;
			const opts: MonqueSettings = { enabled: true, client: mockClient };

			const result = await resolveDatabase(opts);

			expect(result).toBe(mockDb);
			expect(mockClient.db).toHaveBeenCalledOnce();
		});

		it('should throw error when no database connection configured', async () => {
			const opts: MonqueSettings = { enabled: true };

			await expect(resolveDatabase(opts)).rejects.toThrow('No database connection configured');
		});

		it('should prefer db over client when both provided', async () => {
			const dbFromDb = { name: 'from-db' } as unknown as Db;
			const dbFromClient = { name: 'from-client' } as unknown as Db;
			const mockClient = {
				db: vi.fn().mockReturnValue(dbFromClient),
			} as unknown as MongoClient;

			const opts: MonqueSettings = {
				enabled: true,
				db: dbFromDb,
				client: mockClient,
			};

			const result = await resolveDatabase(opts);

			expect(result).toBe(dbFromDb);
			expect(mockClient.db).not.toHaveBeenCalled();
		});
	});

	describe('createMonqueProxy()', () => {
		it('should intercept worker() calls and wrap handler in DI context', () => {
			const mockWorker = vi.fn();
			const mockMonque = { worker: mockWorker } as unknown as Monque;

			const proxied = createMonqueProxy(mockMonque);
			const userHandler = vi.fn();

			proxied.worker('test-job', userHandler);

			expect(mockWorker).toHaveBeenCalledOnce();

			const call = mockWorker.mock.calls[0];
			if (!call) throw new Error('Expected worker to be called');

			expect(call[0]).toBe('test-job');
			expect(call[1]).not.toBe(userHandler); // Handler should be wrapped
			expect(typeof call[1]).toBe('function');
		});

		it('should pass through concurrency options', () => {
			const mockWorker = vi.fn();
			const mockMonque = { worker: mockWorker } as unknown as Monque;

			const proxied = createMonqueProxy(mockMonque);

			proxied.worker('test-job', vi.fn(), { concurrency: 5 });

			expect(mockWorker).toHaveBeenCalledOnce();
			const call = mockWorker.mock.calls[0];
			if (!call) throw new Error('Expected worker to be called');

			expect(call[2]).toEqual({ concurrency: 5 });
		});

		it('should delegate non-worker methods to target', () => {
			const mockEnqueue = vi.fn().mockResolvedValue(undefined);
			const mockStart = vi.fn();
			const mockStop = vi.fn();

			const mockMonque = {
				enqueue: mockEnqueue,
				start: mockStart,
				stop: mockStop,
			} as unknown as Monque;

			const proxied = createMonqueProxy(mockMonque);

			proxied.enqueue('test', { foo: 'bar' });
			proxied.start();
			proxied.stop();

			expect(mockEnqueue).toHaveBeenCalledWith('test', { foo: 'bar' });
			expect(mockStart).toHaveBeenCalledOnce();
			expect(mockStop).toHaveBeenCalledOnce();
		});

		it('should preserve method call context for non-worker methods', () => {
			const mockMonque = {
				isHealthy: vi.fn().mockReturnValue(true),
			} as unknown as Monque;

			const proxied = createMonqueProxy(mockMonque);
			const result = proxied.isHealthy();

			expect(result).toBe(true);
			expect(mockMonque.isHealthy).toHaveBeenCalledOnce();
		});
	});
});
