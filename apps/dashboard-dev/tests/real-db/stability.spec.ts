import { expect, test } from './fixture.js';

test('success notifications expire without shifting the jobs table', async ({ page, app }) => {
	const job = await app.seed();
	await page.clock.install();
	await page.goto(`${app.base}/dashboard/jobs`);
	await expect(page.locator('tbody tr')).toHaveCount(1);
	await page.getByRole('button', { name: `Actions for ${job._id}` }).click();
	const before = await page.locator('thead').boundingBox();
	await page.getByRole('menuitem', { name: 'Cancel job', exact: true }).click();
	await expect(page.getByText('Job cancelled', { exact: true })).toBeVisible();
	expect(await page.locator('thead').boundingBox()).toEqual(before);
	await page.clock.fastForward(6_000);
	await expect(page.getByText('Job cancelled', { exact: true })).not.toBeVisible();
	expect(await page.locator('thead').boundingBox()).toEqual(before);
});

test('an open row action menu survives polling and clock ticks', async ({ page, app }) => {
	const job = await app.seed();
	await page.goto(`${app.base}/dashboard/jobs`);
	await page.getByRole('button', { name: `Actions for ${job._id}` }).click();
	await expect(page.getByRole('menu')).toBeVisible();
	await app.jobs.updateOne({ _id: job._id }, { $set: { status: 'completed' } });
	await expect(page.locator('tbody')).toContainText('Completed');
	await expect(page.getByRole('menu')).toBeVisible();
	await expect(page.getByRole('menuitem', { name: 'Cancel job', exact: true })).toBeDisabled();
	await page.getByRole('menuitem', { name: 'Delete job', exact: true }).click();
	await expect(page.getByRole('dialog')).toBeVisible();
});

for (const route of ['queue-views/email', 'jobs']) {
	test(`${route} column geometry stays stable when persisted statuses change`, async ({
		page,
		app,
	}) => {
		const job = await app.seed();
		await app.jobs.updateOne({ _id: job._id }, { $set: { status: 'failed' } });
		await page.goto(`${app.base}/dashboard/${route}`);
		await expect(page.locator('tbody tr')).toHaveCount(1);
		await expect(page.locator('tbody')).toContainText('Failed');
		const geometry = () =>
			page.locator('thead th').evaluateAll((cells) =>
				cells.map((cell) => {
					const { x, width } = cell.getBoundingClientRect();
					return { x, width };
				}),
			);
		const before = await geometry();
		await app.jobs.updateOne(
			{ _id: job._id },
			{ $set: { status: 'processing', updatedAt: new Date() } },
		);
		await expect(page.locator('tbody')).toContainText('Processing');
		expect(await geometry()).toEqual(before);
	});
}

test('deleting a job returns to its originating queue view', async ({ page, app }) => {
	const job = await app.seed();
	await page.goto(`${app.base}/dashboard/queue-views/email?limit=10`);
	await page.getByRole('link', { name: job._id.toHexString(), exact: true }).click();
	await page.getByRole('button', { name: 'Delete job', exact: true }).click();
	await page.getByRole('button', { name: 'Confirm delete job', exact: true }).click();
	await expect(page).toHaveURL(/\/queue-views\/email\?limit=10$/);
	await expect(page.getByText('No persisted jobs match this Queue View right now.')).toBeVisible();
});

test('job detail polls its record without polling the hidden jobs list', async ({ page, app }) => {
	const job = await app.seed();
	const requests: string[] = [];
	page.on('request', (request) => {
		if (request.method() === 'GET') requests.push(new URL(request.url()).pathname);
	});
	await page.goto(`${app.base}/dashboard/jobs/${job._id}`);
	await expect(page.getByRole('heading', { name: job.name, exact: true })).toBeVisible();
	await expect
		.poll(() => requests.filter((path) => path.endsWith(`/jobs/${job._id}`)).length)
		.toBeGreaterThanOrEqual(3);
	expect(requests.filter((path) => path.endsWith('/api/v1/jobs'))).toEqual([]);
});
