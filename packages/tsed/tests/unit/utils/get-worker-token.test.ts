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

	it('should return the same symbol for the same class', () => {
		class SameWorker {}
		const token1 = getWorkerToken(SameWorker);
		const token2 = getWorkerToken(SameWorker);

		expect(token1).toBe(token2);
	});

	it('should return the same symbol for different classes with the same name', () => {
		const createClass = () => {
			// Using eval to create classes with the same name in different scopes
			return class MyWorker {};
		};
		const Class1 = createClass();
		const Class2 = createClass();

		expect(getWorkerToken(Class1)).toBe(getWorkerToken(Class2));
	});
});
