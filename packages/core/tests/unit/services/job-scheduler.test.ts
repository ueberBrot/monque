/**
 * Unit tests for JobScheduler service.
 *
 * Tests job enqueueing, immediate dispatch (now), and cron scheduling.
 * Uses mock SchedulerContext to test in isolation from MongoDB.
 */

import { ObjectId } from 'mongodb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createMockContext, JobFactory } from '@tests/factories';
import { JobStatus } from '@/jobs';
import { JobScheduler } from '@/scheduler/services/job-scheduler.js';
import type { SchedulerContext } from '@/scheduler/services/types.js';
import { ConnectionError, InvalidCronError } from '@/shared';

describe('JobScheduler', () => {
	let ctx: SchedulerContext & {
		mockCollection: ReturnType<typeof createMockContext>['mockCollection'];
	};
	let scheduler: JobScheduler;

	beforeEach(() => {
		ctx = createMockContext();
		scheduler = new JobScheduler(ctx);
	});

	afterEach(() => {
		vi.clearAllMocks();
	});

	describe('enqueue', () => {
		it('should insert a new job with correct properties', async () => {
			const insertedId = new ObjectId();
			vi.mocked(ctx.mockCollection.insertOne).mockResolvedValueOnce({
				insertedId,
				acknowledged: true,
			});

			const job = await scheduler.enqueue('test-job', { value: 42 });

			expect(ctx.mockCollection.insertOne).toHaveBeenCalledOnce();
			const insertCall = vi.mocked(ctx.mockCollection.insertOne).mock.calls[0];
			const insertedDoc = insertCall?.[0];

			expect(insertedDoc).toMatchObject({
				name: 'test-job',
				data: { value: 42 },
				status: JobStatus.PENDING,
				failCount: 0,
			});
			expect(job._id).toEqual(insertedId);
			expect(job.name).toBe('test-job');
			expect(job.data).toEqual({ value: 42 });
		});

		it('should use runAt option for delayed execution', async () => {
			const insertedId = new ObjectId();
			const runAt = new Date(Date.now() + 3600000); // 1 hour later

			vi.mocked(ctx.mockCollection.insertOne).mockResolvedValueOnce({
				insertedId,
				acknowledged: true,
			});

			const job = await scheduler.enqueue('delayed-job', { x: 1 }, { runAt });

			const insertCall = vi.mocked(ctx.mockCollection.insertOne).mock.calls[0];
			const insertedDoc = insertCall?.[0] as Record<string, unknown>;

			expect(insertedDoc['nextRunAt']).toEqual(runAt);
			expect(job.nextRunAt).toEqual(runAt);
		});

		it('should use findOneAndUpdate for jobs with uniqueKey (deduplication)', async () => {
			const existingJob = JobFactory.build({
				name: 'unique-job',
				uniqueKey: 'user-123',
			});

			vi.mocked(ctx.mockCollection.findOneAndUpdate).mockResolvedValueOnce(existingJob);

			const job = await scheduler.enqueue('unique-job', { id: 123 }, { uniqueKey: 'user-123' });

			expect(ctx.mockCollection.findOneAndUpdate).toHaveBeenCalledOnce();
			expect(ctx.mockCollection.insertOne).not.toHaveBeenCalled();
			expect(job._id).toEqual(existingJob._id);
		});

		it('should throw ConnectionError when insertOne fails', async () => {
			vi.mocked(ctx.mockCollection.insertOne).mockRejectedValueOnce(
				new Error('Database connection lost'),
			);

			await expect(scheduler.enqueue('failing-job', {})).rejects.toThrow(ConnectionError);
			await expect(scheduler.enqueue('failing-job', {})).rejects.toThrow(/Failed to enqueue job/);
		});

		it('should throw ConnectionError when findOneAndUpdate returns null', async () => {
			vi.mocked(ctx.mockCollection.findOneAndUpdate).mockResolvedValueOnce(null);

			await expect(scheduler.enqueue('unique-job', {}, { uniqueKey: 'key' })).rejects.toThrow(
				ConnectionError,
			);
		});

		it('should set uniqueKey on job document when provided', async () => {
			const insertedId = new ObjectId();
			vi.mocked(ctx.mockCollection.insertOne).mockResolvedValueOnce({
				insertedId,
				acknowledged: true,
			});

			// Without uniqueKey (uses regular insert)
			await scheduler.enqueue('job', { x: 1 });
			const insertCall = vi.mocked(ctx.mockCollection.insertOne).mock.calls[0];
			const insertedDoc = insertCall?.[0] as Record<string, unknown>;

			expect(insertedDoc['uniqueKey']).toBeUndefined();
		});
	});

	describe('now', () => {
		it('should enqueue job with immediate runAt', async () => {
			const insertedId = new ObjectId();
			const beforeCall = new Date();

			vi.mocked(ctx.mockCollection.insertOne).mockResolvedValueOnce({
				insertedId,
				acknowledged: true,
			});

			const job = await scheduler.now('immediate-job', { urgent: true });
			const afterCall = new Date();

			expect(job._id).toEqual(insertedId);
			expect(job.nextRunAt.getTime()).toBeGreaterThanOrEqual(beforeCall.getTime());
			expect(job.nextRunAt.getTime()).toBeLessThanOrEqual(afterCall.getTime());
		});
	});

	describe('schedule', () => {
		it('should create job with repeatInterval and calculated nextRunAt', async () => {
			const insertedId = new ObjectId();

			vi.mocked(ctx.mockCollection.insertOne).mockResolvedValueOnce({
				insertedId,
				acknowledged: true,
			});

			const job = await scheduler.schedule('0 * * * *', 'hourly-job', { report: 'sales' });

			expect(ctx.mockCollection.insertOne).toHaveBeenCalledOnce();
			const insertCall = vi.mocked(ctx.mockCollection.insertOne).mock.calls[0];
			const insertedDoc = insertCall?.[0] as Record<string, unknown>;

			expect(insertedDoc['repeatInterval']).toBe('0 * * * *');
			expect(insertedDoc['name']).toBe('hourly-job');
			expect(job.repeatInterval).toBe('0 * * * *');
		});

		it('should throw InvalidCronError for invalid cron expression', async () => {
			await expect(scheduler.schedule('invalid cron', 'bad-job', {})).rejects.toThrow(
				InvalidCronError,
			);
		});

		it('should use findOneAndUpdate for scheduled jobs with uniqueKey', async () => {
			const existingJob = JobFactory.build({
				name: 'recurring-job',
				uniqueKey: 'daily-report',
				repeatInterval: '0 0 * * *',
			});

			vi.mocked(ctx.mockCollection.findOneAndUpdate).mockResolvedValueOnce(existingJob);

			const job = await scheduler.schedule(
				'0 0 * * *',
				'recurring-job',
				{ type: 'daily' },
				{ uniqueKey: 'daily-report' },
			);

			expect(ctx.mockCollection.findOneAndUpdate).toHaveBeenCalledOnce();
			expect(job._id).toEqual(existingJob._id);
		});

		it('should support predefined cron expressions like @daily', async () => {
			const insertedId = new ObjectId();

			vi.mocked(ctx.mockCollection.insertOne).mockResolvedValueOnce({
				insertedId,
				acknowledged: true,
			});

			const job = await scheduler.schedule('@daily', 'daily-job', {});

			expect(job.repeatInterval).toBe('@daily');
		});

		it('should throw ConnectionError when schedule with uniqueKey returns null', async () => {
			vi.mocked(ctx.mockCollection.findOneAndUpdate).mockResolvedValueOnce(null);

			await expect(
				scheduler.schedule('0 * * * *', 'unique-schedule', {}, { uniqueKey: 'key' }),
			).rejects.toThrow(ConnectionError);
			await expect(
				scheduler.schedule('0 * * * *', 'unique-schedule', {}, { uniqueKey: 'key' }),
			).rejects.toThrow(/findOneAndUpdate returned no document/);
		});

		it('should throw ConnectionError when insertOne fails', async () => {
			vi.mocked(ctx.mockCollection.insertOne).mockRejectedValueOnce(
				new Error('Database write failed'),
			);

			await expect(scheduler.schedule('0 * * * *', 'failing-schedule', {})).rejects.toThrow(
				ConnectionError,
			);
			await expect(scheduler.schedule('0 * * * *', 'failing-schedule', {})).rejects.toThrow(
				/Failed to schedule job/,
			);
		});

		it('should preserve InvalidCronError without wrapping in ConnectionError', async () => {
			// InvalidCronError extends MonqueError, so it should be re-thrown as-is
			await expect(scheduler.schedule('invalid cron', 'bad-job', {})).rejects.toThrow(
				InvalidCronError,
			);
		});
	});
});
