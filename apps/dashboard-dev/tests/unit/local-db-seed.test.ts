import { describe, expect, it } from 'vitest';

import { createSeedJobs } from '../../src/local-db/management-server.js';

describe('dashboard dev local db seed jobs', () => {
	it('uses stable unique keys for every seed job', () => {
		const seedJobs = createSeedJobs();
		const uniqueKeys = seedJobs.map((job) => job.uniqueKey);

		expect(uniqueKeys).toHaveLength(seedJobs.length);
		expect(new Set(uniqueKeys).size).toBe(seedJobs.length);
		expect(uniqueKeys).not.toContain(undefined);
	});
});
