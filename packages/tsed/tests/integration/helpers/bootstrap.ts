import { Provider, type TokenProvider } from '@tsed/di';
import { MongooseModule, MongooseService } from '@tsed/mongoose';
import { PlatformTest } from '@tsed/platform-http/testing';
import { TestContainersMongo } from '@tsed/testcontainers-mongo';
import { type Db, MongoClient } from 'mongodb';

import type { MonqueTsedConfig } from '@/config';
import { ProviderTypes } from '@/constants';
import { MonqueModule } from '@/monque-module';

import { Server } from './Server.js';

type ConnectionStrategy = 'dbFactory' | 'db' | 'mongoose';

interface MonqueTestOptions {
	imports?: unknown[];
	monqueConfig?: Partial<MonqueTsedConfig>;
	connectionStrategy?: ConnectionStrategy;
}

let client: MongoClient | null = null;
let db: Db | null = null;

function uniqueDbName(): string {
	return `test_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export async function bootstrapMonque(options: MonqueTestOptions = {}): Promise<void> {
	const { url } = await TestContainersMongo.startMongoServer('mongo:8');

	const { imports = [], monqueConfig = {}, connectionStrategy = 'dbFactory' } = options;

	const dbName = uniqueDbName();
	let dbConfig: Partial<MonqueTsedConfig> = {};
	const extraImports: unknown[] = [];
	const platformOptions: Record<string, unknown> = {};

	switch (connectionStrategy) {
		case 'dbFactory':
			dbConfig = {
				dbFactory: async () => {
					client = new MongoClient(url, { directConnection: true });
					await client.connect();
					db = client.db(dbName);
					return db;
				},
			};
			break;

		case 'db':
			client = new MongoClient(url, { directConnection: true });
			await client.connect();
			db = client.db(dbName);
			dbConfig = { db };
			break;

		case 'mongoose':
			extraImports.push(MongooseModule);
			platformOptions['mongoose'] = [
				{
					id: 'default',
					url: `${url}/${dbName}`,
					connectionOptions: { directConnection: true },
				},
			];
			dbConfig = {
				dbToken: MongooseService as unknown as TokenProvider<Db>,
				mongooseConnectionId: 'default',
			};
			break;
	}

	const bstrp = PlatformTest.bootstrap(Server, {
		...platformOptions,
		imports: [MonqueModule, ...extraImports, ...imports],
		monque: {
			enabled: true,
			safetyPollInterval: 500, // Fast safety poll for tests
			...dbConfig,
			...monqueConfig,
		},
	});

	await bstrp();
}

export async function resetMonque(): Promise<void> {
	// Drop the unique db to clean up test data before closing the connection
	if (db) {
		await db.dropDatabase();
	}

	await PlatformTest.reset();
	if (client) {
		await client.close();
		client = null;
		db = null;
	}

	// Clean up GlobalProviders to prevent leaking test controllers
	Provider.Registry.forEach((provider, key) => {
		if (
			provider.type === ProviderTypes.JOB_CONTROLLER &&
			provider.token.name.startsWith('Ephemeral')
		) {
			Provider.Registry.delete(key);
		}
	});
}

export function getTestDb(): Db {
	if (db) return db;

	try {
		const mongooseService = PlatformTest.get<MongooseService>(MongooseService);
		if (mongooseService) {
			const conn = mongooseService.get('default');
			if (conn?.db) return conn.db as unknown as Db;
		}
	} catch (_e) {
		// Ignore
	}

	throw new Error('Test database not initialized or not accessible');
}
