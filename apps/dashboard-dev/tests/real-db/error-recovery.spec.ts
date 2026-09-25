import { expect, test } from './fixture.js';

for (const route of [
	'queue-views',
	'queue-views/email',
	'health',
	'jobs?name=email',
	'job-detail',
]) {
	for (const status of [401, 403, 500]) {
		test(`${route} recovers from ${status} in place`, async ({ page, app }) => {
			const job = await app.seed();
			const path = route === 'job-detail' ? `jobs/${job._id}` : route;
			let failed = true;
			let release = () => {};
			const recovery = new Promise<void>((resolve) => {
				release = resolve;
			});
			await page.route('**/api/v1/**', async (request) => {
				if (failed) {
					await request.fulfill({ status, json: { error: 'Host rejected the request.' } });
				} else {
					await recovery;
					await request.continue();
				}
			});
			await page.goto(`${app.base}/dashboard/${path}`);
			await expect(page.getByRole('alert')).toContainText('Host rejected the request.');
			if (status === 403 && route.startsWith('queue-views')) {
				await expect(page.getByRole('heading', { name: 'Access denied' })).toBeVisible();
			}
			const url = page.url();
			failed = false;
			await page.getByRole('button', { name: 'Retry', exact: true }).click();
			await expect(page.getByRole('status', { name: /^Loading/ })).toBeVisible();
			await expect(page.getByRole('button', { name: 'Retry', exact: true })).toHaveCount(0);
			release();
			const heading =
				route === 'queue-views'
					? 'Queue Views'
					: route === 'health'
						? 'Health'
						: route.startsWith('jobs?')
							? 'Jobs'
							: 'email';
			await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible();
			await expect(page.getByRole('alert')).toHaveCount(0);
			await expect(page).toHaveURL(url);
			if (route === 'job-detail') {
				await expect(page.getByRole('button', { name: 'Cancel', exact: true })).toBeEnabled();
			}
		});
	}
}

test('invalid route search offers a working way back to Queue Views', async ({ page, app }) => {
	await app.seed();
	await page.goto(`${app.base}/dashboard/queue-views/email?limit=not-a-number`);
	await expect(page.getByRole('heading', { name: 'Dashboard route failed' })).toBeVisible();
	await page.getByRole('link', { name: 'Go to Queue Views' }).click();
	await expect(page.getByRole('heading', { name: 'Queue Views', exact: true })).toBeVisible();
	await expect(page).toHaveURL(`${app.base}/dashboard/queue-views`);
});

test('unknown routes offer mount-aware navigation back to Queue Views', async ({ page, app }) => {
	await page.goto(`${app.base}/dashboard/unknown-page`);
	await expect(page.getByRole('heading', { name: 'Route not found' })).toBeVisible();
	await page.getByRole('link', { name: 'Go to Queue Views' }).click();
	await expect(page.getByRole('heading', { name: 'Queue Views', exact: true })).toBeVisible();
});

test('invalid browser configuration renders a startup error instead of a blank page', async ({
	page,
	app,
}) => {
	await page.addInitScript(() => {
		let config: unknown;
		Object.defineProperty(window, '__MONQUE_DASHBOARD_CONFIG__', {
			get: () =>
				sessionStorage.getItem('configuration-repaired')
					? config
					: { apiBaseUrl: 'http://[', basePath: '/dashboard' },
			set: (value: unknown) => {
				config = value;
			},
		});
	});
	await page.goto(`${app.base}/dashboard/jobs`);
	await expect(page.getByRole('heading', { name: 'Dashboard configuration error' })).toBeVisible();
	await page.evaluate(() => sessionStorage.setItem('configuration-repaired', 'true'));
	await page.getByRole('button', { name: 'Reload page' }).click();
	await expect(page.getByRole('heading', { name: 'No jobs found', exact: true })).toBeVisible();
});
