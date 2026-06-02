import type * as React from 'react';
import { tv, type VariantProps } from 'tailwind-variants';

import { cn } from '@/lib/utils';

const badgeVariants = tv({
	base: 'inline-flex h-6 items-center gap-1 rounded-full px-2 text-xs font-medium',
	variants: {
		variant: {
			default: 'bg-secondary text-secondary-foreground',
			outline: 'border border-border bg-background text-foreground',
			success: 'bg-primary/10 text-primary',
			warning: 'bg-amber-500/10 text-amber-700 dark:text-amber-300',
			danger: 'bg-destructive/10 text-destructive',
		},
	},
	defaultVariants: {
		variant: 'default',
	},
});

function Badge({
	className,
	variant,
	...props
}: React.ComponentProps<'span'> & VariantProps<typeof badgeVariants>) {
	return (
		<span data-slot="badge" className={cn(badgeVariants({ variant }), className)} {...props} />
	);
}

export { Badge, badgeVariants };
