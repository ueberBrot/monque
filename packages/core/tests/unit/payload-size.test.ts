import { BSON, ObjectId } from 'mongodb';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createMockContext } from '@tests/factories';
import { JobIntake } from '@/scheduler/services/job-intake.js';
import { PayloadTooLargeError } from '@/shared';

// vi.mock hoisted to top of file - mock the mongodb module so we can control BSON.calculateObjectSize.
// We wrap calculateObjectSize in a vi.fn so tests can temporarily override it with mockImplementationOnce.
// The real function is captured inside importOriginal to avoid circular reference from the mock itself.
var _realCalculateObjectSize: typeof import('mongodb').BSON.calculateObjectSize;
vi.mock('mongodb', async (importOriginal) => {
	const actual = await importOriginal<typeof import('mongodb')>();
	_realCalculateObjectSize = actual.BSON.calculateObjectSize;
	return {
		...actual,
		BSON: {
			...actual.BSON,
			calculateObjectSize: vi.fn((...args: Parameters<typeof actual.BSON.calculateObjectSize>) =>
				_realCalculateObjectSize(...args),
			),
		},
	};
});

describe('payload size validation', () => {
	afterEach(() => {
		vi.mocked(BSON.calculateObjectSize).mockClear();
	});

	it('rejects payload exceeding maxPayloadSize on enqueue', async () => {
		const ctx = createMockContext();
		ctx.options.maxPayloadSize = 100;
		const intake = new JobIntake(ctx);

		// Large data that will exceed 100 bytes in BSON
		const largeData = { content: 'x'.repeat(200) };

		await expect(intake.enqueue('test-job', largeData)).rejects.toThrow(PayloadTooLargeError);

		const error = await intake.enqueue('test-job', largeData).catch((e: unknown) => e);
		expect(error).toBeInstanceOf(PayloadTooLargeError);
		expect((error as PayloadTooLargeError).actualSize).toBeGreaterThan(100);
		expect((error as PayloadTooLargeError).maxSize).toBe(100);
	});

	it('allows payload within maxPayloadSize on enqueue', async () => {
		const ctx = createMockContext();
		ctx.options.maxPayloadSize = 10_000;
		const intake = new JobIntake(ctx);

		const insertedId = new ObjectId();
		vi.spyOn(ctx.mockCollection, 'insertOne').mockResolvedValueOnce({
			insertedId,
			acknowledged: true,
		});

		const result = await intake.enqueue('test-job', { small: 'data' });
		expect(result._id).toEqual(insertedId);
	});

	it('allows payload exactly equal to maxPayloadSize on enqueue', async () => {
		const ctx = createMockContext();
		const intake = new JobIntake(ctx);

		const testData = { key: 'value' };
		// Mirror what validatePayloadSize computes: BSON.calculateObjectSize({ data })
		const exactSize = BSON.calculateObjectSize({ data: testData });
		ctx.options.maxPayloadSize = exactSize;

		const insertedId = new ObjectId();
		vi.spyOn(ctx.mockCollection, 'insertOne').mockResolvedValueOnce({
			insertedId,
			acknowledged: true,
		});

		const result = await intake.enqueue('test-job', testData);
		expect(result._id).toEqual(insertedId);
	});

	it('skips validation when maxPayloadSize is undefined', async () => {
		const ctx = createMockContext();
		// maxPayloadSize is undefined by default
		expect(ctx.options.maxPayloadSize).toBeUndefined();
		const intake = new JobIntake(ctx);

		const insertedId = new ObjectId();
		vi.spyOn(ctx.mockCollection, 'insertOne').mockResolvedValueOnce({
			insertedId,
			acknowledged: true,
		});

		// Even large data should be accepted when maxPayloadSize is undefined
		const largeData = { content: 'x'.repeat(10_000) };
		const result = await intake.enqueue('test-job', largeData);
		expect(result._id).toEqual(insertedId);
	});

	it('rejects payload exceeding maxPayloadSize on schedule', async () => {
		const ctx = createMockContext();
		ctx.options.maxPayloadSize = 100;
		const intake = new JobIntake(ctx);

		const largeData = { content: 'x'.repeat(200) };

		await expect(intake.schedule('0 * * * *', 'test-job', largeData)).rejects.toThrow(
			PayloadTooLargeError,
		);
	});

	it('wraps BSON calculation errors in PayloadTooLargeError', async () => {
		const ctx = createMockContext();
		ctx.options.maxPayloadSize = 1000;
		const intake = new JobIntake(ctx);

		const bsonError = new Error('Cannot serialize circular structure');
		vi.mocked(BSON.calculateObjectSize).mockImplementationOnce(() => {
			throw bsonError;
		});

		const error = await intake.enqueue('test-job', { x: 1 }).catch((e: unknown) => e);

		expect(error).toBeInstanceOf(PayloadTooLargeError);
		expect((error as PayloadTooLargeError).actualSize).toBe(-1);
		expect((error as PayloadTooLargeError).maxSize).toBe(1000);
		expect((error as PayloadTooLargeError).message).toMatch(/Failed to calculate job payload size/);
		expect((error as PayloadTooLargeError).cause).toBe(bsonError);
	});

	it('wraps non-Error BSON throws in a normalized cause', async () => {
		const ctx = createMockContext();
		ctx.options.maxPayloadSize = 1000;
		const intake = new JobIntake(ctx);

		vi.mocked(BSON.calculateObjectSize).mockImplementationOnce(() => {
			throw 'unexpected string thrown'; // eslint-disable-line no-throw-literal
		});

		const error = await intake.enqueue('test-job', { x: 1 }).catch((e: unknown) => e);

		expect(error).toBeInstanceOf(PayloadTooLargeError);
		expect((error as PayloadTooLargeError).cause).toBeInstanceOf(Error);
		expect(((error as PayloadTooLargeError).cause as Error).message).toBe(
			'unexpected string thrown',
		);
	});
});
