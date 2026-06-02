import { Tooltip as TooltipPrimitive } from '@base-ui/react/tooltip';

function TooltipProvider(props: TooltipPrimitive.Provider.Props) {
	return <TooltipPrimitive.Provider {...props} />;
}

export { TooltipProvider };
