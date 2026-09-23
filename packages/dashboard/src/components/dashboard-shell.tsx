import { Link } from '@tanstack/react-router';
import { Activity, LaptopMinimal, Layers, ListTodo, Menu, Moon, Sun } from 'lucide-react';
import { type ReactElement, type ReactNode, useEffect, useState } from 'react';

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

const themeModes = {
	light: { label: 'Light', icon: Sun },
	dark: { label: 'Dark', icon: Moon },
	system: { label: 'System', icon: LaptopMinimal },
} as const;
const dashboardThemeModes = ['light', 'dark', 'system'] as const;
type DashboardThemeMode = (typeof dashboardThemeModes)[number];

function getStoredThemeMode(): DashboardThemeMode {
	if (typeof window === 'undefined') {
		return 'system';
	}

	try {
		const storedThemeMode = window.localStorage.getItem(THEME_STORAGE_KEY);
		if (isDashboardThemeMode(storedThemeMode)) return storedThemeMode;
	} catch {
		// Storage can be unavailable in embedded dashboards or restricted browser sessions.
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

function DashboardShell({ children }: { readonly children: ReactNode }): ReactElement {
	const [themeMode, setThemeMode] = useState<DashboardThemeMode>(() => getStoredThemeMode());
	const [mobileNavigationOpen, setMobileNavigationOpen] = useState(false);

	useEffect(() => {
		applyThemeMode(themeMode);

		if (typeof window === 'undefined') {
			return;
		}

		try {
			window.localStorage.setItem(THEME_STORAGE_KEY, themeMode);
		} catch {
			// Theme changes still apply for this session when persistence is unavailable.
		}

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
			<Toaster
				className="toaster group z-40!"
				theme={themeMode}
				closeButton
				duration={5_000}
				position="bottom-right"
			/>
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
						<DashboardNavigation className="min-h-0 overflow-y-auto" ariaLabel="Primary" />
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
										className="top-0 right-0 bottom-0 left-auto flex h-dvh w-80 translate-x-0 translate-y-0 flex-col rounded-none border-l border-border p-0"
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
											onNavigate={() => setMobileNavigationOpen(false)}
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
						<div className="mx-auto w-full max-w-384">{children}</div>
					</main>
				</div>
			</div>
		</div>
	);
}

function DashboardNavigation({
	ariaLabel,
	className,
	onNavigate,
}: {
	readonly ariaLabel: string;
	readonly className?: string;
	readonly onNavigate?: () => void;
}): ReactElement {
	return (
		<nav className={cn('grid gap-1', className)} aria-label={ariaLabel}>
			{dashboardNavItems.map((item) => (
				<Link
					key={item.href}
					to={item.href}
					onClick={onNavigate}
					className="flex h-10 items-center gap-2.5 rounded-md px-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-background hover:text-foreground"
					activeProps={{
						className: 'bg-primary/12 text-primary hover:bg-primary/12 hover:text-primary',
					}}
				>
					<item.icon className="size-4" />
					{item.label}
				</Link>
			))}
		</nav>
	);
}

function ThemeModeMenu({
	themeMode,
	onThemeModeChange,
}: {
	readonly themeMode: DashboardThemeMode;
	readonly onThemeModeChange: (themeMode: DashboardThemeMode) => void;
}): ReactElement {
	const Icon = themeModes[themeMode].icon;
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
						<Icon />
						<span>{themeModes[themeMode].label} mode</span>
					</Button>
				}
			/>
			<DropdownMenuContent className="w-44">
				{dashboardThemeModes.map((mode) => {
					const { icon: ModeIcon, label } = themeModes[mode];
					return (
						<DropdownMenuItem key={mode} onClick={() => onThemeModeChange(mode)}>
							<ModeIcon />
							<span>{label} theme</span>
						</DropdownMenuItem>
					);
				})}
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

function isDashboardThemeMode(value: string | null): value is DashboardThemeMode {
	return dashboardThemeModes.some((mode) => mode === value);
}

export { DashboardShell, type DashboardThemeMode };
