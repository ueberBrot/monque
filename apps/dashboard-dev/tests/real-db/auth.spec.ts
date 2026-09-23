import { expect, test } from './fixture.js';

test('host login rejects bad credentials, protects assets, and logout invalidates all tabs', async ({
	page,
	app,
	context,
}) => {
	await app.seedScenario('mixed');
	await context.clearCookies();
	const login = (password: string) =>
		context.request.post(`${app.origin}/auth/login`, {
			data: { username: 'operator', password },
		});
	expect((await login('incorrect')).status()).toBe(401);
	expect(await context.cookies()).toEqual([]);
	for (const path of ['/private/dashboard/jobs', '/private/api/v1/jobs', '/private/openapi.json'])
		expect((await context.request.get(`${app.origin}${path}`)).status()).toBe(401);
	expect((await login('fixture-password')).status()).toBe(204);
	const cookie = (await context.cookies()).find((cookie) => cookie.name === 'session');
	if (!cookie) throw new Error('Login did not set session cookie');
	expect(cookie).toMatchObject({ httpOnly: true, sameSite: 'Strict', path: '/' });
	await page.goto(`${app.origin}/private/dashboard/jobs`);
	await expect(page.locator('tbody tr')).toHaveCount(45);
	const asset = await page.locator('script[type="module"][src]').getAttribute('src');
	if (!asset) throw new Error('Missing production JavaScript asset');
	const assetUrl = new URL(asset, page.url()).href;
	expect((await context.request.get(assetUrl)).status()).toBe(200);
	const secondTab = await context.newPage();
	await secondTab.goto(`${app.origin}/private/dashboard/health`);
	await expect(secondTab.getByRole('heading', { name: 'Health', exact: true })).toBeVisible();
	expect((await context.request.post(`${app.origin}/auth/logout`)).status()).toBe(204);
	await expect(page.getByRole('heading', { name: 'Sign in required' })).toBeVisible();
	await expect(secondTab.getByRole('heading', { name: 'Authentication required' })).toBeVisible();
	for (const value of [cookie.value, `${cookie.value}-tampered`]) {
		await context.addCookies([{ ...cookie, value }]);
		expect((await context.request.get(assetUrl)).status()).toBe(401);
		expect((await context.request.get(`${app.origin}/private/api/v1/jobs`)).status()).toBe(401);
	}
	expect((await login('fixture-password')).status()).toBe(204);
	await page.getByRole('button', { name: 'Retry', exact: true }).click();
	await expect(page.locator('tbody tr')).toHaveCount(45);
	await secondTab.getByRole('button', { name: 'Retry', exact: true }).click();
	await expect(secondTab.getByRole('heading', { name: 'Health', exact: true })).toBeVisible();
	await secondTab.close();
});

test('expired sessions stop reads and mutations; fresh login restores access', async ({
	page,
	app,
	context,
}) => {
	const job = await app.seed();
	await context.clearCookies();
	const login = () =>
		context.request.post(`${app.origin}/auth/login`, {
			data: { username: 'operator', password: 'fixture-password' },
		});
	expect((await login()).status()).toBe(204);
	await page.goto(`${app.origin}/private/dashboard/jobs/${job._id}`);
	await expect(page.getByRole('button', { name: 'Cancel', exact: true })).toBeEnabled();
	const cookie = (await context.cookies()).find((cookie) => cookie.name === 'session');
	const session = app.sessions.get(cookie?.value ?? '');
	if (!session) throw new Error('Missing server session');
	session.expiresAt = Date.now() - 1;
	await expect(page.getByRole('heading', { name: 'Sign in required' })).toBeVisible();
	expect(
		(
			await context.request.post(`${app.origin}/private/api/v1/jobs/${job._id}/actions/cancel`)
		).status(),
	).toBe(401);
	expect((await app.monque.getJob(job._id))?.status).toBe('pending');
	expect((await login()).status()).toBe(204);
	await page.getByRole('button', { name: 'Retry', exact: true }).click();
	await page.getByRole('button', { name: 'Cancel', exact: true }).click();
	await expect(page.getByText('Cancelled', { exact: true })).toBeVisible();
});

test('viewer login denies every mutation and revoked read permission produces access denied', async ({
	page,
	app,
	context,
}) => {
	const jobs = await app.seedScenario('mutations');
	const job = jobs.at(-1);
	if (!job) throw new Error('Missing mutation job');
	await context.clearCookies();
	expect(
		(
			await context.request.post(`${app.origin}/auth/login`, {
				data: { username: 'viewer', password: 'fixture-password' },
			})
		).status(),
	).toBe(204);
	await page.goto(`${app.origin}/private/dashboard/jobs/${job._id}`);
	for (const action of ['Cancel', 'Retry', 'Reschedule', 'Delete job'])
		await expect(page.getByRole('button', { name: action, exact: true })).toBeDisabled();
	for (const action of ['cancel', 'retry', 'reschedule'])
		expect(
			(
				await context.request.post(
					`${app.origin}/private/api/v1/jobs/${job._id}/actions/${action}`,
					{
						data: { nextRunAt: '2035-01-01T00:00:00Z' },
					},
				)
			).status(),
		).toBe(403);
	expect(
		(await context.request.delete(`${app.origin}/private/api/v1/jobs/${job._id}`)).status(),
	).toBe(403);
	for (const action of ['cancel', 'retry', 'delete'])
		expect(
			(
				await context.request.post(`${app.origin}/private/api/v1/jobs/actions/${action}`, {
					data: { name: 'email' },
				})
			).status(),
		).toBe(403);
	expect(await app.jobs.countDocuments()).toBe(12);
	expect((await app.monque.getJob(job._id))?.status).toBe('pending');
	const cookie = (await context.cookies()).find((cookie) => cookie.name === 'session');
	const session = app.sessions.get(cookie?.value ?? '');
	if (!session) throw new Error('Missing viewer session');
	session.role = 'blocked';
	await expect(page.getByRole('heading', { name: 'Job detail is forbidden' })).toBeVisible();
	expect((await context.request.get(`${app.origin}/private/api/v1/jobs`)).status()).toBe(403);
});
