import type { Job as JobType } from '@monque/core';
import { cleanupTestDb, getTestDb } from '@test-utils/index.js';
import { PlatformTest } from '@tsed/platform-http/testing';
import type { Db } from 'mongodb';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { Job, JobController } from '@/jobs';
import { MonqueModule } from '@/module';

interface TestPayload {
	value: string;
}

@JobController({ namespace: 'test' })
class TestModuleJobs {
	@Job('process-data')
	async processData(data: TestPayload, _job: JobType<TestPayload>): Promise<void> {
		data.value;
	}
}

describe('MonqueModule', () => {
	let db: Db;

	beforeAll(async () => {
		db = await getTestDb('monque-module');
	});

	afterAll(async () => {
		await cleanupTestDb(db);
	});

	beforeEach(async () => {
		await PlatformTest.create();
	});

	afterEach(async () => {
		await PlatformTest.reset();
	});

	describe('$onInit', () => {
		it('should discover job controller providers', async () => {
			const controller = PlatformTest.get<TestModuleJobs>(TestModuleJobs);

			expect(controller).toBeDefined();
			expect(controller).toBeInstanceOf(TestModuleJobs);
		});

		it('should skip initialization when config is not provided', async () => {
			const module = new MonqueModule();

			expect(module.isEnabled()).toBe(false);
			await module.$onInit();
			expect(module.getMonque()).toBeNull();
		});
	});

	describe('$onDestroy', () => {
		it('should stop monque on destroy', async () => {
			const module = new MonqueModule();

			await module.$onDestroy();
			expect(module.getMonque()).toBeNull();
		});
	});

	describe('getMonque', () => {
		it('should return null when not initialized', () => {
			const module = new MonqueModule();

			expect(module.getMonque()).toBeNull();
		});
	});
});
