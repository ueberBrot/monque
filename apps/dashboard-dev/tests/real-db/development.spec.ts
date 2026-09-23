import { expect, test } from './fixture.js';

test.afterEach(async ({ app }, testInfo) => {
	if (testInfo.status === testInfo.expectedStatus) return;
	await testInfo.attach('development-jobs', {
		body: JSON.stringify(
			await app.db
				.collection('monque_dashboard_jobs')
				.find({ name: /^demo-/ })
				.toArray(),
			null,
			2,
		),
		contentType: 'application/json',
	});
});

test('development MongoDB mode starts its scheduler and processes live demo jobs', async ({
	page,
	app,
}) => {
	test.setTimeout(60_000);
	const base = `${app.origin}/development/dashboard`;
	await page.goto(`${base}/health`);
	await expect(page.getByRole('heading', { name: 'Scheduler healthy' })).toBeVisible();
	await page.goto(`${base}/jobs?name=demo-report&sortBy=createdAt&sortDirection=desc`);
	await expect(page.locator('tbody tr').first()).toContainText('Processing', { timeout: 15_000 });
	const reportLink = await page.locator('tbody tr').first().getByRole('link').getAttribute('href');
	if (!reportLink) throw new Error('Missing report job link');
	const reportRow = page
		.locator('tbody tr')
		.filter({ has: page.locator(`a[href="${reportLink}"]`) });
	await expect(reportRow).toContainText('Completed', { timeout: 15_000 });
	await page.goto(`${base}/jobs?name=demo-failure`);
	await expect(page.locator('tbody')).toContainText('Failed', { timeout: 20_000 });
	await page.goto(`${base}/jobs?name=demo-webhook`);
	await expect(page.locator('tbody')).toContainText('Completed', { timeout: 15_000 });
	const jobs = app.db.collection('monque_dashboard_jobs');
	expect(
		await jobs.countDocuments({ name: 'demo-webhook', status: 'completed', failCount: 1 }),
	).toBeGreaterThan(0);
	await expect
		.poll(() => jobs.countDocuments({ name: 'demo-report' }), { timeout: 20_000 })
		.toBeGreaterThan(1);
	const recurring = await jobs.findOne({ name: 'demo-batch', repeatInterval: { $exists: true } });
	expect(recurring?.['nextRunAt']).toBeInstanceOf(Date);
	await app.development.close();
	await page.goto(`${base}/health`);
	await expect(page.getByRole('heading', { name: 'Scheduler healthy' })).toBeVisible();
	expect(
		await jobs.countDocuments({
			name: 'demo-batch',
			repeatInterval: { $exists: true },
			status: { $in: ['pending', 'processing'] },
		}),
	).toBe(1);
});
