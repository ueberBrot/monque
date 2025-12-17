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

// Track if cleanup has already been performed
let cleanedUp = false;

async function cleanup(): Promise<void> {
	if (cleanedUp) return;
	cleanedUp = true;

	if (isMongoDbRunning()) {
		console.log('\n🛑 Stopping MongoDB Testcontainer...');
		await closeMongoDb();
		console.log('✅ MongoDB container stopped\n');
	}
}

export default async function globalSetup(): Promise<() => Promise<void>> {
	console.log('\n🚀 Starting MongoDB Testcontainer...');

	// Pre-start the container
	await getMongoDb();

	const uri = await getMongoUri();
	console.log(`✅ MongoDB ready at: ${uri}\n`);

	// Register signal handlers for cleanup on interruption
	const signals: NodeJS.Signals[] = ['SIGINT', 'SIGTERM', 'SIGHUP'];
	for (const signal of signals) {
		process.on(signal, async () => {
			console.log(`\n⚠️  Received ${signal}, cleaning up...`);
			await cleanup();
			process.exit(128 + (signal === 'SIGINT' ? 2 : signal === 'SIGTERM' ? 15 : 1));
		});
	}

	// Also handle uncaught exceptions
	process.on('uncaughtException', async (error) => {
		console.error('\n❌ Uncaught exception, cleaning up...', error);
		await cleanup();
		process.exit(1);
	});

	// Return teardown function
	return cleanup;
}
