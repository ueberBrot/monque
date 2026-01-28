import { describe, expect, it } from 'vitest';

import { getJobToken } from '@/utils/get-job-token';

describe('getJobToken', () => {
	it('should return a unique symbol based on class name', () => {
		class TestJob {}
		const token = getJobToken(TestJob);

		expect(typeof token).toBe('symbol');
		expect(token.toString()).toBe('Symbol(monque:job:TestJob)');
	});

	it('should throw an error for anonymous classes', () => {
		expect(() => getJobToken(class {})).toThrow('Job class must have a non-empty name');
	});

	it('should return the same symbol for the same class', () => {
		class SameJob {}
		const token1 = getJobToken(SameJob);
		const token2 = getJobToken(SameJob);

		expect(token1).toBe(token2);
	});

	it('should return the same symbol for different classes with the same name', () => {
		const createClass = () => {
			return class MyJob {};
		};
		const Class1 = createClass();
		const Class2 = createClass();

		expect(getJobToken(Class1)).toBe(getJobToken(Class2));
	});
});
