import { MonqueError } from '@/shared';

import type { ResolvedMonqueOptions } from './services/index.js';

const MAX_TIMER_DELAY = 2_147_483_647;

export function validateIntegerOption(name: string, value: number | undefined): void {
	if (value !== undefined && (!Number.isSafeInteger(value) || value < 0)) {
		throw new MonqueError(`${name} must be a non-negative safe integer`);
	}
}

function validateNumberOption(
	name: string,
	value: number | undefined,
	min = 0,
	max = Number.MAX_VALUE,
): void {
	if (value !== undefined && (!Number.isFinite(value) || value < min || value > max)) {
		throw new MonqueError(`${name} must be a finite number between ${min} and ${max}`);
	}
}

export function validateOptions(options: ResolvedMonqueOptions): void {
	for (const name of ['pollInterval', 'safetyPollInterval', 'heartbeatInterval'] as const) {
		validateNumberOption(name, options[name], 1, MAX_TIMER_DELAY);
	}
	validateNumberOption('shutdownTimeout', options.shutdownTimeout, 0, MAX_TIMER_DELAY);
	for (const name of [
		'workerConcurrency',
		'instanceConcurrency',
		'maxRetries',
		'maxPayloadSize',
	] as const) {
		validateIntegerOption(name, options[name]);
	}
	for (const name of [
		'baseRetryInterval',
		'maxBackoffDelay',
		'lockTimeout',
		'statsCacheTtlMs',
	] as const) {
		validateNumberOption(name, options[name]);
	}
	for (const status of ['completed', 'failed', 'cancelled'] as const) {
		validateNumberOption(`jobRetention.${status}`, options.jobRetention?.[status]);
	}
	validateNumberOption('jobRetention.interval', options.jobRetention?.interval, 1, MAX_TIMER_DELAY);
}
