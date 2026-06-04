import { JobStatus, Monque } from '@monque/core';
import type { ManagementMonque, ManagementSurface } from '@monque/management';
import { createManagementSurface } from '@monque/management';
import { type Collection, type Document, MongoClient, ObjectId, type WithId } from 'mongodb';
import type { Connect } from 'vite';

const DEFAULT_MONGO_URI = 'mongodb://127.0.0.1:27018/?directConnection=true';
const DEFAULT_DATABASE_NAME = 'monque_dashboard_dev';
const COLLECTION_NAME = 'monque_dashboard_jobs';
const SEED_MARKER_COLLECTION = 'monque_dashboard_seed';
const SEED_VERSION = '2026-06-04-atlas-local-v1';
const API_MOUNT_PATH = '/api';
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
	readonly close: () => Promise<void>;
};

type LocalDbRuntime = {
	readonly client: MongoClient;
	readonly management: ManagementSurface;
};

type DashboardSeedJob = WithId<Document> & {
	readonly name: string;
	readonly uniqueKey: string;
};

let runtimePromise: Promise<LocalDbRuntime> | null = null;

function createLocalDbManagementServer(options?: {
	readonly mongoUri?: string;
	readonly databaseName?: string;
}): LocalDbManagementServer {
	const mongoUri = options?.mongoUri ?? DEFAULT_MONGO_URI;
	const databaseName = options?.databaseName ?? DEFAULT_DATABASE_NAME;

	return {
		middleware: async (request, response, next) => {
			if (!request.url) {
				next();
				return;
			}

			try {
				const runtime = await getLocalDbRuntime({ mongoUri, databaseName });
				const result = await runtime.management.openApiHandler.handle(
					await createFetchRequest(request),
					{
						context: {
							managementContext: {
								source: 'dashboard-dev-db',
							},
						},
					},
				);

				if (!result.matched) {
					next();
					return;
				}

				response.statusCode = result.response.status;
				result.response.headers.forEach((value: string, key: string) => {
					response.setHeader(key, value);
				});
				response.end(Buffer.from(await result.response.arrayBuffer()));
			} catch (error) {
				if (error instanceof LocalDbConnectionError) {
					response.statusCode = 503;
					response.setHeader('content-type', 'application/json; charset=utf-8');
					response.end(
						JSON.stringify({
							error: 'dashboard_dev_db_unavailable',
							message: error.message,
							mongoUri: error.mongoUri,
						}),
					);
					return;
				}

				next(error);
			}
		},
		close: async () => {
			const runtime = await runtimePromise;
			runtimePromise = null;
			await runtime?.client.close();
		},
	};
}

async function getLocalDbRuntime(options: {
	readonly mongoUri: string;
	readonly databaseName: string;
}): Promise<LocalDbRuntime> {
	runtimePromise ??= createLocalDbRuntime(options);
	return runtimePromise;
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
	});
	await monque.initialize();

	registerDemoWorkers(monque);
	await seedDashboardJobs(db.collection(COLLECTION_NAME), db.collection(SEED_MARKER_COLLECTION));

	return {
		client,
		management: createManagementSurface({
			monque: createManagementMonqueFacade(monque),
		}),
	};
}

function createManagementMonqueFacade(monque: Monque): ManagementMonque {
	return {
		isHealthy: monque.isHealthy.bind(monque),
		getQueueViewSummaries: monque.getQueueViewSummaries.bind(monque),
		getJobsWithCursor: monque.getJobsWithCursor.bind(monque),
		getJob: (id) => monque.getJob(new ObjectId(id)),
		getQueueStats: monque.getQueueStats.bind(monque),
		cancelJob: monque.cancelJob.bind(monque),
		retryJob: monque.retryJob.bind(monque),
		rescheduleJob: monque.rescheduleJob.bind(monque),
		deleteJob: monque.deleteJob.bind(monque),
		cancelJobs: monque.cancelJobs.bind(monque),
		retryJobs: monque.retryJobs.bind(monque),
		deleteJobs: monque.deleteJobs.bind(monque),
	};
}

