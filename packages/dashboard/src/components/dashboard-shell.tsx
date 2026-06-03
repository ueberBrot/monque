import {
	FilterX,
	HelpCircle,
	LaptopMinimal,
	Link2,
	Menu,
	Moon,
	RefreshCw,
	Search,
	Sun,
} from 'lucide-react';
import {
	createContext,
	Fragment,
	type ReactElement,
	type ReactNode,
	useCallback,
	useContext,
	useEffect,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from 'react';

import { Button } from '@/components/ui/button';
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogTitle,
	DialogTrigger,
} from '@/components/ui/dialog';
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
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
type DashboardShellRouteAction = {
	readonly label: string;
	readonly run: () => void;
};
type DashboardShellRouteActions = {
	readonly clearFilters?: DashboardShellRouteAction;
	readonly refresh?: () => void;
	readonly viewLabel?: string;
};
type DashboardShellCommand = {
	readonly description: string;
	readonly icon: ReactElement;
	readonly id: string;
	readonly keywords: readonly string[];
	readonly label: string;
	readonly run: () => void;
	readonly shortcut?: string;
};
type DashboardShellContextValue = {
	readonly setRouteActions: (actions: DashboardShellRouteActions | null) => void;
};

type DashboardShellProps = {
	readonly children: ReactNode;
	readonly currentPath: string;
	readonly onNavigate?: (href: string) => void;
	readonly renderNavLink?: DashboardNavLinkRenderer;
};

