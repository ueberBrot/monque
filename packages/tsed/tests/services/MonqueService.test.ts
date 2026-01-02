import type { Monque } from '@monque/core';
import { JobFactory } from '@test-utils/factories/job.factory.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MonqueService } from '@/services';

// Create a typed mock that satisfies Monque interface
function createMockMonque() {
	return {
		enqueue: vi.fn().mockResolvedValue({ _id: 'test-id', name: 'test-job', data: {} }),
		now: vi.fn().mockResolvedValue({ _id: 'test-id', name: 'test-job', data: {} }),
		schedule: vi.fn().mockResolvedValue({ _id: 'test-id', name: 'test-job', data: {} }),
		worker: vi.fn(),
		start: vi.fn(),
		stop: vi.fn().mockResolvedValue(undefined),
		isHealthy: vi.fn().mockReturnValue(true),
	} as unknown as Monque;
}

describe('MonqueService', () => {
	let service: MonqueService;
	let mockMonque: ReturnType<typeof createMockMonque>;

	beforeEach(() => {
		service = new MonqueService();
		mockMonque = createMockMonque();
		vi.clearAllMocks();
	});

	describe('before setMonque is called', () => {
		it('should throw error on enqueue', async () => {
			await expect(service.enqueue('test', {})).rejects.toThrow('MonqueService not initialized');
		});

		it('should throw error on now', async () => {
			await expect(service.now('test', {})).rejects.toThrow('MonqueService not initialized');
		});

		it('should throw error on schedule', async () => {
			await expect(service.schedule('* * * * *', 'test', {})).rejects.toThrow(
				'MonqueService not initialized',
			);
		});

		it('should throw error on worker registration', () => {
			expect(() => service.worker('test', async () => {})).toThrow('MonqueService not initialized');
		});

		it('should throw error on start', () => {
			expect(() => service.start()).toThrow('MonqueService not initialized');
		});

		it('should not throw on stop when not initialized', async () => {
			await expect(service.stop()).resolves.toBeUndefined();
		});

		it('should return false for isHealthy when not initialized', () => {
			expect(service.isHealthy()).toBe(false);
		});

		it('should return null for getMonque when not initialized', () => {
			expect(service.getMonque()).toBeNull();
		});
	});

	describe('after setMonque is called', () => {
		beforeEach(() => {
			service.setMonque(mockMonque);
		});

		it('should return the monque instance from getMonque', () => {
			expect(service.getMonque()).toBe(mockMonque);
		});

		it('should delegate enqueue to underlying Monque', async () => {
			const data = { userId: '123' };
			await service.enqueue('test-job', data, { uniqueKey: 'key' });

			expect(mockMonque.enqueue).toHaveBeenCalledWith('test-job', data, { uniqueKey: 'key' });
		});

		it('should delegate now to underlying Monque', async () => {
			const data = { userId: '123' };
			await service.now('test-job', data);

			expect(mockMonque.now).toHaveBeenCalledWith('test-job', data);
		});

		it('should delegate schedule to underlying Monque', async () => {
			const data = { report: 'daily' };
			await service.schedule('0 9 * * *', 'daily-report', data, { uniqueKey: 'report' });

			expect(mockMonque.schedule).toHaveBeenCalledWith('0 9 * * *', 'daily-report', data, {
				uniqueKey: 'report',
			});
		});

		it('should delegate start to underlying Monque', () => {
			service.start();
			expect(mockMonque.start).toHaveBeenCalled();
		});

		it('should delegate stop to underlying Monque', async () => {
			await service.stop();
			expect(mockMonque.stop).toHaveBeenCalled();
		});

		it('should delegate isHealthy to underlying Monque', () => {
			vi.mocked(mockMonque.isHealthy).mockReturnValue(true);
			expect(service.isHealthy()).toBe(true);

			vi.mocked(mockMonque.isHealthy).mockReturnValue(false);
			expect(service.isHealthy()).toBe(false);
		});
	});

	describe('worker with runInContext', () => {
		beforeEach(() => {
			service.setMonque(mockMonque);
		});

		it('should wrap handler and call underlying worker', () => {
			const handler = vi.fn();
			const options = { concurrency: 2 };

			service.worker('test-job', handler, options);

			expect(mockMonque.worker).toHaveBeenCalledWith('test-job', expect.any(Function), options);
		});

		it('should invoke handler when wrapped handler is called', async () => {
			const handler = vi.fn().mockResolvedValue(undefined);
			service.worker('test-job', handler);

			// Get the wrapped handler that was passed to mockMonque.worker
			const workerCalls = vi.mocked(mockMonque.worker).mock.calls;
			expect(workerCalls.length).toBeGreaterThan(0);

			const firstCall = workerCalls[0];
			if (!firstCall) throw new Error('No worker calls');
			const wrappedHandler = firstCall[1];

			// Use JobFactory from @monque/core/testing
			const mockJob = JobFactory.build({ name: 'test-job', data: { foo: 'bar' } });
			await wrappedHandler(mockJob);

			// Handler should have been called with the job
			expect(handler).toHaveBeenCalledWith(mockJob);
		});

		it('should propagate errors from handler', async () => {
			const error = new Error('Handler failed');
			const handler = vi.fn().mockRejectedValue(error);
			service.worker('test-job', handler);

			const workerCalls = vi.mocked(mockMonque.worker).mock.calls;
			expect(workerCalls.length).toBeGreaterThan(0);

			const firstCall = workerCalls[0];
			if (!firstCall) throw new Error('No worker calls');
			const wrappedHandler = firstCall[1];

			const mockJob = JobFactory.build({ name: 'test-job' });
			await expect(wrappedHandler(mockJob)).rejects.toThrow('Handler failed');
		});
	});
});
