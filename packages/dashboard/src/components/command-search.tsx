import { useEffect, useRef } from 'react';

import {
	Command,
	CommandEmpty,
	CommandInput,
	CommandItem,
	CommandList,
} from '@/components/ui/command';

function CommandSearch({
	commands,
	onClose,
}: {
	readonly commands: readonly { label: string; run: () => void }[];
	readonly onClose: () => void;
}) {
	const input = useRef<HTMLInputElement>(null);
	useEffect(() => {
		input.current?.focus();
	}, []);
	return (
		<Command>
			<CommandInput ref={input} aria-label="Search commands" placeholder="Search commands…" />
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