const dashboardKeyboardShortcuts = [
	{
		description: 'Open the command palette for navigation and safe actions.',
		keybinding: 'Ctrl/Cmd+K or /',
		label: 'Command palette',
	},
	{
		description: 'Refresh the current view without reloading the page.',
		keybinding: 'Shift+R',
		label: 'Refresh current view',
	},
	{
		description: 'Open keyboard shortcut help.',
		keybinding: '?',
		label: 'Shortcut help',
	},
	{
		description: 'Close the current dialog or palette.',
		keybinding: 'Escape',
		label: 'Close dialog',
	},
] as const;
const DashboardShellContext = createContext<DashboardShellContextValue | null>(null);

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
	onNavigate,
	renderNavLink,
}: DashboardShellProps): ReactElement {
	const [themeMode, setThemeMode] = useState<DashboardThemeMode>(() => getStoredThemeMode());
	const [mobileNavigationOpen, setMobileNavigationOpen] = useState(false);
	const [paletteOpen, setPaletteOpen] = useState(false);
	const [shortcutHelpOpen, setShortcutHelpOpen] = useState(false);
	const [paletteQuery, setPaletteQuery] = useState('');
	const [routeActions, setRouteActions] = useState<DashboardShellRouteActions | null>(null);
	const restoreFocusRef = useRef<HTMLElement | null>(null);

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
		if (paletteOpen) {
			setPaletteQuery('');
		}
	}, [paletteOpen]);

	const restoreFocus = useCallback((): void => {
		queueMicrotask(() => {
			restoreFocusRef.current?.focus();
			restoreFocusRef.current = null;
		});
	}, []);

	const openPalette = useCallback((): void => {
		restoreFocusRef.current = getFocusableActiveElement();
		setPaletteOpen(true);
	}, []);

	const closePalette = useCallback((): void => {
		setPaletteOpen(false);
		restoreFocus();
	}, [restoreFocus]);

	const openShortcutHelp = useCallback((): void => {
		restoreFocusRef.current = getFocusableActiveElement();
		setShortcutHelpOpen(true);
	}, []);

	const closeShortcutHelp = useCallback((): void => {
		setShortcutHelpOpen(false);
		restoreFocus();
	}, [restoreFocus]);

	useEffect(() => {
		const handleKeyDown = (event: KeyboardEvent): void => {
			if (event.key === 'Escape') {
				if (paletteOpen) {
					event.preventDefault();
					closePalette();
					return;
				}

				if (shortcutHelpOpen) {
					event.preventDefault();
					closeShortcutHelp();
				}

				return;
			}

			if (isTypingTarget(event.target)) {
				return;
			}

			if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
				event.preventDefault();
				openPalette();
				return;
			}

			if (!event.metaKey && !event.ctrlKey && !event.altKey && event.key === '/') {
				event.preventDefault();
				openPalette();
				return;
			}

			if (!event.metaKey && !event.ctrlKey && !event.altKey && event.key === '?') {
				event.preventDefault();
				openShortcutHelp();
				return;
			}

			if (
				!event.metaKey &&
				!event.ctrlKey &&
				!event.altKey &&
				event.shiftKey &&
				event.key === 'R'
			) {
				event.preventDefault();
				routeActions?.refresh?.();
			}
		};

		window.addEventListener('keydown', handleKeyDown);
		return () => window.removeEventListener('keydown', handleKeyDown);
	}, [
		closePalette,
		closeShortcutHelp,
		openPalette,
		openShortcutHelp,
		paletteOpen,
		routeActions,
		shortcutHelpOpen,
	]);

	const commands = useMemo<readonly DashboardShellCommand[]>(() => {
		const safeActionCommands: DashboardShellCommand[] = [
			{
				description: 'Copy the current dashboard URL for sharing.',
				icon: <Link2 className="size-4" />,
				id: 'copy-url',
				keywords: ['copy', 'share', 'url', 'link'],
				label: 'Copy current URL',
				run: () => {
					void navigator.clipboard.writeText(window.location.href);
				},
			},
			{
				description: 'Toggle between light and dark operator modes.',
				icon: getThemeModeIcon(themeMode),
				id: 'toggle-theme',
				keywords: ['theme', 'dark', 'light', 'appearance'],
				label: 'Toggle theme',
				run: () => {
					setThemeMode(getNextThemeMode(themeMode));
				},
			},
			{
				description: 'Review the safe dashboard keyboard shortcuts.',
				icon: <HelpCircle className="size-4" />,
				id: 'shortcut-help',
				keywords: ['help', 'shortcuts', 'keyboard'],
				label: 'Show keyboard shortcuts',
				run: () => {
					openShortcutHelp();
				},
				shortcut: '?',
			},
		];

		if (routeActions?.refresh) {
			safeActionCommands.unshift({
				description: `Refetch ${routeActions.viewLabel ?? 'the current view'} from the Management API.`,
				icon: <RefreshCw className="size-4" />,
				id: 'refresh',
				keywords: ['refresh', 'reload', 'refetch'],
				label: 'Refresh current view',
				run: routeActions.refresh,
				shortcut: 'Shift+R',
			});
		}

		if (routeActions?.clearFilters) {
			safeActionCommands.splice(1, 0, {
				description: 'Return the current view to its default search state.',
				icon: <FilterX className="size-4" />,
				id: 'clear-filters',
				keywords: ['filters', 'clear', 'reset', 'search'],
				label: routeActions.clearFilters.label,
				run: routeActions.clearFilters.run,
			});
		}

		return [
			...dashboardNavItems.map((item) => ({
				description: `Navigate to ${item.label}.`,
				icon: <Search className="size-4" />,
				id: `nav-${item.href}`,
				keywords: ['navigate', 'go', ...item.label.toLowerCase().split(' ')],
				label: item.label,
				run: () => navigateTo(item.href, onNavigate),
			})),
			...safeActionCommands,
		];
	}, [onNavigate, openShortcutHelp, routeActions, themeMode]);

	const filteredCommands = useMemo(() => {
		const normalizedQuery = paletteQuery.trim().toLowerCase();

		if (normalizedQuery.length === 0) {
			return commands;
		}

		return commands.filter((command) =>
			[command.label, command.description, ...command.keywords].some((value) =>
				value.toLowerCase().includes(normalizedQuery),
			),
		);
	}, [commands, paletteQuery]);

	const runCommand = useCallback(
		(command: DashboardShellCommand): void => {
			command.run();
			setPaletteOpen(false);
			restoreFocus();
		},
		[restoreFocus],
	);

	return (
		<DashboardShellContext.Provider value={{ setRouteActions }}>
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
							<div className="grid gap-3 rounded-lg border border-border bg-background/80 p-3">
								<Button
									type="button"
									variant="outline"
									className="justify-start"
									onClick={openPalette}
								>
									<Search className="size-4" />
									Command palette
									<span className="ml-auto text-xs text-muted-foreground">Ctrl/Cmd+K</span>
								</Button>
								<p className="text-xs font-medium text-muted-foreground">Theme</p>
								<ThemeModeMenu themeMode={themeMode} onThemeModeChange={setThemeMode} />
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
								<div className="flex items-center gap-2">
									<Button
										type="button"
										variant="outline"
										size="sm"
										className="hidden md:inline-flex"
										onClick={openPalette}
									>
										<Search className="size-4" />
										Command palette
									</Button>
									<Button
										type="button"
										variant="outline"
										size="icon-sm"
										onClick={openShortcutHelp}
										aria-label="Open keyboard shortcuts"
									>
										<HelpCircle className="size-4" />
									</Button>
									<div className="lg:hidden">
										<ThemeModeMenu themeMode={themeMode} onThemeModeChange={setThemeMode} />
									</div>
								</div>
							</div>
						</header>
						<main className="flex-1 px-4 py-6 lg:px-8 lg:py-8">{children}</main>
					</div>
				</div>
			</div>
			<Dialog
				open={paletteOpen}
				onOpenChange={(nextOpen) => (!nextOpen ? closePalette() : undefined)}
			>
				<DialogContent>
					<DialogTitle>Command palette</DialogTitle>
					<DialogDescription>
						Navigate between primary routes and run safe dashboard actions only.
					</DialogDescription>
					<Input
						autoFocus
						placeholder="Search commands"
						value={paletteQuery}
						onChange={(event) => setPaletteQuery(event.target.value)}
						aria-label="Search commands"
					/>
					<div className="max-h-80 overflow-y-auto rounded-lg border border-border">
						{filteredCommands.length > 0 ? (
							<div className="grid gap-px bg-border">
								{filteredCommands.map((command) => (
									<button
										key={command.id}
										type="button"
										className="flex w-full items-start gap-3 bg-background px-3 py-3 text-left transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
										onClick={() => runCommand(command)}
									>
										<span className="mt-0.5 text-muted-foreground">{command.icon}</span>
										<span className="min-w-0 flex-1">
											<span className="block text-sm font-medium">{command.label}</span>
											<span className="mt-1 block text-sm text-muted-foreground">
												{command.description}
											</span>
										</span>
										{command.shortcut ? (
											<span className="text-xs text-muted-foreground">{command.shortcut}</span>
										) : null}
									</button>
								))}
							</div>
						) : (
							<div className="px-3 py-6 text-sm text-muted-foreground">
								No commands matched this search.
							</div>
						)}
					</div>
				</DialogContent>
			</Dialog>
			<Dialog
				open={shortcutHelpOpen}
				onOpenChange={(nextOpen) => (!nextOpen ? closeShortcutHelp() : undefined)}
			>
				<DialogContent>
					<DialogTitle>Keyboard shortcuts</DialogTitle>
					<DialogDescription>
						Safe keyboard access for route navigation and view-level inspection.
					</DialogDescription>
					<ul className="grid gap-3">
						{dashboardKeyboardShortcuts.map((shortcut) => (
							<li
								key={shortcut.label}
								className="rounded-lg border border-border bg-background/80 px-3 py-3"
							>
								<div className="flex items-start justify-between gap-3">
									<div>
										<h3 className="text-sm font-medium">{shortcut.label}</h3>
										<p className="mt-1 text-sm text-muted-foreground">{shortcut.description}</p>
									</div>
									<kbd className="rounded-md border border-border bg-card px-2 py-1 text-xs font-medium">
										{shortcut.keybinding}
									</kbd>
								</div>
							</li>
						))}
					</ul>
				</DialogContent>
			</Dialog>
		</DashboardShellContext.Provider>
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

function useDashboardShellRouteActions(actions: DashboardShellRouteActions): void {
	const context = useContext(DashboardShellContext);

	useLayoutEffect(() => {
		if (!context) {
			return;
		}

		context.setRouteActions(actions);
		return () => context.setRouteActions(null);
	}, [actions, context]);
}

function navigateTo(href: string, onNavigate: DashboardShellProps['onNavigate']): void {
	if (onNavigate) {
		onNavigate(href);
		return;
	}

	window.history.pushState({}, '', href);
	window.dispatchEvent(new PopStateEvent('popstate'));
}

function getNextThemeMode(themeMode: DashboardThemeMode): DashboardThemeMode {
	if (themeMode === 'light') {
		return 'dark';
	}

	if (themeMode === 'dark') {
		return 'light';
	}

	return document.documentElement.classList.contains('dark') ? 'light' : 'dark';
}

function getFocusableActiveElement(): HTMLElement | null {
	return document.activeElement instanceof HTMLElement ? document.activeElement : null;
}

function isTypingTarget(target: EventTarget | null): boolean {
	if (!(target instanceof HTMLElement)) {
		return false;
	}

	if (target.isContentEditable) {
		return true;
	}

	if (target instanceof HTMLTextAreaElement) {
		return true;
	}

	if (target instanceof HTMLInputElement) {
		return target.type !== 'checkbox' && target.type !== 'radio';
	}

	return false;
}

function isActiveNavItem(currentPath: string, itemHref: string): boolean {
	return currentPath === itemHref || currentPath.startsWith(`${itemHref}/`);
}

export {
	applyThemeMode,
	type DashboardNavItem,
	DashboardShell,
	type DashboardThemeMode,
	getStoredThemeMode,
	useDashboardShellRouteActions,
};
