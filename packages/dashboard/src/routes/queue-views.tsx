import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/queue-views')({
	component: QueueViewsRoute,
});

function QueueViewsRoute() {
	return (
		<section className="grid gap-2">
			<h1 className="text-2xl font-semibold">Queue Views</h1>
			<p className="max-w-prose text-sm text-muted-foreground">
				Queue Views route shell. Data wiring lands in #463.
			</p>
		</section>
	);
}
