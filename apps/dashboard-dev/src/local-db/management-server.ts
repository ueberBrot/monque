import { Monque } from '@monque/core';
import type { ManagementSurface } from '@monque/management';
import { createManagementSurface } from '@monque/management';
import { type Collection, type Document, MongoClient, type WithId } from 'mongodb';
import type { Connect } from 'vite';

import { createManagementMiddleware } from '../management-middleware.js';
import { startDemoWorkload } from './demo-workload.js';
import { createScenario, registerScenarioWorkers } from './scenarios.js';

const DEFAULT_MONGO_URI = 'mongodb://127.0.0.1:27018/?directConnection=true';
const DEFAULT_DATABASE_NAME = 'monque_dashboard_dev';
const COLLECTION_NAME = 'monque_dashboard_jobs';
const SEED_MARKER_COLLECTION = 'monque_dashboard_seed';
const SEED_VERSION = '2026-06-04-atlas-local-v1';
const MONGO_CONNECT_TIMEOUT_MS = 3_000;

class LocalDbConnectionError extends Error {
	constructor(
		readonly mongoUri: string,
		options: { readonly cause: unknown },
	) {
		super(
			[
				`Could not connect to dashboard dev MongoDB at ${mongoUri}.`,
				'Start it with: docker compose -f apps/dashboard-dev/compose.yml up -d',
			].join(' '),
			{ cause: options.cause },
		);
		this.name = 'LocalDbConnectionError';
	}
}

type LocalDbManagementServer = {
	readonly middleware: Connect.NextHandleFunction;
	readonly start: () => Promise<void>;
	readonly close: () => Promise<void>;
};

type LocalDbRuntime = {
	readonly client: MongoClient;
	readonly monque: Monque;
	readonly management: ManagementSurface;
};

type DashboardSeedJob = WithId<Document> & {
	readonly name: string;
	readonly uniqueKey: string;
};

function createLocalDbManagementServer(options?: {
	readonly mongoUri?: string;
	readonly databaseName?: string;
}): LocalDbManagementServer {
	const mongoUri = options?.mongoUri ?? DEFAULT_MONGO_URI;
	const databaseName = options?.databaseName ?? DEFAULT_DATABASE_NAME;
	let runtimePromise: Promise<LocalDbRuntime> | null = null;
	let closing: Promise<void> | null = null;
	async function getRuntime(): Promise<LocalDbRuntime> {
		await closing;
		runtimePromise ??= createLocalDbRuntime({ mongoUri, databaseName }).catch((error: unknown) => {
			runtimePromise = null;
			throw error;
		});
		return runtimePromise;
	}

	return {
		start: async () => {
			await getRuntime();
		},
		middleware: createManagementMiddleware(async (request) => {
			try {
				const runtime = await getRuntime();
				const result = await runtime.management.openApiHandler.handle(request, {
					context: { managementContext: { source: 'dashboard-dev-db' } },
				});
				return result.matched ? result.response : undefined;
			} catch (error) {
				if (error instanceof LocalDbConnectionError) {
					return Response.json(
						{
							error: 'dashboard_dev_db_unavailable',
							message: error.message,
							mongoUri: error.mongoUri,
						},
						{ status: 503 },
					);
				}
				throw error;
			}
		}),
		close: async () => {
			closing ??= (async () => {
				try {
					const runtime = await runtimePromise;
					if (runtime) {
						try {
							await runtime.monque.stop();
						} finally {
							await runtime.client.close();
						}
					}
				} finally {
					runtimePromise = null;
				}
			})();
			try {
				await closing;
			} finally {
				closing = null;
			}
		},
	};
}

async function createLocalDbRuntime(options: {
	readonly mongoUri: string;
	readonly databaseName: string;
}): Promise<LocalDbRuntime> {
	const client = new MongoClient(options.mongoUri, {
		connectTimeoutMS: MONGO_CONNECT_TIMEOUT_MS,
		serverSelectionTimeoutMS: MONGO_CONNECT_TIMEOUT_MS,
	});

	try {
		await client.connect();
	} catch (error) {
		await client.close();
		throw new LocalDbConnectionError(options.mongoUri, { cause: error });
	}

	const db = client.db(options.databaseName);
	const monque = new Monque(db, {
		collectionName: COLLECTION_NAME,
		workerConcurrency: 2,
		statsCacheTtlMs: 0,
		pollInterval: 250,
		safetyPollInterval: 1_000,
		maxRetries: 2,
		baseRetryInterval: 1_000,
	});
	try {
		await monque.initialize();
		registerScenarioWorkers(monque, db);
		await seedDashboardJobs(db.collection(COLLECTION_NAME), db.collection(SEED_MARKER_COLLECTION));
		await startDemoWorkload(monque);
	} catch (error) {
		try {
			await monque.stop();
		} finally {
			await client.close();
		}
		throw error;
	}

	return {
		client,
		monque,
		management: createManagementSurface({
			monque,
		}),
	};
}

async function seedDashboardJobs(
	collection: Collection<Document>,
	markerCollection: Collection<Document>,
): Promise<void> {
	const marker = await markerCollection.findOne({ version: SEED_VERSION });
	if (marker) {
		return;
	}

	const seedJobs = createSeedJobs();

	await collection.bulkWrite(
		seedJobs.map((job) => ({
			updateOne: {
				filter: {
					name: job.name,
					uniqueKey: job.uniqueKey,
				},
				update: {
					$setOnInsert: job,
				},
				upsert: true,
			},
		})),
		{ ordered: false },
	);
	await markerCollection.updateOne(
		{ version: SEED_VERSION },
		{ $set: { seededAt: new Date(), version: SEED_VERSION } },
		{ upsert: true },
	);
}

function createSeedJobs(): DashboardSeedJob[] {
	return [...createScenario('mixed'), ...createScenario('pagination')].map((job, index) => ({
		...job,
		uniqueKey: `dashboard-dev-seed-${SEED_VERSION}-${index + 1}`,
	}));
}

export { createLocalDbManagementServer, createSeedJobs };
