import { describe, expect, it } from 'vitest';

import { toError } from '@/shared';

describe('toError', () => {
	it('should return the same Error instance when given an Error', () => {
		const original = new Error('test error');
		const result = toError(original);

		expect(result).toBe(original);
		expect(result.message).toBe('test error');
	});

	it('should return the same instance for Error subclasses', () => {
		const original = new TypeError('type error');
		const result = toError(original);

		expect(result).toBe(original);
		expect(result).toBeInstanceOf(TypeError);
		expect(result.message).toBe('type error');
	});

	it('should wrap a string into an Error', () => {
		const result = toError('something went wrong');

		expect(result).toBeInstanceOf(Error);
		expect(result.message).toBe('something went wrong');
	});

	it('should wrap a number into an Error', () => {
		const result = toError(42);

		expect(result).toBeInstanceOf(Error);
		expect(result.message).toBe('42');
	});

	it('should wrap undefined into an Error', () => {
		const result = toError(undefined);

		expect(result).toBeInstanceOf(Error);
		expect(result.message).toBe('undefined');
	});

	it('should wrap null into an Error', () => {
		const result = toError(null);

		expect(result).toBeInstanceOf(Error);
		expect(result.message).toBe('null');
	});

	it('should wrap a plain object into an Error', () => {
		const result = toError({ code: 'FAIL' });

		expect(result).toBeInstanceOf(Error);
		expect(result.message).toBe('[object Object]');
	});

	it('should wrap a boolean into an Error', () => {
		const result = toError(false);

		expect(result).toBeInstanceOf(Error);
		expect(result.message).toBe('false');
	});

	it('should use the toString() of an object with a custom toString', () => {
		const value = { toString: () => 'custom message' };
		const result = toError(value);

		expect(result).toBeInstanceOf(Error);
		expect(result.message).toBe('custom message');
	});
});
