import { MongoDBContainer } from '@testcontainers/mongodb';
import type { TestProject } from 'vitest/node';

/** Share the server across files; bootstrapMonque isolates databases and clients. */
export async function setup(project: TestProject): Promise<() => Promise<void>> {
	const container = await new MongoDBContainer('mongo:8').start();
	project.provide('tsedMongoUri', container.getConnectionString());
	return async () => {
		await container.stop();
	};
}
