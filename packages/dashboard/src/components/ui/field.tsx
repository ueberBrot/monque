import { Field as FieldPrimitive } from '@base-ui/react/field';

import { cn } from '@/lib/utils';

function Field({ className, ...props }: FieldPrimitive.Root.Props) {
	return (
		<FieldPrimitive.Root
			data-slot="field"
			className={cn('grid min-w-0 gap-1.5', className)}
			{...props}
		/>
	);
}

function FieldLabel({ className, ...props }: FieldPrimitive.Label.Props) {
	return (
		<FieldPrimitive.Label
			data-slot="field-label"
			className={cn('text-sm font-medium text-foreground', className)}
			{...props}
		/>
	);
}

function FieldDescription({ className, ...props }: FieldPrimitive.Description.Props) {
	return (
		<FieldPrimitive.Description
			data-slot="field-description"
			className={cn('text-xs text-muted-foreground', className)}
			{...props}
		/>
	);
}

function FieldError({ className, ...props }: FieldPrimitive.Error.Props) {
	return (
		<FieldPrimitive.Error
			data-slot="field-error"
			className={cn('text-xs font-medium text-destructive', className)}
			{...props}
		/>
	);
}

export { Field, FieldDescription, FieldError, FieldLabel };
