import { LaptopMinimal, Menu, Moon, Sun } from 'lucide-react';
import { Fragment, type ReactElement, type ReactNode, useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';

const THEME_STORAGE_KEY = 'monque-dashboard-theme';

const dashboardNavItems = [
	{ href: '/queue-views', label: 'Queue Views' },
	{ href: '/jobs', label: 'Jobs' },
	{ href: '/health', label: 'Health' },
] as const;

const dashboardThemeModes = ['light', 'dark', 'system'] as const;

type DashboardNavItem = (typeof dashboardNavItems)[number];
type DashboardThemeMode = (typeof dashboardThemeModes)[number];
type DashboardNavLinkRendererOptions = {
	readonly onNavigate: (() => void) | undefined;
};
type DashboardNavLinkRenderer = (
	item: DashboardNavItem,
	options: DashboardNavLinkRendererOptions,
) => ReactNode;

type DashboardShellProps = {
	readonly children: ReactNode;
	readonly currentPath: string;
	readonly renderNavLink?: DashboardNavLinkRenderer;
};

function getStoredThemeMode(): DashboardThemeMode {
	if (typeof window === 'undefined') {
		return 'system';
	}

	const storedThemeMode = window.localStorage.getItem(THEME_STORAGE_KEY);

	if (isDashboardThemeMode(storedThemeMode)) {
		return storedThemeMode;
	}

	return 'system';
}

function getSystemPrefersDark(): boolean {
	return (
		typeof window !== 'undefined' &&
		typeof window.matchMedia === 'function' &&
		window.matchMedia('(prefers-color-scheme: dark)').matches
	);
}

function applyThemeMode(themeMode: DashboardThemeMode): void {
	if (typeof document === 'undefined') {
		return;
	}

	const rootElement = document.documentElement;
	const resolvedDarkMode =
		themeMode === 'dark' || (themeMode === 'system' && getSystemPrefersDark());

	rootElement.classList.toggle('dark', resolvedDarkMode);
	rootElement.dataset['theme'] = themeMode;
}

function DashboardShell({
	children,
	currentPath,
	renderNavLink,
}: DashboardShellProps): ReactElement {
	const [themeMode, setThemeMode] = useState<DashboardThemeMode>(() => getStoredThemeMode());
	const [mobileNavigationOpen, setMobileNavigationOpen] = useState(false);

	useEffect(() => {
		applyThemeMode(themeMode);

		if (typeof window === 'undefined') {
			return;
		}

		window.localStorage.setItem(THEME_STORAGE_KEY, themeMode);

		if (themeMode !== 'system' || typeof window.matchMedia !== 'function') {
			return;
		}

		const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
		const handleChange = () => applyThemeMode('system');

		mediaQuery.addEventListener('change', handleChange);
		return () => mediaQuery.removeEventListener('change', handleChange);
	}, [themeMode]);

	return (
		<div className="min-h-dvh bg-background text-foreground">
			<div className="mx-auto flex min-h-dvh max-w-[96rem]">
				<aside className="hidden w-72 shrink-0 border-r border-border bg-sidebar lg:flex lg:flex-col">
					<div className="border-b border-border px-5 py-5">
						<p className="text-[0.7rem] font-semibold tracking-[0.24em] text-muted-foreground uppercase">
							Monque
						</p>
						<h1 className="mt-2 text-xl font-semibold text-balance">Dashboard</h1>
						<p className="mt-2 text-sm text-muted-foreground">
							Inspect queues, jobs, and health from a single operator surface.
						</p>
					</div>
					<div className="flex flex-1 flex-col justify-between px-3 py-4">
						<DashboardNavigation
							ariaLabel="Primary"
							currentPath={currentPath}
							renderNavLink={renderNavLink}
						/>
						<div className="rounded-lg border border-border bg-background/80 p-3">
							<p className="text-xs font-medium text-muted-foreground">Theme</p>
							<div className="mt-3">
								<ThemeModeMenu themeMode={themeMode} onThemeModeChange={setThemeMode} />
							</div>
						</div>
					</div>
				</aside>
				<div className="flex min-w-0 flex-1 flex-col">
					<header className="sticky top-0 z-20 border-b border-border bg-background/95 backdrop-blur">
						<div className="flex items-center justify-between gap-3 px-4 py-3 lg:px-8">
							<div className="flex items-center gap-3">
								<Dialog open={mobileNavigationOpen} onOpenChange={setMobileNavigationOpen}>
									<DialogTrigger
										render={
											<Button
												type="button"
												size="icon-sm"
												variant="outline"
												className="lg:hidden"
												aria-label="Open navigation"
											>
												<Menu />
											</Button>
										}
									/>
									<DialogContent className="top-0 right-0 bottom-0 left-auto flex h-dvh w-[20rem] translate-x-0 translate-y-0 flex-col rounded-none border-l border-border p-0">
										<div className="border-b border-border px-5 py-4">
											<DialogTitle>Dashboard navigation</DialogTitle>
											<p className="mt-2 text-sm text-muted-foreground">
												Queue Views stay first so operators land in the job families that matter.
											</p>
										</div>
										<DashboardNavigation
											ariaLabel="Mobile primary"
											className="px-3 py-4"
											currentPath={currentPath}
											onNavigate={() => setMobileNavigationOpen(false)}
											renderNavLink={renderNavLink}
										/>
										<div className="mt-auto border-t border-border px-5 py-4">
											<ThemeModeMenu themeMode={themeMode} onThemeModeChange={setThemeMode} />
										</div>
									</DialogContent>
								</Dialog>
								<div>
									<p className="text-[0.7rem] font-semibold tracking-[0.24em] text-muted-foreground uppercase">
										Monque
									</p>
									<p className="text-sm font-semibold">Operator Dashboard</p>
								</div>
							</div>
							<div className="lg:hidden">
								<ThemeModeMenu themeMode={themeMode} onThemeModeChange={setThemeMode} />
							</div>
						</div>
					</header>
					<main className="flex-1 px-4 py-6 lg:px-8 lg:py-8">{children}</main>
				</div>
			</div>
		</div>
	);
}

function DashboardNavigation({
	ariaLabel,
	className,
	currentPath,
	onNavigate,
	renderNavLink,
}: {
	readonly ariaLabel: string;
	readonly className?: string;
	readonly currentPath: string;
	readonly onNavigate?: () => void;
	readonly renderNavLink: DashboardNavLinkRenderer | undefined;
}): ReactElement {
	return (
		<nav className={cn('grid gap-1', className)} aria-label={ariaLabel}>
			{dashboardNavItems.map((item) => (
				<Fragment key={item.href}>
					{renderDashboardNavLink({ currentPath, item, onNavigate, renderNavLink })}
				</Fragment>
			))}
		</nav>
	);
}

function renderDashboardNavLink({
	currentPath,
	item,
	onNavigate,
	renderNavLink,
}: {
	readonly currentPath: string;
	readonly item: DashboardNavItem;
	readonly onNavigate: (() => void) | undefined;
	readonly renderNavLink: DashboardNavLinkRenderer | undefined;
}): ReactNode {
	if (renderNavLink) {
		return renderNavLink(item, { onNavigate });
	}

	return (
		<a
			href={item.href}
			className={getNavItemClassName(currentPath === item.href)}
			onClick={onNavigate}
		>
			{item.label}
		</a>
	);
}

function ThemeModeMenu({
	themeMode,
	onThemeModeChange,
}: {
	readonly themeMode: DashboardThemeMode;
	readonly onThemeModeChange: (themeMode: DashboardThemeMode) => void;
}): ReactElement {
	return (
		<DropdownMenu>
			<DropdownMenuTrigger
				render={
					<Button
						type="button"
						variant="outline"
						className="w-full justify-start"
						aria-label="Change theme"
					>
						{getThemeModeIcon(themeMode)}
						<span>{getThemeModeLabel(themeMode)}</span>
					</Button>
				}
			/>
			<DropdownMenuContent className="w-44">
				{dashboardThemeModes.map((mode) => (
					<DropdownMenuItem key={mode} onClick={() => onThemeModeChange(mode)}>
						{getThemeModeIcon(mode)}
						<span>{getThemeModeMenuLabel(mode)}</span>
					</DropdownMenuItem>
				))}
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

function isDashboardThemeMode(themeMode: string | null): themeMode is DashboardThemeMode {
	switch (themeMode) {
		case 'light':
		case 'dark':
		case 'system':
			return true;
		default:
			return false;
	}
}

function getThemeModeIcon(themeMode: DashboardThemeMode): ReactElement {
	switch (themeMode) {
		case 'light':
			return <Sun />;
		case 'dark':
			return <Moon />;
		case 'system':
			return <LaptopMinimal />;
	}
}

function getThemeModeLabel(themeMode: DashboardThemeMode): string {
	switch (themeMode) {
		case 'light':
			return 'Light mode';
		case 'dark':
			return 'Dark mode';
		case 'system':
			return 'System mode';
	}
}

function getThemeModeMenuLabel(themeMode: DashboardThemeMode): string {
	switch (themeMode) {
		case 'light':
			return 'Light theme';
		case 'dark':
			return 'Dark theme';
		case 'system':
			return 'System theme';
	}
}

function getNavItemClassName(active: boolean): string {
	const baseClassName =
		'flex h-10 items-center rounded-lg px-3 text-sm font-medium transition-colors';

	if (active) {
		return cn(baseClassName, 'bg-primary/12 text-primary');
	}

	return cn(baseClassName, 'text-muted-foreground hover:bg-background hover:text-foreground');
}

export {
	applyThemeMode,
	type DashboardNavItem,
	DashboardShell,
	type DashboardThemeMode,
	getStoredThemeMode,
};
