import { Suspense } from 'react';

import { Command, CommandEmpty, CommandItem, CommandList } from '@/components/ui/command';
import { useAppForm } from '@/forms/form';

function CommandSearch({
	commands,
	onClose,
}: {
	readonly commands: readonly { label: string; run: () => void }[];
	readonly onClose: () => void;
}) {
	const form = useAppForm({ defaultValues: { query: '' } });
	return (
		<Command>
			<Suspense fallback={null}>
				<form.AppField name="query">
					{(field) => (
						<field.CommandSearchField label="Search commands" placeholder="Search commands…" />
					)}
				</form.AppField>
			</Suspense>
			<CommandList>
				<CommandEmpty>No commands found.</CommandEmpty>
				{commands.map((command) => (
					<CommandItem
						key={command.label}
						onSelect={() => {
							command.run();
							onClose();
						}}
					>
						{command.label}
					</CommandItem>
				))}
			</CommandList>
		</Command>
	);
}

export { CommandSearch };
