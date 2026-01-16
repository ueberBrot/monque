import type { Collection, Document, WithId } from 'mongodb';

import type { MonqueEventMap } from '@/events';
import type { PersistedJob } from '@/jobs';
import type { WorkerRegistration } from '@/workers';

import type { MonqueOptions } from '../types.js';

/**
 * Resolved Monque options with all defaults applied.
 *
 * Required options have their defaults filled in, while truly optional
 * options (`maxBackoffDelay`, `jobRetention`) remain optional.
 */
export type ResolvedMonqueOptions = Required<
	Omit<MonqueOptions, 'maxBackoffDelay' | 'jobRetention'>
> &
	Pick<MonqueOptions, 'maxBackoffDelay' | 'jobRetention'>;

/**
 * Shared context provided to all internal Monque services.
 *
 * Contains references to shared state, configuration, and utilities
 * needed by service methods. Passed to service constructors to enable
 * access to the collection, options, and event emission.
 *
 * @internal Not part of public API.
 */
export interface SchedulerContext {
	/** MongoDB collection for jobs */
	collection: Collection<Document>;

	/** Resolved scheduler options with defaults applied */
	options: ResolvedMonqueOptions;

	/** Unique identifier for this scheduler instance (for claiming jobs) */
	instanceId: string;

	/** Registered workers by job name */
	workers: Map<string, WorkerRegistration>;

	/** Whether the scheduler is currently running */
	isRunning: () => boolean;

	/** Type-safe event emitter */
	emit: <K extends keyof MonqueEventMap>(event: K, payload: MonqueEventMap[K]) => boolean;

	/** Convert MongoDB document to typed PersistedJob */
	documentToPersistedJob: <T>(doc: WithId<Document>) => PersistedJob<T>;
}
