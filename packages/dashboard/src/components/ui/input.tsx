import { Input as InputPrimitive } from '@base-ui/react/input';

import { cn } from '@/lib/utils';

function Input({ className, ...props }: InputPrimitive.Props) {
	return (
		<InputPrimitive
			data-slot="input"
			className={cn(
				'flex h-8 min-w-0 w-full rounded-lg border border-input bg-background px-2.5 py-1 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:bg-input/30',
				className,
			)}
			{...props}
		/>
	);
}

export { Input };
