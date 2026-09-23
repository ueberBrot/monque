import type { Job, Monque } from '@monque/core';
import { type Db, ObjectId, type WithId } from 'mongodb';

const scenarioNames = ['mixed', 'pagination', 'mutations', 'dates'] as const;
type ScenarioName = (typeof scenarioNames)[number];

function createJob(overrides: Partial<Job> = {}): WithId<Job> {
	return {
		name: 'email',
		data: { source: 'dashboard-scenario' },
		status: 'pending',
		createdAt: new Date('2026-06-01T10:00:00Z'),
		updatedAt: new Date('2026-06-01T10:00:00Z'),
		nextRunAt: new Date('2035-06-01T10:00:00Z'),
		failCount: 0,
		...overrides,
		_id: new ObjectId(),
	};
}

/** Stable, reusable datasets; IDs are unique each time a worker resets its database. */
function createScenario(name: ScenarioName): WithId<Job>[] {
	if (name === 'pagination')
		return Array.from({ length: 125 }, (_, index) => createJob({ data: { index } }));
	if (name === 'mutations')
		return Array.from({ length: 12 }, (_, index) =>
			createJob({
				status: index < 6 ? 'failed' : 'pending',
				failCount: index < 6 ? 2 : 0,
				data: { index },
			}),
		);
	if (name === 'dates')
		return [0, 1, 2, 3, 4].map((index) => {
			const date = new Date(Date.UTC(2026, 5, 1, 10, index));
			return createJob({ createdAt: date, updatedAt: date, nextRunAt: date, data: { index } });
		});
	const names = ['email', 'fails', 'archived-queue'];
	const statuses = ['pending', 'processing', 'completed', 'failed', 'cancelled'] as const;
	return names.flatMap((queue) =>
		statuses.flatMap((status) =>
			[0, 1, 2].map((index) =>
				createJob({
					name: queue,
					status,
					failCount: status === 'failed' ? index + 1 : 0,
					...(status === 'failed' ? { failReason: `Seeded failure ${index}` } : {}),
					...(status === 'processing'
						? {
								claimedBy: 'seed-worker',
								lockedAt: new Date(),
								lastHeartbeat: new Date(),
								heartbeatInterval: 15_000,
							}
						: {}),
					...(index === 2
						? { repeatInterval: '*/5 * * * *', uniqueKey: `${queue}-${status}-recurring` }
						: {}),
					data:
						index === 0
							? {}
							: index === 1
								? { nested: { values: [null, true, 42, 'Unicode: café 日本語'] } }
								: { text: 'payload-'.repeat(200) },
				}),
			),
		),
	);
}

/** Actual job handlers record observable attempts/effects in MongoDB. */
function registerScenarioWorkers(monque: Monque, db: Db): void {
	// Retain the original development queue names when loading an existing seed database.
	for (const name of [
		'email',
		'send-email',
		'sync-billing',
		'dispatch-webhook',
		'rebuild-search',
	]) {
		monque.register(name, async (job) => {
			await db.collection('effects').insertOne({ jobId: job._id, kind: 'completed' });
		});
	}
	monque.register('fails', async (job) => {
		await db.collection('attempts').insertOne({ jobId: job._id, at: new Date() });
		throw new Error('intentional e2e worker failure');
	});
	monque.register('flaky', async (job) => {
		await db.collection('attempts').insertOne({ jobId: job._id, at: new Date() });
		if ((await db.collection('attempts').countDocuments({ jobId: job._id })) === 1)
			throw new Error('retry once');
		await db.collection('effects').insertOne({ jobId: job._id, kind: 'recovered' });
	});
	monque.register(
		'slow',
		async (job) => {
			await new Promise((resolve) => setTimeout(resolve, 1500));
			await db.collection('effects').insertOne({ jobId: job._id, kind: 'completed' });
		},
		{ concurrency: 1 },
	);
}

export { createJob, createScenario, registerScenarioWorkers, type ScenarioName };
