import { Select as SelectPrimitive } from '@base-ui/react/select';
import { Check, ChevronDown } from 'lucide-react';

import { cn } from '@/lib/utils';

function Select(props: SelectPrimitive.Root.Props<string>) {
	return <SelectPrimitive.Root {...props} />;
}

function SelectTrigger({ className, children, ...props }: SelectPrimitive.Trigger.Props) {
	return (
		<SelectPrimitive.Trigger
			data-slot="select-trigger"
			className={cn(
				'flex h-8 min-w-0 w-full items-center justify-between gap-2 rounded-lg border border-input bg-background px-2.5 text-sm text-foreground outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-input/30',
				className,
			)}
			{...props}
		>
			{children}
			<SelectPrimitive.Icon className="text-muted-foreground">
				<ChevronDown className="size-4" />
			</SelectPrimitive.Icon>
		</SelectPrimitive.Trigger>
	);
}

function SelectValue(props: SelectPrimitive.Value.Props) {
	return <SelectPrimitive.Value data-slot="select-value" {...props} />;
}

function SelectPopup({ className, ...props }: SelectPrimitive.Popup.Props) {
	return (
		<SelectPrimitive.Portal>
			<SelectPrimitive.Positioner sideOffset={4}>
				<SelectPrimitive.Popup
					data-slot="select-popup"
					className={cn(
						'z-50 max-h-72 min-w-[8rem] overflow-hidden rounded-lg bg-popover p-1 text-popover-foreground shadow-[0_8px_12px_rgba(0,0,0,0.36)] outline-none',
						className,
					)}
					{...props}
				/>
			</SelectPrimitive.Positioner>
		</SelectPrimitive.Portal>
	);
}

function SelectItem({ className, children, ...props }: SelectPrimitive.Item.Props) {
	return (
		<SelectPrimitive.Item
			data-slot="select-item"
			className={cn(
				'flex h-8 cursor-default items-center gap-2 rounded-md px-2 text-sm outline-none select-none data-[highlighted]:bg-muted data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
				className,
			)}
			{...props}
		>
			<SelectPrimitive.ItemIndicator className="size-4">
				<Check className="size-4" />
			</SelectPrimitive.ItemIndicator>
			<SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
		</SelectPrimitive.Item>
	);
}

export { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue };
