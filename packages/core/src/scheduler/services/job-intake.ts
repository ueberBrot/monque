import { BSON, type Document } from 'mongodb';

import {
	type EnqueueOptions,
	type Job,
	JobStatus,
	type PersistedJob,
	type ScheduleOptions,
} from '@/jobs';
import {
	ConnectionError,
	getNextCronDate,
	PayloadTooLargeError,
	toError,
	validateJobName,
	validateUniqueKey,
} from '@/shared';

import type { SchedulerContext } from './types.js';

/**
 * Internal module for creating pending jobs.
 *
 * Keeps validation, initial job document construction, persistence, and local
 * pending-job notification in one place.
 *
 * @internal Not part of public API - use Monque class methods instead.
 */
export class JobIntake {
	constructor(private readonly ctx: SchedulerContext) {}

	private validateJobIdentifiers(name: string, uniqueKey?: string): void {
		validateJobName(name);

		if (uniqueKey !== undefined) {
			validateUniqueKey(uniqueKey);
		}
	}

	private validatePayloadSize(data: unknown): void {
		const maxSize = this.ctx.options.maxPayloadSize;
		if (maxSize === undefined) {
			return;
		}

		let size: number;
		try {
			size = BSON.calculateObjectSize({ data } as Document);
		} catch (error) {
			const cause = toError(error);
			const sizeError = new PayloadTooLargeError(
				`Failed to calculate job payload size: ${cause.message}`,
				-1,
				maxSize,
			);
			sizeError.cause = cause;
			throw sizeError;
		}

		if (size > maxSize) {
			throw new PayloadTooLargeError(
				`Job payload exceeds maximum size: ${size} bytes > ${maxSize} bytes`,
				size,
				maxSize,
			);
		}
	}

	private async persistPendingJob<T>(
		operation: 'enqueue' | 'schedule',
		job: Omit<Job<T>, '_id'>,
		uniqueKey?: string,
	): Promise<PersistedJob<T>> {
		if (uniqueKey !== undefined) {
			const result = await this.ctx.collection.findOneAndUpdate(
				{
					name: job.name,
					uniqueKey,
					status: { $in: [JobStatus.PENDING, JobStatus.PROCESSING] },
				},
				{
					$setOnInsert: job,
				},
				{
					upsert: true,
					returnDocument: 'after',
				},
			);

			if (!result) {
				throw new ConnectionError(
					`Failed to ${operation} job: findOneAndUpdate returned no document`,
				);
			}

			const persistedJob = this.ctx.documentToPersistedJob<T>(result);
			if (persistedJob.status === JobStatus.PENDING) {
				this.ctx.notifyPendingJob(persistedJob.name, persistedJob.nextRunAt);
			}

			return persistedJob;
		}

		const result = await this.ctx.collection.insertOne(job as Document);
		const persistedJob = { ...job, _id: result.insertedId } as PersistedJob<T>;
		this.ctx.notifyPendingJob(persistedJob.name, persistedJob.nextRunAt);

		return persistedJob;
	}

	async schedule<T>(
		cron: string,
		name: string,
		data: T,
		options: ScheduleOptions = {},
	): Promise<PersistedJob<T>> {
		this.validateJobIdentifiers(name, options.uniqueKey);
		this.validatePayloadSize(data);

		const nextRunAt = getNextCronDate(cron);
		const now = new Date();
		const job: Omit<Job<T>, '_id'> = {
			name,
			data,
			status: JobStatus.PENDING,
			nextRunAt,
			repeatInterval: cron,
			failCount: 0,
			createdAt: now,
			updatedAt: now,
		};

		if (options.uniqueKey !== undefined) {
			job.uniqueKey = options.uniqueKey;
		}

		try {
			return await this.persistPendingJob('schedule', job, options.uniqueKey);
		} catch (error) {
			if (error instanceof ConnectionError) {
				throw error;
			}
			const err = toError(error);
			throw new ConnectionError(`Failed to schedule job: ${err.message}`, { cause: err });
		}
	}

	async enqueue<T>(name: string, data: T, options: EnqueueOptions = {}): Promise<PersistedJob<T>> {
		this.validateJobIdentifiers(name, options.uniqueKey);
		this.validatePayloadSize(data);

		const now = new Date();
		const job: Omit<Job<T>, '_id'> = {
			name,
			data,
			status: JobStatus.PENDING,
			nextRunAt: options.runAt ?? now,
			failCount: 0,
			createdAt: now,
			updatedAt: now,
		};

		if (options.uniqueKey !== undefined) {
			job.uniqueKey = options.uniqueKey;
		}

		try {
			return await this.persistPendingJob('enqueue', job, options.uniqueKey);
		} catch (error) {
			if (error instanceof ConnectionError) {
				throw error;
			}
			const err = toError(error);
			throw new ConnectionError(`Failed to enqueue job: ${err.message}`, { cause: err });
		}
	}

	async now<T>(name: string, data: T): Promise<PersistedJob<T>> {
		return this.enqueue(name, data, { runAt: new Date() });
	}
}