function registerDemoWorkers(monque: Monque): void {
	for (const name of ['send-email', 'sync-billing', 'dispatch-webhook', 'rebuild-search']) {
		monque.register(name, async () => {}, { concurrency: 2 });
	}
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
	const now = Date.now();
	const names = ['send-email', 'sync-billing', 'dispatch-webhook', 'rebuild-search'];
	const statuses = [
		JobStatus.PENDING,
		JobStatus.PENDING,
		JobStatus.PROCESSING,
		JobStatus.COMPLETED,
		JobStatus.FAILED,
		JobStatus.CANCELLED,
	] as const;

	return Array.from({ length: 36 }, (_, index) => {
		const name = names[index % names.length] ?? 'send-email';
		const status = statuses[index % statuses.length] ?? JobStatus.PENDING;
		const createdAt = new Date(now - index * 1000 * 60 * 45);
		const updatedAt = new Date(createdAt.getTime() + 1000 * 60 * (5 + (index % 8)));
		const nextRunAt = new Date(now + (index - 8) * 1000 * 60 * 10);
		const isProcessing = status === JobStatus.PROCESSING;
		const isFailed = status === JobStatus.FAILED;

		return {
			_id: new ObjectId(),
			name,
			data: {
				attempt: isFailed ? 3 : 1,
				customerId: `cust-${String(index + 1).padStart(3, '0')}`,
				priority: index % 3 === 0 ? 'high' : 'normal',
				source: 'dashboard-dev-db',
			},
			status,
			nextRunAt,
			lockedAt: isProcessing ? updatedAt : null,
			claimedBy: isProcessing ? `dashboard-dev-worker-${(index % 2) + 1}` : null,
			lastHeartbeat: isProcessing ? new Date(updatedAt.getTime() + 15_000) : null,
			heartbeatInterval: isProcessing ? 30_000 : undefined,
			failCount: isFailed ? 3 : 0,
			failReason: isFailed ? `Seeded failure ${index + 1}` : undefined,
			repeatInterval: index % 9 === 0 ? '*/15 * * * *' : undefined,
			uniqueKey: `dashboard-dev-seed-${SEED_VERSION}-${index + 1}`,
			createdAt,
			updatedAt,
		};
	});
}

async function createFetchRequest(request: Connect.IncomingMessage): Promise<Request> {
	const body = await readNodeRequestBody(request);
	const requestInit: RequestInit = {
		method: request.method ?? 'GET',
		headers: createHeadersFromNodeRequest(request),
	};

	if (body) {
		requestInit.body = new Blob([new Uint8Array(body)]);
	}

	return new Request(createLocalDbManagementRequestUrl(request.url ?? '/'), requestInit);
}

async function readNodeRequestBody(request: Connect.IncomingMessage): Promise<Buffer | undefined> {
	if (request.method === 'GET' || request.method === 'HEAD') {
		return undefined;
	}

	const chunks: Uint8Array[] = [];

	for await (const chunk of request) {
		chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
	}

	return chunks.length > 0 ? Buffer.concat(chunks) : undefined;
}

function createHeadersFromNodeRequest(request: Connect.IncomingMessage): Headers {
	const headers = new Headers();

	for (const [name, value] of Object.entries(request.headers)) {
		if (typeof value === 'undefined') {
			continue;
		}

		if (Array.isArray(value)) {
			for (const item of value) {
				headers.append(name, item);
			}
			continue;
		}

		headers.set(name, value);
	}

	return headers;
}

function createLocalDbManagementRequestUrl(requestUrl: string): string {
	const path = requestUrl.startsWith('/') ? requestUrl : `/${requestUrl}`;
	return `http://dashboard-dev.local${API_MOUNT_PATH}${path}`;
}

export { createLocalDbManagementRequestUrl, createLocalDbManagementServer, createSeedJobs };
