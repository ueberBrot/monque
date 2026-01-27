/**
 * Unit tests for MonqueService (T022)
 */
import { ObjectId } from 'mongodb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MonqueService } from '@/services';

describe('MonqueService', () => {
	let service: MonqueService;

	beforeEach(() => {
		service = new MonqueService();
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	describe('before initialization', () => {
		it('should throw when accessing monque before initialization', () => {
			expect(() => service.monque).toThrow('MonqueService is not initialized');
		});

		it('should throw when calling enqueue before initialization', async () => {
			await expect(service.enqueue('test', {})).rejects.toThrow('MonqueService is not initialized');
		});

		it('should throw when calling now before initialization', async () => {
			await expect(service.now('test', {})).rejects.toThrow('MonqueService is not initialized');
		});

		it('should throw when calling schedule before initialization', async () => {
			await expect(service.schedule('* * * * *', 'test', {})).rejects.toThrow(
				'MonqueService is not initialized',
			);
		});
	});

	describe('after initialization', () => {
		let mockMonque: {
			enqueue: ReturnType<typeof vi.fn>;
			now: ReturnType<typeof vi.fn>;
			schedule: ReturnType<typeof vi.fn>;
			cancelJob: ReturnType<typeof vi.fn>;
			retryJob: ReturnType<typeof vi.fn>;
			rescheduleJob: ReturnType<typeof vi.fn>;
			deleteJob: ReturnType<typeof vi.fn>;
			cancelJobs: ReturnType<typeof vi.fn>;
			retryJobs: ReturnType<typeof vi.fn>;
			deleteJobs: ReturnType<typeof vi.fn>;
			getJob: ReturnType<typeof vi.fn>;
			getJobs: ReturnType<typeof vi.fn>;
			getJobsWithCursor: ReturnType<typeof vi.fn>;
			getQueueStats: ReturnType<typeof vi.fn>;
			isHealthy: ReturnType<typeof vi.fn>;
		};

		beforeEach(() => {
			mockMonque = {
				enqueue: vi.fn().mockResolvedValue({ _id: 'job-1' }),
				now: vi.fn().mockResolvedValue({ _id: 'job-2' }),
				schedule: vi.fn().mockResolvedValue({ _id: 'job-3' }),
				cancelJob: vi.fn().mockResolvedValue({ _id: 'job-1', status: 'cancelled' }),
				retryJob: vi.fn().mockResolvedValue({ _id: 'job-1', status: 'pending' }),
				rescheduleJob: vi.fn().mockResolvedValue({ _id: 'job-1' }),
				deleteJob: vi.fn().mockResolvedValue(true),
				cancelJobs: vi.fn().mockResolvedValue({ count: 5 }),
				retryJobs: vi.fn().mockResolvedValue({ count: 3 }),
				deleteJobs: vi.fn().mockResolvedValue({ count: 10 }),
				getJob: vi.fn().mockResolvedValue({ _id: 'job-1' }),
				getJobs: vi.fn().mockResolvedValue([{ _id: 'job-1' }]),
				getJobsWithCursor: vi.fn().mockResolvedValue({ data: [], cursor: null }),
				getQueueStats: vi.fn().mockResolvedValue({ pending: 5, completed: 10 }),
				isHealthy: vi.fn().mockReturnValue(true),
			};

			// Use internal method to set the monque instance
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			(service as unknown as { _setMonque: (m: unknown) => void })._setMonque(mockMonque);
		});

		it('should return monque instance', () => {
			expect(service.monque).toBe(mockMonque);
		});

		describe('job scheduling', () => {
			it('should delegate enqueue to monque', async () => {
				const result = await service.enqueue('test', { data: 'value' }, { runAt: new Date() });

				expect(mockMonque.enqueue).toHaveBeenCalledWith(
					'test',
					{ data: 'value' },
					{ runAt: expect.any(Date) },
				);
				expect(result).toEqual({ _id: 'job-1' });
			});

			it('should delegate now to monque', async () => {
				const result = await service.now('test', { data: 'value' });

				expect(mockMonque.now).toHaveBeenCalledWith('test', { data: 'value' });
				expect(result).toEqual({ _id: 'job-2' });
			});

			it('should delegate schedule to monque', async () => {
				const result = await service.schedule('0 9 * * *', 'daily', { report: true });

				expect(mockMonque.schedule).toHaveBeenCalledWith(
					'0 9 * * *',
					'daily',
					{ report: true },
					undefined,
				);
				expect(result).toEqual({ _id: 'job-3' });
			});
		});

		describe('single job management', () => {
			it('should delegate cancelJob to monque', async () => {
				await service.cancelJob('job-1');
				expect(mockMonque.cancelJob).toHaveBeenCalledWith('job-1');
			});

			it('should delegate retryJob to monque', async () => {
				await service.retryJob('job-1');
				expect(mockMonque.retryJob).toHaveBeenCalledWith('job-1');
			});

			it('should delegate rescheduleJob to monque', async () => {
				const newDate = new Date();
				await service.rescheduleJob('job-1', newDate);
				expect(mockMonque.rescheduleJob).toHaveBeenCalledWith('job-1', newDate);
			});

			it('should delegate deleteJob to monque', async () => {
				await service.deleteJob('job-1');
				expect(mockMonque.deleteJob).toHaveBeenCalledWith('job-1');
			});
		});

		describe('bulk operations', () => {
			it('should delegate cancelJobs to monque', async () => {
				const filter = { name: 'test' };
				await service.cancelJobs(filter);
				expect(mockMonque.cancelJobs).toHaveBeenCalledWith(filter);
			});

			it('should delegate retryJobs to monque', async () => {
				const filter = { status: 'failed' } as const;
				await service.retryJobs(filter);
				expect(mockMonque.retryJobs).toHaveBeenCalledWith(filter);
			});

			it('should delegate deleteJobs to monque', async () => {
				const filter = { name: 'old' };
				await service.deleteJobs(filter);
				expect(mockMonque.deleteJobs).toHaveBeenCalledWith(filter);
			});
		});

		describe('job queries', () => {
			it('should delegate getJob to monque', async () => {
				const validObjectId = '507f1f77bcf86cd799439011';
				await service.getJob(validObjectId);
				expect(mockMonque.getJob).toHaveBeenCalledWith(expect.anything());
			});

			it('should delegate getJob to monque with ObjectId', async () => {
				const id = new ObjectId('507f1f77bcf86cd799439011');
				await service.getJob(id);
				expect(mockMonque.getJob).toHaveBeenCalledWith(id);
			});

			it('should throw MonqueError when calling getJob with invalid hex string', async () => {
				await expect(service.getJob('invalid-hex-string')).rejects.toThrow(
					'Invalid job ID format: invalid-hex-string',
				);
			});

			it('should delegate getJobs to monque', async () => {
				const filter = { limit: 10 };
				await service.getJobs(filter);
				expect(mockMonque.getJobs).toHaveBeenCalledWith(filter);
			});

			it('should delegate getJobsWithCursor to monque', async () => {
				const options = { limit: 20 };
				await service.getJobsWithCursor(options);
				expect(mockMonque.getJobsWithCursor).toHaveBeenCalledWith(options);
			});

			it('should delegate getQueueStats to monque', async () => {
				await service.getQueueStats({ name: 'email' });
				expect(mockMonque.getQueueStats).toHaveBeenCalledWith({ name: 'email' });
			});
		});

		describe('health check', () => {
			it('should delegate isHealthy to monque', () => {
				const result = service.isHealthy();
				expect(mockMonque.isHealthy).toHaveBeenCalled();
				expect(result).toBe(true);
			});
		});
	});
});
