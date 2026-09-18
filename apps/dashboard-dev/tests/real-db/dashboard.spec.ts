import type { Page } from '@playwright/test';
import { ObjectId } from 'mongodb';

import { expect, test } from './fixture.js';

async function chooseDate(page: Page, label: string, date: string, time: string): Promise<void> {
	await page.getByRole('button', { name: label, exact: true }).click();
	await page.getByRole('textbox', { name: 'Date', exact: true }).fill(date);
	await page.getByRole('textbox', { name: 'Time (24h)', exact: true }).fill(time);
	await page.getByRole('button', { name: 'Apply', exact: true }).click();
}

test('empty database, no matches, malformed and missing identifiers', async ({ page, app }) => {
	await page.goto(`${app.base}/dashboard/jobs`);
	await expect(page.getByRole('heading', { name: 'No jobs found' })).toBeVisible();
	const job = await app.seed();
	await page.reload();
	await expect(page.locator('tbody tr')).toHaveCount(1);
	await page.getByLabel('Job name', { exact: true }).fill('missing');
	await expect(page.getByRole('heading', { name: 'No jobs found' })).toBeVisible();
	await page.goto(`${app.base}/dashboard/jobs/invalid-id`);
	await expect(page.getByText('Invalid job id', { exact: true })).toBeVisible();
	for (const id of [new ObjectId().toHexString()]) {
		await page.goto(`${app.base}/dashboard/jobs/${id}`);
		await expect(page.getByRole('heading', { name: 'Job not found' })).toBeVisible();
	}
	expect(await app.jobs.countDocuments({ _id: job._id })).toBe(1);
});

test('deep-link reload, legacy null fields, long payload, and layout', async ({ page, app }) => {
	const text = `<script>window.__payloadExecuted = true</script>${'long-payload-'.repeat(100)}`;
	const job = await app.seed({ data: { text } });
	await app.db
		.collection('jobs')
		.updateOne(
			{ _id: job._id },
			{ $set: { heartbeatInterval: null, repeatInterval: null, uniqueKey: null } },
		);
	await page.goto(`${app.base}/dashboard/jobs/${job._id}`);
	await expect(page.getByRole('heading', { name: 'email', exact: true })).toBeVisible();
	await page.reload();
	await expect(page.getByRole('heading', { name: 'Payload', exact: true })).toBeVisible();
	const favicon = await page.locator('link[rel="icon"]').getAttribute('href');
	if (!favicon) throw new Error('Missing dashboard favicon');
	const faviconResponse = await page.request.get(new URL(favicon, page.url()).href);
	expect(faviconResponse.ok()).toBe(true);
	expect(faviconResponse.headers()['content-type']).toContain('image/svg+xml');
	await expect(page.locator('img:visible').first()).toHaveJSProperty('naturalWidth', 4096);
	expect(await page.evaluate(() => Object.hasOwn(window, '__payloadExecuted'))).toBe(false);
	expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
	const response = await page.request.get(`${app.base}/api/v1/jobs/${job._id}`);
	expect(response.status()).toBe(200);
	expect(await response.json()).not.toHaveProperty('heartbeatInterval');
});

test('cancel is persisted and idempotent; retry resets failure state', async ({ page, app }) => {
	const job = await app.seed();
	await page.goto(`${app.base}/dashboard/jobs/${job._id}`);
	await page.getByRole('button', { name: 'Cancel', exact: true }).click();
	await expect
		.poll(async () => (await app.jobs.findOne({ _id: job._id }))?.status)
		.toBe('cancelled');
	const repeated = await page.request.post(`${app.base}/api/v1/jobs/${job._id}/actions/cancel`);
	expect(repeated.status()).toBe(200);
	await app.jobs.updateOne(
		{ _id: job._id },
		{ $set: { status: 'failed', failCount: 3, failReason: 'real failure' } },
	);
	await page.reload();
	await page.getByRole('button', { name: 'Retry', exact: true }).click();
	await expect.poll(async () => (await app.jobs.findOne({ _id: job._id }))?.status).toBe('pending');
	const persisted = await app.jobs.findOne({ _id: job._id });
	expect(persisted?.failCount).toBe(0);
	expect(persisted?.failReason).toBeFalsy();
	await page.reload();
	await expect(page.getByText('Pending', { exact: true })).toBeVisible();
});

