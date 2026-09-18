import { expect, test } from './fixture.js';

// Run the same real-data workflows anonymously and after host login, on both viewport sizes.
test('queue overview and detail counts match mixed persisted states and live mutations', async ({
	page,
	app,
}) => {
	const jobs = await app.seedScenario('mixed');
	await page.goto(`${app.base}/dashboard/queue-views`);
	await expect(page.getByRole('link', { name: /^archived-queue/ })).toContainText(
		'Historical only',
	);
	await page.getByRole('link', { name: /^email/ }).click();
	await expect(page.getByText('Worker registered', { exact: true })).toBeVisible();
	for (const [label, status] of [
		['Pending', 'pending'],
		['Processing', 'processing'],
		['Completed', 'completed'],
		['Failed', 'failed'],
		['Cancelled', 'cancelled'],
	] as const) {
		const count = await app.jobs.countDocuments({ name: 'email', status });
		await expect(
			page.getByText(label, { exact: true }).first().locator('../..').locator('p'),
		).toHaveText(String(count));
	}
	const pending = jobs.find((job) => job.name === 'email' && job.status === 'pending');
	if (!pending) throw new Error('Mixed scenario missing pending email');
	await app.monque.cancelJob(pending._id.toHexString());
	await expect(
		page.getByText('Pending', { exact: true }).first().locator('../..').locator('p'),
	).toHaveText('2');
	await page.getByRole('link', { name: 'Filter and manage jobs' }).click();
	await expect(page.getByLabel('Job name', { exact: true })).toHaveValue('email');
	await expect(page.locator('tbody tr')).toHaveCount(15);
});

test('health follows scheduler start/stop and shows actual permissions', async ({ page, app }) => {
	await app.seedScenario('mutations');
	await page.goto(`${app.base}/dashboard/health`);
	await expect(page.getByRole('heading', { name: 'Scheduler unavailable' })).toBeVisible();
	await expect(page.getByText('8 of 8 available')).toBeVisible();
	app.monque.start();
	await expect(page.getByRole('heading', { name: 'Scheduler healthy' })).toBeVisible();
	await app.monque.stop();
	await expect(page.getByRole('heading', { name: 'Scheduler unavailable' })).toBeVisible();
	await page.goto(`${app.origin}/readonly/dashboard/health`);
	await expect(page.getByRole('heading', { name: 'Read-only access' })).toBeVisible();
	await expect(page.getByText('1 of 8 available')).toBeVisible();
});

for (const field of ['Created', 'Updated', 'Next run']) {
	test(`${field} date range controls include boundary values and restore from URL`, async ({
		page,
		app,
	}) => {
		await app.seedScenario('dates');
		await page.goto(`${app.base}/dashboard/jobs`);
		await page.getByRole('button', { name: /^Date filters/ }).click();
		for (const [suffix, time] of [
			['from', '12:01'],
			['to', '12:03'],
		]) {
			await page.getByRole('button', { name: `${field} ${suffix}`, exact: true }).click();
			await page.getByRole('textbox', { name: 'Date', exact: true }).fill('2026-06-01');
			await page.getByRole('textbox', { name: 'Time (24h)', exact: true }).fill(time ?? '');
			await page.getByRole('button', { name: 'Apply', exact: true }).click();
		}
		await expect(page.locator('tbody tr')).toHaveCount(3);
		await page.reload();
		await expect(page.locator('tbody tr')).toHaveCount(3);
		await page.getByRole('button', { name: 'Clear filters', exact: true }).click();
		await expect(page.locator('tbody tr')).toHaveCount(5);
	});
}

test('all sort fields order seeded records; visible headers change sort direction', async ({
	page,
	app,
	isMobile,
}) => {
	const jobs = await app.seedScenario('dates');
	const first = jobs[0];
	const last = jobs.at(-1);
	if (!first || !last) throw new Error('Date scenario is empty');
	for (const [field, label] of [
		['createdAt', 'Created time'],
		['updatedAt', 'Updated time'],
		['nextRunAt', 'Next run'],
		['identifier', 'Identifier'],
	]) {
		await page.goto(`${app.base}/dashboard/jobs?sortBy=${field}&sortDirection=asc`);
		await expect(page.locator('tbody a').first()).toHaveAttribute(
			'href',
			new RegExp(first._id.toHexString()),
		);
		if (isMobile) await page.goto(`${app.base}/dashboard/jobs?sortBy=${field}&sortDirection=desc`);
		else await page.getByRole('button', { name: label ?? '', exact: true }).click();
		await expect(page.locator('tbody a').first()).toHaveAttribute(
			'href',
			new RegExp(last._id.toHexString()),
		);
	}
});

