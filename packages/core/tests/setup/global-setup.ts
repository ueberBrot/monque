import { MongoDBContainer } from '@testcontainers/mongodb';
import type { TestProject } from 'vitest/node';

/** One container per Vitest project; workers own only their client connections. */
export async function setup(project: TestProject): Promise<() => Promise<void>> {
	const reuse = process.env['TESTCONTAINERS_REUSE_ENABLE'] === 'true';
	const mongo = new MongoDBContainer('mongo:8');
	const container = await (reuse ? mongo.withReuse() : mongo).start();
	project.provide('coreMongoUri', container.getConnectionString());

	return async () => {
		if (!reuse) await container.stop();
	};
}