test('rescheduling validates DST and persists local time as UTC', async ({ page, app }) => {
	const job = await app.seed();
	await page.goto(`${app.base}/dashboard/jobs/${job._id}`);
	await page.getByRole('button', { name: 'Reschedule', exact: true }).click();
	await page.getByRole('button', { name: 'Next run at', exact: true }).click();
	await page.getByRole('textbox', { name: 'Date', exact: true }).fill('2027-03-28');
	await page.getByRole('textbox', { name: 'Time (24h)', exact: true }).fill('02:30');
	await expect(page.getByRole('button', { name: 'Apply', exact: true })).toBeDisabled();
	await page.getByRole('textbox', { name: 'Time (24h)', exact: true }).fill('03:30');
	await page.getByRole('button', { name: 'Apply', exact: true }).click();
	await page.getByRole('button', { name: 'Confirm reschedule job', exact: true }).click();
	await expect
		.poll(async () => (await app.jobs.findOne({ _id: job._id }))?.nextRunAt.toISOString())
		.toBe('2027-03-28T01:30:00.000Z');
	await page.reload();
	await expect(page.getByText('Mar 28, 2027 at 03:30:00', { exact: true })).toBeVisible();
});

test('delete dismissal preserves data; confirmation removes it and handles reload', async ({
	page,
	app,
}) => {
	const job = await app.seed();
	await page.goto(
		`${app.base}/dashboard/jobs/${job._id}?name=email&limit=10&sortBy=updatedAt&sortDirection=asc`,
	);
	await page.getByRole('button', { name: 'Delete job', exact: true }).click();
	await page.getByRole('button', { name: 'Keep current state' }).click();
	expect(await app.jobs.countDocuments()).toBe(1);
	await page.getByRole('button', { name: 'Delete job', exact: true }).click();
	await page.getByRole('button', { name: 'Confirm delete job', exact: true }).click();
	await expect(page).toHaveURL(/\/dashboard\/jobs(?:\?|$)/);
	await expect(page.getByRole('heading', { name: 'No jobs found' })).toBeVisible();
	expect(await app.jobs.countDocuments()).toBe(0);
	const search = new URL(page.url()).searchParams;
	expect(search.get('name')).toBe('email');
	expect(search.get('limit')).toBe('10');
	expect(search.get('sortBy')).toBe('updatedAt');
	expect(search.get('sortDirection')).toBe('asc');
	await page.reload();
	await expect(page).toHaveURL(/\/dashboard\/jobs(?:\?|$)/);
	await expect(page.getByRole('heading', { name: 'No jobs found' })).toBeVisible();
});

test('cursor pagination with tied dates neither skips nor repeats jobs', async ({ page, app }) => {
	await app.seedScenario('pagination');
	await page.goto(`${app.base}/dashboard/jobs`);
	await expect(page.locator('tbody tr')).toHaveCount(50);
	const first = await page
		.locator('tbody a')
		.evaluateAll((links) =>
			links.map((link) => new URL(link.getAttribute('href') ?? '', window.location.href).pathname),
		);
	await page
		.getByRole('checkbox', { name: /^Select job row / })
		.first()
		.check();
	await page.getByRole('button', { name: 'Next page', exact: true }).click();
	await expect(page.locator('tbody tr')).toHaveCount(50);
	const second = await page
		.locator('tbody a')
		.evaluateAll((links) =>
			links.map((link) => new URL(link.getAttribute('href') ?? '', window.location.href).pathname),
		);
	expect(new Set([...first, ...second]).size).toBe(100);
	await expect(page.getByRole('button', { name: 'Delete selected jobs' })).toHaveCount(0);
	await page.reload();
	await expect(page.locator('tbody tr')).toHaveCount(50);
});

