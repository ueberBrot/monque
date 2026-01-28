import type { Db } from 'mongodb';
import { describe, expect, it, vi } from 'vitest';

import {
	isMongooseConnection,
	isMongooseService,
	type MongooseConnection,
	type MongooseService,
} from '@/utils';

describe('Type Guards', () => {
	// Mock Db instance
	const createMockDb = (): Db =>
		({
			databaseName: 'test-db',
			collection: vi.fn(),
		}) as unknown as Db;

	describe('isMongooseService', () => {
		it('should return true for valid MongooseService', () => {
			const service: MongooseService = {
				get: vi.fn(),
			};
			expect(isMongooseService(service)).toBe(true);
		});

		it('should return false for null', () => {
			expect(isMongooseService(null)).toBe(false);
		});

		it('should return false for undefined', () => {
			expect(isMongooseService(undefined)).toBe(false);
		});

		it('should return false for primitives', () => {
			expect(isMongooseService(123)).toBe(false);
			expect(isMongooseService('string')).toBe(false);
		});

		it('should return false for objects without get method', () => {
			expect(isMongooseService({})).toBe(false);
			expect(isMongooseService({ got: () => {} })).toBe(false);
			expect(isMongooseService({ get: 123 })).toBe(false);
		});
	});

	describe('isMongooseConnection', () => {
		it('should return true for valid MongooseConnection', () => {
			const connection: MongooseConnection = {
				db: createMockDb(),
			};
			expect(isMongooseConnection(connection)).toBe(true);
		});

		it('should return false for null', () => {
			expect(isMongooseConnection(null)).toBe(false);
		});

		it('should return false for undefined', () => {
			expect(isMongooseConnection(undefined)).toBe(false);
		});

		it('should return false for primitives', () => {
			expect(isMongooseConnection(123)).toBe(false);
			expect(isMongooseConnection('string')).toBe(false);
		});

		it('should return false for objects without db property', () => {
			expect(isMongooseConnection({})).toBe(false);
			expect(isMongooseConnection({ database: {} })).toBe(false);
		});

		it('should return false if db is not an object', () => {
			expect(isMongooseConnection({ db: 'not-an-object' })).toBe(false);
			expect(isMongooseConnection({ db: 123 })).toBe(false);
		});

		it('should return false if db is null', () => {
			expect(isMongooseConnection({ db: null })).toBe(false);
		});

		it('should return false if db.collection is not a function', () => {
			expect(isMongooseConnection({ db: {} })).toBe(false);
			expect(isMongooseConnection({ db: { collection: 'not-a-function' } })).toBe(false);
		});
	});
});
