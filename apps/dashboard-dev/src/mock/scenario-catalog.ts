import type {
	CapabilitiesDto,
	JobDto,
	QueueStatsDto,
	QueueViewSummaryDto,
	SchedulerHealthDto,
} from '@monque/management/contract';

const dashboardDevScenarioIds = [
	'empty-state',
	'pending-jobs',
	'failed-jobs',
	'large-dataset',
	'unauthorized',
	'forbidden',
	'read-only',
	'api-error',
	'mutation-conflict',
] as const;

type DashboardDevScenarioId = (typeof dashboardDevScenarioIds)[number];

type DashboardDevScenario = {
	readonly id: DashboardDevScenarioId;
	readonly label: string;
	readonly description: string;
	readonly health: SchedulerHealthDto;
	readonly capabilities: CapabilitiesDto;
	readonly jobs: readonly JobDto[];
	readonly queueViews: readonly QueueViewSummaryDto[];
	readonly unauthorized?: boolean;
	readonly forbidden?: boolean;
	readonly apiError?: string;
	readonly mutationConflict?: boolean;
};

function isDashboardDevScenarioId(
	value: string | null | undefined,
): value is DashboardDevScenarioId {
	return (
		typeof value === 'string' && dashboardDevScenarioIds.some((scenarioId) => scenarioId === value)
	);
}

function getDashboardDevScenarioCatalog(): readonly DashboardDevScenario[] {
	return [
		createScenario({
			id: 'empty-state',
			label: 'Empty state',
			description: 'No persisted jobs yet.',
			jobs: [],
		}),
		createScenario({
			id: 'pending-jobs',
			label: 'Pending Jobs',
			description: 'Queues with waiting and processing work.',
			jobs: createGeneratedJobs({
				seed: 46001,
				count: 24,
				queueNames: ['send-email', 'sync-billing', 'dispatch-webhook'],
				statuses: ['pending', 'pending', 'pending', 'processing', 'completed'],
			}),
			workerNames: ['send-email', 'sync-billing'],
		}),
		createScenario({
			id: 'failed-jobs',
			label: 'Failed Jobs',
			description: 'Failures with retryable history and a few completed jobs around them.',
			jobs: createGeneratedJobs({
				seed: 46002,
				count: 18,
				queueNames: ['rebuild-search', 'dispatch-webhook', 'sync-billing'],
				statuses: ['failed', 'failed', 'failed', 'pending', 'completed'],
			}),
			workerNames: ['rebuild-search'],
		}),
		createScenario({
			id: 'large-dataset',
			label: 'Large dataset',
			description: 'A wide multi-queue fixture for pagination and filter work.',
			jobs: createGeneratedJobs({
				seed: 46003,
				count: 180,
				queueNames: [
					'send-email',
					'sync-billing',
					'dispatch-webhook',
					'rebuild-search',
					'expire-tokens',
					'settle-invoices',
				],
				statuses: ['pending', 'processing', 'completed', 'failed', 'cancelled'],
			}),
			workerNames: ['send-email', 'sync-billing', 'dispatch-webhook', 'rebuild-search'],
		}),
		{
			...createScenario({
				id: 'unauthorized',
				label: 'Unauthorized',
				description: 'Every Management request returns 401.',
				jobs: createGeneratedJobs({
					seed: 46004,
					count: 8,
					queueNames: ['send-email', 'sync-billing'],
					statuses: ['pending', 'failed'],
				}),
				workerNames: ['send-email'],
			}),
			unauthorized: true,
		},
		{
			...createScenario({
				id: 'forbidden',
				label: 'Forbidden',
				description: 'The operator is signed in but denied access to Management routes.',
				jobs: createGeneratedJobs({
					seed: 46006,
					count: 8,
					queueNames: ['send-email', 'sync-billing'],
					statuses: ['pending', 'failed'],
				}),
				workerNames: ['send-email'],
			}),
			forbidden: true,
		},
		{
			...createScenario({
				id: 'read-only',
				label: 'Read only',
				description: 'Reads work, but the Management surface exposes only read access.',
				jobs: createGeneratedJobs({
					seed: 46007,
					count: 10,
					queueNames: ['dispatch-webhook', 'sync-billing'],
					statuses: ['pending', 'processing', 'completed'],
				}),
				workerNames: ['dispatch-webhook'],
			}),
			capabilities: {
				readOnly: true,
				actions: {
					read: true,
					cancel: false,
					cancelBulk: false,
					retry: false,
					retryBulk: false,
					reschedule: false,
					delete: false,
					deleteBulk: false,
				},
			},
		},
		{
			...createScenario({
				id: 'api-error',
				label: 'API error',
				description: 'Every Management request returns a generic server error.',
				jobs: createGeneratedJobs({
					seed: 46008,
					count: 6,
					queueNames: ['send-email'],
					statuses: ['pending', 'failed'],
				}),
				workerNames: ['send-email'],
			}),
			apiError: 'Management API unavailable for the current dashboard scenario.',
		},
		{
			...createScenario({
				id: 'mutation-conflict',
				label: 'Mutation conflict',
				description: 'Reads work, but every mutation returns a conflict.',
				jobs: createGeneratedJobs({
					seed: 46005,
					count: 14,
					queueNames: ['dispatch-webhook', 'rebuild-search', 'sync-billing'],
					statuses: ['failed', 'pending', 'processing', 'completed'],
				}),
				workerNames: ['dispatch-webhook', 'sync-billing'],
			}),
			mutationConflict: true,
		},
	];
}

