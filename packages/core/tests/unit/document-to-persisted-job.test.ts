import type { Document, WithId } from 'mongodb';
import { describe, expect, it } from 'vitest';

import { JobFactory, JobFactoryHelpers } from '@tests/factories';
import { documentToPersistedJob } from '@/jobs';

/**
 * Round-trip test for documentToPersistedJob.
 *
 * Guards against silent field-dropping when new fields are added to the Job interface.
 * If a field is added to Job/PersistedJob but not mapped in documentToPersistedJob,
 * the full-document round-trip test will fail.
 */
describe('documentToPersistedJob', () => {
	describe('round-trip: PersistedJob -> Document -> PersistedJob', () => {
		it('should preserve all required fields', () => {
			const original = JobFactory.build();
			const doc = original as unknown as WithId<Document>;

			const result = documentToPersistedJob<unknown>(doc);

			expect(result._id).toEqual(original._id);
			expect(result.name).toBe(original.name);
			expect(result.data).toEqual(original.data);
			expect(result.status).toBe(original.status);
			expect(result.nextRunAt).toEqual(original.nextRunAt);
			expect(result.failCount).toBe(original.failCount);
			expect(result.createdAt).toEqual(original.createdAt);
			expect(result.updatedAt).toEqual(original.updatedAt);
		});

		it('should preserve all fields for a full processing job', () => {
			const original = JobFactoryHelpers.processing({
				heartbeatInterval: 5000,
				failCount: 2,
				failReason: 'Connection timeout',
				repeatInterval: '*/5 * * * *',
				uniqueKey: 'email-test@example.com',
			});

			const doc = original as unknown as WithId<Document>;
			const result = documentToPersistedJob<unknown>(doc);

			expect(result).toEqual(original);
		});

		it('should preserve all fields from factory failed helper', () => {
			const original = JobFactoryHelpers.failed({
				uniqueKey: 'failed-dedup',
				repeatInterval: '* * * * *',
			});

			const doc = original as unknown as WithId<Document>;
			const result = documentToPersistedJob<unknown>(doc);

			expect(result).toEqual(original);
		});
	});

	describe('nullable field handling', () => {
		it('should preserve null values for nullable fields', () => {
			const original = JobFactory.build({
				lockedAt: null,
				claimedBy: null,
				lastHeartbeat: null,
			});

			const doc = original as unknown as WithId<Document>;
			const result = documentToPersistedJob<unknown>(doc);

			expect(result.lockedAt).toBeNull();
			expect(result.claimedBy).toBeNull();
			expect(result.lastHeartbeat).toBeNull();
		});
	});

	describe('optional field omission', () => {
		it('should not include optional fields that are absent from the document', () => {
			const original = JobFactory.build();
			const doc = original as unknown as WithId<Document>;

			const result = documentToPersistedJob<unknown>(doc);

			expect('lockedAt' in result).toBe(false);
			expect('claimedBy' in result).toBe(false);
			expect('lastHeartbeat' in result).toBe(false);
			expect('heartbeatInterval' in result).toBe(false);
			expect('failReason' in result).toBe(false);
			expect('repeatInterval' in result).toBe(false);
			expect('uniqueKey' in result).toBe(false);
		});
	});

	describe('data type preservation', () => {
		it('should preserve typed data payload', () => {
			type OrderData = {
				orderId: string;
				items: string[];
				total: number;
			};

			const data: OrderData = {
				orderId: 'order-123',
				items: ['item-a', 'item-b'],
				total: 99.99,
			};

			const original = JobFactoryHelpers.withData(data);
			const doc = original as unknown as WithId<Document>;
			const result = documentToPersistedJob<OrderData>(doc);

			expect(result.data).toEqual(data);
			expect(result.data.orderId).toBe('order-123');
			expect(result.data.items).toEqual(['item-a', 'item-b']);
			expect(result.data.total).toBe(99.99);
		});
	});
});
