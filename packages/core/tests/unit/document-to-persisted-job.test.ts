import { type Document, ObjectId, type WithId } from 'mongodb';
import { describe, expect, expectTypeOf, it } from 'vitest';

import { JobFactory } from '@tests/factories';
import { documentToPersistedJob, JobStatus } from '@/jobs';

describe('documentToPersistedJob', () => {
	it('preserves required fields and omits absent optional fields', () => {
		const original = JobFactory.build();
		const doc = original as unknown as WithId<Document>;

		expect(documentToPersistedJob(doc)).toStrictEqual(original);
	});

	it('preserves explicit null values for nullable fields', () => {
		const original = JobFactory.build({
			lockedAt: null,
			claimedBy: null,
			lastHeartbeat: null,
		});
		const doc = original as unknown as WithId<Document>;

		expect(documentToPersistedJob(doc)).toStrictEqual(original);
	});

	it('maps every populated field and preserves the generic payload contract', () => {
		type OrderData = { orderId: string; items: string[]; total: number };
		const data: OrderData = { orderId: 'order-123', items: ['item-a', 'item-b'], total: 99.99 };
		const now = new Date();
		const doc: WithId<Document> = {
			_id: new ObjectId(),
			name: 'test-job',
			data,
			status: JobStatus.PROCESSING,
			nextRunAt: now,
			failCount: 3,
			createdAt: now,
			updatedAt: now,
			lockedAt: now,
			claimedBy: 'instance-1',
			lastHeartbeat: now,
			heartbeatInterval: 5000,
			failReason: 'timeout',
			repeatInterval: '0 * * * *',
			uniqueKey: 'dedup-key',
		};

		const result = documentToPersistedJob<OrderData>(doc);

		expectTypeOf(result.data).toEqualTypeOf<OrderData>();
		expect(result).toStrictEqual(doc);
	});
});
