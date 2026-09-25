import { MongoClient } from 'mongodb';
import { inject } from 'vitest';

declare module 'vitest' {
	export interface ProvidedContext {
		coreMongoUri: string;
	}
}

let clientPromise: Promise<MongoClient> | undefined;

/** Share one connected client within a test file, including concurrent callers. */
export function getMongoClient(): Promise<MongoClient> {
	if (!clientPromise) {
		const uri = inject('coreMongoUri');
		if (!uri) throw new Error('MongoDB global setup has not provided coreMongoUri');
		const client = new MongoClient(uri, { directConnection: true });
		clientPromise = client.connect().catch(async (error: unknown) => {
			clientPromise = undefined;
			await client.close();
			throw error;
		});
	}
	return clientPromise;
}

/** Called after the file's suites have stopped schedulers and dropped their databases. */
export async function closeMongoDb(): Promise<void> {
	const pending = clientPromise;
	clientPromise = undefined;
	if (pending) await (await pending).close();
}
