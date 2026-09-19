import { setTimeout } from 'node:timers/promises';
import type { Monque } from '@monque/core';

async function startDemoWorkload(monque: Monque): Promise<void> {
	monque.register('demo-email', async () => {
		await setTimeout(4_000);
	});
	monque.register('demo-report', async () => {
		await setTimeout(6_000);
	});
	monque.register('demo-webhook', async (job) => {
		await setTimeout(3_000);
		if (job.failCount === 0) throw new Error('Demo webhook timed out; the next attempt succeeds.');
	});
	monque.register('demo-failure', async () => {
		await setTimeout(2_000);
		throw new Error('Demo failure: the destination is unavailable.');
	});
	monque.register('demo-batch', async (job) => {
		const batch = `${job._id}:${job.nextRunAt.toISOString()}`;
		await Promise.all(
			['demo-email', 'demo-report', 'demo-webhook', 'demo-failure'].map((name) =>
				monque.enqueue(name, { source: 'dashboard-demo', batch }, { uniqueKey: batch }),
			),
		);
	});
	await monque.schedule(
		'*/15 * * * * *',
		'demo-batch',
		{ source: 'dashboard-demo' },
		{
			uniqueKey: 'dashboard-demo-recurring',
		},
	);
	await monque.enqueue(
		'demo-batch',
		{ source: 'dashboard-demo' },
		{
			uniqueKey: 'dashboard-demo-startup',
		},
	);
	monque.start();
}

export { startDemoWorkload };
