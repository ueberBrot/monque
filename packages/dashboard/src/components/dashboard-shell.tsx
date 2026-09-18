import { Activity, LaptopMinimal, Layers, ListTodo, Menu, Moon, Sun } from 'lucide-react';
import { Fragment, type ReactElement, type ReactNode, useEffect, useState } from 'react';

import monqueLogo from '@/assets/monque.svg';
import { Button } from '@/components/ui/button';
import {
	Dialog,
	DialogClose,
	DialogContent,
	DialogTitle,
	DialogTrigger,
} from '@/components/ui/dialog';
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Toaster } from '@/components/ui/sonner';
import { cn } from '@/lib/utils';

const THEME_STORAGE_KEY = 'monque-dashboard-theme';

const dashboardNavItems = [
	{ href: '/queue-views', label: 'Queue Views', icon: Layers },
	{ href: '/jobs', label: 'Jobs', icon: ListTodo },
	{ href: '/health', label: 'Health', icon: Activity },
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

	useEffect(() => {
		const toggle = () =>
			setThemeMode(document.documentElement.classList.contains('dark') ? 'light' : 'dark');
		window.addEventListener('monque:toggle-theme', toggle);
		return () => window.removeEventListener('monque:toggle-theme', toggle);
	}, []);

	return (
		<div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-background text-foreground">
			<Toaster theme={themeMode} closeButton duration={5_000} position="bottom-right" />
			<a
				href="#main-content"
				className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:bg-background focus:p-4"
			>
				Skip to content
			</a>
			<div className="flex min-h-0 flex-1">
				<aside className="hidden min-h-0 w-56 shrink-0 border-r border-border bg-sidebar lg:flex lg:flex-col">
					<div className="flex h-16 shrink-0 items-center gap-3 px-5">
						<img src={monqueLogo} alt="" className="size-8 shrink-0" width={32} height={32} />
						<span className="text-lg font-semibold tracking-tight">Monque</span>
						<span className="ml-auto text-xs text-muted-foreground">Dashboard</span>
					</div>
					<div className="flex min-h-0 flex-1 flex-col justify-between px-3 py-4">
						<DashboardNavigation
							className="min-h-0 overflow-y-auto"
							ariaLabel="Primary"
							currentPath={currentPath}
							renderNavLink={renderNavLink}
						/>
						<div className="grid shrink-0 gap-3 px-1 py-3">
							<ThemeModeMenu themeMode={themeMode} onThemeModeChange={setThemeMode} />
						</div>
					</div>
				</aside>
				<div className="flex min-h-0 min-w-0 flex-1 flex-col">
					<header className="shrink-0 border-b border-border bg-background lg:hidden">
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
									<DialogContent
										showCloseButton={false}
										className="top-0 right-0 bottom-0 left-auto flex h-dvh w-[20rem] translate-x-0 translate-y-0 flex-col rounded-none border-l border-border p-0"
									>
										<div className="border-b border-border px-5 py-4">
											<div className="flex items-center justify-between gap-2">
												<DialogTitle>Dashboard navigation</DialogTitle>
												<DialogClose render={<Button variant="ghost" size="sm" />}>
													Close
												</DialogClose>
											</div>
											<p className="mt-2 text-sm text-muted-foreground">
												Inspect jobs and scheduler health.
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
								<div className="flex items-center gap-2">
									<img src={monqueLogo} alt="" className="size-8 shrink-0" width={32} height={32} />
									<p className="text-sm font-semibold">Monque</p>
								</div>
							</div>
							<div className="flex items-center gap-2">
								<div className="lg:hidden">
									<ThemeModeMenu themeMode={themeMode} onThemeModeChange={setThemeMode} />
								</div>
							</div>
						</div>
					</header>
					<main
						id="main-content"
						tabIndex={-1}
						className="min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-contain px-4 py-6 outline-none sm:px-6 lg:px-8 lg:py-8"
					>
						<div className="mx-auto w-full max-w-[96rem]">{children}</div>
					</main>
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
			className={getNavItemClassName(isActiveNavItem(currentPath, item.href))}
			onClick={onNavigate}
		>
			<item.icon className="size-4" />
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
		'flex h-10 items-center gap-2.5 rounded-md px-3 text-sm font-medium transition-colors';

	if (active) {
		return cn(baseClassName, 'bg-primary/12 text-primary');
	}

	return cn(baseClassName, 'text-muted-foreground hover:bg-background hover:text-foreground');
}

function isActiveNavItem(currentPath: string, itemHref: string): boolean {
	return currentPath === itemHref || currentPath.startsWith(`${itemHref}/`);
}

export { type DashboardNavItem, DashboardShell, type DashboardThemeMode };
