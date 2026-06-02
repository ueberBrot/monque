import { Menu as MenuPrimitive } from '@base-ui/react/menu';

import { cn } from '@/lib/utils';

function DropdownMenu(props: MenuPrimitive.Root.Props) {
	return <MenuPrimitive.Root {...props} />;
}

function DropdownMenuTrigger(props: MenuPrimitive.Trigger.Props) {
	return <MenuPrimitive.Trigger data-slot="dropdown-menu-trigger" {...props} />;
}

function DropdownMenuContent({ className, ...props }: MenuPrimitive.Popup.Props) {
	return (
		<MenuPrimitive.Portal>
			<MenuPrimitive.Positioner sideOffset={4}>
				<MenuPrimitive.Popup
					data-slot="dropdown-menu-content"
					className={cn(
						'z-50 min-w-40 rounded-lg bg-popover p-1 text-popover-foreground shadow-[0_8px_12px_rgba(0,0,0,0.36)] outline-none',
						className,
					)}
					{...props}
				/>
			</MenuPrimitive.Positioner>
		</MenuPrimitive.Portal>
	);
}

function DropdownMenuItem({ className, ...props }: MenuPrimitive.Item.Props) {
	return (
		<MenuPrimitive.Item
			data-slot="dropdown-menu-item"
			className={cn(
				'flex h-8 cursor-default items-center gap-2 rounded-md px-2 text-sm outline-none select-none data-[highlighted]:bg-muted data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
				className,
			)}
			{...props}
		/>
	);
}

export { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger };
