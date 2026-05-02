import { ObjectId } from 'mongodb';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createMockContext, JobFactory } from '@tests/factories';
import { JobStatus } from '@/jobs';
import { JobIntake } from '@/scheduler/services/job-intake';

describe('JobIntake', () => {
	let ctx: ReturnType<typeof createMockContext>;
	let intake: JobIntake;

	beforeEach(() => {
		ctx = createMockContext();
		intake = new JobIntake(ctx);
	});

	it('enqueues a pending job and notifies the scheduler', async () => {
		const insertedId = new ObjectId();
		vi.spyOn(ctx.mockCollection, 'insertOne').mockResolvedValueOnce({
			insertedId,
			acknowledged: true,
		});

		const job = await intake.enqueue('send-email', { to: 'user@example.com' });

		expect(job).toMatchObject({
			_id: insertedId,
			name: 'send-email',
			data: { to: 'user@example.com' },
			status: JobStatus.PENDING,
			failCount: 0,
		});
		expect(job.createdAt).toBeInstanceOf(Date);
		expect(job.updatedAt).toBeInstanceOf(Date);
		expect(job.nextRunAt).toBeInstanceOf(Date);
		expect(ctx.notifyPendingJob).toHaveBeenCalledWith('send-email', job.nextRunAt);
	});

	it('returns the existing pending job for duplicate unique intake', async () => {
		const existingJob = JobFactory.build({
			name: 'sync-user',
			uniqueKey: 'user-123',
			data: { userId: 'user-123' },
		});
		vi.spyOn(ctx.mockCollection, 'findOneAndUpdate').mockResolvedValueOnce(existingJob);

		const job = await intake.enqueue('sync-user', { userId: 'ignored' }, { uniqueKey: 'user-123' });

		expect(job._id).toEqual(existingJob._id);
		expect(job.data).toEqual(existingJob.data);
		expect(ctx.notifyPendingJob).toHaveBeenCalledWith('sync-user', existingJob.nextRunAt);
	});

	it('returns the existing processing job for duplicate unique intake', async () => {
		const existingJob = JobFactory.build({
			name: 'sync-user',
			uniqueKey: 'user-123',
			data: { userId: 'user-123' },
			status: JobStatus.PROCESSING,
		});
		vi.spyOn(ctx.mockCollection, 'findOneAndUpdate').mockResolvedValueOnce(existingJob);

		const job = await intake.enqueue('sync-user', { userId: 'ignored' }, { uniqueKey: 'user-123' });

		expect(job._id).toEqual(existingJob._id);
		expect(job.data).toEqual(existingJob.data);
		expect(ctx.notifyPendingJob).not.toHaveBeenCalled();
	});

	it('schedules a pending recurring job', async () => {
		const insertedId = new ObjectId();
		vi.spyOn(ctx.mockCollection, 'insertOne').mockResolvedValueOnce({
			insertedId,
			acknowledged: true,
		});

		const job = await intake.schedule('0 * * * *', 'hourly-report', { report: 'sales' });

		expect(job).toMatchObject({
			_id: insertedId,
			name: 'hourly-report',
			data: { report: 'sales' },
			status: JobStatus.PENDING,
			repeatInterval: '0 * * * *',
			failCount: 0,
		});
		expect(job.nextRunAt).toBeInstanceOf(Date);
		expect(ctx.notifyPendingJob).toHaveBeenCalledWith('hourly-report', job.nextRunAt);
	});

	it('returns the existing pending recurring job for duplicate unique schedule intake', async () => {
		const existingJob = JobFactory.build({
			name: 'daily-report',
			uniqueKey: 'sales-report',
			repeatInterval: '0 0 * * *',
			data: { report: 'sales' },
		});
		vi.spyOn(ctx.mockCollection, 'findOneAndUpdate').mockResolvedValueOnce(existingJob);

		const job = await intake.schedule(
			'0 0 * * *',
			'daily-report',
			{ report: 'ignored' },
			{ uniqueKey: 'sales-report' },
		);

		expect(job._id).toEqual(existingJob._id);
		expect(job.data).toEqual(existingJob.data);
		expect(job.repeatInterval).toBe('0 0 * * *');
		expect(ctx.notifyPendingJob).toHaveBeenCalledWith('daily-report', existingJob.nextRunAt);
	});

	it('returns the existing processing recurring job for duplicate unique schedule intake', async () => {
		const existingJob = JobFactory.build({
			name: 'daily-report',
			uniqueKey: 'sales-report',
			repeatInterval: '0 0 * * *',
			data: { report: 'sales' },
			status: JobStatus.PROCESSING,
		});
		vi.spyOn(ctx.mockCollection, 'findOneAndUpdate').mockResolvedValueOnce(existingJob);

		const job = await intake.schedule(
			'0 0 * * *',
			'daily-report',
			{ report: 'ignored' },
			{ uniqueKey: 'sales-report' },
		);

		expect(job._id).toEqual(existingJob._id);
		expect(job.data).toEqual(existingJob.data);
		expect(job.repeatInterval).toBe('0 0 * * *');
		expect(ctx.notifyPendingJob).not.toHaveBeenCalled();
	});
});