test('date boundaries, combined statuses, URL restoration, and clearing filters', async ({
	page,
	app,
}) => {
	await app.seed({ createdAt: new Date('2026-06-01T09:59:59Z') });
	await app.seed({ status: 'failed', createdAt: new Date('2026-06-01T10:00:00Z') });
	await app.seed({ createdAt: new Date('2026-06-01T10:01:00Z') });
	await app.seed({ status: 'completed', createdAt: new Date('2026-06-01T10:00:30Z') });
	await page.goto(`${app.base}/dashboard/jobs`);
	await page.getByRole('checkbox', { name: 'Pending', exact: true }).check();
	await page.getByRole('checkbox', { name: 'Failed', exact: true }).check();
	await page.getByRole('button', { name: /^Date filters/ }).click();
	await chooseDate(page, 'Created from', '2026-06-01', '12:00');
	await chooseDate(page, 'Created to', '2026-06-01', '12:01');
	await expect(page.locator('tbody tr')).toHaveCount(2);
	await page.reload();
	await expect(page.locator('tbody tr')).toHaveCount(2);
	await expect(page.getByRole('checkbox', { name: 'Failed', exact: true })).toBeChecked();
	await page.getByRole('button', { name: 'Clear filters', exact: true }).click();
	await expect(page.locator('tbody tr')).toHaveCount(4);
});

test('mixed selection disables invalid actions; bulk deletion affects selected IDs only', async ({
	page,
	app,
}) => {
	await app.seed();
	await app.seed({ status: 'failed' });
	const untouched = await app.seed();
	await page.goto(`${app.base}/dashboard/jobs`);
	await page
		.getByRole('checkbox', { name: /^Select job row / })
		.nth(1)
		.check();
	await page
		.getByRole('checkbox', { name: /^Select job row / })
		.nth(2)
		.check();
	await expect(page.getByRole('button', { name: 'Cancel selected jobs' })).toBeDisabled();
	await expect(page.getByRole('button', { name: 'Retry selected jobs' })).toBeDisabled();
	await page.getByRole('button', { name: 'Delete selected jobs' }).click();
	await page.getByRole('button', { name: 'Confirm delete selected jobs' }).click();
	await expect(page.locator('tbody tr')).toHaveCount(1);
	expect(await app.jobs.countDocuments()).toBe(1);
	expect(await app.jobs.findOne({ _id: untouched._id })).not.toBeNull();
});

test('bulk conflict reports partial success and preserves a job claimed by another worker', async ({
	page,
	app,
}) => {
	await page.clock.install();
	const claimed = await app.seed();
	const cancelled = await app.seed();
	const untouched = await app.seed();
	await page.goto(`${app.base}/dashboard/jobs`);
	await page
		.getByRole('checkbox', { name: /^Select job row / })
		.nth(1)
		.check();
	await page
		.getByRole('checkbox', { name: /^Select job row / })
		.nth(2)
		.check();
	await page.getByRole('button', { name: 'Cancel selected jobs' }).click();
	await app.jobs.updateOne(
		{ _id: claimed._id },
		{ $set: { status: 'processing', claimedBy: 'other-worker' } },
	);
	await page.getByRole('button', { name: 'Confirm cancel selected jobs' }).click();
	await expect(page.getByText(/1 succeeded, 1 failed/)).toBeVisible();
	await page.clock.fastForward(6_000);
	await expect(page.getByText(/1 succeeded, 1 failed/)).toBeVisible();
	await page.getByRole('button', { name: 'Dismiss message' }).click();
	await expect(page.getByText(/1 succeeded, 1 failed/)).not.toBeVisible();
	expect((await app.jobs.findOne({ _id: claimed._id }))?.status).toBe('processing');
	expect((await app.jobs.findOne({ _id: cancelled._id }))?.status).toBe('cancelled');
	expect((await app.jobs.findOne({ _id: untouched._id }))?.status).toBe('pending');
});

test('deletion by another operator is reflected without reloading', async ({ page, app }) => {
	const job = await app.seed();
	await page.goto(`${app.base}/dashboard/jobs/${job._id}`);
	await expect(page.getByRole('heading', { name: 'email', exact: true })).toBeVisible();
	await app.jobs.deleteOne({ _id: job._id });
	await expect(page.getByRole('heading', { name: 'Job not found' })).toBeVisible();
});

