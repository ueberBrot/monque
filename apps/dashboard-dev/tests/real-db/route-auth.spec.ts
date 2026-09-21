import type { FileRoutesByFullPath } from '@/routeTree.gen';

import { expect, test } from './fixture.js';

// Keep this matrix exhaustive when Dashboard routes are added. Only the route type is
// imported; the browser loads the built Dashboard through the fixture's Express adapter.
const dashboardRoutes = {
	'/': 'Queue Views',
	'/queue-views': 'Queue Views',
	'/queue-views/$name': 'email',
	'/jobs': 'Jobs',
	'/jobs/$jobId': 'email',
	'/health': 'Health',
} as const satisfies Record<keyof FileRoutesByFullPath, string>;

for (const [route, heading] of Object.entries(dashboardRoutes)) {
	test(`backend-served ${route} respects the host authentication setup`, async ({
		app,
		page,
		context,
		authenticated,
	}) => {
		const job = await app.seed({ name: 'email' });
		const path = route.replace('$jobId', job._id.toHexString()).replace('$name', job.name);
		const url = `${app.base}/dashboard${path}`;
		await context.clearCookies();

		if (authenticated) {
			const denied = await page.goto(url);
			expect(denied?.status()).toBe(401);
			await expect(page.locator('body')).toContainText('Sign in required');
			await expect(page.locator('main')).toHaveCount(0);
			expect((await context.request.head(url)).status()).toBe(401);
			expect(
				(
					await context.request.post(`${app.origin}/auth/login`, {
						data: { username: 'operator', password: 'fixture-password' },
					})
				).status(),
			).toBe(204);
		}

		const response = await page.goto(url);
		expect(response?.status()).toBe(200);
		expect(response?.headers()['content-type']).toContain('text/html');
		await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible();
		const mount = authenticated ? '/private' : '/open';
		expect(await page.evaluate(() => window.__MONQUE_DASHBOARD_CONFIG__)).toMatchObject({
			apiBaseUrl: mount,
			basePath: `${mount}/dashboard`,
			pollingIntervalMs: 500,
		});
		const asset = await page.locator('script[type="module"][src]').getAttribute('src');
		if (!asset) throw new Error('Missing built Dashboard asset');
		const assetUrl = new URL(asset, page.url());
		expect(assetUrl.pathname.startsWith(`${mount}/dashboard/assets/`)).toBe(true);
		expect((await context.request.get(assetUrl.href)).status()).toBe(200);

		if (authenticated) {
			const cookie = (await context.cookies()).find((cookie) => cookie.name === 'session');
			const session = app.sessions.get(cookie?.value ?? '');
			if (!session) throw new Error('Missing authenticated host session');
			session.expiresAt = Date.now() - 1;
			const denied = await page.goto(url);
			expect(denied?.status()).toBe(401);
			await expect(page.locator('body')).toContainText('Sign in required');
			await expect(page.locator('main')).toHaveCount(0);
			expect((await context.request.get(assetUrl.href)).status()).toBe(401);
		} else {
			expect(await context.cookies()).toEqual([]);
		}
	});
}