test('page sizes, previous page, and changing filters clear stale selection', async ({
	page,
	app,
}) => {
	await app.seedScenario('pagination');
	await page.goto(`${app.base}/dashboard/jobs`);
	await page.getByRole('combobox', { name: 'Page size' }).click();
	await page.getByRole('option', { name: '25 rows', exact: true }).click();
	await expect(page.locator('tbody tr')).toHaveCount(25);
	const first = await page.locator('tbody a').first().getAttribute('href');
	await page
		.getByRole('checkbox', { name: /^Select job row / })
		.first()
		.check();
	await page.getByRole('button', { name: 'Next page', exact: true }).click();
	await expect(page.getByRole('button', { name: 'Delete selected jobs' })).toHaveCount(0);
	await page.getByRole('button', { name: 'Previous page', exact: true }).click();
	await expect(page.locator('tbody a').first()).toHaveAttribute('href', first ?? '');
	await page
		.getByRole('checkbox', { name: /^Select job row / })
		.first()
		.check();
	await page.getByRole('checkbox', { name: 'Failed', exact: true }).check();
	await expect(page.getByRole('heading', { name: 'No jobs found' })).toBeVisible();
	await expect(page.getByRole('button', { name: 'Delete selected jobs' })).toHaveCount(0);
});

test('row menus cancel, retry, reschedule and delete persisted jobs', async ({ page, app }) => {
	const jobs = await app.seedScenario('mutations');
	const target = jobs.at(-1);
	if (!target) throw new Error('Mutation scenario is empty');
	await page.goto(`${app.base}/dashboard/jobs`);
	const row = page.locator('tbody tr').filter({ has: page.locator(`a[href*="${target._id}"]`) });
	const menu = () => row.getByRole('button', { name: /^Actions for/ }).click();
	await menu();
	await page.getByRole('menuitem', { name: 'Cancel job', exact: true }).click();
	await expect
		.poll(async () => (await app.jobs.findOne({ _id: target._id }))?.status)
		.toBe('cancelled');
	await menu();
	await page.getByRole('menuitem', { name: 'Retry job', exact: true }).click();
	await expect
		.poll(async () => (await app.jobs.findOne({ _id: target._id }))?.status)
		.toBe('pending');
	await menu();
	await page.getByRole('menuitem', { name: 'Reschedule job', exact: true }).click();
	await page.getByRole('button', { name: 'Next run at', exact: true }).click();
	await page.getByRole('textbox', { name: 'Date', exact: true }).fill('2035-01-02');
	await page.getByRole('textbox', { name: 'Time (24h)', exact: true }).fill('12:00');
	await page.getByRole('button', { name: 'Apply', exact: true }).click();
	await page.getByRole('button', { name: 'Confirm reschedule job', exact: true }).click();
	await expect
		.poll(async () => (await app.jobs.findOne({ _id: target._id }))?.nextRunAt.toISOString())
		.toBe('2035-01-02T11:00:00.000Z');
	await menu();
	await page.getByRole('menuitem', { name: 'Delete job', exact: true }).click();
	await page.getByRole('button', { name: 'Confirm delete job', exact: true }).click();
	await expect(row).toHaveCount(0);
	expect(await app.jobs.countDocuments()).toBe(11);
});