test('read-only surface blocks UI and all mutation endpoints', async ({ page, app }) => {
	const job = await app.seed();
	await page.goto(`${app.origin}/readonly/dashboard/jobs/${job._id}`);
	for (const action of ['Cancel', 'Retry', 'Reschedule', 'Delete job']) {
		await expect(page.getByRole('button', { name: action, exact: true })).toBeDisabled();
	}
	for (const action of ['cancel', 'retry', 'reschedule']) {
		const response = await page.request.post(
			`${app.origin}/readonly/api/v1/jobs/${job._id}/actions/${action}`,
			{ data: { nextRunAt: '2035-01-01T00:00:00Z' } },
		);
		expect(response.status()).toBe(403);
	}
	expect(
		(await page.request.delete(`${app.origin}/readonly/api/v1/jobs/${job._id}`)).status(),
	).toBe(403);
	expect((await app.jobs.findOne({ _id: job._id }))?.status).toBe('pending');
});

test('optional authentication protects assets and APIs; viewer policy and session expiry work', async ({
	page,
	app,
	context,
}) => {
	await context.clearCookies();
	const job = await app.seed();
	for (const path of ['/private/dashboard/', '/private/api/v1/jobs', '/private/openapi.json']) {
		expect((await page.request.get(`${app.origin}${path}`)).status()).toBe(401);
	}
	await context.addCookies([
		{ name: 'session', value: app.viewer, url: app.origin, httpOnly: true },
	]);
	await page.goto(`${app.origin}/private/dashboard/jobs/${job._id}`);
	await expect(page.getByRole('button', { name: 'Delete job', exact: true })).toBeDisabled();
	expect(
		(
			await page.request.post(`${app.origin}/private/api/v1/jobs/${job._id}/actions/cancel`)
		).status(),
	).toBe(403);
	await context.addCookies([
		{ name: 'session', value: app.operator, url: app.origin, httpOnly: true },
	]);
	await page.reload();
	await page.getByRole('button', { name: 'Cancel', exact: true }).click();
	await expect
		.poll(async () => (await app.jobs.findOne({ _id: job._id }))?.status)
		.toBe('cancelled');
	const asset = await page.locator('script[type="module"][src]').getAttribute('src');
	expect(asset).toBeTruthy();
	app.sessions.delete(app.operator);
	await expect(page.getByRole('heading', { name: 'Sign in required' })).toBeVisible();
	expect((await page.request.get(new URL(asset ?? '', app.origin).href)).status()).toBe(401);
});

test('invalid cursor and mutation inputs return errors without changing persistence', async ({
	page,
	app,
}) => {
	const job = await app.seed();
	expect((await page.request.get(`${app.base}/api/v1/jobs?cursor=invalid`)).status()).toBe(400);
	expect(
		(
			await page.request.post(`${app.base}/api/v1/jobs/${job._id}/actions/reschedule`, {
				data: { nextRunAt: '2026-02-30T10:00:00Z' },
			})
		).status(),
	).toBe(400);
	expect((await app.jobs.findOne({ _id: job._id }))?.nextRunAt).toEqual(job.nextRunAt);
	await page.goto(`${app.base}/dashboard/jobs?cursor=invalid`);
	await expect(page.getByText(/Invalid cursor/)).toBeVisible();
	await page.getByRole('button', { name: 'Clear filters', exact: true }).click();
	await expect(page.locator('tbody tr')).toHaveCount(1);
});

test('actual workers complete and fail jobs while the dashboard polls', async ({ page, app }) => {
	const success = await app.monque.enqueue('email', { work: 'execute' });
	const failure = await app.monque.enqueue('fails', { work: 'fail' });
	await page.goto(`${app.base}/dashboard/jobs/${success._id}`);
	await expect(page.getByText('Pending', { exact: true })).toBeVisible();
	app.monque.start();
	await expect(page.getByText('Completed', { exact: true })).toBeVisible();
	await expect
		.poll(async () => (await app.jobs.findOne({ _id: failure._id }))?.status)
		.toBe('failed');
	await page.goto(`${app.base}/dashboard/jobs/${failure._id}`);
	await expect(page.getByText('Failed', { exact: true })).toBeVisible();
	await expect(page.getByText('intentional e2e worker failure', { exact: true })).toBeVisible();
});

