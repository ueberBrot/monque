import { Injectable } from '@tsed/di';
import { PlatformTest } from '@tsed/platform-http/testing';
import { afterEach, describe, expect, it } from 'vitest';

import { InjectMonque } from '@/decorators/inject-monque';
import { MonqueService } from '@/services';

import { bootstrapMonque, resetMonque } from '../helpers/bootstrap.js';

@Injectable()
class TestService {
	constructor(@InjectMonque() public monque: MonqueService) {}
}

describe('@InjectMonque Integration', () => {
	afterEach(resetMonque);

	it('should inject MonqueService into a service via constructor', async () => {
		// Verify MonqueService is defined at runtime
		expect(MonqueService).toBeDefined();

		await bootstrapMonque({
			imports: [TestService],
			connectionStrategy: 'dbFactory',
		});

		const service = PlatformTest.get<TestService>(TestService);
		const monqueService = PlatformTest.get<MonqueService>(MonqueService);

		expect(service).toBeDefined();
		expect(monqueService).toBeDefined();

		// Check constructor injection
		expect(service.monque).toBeDefined();
		expect(service.monque).toBeInstanceOf(MonqueService);
		expect(service.monque).toBe(monqueService);
	});
});
