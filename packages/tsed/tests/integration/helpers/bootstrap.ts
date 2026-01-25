import type { TokenProvider } from '@tsed/di';
import { MongooseModule, MongooseService } from '@tsed/mongoose';
import { PlatformTest } from '@tsed/platform-http/testing';
import { TestContainersMongo } from '@tsed/testcontainers-mongo';
import { type Db, MongoClient } from 'mongodb';

import type { MonqueTsedConfig } from '@/config';
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

export async function bootstrapMonque(options: MonqueTestOptions = {}): Promise<void> {
	// Start mongo server explicitly to ensure we get valid config
	const config = await TestContainersMongo.startMongoServer();
	const mongoOptions = Array.isArray(config) ? config[0] : config;

	const { imports = [], monqueConfig = {}, connectionStrategy = 'dbFactory' } = options;

	let dbConfig: Partial<MonqueTsedConfig> = {};
	const extraImports: unknown[] = [];
	const platformOptions: Record<string, unknown> = {};

	switch (connectionStrategy) {
		case 'dbFactory':
			dbConfig = {
				dbFactory: async () => {
					client = new MongoClient(mongoOptions.url, { directConnection: true });
					await client.connect();
					db = client.db('test');
					return db;
				},
			};
			break;

		case 'db':
			client = new MongoClient(mongoOptions.url, { directConnection: true });
			await client.connect();
			db = client.db('test');
			dbConfig = { db };
			break;

		case 'mongoose':
			extraImports.push(MongooseModule);
			platformOptions['mongoose'] = [
				{
					id: 'default',
					url: mongoOptions.url,
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
			...dbConfig,
			...monqueConfig,
		},
	});

	await bstrp();

	// Clean database to ensure test isolation
	if (client) {
		await client.db('test').dropDatabase();
	}
}

export async function resetMonque(): Promise<void> {
	await PlatformTest.reset();
	if (client) {
		await client.close();
		client = null;
		db = null;
	}
}

export function getTestDb(): Db {
	if (db) return db;

	try {
		const mongooseService = PlatformTest.get<MongooseService>(MongooseService);
		if (mongooseService) {
			const conn = mongooseService.get('default');
			if (conn?.db) return conn.db;
		}
	} catch (_e) {
		// Ignore
	}

	throw new Error('Test database not initialized or not accessible');
}