test('bulk retry and reschedule operate on several selected records', async ({ page, app }) => {
	const jobs = await app.seedScenario('mutations');
	const failed = jobs.filter((job) => job.status === 'failed');
	const selected = failed.slice(0, 3);
	await page.goto(`${app.base}/dashboard/jobs?status=failed`);
	for (const job of selected)
		await page
			.locator('tbody tr')
			.filter({ has: page.locator(`a[href*="${job._id}"]`) })
			.getByRole('checkbox')
			.check();
	await page.getByRole('button', { name: 'Retry selected jobs' }).click();
	await page.getByRole('button', { name: 'Confirm retry selected jobs' }).click();
	await expect
		.poll(() =>
			app.jobs.countDocuments({ _id: { $in: selected.map((job) => job._id) }, status: 'pending' }),
		)
		.toBe(3);
	await page.goto(`${app.base}/dashboard/jobs?status=pending`);
	for (const job of selected)
		await page
			.locator('tbody tr')
			.filter({ has: page.locator(`a[href*="${job._id}"]`) })
			.getByRole('checkbox')
			.check();
	await page.getByRole('button', { name: 'Reschedule selected jobs' }).click();
	await page.getByRole('button', { name: 'Next run at', exact: true }).click();
	await page.getByRole('textbox', { name: 'Date', exact: true }).fill('2035-01-02');
	await page.getByRole('textbox', { name: 'Time (24h)', exact: true }).fill('12:00');
	await page.getByRole('button', { name: 'Apply', exact: true }).click();
	await page.getByRole('button', { name: 'Confirm reschedule selected jobs' }).click();
	await expect
		.poll(() => app.jobs.countDocuments({ nextRunAt: new Date('2035-01-02T11:00:00Z') }))
		.toBe(3);
	expect(await app.jobs.countDocuments({ status: 'failed' })).toBe(3);
});

test('clipboard controls copy persisted payload, ID, and mounted share URL', async ({
	page,
	app,
	context,
}) => {
	await context.grantPermissions(['clipboard-read', 'clipboard-write']);
	const jobs = await app.seedScenario('mixed');
	const job = jobs.find((job) => job.name === 'email' && job.repeatInterval);
	if (!job) throw new Error('Mixed scenario missing recurring job');
	await page.goto(`${app.base}/dashboard/jobs/${job._id}`);
	await expect(page.getByText('*/5 * * * *', { exact: true }).first()).toBeVisible();
	for (const [button, value] of [
		['Copy payload', JSON.stringify(job.data, null, 2)],
		['Copy job ID', job._id.toHexString()],
		['Copy shareable URL', page.url()],
	]) {
		const control = page.getByRole('button', { name: button ?? '', exact: true });
		await control.scrollIntoViewIfNeeded();
		const before = await control.boundingBox();
		await control.click();
		await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(value);
		expect(await control.boundingBox()).toEqual(before);
	}
});

test('commands, shortcuts, navigation and themes persist on the real server', async ({
	page,
	app,
	isMobile,
}) => {
	await app.seedScenario('mixed');
	await page.goto(`${app.base}/dashboard/jobs`);
	await expect(page.getByRole('heading', { name: 'Jobs', exact: true })).toBeVisible();
	await page.keyboard.press('Control+k');
	await page.getByRole('combobox', { name: 'Search commands' }).fill('Health');
	await page.keyboard.press('Enter');
	await expect(page.getByRole('heading', { name: 'Health', exact: true })).toBeVisible();
	if (isMobile) await page.getByRole('button', { name: 'Open navigation' }).click();
	await page.getByRole('link', { name: 'Queue Views', exact: true }).click();
	if (isMobile)
		await expect(page.getByRole('dialog', { name: 'Dashboard navigation' })).toHaveCount(0);
	await expect(page.getByRole('heading', { name: 'Queue Views', exact: true })).toBeVisible();
	await page.getByRole('button', { name: 'Change theme' }).click();
	await page.getByRole('menuitem', { name: 'Dark theme', exact: true }).click();
	await page.reload();
	await expect(page.getByRole('heading', { name: 'Queue Views', exact: true })).toBeVisible();
	await expect(page.locator('html')).toHaveClass(/dark/);
	await page.keyboard.press('Control+k');
	await page.getByRole('combobox', { name: 'Search commands' }).fill('Toggle theme');
	await page.keyboard.press('Enter');
	await expect(page.locator('html')).not.toHaveClass(/dark/);
	await app.seed({ name: 'new-queue' });
	await page.keyboard.press('Control+Shift+r');
	await expect(page.getByRole('link', { name: /^new-queue/ })).toBeVisible();
});

