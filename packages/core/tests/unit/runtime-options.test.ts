import { MongoClient } from 'mongodb';
import { describe, expect, it } from 'vitest';

import { Monque, MonqueError } from '@/index';

describe('runtime options', () => {
	const db = new MongoClient('mongodb://localhost:27017').db('options');

	it.each([
		'workerConcurrency',
		'instanceConcurrency',
		'defaultConcurrency',
		'maxConcurrency',
		'maxRetries',
		'maxPayloadSize',
	] as const)('rejects invalid %s values', (name) => {
		for (const value of [Number.NaN, Infinity, -1, 0.5, Number.MAX_SAFE_INTEGER + 1]) {
			expect(() => new Monque(db, { [name]: value })).toThrow(MonqueError);
		}
	});

	it.each(['baseRetryInterval', 'maxBackoffDelay', 'lockTimeout', 'statsCacheTtlMs'] as const)(
		'validates %s while preserving fractional milliseconds',
		(name) => {
			for (const value of [Number.NaN, Infinity, -1]) {
				expect(() => new Monque(db, { [name]: value })).toThrow(name);
			}
			expect(() => new Monque(db, { [name]: 0.5 })).not.toThrow();
		},
	);

	it.each(['pollInterval', 'safetyPollInterval', 'heartbeatInterval'] as const)(
		'rejects invalid %s timers instead of running a tight loop',
		(name) => {
			for (const value of [0, -1, 0.5, Number.NaN, Infinity, 2_147_483_648]) {
				expect(() => new Monque(db, { [name]: value })).toThrow(name);
			}
			expect(() => new Monque(db, { [name]: 1.5 })).not.toThrow();
		},
	);

	it('rejects overflowing shutdown and retention timers', () => {
		expect(() => new Monque(db, { shutdownTimeout: 2_147_483_648 })).toThrow('shutdownTimeout');
		for (const interval of [0, -1, Infinity, 2_147_483_648]) {
			expect(() => new Monque(db, { jobRetention: { interval } })).toThrow('jobRetention.interval');
		}
	});

	it.each(['completed', 'failed', 'cancelled'] as const)(
		'rejects invalid %s retention ages',
		(status) => {
			for (const value of [Number.NaN, Infinity, -1]) {
				expect(() => new Monque(db, { jobRetention: { [status]: value } })).toThrow(
					`jobRetention.${status}`,
				);
			}
			expect(() => new Monque(db, { jobRetention: { [status]: 0.5 } })).not.toThrow();
		},
	);

	it('preserves zero limits and timer bounds', () => {
		expect(
			() =>
				new Monque(db, {
					workerConcurrency: 0,
					instanceConcurrency: 0,
					maxRetries: 0,
					baseRetryInterval: 0,
					maxBackoffDelay: 0,
					lockTimeout: 0,
					shutdownTimeout: 0,
					maxPayloadSize: 0,
					statsCacheTtlMs: 0,
					pollInterval: 1,
					heartbeatInterval: 2_147_483_647,
					jobRetention: { completed: 0, failed: 0, cancelled: 0, interval: 1 },
				}),
		).not.toThrow();
	});

	it('requires enough lease time for a heartbeat and a valid deadline', () => {
		for (const leaseDuration of [0, -1, Number.NaN, Infinity, 20, 2_147_483_648]) {
			expect(() => new Monque(db, { heartbeatInterval: 20, leaseDuration })).toThrow(
				'leaseDuration',
			);
		}
		expect(() => new Monque(db, { heartbeatInterval: 20, leaseDuration: 1000 })).not.toThrow();
	});

	it('validates registration before changing the registered worker', () => {
		const monque = new Monque(db);
		const handler = async () => {};
		for (const concurrency of [Number.NaN, Infinity, -1, 0.5]) {
			expect(() => monque.register('email', handler, { concurrency })).toThrow('concurrency');
		}
		expect(() => monque.register('email', handler, { concurrency: 0 })).not.toThrow();
		expect(() => monque.register('email', handler, { replace: true, concurrency: -1 })).toThrow(
			'concurrency',
		);
		expect(() => monque.register('email', handler)).toThrow('already registered');
	});

	it.each([
		{ maxRetries: Number.NaN },
		{ maxRetries: 0.5 },
		{ baseRetryInterval: -1 },
		{ maxBackoffDelay: Infinity },
	])('rejects invalid worker retry options before replacing its handler: %s', (options) => {
		const monque = new Monque(db);
		const handler = async () => {};
		expect(() => monque.register('email', handler, options)).toThrow(MonqueError);
		expect(() => monque.register('email', handler)).not.toThrow();
		expect(() => monque.register('email', handler, { ...options, replace: true })).toThrow(
			MonqueError,
		);
	});
});
