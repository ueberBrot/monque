// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DashboardShell } from '@/components/dashboard-shell';

describe('DashboardShell', () => {
	afterEach(() => {
		cleanup();
	});

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

		const dialogContent = getDialogContent();

		expect(screen.getByText('Dashboard navigation')).toBeTruthy();
		expect(dialogContent.classList.contains('top-0')).toBe(true);
		expect(dialogContent.classList.contains('bottom-0')).toBe(true);
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

	it('opens the command palette from the keyboard and runs safe view actions only', async () => {
		const clipboardWriteText = vi.fn(async () => undefined);

		Object.defineProperty(window.navigator, 'clipboard', {
			configurable: true,
			value: {
				writeText: clipboardWriteText,
			},
		});

		render(
			<DashboardShell currentPath="/jobs">
				<div>Route content</div>
			</DashboardShell>,
		);

		dispatchKeyboardEvent({ key: 'k', metaKey: true });

		await waitFor(() => {
			expect(getCommandSearchInput()).toBeTruthy();
		});
		expect(screen.getAllByText('Copy current URL').length).toBeGreaterThan(0);
		expect(screen.getAllByText('Toggle theme').length).toBeGreaterThan(0);
		expect(screen.queryAllByText('Delete job')).toHaveLength(0);

		fireEvent.click(getLastElement(screen.getAllByText('Copy current URL')));

		await waitFor(() => {
			expect(clipboardWriteText).toHaveBeenCalledWith(window.location.href);
		});

		expect(
			screen.queryAllByLabelText('Search commands').every((element) => !isVisibleElement(element)),
		).toBe(true);
	});

	it('opens the command palette with slash but ignores slash while typing', async () => {
		render(
			<DashboardShell currentPath="/jobs">
				<div>Route content</div>
				<input aria-label="Standalone filter" />
			</DashboardShell>,
		);

		dispatchKeyboardEvent({ key: '/' });
		await waitFor(() => {
			expect(getCommandSearchInput()).toBeTruthy();
		});

		dispatchKeyboardEvent({ key: 'Escape' });

		await waitFor(() => {
			expect(
				screen
					.queryAllByLabelText('Search commands')
					.every((element) => !isVisibleElement(element)),
			).toBe(true);
		});

		const standaloneFilter = screen.getByLabelText('Standalone filter');
		standaloneFilter.focus();

		standaloneFilter.dispatchEvent(new KeyboardEvent('keydown', { key: '/', bubbles: true }));

		expect(
			screen.queryAllByLabelText('Search commands').every((element) => !isVisibleElement(element)),
		).toBe(true);
	});

	it('opens shortcut help with keyboard input and restores focus on close', async () => {
		render(
			<DashboardShell currentPath="/health">
				<div>Route content</div>
			</DashboardShell>,
		);

		const shortcutButton = getLastElement(
			screen.getAllByRole('button', { name: 'Open keyboard shortcuts' }),
		);
		shortcutButton.focus();

		dispatchKeyboardEvent({ key: '?', shiftKey: true });

		await waitFor(() => {
			expect(screen.getAllByText('Keyboard shortcuts').length).toBeGreaterThan(0);
		});
		expect(screen.getAllByText('Refresh current view').length).toBeGreaterThan(0);

		dispatchKeyboardEvent({ key: 'Escape' });

		await waitFor(() => {
			expect(document.activeElement).toBe(shortcutButton);
		});
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

function getDialogContent(): HTMLElement {
	const dialogContent = screen
		.getByText('Dashboard navigation')
		.closest('[data-slot="dialog-content"]');

	if (!(dialogContent instanceof HTMLElement)) {
		throw new Error('Expected dashboard navigation to be inside dialog content.');
	}

	return dialogContent;
}

function getCommandSearchInput(): HTMLInputElement {
	const commandSearchInput = screen
		.getAllByLabelText('Search commands')
		.find((element) => element instanceof HTMLInputElement && element.tabIndex !== -1);

	if (!(commandSearchInput instanceof HTMLInputElement)) {
		throw new Error('Expected a visible command search input.');
	}

	return commandSearchInput;
}

function isVisibleElement(element: Element): boolean {
	return !element.closest('[aria-hidden="true"]');
}

function getLastElement<TElement>(elements: readonly TElement[]): TElement {
	const lastElement = elements[elements.length - 1];

	if (!lastElement) {
		throw new Error('Expected at least one matching element.');
	}

	return lastElement;
}

function dispatchKeyboardEvent(init: KeyboardEventInit): void {
	document.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, ...init }));
}
