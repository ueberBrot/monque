import type { Db } from 'mongodb';
import { describe, expect, it, vi } from 'vitest';

import type { MonqueTsedConfig } from '../../../src/config/config.js';
import { type InjectorFn, resolveDatabase } from '../../../src/utils/resolve-database.js';

describe('resolveDatabase', () => {
	// Mock Db instance
	const createMockDb = (): Db =>
		({
			databaseName: 'test-db',
			collection: vi.fn(),
		}) as unknown as Db;

	describe('direct db strategy', () => {
		it('should return the db instance directly', async () => {
			const mockDb = createMockDb();
			const config: MonqueTsedConfig = { db: mockDb };

			const result = await resolveDatabase(config);

			expect(result).toBe(mockDb);
		});

		it('should prioritize db over other strategies', async () => {
			const mockDb = createMockDb();
			const factoryDb = createMockDb();
			const config: MonqueTsedConfig = {
				db: mockDb,
				dbFactory: () => factoryDb,
			};

			const result = await resolveDatabase(config);

			expect(result).toBe(mockDb);
		});
	});

	describe('dbFactory strategy', () => {
		it('should call sync factory and return result', async () => {
			const mockDb = createMockDb();
			const factory = vi.fn().mockReturnValue(mockDb);
			const config: MonqueTsedConfig = { dbFactory: factory };

			const result = await resolveDatabase(config);

			expect(factory).toHaveBeenCalledOnce();
			expect(result).toBe(mockDb);
		});

		it('should call async factory and return result', async () => {
			const mockDb = createMockDb();
			const factory = vi.fn().mockResolvedValue(mockDb);
			const config: MonqueTsedConfig = { dbFactory: factory };

			const result = await resolveDatabase(config);

			expect(factory).toHaveBeenCalledOnce();
			expect(result).toBe(mockDb);
		});

		it('should propagate factory errors', async () => {
			const factory = vi.fn().mockRejectedValue(new Error('Connection failed'));
			const config: MonqueTsedConfig = { dbFactory: factory };

			await expect(resolveDatabase(config)).rejects.toThrow('Connection failed');
		});
	});

	describe('dbToken strategy', () => {
		it('should resolve db from DI token', async () => {
			const mockDb = createMockDb();
			const injectorFn: InjectorFn = vi.fn().mockReturnValue(mockDb);
			const config: MonqueTsedConfig = { dbToken: 'MONGODB_DATABASE' };

			const result = await resolveDatabase(config, injectorFn);

			expect(injectorFn).toHaveBeenCalledWith('MONGODB_DATABASE');
			expect(result).toBe(mockDb);
		});

		it('should throw if injector function is not provided', async () => {
			const config: MonqueTsedConfig = { dbToken: 'MONGODB_DATABASE' };

			await expect(resolveDatabase(config)).rejects.toThrow(
				'MonqueTsedConfig.dbToken requires an injector function',
			);
		});

		it('should throw if DI resolution returns undefined', async () => {
			const injectorFn: InjectorFn = vi.fn().mockReturnValue(undefined);
			const config: MonqueTsedConfig = { dbToken: 'MONGODB_DATABASE' };

			await expect(resolveDatabase(config, injectorFn)).rejects.toThrow(
				/Could not resolve database from token.*MONGODB_DATABASE/,
			);
		});

		it('should throw if DI resolution returns null', async () => {
			const injectorFn: InjectorFn = vi.fn().mockReturnValue(null);
			const config: MonqueTsedConfig = { dbToken: 'MONGODB_DATABASE' };

			await expect(resolveDatabase(config, injectorFn)).rejects.toThrow(
				/Could not resolve database from token.*MONGODB_DATABASE/,
			);
		});

		it('should work with Symbol tokens', async () => {
			const mockDb = createMockDb();
			const TOKEN = Symbol('MONGODB');
			const injectorFn: InjectorFn = vi.fn().mockReturnValue(mockDb);
			const config: MonqueTsedConfig = { dbToken: TOKEN as unknown as string };

			const result = await resolveDatabase(config, injectorFn);

			expect(injectorFn).toHaveBeenCalledWith(TOKEN);
			expect(result).toBe(mockDb);
		});
	});

	describe('no strategy', () => {
		it('should throw if no database strategy is provided', async () => {
			const config: MonqueTsedConfig = {};

			await expect(resolveDatabase(config)).rejects.toThrow(
				"MonqueTsedConfig requires 'db', 'dbFactory', or 'dbToken' to be set",
			);
		});
	});

	describe('priority', () => {
		it('should prioritize db > dbFactory > dbToken', async () => {
			const directDb = createMockDb();
			const factoryDb = createMockDb();
			const tokenDb = createMockDb();

			const injectorFn: InjectorFn = vi.fn().mockReturnValue(tokenDb);

			// All three provided - should use db
			const config1: MonqueTsedConfig = {
				db: directDb,
				dbFactory: () => factoryDb,
				dbToken: 'TOKEN',
			};
			expect(await resolveDatabase(config1, injectorFn)).toBe(directDb);

			// Factory and token - should use factory
			const config2: MonqueTsedConfig = {
				dbFactory: () => factoryDb,
				dbToken: 'TOKEN',
			};
			expect(await resolveDatabase(config2, injectorFn)).toBe(factoryDb);
		});
	});
});
