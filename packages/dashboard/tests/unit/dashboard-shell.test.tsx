// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { DashboardShell } from '@/components/dashboard-shell.js';

describe('DashboardShell', () => {
	it('renders primary navigation and opens the mobile drawer', () => {
		render(
			<DashboardShell currentPath="/queue-views">
				<div>Route content</div>
			</DashboardShell>,
		);

		expect(screen.getAllByText('Queue Views').length).toBeGreaterThan(0);
		expect(screen.getAllByText('Jobs').length).toBeGreaterThan(0);
		expect(screen.getAllByText('Health').length).toBeGreaterThan(0);
		expect(screen.queryByText('Dashboard navigation')).toBeNull();

		fireEvent.click(screen.getByRole('button', { name: 'Open navigation' }));

		expect(screen.getByText('Dashboard navigation')).toBeTruthy();
		expect(screen.getByText('Route content')).toBeTruthy();
	});

	it('lets the operator switch theme modes', () => {
		render(
			<DashboardShell currentPath="/jobs">
				<div>Route content</div>
			</DashboardShell>,
		);

		fireEvent.click(getThemeButton());
		fireEvent.click(screen.getByRole('menuitem', { name: 'Dark theme' }));

		expect(document.documentElement.classList.contains('dark')).toBe(true);

		fireEvent.click(getThemeButton());
		fireEvent.click(screen.getByRole('menuitem', { name: 'System theme' }));

		expect(document.documentElement.classList.contains('dark')).toBe(false);
	});
});

function getThemeButton(): HTMLElement {
	const themeButtons = screen.getAllByRole('button', { name: 'Change theme' });
	const firstThemeButton = themeButtons[0];

	if (!firstThemeButton) {
		throw new Error('Expected at least one theme button.');
	}

	return firstThemeButton;
}
