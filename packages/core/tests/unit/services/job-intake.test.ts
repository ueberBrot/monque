import { ObjectId } from 'mongodb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createMockContext, JobFactory } from '@tests/factories';
import { JobStatus } from '@/jobs';
import { JobIntake } from '@/scheduler/services/job-intake';
import { ConnectionError, InvalidCronError, InvalidJobIdentifierError } from '@/shared';

describe('JobIntake', () => {
	let ctx: ReturnType<typeof createMockContext>;
	let intake: JobIntake;

	beforeEach(() => {
		ctx = createMockContext();
		intake = new JobIntake(ctx);
	});

	afterEach(() => {
		vi.clearAllMocks();
	});

	it('rejects invalid job names before hitting MongoDB', async () => {
		await expect(intake.enqueue('invalid job name', { value: 42 })).rejects.toThrow(
			InvalidJobIdentifierError,
		);
		expect(ctx.mockCollection.insertOne).not.toHaveBeenCalled();
		expect(ctx.mockCollection.findOneAndUpdate).not.toHaveBeenCalled();
	});

	it('rejects invalid unique keys before hitting MongoDB', async () => {
		await expect(intake.enqueue('valid-job', { value: 42 }, { uniqueKey: '   ' })).rejects.toThrow(
			InvalidJobIdentifierError,
		);
		expect(ctx.mockCollection.insertOne).not.toHaveBeenCalled();
		expect(ctx.mockCollection.findOneAndUpdate).not.toHaveBeenCalled();
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

	it('uses runAt option for delayed execution', async () => {
		const insertedId = new ObjectId();
		const runAt = new Date(Date.now() + 3600000);

		vi.spyOn(ctx.mockCollection, 'insertOne').mockResolvedValueOnce({
			insertedId,
			acknowledged: true,
		});

		const job = await intake.enqueue('delayed-job', { x: 1 }, { runAt });
		const insertCall = (ctx.mockCollection.insertOne as ReturnType<typeof vi.fn>).mock.calls[0];
		const insertedDoc = insertCall?.[0] as Record<string, unknown>;

		expect(insertedDoc['nextRunAt']).toEqual(runAt);
		expect(job.nextRunAt).toEqual(runAt);
	});

	it('omits uniqueKey when not provided', async () => {
		const insertedId = new ObjectId();
		vi.spyOn(ctx.mockCollection, 'insertOne').mockResolvedValueOnce({
			insertedId,
			acknowledged: true,
		});

		await intake.enqueue('job', { x: 1 });
		const insertCall = (ctx.mockCollection.insertOne as ReturnType<typeof vi.fn>).mock.calls[0];
		const insertedDoc = insertCall?.[0] as Record<string, unknown>;

		expect(insertedDoc['uniqueKey']).toBeUndefined();
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

	it('throws ConnectionError when enqueue insert fails', async () => {
		vi.spyOn(ctx.mockCollection, 'insertOne').mockRejectedValueOnce(
			new Error('Database connection lost'),
		);

		await expect(intake.enqueue('failing-job', {})).rejects.toThrow(ConnectionError);
		await expect(intake.enqueue('failing-job', {})).rejects.toThrow(/Failed to enqueue job/);
	});

	it('throws ConnectionError when unique enqueue returns no document', async () => {
		vi.spyOn(ctx.mockCollection, 'findOneAndUpdate').mockResolvedValueOnce(null);

		await expect(intake.enqueue('unique-job', {}, { uniqueKey: 'key' })).rejects.toThrow(
			ConnectionError,
		);
	});

	it('enqueues an immediate job', async () => {
		const insertedId = new ObjectId();
		const beforeCall = new Date();

		vi.spyOn(ctx.mockCollection, 'insertOne').mockResolvedValueOnce({
			insertedId,
			acknowledged: true,
		});

		const job = await intake.now('immediate-job', { urgent: true });
		const afterCall = new Date();

		expect(job._id).toEqual(insertedId);
		expect(job.nextRunAt.getTime()).toBeGreaterThanOrEqual(beforeCall.getTime());
		expect(job.nextRunAt.getTime()).toBeLessThanOrEqual(afterCall.getTime());
	});

	it('rejects invalid scheduled job names before parsing cron', async () => {
		await expect(intake.schedule('not-a-cron', 'bad name', {})).rejects.toThrow(
			InvalidJobIdentifierError,
		);
		expect(ctx.mockCollection.insertOne).not.toHaveBeenCalled();
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

	it('throws InvalidCronError for invalid cron expression', async () => {
		await expect(intake.schedule('invalid cron', 'bad-job', {})).rejects.toThrow(InvalidCronError);
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

	it('supports predefined cron expressions like @daily', async () => {
		const insertedId = new ObjectId();

		vi.spyOn(ctx.mockCollection, 'insertOne').mockResolvedValueOnce({
			insertedId,
			acknowledged: true,
		});

		const job = await intake.schedule('@daily', 'daily-job', {});

		expect(job.repeatInterval).toBe('@daily');
	});

	it('throws ConnectionError when unique schedule returns no document', async () => {
		vi.spyOn(ctx.mockCollection, 'findOneAndUpdate').mockResolvedValueOnce(null);

		await expect(
			intake.schedule('0 * * * *', 'unique-schedule', {}, { uniqueKey: 'key' }),
		).rejects.toThrow(ConnectionError);
		await expect(
			intake.schedule('0 * * * *', 'unique-schedule', {}, { uniqueKey: 'key' }),
		).rejects.toThrow(/findOneAndUpdate returned no document/);
	});

	it('throws ConnectionError when schedule insert fails', async () => {
		vi.spyOn(ctx.mockCollection, 'insertOne').mockRejectedValueOnce(
			new Error('Database write failed'),
		);

		await expect(intake.schedule('0 * * * *', 'failing-schedule', {})).rejects.toThrow(
			ConnectionError,
		);
		await expect(intake.schedule('0 * * * *', 'failing-schedule', {})).rejects.toThrow(
			/Failed to schedule job/,
		);
	});
});
