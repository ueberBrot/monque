import { fileURLToPath } from 'node:url';
import { defineConfig, devices } from '@playwright/test';

const dashboardDevAppDirectory = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
	testDir: './tests/smoke',
	timeout: 30_000,
	use: {
		baseURL: 'http://127.0.0.1:3400',
		trace: 'on-first-retry',
	},
	projects: [
		{
			name: 'desktop-chromium',
			use: { ...devices['Desktop Chrome'] },
		},
		{
			name: 'mobile-chromium',
			use: { ...devices['Pixel 7'] },
		},
	],
	webServer: {
		command: 'bun run dev',
		port: 3400,
		reuseExistingServer: !process.env['CI'],
		cwd: dashboardDevAppDirectory,
		env: {
			MONQUE_DASHBOARD_DEV_MODE: 'mock',
			MONQUE_DASHBOARD_DEV_SCENARIO: 'pending-jobs',
		},
	},
});
