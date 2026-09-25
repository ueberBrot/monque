import { Store } from '@tsed/core';
import { Provider, ProviderScope } from '@tsed/di';
import { describe, expect, it } from 'vitest';

import { MONQUE, ProviderTypes } from '@/constants';
import { JobController } from '@/decorators';

describe('@JobController', () => {
	it('registers a singleton job controller with empty job metadata', () => {
		@JobController()
		class TestJob {}

		const provider = Provider.Registry.get(TestJob);
		expect(provider?.type).toBe(ProviderTypes.JOB_CONTROLLER);
		expect(provider?.scope).toBe(ProviderScope.SINGLETON);
		expect(Store.from(TestJob).get(MONQUE)).toEqual({
			type: 'controller',
			jobs: [],
			cronJobs: [],
		});
	});

	it('stores the supplied namespace', () => {
		@JobController('email')
		class EmailJob {}

		expect(Store.from(EmailJob).get(MONQUE)).toMatchObject({ namespace: 'email' });
	});
});
