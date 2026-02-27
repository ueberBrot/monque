import { ObjectId } from 'mongodb';
import { describe, expect, it, vi } from 'vitest';

import { createMockContext } from '@tests/factories';
import { JobScheduler } from '@/scheduler/services/job-scheduler.js';
import { PayloadTooLargeError } from '@/shared';

describe('payload size validation', () => {
	it('rejects payload exceeding maxPayloadSize on enqueue', async () => {
		const ctx = createMockContext();
		ctx.options.maxPayloadSize = 100;
		const scheduler = new JobScheduler(ctx);

		// Large data that will exceed 100 bytes in BSON
		const largeData = { content: 'x'.repeat(200) };

		await expect(scheduler.enqueue('test-job', largeData)).rejects.toThrow(PayloadTooLargeError);

		const error = await scheduler.enqueue('test-job', largeData).catch((e: unknown) => e);
		expect(error).toBeInstanceOf(PayloadTooLargeError);
		expect((error as PayloadTooLargeError).actualSize).toBeGreaterThan(100);
		expect((error as PayloadTooLargeError).maxSize).toBe(100);
	});

	it('allows payload within maxPayloadSize on enqueue', async () => {
		const ctx = createMockContext();
		ctx.options.maxPayloadSize = 10_000;
		const scheduler = new JobScheduler(ctx);

		const insertedId = new ObjectId();
		vi.spyOn(ctx.mockCollection, 'insertOne').mockResolvedValueOnce({
			insertedId,
			acknowledged: true,
		});

		const result = await scheduler.enqueue('test-job', { small: 'data' });
		expect(result._id).toEqual(insertedId);
	});

	it('skips validation when maxPayloadSize is undefined', async () => {
		const ctx = createMockContext();
		// maxPayloadSize is undefined by default
		expect(ctx.options.maxPayloadSize).toBeUndefined();
		const scheduler = new JobScheduler(ctx);

		const insertedId = new ObjectId();
		vi.spyOn(ctx.mockCollection, 'insertOne').mockResolvedValueOnce({
			insertedId,
			acknowledged: true,
		});

		// Even large data should be accepted when maxPayloadSize is undefined
		const largeData = { content: 'x'.repeat(10_000) };
		const result = await scheduler.enqueue('test-job', largeData);
		expect(result._id).toEqual(insertedId);
	});

	it('rejects payload exceeding maxPayloadSize on schedule', async () => {
		const ctx = createMockContext();
		ctx.options.maxPayloadSize = 100;
		const scheduler = new JobScheduler(ctx);

		const largeData = { content: 'x'.repeat(200) };

		await expect(scheduler.schedule('0 * * * *', 'test-job', largeData)).rejects.toThrow(
			PayloadTooLargeError,
		);
	});
});
