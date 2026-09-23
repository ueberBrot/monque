import { expect, test } from './fixture.js';

for (const view of ['queue-views', 'queue-views/email', 'jobs', 'job-detail', 'health']) {
	test(`${view} shows its own skeleton without blocking navigation`, async ({ page, app }) => {
		const job = await app.seed();
		let release = () => {};
		const pending = new Promise<void>((resolve) => {
			release = resolve;
		});
		await page.route('**/api/v1/**', async (request) => {
			await pending;
			await request.continue();
		});
		const path = view === 'job-detail' ? `jobs/${job._id}` : view;
		await page.goto(`${app.base}/dashboard/${path}`);
		const label =
			view === 'queue-views'
				? 'Loading Queue Views…'
				: view === 'queue-views/email'
					? 'Loading Queue View…'
					: view === 'jobs'
						? 'Loading jobs…'
						: view === 'job-detail'
							? 'Loading job details…'
							: 'Loading Health…';
		const loading = page.getByRole('status', { name: label });
		await expect(loading).toBeVisible();
		await expect(page.getByRole('button', { name: /Commands/ })).toBeEnabled();
		expect(await loading.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(
			true,
		);
		release();
		await expect(loading).toHaveCount(0);
		const heading =
			view === 'queue-views'
				? 'Queue Views'
				: view === 'jobs'
					? 'Jobs'
					: view === 'health'
						? 'Health'
						: 'email';
		await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible();
	});
}
