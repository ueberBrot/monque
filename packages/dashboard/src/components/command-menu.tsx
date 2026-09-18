import { useHotkey } from '@tanstack/react-hotkeys';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { Search } from 'lucide-react';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import {
	Command,
	CommandEmpty,
	CommandInput,
	CommandItem,
	CommandList,
} from '@/components/ui/command';
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogTitle,
	DialogTrigger,
} from '@/components/ui/dialog';
import { parseJobsRouteSearch } from '@/features/jobs/job-list-search';

function CommandMenu() {
	const [open, setOpen] = useState(false);
	const [search, setSearch] = useState('');
	const [feedback, setFeedback] = useState('');
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const refresh = () => {
		void queryClient.invalidateQueries();
	};
	useHotkey('Mod+K', () => setOpen((current) => !current));
	useHotkey('Mod+Shift+R', refresh);
	useHotkey({ key: '/', shift: true }, () => {
		setSearch('');
		setOpen(true);
	});
	const commands = [
		{
			label: 'Go to Queue Views',
			run: () => {
				void navigate({ to: '/queue-views' });
			},
		},
		{
			label: 'Go to Jobs',
			run: () => {
				void navigate({ to: '/jobs', search: parseJobsRouteSearch({}) });
			},
		},
		{
			label: 'Go to Health',
			run: () => {
				void navigate({ to: '/health' });
			},
		},
		{ label: 'Refresh current view', run: refresh },
		{
			label: 'Clear filters',
			run: () => {
				void navigate({ to: '/jobs', search: parseJobsRouteSearch({}), replace: true });
			},
		},
		{ label: 'Toggle theme', run: () => window.dispatchEvent(new Event('monque:toggle-theme')) },
		{
			label: 'Copy page URL',
			run: () => {
				void navigator.clipboard.writeText(window.location.href).then(
					() => setFeedback('Page URL copied'),
					() => setFeedback('Copy failed. Copy the URL from your address bar.'),
				);
			},
		},
	];
	return (
		<div className="mb-5 flex min-h-8 items-center justify-end gap-3">
			<span role="status" className="text-xs text-muted-foreground">
				{feedback}
			</span>
			<Dialog
				open={open}
				onOpenChange={(value) => {
					setOpen(value);
					if (!value) setSearch('');
				}}
			>
				<DialogTrigger
					render={
						<Button variant="ghost" size="sm" className="text-muted-foreground">
							<Search className="size-4" />
							Commands{' '}
							<kbd className="ml-2 hidden rounded border border-border px-1 text-xs sm:inline">
								Ctrl / ⌘ K
							</kbd>
						</Button>
					}
				/>
				<DialogContent>
					<DialogTitle>Commands</DialogTitle>
					<DialogDescription>
						Navigate or update your view. Ctrl / ⌘ Shift R refreshes; ? opens this menu.
					</DialogDescription>
					<Command>
						<CommandInput
							aria-label="Search commands"
							placeholder="Search commands…"
							value={search}
							onValueChange={setSearch}
						/>
						<CommandList>
							<CommandEmpty>No commands found.</CommandEmpty>
							{commands.map((command) => (
								<CommandItem
									key={command.label}
									onSelect={() => {
										command.run();
										setOpen(false);
										setSearch('');
									}}
								>
									{command.label}
								</CommandItem>
							))}
						</CommandList>
					</Command>
					<Button variant="outline" onClick={() => setOpen(false)}>
						Close commands
					</Button>
				</DialogContent>
			</Dialog>
		</div>
	);
}

export { CommandMenu };
