import { MonqueError } from '@monque/core';
import { describe, expect, it } from 'vitest';

import { validateDatabaseConfig } from '@/config';
import type { MonqueTsedConfig } from '@/config/types';

describe('validateDatabaseConfig', () => {
	it('should pass with exactly one strategy (db)', () => {
		const config = { db: {} } as MonqueTsedConfig;
		expect(() => validateDatabaseConfig(config)).not.toThrow();
	});

	it('should pass with exactly one strategy (dbFactory)', () => {
		const config = { dbFactory: () => ({}) } as MonqueTsedConfig;
		expect(() => validateDatabaseConfig(config)).not.toThrow();
	});

	it('should pass with exactly one strategy (dbToken)', () => {
		const config = { dbToken: Symbol('db') } as MonqueTsedConfig;
		expect(() => validateDatabaseConfig(config)).not.toThrow();
	});

	it('should throw MonqueError if no strategies are provided', () => {
		const config = {} as MonqueTsedConfig;
		expect(() => validateDatabaseConfig(config)).toThrow(MonqueError);
		expect(() => validateDatabaseConfig(config)).toThrow(
			"MonqueTsedConfig requires exactly one of 'db', 'dbFactory', or 'dbToken' to be set",
		);
	});

	it('should throw MonqueError if multiple strategies are provided', () => {
		const config = {
			db: {},
			dbFactory: () => ({}),
		} as MonqueTsedConfig;

		expect(() => validateDatabaseConfig(config)).toThrow(MonqueError);
		expect(() => validateDatabaseConfig(config)).toThrow(
			"MonqueTsedConfig accepts only one of 'db', 'dbFactory', or 'dbToken' - multiple were provided",
		);
	});
});
