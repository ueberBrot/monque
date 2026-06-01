import { MongoDBContainer, type StartedMongoDBContainer } from '@testcontainers/mongodb';

let container: StartedMongoDBContainer | null = null;
let containerPromise: Promise<StartedMongoDBContainer> | null = null;

export async function getMongoUrl(): Promise<string> {
	if (!containerPromise) {
		containerPromise = new MongoDBContainer('mongo:8').start().catch((error: unknown) => {
			containerPromise = null;
			throw error;
		});
	}

	container = await containerPromise;

	return container.getConnectionString();
}

export async function stopMongoContainer(): Promise<void> {
	if (!container) return;

	await container.stop();
	container = null;
	containerPromise = null;
}