test('real retry backoff recovers and records attempts without duplicate effects', async ({
	page,
	app,
}) => {
	const job = await app.monque.enqueue('flaky', { work: 'retry' });
	await page.goto(`${app.base}/dashboard/jobs/${job._id}`);
	app.monque.start();
	await expect.poll(() => app.db.collection('attempts').countDocuments({ jobId: job._id })).toBe(1);
	await expect.poll(async () => (await app.monque.getJob(job._id))?.failCount).toBe(1);
	const retry = await app.jobs.findOne({ _id: job._id });
	expect(retry?.failCount).toBe(1);
	expect(retry?.status).toBe('pending');
	expect(retry?.nextRunAt.getTime()).toBeGreaterThan(job.nextRunAt.getTime());
	await expect(page.getByText('Completed', { exact: true })).toBeVisible();
	expect(await app.db.collection('attempts').countDocuments({ jobId: job._id })).toBe(2);
	expect(await app.db.collection('effects').countDocuments({ jobId: job._id })).toBe(1);
});

test('slow work shows its claim and completes without duplicate execution', async ({
	page,
	app,
}) => {
	const job = await app.monque.enqueue('slow', { work: 'observe processing' });
	await page.goto(`${app.base}/dashboard/jobs/${job._id}`);
	await expect(page.getByText('Pending', { exact: true })).toBeVisible();
	app.monque.start();
	await expect.poll(async () => (await app.monque.getJob(job._id))?.claimedBy).toBeTruthy();
	await expect(page.getByText('Processing', { exact: true })).toBeVisible();
	await expect(page.getByText('Completed', { exact: true })).toBeVisible();
	expect(await app.db.collection('effects').countDocuments({ jobId: job._id })).toBe(1);
	expect((await app.monque.getJob(job._id))?.claimedBy).toBeUndefined();
});

test('recurring work keeps its identity and schedules its next run after execution', async ({
	page,
	app,
}) => {
	const job = await app.seed({
		repeatInterval: '0 0 1 1 *',
		uniqueKey: 'annual',
		nextRunAt: new Date(0),
	});
	await page.goto(`${app.base}/dashboard/jobs/${job._id}`);
	await expect(page.getByText('0 0 1 1 *', { exact: true }).first()).toBeVisible();
	app.monque.start();
	await expect.poll(() => app.db.collection('effects').countDocuments({ jobId: job._id })).toBe(1);
	await expect
		.poll(async () => (await app.monque.getJob(job._id))?.nextRunAt.getTime() ?? 0)
		.toBeGreaterThan(Date.now());
	await page.reload();
	await expect(page.getByText('Pending', { exact: true })).toBeVisible();
	expect(await app.jobs.countDocuments({ uniqueKey: 'annual' })).toBe(1);
});

test('calendar day selection validates time, discards drafts and clears its filter', async ({
	page,
	app,
}) => {
	await app.seedScenario('dates');
	await page.goto(`${app.base}/dashboard/jobs`);
	await page.getByRole('button', { name: /^Date filters/ }).click();
	await page.getByRole('button', { name: 'Created from', exact: true }).click();
	await page.getByRole('textbox', { name: 'Date', exact: true }).fill('2026-06-01');
	await page.locator('[data-slot="calendar"] button[data-day="6/2/2026"]').click();
	await expect(page.getByRole('textbox', { name: 'Date', exact: true })).toHaveValue('2026-06-02');
	await page.getByRole('textbox', { name: 'Time (24h)', exact: true }).fill('25:00');
	await expect(page.getByRole('button', { name: 'Apply', exact: true })).toBeDisabled();
	await page.getByRole('textbox', { name: 'Time (24h)', exact: true }).fill('12:30');
	await page.getByRole('button', { name: 'Apply', exact: true }).click();
	await expect(page.getByRole('heading', { name: 'No jobs found', exact: true })).toBeVisible();
	await page.getByRole('button', { name: 'Created from', exact: true }).click();
	await page.getByRole('textbox', { name: 'Date', exact: true }).fill('2026-06-03');
	await page.keyboard.press('Escape');
	await expect(page.getByRole('button', { name: 'Created from', exact: true })).toContainText(
		'Jun 2, 2026',
	);
	await page.getByRole('button', { name: 'Created from', exact: true }).click();
	await page.getByRole('button', { name: 'Clear', exact: true }).click();
	await expect(page.locator('tbody tr')).toHaveCount(5);
	await expect(
		page.locator('input[type="datetime-local"], input[type="date"], input[type="time"]'),
	).toHaveCount(0);
});

