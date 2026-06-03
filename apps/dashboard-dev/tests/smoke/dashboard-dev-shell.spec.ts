import { expect, test } from '@playwright/test';

test('loads the mock shell and switches scenarios on desktop', async ({ page, isMobile }) => {
	test.skip(isMobile, 'Desktop-only smoke.');

	await page.goto('/');

	await expect(page.getByRole('heading', { name: 'Queue Views' })).toBeVisible();
	await expect(page.getByTestId('dashboard-dev-shell')).toContainText('Mock Management API');
	await expect(page.getByTestId('scenario-summary')).toContainText('Queue Views');
	await expect(page.getByRole('button', { name: 'Command palette', exact: true })).toBeVisible();

	await page.getByLabel('Scenario').selectOption('large-dataset');

	await expect(page.getByTestId('dashboard-dev-shell')).toContainText('Large dataset');

	await page.getByRole('button', { name: 'Command palette', exact: true }).click();
	await page.locator('button', { hasText: 'Health' }).last().click();

	await expect(page.getByRole('heading', { level: 1, name: 'Health' })).toBeVisible();
});

test('keeps navigation usable on mobile', async ({ page, isMobile }) => {
	test.skip(!isMobile, 'Mobile-only smoke.');

	await page.goto('/');
	await page.getByRole('button', { name: 'Open navigation' }).click();
	await page.getByRole('link', { name: 'Health' }).click();

	await expect(page.getByRole('heading', { level: 1, name: 'Health' })).toBeVisible();
	await expect(page.getByTestId('dashboard-dev-shell')).toBeVisible();
});