test('bulk retry and reschedule persist only the selected jobs', async ({ page, app }) => {
	const untouched = await app.seed({ status: 'failed', failCount: 2 });
	const selected = await app.seed({ status: 'failed', failCount: 2 });
	await page.goto(`${app.base}/dashboard/jobs`);
	await page
		.getByRole('checkbox', { name: /^Select job row / })
		.first()
		.check();
	await page.getByRole('button', { name: 'Retry selected jobs' }).click();
	await page.getByRole('button', { name: 'Confirm retry selected jobs' }).click();
	await expect
		.poll(async () => (await app.jobs.findOne({ _id: selected._id }))?.status)
		.toBe('pending');
	await page.getByRole('button', { name: 'Clear filters', exact: true }).click();
	await page.getByRole('checkbox', { name: 'Pending', exact: true }).check();
	await expect(page.locator('tbody tr')).toHaveCount(1);
	await page.getByRole('checkbox', { name: /^Select job row / }).check();
	await page.getByRole('button', { name: 'Reschedule selected jobs' }).click();
	await chooseDate(page, 'Next run at', '2035-01-02', '12:30');
	await page.getByRole('button', { name: 'Confirm reschedule selected jobs' }).click();
	await expect
		.poll(async () => (await app.jobs.findOne({ _id: selected._id }))?.nextRunAt.toISOString())
		.toBe('2035-01-02T11:30:00.000Z');
	expect((await app.jobs.findOne({ _id: untouched._id }))?.status).toBe('failed');
	expect((await app.jobs.findOne({ _id: untouched._id }))?.nextRunAt).toEqual(untouched.nextRunAt);
});

test('database disconnect shows a recoverable error and reconnect restores jobs', async ({
	page,
	app,
}) => {
	await app.seed();
	await app.client.close();
	await page.goto(`${app.base}/dashboard/jobs`);
	await expect(page.getByRole('heading', { name: 'Jobs failed to load' })).toBeVisible();
	await app.client.connect();
	await page.getByRole('button', { name: 'Retry', exact: true }).click();
	await expect(page.locator('tbody tr')).toHaveCount(1);
});

test('sorting changes database order and restored URLs retain the sort', async ({ page, app }) => {
	const oldest = await app.seed({ createdAt: new Date('2026-01-01T00:00:00Z') });
	const newest = await app.seed({ createdAt: new Date('2026-06-01T00:00:00Z') });
	await page.goto(`${app.base}/dashboard/jobs`);
	await expect(page.locator('tbody a').first()).toHaveAttribute(
		'href',
		new RegExp(newest._id.toHexString()),
	);
	// Date columns are hidden on phones; the same persisted sort remains available through the URL.
	await page.goto(`${app.base}/dashboard/jobs?sortBy=createdAt&sortDirection=asc`);
	await expect(page.locator('tbody a').first()).toHaveAttribute(
		'href',
		new RegExp(oldest._id.toHexString()),
	);
	await page.reload();
	await expect(page.locator('tbody a').first()).toHaveAttribute(
		'href',
		new RegExp(oldest._id.toHexString()),
	);
});

test('concurrent cancellation requests remain idempotent in MongoDB', async ({ page, app }) => {
	const job = await app.seed();
	const url = `${app.base}/api/v1/jobs/${job._id}/actions/cancel`;
	const responses = await Promise.all([page.request.post(url), page.request.post(url)]);
	expect(responses.map((response) => response.status())).toEqual([200, 200]);
	expect(await app.jobs.countDocuments({ _id: job._id, status: 'cancelled' })).toBe(1);
	await page.goto(`${app.base}/dashboard/jobs/${job._id}`);
	await expect(page.getByText('Cancelled', { exact: true })).toBeVisible();
});