test.describe('Operator timezone', () => {
	test.use({ timezoneId: 'America/New_York' });
	test('queue views, jobs, details and rescheduling use the same local timestamp', async ({
		page,
		app,
	}) => {
		const job = await app.seed({ nextRunAt: new Date('2035-06-01T10:00:00Z') });
		await page.goto(`${app.base}/dashboard/queue-views/email`);
		await expect(page.getByText(/Times in America\/New_York/)).toBeVisible();
		await expect(page.locator('tbody tr').first()).toContainText('Jun 1, 2035 at 06:00:00');
		await page.goto(`${app.base}/dashboard/jobs`);
		await expect(page.locator('tbody tr').first()).toContainText('Jun 1, 2035 at 06:00:00');
		await page.goto(`${app.base}/dashboard/jobs/${job._id}`);
		await expect(page.getByText('Jun 1, 2035 at 06:00:00', { exact: true }).first()).toBeVisible();
		await page.getByRole('button', { name: 'Reschedule', exact: true }).click();
		await page.getByRole('button', { name: 'Next run at', exact: true }).click();
		await expect(page.getByRole('textbox', { name: 'Time (24h)', exact: true })).toHaveValue(
			'06:00',
		);
		await page.getByRole('textbox', { name: 'Date', exact: true }).fill('2026-03-08');
		await page.getByRole('textbox', { name: 'Time (24h)', exact: true }).fill('02:30');
		await expect(page.getByRole('button', { name: 'Apply', exact: true })).toBeDisabled();
	});
});

test('select all and deselect all apply only to the current page', async ({
	page,
	app,
}, testInfo) => {
	await app.seedScenario('pagination');
	await page.goto(`${app.base}/dashboard/jobs?limit=25`);
	await expect(page.locator('tbody tr')).toHaveCount(25);
	const selectAll = page.getByRole('checkbox', {
		name: 'Select all jobs on this page',
		exact: true,
	});
	await selectAll.check();
	await expect(page.getByRole('checkbox', { name: /^Select job row /, checked: true })).toHaveCount(
		25,
	);
	await selectAll.uncheck();
	await expect(page.getByRole('checkbox', { name: /^Select job row /, checked: true })).toHaveCount(
		0,
	);
	await page
		.getByRole('checkbox', { name: /^Select job row / })
		.first()
		.check();
	await expect(selectAll).toHaveAttribute('aria-checked', 'mixed');
	await selectAll.check();
	await page.screenshot({ path: testInfo.outputPath('page-selection.png'), fullPage: true });
	await page.getByRole('button', { name: 'Cancel selected jobs', exact: true }).click();
	await page.getByRole('button', { name: 'Confirm cancel selected jobs', exact: true }).click();
	await expect.poll(() => app.jobs.countDocuments({ status: 'cancelled' })).toBe(25);
	expect(await app.jobs.countDocuments({ status: 'pending' })).toBe(100);
});

