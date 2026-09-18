import { defineConfig, devices } from '@playwright/test';

export default defineConfig<{ authenticated: boolean }>({
	testDir: './tests/real-db',
	outputDir: 'test-results',
	timeout: 30_000,
	workers: 2,
	fullyParallel: true,
	forbidOnly: Boolean(process.env['CI']),
	reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
	use: { trace: 'retain-on-failure', screenshot: 'only-on-failure', timezoneId: 'Europe/Berlin' },
	projects: [
		{ name: 'mongo-desktop', use: { ...devices['Desktop Chrome'] } },
		{ name: 'mongo-mobile', use: { ...devices['Pixel 7'] } },
		{ name: 'mongo-desktop-auth', use: { ...devices['Desktop Chrome'], authenticated: true } },
		{ name: 'mongo-mobile-auth', use: { ...devices['Pixel 7'], authenticated: true } },
	],
});
