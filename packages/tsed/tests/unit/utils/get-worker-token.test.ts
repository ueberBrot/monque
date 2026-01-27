import { describe, expect, it } from 'vitest';

import { getWorkerToken } from '@/utils/get-worker-token';

describe('getWorkerToken', () => {
	it('should return a unique symbol based on class name', () => {
		class TestWorker {}
		const token = getWorkerToken(TestWorker);

		expect(typeof token).toBe('symbol');
		expect(token.toString()).toBe('Symbol(monque:worker:TestWorker)');
	});

	it('should throw an error for anonymous classes', () => {
		expect(() => getWorkerToken(class {})).toThrow('Worker class must have a non-empty name');
	});
});