test('copied filter and cursor URL opens the same results in a fresh browser session', async ({
	page,
	app,
	context,
	browser,
	authenticated,
	isMobile,
}) => {
	await app.seedScenario('pagination');
	await context.grantPermissions(['clipboard-read', 'clipboard-write']);
	await page.goto(`${app.base}/dashboard/jobs?sortBy=identifier&sortDirection=asc`);
	await page.getByLabel('Job name', { exact: true }).fill('email');
	await page.getByRole('checkbox', { name: 'Pending', exact: true }).check();
	await page.getByRole('combobox', { name: 'Page size' }).click();
	await page.getByRole('option', { name: '25 rows', exact: true }).click();
	await page.getByRole('button', { name: /^Date filters/ }).click();
	for (const [field, date] of [
		['Created', '2026-06-01'],
		['Updated', '2026-06-01'],
		['Next run', '2035-06-01'],
	]) {
		for (const suffix of ['from', 'to']) {
			await page.getByRole('button', { name: `${field} ${suffix}`, exact: true }).click();
			await page.getByRole('textbox', { name: 'Date', exact: true }).fill(date ?? '');
			await page.getByRole('textbox', { name: 'Time (24h)', exact: true }).fill('12:00');
			await page.getByRole('button', { name: 'Apply', exact: true }).click();
		}
	}
	await expect(page.locator('tbody tr')).toHaveCount(25);
	const first = await page.locator('tbody a').first().getAttribute('href');
	await page.getByRole('button', { name: 'Next page', exact: true }).click();
	await expect(page.locator('tbody a').first()).not.toHaveAttribute('href', first ?? '');
	const links = await page
		.locator('tbody a')
		.evaluateAll((elements) => elements.map((element) => element.getAttribute('href')));
	await page
		.getByRole('checkbox', { name: /^Select job row / })
		.first()
		.check();
	await page.getByRole('button', { name: /^Commands/ }).click();
	await page.getByRole('combobox', { name: 'Search commands' }).fill('Copy page URL');
	await page.keyboard.press('Enter');
	await expect(page.getByText('Page URL copied', { exact: true })).toBeVisible();
	const copied = await page.evaluate(() => navigator.clipboard.readText());
	expect(copied).toBe(page.url());
	expect(new URL(copied).searchParams.has('cursor')).toBe(true);
	const recipient = await browser.newContext({
		viewport: page.viewportSize(),
		isMobile,
		timezoneId: 'Europe/Berlin',
	});
	try {
		if (authenticated) {
			expect((await recipient.request.get(copied)).status()).toBe(401);
			expect(
				(
					await recipient.request.post(`${app.origin}/auth/login`, {
						data: { username: 'viewer', password: 'fixture-password' },
					})
				).status(),
			).toBe(204);
		}
		const sharedPage = await recipient.newPage();
		await sharedPage.goto(copied);
		await expect(sharedPage.locator('tbody tr')).toHaveCount(25);
		expect(
			await sharedPage
				.locator('tbody a')
				.evaluateAll((elements) => elements.map((element) => element.getAttribute('href'))),
		).toEqual(links);
		await expect(sharedPage.getByLabel('Job name', { exact: true })).toHaveValue('email');
		await expect(sharedPage.getByRole('checkbox', { name: 'Pending', exact: true })).toBeChecked();
		await expect(sharedPage.getByRole('combobox', { name: 'Page size' })).toContainText('25');
		await expect(
			sharedPage.getByRole('checkbox', { name: /^Select job row /, checked: true }),
		).toHaveCount(0);
		await sharedPage.getByRole('button', { name: /^Date filters/ }).click();
		for (const field of ['Created', 'Updated', 'Next run']) {
			for (const suffix of ['from', 'to'])
				await expect(
					sharedPage.getByRole('button', { name: `${field} ${suffix}`, exact: true }),
				).toContainText('Jun 1');
		}
	} finally {
		await recipient.close();
	}
});

test('preserves the investigation filters and cursor through job detail and reload', async ({
	page,
	app,
}) => {
	await app.seedScenario('pagination');
	await page.goto(
		`${app.base}/dashboard/jobs?name=email&limit=10&status=%5B%22pending%22%5D&sortBy=createdAt&sortDirection=asc`,
	);
	await page.getByRole('button', { name: 'Next page', exact: true }).click();
	const listUrl = page.url();
	const query = Object.fromEntries(new URL(listUrl).searchParams);
	await page.locator('tbody a').first().click();
	expect(Object.fromEntries(new URL(page.url()).searchParams)).toEqual(query);
	await page.reload();
	await page.getByRole('link', { name: 'Back to jobs' }).click();
	await expect(page).toHaveURL((url) => url.pathname.endsWith('/jobs'));
	expect(Object.fromEntries(new URL(page.url()).searchParams)).toEqual(query);
	await expect(page.getByLabel('Job name', { exact: true })).toHaveValue('email');
	await expect(page.locator('tbody tr')).toHaveCount(10);
});

