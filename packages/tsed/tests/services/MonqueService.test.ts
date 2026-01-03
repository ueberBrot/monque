import type { Db } from 'mongodb';
import { describe, expect, it } from 'vitest';

import { MonqueService } from '@/services/monque-service.js';
import type { MonqueSettings } from '@/services/types.js';

/**
 * MonqueService Unit Tests
 *
 * These tests verify that MonqueService is properly exported.
 * The actual factory behavior (database resolution, lifecycle hooks, controller discovery)
 * is tested in the integration tests where we bootstrap the full DI container.
 */
describe('MonqueService', () => {
	it('should be exported', () => {
		expect(MonqueService).toBeDefined();
	});

	it('should be a function (factory)', () => {
		expect(typeof MonqueService).toBe('function');
	});
});

describe('MonqueSettings', () => {
	it('should allow valid configuration', () => {
		const config: MonqueSettings = {
			enabled: true,
			db: {} as Db,
			pollInterval: 1000,
		};

		expect(config.enabled).toBe(true);
		expect(config.pollInterval).toBe(1000);
	});

	it('should support async database factory', () => {
		const config: MonqueSettings = {
			enabled: true,
			db: async () => ({}) as Db,
		};

		expect(typeof config.db).toBe('function');
	});
});