function getDashboardDevScenario(
	scenarioId: DashboardDevScenarioId,
): DashboardDevScenario | undefined {
	return getDashboardDevScenarioCatalog().find((scenario) => scenario.id === scenarioId);
}

function createScenario(options: {
	readonly id: DashboardDevScenarioId;
	readonly label: string;
	readonly description: string;
	readonly jobs: readonly JobDto[];
	readonly capabilities?: CapabilitiesDto;
	readonly workerNames?: readonly string[];
}): DashboardDevScenario {
	return {
		id: options.id,
		label: options.label,
		description: options.description,
		health: {
			status: 'ok',
			scheduler: {
				healthy: true,
			},
		},
		capabilities: options.capabilities ?? {
			readOnly: false,
			actions: {
				read: true,
				cancel: true,
				cancelBulk: true,
				retry: true,
				retryBulk: true,
				reschedule: true,
				delete: true,
				deleteBulk: true,
			},
		},
		jobs: options.jobs,
		queueViews: buildQueueViews(options.jobs, options.workerNames ?? []),
	};
}

function createGeneratedJobs(options: {
	readonly seed: number;
	readonly count: number;
	readonly queueNames: readonly string[];
	readonly statuses: readonly JobDto['status'][];
}): readonly JobDto[] {
	const random = createMulberry32(options.seed);
	const baseTime = Date.parse('2026-06-01T08:00:00.000Z');
	const jobs: JobDto[] = [];

	for (let index = 0; index < options.count; index += 1) {
		const status = options.statuses[index % options.statuses.length] ?? 'pending';
		const name = options.queueNames[index % options.queueNames.length] ?? 'send-email';
		const createdAt = new Date(baseTime - index * 3_600_000 - Math.floor(random() * 900_000));
		const updatedAt = new Date(createdAt.getTime() + 60_000 + Math.floor(random() * 120_000));
		const nextRunAt = new Date(baseTime + index * 90_000 + Math.floor(random() * 45_000));
		const failCount = status === 'failed' ? 1 + (index % 4) : 0;

		jobs.push({
			id: `scenario-${options.seed}-${String(index + 1).padStart(4, '0')}`,
			name,
			status,
			payload: {
				attempt: failCount + 1,
				queue: name,
				seed: options.seed,
				sequence: index + 1,
			},
			nextRunAt: nextRunAt.toISOString(),
			lockedAt: status === 'processing' ? updatedAt.toISOString() : null,
			claimedBy: status === 'processing' ? `worker-${(index % 3) + 1}` : null,
			lastHeartbeat:
				status === 'processing' ? new Date(updatedAt.getTime() + 15_000).toISOString() : null,
			heartbeatInterval: status === 'processing' ? 15_000 : undefined,
			failCount,
			failureReason: status === 'failed' ? `Scenario failure ${index + 1}` : null,
			repeatInterval: index % 5 === 0 ? '*/15 * * * *' : undefined,
			uniqueKey: index % 4 === 0 ? `${name}:${index + 1}` : undefined,
			createdAt: createdAt.toISOString(),
			updatedAt: updatedAt.toISOString(),
		});
	}

	return jobs;
}

function buildQueueViews(
	jobs: readonly JobDto[],
	workerNames: readonly string[],
): readonly QueueViewSummaryDto[] {
	const queueNames = new Set<string>(workerNames);

	for (const job of jobs) {
		queueNames.add(job.name);
	}

	return [...queueNames]
		.sort((left, right) => left.localeCompare(right))
		.map((name, index) => {
			const queueJobs = jobs.filter((job) => job.name === name);
			const stats = createQueueStats(queueJobs);
			const hasRegisteredWorker = workerNames.includes(name);

			return {
				name,
				hasPersistedJobs: queueJobs.length > 0,
				hasRegisteredWorker,
				stats,
				worker: hasRegisteredWorker
					? {
							concurrency: (index % 3) + 1,
							activeCount: queueJobs.filter((job) => job.status === 'processing').length,
						}
					: null,
			};
		});
}

function createQueueStats(jobs: readonly JobDto[]): QueueStatsDto {
	let pending = 0;
	let processing = 0;
	let completed = 0;
	let failed = 0;
	let cancelled = 0;

	for (const job of jobs) {
		switch (job.status) {
			case 'pending':
				pending += 1;
				break;
			case 'processing':
				processing += 1;
				break;
			case 'completed':
				completed += 1;
				break;
			case 'failed':
				failed += 1;
				break;
			case 'cancelled':
				cancelled += 1;
				break;
		}
	}

	return {
		pending,
		processing,
		completed,
		failed,
		cancelled,
		total: jobs.length,
		avgProcessingDurationMs: processing > 0 ? 42_000 : undefined,
	};
}

function createMulberry32(seed: number): () => number {
	let current = seed;

	return () => {
		current |= 0;
		current = (current + 0x6d2b79f5) | 0;
		let mixed = Math.imul(current ^ (current >>> 15), current | 1);
		mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
		return ((mixed ^ (mixed >>> 14)) >>> 0) / 4_294_967_296;
	};
}

export {
	createQueueStats,
	type DashboardDevScenario,
	type DashboardDevScenarioId,
	dashboardDevScenarioIds,
	getDashboardDevScenario,
	getDashboardDevScenarioCatalog,
	isDashboardDevScenarioId,
};
