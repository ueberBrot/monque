/**
 * Vitest global setup - pre-starts MongoDB container and returns teardown.
 *
 * This runs once before all test files. Starting the container here
 * reduces cold-start time for the first test file.
 *
 * The returned function is called after all tests complete for cleanup.
 *
 * Note: The container will be started lazily on first getMongoDb() call
 * if not started here, so this is optional but improves test startup experience.
 */

import { closeMongoDb, getMongoDb, getMongoUri, isMongoDbRunning } from './mongodb.js';

export default async function globalSetup(): Promise<() => Promise<void>> {
	console.log('\n🚀 Starting MongoDB Testcontainer...');

	// Pre-start the container
	await getMongoDb();

	const uri = await getMongoUri();
	console.log(`✅ MongoDB ready at: ${uri}\n`);

	// Return teardown function
	return async () => {
		if (isMongoDbRunning()) {
			console.log('\n🛑 Stopping MongoDB Testcontainer...');
			await closeMongoDb();
			console.log('✅ MongoDB container stopped\n');
		}
	};
}
