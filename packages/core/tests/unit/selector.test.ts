import { describe, expect, it } from 'vitest';

import type { JobStatusType } from '@/jobs';
import { JobStatus } from '@/jobs';
import { buildSelectorQuery } from '@/scheduler';

describe('selector query builder', () => {
	describe('buildSelectorQuery', () => {
		it('should returns empty object for empty filter', () => {
			const query = buildSelectorQuery({});
			expect(query).toEqual({});
		});

		it('should filter by name', () => {
			const query = buildSelectorQuery({ name: 'test-job' });
			expect(query).toEqual({ name: 'test-job' });
		});

		it('should filter by single status', () => {
			const query = buildSelectorQuery({ status: JobStatus.FAILED });
			expect(query).toEqual({ status: 'failed' });
		});

		it('should filter by multiple statuses using $in', () => {
			const statuses: JobStatusType[] = [JobStatus.FAILED, JobStatus.CANCELLED];
			const query = buildSelectorQuery({ status: statuses });
			expect(query).toEqual({ status: { $in: ['failed', 'cancelled'] } });
		});

		it('should filter by olderThan date', () => {
			const date = new Date('2023-01-01');
			const query = buildSelectorQuery({ olderThan: date });
			expect(query).toEqual({ createdAt: { $lt: date } });
		});

		it('should filter by newerThan date', () => {
			const date = new Date('2023-01-01');
			const query = buildSelectorQuery({ newerThan: date });
			expect(query).toEqual({ createdAt: { $gt: date } });
		});

		it('should combine multiple filters', () => {
			const date = new Date('2023-01-01');
			const query = buildSelectorQuery({
				name: 'cleanup',
				status: JobStatus.COMPLETED,
				olderThan: date,
			});

			expect(query).toEqual({
				name: 'cleanup',
				status: 'completed',
				createdAt: { $lt: date },
			});
		});

		it('should combine olderThan and newerThan', () => {
			const start = new Date('2023-01-01');
			const end = new Date('2023-01-31');
			const query = buildSelectorQuery({
				newerThan: start,
				olderThan: end,
			});

			expect(query['createdAt']).toEqual({
				$gt: start,
				$lt: end,
			});
		});
	});
});