test('queue job inspection returns to the originating queue page', async ({ page, app }) => {
	await app.seedScenario('pagination');
	await page.goto(`${app.base}/dashboard/queue-views/email?limit=10`);
	await page.getByRole('button', { name: 'Next page', exact: true }).click();
	const query = Object.fromEntries(new URL(page.url()).searchParams);
	await page.locator('tbody a').first().click();
	await page.reload();
	await page.getByRole('link', { name: 'Back to email' }).click();
	await expect(page).toHaveURL((url) => url.pathname.endsWith('/queue-views/email'));
	expect(Object.fromEntries(new URL(page.url()).searchParams)).toEqual(query);
	await expect(page.locator('tbody tr')).toHaveCount(10);
});

test('job identity, failure diagnosis and disabled action explanations remain accessible', async ({
	page,
	app,
	isMobile,
}) => {
	const jobs = await app.seedScenario('mixed');
	const job = jobs.find((entry) => entry.status === 'failed' && entry.name === 'email');
	if (!job) throw new Error('Missing failed job');
	const id = job._id.toHexString();
	await page.goto(`${app.base}/dashboard/jobs?name=email&status=%5B%22failed%22%5D`);
	const row = page
		.locator('tbody tr')
		.filter({ has: page.getByRole('checkbox', { name: `Select job row email ${id}` }) });
	await expect(row).toBeVisible();
	if (isMobile) {
		await expect(row.getByText(`…${id.slice(-8)}`, { exact: true })).toBeVisible();
		await expect(row.getByTitle('Created', { exact: true })).toBeVisible();
	}
	await row.getByRole('link').click();
	const failure = page.getByRole('heading', { name: 'Failure reason', exact: true });
	await expect(failure).toBeInViewport();
	await expect(page.getByText('Scheduled for', { exact: true })).toBeVisible();
	await page.getByRole('button', { name: 'Why are actions unavailable?' }).click();
	await expect(
		page.getByText('Cancel: Only pending jobs can be cancelled.', { exact: true }),
	).toBeVisible();
	await page.getByRole('button', { name: 'Delete job', exact: true }).click();
	await expect(page.getByRole('dialog').getByText(id, { exact: true })).toBeVisible();
	await expect(page.getByRole('dialog').getByText('email', { exact: true })).toBeVisible();
	await page.getByRole('button', { name: 'Keep current state' }).click();
	expect(await app.jobs.countDocuments({ _id: job._id })).toBe(1);
});

test('workspace keeps navigation and theme visible while the job list scrolls', async ({
	page,
	app,
	isMobile,
}) => {
	await app.seedScenario('pagination');
	await page.goto(`${app.base}/dashboard/jobs`);
	await expect(page.locator('tbody tr')).toHaveCount(50);
	const theme = page.getByRole('button', { name: 'Change theme', exact: true });
	await expect(theme).toBeInViewport();
	const before = await theme.boundingBox();
	if (!isMobile) {
		await page.locator('#app').evaluate((root) => {
			const toolbar = document.createElement('div');
			toolbar.textContent = 'Host toolbar';
			toolbar.style.cssText = 'height:85px;flex-shrink:0';
			root.prepend(toolbar);
		});
		await expect(theme).toBeInViewport();
	}
	await page.locator('#main-content').evaluate((element) => {
		element.scrollTop = element.scrollHeight;
	});
	await expect(page.getByRole('button', { name: 'Next page', exact: true })).toBeInViewport();
	await expect(theme).toBeInViewport();
	expect(await theme.boundingBox()).toEqual(before);
	expect(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight)).toBe(
		true,
	);
	if (isMobile) {
		const menu = await page.getByRole('button', { name: 'Open navigation' }).boundingBox();
		expect(menu?.width).toBeGreaterThanOrEqual(44);
		expect(menu?.height).toBeGreaterThanOrEqual(44);
	}
});

test('health exposes refresh progress and preserves last observation while offline', async ({
	page,
	app,
	context,
}) => {
	await page.goto(`${app.base}/dashboard/health`);
	await expect(page.getByText('Updated just now', { exact: true })).toBeVisible();
	await context.setOffline(true);
	await page.getByRole('button', { name: 'Refresh', exact: true }).click();
	await expect(page.getByText(/Updates paused while offline/)).toBeVisible();
	await context.setOffline(false);
	await expect(page.getByText(/Updates paused while offline/)).toHaveCount(0);
	await expect(page.getByText('Updated just now', { exact: true })).toBeVisible();
});
